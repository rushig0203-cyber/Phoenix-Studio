import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FEEDBACK_REQUESTS, type CreativeFeedback, type FeedbackDimension, type FeedbackRequest } from "./managerTypes";
import { reviewRoot } from "./reviewFiles";

export const STOCK_FEEDBACK_MAX_BYTES = 512 * 1024;
export const STOCK_FEEDBACK_MAX_RECORDS = 200;
export const STOCK_CAPTION_FEEDBACK_RULE = "Use one short, directly grounded sentence for the posting caption; no scene inventory, filler, invented location or engagement guarantee.";
const rating = z.number().int().min(1).max(5);
const feedbackSchema = z.object({
  reviewId: z.string().uuid(), creationType: z.literal("source"), decision: z.enum(["keep", "revise"]),
  ratings: z.object({ story: rating, visuals: rating, audio: rating, captions: rating }),
  requests: z.array(z.enum(FEEDBACK_REQUESTS)).max(FEEDBACK_REQUESTS.length).default([]),
  updatedAt: z.string().max(40).optional(),
});

export type StockProductionGuidance = {
  revision: string; feedbackCount: number; rules: string[]; historyLimit: 10 | 20;
  policyVersion: 1; shorterPostingCaption: boolean; priorities: FeedbackDimension[]; requests: FeedbackRequest[];
};

/** Fixed production rules, never commands/prompts extracted from free-text notes. */
export function stockProductionGuidanceFromFeedback(records: readonly CreativeFeedback[]): StockProductionGuidance {
  const sources = records.filter(record => record?.creationType === "source").map(record => feedbackSchema.parse(record));
  // One review is one vote. Latest saved feedback replaces that review's prior
  // choices; cap the relevant history without discarding the persisted records.
  const latest = new Map<string, typeof sources[number]>();
  for (const record of sources) {
    const previous = latest.get(record.reviewId);
    if (!previous || (Date.parse(record.updatedAt || "") || 0) >= (Date.parse(previous.updatedAt || "") || 0)) latest.set(record.reviewId, record);
  }
  const relevant = [...latest.values()].sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0) || a.reviewId.localeCompare(b.reviewId)).slice(0, STOCK_FEEDBACK_MAX_RECORDS);
  const requested = (name: typeof FEEDBACK_REQUESTS[number]) => relevant.some(record => record.requests.includes(name));
  const weak = (dimension: keyof CreativeFeedback["ratings"]) => relevant.some(record => record.ratings[dimension] <= 2);
  const freshness = weak("visuals") || weak("story") || requested("less-repetition");
  const shorterPostingCaption = weak("captions");
  const rules = [
    "New automatic reels use at least 40 seconds of real picture at original playback speed; do not slow, loop, freeze or add unrelated filler to meet duration.",
    "Keep the starting video's subject and catalog-described scene context throughout the reel; stock metadata does not verify the same real location or continuous event.",
    "Use a reproducible per-reel original music arrangement with varied instrument blend, melody and rhythm; retain usable original ambience without copying commercial songs.",
    ...(freshness ? ["Prefer suitable footage absent from the last 20 completed reels; keep the chosen starting video and allow related reuse only when suitable fresh alternatives are unavailable."] : []),
    ...(weak("visuals") || requested("matching-visuals") ? ["Prioritize one consistent visible subject and setting over catalog variety; do not switch between sky, water, forest and city merely because they share a broad search term."] : []),
    ...(weak("audio") ? ["Keep a continuous restrained original music bed beneath usable ambience; the saved varied arrangement is a listening-review draft, not a professional-song guarantee."] : []),
    ...(shorterPostingCaption ? [STOCK_CAPTION_FEEDBACK_RULE] : []),
  ];
  const revision = `stock-v1-${crypto.createHash("sha256").update(JSON.stringify(relevant.map(record => [record.reviewId, record.ratings, record.decision, FEEDBACK_REQUESTS.filter(request => record.requests.includes(request))]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex").slice(0, 12)}`;
  return { revision, feedbackCount: relevant.length, policyVersion: 1, rules, historyLimit: freshness ? 20 : 10, shorterPostingCaption,
    priorities: (["story", "visuals", "audio", "captions"] as FeedbackDimension[]).filter(weak), requests: FEEDBACK_REQUESTS.filter(requested) };
}

/** Shared bounded local feedback read for Lumina, Groq planning and stock reels. */
export async function readBoundedManagerFeedback(filename = path.join(reviewRoot(), "manager-feedback.json")): Promise<CreativeFeedback[]> {
  let handle;
  try { handle = await fs.open(filename, "r"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Cannot read saved manager feedback. Repair local feedback access before continuing content planning; no work was started.");
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > STOCK_FEEDBACK_MAX_BYTES) throw new Error("Saved manager feedback exceeds its 512 KiB planning limit or is not a regular file. Preserve the file and repair it before continuing content planning.");
    const buffer = Buffer.alloc(STOCK_FEEDBACK_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > STOCK_FEEDBACK_MAX_BYTES) throw new Error("Saved manager feedback exceeds its 512 KiB planning limit. Preserve the file and repair it before continuing content planning.");
    let records: unknown;
    try { records = JSON.parse(buffer.toString("utf8", 0, length)); }
    catch { throw new Error("Saved manager feedback is not valid JSON. Preserve the file and repair it before continuing content planning."); }
    if (!Array.isArray(records) || records.some(record => !record || typeof record !== "object" || typeof record.creationType !== "string")) throw new Error("Saved manager feedback contains invalid records. Preserve the file and repair it before continuing content planning.");
    return records as CreativeFeedback[];
  } finally { await handle.close(); }
}

/** Only source choices affect a new automatic recipe; saved jobs are not replanned. */
export async function getStockProductionGuidance(filename = path.join(reviewRoot(), "manager-feedback.json")): Promise<StockProductionGuidance> {
  const records = await readBoundedManagerFeedback(filename);
  try { return stockProductionGuidanceFromFeedback(records); }
  catch { throw new Error("Saved source-video ratings or improvement choices are invalid. Preserve the feedback and repair it before continuing content planning."); }
}

/** Only a recognized immutable stock-policy rule may influence posting copy. */
export function prefersShortStockPostingCaption(guidance?: { revision: string; rules: string[] }) {
  return !!guidance && /^stock-v1-[a-f0-9]{12}$/.test(guidance.revision)
    && Array.isArray(guidance.rules) && guidance.rules.length <= 8 && guidance.rules.includes(STOCK_CAPTION_FEEDBACK_RULE);
}
