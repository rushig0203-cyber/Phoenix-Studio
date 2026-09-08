import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { lowerChildProcessPriority } from "./renderResources";
import { reviewRoot } from "./reviewFiles";

const pending = new Map<string, Promise<Buffer>>();
let tail: Promise<unknown> = Promise.resolve();

/** One low-resolution frame, one decoder at a time. Never loads an entire MP4. */
export async function reviewPoster(filename: string) {
  const stats = await fs.stat(filename);
  if (!stats.isFile() || !stats.size) throw new Error("Video not available");
  const key = crypto.createHash("sha256").update(`${filename}:${stats.size}:${stats.mtimeMs}`).digest("hex");
  const directory = path.join(reviewRoot(), "previews");
  const cached = path.join(directory, `${key}.jpg`);
  try { return await fs.readFile(cached); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const existing = pending.get(key);
  if (existing) return existing;
  const job = tail.then(async () => {
    const executable = process.env.PHOENIX_FFMPEG_PATH?.trim() || path.join(process.cwd(), "node_modules", "@ffmpeg-installer", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const child = execFile(executable, ["-hide_banner", "-loglevel", "error", "-threads", "1", "-filter_threads", "1", "-ss", "0", "-i", filename, "-frames:v", "1", "-an", "-vf", "scale=384:216:force_original_aspect_ratio=decrease", "-threads", "1", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"],
        { encoding: "buffer", windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
      lowerChildProcessPriority(child.pid);
    });
    if (!bytes.length) throw new Error("No preview frame available");
    await fs.mkdir(directory, { recursive: true });
    const temp = `${cached}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, bytes); await fs.rename(temp, cached); }
    finally { await fs.rm(temp, { force: true }).catch(() => undefined); }
    return bytes;
  });
  pending.set(key, job);
  tail = job.catch(() => undefined);
  try { return await job; } finally { pending.delete(key); }
}
