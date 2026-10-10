import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { readCloudflareVideoAnalysisSettings, VISION_CLOUDFLARE_MODEL, type WritingSettings } from "./writingSettings";
import { WritingConfigurationError, WritingWaitError } from "./groqWriter";

const base = "https://api.cloudflare.com/client/v4/accounts/";
const privatePath = (name: string) => path.join(process.cwd(), "storage", "private", name);
export class CloudflareVisionRetryError extends Error {}
export class CloudflareVisionQuotaError extends WritingWaitError {}

function assertSettings(settings: WritingSettings) {
  if (settings.provider !== "cloudflare" || settings.model !== VISION_CLOUDFLARE_MODEL || !settings.allowVideoFrames || !settings.freePlanConfirmed
    || !settings.apiKey || settings.apiKey.startsWith("gsk_") || !/^[A-Za-z0-9_-]{20,250}$/.test(settings.apiKey)
    || !settings.accountId || !/^[a-fA-F0-9]{32}$/.test(settings.accountId)) {
    throw new WritingConfigurationError("Configure the Cloudflare Free caption fallback and explicitly allow sampled frames in Writing settings. No images were sent.");
  }
}
function identity(settings: WritingSettings) {
  return createHash("sha256").update(`${settings.accountId}:${settings.model}:${settings.apiKey}`).digest("hex");
}
export async function cloudflareVisionQuotaDelay(settings: WritingSettings) {
  let state: { identity?: string; until?: number } = {};
  try {
    const filename = privatePath("cloudflare-vision-quota.json");
    if ((await fs.stat(filename)).size > 4_096) throw new Error();
    state = JSON.parse(await fs.readFile(filename, "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state) || typeof state.identity !== "string" || !/^[a-f0-9]{64}$/.test(state.identity)
      || !Number.isSafeInteger(state.until) || state.until! <= 0) throw new Error();
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read Cloudflare caption retry state. No request was sent."); }
  return state.identity === identity(settings) && Number.isFinite(state.until) ? Math.max(0, Math.min(86_400_000, state.until! - Date.now())) : 0;
}
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new CloudflareVisionRetryError("Cloudflare returned no caption response. The video is retained.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024 * 1024) throw new CloudflareVisionRetryError("Cloudflare returned an oversized caption response. No copy was accepted.");
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")); }
    catch { throw new CloudflareVisionRetryError("Cloudflare returned unreadable caption JSON. No copy was accepted."); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
async function errorCode(response: Response) {
  try {
    const value = await boundedJson(response) as { errors?: Array<{ code?: unknown }> };
    const code = value?.errors?.[0]?.code;
    return typeof code === "number" || typeof code === "string" && /^\d{1,6}$/.test(code) ? Number(code) : undefined;
  } catch { return undefined; }
}
function httpError(status: number, code?: number) {
  if (status === 402 || code === 5035) return new WritingConfigurationError("Cloudflare requested a paid plan or billing. Caption analysis stopped; do not upgrade or add payment details.");
  if (status === 401 || status === 403) return new WritingConfigurationError("Cloudflare rejected caption access. Check the token, Workers AI permissions and Account ID in Writing settings.");
  if (status === 404) return new WritingConfigurationError("The exact Cloudflare caption model is unavailable. No replacement or paid model was selected.");
  if ([408, 425, 500, 502, 503, 504].includes(status)) return new CloudflareVisionRetryError(`Cloudflare caption analysis is temporarily unavailable (HTTP ${status}). The video is retained.`);
  return new Error(`Cloudflare rejected caption analysis (HTTP ${status}). Check the caption setup; no generic copy was substituted.`);
}
/** Exact-model, read-only probe. Does not send frames, accept terms or verify billing. */
export async function probeCloudflareVision(settings: WritingSettings): Promise<{ state: "ready" | "offline" | "blocked"; detail: string }> {
  try { assertSettings(settings); }
  catch (error) { return { state: "blocked", detail: (error as Error).message }; }
  try {
    const response = await fetch(`${base}${settings.accountId}/ai/models/search?search=${encodeURIComponent(VISION_CLOUDFLARE_MODEL)}`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { state: "blocked", detail: httpError(response.status, await errorCode(response)).message };
    const data = await boundedJson(response) as { success?: boolean; result?: Array<{ name?: string; id?: string }> };
    if (data.success !== true || !data.result?.some(model => model.name === VISION_CLOUDFLARE_MODEL || model.id === VISION_CLOUDFLARE_MODEL)) {
      return { state: "blocked", detail: "Cloudflare did not confirm the exact caption model. No fallback was enabled." };
    }
    return { state: "ready", detail: "Cloudflare caption token and exact model found. Free-plan tier and remaining daily allowance are not API-verified; no frames or inference were sent." };
  } catch { return { state: "offline", detail: "Could not check Cloudflare caption access. Check connectivity; no frames were sent." }; }
}
/** One bounded request containing three chronological JPEG samples; never a full video or a local model. */
export async function requestCloudflareVisual(settings: WritingSettings, images: Buffer[], prompt: string): Promise<unknown> {
  assertSettings(settings);
  if (images.length !== 3 || images.some(image => image.length > 120_000 || image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8)
    || !prompt.trim() || prompt.length > 2_900) throw new Error("Cloudflare captions require three bounded JPEG samples and a bounded text prompt. No images were sent.");
  return withFileLock(privatePath("cloudflare-vision.lock"), async () => {
    const delay = await cloudflareVisionQuotaDelay(settings);
    if (delay) throw new CloudflareVisionQuotaError("Cloudflare's free caption allowance is waiting for reset. The video and saved copy remain available.", delay);
    const current = readCloudflareVideoAnalysisSettings();
    assertSettings(current);
    if (current.apiKey !== settings.apiKey || current.accountId !== settings.accountId || current.model !== settings.model) throw new Error("Cloudflare caption settings changed. No further images were sent.");
    const body = JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: prompt },
      ...images.map(image => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } }))] }],
    response_format: { type: "json_object" }, max_tokens: 900, temperature: 0.4, stream: false });
    if (Buffer.byteLength(body, "utf8") > 512 * 1024) throw new Error("Cloudflare caption request exceeds its 512 KiB limit. No images were sent.");
    const response = await fetch(`${base}${settings.accountId}/ai/run/${VISION_CLOUDFLARE_MODEL}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60_000),
    }).catch(() => { throw new CloudflareVisionRetryError("Could not reach Cloudflare caption analysis. The finished video remains available."); });
    if (response.status === 429) {
      const code = await errorCode(response), now = Date.now(), raw = response.headers.get("retry-after");
      const parsed = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : raw && Number.isFinite(Date.parse(raw)) ? Date.parse(raw) - now : 60_000;
      const retry = Math.max(5_000, Math.min(86_400_000, Number.isFinite(parsed) ? parsed : 60_000));
      const date = new Date(now), reset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
      const until = code === 3036 ? Math.max(reset, now + retry) : now + retry;
      await writeAtomicJson(privatePath("cloudflare-vision-quota.json"), { identity: identity(settings), until });
      throw new CloudflareVisionQuotaError(code === 3036
        ? "Cloudflare's daily free caption allowance is exhausted. It will resume after the UTC reset; no paid or local fallback is used."
        : "Cloudflare caption analysis is rate-limited. It will resume automatically; the video stays available.", Math.min(86_400_000, until - now));
    }
    if (!response.ok) throw httpError(response.status, await errorCode(response));
    const data = await boundedJson(response) as { success?: boolean; result?: { response?: unknown; tool_calls?: unknown[] } };
    if (data.success !== true || data.result?.tool_calls?.length) throw new CloudflareVisionRetryError("Cloudflare did not return a final caption answer. No copy was accepted.");
    const raw = data.result?.response;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) throw new CloudflareVisionRetryError("Cloudflare returned an incomplete caption answer. No copy was accepted.");
    try { return JSON.parse(raw); }
    catch { throw new CloudflareVisionRetryError("Cloudflare returned invalid caption JSON. No generic copy was substituted."); }
  }, { timeoutMs: 1_000, staleMs: 180_000 }).catch(error => {
    if (error instanceof Error && error.message === "Timed out waiting for local store lock: cloudflare-vision.lock") throw new WritingWaitError("Another Cloudflare caption request is finishing. This analysis will resume automatically.", 60_000);
    throw error;
  });
}
