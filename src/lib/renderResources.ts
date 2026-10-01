import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { configuredLocalModel, localOllamaBase, readLocalModelPresence } from "./localModelResources";

export type HeavyLease = {
  version: 1; token: string; pid: number; kind: string; acquiredAt: string; heartbeatAt: string;
  childPids?: number[];
  ownerReleased?: boolean;
  external?: { jobId: string; taskId?: string; submittedAt: string; checkedAt?: string; error?: string };
  localModel?: { model: string; baseUrl: string; submittedAt: string; detached?: boolean; error?: string };
};
const directory = () => path.join(process.cwd(), "storage", "Phoenix Studio Review Files");
const leasePath = () => path.join(directory(), "heavy-work-lease.json");
const context = new AsyncLocalStorage<string>();
const minimumFreeBytes = () => Math.max(256, Math.min(1024, Number(process.env.PHOENIX_MIN_FREE_MB) || 512)) * 1024 * 1024;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function readHeavyLease(): Promise<HeavyLease | null> {
  try {
    const value = JSON.parse(await fs.readFile(leasePath(), "utf8"));
    if (value === null) return null;
    const invalid = () => new Error("Invalid heavy-work lease; inspect studio diagnostics before starting another render.");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    if (value.version !== 1 || typeof value.token !== "string" || !value.token || !Number.isInteger(value.pid) || value.pid <= 0
      || typeof value.kind !== "string" || !Number.isFinite(Date.parse(value.acquiredAt)) || !Number.isFinite(Date.parse(value.heartbeatAt))
      || (value.ownerReleased !== undefined && typeof value.ownerReleased !== "boolean")
      || (value.childPids !== undefined && (!Array.isArray(value.childPids) || value.childPids.some((pid: unknown) => !Number.isInteger(pid) || Number(pid) <= 0)))) throw invalid();
    if (value.external !== undefined && (!value.external || typeof value.external.jobId !== "string" || !value.external.jobId || !Number.isFinite(Date.parse(value.external.submittedAt))
      || (value.external.taskId !== undefined && (typeof value.external.taskId !== "string" || !value.external.taskId)))) throw invalid();
    if (value.localModel !== undefined && (!value.localModel || typeof value.localModel.model !== "string" || !value.localModel.model
      || typeof value.localModel.baseUrl !== "string" || !Number.isFinite(Date.parse(value.localModel.submittedAt))
      || (value.localModel.detached !== undefined && typeof value.localModel.detached !== "boolean"))) throw invalid();
    if (value?.localModel) { configuredLocalModel(value.localModel.model); localOllamaBase(value.localModel.baseUrl); }
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function mutateLease<T>(change: (lease: HeavyLease | null) => { lease: HeavyLease | null; result: T }) {
  return withFileLock(`${leasePath()}.lock`, async () => {
    const current = await readHeavyLease();
    const updated = change(current);
    if (JSON.stringify(current) !== JSON.stringify(updated.lease)) await writeAtomicJson(leasePath(), updated.lease);
    return updated.result;
  });
}

function alive(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }

export async function heavyWorkStatus() {
  const lease = await readHeavyLease();
  const freeBytes = os.freemem(), reserveBytes = minimumFreeBytes();
  return { lease, freeBytes, reserveBytes, waitingForMemory: freeBytes < reserveBytes,
    reason: lease?.localModel?.detached ? lease.localModel.error || "Waiting for the local writer to release memory safely"
      : lease?.external ? lease.external.error || "Waiting for the existing stock renderer task to finish" : lease ? `${lease.kind} is using the heavy-work slot` : freeBytes < reserveBytes ? "Waiting for free memory; no other apps were closed" : "Heavy-work slot available" };
}

async function acquire(kind: string) {
  if (context.getStore()) throw new Error("Nested heavy-work admission would deadlock. Reuse the current operation's reservation.");
  await reconcileLocalModelWork();
  // Recover reservations from older workers or a crash between task persistence
  // and lease persistence. Terminal observations are recorded on the job itself.
  let legacy: { id: string; providerTaskId: string; startedAt?: string } | undefined;
  try {
    const jobs = JSON.parse(await fs.readFile(path.join(directory(), "ai-creation-jobs.json"), "utf8"));
    legacy = jobs.find((job: { status: string; providerTaskId?: string; resourceReleasedTaskId?: string }) => ["RUNNING", "FAILED"].includes(job.status) && job.providerTaskId && job.providerTaskId !== job.resourceReleasedTaskId);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return mutateLease<HeavyLease | null>(lease => {
    // Timeouts alone never prove an external renderer stopped. Its reservation
    // survives worker crashes until reconciliation observes terminal task state.
    if (lease && (lease.external || lease.localModel || (!lease.ownerReleased && alive(lease.pid)) || lease.childPids?.some(alive))) return { lease, result: null };
    if (legacy) {
      const now = new Date().toISOString();
      return { lease: { version: 1, token: crypto.randomUUID(), pid: process.pid, kind: "Recovering stock renderer", acquiredAt: now, heartbeatAt: now, external: { jobId: legacy.id, taskId: legacy.providerTaskId, submittedAt: legacy.startedAt || now } }, result: null };
    }
    if (os.freemem() < minimumFreeBytes()) return { lease: null, result: null };
    const now = new Date().toISOString();
    const next: HeavyLease = { version: 1, token: crypto.randomUUID(), pid: process.pid, kind, acquiredAt: now, heartbeatAt: now };
    return { lease: next, result: next };
  });
}

/** Persist before dispatch: a lost HTTP response must not admit a competing render. */
export async function retainLocalModelWork(model: { model: string; baseUrl: string }) {
  const token = context.getStore();
  if (!token) return;
  configuredLocalModel(model.model); localOllamaBase(model.baseUrl);
  await mutateLease(lease => {
    if (!lease || lease.token !== token) throw new Error("Writing lost its heavy-work reservation before dispatch.");
    return { lease: { ...lease, localModel: { ...model, submittedAt: new Date().toISOString() } }, result: undefined };
  });
}

export async function finishLocalModelWork(model: { model: string; baseUrl: string }) {
  const token = context.getStore();
  if (!token) return;
  await mutateLease(lease => ({ lease: lease?.token === token && lease.localModel?.model === model.model && lease.localModel.baseUrl === model.baseUrl
    ? { ...lease, localModel: undefined } : lease, result: undefined }));
}

/** No timeout or process exit proves model absence. Probe only abandoned sessions. */
export async function reconcileLocalModelWork() {
  const observed = await readHeavyLease();
  if (!observed?.localModel || (!observed.localModel.detached && alive(observed.pid))) return;
  let absent = false;
  try { absent = !(await readLocalModelPresence(observed.localModel)).wasResident; }
  catch { /* An unreachable writer retains its reservation. */ }
  await mutateLease(current => {
    if (current?.token !== observed.token || current.localModel?.submittedAt !== observed.localModel?.submittedAt) return { lease: current, result: undefined };
    if (absent && !current.external && !current.childPids?.some(alive)) return { lease: null, result: undefined };
    return { lease: { ...current, localModel: { ...current.localModel!, detached: true, error: "Waiting for the local writer to release memory; no overlapping render was started." } }, result: undefined };
  });
}

/** Call immediately BEFORE sending a request that may start a Python render. */
export async function retainExternalRender(jobId: string, taskId?: string) {
  const token = context.getStore();
  if (!token) throw new Error("Stock submission requires the shared heavy-work lease.");
  await mutateLease(lease => {
    if (!lease || lease.token !== token) throw new Error("Heavy-work ownership changed; stock submission was stopped.");
    return { lease: { ...lease, external: { jobId, taskId, submittedAt: lease.external?.submittedAt || new Date().toISOString() } }, result: undefined };
  });
}

export async function finishExternalRender(jobId: string, taskId?: string) {
  return mutateLease(lease => ({ lease: lease?.external?.jobId === jobId && (!taskId || !lease.external.taskId || lease.external.taskId === taskId) ? null : lease, result: undefined }));
}

export type ExternalObservation = { state: "running" | "terminal" | "unknown"; taskId?: string; error?: string };
export async function reconcileHeavyLease(probe: (external: NonNullable<HeavyLease["external"]>) => Promise<ExternalObservation>) {
  const observed = await readHeavyLease();
  if (!observed?.external) return;
  let result: ExternalObservation;
  try { result = await probe(observed.external); }
  catch { result = { state: "unknown", error: "Renderer cannot be reached; its reserved slot was retained to avoid overlapping work." }; }
  await mutateLease(current => {
    if (!current?.external || current.token !== observed.token || current.external.taskId !== observed.external?.taskId
      || current.external.submittedAt !== observed.external?.submittedAt) return { lease: current, result: undefined };
    if (result.state === "terminal") return { lease: null, result: undefined };
    return { lease: { ...current, external: { ...current.external, taskId: result.taskId || current.external.taskId, checkedAt: new Date().toISOString(), error: result.error } }, result: undefined };
  });
}

async function runWithLease<T>(lease: HeavyLease, operation: () => Promise<T>) {
  const heartbeat = setInterval(() => void mutateLease(current => ({ lease: current?.token === lease.token ? { ...current, heartbeatAt: new Date().toISOString() } : current, result: undefined })).catch(() => undefined), 10_000);
  heartbeat.unref();
  try { return await context.run(lease.token, operation); }
  finally {
    clearInterval(heartbeat);
    await mutateLease(current => ({ lease: current?.token !== lease.token ? current
      : current.localModel ? { ...current, ownerReleased: true, localModel: { ...current.localModel, detached: true } }
      : current.external || current.childPids?.some(alive) ? { ...current, ownerReleased: true } : null, result: undefined }));
  }
}

/** Non-blocking admission keeps backend polling alive while its slot is held. */
export async function tryWithLocalRenderSlot<T>(operation: () => Promise<T>, kind = "Video creation"): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const lease = await acquire(kind);
  return lease ? { acquired: true, value: await runWithLease(lease, operation) } : { acquired: false };
}

function configuredThreads() {
  const value = Number.parseInt(process.env.PHOENIX_RENDER_THREADS || "2", 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(2, value)) : 2;
}

/**
 * Local exports deliberately trade speed for a responsive laptop. Keeping the
 * value here gives every server-side renderer the same hard ceiling.
 */
export const LOCAL_RENDER_THREADS = configuredThreads();
export const FFMPEG_FILTER_RESOURCE_ARGS = [
  "-filter_threads", "1",
  "-filter_complex_threads", "1",
] as const;
export const FFMPEG_ENCODER_RESOURCE_ARGS = [
  "-threads", String(LOCAL_RENDER_THREADS),
] as const;

export function lowerChildProcessPriority(pid?: number) {
  if (!pid) return;
  const token = context.getStore();
  if (token) void mutateLease(lease => ({ lease: lease?.token === token ? { ...lease, childPids: [...new Set([...(lease.childPids || []).filter(alive), pid])] } : lease, result: undefined })).catch(() => undefined);
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Priority is best-effort. FFmpeg still has the explicit thread ceilings.
  }
}

let localRenderTail: Promise<void> = Promise.resolve();

/** Serializes Phoenix's source-video and children's-video render pipelines. */
export async function withLocalRenderSlot<T>(operation: () => Promise<T>, kind = "Local processing", onWait?: (reason: string) => Promise<unknown>): Promise<T> {
  let release: () => void = () => undefined;
  const previous = localRenderTail;
  localRenderTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    let notifiedAt = 0;
    for (;;) {
      const lease = await acquire(kind);
      if (lease) return await runWithLease(lease, operation);
      if (onWait && Date.now() - notifiedAt > 10_000) { notifiedAt = Date.now(); await onWait((await heavyWorkStatus()).reason); }
      await sleep(1000);
    }
  } finally {
    release();
  }
}
