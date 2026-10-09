import fs from "node:fs/promises";
import path from "node:path";

export const REVIEW_STORAGE_LABELS = {
  sources: "Original source videos",
  outputs: "Finished videos",
  work: "Editing and retry files",
  assets: "Reusable visual assets",
  models: "Cached speech models",
  previews: "Preview thumbnails",
  "song-audio": "Supplied song audio",
  metadata: "Queue and review records",
} as const;
type Category = keyof typeof REVIEW_STORAGE_LABELS;
export type ReviewStorageUsage = {
  bytes: number; objects: number; kind: "local"; percent: 0; limitBytes: null;
  measuredAt: string; partial: boolean; skippedLinks: number;
  categories: Array<{ key: Category; label: string; bytes: number; objects: number }>;
};

// A scan reads file sizes only, never video contents. Coalesce callers and cache
// briefly so opening Library/Settings cannot repeatedly walk thousands of files.
const cacheLifetime = 60_000;
let cached: { root: string; until: number; value: ReviewStorageUsage } | undefined;
let inFlight: { root: string; task: Promise<ReviewStorageUsage> } | undefined;

async function scan(root: string): Promise<ReviewStorageUsage> {
  const totals = new Map<Category, { bytes: number; objects: number }>();
  for (const key of Object.keys(REVIEW_STORAGE_LABELS) as Category[]) totals.set(key, { bytes: 0, objects: 0 });
  let partial = false, skippedLinks = 0;
  async function walk(directory: string, category: Category, depth: number) {
    if (depth > 32) { partial = true; return; }
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") partial = true; return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) { skippedLinks++; continue; }
      const key = depth === 0 && Object.hasOwn(REVIEW_STORAGE_LABELS, entry.name) ? entry.name as Category : category;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename, key, depth + 1);
      else if (entry.isFile()) {
        try {
          // lstat also prevents a replaced symlink from following an outside path.
          const stat = await fs.lstat(filename);
          if (stat.isSymbolicLink()) { skippedLinks++; continue; }
          if (stat.isFile()) { const total = totals.get(key)!; total.bytes += stat.size; total.objects++; }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") partial = true; }
      }
    }
  }
  await walk(root, "metadata", 0);
  const categories = [...totals].map(([key, total]) => ({ key, label: REVIEW_STORAGE_LABELS[key], ...total }));
  return { bytes: categories.reduce((sum, item) => sum + item.bytes, 0), objects: categories.reduce((sum, item) => sum + item.objects, 0),
    kind: "local", percent: 0, limitBytes: null, measuredAt: new Date().toISOString(), partial, skippedLinks, categories };
}

export async function reviewStorageUsage(directory: string) {
  const root = path.resolve(directory);
  if (cached?.root === root && cached.until > Date.now()) return cached.value;
  if (inFlight?.root === root) return inFlight.task;
  const task = scan(root).then(value => { cached = { root, until: Date.now() + cacheLifetime, value }; return value; });
  const pending = { root, task }; inFlight = pending;
  try { return await task; }
  finally { if (inFlight === pending) inFlight = undefined; }
}
