import fs from "node:fs/promises";
import path from "node:path";
import { outputPath, type ReviewFile, type ReviewTarget } from "./reviewFiles";

type ConfirmedPublication = { platform: ReviewTarget; remoteId: string; remoteUrl?: string; postedAt?: string };
export type ReviewPublicationSummary = {
  status: "GENERATED" | "POSTED";
  postedTo: ConfirmedPublication[];
  /** Successful uploads of an older output do not mark the current video posted. */
  previouslyPostedTo?: ConfirmedPublication[];
  /** An unreadable record is not evidence of a completed post. */
  inspectionIssue?: boolean;
};

const recordLimit = 64 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const statuses = new Set(["QUEUED", "UPLOADING", "PROCESSING", "COMPLETE", "FAILED", "NEEDS_CHECK"]);
const storeRoot = () => process.env.PHOENIX_PUBLISH_STORAGE || path.join(process.cwd(), "storage", "private", "review-publications");

function publicUrl(value: unknown, platform: ReviewTarget, remoteId: string) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    if (platform === "youtube") {
      return url.hostname === "www.youtube.com" && url.pathname === "/watch" && url.searchParams.get("v") === remoteId
        ? `https://www.youtube.com/watch?v=${remoteId}` : undefined;
    }
    if (!/^(?:www\.)?instagram\.com$/.test(url.hostname) || !/^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return undefined;
    url.search = ""; url.hash = ""; return url.href;
  } catch { return undefined; }
}

async function readParentRecord(reviewId: string, platform: ReviewTarget) {
  const filename = path.join(storeRoot(), `${reviewId}-${platform}.json`);
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > recordLimit) throw new Error("Unreadable publication record");
  const handle = await fs.open(filename, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size < 1 || opened.size > recordLimit) throw new Error("Unreadable publication record");
    // A fixed bound also protects against a record growing after stat. Never
    // read upload media, sessions, credentials or the whole private folder.
    const buffer = Buffer.alloc(recordLimit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (!offset || offset > recordLimit) throw new Error("Unreadable publication record");
    const record: unknown = JSON.parse(buffer.subarray(0, offset).toString("utf8"));
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Unreadable publication record");
    return record as Record<string, unknown>;
  } finally { await handle.close(); }
}

/** Read-only, bounded, local status decoration. It cannot start or retry uploads. */
export async function reviewPublicationSummary(reviewId: string): Promise<ReviewPublicationSummary> {
  const result: ReviewPublicationSummary = { status: "GENERATED", postedTo: [] };
  if (!uuid.test(reviewId)) return { ...result, inspectionIssue: true };
  for (const platform of ["instagram", "youtube"] as const) {
    try {
      const record = await readParentRecord(reviewId, platform);
      if (record.version !== 1 || !uuid.test(String(record.id || "")) || record.reviewId !== reviewId || record.platform !== platform
          || record.kind !== undefined || !statuses.has(String(record.status)) || typeof record.phase !== "string") {
        result.inspectionIssue = true; continue;
      }
      if (record.status !== "COMPLETE") continue;
      const remoteId = typeof record.remoteId === "string" ? record.remoteId : "";
      if (record.phase !== "complete" || !(platform === "instagram" ? /^\d{1,40}$/ : /^[A-Za-z0-9_-]{11}$/).test(remoteId)) {
        result.inspectionIssue = true; continue;
      }
      const remoteUrl = publicUrl(record.remoteUrl, platform, remoteId);
      const postedAt = typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt)) ? record.updatedAt : undefined;
      if ((record.renderTarget !== "instagram" && record.renderTarget !== "youtube") || !record.fingerprint || typeof record.fingerprint !== "object" || Array.isArray(record.fingerprint)) {
        result.inspectionIssue = true; continue;
      }
      const fingerprint = record.fingerprint as Record<string, unknown>;
      const keys = ["size", "mtimeMs", "ctimeMs", "ino", "dev"] as const;
      if (!keys.every(key => typeof fingerprint[key] === "number" && Number.isFinite(fingerprint[key])) || Number(fingerprint.size) < 1) {
        result.inspectionIssue = true; continue;
      }
      const publication: ConfirmedPublication = { platform, remoteId, ...(remoteUrl ? { remoteUrl } : {}), ...(postedAt ? { postedAt } : {}) };
      let sameOutput = false;
      try {
        const current = await fs.lstat(outputPath(reviewId, record.renderTarget));
        sameOutput = current.isFile() && !current.isSymbolicLink() && keys.every(key => fingerprint[key] === current[key]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.inspectionIssue = true;
      }
      if (sameOutput) result.postedTo.push(publication);
      else (result.previouslyPostedTo ||= []).push(publication);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.inspectionIssue = true;
    }
  }
  if (result.postedTo.length) result.status = "POSTED";
  return result;
}

/** Sequential reads keep Library polling bounded even with many saved videos. */
export async function withReviewPublicationSummaries(files: ReviewFile[]): Promise<ReviewFile[]> {
  const decorated: ReviewFile[] = [];
  for (const file of files) decorated.push({ ...file, publication: await reviewPublicationSummary(file.id) });
  return decorated;
}
