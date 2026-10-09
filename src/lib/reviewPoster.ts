import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { HeavyWorkWaitError, lowerChildProcessPriority, tryWithLocalRenderSlot } from "./renderResources";
import { reviewRoot } from "./reviewFiles";

type PosterWork = { promise: Promise<Buffer>; waiters: Set<symbol> };
const pending = new Map<string, PosterWork>();
let tail: Promise<unknown> = Promise.resolve();

/** One low-resolution frame, one decoder at a time. Never loads an entire MP4. */
export async function reviewPoster(filename: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Preview request cancelled", "AbortError");
  const stats = await fs.stat(filename);
  if (!stats.isFile() || !stats.size) throw new Error("Video not available");
  const key = crypto.createHash("sha256").update(`${filename}:${stats.size}:${stats.mtimeMs}`).digest("hex");
  const directory = path.join(reviewRoot(), "previews");
  const cached = path.join(directory, `${key}.jpg`);
  try { return await fs.readFile(cached); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let work = pending.get(key);
  if (!work) {
    const created: PosterWork = { promise: Promise.resolve(Buffer.alloc(0)), waiters: new Set() };
    const job = tail.then(async () => {
      // A closed tab must not start new decoding later. Once decoding starts it
      // is bounded and shared; cancelling one subscriber must not kill another.
      if (!created.waiters.size) throw new DOMException("Preview request cancelled", "AbortError");
      try { return await fs.readFile(cached); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const result = await tryWithLocalRenderSlot(async () => {
        if (!created.waiters.size) throw new DOMException("Preview request cancelled", "AbortError");
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
      }, "review-poster");
      if (!result.acquired) throw new HeavyWorkWaitError("Preview deferred while heavy work is busy or memory is low");
      return result.value;
    });
    created.promise = job.finally(() => { if (pending.get(key) === created) pending.delete(key); });
    pending.set(key, created);
    tail = created.promise.catch(() => undefined);
    work = created;
  }
  const shared = work;
  const waiter = Symbol("poster subscriber");
  shared.waiters.add(waiter);
  const cancel = () => shared.waiters.delete(waiter);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try { return await shared.promise; }
  finally { signal?.removeEventListener("abort", cancel); cancel(); }
}
