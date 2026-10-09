import fs from "node:fs/promises";
import path from "node:path";

export type StockTemporaryCleanupReport = {
  removedFiles: number;
  removedBytes: number;
  skippedFiles: number;
};

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noWork: StockTemporaryCleanupReport = { removedFiles: 0, removedBytes: 0, skippedFiles: 0 };

function samePath(left: string, right: string) {
  const first = path.normalize(left);
  const second = path.normalize(right);
  return process.platform === "win32" ? first.toLowerCase() === second.toLowerCase() : first === second;
}

/** Every existing component must be a real directory, never a link or junction. */
async function safeDirectory(directory: string) {
  const absolute = path.resolve(directory);
  const volumeRoot = path.parse(absolute).root;
  let current = volumeRoot;
  for (const component of absolute.slice(volumeRoot.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function allowedTemporaryNames() {
  const names = ["shots.txt"];
  for (let index = 1; index <= 12; index += 1) {
    names.push(`shot-${index}.mp4`, `speech-${index}.wav`);
  }
  return names.filter(name => /^shot-(?:[1-9]|1[0-2])\.mp4$/.test(name)
    || /^speech-(?:[1-9]|1[0-2])\.wav$/.test(name) || name === "shots.txt");
}

/**
 * Remove only per-shot and per-speech scratch files after a terminal stock job.
 * Callers own terminal-state checks and must hold the worker/heavy-work lease.
 * The optional root is for isolated tests; normal callers should omit it.
 */
export async function cleanupStockTemporaries(
  jobId: string,
  root = path.join(process.cwd(), "storage", "Phoenix Studio Review Files", "work"),
): Promise<StockTemporaryCleanupReport> {
  if (typeof jobId !== "string" || !jobIdPattern.test(jobId)) throw new Error("A canonical stock job UUID is required for temporary cleanup.");
  const requestedRoot = path.resolve(root);
  if (path.basename(requestedRoot).toLowerCase() !== "work" || !(await safeDirectory(requestedRoot))) return { ...noWork };
  // Expand benign Windows short (8.3) aliases only after checking every supplied
  // ancestor for links. All deletions use this canonical root, never a junction.
  const absoluteRoot = await fs.realpath(requestedRoot).catch(() => "");
  if (!absoluteRoot || path.basename(absoluteRoot).toLowerCase() !== "work") return { ...noWork };

  const report = { ...noWork };
  const jobDirectory = path.join(absoluteRoot, `source-${jobId}`);
  if (!(await safeDirectory(jobDirectory))) return report;

  for (const version of [1, 2] as const) {
    const assemblyDirectory = path.join(jobDirectory, `stock-assembly-v${version}`);
    if (!(await safeDirectory(assemblyDirectory))) continue;
    for (const name of allowedTemporaryNames()) {
      const filename = path.join(assemblyDirectory, name);
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stat = await fs.lstat(filename);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") report.skippedFiles += 1;
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
        || !samePath(filename, await fs.realpath(filename).catch(() => ""))) {
        report.skippedFiles += 1;
        continue;
      }

      // Recheck the parent chain immediately before the single-file unlink.
      if (!(await safeDirectory(assemblyDirectory))) {
        report.skippedFiles += 1;
        continue;
      }
      try {
        await fs.unlink(filename);
        report.removedFiles += 1;
        report.removedBytes += stat.size;
      } catch {
        // A busy or changed scratch file must not fail the completed/failed job.
        report.skippedFiles += 1;
      }
    }
  }
  return report;
}
