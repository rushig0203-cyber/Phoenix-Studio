import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { WRITING_CLOUDFLARE_MODEL, type WritingSettings } from "./writingSettings";
import type { LocalGenerateBody } from "./localModelSession";
import { WritingConfigurationError, WritingWaitError, WritingOutputValidationError } from "./groqWriter";

const api = "https://api.cloudflare.com/client/v4/";
const privatePath = (name: string) => path.join(process.cwd(), "storage", "private", name);
const maximumResponseBytes = 1024 * 1024;
type Cooldown = { identity: string; until: number };

function assertSettings(settings: WritingSettings) {
  if (settings.provider !== "cloudflare" || settings.model !== WRITING_CLOUDFLARE_MODEL) throw new WritingConfigurationError("Select the supported Cloudflare Workers AI writer in Writing settings. No alternative provider was used.");
  if (!settings.freePlanConfirmed) throw new WritingConfigurationError("Confirm your Cloudflare Workers AI account is on the Free plan in Writing settings. Phoenix cannot verify billing tier.");
  if (!settings.apiKey || settings.apiKey.startsWith("gsk_") || !/^[A-Za-z0-9_-]{20,250}$/.test(settings.apiKey) || !settings.accountId || !/^[a-fA-F0-9]{32}$/.test(settings.accountId)) throw new WritingConfigurationError("Add a valid Cloudflare API token and 32-character Account ID in Writing settings.");
}
function accountPath(settings: WritingSettings, endpoint: string) {
  return `${api}accounts/${settings.accountId}/ai/${endpoint}`;
}
function identity(settings: WritingSettings) {
  return createHash("sha256").update(`${settings.accountId}:${settings.model}:${settings.apiKey}`).digest("hex");
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Cloudflare returned an empty response. Retry the saved job.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > maximumResponseBytes) throw new Error("Cloudflare returned an oversized response. No incomplete script was accepted.");
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
    catch { throw new Error("Cloudflare returned unreadable JSON. No incomplete script was accepted."); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}

function retryDelay(headers: Headers, now = Date.now()) {
  const value = headers.get("retry-after");
  const ms = value && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000
    : value && Number.isFinite(Date.parse(value)) ? Date.parse(value) - now : 60_000;
  return Math.ceil(Math.max(5_000, Math.min(86_400_000, Number.isFinite(ms) ? ms : 60_000)));
}
function nextUtcReset(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
async function errorCode(response: Response): Promise<string | number | undefined> {
  try {
    const data = await boundedJson(response) as { errors?: Array<{ code?: string | number }>; error?: { code?: string | number } };
    return data?.errors?.[0]?.code ?? data?.error?.code;
  } catch { await response.body?.cancel().catch(() => undefined); return undefined; }
}
function httpError(status: number, code?: string | number): Error {
  if (status === 402) return new WritingConfigurationError("Cloudflare requested billing. Phoenix stopped; do not add payment details or upgrade. Check that Workers AI remains on Free.");
  if (status === 401 || status === 403) return new WritingConfigurationError(code === 5035 || code === "5035"
    ? "This Cloudflare model requires a Workers Paid plan or is not enabled for this account. Phoenix stopped; no paid fallback was selected."
    : "Cloudflare rejected the token, permissions, account or model access. Check the Workers AI token and Account ID; no other provider was contacted.");
  if (status === 404) return new WritingConfigurationError("The configured Cloudflare model is unavailable. No replacement model or paid fallback was selected.");
  if (status === 400 || status === 413 || status === 422) return new Error(`Cloudflare rejected the text-writing request (HTTP ${status}). Saved work is retained; no fallback was used.`);
  return new Error(`Cloudflare Workers AI returned HTTP ${status}. Retry the saved job later; no fallback was used.`);
}

/** Read-only model availability probe; it does not generate tokens or verify billing tier/quota. */
export async function probeCloudflareWriter(settings: WritingSettings): Promise<{ state: "ready" | "offline" | "blocked"; detail: string }> {
  try { assertSettings(settings); }
  catch (error) { return { state: "blocked", detail: error instanceof Error ? error.message : "Check Writing settings." }; }
  try {
    const url = new URL(accountPath(settings, `models/search?search=${encodeURIComponent(settings.model)}`));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${settings.apiKey}` }, signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" });
    if (!response.ok) { const code = await errorCode(response); return { state: "blocked", detail: httpError(response.status, code).message }; }
    const data = await boundedJson(response) as { success?: boolean; result?: Array<Record<string, unknown>> };
    const exact = Array.isArray(data?.result) && data.result.some(model => model.name === settings.model || model.id === settings.model);
    if (data?.success !== true || !exact) return { state: "blocked", detail: "The token works, but the exact Cloudflare writing model was not confirmed for this account." };
    return { state: "ready", detail: "Cloudflare token and exact model availability verified. No content generated; Free-plan tier and remaining daily quota are not API-verified." };
  } catch { return { state: "offline", detail: "Could not confirm Cloudflare connectivity. Check the internet connection and try again. No inference was sent." }; }
}

/** Text-only Workers AI adapter. Cloudflare JSON mode is a formatting aid; Phoenix validates every stage itself. */
export async function generateCloudflareText(settings: WritingSettings, body: LocalGenerateBody, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
  assertSettings(settings); options.signal?.throwIfAborted();
  const extras = body as Record<string, unknown>;
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 40_000 || body.images || body.tools || body.messages
    || ["url", "urls", "endpoint", "baseUrl", "image", "video", "audio"].some(key => key in extras)) {
    throw new Error("Cloudflare writing accepts bounded text prompts only. Images, media, tools, URLs and endpoint overrides are not accepted.");
  }
  const schema = body.format && typeof body.format === "object" ? body.format : undefined;
  const json = body.format === "json" || !!schema;
  const system = ["You are Phoenix Studio's writing assistant. Return only the requested final answer, never reasoning, process notes or tool calls.",
    typeof body.system === "string" ? body.system : "", json ? `Return a JSON object only.${schema ? ` Follow this JSON schema: ${JSON.stringify(schema)}` : ""}` : ""].filter(Boolean).join("\n");
  if (system.length > 20_000) throw new Error("The writing schema exceeds the bounded request budget.");
  const payload = { messages: [{ role: "system", content: system }, { role: "user", content: body.prompt }], stream: false,
    temperature: Math.max(0, Math.min(1, Number(body.options?.temperature) || 0.4)), max_tokens: Math.max(1536, Math.min(4096, (Number(body.options?.num_predict) || 1500) + 768)),
    ...(schema ? { response_format: { type: "json_schema", json_schema: schema } } : json ? { response_format: { type: "json_object" } } : {}) };
  const keyId = identity(settings);
  try {
    return await withFileLock(privatePath("cloudflare-writer.lock"), async () => {
      options.signal?.throwIfAborted();
      let cooldown: Cooldown | undefined;
      try { cooldown = JSON.parse(await fs.readFile(privatePath("cloudflare-writer-cooldown.json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cloudflare retry state could not be read. Check local storage; no request was sent."); }
      if (cooldown?.identity === keyId && Number.isFinite(cooldown.until) && cooldown.until > Date.now()) throw new WritingWaitError("Waiting for Cloudflare Workers AI quota or capacity. Saved work is retained; no local or paid fallback is used.", Math.min(86_400_000, cooldown.until - Date.now()));
      let response: Response;
      try {
        response = await fetch(accountPath(settings, `run/${settings.model}`), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
          body: JSON.stringify(payload), redirect: "error", cache: "no-store",
          signal: AbortSignal.any([AbortSignal.timeout(Math.max(1000, Math.min(240_000, options.timeoutMs ?? 90_000))), ...(options.signal ? [options.signal] : [])]) });
      } catch { options.signal?.throwIfAborted(); throw new Error("Cloudflare writing was interrupted or timed out. Saved work is retained; no local or paid fallback was started."); }
      if (response.status === 429) {
        const code = await errorCode(response);
        const retryAfter = retryDelay(response.headers);
        const until = code === 3036 || code === "3036" ? Math.max(nextUtcReset(), Date.now() + retryAfter) : Date.now() + retryAfter;
        await writeAtomicJson(privatePath("cloudflare-writer-cooldown.json"), { identity: keyId, until });
        throw new WritingWaitError(code === 3036 || code === "3036"
          ? "Cloudflare's daily Free allocation is exhausted. Waiting until the next UTC reset; saved work is retained and no other provider is used."
          : "Cloudflare Workers AI is temporarily rate-limited or out of capacity. Waiting before retry; saved work is retained and no other provider is used.", Math.min(86_400_000, Math.max(5_000, until - Date.now())));
      }
      if (!response.ok) throw httpError(response.status, await errorCode(response));
      const data = await boundedJson(response) as { success?: boolean; result?: { response?: unknown } };
      // Cloudflare's documented native JSON mode can return response as an
      // object rather than a JSON string. Normalize only structured requests;
      // never turn arbitrary partial/provider metadata into narration.
      const raw = data?.result?.response;
      const content = json && raw && typeof raw === "object" && !Array.isArray(raw) ? JSON.stringify(raw) : raw;
      if (data?.success !== true || typeof content !== "string" || !content.trim()) throw new Error("Cloudflare did not return a complete final answer. Retry the saved job; no partial script was accepted.");
      if (json) {
        try { const parsed = JSON.parse(content); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); }
        catch { throw new WritingOutputValidationError("Cloudflare returned invalid structured writing. Saved work is retained; no approval or replacement script was accepted."); }
      }
      return Response.json({ model: settings.model, provider: "cloudflare", response: content, done: true, done_reason: "stop" });
    }, { timeoutMs: 10_000, staleMs: 300_000, retryMs: 100 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting for local store lock:")) throw new WritingWaitError("Another writing request is finishing. Saved work will resume without loading a local model.", 15_000);
    throw error;
  }
}
