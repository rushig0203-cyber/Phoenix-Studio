import fs from "node:fs/promises";
import path from "node:path";
import type { BigIntStats } from "node:fs";
import { reviewRoot } from "./reviewFiles";

const stores = {
  source: { file: "source-processing-jobs.json", terminal: ["COMPLETED", "FAILED", "CANCELLED"] },
  generation: { file: "ai-creation-jobs.json", terminal: ["COMPLETED", "FAILED", "CANCELLED"] },
  edits: { file: "review-edit-jobs.json", terminal: ["COMPLETED", "FAILED", "CANCELLED"] },
  drafts: { file: "creation-drafts.json", terminal: ["APPROVED", "FAILED", "ARCHIVED"] },
};
const snapshots = new Map<string, { version: string; pending: boolean }>();
const version = (stat: BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");

/** Cache only readiness, never mutable jobs. Pending work keeps its normal polling. */
export async function workerHasPendingWork(key: string): Promise<boolean> {
  if (!Object.hasOwn(stores, key)) return true; // Posting also checks changed media, not just its index.
  const store = stores[key as keyof typeof stores], filename = path.join(reviewRoot(), store.file);
  try {
    const before = await fs.lstat(filename, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(8_388_608)) return true;
    const identity = version(before), saved = snapshots.get(key);
    if (saved?.version === identity) return saved.pending;
    const handle = await fs.open(filename, "r");
    let content: string;
    try {
      if (version(await handle.stat({ bigint: true })) !== identity) return true;
      const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset !== Number(before.size)) return true;
      content = bytes.subarray(0, offset).toString("utf8");
    } finally { await handle.close(); }
    const jobs: unknown = JSON.parse(content);
    if (!Array.isArray(jobs)) return true;
    const pending = jobs.some(job => !job || typeof job !== "object" || Array.isArray(job) || typeof job.status !== "string"
      || !store.terminal.includes(job.status) && !(key !== "drafts" && job.archivedAt));
    // A concurrent enqueue must not be hidden behind a completed-history snapshot.
    if (version(await fs.lstat(filename, { bigint: true })) !== identity) return true;
    snapshots.set(key, { version: identity, pending });
    return pending;
  } catch (error) {
    snapshots.delete(key);
    // Let the existing processor report corrupt/unreadable state; do not hide it.
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}
