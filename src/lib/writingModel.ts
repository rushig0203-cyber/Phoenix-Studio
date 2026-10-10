import { AsyncLocalStorage } from "node:async_hooks";
import { generateLocalModel, withLocalWritingSession, type LocalGenerateBody } from "./localModelSession";
import { isLocalModelResourceWaitError, LocalModelConfigurationError } from "./localModelResources";
import { readWritingSettings, type WritingSettings } from "./writingSettings";
import { generateGroqText, WritingConfigurationError, WritingWaitError } from "./groqWriter";
import { generateCloudflareText } from "./cloudflareWriter";
import { HeavyWorkWaitError } from "./renderResources";

type SessionOptions = { model?: string; baseUrl?: string; signal?: AbortSignal; expectedIdentity?: string };
const context = new AsyncLocalStorage<{ settings: WritingSettings; signal?: AbortSignal; closed: boolean }>();

/** Provider identity is part of saved brief/editorial fingerprints, never a key. */
export function writingModelIdentity() {
  const settings = context.getStore()?.settings ?? readWritingSettings();
  return `${settings.provider}:${settings.model}`;
}
export function isWritingWaitError(error: unknown): error is { message: string; retryAfterMs: number } {
  return isLocalModelResourceWaitError(error) || error instanceof WritingWaitError || error instanceof HeavyWorkWaitError;
}
export function isWritingConfigurationError(error: unknown) {
  return error instanceof WritingConfigurationError || error instanceof LocalModelConfigurationError
    || (!!error && typeof error === "object" && "code" in error && ["PHOENIX_WRITING_SETTINGS", "PHOENIX_WRITER_CONFIGURATION"].includes(String(error.code)));
}

/** Fix the provider for a logical writing session. Never fall back on failure. */
export async function withWritingSession<T>(work: () => Promise<T>, options: SessionOptions = {}): Promise<T> {
  const nested = context.getStore();
  if (nested) {
    if (nested.closed) throw new Error("The writing session is closed.");
    if (options.expectedIdentity && options.expectedIdentity !== `${nested.settings.provider}:${nested.settings.model}`) throw new WritingConfigurationError("Writing settings changed before planning. Retry to use the selected writer safely.");
    options.signal?.throwIfAborted(); return work();
  }
  const settings = readWritingSettings();
  // RAM-exempt callers pin the remote identity before entry. Check it before
  // opening any local session, not only once its callback has already started.
  if (options.expectedIdentity && options.expectedIdentity !== `${settings.provider}:${settings.model}`) throw new WritingConfigurationError("Writing settings changed before planning. Retry to use the selected writer safely.");
  const session = { settings, signal: options.signal, closed: false };
  try {
    return await context.run(session, () => settings.provider !== "ollama" ? work()
      : withLocalWritingSession(work, { ...options, model: settings.model }));
  } finally { session.closed = true; }
}

export async function generateWritingModel(body: LocalGenerateBody, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
  const session = context.getStore();
  if (!session) return withWritingSession(() => generateWritingModel(body, options), { signal: options.signal });
  if (session.closed) throw new Error("The writing session is closed.");
  const current = readWritingSettings();
  if (current.provider !== session.settings.provider || current.model !== session.settings.model || current.apiKey !== session.settings.apiKey || current.accountId !== session.settings.accountId || current.freePlanConfirmed !== session.settings.freePlanConfirmed) throw new WritingConfigurationError("Writing settings changed during this job. Retry to use the newly selected provider; no mixed-provider plan was created.");
  const signals = [session.signal, options.signal].filter((signal): signal is AbortSignal => !!signal);
  const signal = signals.length ? AbortSignal.any(signals) : undefined;
  signal?.throwIfAborted();
  return session.settings.provider === "groq" ? generateGroqText(session.settings, body, { ...options, signal })
    : session.settings.provider === "cloudflare" ? generateCloudflareText(session.settings, body, { ...options, signal })
      : generateLocalModel({ ...body, model: session.settings.model }, { ...options, signal });
}
