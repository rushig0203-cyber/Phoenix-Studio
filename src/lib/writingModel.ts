import { AsyncLocalStorage } from "node:async_hooks";
import { generateLocalModel, withLocalWritingSession, type LocalGenerateBody } from "./localModelSession";
import { isLocalModelResourceWaitError, LocalModelConfigurationError } from "./localModelResources";
import { readWritingSettings, readVideoAnalysisSettings, readCloudflareWriterSettings, type WritingSettings } from "./writingSettings";
import { generateGroqText, groqWriterQuotaDelay, WritingConfigurationError, WritingWaitError, WritingQuotaWaitError } from "./groqWriter";
import { generateCloudflareText, cloudflareWriterQuotaDelay } from "./cloudflareWriter";
import { HeavyWorkWaitError } from "./renderResources";

type SessionOptions = { model?: string; baseUrl?: string; signal?: AbortSignal; expectedIdentity?: string };
const context = new AsyncLocalStorage<{ settings: WritingSettings; backup?: WritingSettings; signal?: AbortSignal; closed: boolean }>();
export { WritingQuotaWaitError } from "./groqWriter";
function backupWriter(settings: WritingSettings) {
  if (settings.provider === "ollama") return undefined;
  const backup = settings.provider === "groq" ? readCloudflareWriterSettings() : readVideoAnalysisSettings();
  return backup.apiKey && backup.freePlanConfirmed && (backup.provider !== "cloudflare" || backup.accountId) ? backup : undefined;
}
const sameSettings = (a: WritingSettings, b: WritingSettings) => a.provider === b.provider && a.model === b.model && a.apiKey === b.apiKey && a.accountId === b.accountId && a.freePlanConfirmed === b.freePlanConfirmed;
function policyIdentity(settings: WritingSettings, backup?: WritingSettings) {
  return `${settings.provider}:${settings.model}${backup ? `|free-quota-rotation-v1:${backup.provider}:${backup.model}` : ""}`;
}

/** The declared routing policy fingerprints plans; actual responses retain their provider/model. */
export function writingModelIdentity() {
  const session = context.getStore(), settings = session?.settings ?? readWritingSettings();
  return policyIdentity(settings, session ? session.backup : backupWriter(settings));
}
/** Cache-only eligibility check for Lumina's saved quota waits; never loads a local model. */
export async function writingQuotaDelay() {
  const settings = readWritingSettings();
  if (settings.provider === "ollama") return 0;
  const candidates = [settings, backupWriter(settings)].filter((item): item is WritingSettings => !!item);
  return Math.min(...await Promise.all(candidates.map(item => item.provider === "groq" ? groqWriterQuotaDelay(item) : cloudflareWriterQuotaDelay(item))));
}
type QuotaWaitingJob = { status: string; stage: string; writerQuotaWait?: boolean; archivedAt?: string; nextAttemptAt?: string };
export const isWriterQuotaWaiting = (job: QuotaWaitingJob) => !job.archivedAt && job.status === "QUEUED" && (job.writerQuotaWait === true
  || /^(?:Waiting for (?:Groq's free-plan quota|Cloudflare Workers AI quota)|Groq's free-plan limit|Pacing Groq writing|Cloudflare's daily Free allocation|Cloudflare Workers AI is temporarily rate-limited|Both configured free writers are quota-limited)/.test(job.stage));
export async function writerQuotaBackupReady(jobs: QuotaWaitingJob[]) {
  return jobs.some(job => isWriterQuotaWaiting(job) && Date.parse(job.nextAttemptAt || "") > Date.now()) && await writingQuotaDelay() === 0;
}
export function isWritingWaitError(error: unknown): error is { message: string; retryAfterMs: number } {
  return isLocalModelResourceWaitError(error) || error instanceof WritingWaitError || error instanceof HeavyWorkWaitError;
}
export function isWritingConfigurationError(error: unknown) {
  return error instanceof WritingConfigurationError || error instanceof LocalModelConfigurationError
    || (!!error && typeof error === "object" && "code" in error && ["PHOENIX_WRITING_SETTINGS", "PHOENIX_WRITER_CONFIGURATION"].includes(String(error.code)));
}

/** Keep the configured policy fixed; rotate individual requests only on proven quota waits. */
export async function withWritingSession<T>(work: () => Promise<T>, options: SessionOptions = {}): Promise<T> {
  const nested = context.getStore();
  if (nested) {
    if (nested.closed) throw new Error("The writing session is closed.");
    if (options.expectedIdentity && options.expectedIdentity !== policyIdentity(nested.settings, nested.backup)) throw new WritingConfigurationError("Writing settings changed before planning. Retry to use the selected writer safely.");
    options.signal?.throwIfAborted(); return work();
  }
  const settings = readWritingSettings();
  const backup = backupWriter(settings);
  // RAM-exempt callers pin the remote identity before entry. Check it before
  // opening any local session, not only once its callback has already started.
  if (options.expectedIdentity && options.expectedIdentity !== policyIdentity(settings, backup)) throw new WritingConfigurationError("Writing settings changed before planning. Retry to use the selected writer safely.");
  const session = { settings, backup, signal: options.signal, closed: false };
  try {
    return await context.run(session, () => settings.provider !== "ollama" ? work()
      : withLocalWritingSession(work, { ...options, model: settings.model }));
  } finally { session.closed = true; }
}

export async function generateWritingModel(body: LocalGenerateBody, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
  const session = context.getStore();
  if (!session) return withWritingSession(() => generateWritingModel(body, options), { signal: options.signal });
  if (session.closed) throw new Error("The writing session is closed.");
  const checkSettings = () => {
    const current = readWritingSettings();
    const currentBackup = backupWriter(current);
    if (!sameSettings(current, session.settings) || (session.backup && (!currentBackup || !sameSettings(currentBackup, session.backup)))) throw new WritingConfigurationError("Writing settings changed during this job. Retry to use the newly selected writing policy; no further request was sent.");
  };
  checkSettings();
  const signals = [session.signal, options.signal].filter((signal): signal is AbortSignal => !!signal);
  const signal = signals.length ? AbortSignal.any(signals) : undefined;
  signal?.throwIfAborted();
  if (session.settings.provider === "ollama") return generateLocalModel({ ...body, model: session.settings.model }, { ...options, signal });
  const waits: WritingQuotaWaitError[] = [];
  for (const candidate of [session.settings, session.backup]) {
    if (!candidate) continue;
    signal?.throwIfAborted(); checkSettings();
    try {
      return await (candidate.provider === "groq" ? generateGroqText(candidate, body, { ...options, signal, beforeRequest: checkSettings })
        : generateCloudflareText(candidate, body, { ...options, signal, beforeRequest: checkSettings }));
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof WritingQuotaWaitError)) throw error;
      waits.push(error);
    }
  }
  if (waits.length === 1) throw waits[0];
  throw new WritingQuotaWaitError("Both configured free writers are quota-limited. Lumina will resume saved work at the earliest reset; no paid provider or local model was started.", Math.min(...waits.map(wait => wait.retryAfterMs)));
}
