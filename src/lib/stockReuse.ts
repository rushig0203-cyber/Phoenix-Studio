/** Durable source-job history only: no provider requests or separate store. */
export const STOCK_REUSE_POLICY = "four-in-18-months-v1";

export type StockReuseShot = { provider: string; mediaId: string };
export type StockReuseHistoryJob = {
  id: string; status: string; createdAt?: string; finishedAt?: string; archivedAt?: string;
  stockSource?: { provider?: string; mediaId?: string; shots?: readonly StockReuseShot[] };
};

function historyError(detail: string): never {
  throw new Error(`Stock reuse history cannot be verified: ${detail}. No new stock footage was accepted.`);
}

function identity(shot: StockReuseShot) {
  if (!shot || (shot.provider !== "pexels" && shot.provider !== "pixabay") || typeof shot.mediaId !== "string" || !/^\d+$/.test(shot.mediaId)) historyError("a stock source has an invalid provider or media ID");
  const id = Number(shot.mediaId);
  if (!Number.isSafeInteger(id) || id <= 0) historyError("a stock media ID is not a positive safe integer");
  return `${shot.provider}:${id}`;
}

function timestamp(value: string | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) historyError("a relevant UTC timestamp is missing or malformed");
  const parsed = Date.parse(value);
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction || "").padEnd(3, "0")}Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) historyError("a relevant UTC timestamp is invalid");
  return parsed;
}

/** Calendar-month subtraction with UTC day clamping, preserving time/millis. */
function rollingCutoff(now: number) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) historyError("the current time is invalid");
  const cutoff = new Date(now), day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 18);
  const nextMonth = new Date(cutoff);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(0);
  if (!Number.isFinite(cutoff.getTime()) || !Number.isFinite(nextMonth.getTime())) historyError("the current time is outside the usable calendar range");
  cutoff.setUTCDate(Math.min(day, nextMonth.getUTCDate()));
  return cutoff.getTime();
}

/** Archived completions count; active jobs reserve one use regardless of age. */
export function stockReuseBlocked(jobs: readonly StockReuseHistoryJob[], now = Date.now(), excludeJobId?: string): Set<string> {
  const cutoff = rollingCutoff(now), counts = new Map<string, number>(), seenJobs = new Set<string>();
  if (!Array.isArray(jobs)) historyError("the source-job history is not an array");
  if (excludeJobId !== undefined && (typeof excludeJobId !== "string" || !excludeJobId.trim())) historyError("the excluded current job ID is invalid");
  for (const job of jobs) {
    if (!job || typeof job !== "object") historyError("a source-job record is invalid");
    if (job.stockSource === undefined) continue;
    // Validate all stock job IDs before exclusion/released-state filtering: a
    // corrupt duplicate cannot make another completion disappear on retry.
    if (typeof job.id !== "string" || !job.id.trim() || seenJobs.has(job.id)) historyError("a relevant source-job ID is missing or duplicated");
    seenJobs.add(job.id);
  }
  for (const job of jobs) {
    if ((excludeJobId !== undefined && job.id === excludeJobId) || job.stockSource === undefined) continue;
    if (["FAILED", "CANCELLED", "BLOCKED"].includes(job.status)) continue;
    if (!["COMPLETED", "QUEUED", "PROCESSING"].includes(job.status)) historyError("a stock source-job status is invalid");
    const stock = job.stockSource;
    if (!stock || typeof stock !== "object") historyError("a stock source record is invalid");
    const shots = stock.shots === undefined ? [{ provider: stock.provider!, mediaId: stock.mediaId! }] : stock.shots;
    if (!Array.isArray(shots) || !shots.length) historyError("a stock shot list is invalid or empty");
    const identities = new Set(Array.from(shots, identity));
    const relevantTime = job.status === "COMPLETED" ? timestamp(job.finishedAt === undefined ? job.createdAt : job.finishedAt) : timestamp(job.createdAt);
    if (relevantTime > now) historyError("a relevant source-job timestamp is in the future");
    // At the exact 18-month boundary the previous completion has expired.
    if (job.status === "COMPLETED" && relevantTime <= cutoff) continue;
    for (const source of identities) counts.set(source, (counts.get(source) || 0) + 1);
  }
  return new Set([...counts].filter(([, uses]) => uses >= 4).map(([source]) => source));
}

export function assertStockReuseAvailable(shots: readonly StockReuseShot[], jobs: readonly StockReuseHistoryJob[], now = Date.now(), excludeJobId?: string) {
  if (!Array.isArray(shots) || !shots.length) historyError("the requested stock shot list is invalid or empty");
  const selected = new Set(Array.from(shots, identity)), blocked = stockReuseBlocked(jobs, now, excludeJobId);
  if ([...selected].some(source => blocked.has(source))) throw new Error("A selected stock clip has already reached four uses or reservations in the last 18 months. Choose different related footage; completed uses become available again as that rolling window expires.");
}
