import { createHash } from "node:crypto";
import type { ReviewFile, ReviewTarget } from "./reviewFiles";
export const VISION_MODEL = "qwen/qwen3.8-27b";
/** Same identity as the existing analysis cache; no migration or automatic rerun. */
export function postingMediaFingerprint(file: ReviewFile, target: ReviewTarget, stats: { size: number; mtimeMs: number }) {
  return createHash("sha256").update(JSON.stringify(["sampled-posting-v1", VISION_MODEL, file.id, target, stats.size, stats.mtimeMs, file.outputs[target]?.duration])).digest("hex");
}
