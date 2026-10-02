import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { WRITING_GROQ_MODEL, type WritingSettings } from "./writingSettings";
import type { LocalGenerateBody } from "./localModelSession";

const base = "https://api.groq.com/openai/v1/";
const privatePath = (name: string) => path.join(process.cwd(), "storage", "private", name);
const maximumResponseBytes = 1024 * 1024;

export class WritingConfigurationError extends Error {
  readonly code = "PHOENIX_WRITER_CONFIGURATION";
}
export class WritingWaitError extends Error {
  readonly code = "PHOENIX_WRITER_WAIT";
  constructor(message: string, readonly retryAfterMs: number) { super(message); }
}

function assertSettings(settings: WritingSettings) {
  if (settings.provider !== "groq" || settings.model !== WRITING_GROQ_MODEL) {
    throw new WritingConfigurationError("Select the supported Groq writer in Writing settings. No alternative provider was used.");
  }
  if (!settings.freePlanConfirmed) throw new WritingConfigurationError("Confirm your Groq account is on the Free plan in Writing settings. Phoenix cannot verify billing tier from an API key.");
  if (!settings.apiKey || !/^gsk_[A-Za-z0-9_-]{16,250}$/.test(settings.apiKey)) throw new WritingConfigurationError("Add a valid Groq API key in Writing settings. Never paste it in chat.");
}

export async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Groq returned an empty response. Retry the saved job.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maximumResponseBytes) throw new Error("Groq returned an oversized response. No incomplete script was accepted.");
      chunks.push(item.value);
    }
    try { return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")); }
    catch { throw new Error("Groq returned unreadable JSON. No incomplete script was accepted."); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}

/** Only headers, never provider error text (which may echo prompts or secrets). */
export function groqRetryDelay(headers: Headers, now = Date.now()) {
  const value = headers.get("retry-after");
  let delay = value && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000
    : value && Number.isFinite(Date.parse(value)) ? Date.parse(value) - now : 60_000;
  for (const kind of ["requests", "tokens"]) {
    if (headers.get(`x-ratelimit-remaining-${kind}`) !== "0") continue;
    const reset = headers.get(`x-ratelimit-reset-${kind}`) || "";
    if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(reset)) {
      const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
      const total = [...reset.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
      delay = Math.max(delay, total);
    }
  }
  return Math.ceil(Math.max(5000, Math.min(86_400_000, Number.isFinite(delay) ? delay : 60_000)));
}

export function groqHttpError(status: number): Error {
  if ([401, 403].includes(status)) return new WritingConfigurationError("Groq rejected the key or model access. Check the key and Free-plan account in Writing settings; no other provider was contacted.");
  if (status === 402) return new WritingConfigurationError("Groq requested billing. Phoenix stopped; do not add payment details. Check that this account is still on Free.");
  if (status === 404) return new WritingConfigurationError("The configured Groq model is unavailable. No replacement model or paid fallback was selected.");
  if (status === 400 || status === 413 || status === 422) return new Error(`Groq rejected the writing request (HTTP ${status}). The prompt may exceed the account's limits or use an unsupported format. Saved work is retained; no fallback was used.`);
  return new Error(`Groq writing service returned HTTP ${status}. Retry the saved job later; no fallback was used.`);
}
const httpError = groqHttpError;

/** Read-only authentication/model check. It neither generates tokens nor verifies billing tier. */
export async function probeGroqWriter(settings: WritingSettings): Promise<{ state: "ready" | "offline" | "blocked"; detail: string }> {
  try { assertSettings(settings); }
  catch (error) { return { state: "blocked", detail: error instanceof Error ? error.message : "Check Writing settings." }; }
  try {
    const response = await fetch(`${base}models`, { headers: { Authorization: `Bearer ${settings.apiKey}` }, signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { state: "blocked", detail: response.status === 429 ? "Groq is rate-limited. Wait before testing again; no content was generated." : httpError(response.status).message };
    }
    const data = await boundedJson(response) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(data?.data) || !data.data.some(model => model.id === settings.model)) return { state: "blocked", detail: "The key works, but the configured writing model is not available to this account." };
    return { state: "ready", detail: "Groq key and model access verified. No content generated. Billing tier is still your Free-plan confirmation, not API-verified." };
  } catch { return { state: "offline", detail: "Could not confirm Groq connectivity. Check the internet connection and try again. No local model was loaded." }; }
}

type Cooldown = { identity: string; until: number };
type RateWindow = { identity: string; tokens?: number; tokensUntil?: number; requests?: number; requestsUntil?: number };
function resetDuration(value: string | null) {
  if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(value)) return undefined;
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const delay = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)].reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
  return Number.isFinite(delay) && delay > 0 ? Math.min(86400000, delay) : undefined;
}
export function groqRateWindow(headers: Headers, identity: string, now = Date.now()): RateWindow {
  const result: RateWindow = { identity };
  for (const kind of ["tokens", "requests"] as const) {
    const remaining = headers.get(`x-ratelimit-remaining-${kind}`);
    const duration = resetDuration(headers.get(`x-ratelimit-reset-${kind}`));
    if (remaining !== null && /^\d+$/.test(remaining) && Number.isSafeInteger(Number(remaining)) && duration) {
      result[kind] = Number(remaining); result[`${kind}Until`] = now + duration;
    }
  }
  return result;
}
export function groqPacingDelay(window: RateWindow, estimatedTokens: number, now = Date.now()) {
  const tokensUntil = typeof window.tokens === "number" && window.tokens < estimatedTokens ? window.tokensUntil || 0 : 0;
  const requestsUntil = window.requests === 0 ? window.requestsUntil || 0 : 0;
  const until = Math.max(Number.isFinite(tokensUntil) ? tokensUntil : 0, Number.isFinite(requestsUntil) ? requestsUntil : 0);
  return until > now ? Math.min(86400000, Math.max(5000, until - now + 1000)) : 0;
}
function keyIdentity(settings: WritingSettings) { return createHash("sha256").update(`${settings.model}:${settings.apiKey}`).digest("hex"); }

/** Use provider schema enforcement, not just a JSON-looking answer. Never turn
 * optional fields into invented required values to make strict mode work. */
export function groqStructuredFormat(schema: object) {
  const closed = (value: unknown, depth = 0): boolean => {
    if (depth > 20 || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const node = value as Record<string, unknown>;
    if (node.type === "object" || node.properties) {
      const properties = node.properties as Record<string, unknown> | undefined;
      if (!properties || typeof properties !== "object" || Array.isArray(properties) || node.additionalProperties !== false || !Array.isArray(node.required)
        || node.required.length !== Object.keys(properties).length || Object.keys(properties).some(key => !(node.required as unknown[]).includes(key))) return false;
      if (!Object.values(properties).every(child => closed(child, depth + 1))) return false;
    }
    if (node.type === "array" && !closed(node.items, depth + 1)) return false;
    for (const key of ["anyOf", "oneOf", "allOf"]) if (node[key] && (!Array.isArray(node[key]) || !(node[key] as unknown[]).every(child => closed(child, depth + 1)))) return false;
    if (node.$defs && !Object.values(node.$defs as Record<string, unknown>).every(child => closed(child, depth + 1))) return false;
    return true;
  };
  return { type: "json_schema", json_schema: { name: "phoenix_writing", strict: closed(schema), schema } };
}

export async function generateGroqText(settings: WritingSettings, body: LocalGenerateBody, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
  assertSettings(settings);
  options.signal?.throwIfAborted();
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 40_000 || body.images || body.tools || body.messages) throw new Error("Groq writing accepts bounded text prompts only. Images, videos and tools cannot be sent through this adapter.");
  const schema = body.format && typeof body.format === "object" ? body.format : undefined;
  const json = body.format === "json" || !!schema;
  const system = ["You are Phoenix Studio's writing assistant. Return only the requested final answer, never reasoning, process notes or tool calls.",
    typeof body.system === "string" ? body.system : "", json ? `Return a JSON object only.${schema ? ` Follow this JSON schema: ${JSON.stringify(schema)}` : ""}` : ""].filter(Boolean).join("\n");
  if (system.length > 20_000) throw new Error("The writing schema exceeds the bounded request budget.");
  const payload = {
    model: settings.model, messages: [{ role: "system", content: system }, { role: "user", content: body.prompt }],
    stream: false, include_reasoning: false, reasoning_effort: "low",
    temperature: Math.max(0, Math.min(1, Number(body.options?.temperature) || 0.4)),
    max_completion_tokens: Math.max(1536, Math.min(4096, (Number(body.options?.num_predict) || 1500) + 768)),
    ...(schema ? { response_format: groqStructuredFormat(schema) } : json ? { response_format: { type: "json_object" } } : {}),
  };
  const identity = keyIdentity(settings);
  try {
    // The lock serializes bounded TEXT requests across web and worker processes.
    // No model, audio or video memory is allocated here.
    return await withFileLock(privatePath("groq-writer.lock"), async () => {
      options.signal?.throwIfAborted();
      let cooldown: Cooldown | undefined;
      try { cooldown = JSON.parse(await fs.readFile(privatePath("groq-cooldown.json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Groq retry state could not be read. Check local storage; no request was sent."); }
      if (cooldown?.identity === identity && Number.isFinite(cooldown.until) && cooldown.until > Date.now()) throw new WritingWaitError("Waiting for Groq's free-plan quota to reset. Saved work is retained; no local or paid fallback is used.", Math.min(86_400_000, cooldown.until - Date.now()));
      // Use provider-reported remaining capacity before sending the next stage.
      // This is conservative pacing, not a tokenizer or a promise of available quota.
      let rateWindow: RateWindow | undefined;
      try { rateWindow = JSON.parse(await fs.readFile(privatePath("groq-rate-window.json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Groq pacing state could not be read. Check local storage; no request was sent."); }
      const estimatedTokens = Math.ceil(Buffer.byteLength(JSON.stringify(payload.messages), "utf8") / 3) + payload.max_completion_tokens + 64;
      const pacing = rateWindow?.identity === identity ? groqPacingDelay(rateWindow, estimatedTokens) : 0;
      if (pacing) throw new WritingWaitError("Pacing Groq writing to its reported free-plan quota. Saved work will resume at the next automatic check; no local or paid fallback is used.", pacing);
      let response: Response;
      try {
        response = await fetch(`${base}chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` }, body: JSON.stringify(payload),
          redirect: "error", cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(Math.max(1000, Math.min(90_000, options.timeoutMs ?? 90_000))), ...(options.signal ? [options.signal] : [])]),
        });
      } catch { options.signal?.throwIfAborted(); throw new Error("Groq writing was interrupted or timed out. Saved work is retained; no local model or paid fallback was started."); }
      if (response.status === 429) {
        const retryAfterMs = groqRetryDelay(response.headers);
        await response.body?.cancel().catch(() => undefined);
        await writeAtomicJson(privatePath("groq-cooldown.json"), { identity, until: Date.now() + retryAfterMs });
        throw new WritingWaitError("Groq's free-plan limit was reached. Waiting for quota; saved work is retained and no other provider is used.", retryAfterMs);
      }
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw httpError(response.status); }
      const remaining = groqRateWindow(response.headers, identity);
      if (remaining.tokens !== undefined || remaining.requests !== undefined) {
        try { await writeAtomicJson(privatePath("groq-rate-window.json"), remaining); }
        catch { await response.body?.cancel().catch(() => undefined); throw new Error("Could not save Groq pacing state. Saved work is retained; check local storage."); }
      }
      let data: { choices?: Array<{ finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }> };
      try { data = await boundedJson(response) as typeof data; }
      catch { throw new Error("Groq's response was incomplete or unreadable. Saved work is retained; no partial script was accepted."); }
      const choice = data?.choices?.[0];
      if (choice?.finish_reason !== "stop" || choice.message?.refusal || typeof choice.message?.content !== "string" || !choice.message.content.trim()) throw new Error("Groq did not return a complete final answer. Retry the saved job; no truncated script or replacement footage was accepted.");
      if (json) { try { const value = JSON.parse(choice.message.content); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); } catch { throw new Error("Groq returned invalid structured writing. The saved job can be retried; no approval was fabricated."); } }
      // Existing schema/quality validators still run at each pipeline stage.
      return Response.json({ model: settings.model, provider: "groq", response: choice.message.content, done: true, done_reason: "stop" });
    }, { timeoutMs: 10_000, staleMs: 180_000, retryMs: 100 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting for local store lock:")) throw new WritingWaitError("Another writing request is finishing. Saved work will resume without loading a local model.", 15_000);
    throw error;
  }
}
