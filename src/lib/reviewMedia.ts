import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { outputPath, sourcePath, type ReviewFile, type ReviewTarget } from "./reviewFiles";

export function selectedReviewTarget(file: ReviewFile, target?: string | null): ReviewTarget | null {
  if (target === "instagram" || target === "youtube") return file.outputs[target] ? target : null;
  if (file.delivery?.platform && file.outputs[file.delivery.platform]) return file.delivery.platform;
  return file.outputs.instagram ? "instagram" : file.outputs.youtube ? "youtube" : null;
}

export function reviewMediaPath(file: ReviewFile, target?: string | null) {
  const selected = selectedReviewTarget(file, target);
  if (selected) return outputPath(file.id, selected);
  if (target || Object.keys(file.outputs).length || file.status === "READY") return null;
  return sourcePath(file.id, file.source.filename);
}

export function parseByteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export async function streamReviewMedia(request: Request, filename: string) {
  const stats = await fs.stat(filename);
  if (!stats.isFile() || !stats.size) throw new Error("Saved video is missing or empty.");
  const extension = path.extname(filename).toLowerCase();
  const type = ({ ".mov": "video/quicktime", ".webm": "video/webm", ".avi": "video/x-msvideo" } as Record<string, string>)[extension] || "video/mp4";
  const headers: Record<string, string> = { "Accept-Ranges": "bytes", "Cache-Control": "private, no-cache", "Content-Type": type, "X-Content-Type-Options": "nosniff" };
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseByteRange(rangeHeader, stats.size) : null;
  if (rangeHeader && !range) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stats.size}` } });
  headers["Content-Length"] = String(range ? range.end - range.start + 1 : stats.size);
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stats.size}`;
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const stream = createReadStream(filename, range || undefined);
  const abort = () => stream.destroy();
  request.signal.addEventListener("abort", abort, { once: true });
  stream.once("close", () => request.signal.removeEventListener("abort", abort));
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  if (request.signal.aborted) stream.destroy();
  return new Response(body, { status, headers });
}
