import { AsyncLocalStorage } from "node:async_hooks";
import {
  configuredLocalModel, inspectLocalModelResources, localOllamaBase, normalizeLocalModelName,
  readLocalModelPresence, LocalModelConfigurationError, LocalModelResourceWaitError,
} from "./localModelResources";
import { retainLocalModelWork, finishLocalModelWork } from "./renderResources";

type SessionOptions = { model?: string; baseUrl?: string; signal?: AbortSignal };
type GenerateOptions = { timeoutMs?: number; signal?: AbortSignal };
export type LocalGenerateBody = Record<string, unknown> & {
  model?: string; prompt?: string; options?: Record<string, unknown>;
};
type Session = {
  model: string; baseUrl: string; signal?: AbortSignal;
  closed: boolean; requests: Promise<unknown>;
  owned: boolean; digest?: string; expiresAtMs?: number;
  retained: boolean;
  requestMayStillBeRunning: boolean;
};

const context = new AsyncLocalStorage<Session>();
let sessionTail: Promise<unknown> = Promise.resolve();
const KEEP_ALIVE_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Preserve the heavy-work reservation when an HTTP timeout leaves backend work unknown. */
export class LocalModelSessionUncertainError extends LocalModelResourceWaitError {
  readonly localModelStateUncertain = true;
  constructor(readonly model: string, readonly baseUrl: string,
    readonly phoenixOwned: boolean, readonly requestMayStillBeRunning: boolean) {
    super("Waiting for the local writer to release memory. Its final state could not be confirmed; rendering must not overlap it. The saved job is retained.", "probe-unavailable");
    this.name = "LocalModelSessionUncertainError";
  }
}

export function isLocalModelSessionUncertainError(error: unknown): error is LocalModelSessionUncertainError {
  return !!error && typeof error === "object" && "localModelStateUncertain" in error
    && error.localModelStateUncertain === true && "model" in error && typeof error.model === "string"
    && "baseUrl" in error && typeof error.baseUrl === "string";
}

function identity(options: SessionOptions) {
  return { model: configuredLocalModel(options.model), baseUrl: localOllamaBase(options.baseUrl ?? "http://127.0.0.1:11434").origin };
}
function abortIfNeeded(signal?: AbortSignal) { signal?.throwIfAborted(); }
function combinedSignal(timeoutMs: number, ...signals: Array<AbortSignal | undefined>) {
  return AbortSignal.any([AbortSignal.timeout(timeoutMs), ...signals.filter((signal): signal is AbortSignal => !!signal)]);
}

async function boundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error("Local writer response exceeded its bounded text budget.");
      chunks.push(item.value);
    }
    return Buffer.concat(chunks, length).toString("utf8");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

/**
 * Sessions share one runner across brief, narration, editorial and shot planning.
 * Callers must still own Phoenix's cross-process heavy-work lease. This in-process
 * lock serializes requests and cannot reserve Ollama against unrelated clients.
 * A runner present before our first request is borrowed and NEVER unloaded here.
 */
export async function withLocalWritingSession<T>(work: () => Promise<T>, options: SessionOptions = {}): Promise<T> {
  const nested = context.getStore();
  if (nested) {
    if (nested.closed) throw new Error("The local writing session is already closed.");
    const requested = identity({ model: options.model ?? nested.model, baseUrl: options.baseUrl ?? nested.baseUrl });
    if (normalizeLocalModelName(requested.model) !== normalizeLocalModelName(nested.model) || requested.baseUrl !== nested.baseUrl) {
      throw new LocalModelConfigurationError("A nested writing stage cannot switch local models or servers.");
    }
    abortIfNeeded(options.signal); abortIfNeeded(nested.signal);
    return work();
  }
  const selected = identity(options);
  abortIfNeeded(options.signal);
  const predecessor = sessionTail;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  sessionTail = predecessor.catch(() => undefined).then(() => gate);
  // Do not let a cancelled waiter release a predecessor's lock.
  let removeAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (!options.signal) return;
    const listener = () => reject(options.signal!.reason);
    options.signal.addEventListener("abort", listener, { once: true });
    removeAbort = () => options.signal!.removeEventListener("abort", listener);
  });
  try { await Promise.race([predecessor, aborted]); }
  catch (error) { void predecessor.finally(release); throw error; }
  finally { removeAbort(); }
  const session: Session = { ...selected, signal: options.signal, closed: false,
    owned: false, retained: false, requestMayStillBeRunning: false, requests: Promise.resolve() };
  try {
    abortIfNeeded(options.signal);
    return await context.run(session, async () => {
      try { return await work(); }
      finally {
        // Also await a accidentally-unawaited request before releasing the runner.
        await session.requests.catch(() => undefined);
        session.closed = true;
        await finishSession(session);
      }
    });
  } finally { session.closed = true; release(); }
}

/** A completed response is buffered before return so consumption cannot outlive the session. */
export async function generateLocalModel(body: LocalGenerateBody, options: GenerateOptions = {}): Promise<Response> {
  const session = context.getStore();
  if (!session) return withLocalWritingSession(() => generateLocalModel(body, options), { model: body.model, signal: options.signal });
  if (session.closed) throw new Error("Local generation was attempted after its writing session closed.");
  const requestedModel = configuredLocalModel(body.model ?? session.model);
  if (normalizeLocalModelName(requestedModel) !== normalizeLocalModelName(session.model)) {
    throw new LocalModelConfigurationError("All writing stages in a session must use the configured local model.");
  }
  const request = session.requests.then(() => generateInSession(session, body, options));
  session.requests = request.catch(() => undefined);
  return request;
}

async function generateInSession(session: Session, body: LocalGenerateBody, options: GenerateOptions): Promise<Response> {
  abortIfNeeded(session.signal); abortIfNeeded(options.signal);
  if (session.requestMayStillBeRunning) throw uncertainty(session);
  const contextTokens = typeof body.options?.num_ctx === "number" ? body.options.num_ctx : 4096;
  const { presence } = await inspectLocalModelResources({ model: session.model, baseUrl: session.baseUrl, contextTokens });
  if (presence.wasResident && session.owned && (presence.residentDigest !== session.digest
    || (Number.isFinite(presence.residentExpiresAtMs) && Number.isFinite(session.expiresAtMs)
      && presence.residentExpiresAtMs! > session.expiresAtMs! + 1000))) {
    // Changed model/version or an outside keep-alive extension: relinquish ownership.
    session.owned = false;
  }
  if (!presence.wasResident) {
    if (!presence.installedDigest) throw new LocalModelResourceWaitError(
      "Waiting for the local writer's installed identity before loading it; Phoenix must be able to identify its own runner for cleanup.", "probe-unavailable");
    session.owned = true; session.digest = presence.installedDigest;
  }
  const timeoutMs = Math.max(1000, Math.min(240_000, options.timeoutMs ?? 180_000));
  const remaining = Number.isFinite(presence.residentExpiresAtMs) ? Math.max(0, presence.residentExpiresAtMs! - Date.now()) : undefined;
  if (!session.owned && remaining === undefined) throw new LocalModelResourceWaitError(
    "Waiting for the existing local writer's lifetime to be known; Phoenix will not shorten or pin another client's model session.", "probe-unavailable");
  // A borrowed model's existing expiry must not be shortened by our request.
  const keepAlive = session.owned ? KEEP_ALIVE_MS / 1000
    : remaining! > 365 * 24 * 60 * 60 * 1000 ? -1 : Math.ceil((Math.max(KEEP_ALIVE_MS, remaining!) + timeoutMs) / 1000);
  await retainLocalModelWork({ model: session.model, baseUrl: session.baseUrl });
  session.retained = true;
  session.requestMayStillBeRunning = true;
  const response = await fetch(new URL("/api/generate", session.baseUrl), {
    method: "POST", redirect: "error", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model: session.model, stream: false, keep_alive: keepAlive,
      options: { ...body.options, num_ctx: contextTokens, num_thread: Math.max(1, Math.min(2, Number(body.options?.num_thread) || 2)), num_batch: 128 } }),
    signal: combinedSignal(timeoutMs, session.signal, options.signal),
  });
  const text = await boundedBody(response);
  if (response.ok) {
    let result: unknown;
    try { result = JSON.parse(text); } catch { throw uncertainty(session); }
    if (!result || typeof result !== "object" || !("done" in result) || result.done !== true) throw uncertainty(session);
  }
  // An HTTP error response is terminal too; callers retain their actionable message.
  session.requestMayStillBeRunning = false;
  if (session.owned) {
    const current = await readLocalModelPresence({ model: session.model, baseUrl: session.baseUrl });
    if (current.wasResident && current.residentDigest === session.digest) session.expiresAtMs = current.residentExpiresAtMs;
    else session.owned = false;
  }
  return new Response(text, { status: response.status, statusText: response.statusText,
    headers: { "Content-Type": response.headers.get("content-type") || "application/json" } });
}

function uncertainty(session: Session) {
  return new LocalModelSessionUncertainError(session.model, session.baseUrl, session.owned, session.requestMayStillBeRunning);
}

async function finishSession(session: Session) {
  // Cache hits and rejected admission have not reserved or loaded any runner.
  if (!session.retained) return;
  if (!session.owned) {
    if (session.requestMayStillBeRunning) throw uncertainty(session);
    await finishLocalModelWork({ model: session.model, baseUrl: session.baseUrl });
    return;
  }
  try {
    const current = await readLocalModelPresence({ model: session.model, baseUrl: session.baseUrl });
    if (!current.wasResident && !session.requestMayStillBeRunning) {
      await finishLocalModelWork({ model: session.model, baseUrl: session.baseUrl });
      return;
    }
    if (current.wasResident && (!session.digest || current.residentDigest !== session.digest
      || (Number.isFinite(current.residentExpiresAtMs) && Number.isFinite(session.expiresAtMs)
        && current.residentExpiresAtMs! > session.expiresAtMs! + 1000))) {
      // It has changed or another client extended it: it is no longer ours to stop.
      if (session.requestMayStillBeRunning) throw uncertainty(session);
      await finishLocalModelWork({ model: session.model, baseUrl: session.baseUrl });
      return;
    }
    const response = await fetch(new URL("/api/generate", session.baseUrl), {
      method: "POST", redirect: "error", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: session.model, stream: false, keep_alive: 0 }),
      // Cleanup must run even if the user's writing request was cancelled.
      signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
    });
    const result = JSON.parse(await boundedBody(response));
    if (!response.ok || result?.done !== true || result.done_reason !== "unload") throw uncertainty(session);
    const after = await readLocalModelPresence({ model: session.model, baseUrl: session.baseUrl });
    if (after.wasResident) throw uncertainty(session);
    session.requestMayStillBeRunning = false;
    session.owned = false;
    await finishLocalModelWork({ model: session.model, baseUrl: session.baseUrl });
  } catch { throw uncertainty(session); }
}
