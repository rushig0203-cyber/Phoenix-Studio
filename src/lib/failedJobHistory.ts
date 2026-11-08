import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { reviewRoot } from "./reviewFiles";

export const FAILED_JOB_RETENTION_DAYS = 7;
const retentionMs = FAILED_JOB_RETENTION_DAYS * 86_400_000;
const storeLimit = 8 * 1024 * 1024;
const stores = [
  { file: "source-processing-jobs.json", lock: "source-processing-jobs.lock", statuses: ["FAILED", "BLOCKED"], kind: "source" },
  { file: "ai-creation-jobs.json", lock: ".ai-creation-jobs.lock", statuses: ["FAILED"], kind: "generation" },
  { file: "creation-drafts.json", lock: "creation-drafts.json.lock", statuses: ["FAILED"], kind: "draft" },
  { file: "review-edit-jobs.json", lock: "review-edit-jobs.json.lock", statuses: ["FAILED"], kind: "edit" },
] as const;
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown) => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
const exists = (file: string) => fs.lstat(file).then(() => true, error => (error as NodeJS.ErrnoException).code !== "ENOENT");

function eligible(row: Row, statuses: readonly string[], now: number) {
  if (typeof row.id !== "string" || !row.id || typeof row.status !== "string" || !statuses.includes(row.status) || row.archivedAt
    || ["instagram", "facebook", "youtube"].includes(String(row.platform || "")) || row.submissionUncertainSince || row.approvedJobId) return false;
  const failedAt = timestamp(row.finishedAt) ?? timestamp(row.updatedAt);
  if (failedAt === undefined || failedAt > now - retentionMs) return false;
  // A terminal label does not prove an accepted provider task or retry stopped.
  if (row.providerTaskId && row.providerTaskId !== row.resourceReleasedTaskId || row.providerLeaseOwner || row.localRenderLeaseOwner
    || row.leaseOwner || row.retryInProgress === true) return false;
  if ((row.songTaskId || row.songSubmissionStarted) && !row.songTaskFailed && !row.songOutput) return false;
  for (const field of ["nextAttemptAt", "providerLeaseExpiresAt", "localRenderLeaseExpiresAt"]) {
    if (row[field] && (timestamp(row[field]) === undefined || timestamp(row[field])! > now)) return false;
  }
  return row.leaseUntil === undefined || typeof row.leaseUntil === "number" && Number.isFinite(row.leaseUntil) && row.leaseUntil <= now;
}

async function readRows(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > storeLimit) throw new Error("Unsafe job history.");
  const handle = await fs.open(file, "r");
  try {
    const bytes = Buffer.alloc(stat.size + 1); let offset = 0;
    while (offset < bytes.length) { const next = await handle.read(bytes, offset, bytes.length - offset, offset); if (!next.bytesRead) break; offset += next.bytesRead; }
    if (offset !== stat.size) throw new Error("Job history changed during reading.");
    const rows: unknown = JSON.parse(bytes.subarray(0, offset).toString("utf8"));
    if (!Array.isArray(rows) || rows.length > 10_000 || rows.some(row => !object(row))) throw new Error("Invalid job history.");
    return rows as Row[];
  } finally { await handle.close(); }
}

/** Soft history tombstones only: originals, finished videos and upload journals stay saved. */
export async function archiveExpiredJobHistory(now = Date.now(), root = reviewRoot()) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error("A valid history-cleanup time is required.");
  const report = { archived: 0, skippedStores: 0 };
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return report;
    // Housekeeping never competes with an encoder/model or uncertain external task.
    const lease = path.join(root, "heavy-work-lease.json");
    if (await exists(lease)) {
      const leaseStat = await fs.lstat(lease);
      if (!leaseStat.isFile() || leaseStat.isSymbolicLink() || leaseStat.size > 16_384 || JSON.parse(await fs.readFile(lease, "utf8")) !== null) return report;
    }
  } catch { return report; }
  for (const store of stores) {
    const file = path.join(root, store.file), lock = path.join(root, store.lock);
    if (!await exists(file)) continue;
    // Never steal a live or stale retry lock. Its normal owner handles recovery.
    if (await exists(lock) || store.kind === "source" && await exists(path.join(root, "source-processing-worker.lock"))) { report.skippedStores++; continue; }
    try {
      await withFileLock(lock, async () => {
        const rows = await readRows(file); let changed = 0;
        for (const row of rows) {
          if (changed >= 100 || !eligible(row, store.statuses, now)) continue;
          if (store.kind === "draft") {
            if (!Number.isSafeInteger(row.version) || Number(row.version) < 1) continue;
            row.status = "ARCHIVED"; row.version = Number(row.version) + 1; row.updatedAt = new Date(now).toISOString();
          } else row.archivedAt = new Date(now).toISOString();
          changed++;
        }
        if (changed) {
          if (Buffer.byteLength(JSON.stringify(rows, null, 2), "utf8") + 1 > storeLimit) throw new Error("Job history exceeds the safe bound.");
          await writeAtomicJson(file, rows); report.archived += changed;
        }
      }, { timeoutMs: 0, staleMs: 120_000 });
    } catch { report.skippedStores++; }
  }
  return report;
}
