import os from "node:os";

const MiB = 1024 * 1024;
const probeTimeoutMs = 3000;
export const LOCAL_MODEL_RETRY_AFTER_MS = 30_000;

export type LocalModelMemoryEstimate = {
  freeBytes: number;
  reserveBytes: number;
  additionalBytes: number;
  requiredFreeBytes: number;
  deficitBytes: number;
  admitted: boolean;
  resident: boolean;
  contextTokens: number;
};

export class LocalModelResourceWaitError extends Error {
  readonly code = "PHOENIX_LOCAL_MODEL_WAIT";
  readonly retryAfterMs = LOCAL_MODEL_RETRY_AFTER_MS;
  constructor(
    message: string,
    readonly reason: "memory" | "probe-unavailable",
    readonly estimate?: LocalModelMemoryEstimate,
  ) { super(message); this.name = "LocalModelResourceWaitError"; }
}

export function isLocalModelResourceWaitError(error: unknown): error is LocalModelResourceWaitError {
  return error instanceof LocalModelResourceWaitError || (!!error && typeof error === "object"
    && "code" in error && error.code === "PHOENIX_LOCAL_MODEL_WAIT"
    && "reason" in error && ["memory", "probe-unavailable"].includes(String(error.reason))
    && "retryAfterMs" in error && typeof error.retryAfterMs === "number"
    && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0);
}

export class LocalModelConfigurationError extends Error {
  readonly code = "PHOENIX_LOCAL_MODEL_CONFIGURATION";
  constructor(message: string) { super(message); this.name = "LocalModelConfigurationError"; }
}

type ResidentModel = { sizeBytes: number; contextTokens: number; expiresAtMs: number };
type MemoryInput = {
  installedBytes: number;
  freeBytes: number;
  contextTokens?: number;
  reserveBytes?: number;
  resident?: ResidentModel;
  nowMs?: number;
};

function validPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Conservative admission estimate, not a RAM guarantee. On-disk weights are not
 * runtime RAM: budget 15% extra, 256 MiB runtime scratch and 128 KiB/token for
 * context. No speculative GPU/offload or reclaimable-file-cache credit is used.
 * Already-resident compatible context is in os.freemem's accounting, so only
 * transient scratch is added. Context growth may reload the runner; budget the
 * full cold allocation in that case instead of assuming an in-place resize.
 */
export function estimateLocalModelMemory(input: MemoryInput): LocalModelMemoryEstimate {
  const contextTokens = input.contextTokens ?? 4096;
  if (!validPositive(input.installedBytes) || !Number.isFinite(input.freeBytes) || input.freeBytes < 0
    || !Number.isInteger(contextTokens) || contextTokens < 128 || contextTokens > 32768
    || (input.reserveBytes !== undefined && (!Number.isFinite(input.reserveBytes) || input.reserveBytes < 0))) {
    throw new LocalModelConfigurationError("Cannot estimate local writing memory from invalid model size, memory or context settings.");
  }
  const reserveBytes = Math.max(512 * MiB, input.reserveBytes ?? 512 * MiB);
  const resident = !!input.resident && validPositive(input.resident.sizeBytes) && input.resident.sizeBytes >= input.installedBytes
    && Number.isInteger(input.resident.contextTokens) && input.resident.contextTokens >= contextTokens
    && Number.isFinite(input.resident.expiresAtMs) && input.resident.expiresAtMs > (input.nowMs ?? Date.now()) + 10_000;
  const additionalBytes = resident ? 256 * MiB
    : Math.ceil(input.installedBytes * 1.15) + 256 * MiB + contextTokens * 128 * 1024;
  const requiredFreeBytes = additionalBytes + reserveBytes;
  return { freeBytes: input.freeBytes, reserveBytes, additionalBytes, requiredFreeBytes,
    deficitBytes: Math.max(0, requiredFreeBytes - input.freeBytes), admitted: input.freeBytes >= requiredFreeBytes,
    resident, contextTokens };
}

type InventoryModel = {
  name?: unknown; model?: unknown; size?: unknown; digest?: unknown;
  context_length?: unknown; expires_at?: unknown; remote_model?: unknown; remote_host?: unknown;
};

export function normalizeLocalModelName(name: string) { return name.includes(":") ? name : `${name}:latest`; }
function matches(item: InventoryModel, model: string) {
  return [item.name, item.model].some(name => typeof name === "string" && normalizeLocalModelName(name) === normalizeLocalModelName(model));
}

export function localOllamaBase(value: string) {
  let base: URL;
  try { base = new URL(value); } catch { throw new LocalModelConfigurationError("Local writing requires a valid loopback Ollama URL."); }
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new LocalModelConfigurationError("Local writing requires plain HTTP on this PC's loopback service; remote providers are disabled.");
  }
  return base;
}

export function configuredLocalModel(value = process.env.OLLAMA_MODEL ?? "qwen2.5:3b") {
  const model = value.trim();
  if (!model || /(?:[:/-])cloud(?:$|:)/i.test(model)) {
    throw new LocalModelConfigurationError("Choose an installed local writing model; cloud model routing is disabled.");
  }
  return model;
}

async function inventory(base: URL, endpoint: string): Promise<InventoryModel[]> {
  try {
    const response = await fetch(new URL(endpoint, base), {
      method: "GET", signal: AbortSignal.timeout(probeTimeoutMs), redirect: "error", cache: "no-store",
    });
    if (!response.ok) throw new Error("probe-http");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("models" in data) || !Array.isArray(data.models)
      || data.models.some(item => !item || typeof item !== "object")) throw new Error("probe-shape");
    return data.models as InventoryModel[];
  } catch {
    throw new LocalModelResourceWaitError(
      "Waiting for Ollama's local memory inventory. No model was loaded; check the local writing service if this persists.",
      "probe-unavailable",
    );
  }
}

/**
 * Read-only preflight immediately before /api/generate, inside the caller's
 * shared heavy-work lease. No model loading, downloads, unloads or paid calls.
 * This check is not a reservation against other apps; callers must keep their
 * own serialization and must not swallow a resource wait as a creative failure.
 */
export type LocalModelPresence = {
  model: string;
  baseUrl: string;
  installedDigest?: string;
  /** Includes an incompatible/expiring runner: it must not be claimed as ours. */
  wasResident: boolean;
  residentDigest?: string;
  residentExpiresAtMs?: number;
};

/** A fresh, local-only read. Absence, not an expired timestamp, proves no runner. */
export async function readLocalModelPresence(options: { model?: string; baseUrl?: string } = {}): Promise<LocalModelPresence> {
  const model = configuredLocalModel(options.model);
  const base = localOllamaBase(options.baseUrl ?? "http://127.0.0.1:11434");
  const running = await inventory(base, "/api/ps");
  const loaded = running.find(item => matches(item, model));
  return {
    model, baseUrl: base.origin, wasResident: !!loaded,
    residentDigest: typeof loaded?.digest === "string" ? loaded.digest : undefined,
    residentExpiresAtMs: typeof loaded?.expires_at === "string" ? Date.parse(loaded.expires_at) : undefined,
  };
}

/** Admission plus the identity snapshot needed to claim only a Phoenix cold load. */
export async function inspectLocalModelResources(options: {
  model?: string; contextTokens?: number; baseUrl?: string;
} = {}): Promise<{ estimate: LocalModelMemoryEstimate; presence: LocalModelPresence }> {
  const model = configuredLocalModel(options.model);
  const base = localOllamaBase(options.baseUrl ?? "http://127.0.0.1:11434");
  const [installed, running] = await Promise.all([inventory(base, "/api/tags"), inventory(base, "/api/ps")]);
  const selected = installed.find(item => matches(item, model));
  if (!selected) throw new LocalModelConfigurationError("The configured local writing model is not installed. No model was downloaded automatically.");
  if (selected.remote_model || selected.remote_host) throw new LocalModelConfigurationError("Cloud model routing is disabled; choose an installed local writing model.");
  if (!validPositive(selected.size)) throw new LocalModelResourceWaitError("Waiting for a valid local model size before allocating writing memory.", "probe-unavailable");
  const loaded = running.find(item => matches(item, model)
    && (!selected.digest || selected.digest === item.digest));
  const estimate = estimateLocalModelMemory({
    installedBytes: selected.size, freeBytes: os.freemem(), contextTokens: options.contextTokens,
    resident: loaded && validPositive(loaded.size) && validPositive(loaded.context_length) && typeof loaded.expires_at === "string"
      ? { sizeBytes: loaded.size, contextTokens: loaded.context_length, expiresAtMs: Date.parse(loaded.expires_at) } : undefined,
  });
  if (!estimate.admitted) throw new LocalModelResourceWaitError(
    `Waiting for memory before local writing: ${Math.ceil(estimate.requiredFreeBytes / MiB)} MiB free recommended; ${Math.floor(estimate.freeBytes / MiB)} MiB available. Close unused apps; the saved job will retry without using a failure attempt.`,
    "memory", estimate,
  );
  const anyLoaded = running.find(item => matches(item, model));
  return { estimate, presence: {
    model, baseUrl: base.origin,
    installedDigest: typeof selected.digest === "string" ? selected.digest : undefined,
    wasResident: !!anyLoaded,
    residentDigest: typeof anyLoaded?.digest === "string" ? anyLoaded.digest : undefined,
    residentExpiresAtMs: typeof anyLoaded?.expires_at === "string" ? Date.parse(anyLoaded.expires_at) : undefined,
  } };
}

export async function assertLocalModelResources(options: {
  model?: string; contextTokens?: number; baseUrl?: string;
} = {}): Promise<LocalModelMemoryEstimate> {
  return (await inspectLocalModelResources(options)).estimate;
}
