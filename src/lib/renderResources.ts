import os from "node:os";

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
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Priority is best-effort. FFmpeg still has the explicit thread ceilings.
  }
}

let localRenderTail: Promise<void> = Promise.resolve();

/** Serializes Phoenix's source-video and children's-video render pipelines. */
export async function withLocalRenderSlot<T>(operation: () => Promise<T>): Promise<T> {
  let release: () => void = () => undefined;
  const previous = localRenderTail;
  localRenderTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
