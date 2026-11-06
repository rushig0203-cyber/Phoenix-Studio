import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeAtomicJson } from "./atomicJson";
import { withFileLock } from "./fileLock";
import { reviewRoot } from "./reviewFiles";
import type { CaptionRevisionFeedback, FeedbackDimension } from "./managerTypes";

export const CAPTION_REVISION_RULE = "Posting copy only: replace flat image descriptions and scene inventories with one short, natural audience-facing angle on a supported visual detail or narrated point. Offer distinct grounded alternatives; no repeated rejected copy, invented feelings or location, generic motivation, forced questions or engagement promises.";
const maxBytes = 128 * 1024, maxRecords = 200;
const filename = () => path.join(reviewRoot(), "caption-revision-feedback.json");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z.object({ version: z.literal(1), id: hash, reviewId: z.string().uuid(),
  creationType: z.enum(["source", "general", "business", "children-story", "children-song"]),
  mediaFingerprint: hash, rejectedCaptionHash: hash, savedAt: z.string().datetime() });

export function captionRevisionHash(caption: string) {
  return digest(caption.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim());
}

/** Bounded automatic signals never read or overwrite the manual ratings file. */
export async function readCaptionRevisionFeedback(): Promise<CaptionRevisionFeedback[]> {
  let handle;
  try { handle = await fs.open(filename(), "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("Cannot read automatic caption feedback; existing reviews are preserved."); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Automatic caption feedback exceeds its 128 KiB safety limit; preserve and repair the local file.");
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
    if (length > maxBytes) throw new Error("Automatic caption feedback exceeds its 128 KiB safety limit; preserve and repair the local file.");
    const parsed = z.array(recordSchema).max(maxRecords).safeParse(JSON.parse(bytes.toString("utf8", 0, length)));
    if (!parsed.success) throw new Error("Automatic caption feedback is invalid; preserve and repair the local file.");
    return parsed.data;
  } finally { await handle.close(); }
}

export async function saveCaptionRevisionFeedback(reviewId: string, creationType: string, mediaFingerprint: string, previousCaption: string) {
  const rejectedCaptionHash = captionRevisionHash(previousCaption);
  const event = recordSchema.parse({ version: 1, reviewId, creationType, mediaFingerprint, rejectedCaptionHash,
    id: digest(JSON.stringify([reviewId, mediaFingerprint, rejectedCaptionHash])), savedAt: new Date().toISOString() });
  return withFileLock(`${filename()}.lock`, async () => {
    const records = await readCaptionRevisionFeedback(), existing = records.find(record => record.id === event.id);
    if (existing) return existing;
    const next = [event, ...records].slice(0, maxRecords);
    if (Buffer.byteLength(JSON.stringify(next), "utf8") > maxBytes) throw new Error("Automatic caption feedback exceeds its 128 KiB safety limit; existing records are preserved.");
    await writeAtomicJson(filename(), next);
    return event;
  });
}

/** A request supplies a fixed production preference, never invented review scores. */
export function withCaptionRevisionGuidance<T extends { revision: string; rules: string[]; priorities: FeedbackDimension[] }>(base: T, records: CaptionRevisionFeedback[], creationType?: string): T & { automaticCaptionFeedbackCount?: number } {
  const relevant = records.filter(record => !creationType || record.creationType === creationType).slice(0, maxRecords);
  if (!relevant.length) return base;
  const revision = digest(JSON.stringify([base.revision, relevant.map(record => record.id).sort()])).slice(0, 12);
  return { ...base, revision: base.revision.startsWith("stock-v1-") ? `stock-v1-${revision}` : revision,
    automaticCaptionFeedbackCount: relevant.length, priorities: [...base.priorities.filter(dimension => dimension !== "captions"), "captions"],
    rules: [...base.rules.filter(rule => rule !== CAPTION_REVISION_RULE), CAPTION_REVISION_RULE] };
}
