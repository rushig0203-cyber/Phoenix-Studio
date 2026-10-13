import fs from "node:fs/promises";
import path from "node:path";
import { outputPath, reviewRoot, type ReviewFile } from "./reviewFiles";

async function reviewIndex(): Promise<ReviewFile[]> {
  let handle;
  try {
    const filename = path.join(reviewRoot(), "index.json"), limit = 8 * 1024 * 1024;
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) return [];
    handle = await fs.open(filename, "r");
    const buffer = Buffer.alloc(Math.min(limit + 1, stat.size + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    if (offset > stat.size) return [];
    const value: unknown = JSON.parse(buffer.toString("utf8", 0, offset));
    return Array.isArray(value) ? value.slice(0, 5000) as ReviewFile[] : [];
  } catch { return []; }
  finally { await handle?.close(); }
}

/** Match an exact accepted media ID, account and output, not a similar caption. */
export async function instagramPublishedReviews(accountId: string): Promise<Map<string, {
  reviewId: string; topic: string; creationType: string; durationSeconds?: number;
}>> {
  const matched = new Map<string, { reviewId: string; topic: string; creationType: string; durationSeconds?: number }>();
  if (!/^\d{1,40}$/.test(accountId)) return matched;
  const root = process.env.PHOENIX_PUBLISH_STORAGE || path.join(process.cwd(), "storage", "private", "review-publications");
  for (const file of await reviewIndex()) {
    if (!file || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(file.id)
      || typeof file.title !== "string" || !file.outputs || file.trashedAt) continue;
    let handle;
    try {
      const filename = path.join(root, `${file.id}-instagram.json`);
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) continue;
      handle = await fs.open(filename, "r");
      const buffer = Buffer.alloc(64 * 1024 + 1);
      const read = await handle.read(buffer, 0, buffer.length, 0);
      if (read.bytesRead > 64 * 1024) continue;
      const record = JSON.parse(buffer.toString("utf8", 0, read.bytesRead));
      if (record.accountId !== accountId || record.status !== "COMPLETE" || record.phase !== "complete" || record.kind
          || typeof record.remoteId !== "string" || !/^\d{1,40}$/.test(record.remoteId)
          || !["instagram", "youtube"].includes(record.renderTarget) || !record.fingerprint) continue;
      const current = await fs.lstat(outputPath(file.id, record.renderTarget));
      if (!current.isFile() || current.isSymbolicLink() || !(["size", "mtimeMs", "ctimeMs", "ino", "dev"] as const)
        .every(key => typeof record.fingerprint[key] === "number" && record.fingerprint[key] === current[key])) continue;
      matched.set(record.remoteId, { reviewId: file.id, topic: file.title.slice(0, 300),
        creationType: file.delivery?.creationType || "source", durationSeconds: file.outputs[record.renderTarget as "instagram" | "youtube"]?.duration });
    } catch {
      // Optional attribution cannot break insights or treat a corrupt journal as evidence.
    } finally { await handle?.close(); }
  }
  return matched;
}
