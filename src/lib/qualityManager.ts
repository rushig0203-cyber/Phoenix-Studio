import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { withFileLock } from "./fileLock";
import { getReviewFile, readReviewFiles, reviewRoot, type ReviewFile } from "./reviewFiles";
import type { CreativeFeedback, CreativeGuidance, FeedbackDimension, QualityAssessment, QualityManagerState } from "./managerTypes";

const feedbackPath = () => path.join(reviewRoot(), "manager-feedback.json");
const rating = z.number().int().min(1).max(5);
const schema = z.object({ reviewId: z.string().uuid(), decision: z.enum(["keep", "revise"]), ratings: z.object({ story: rating, visuals: rating, audio: rating, captions: rating }), note: z.string().trim().max(1000).default("") });
const dimensions: FeedbackDimension[] = ["story", "visuals", "audio", "captions"];

async function readArray<T>(filename: string): Promise<T[]> {
  try { const data = JSON.parse(await fs.readFile(filename, "utf8")); if (!Array.isArray(data)) throw new Error("Invalid local manager data."); return data; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export function readCreativeFeedback() { return readArray<CreativeFeedback>(feedbackPath()); }

export async function saveCreativeFeedback(value: unknown) {
  const data = schema.parse(value);
  const file = await getReviewFile(data.reviewId);
  if (!file) throw new Error("Review file not found.");
  const feedback: CreativeFeedback = { ...data, title: file.title, creationType: file.delivery?.creationType || "source", updatedAt: new Date().toISOString() };
  await fs.mkdir(reviewRoot(), { recursive: true });
  return withFileLock(`${feedbackPath()}.lock`, async () => {
    const records = await readCreativeFeedback();
    const index = records.findIndex(item => item.reviewId === data.reviewId);
    if (index < 0) records.push(feedback); else records[index] = feedback;
    const temporary = `${feedbackPath()}.${crypto.randomUUID()}.tmp`;
    try {
      const handle=await fs.open(temporary,"wx");
      try {await handle.writeFile(JSON.stringify(records,null,2),"utf8");await handle.sync();} finally {await handle.close();}
      await fs.rename(temporary,feedbackPath());
    }
    finally { await fs.rm(temporary, { force: true }); }
    return feedback;
  });
}

// Feedback is converted to a bounded set of production rules. Notes never
// become executable instructions, new dependencies, paid calls or auto-posts.
export function guidanceFromFeedback(records: CreativeFeedback[], creationType?: string): CreativeGuidance {
  const relevant = records.filter(record => !creationType || record.creationType === creationType);
  const weakness = (dimension: FeedbackDimension) => relevant.reduce((sum, record) => sum + (record.ratings[dimension] <= 2 ? 1 : 0), 0);
  const priorities = dimensions.filter(dimension => weakness(dimension) > 0).sort((a, b) => weakness(b) - weakness(a));
  const rules: Record<FeedbackDimension, string> = {
    story: "Use one clear problem, a visible attempt and a specific resolution. Avoid filler and repeated moral speeches.",
    visuals: "Use only the two named animal leads and supported props: flowers, stars, ball, kite, drum, bridge, toys or bus. Describe visible actions instead of unseen characters or abstract events.",
    audio: "Use a calmer word budget and short spoken sentences. Listen for rushed or robotic narration; the local voice is speech, not singing.",
    captions: "Use shorter caption groups, preserve the spoken words and leave time to read. Human synchronization review is still required.",
  };
  const revision = crypto.createHash("sha256").update(JSON.stringify(relevant.map(record => [record.reviewId,record.ratings,record.decision]))).digest("hex").slice(0,12);
  return { feedbackCount: relevant.length, revision, priorities, rules: priorities.map(dimension => rules[dimension]), maxCaptionWords: priorities.includes("captions") ? 7 : 10, wordsPerSecond: priorities.includes("audio") || priorities.includes("story") ? 1.7 : 1.95 };
}
export async function getCreativeGuidance(creationType?: string) { return guidanceFromFeedback(await readCreativeFeedback(), creationType); }

export function assessReview(file: ReviewFile, feedback?: CreativeFeedback): QualityAssessment {
  const blockers: string[] = [], checks: string[] = [];
  const outputs = Object.values(file.outputs || {});
  if (!outputs.length || outputs.some(output => !output || !Number.isFinite(output.duration) || output.duration <= 0 || output.width <= 0 || output.height <= 0)) blockers.push("No valid finished-video metadata. Export or repair the file first.");
  else checks.push("Saved export metadata includes duration and picture dimensions; watch the file to verify playback.");
  if (file.delivery && outputs.some(output => output && Math.abs(output.duration-file.delivery!.requestedDuration) > 1)) blockers.push("Finished length differs from the requested length. Check the trim/export.");
  if (file.delivery?.creationType === "children-song" && file.quality.audio !== "supplied-song") blockers.push("This song uses spoken narration, not verified singing. Supply a real song recording before treating it as a song.");
  if (["no-audio", "needs-review"].includes(file.quality.audio)) blockers.push("Audio needs repair or confirmation.");
  if (!file.quality.captions.some(caption => caption.trim())) blockers.push("No caption text is saved. Add accurate captions in Edit video.");
  if (file.quality.audio === "local-music-replaced") checks.push("Original audio was replaced. Confirm no important dialogue was lost.");
  if (file.quality.audio === "supplied-song") checks.push("User-supplied audio is present; singing, music quality and lyric synchronization still need a listening review.");
  if (file.delivery?.creationType.startsWith("children")) checks.push("Limited 2D character animation. Anatomy, action matching and lip synchronization need visual review; this is not a professional-animation score.");
  const weak = feedback && dimensions.filter(dimension => feedback.ratings[dimension] <= 2);
  if (weak?.length) checks.push(`Your review requests improvement in: ${weak.join(", ")}.`);
  if (!file.quality.postCopy || !file.quality.hashtags.length) checks.push("Posting copy or hashtags need completion.");
  const decision = blockers.length ? "BLOCKED" : feedback?.decision === "revise" || weak?.length ? "REVISE" : feedback?.decision === "keep" ? "OWNER_APPROVED" : "AWAITING_REVIEW";
  return { reviewId: file.id, title: file.title, decision, blockers, checks, feedback };
}

export async function getQualityManagerState(): Promise<QualityManagerState> {
  const [files, feedback, ai, source, edits] = await Promise.all([
    readReviewFiles(), readCreativeFeedback(),
    readArray<{status:string;archivedAt?:string}>(path.join(reviewRoot(),"ai-creation-jobs.json")),
    readArray<{status:string;archivedAt?:string}>(path.join(reviewRoot(),"source-processing-jobs.json")),
    readArray<{status:string;archivedAt?:string}>(path.join(reviewRoot(),"review-edit-jobs.json")),
  ]);
  const jobs = [...ai,...source,...edits].filter(job => !job.archivedAt);
  const map = new Map(feedback.map(item => [item.reviewId,item]));
  const assessments = files.filter(file => file.status === "READY").map(file => assessReview(file,map.get(file.id))).reverse();
  return { mode:"local-feedback", checkedAt:new Date().toISOString(), queued:jobs.filter(job=>job.status==="QUEUED").length, running:jobs.filter(job=>["RUNNING","PROCESSING"].includes(job.status)).length, failed:jobs.filter(job=>job.status==="FAILED").length, reviewReady:assessments.length, guidance:guidanceFromFeedback(feedback), assessments,
    capabilities:{singing:false,animation:"Limited 2D · 720p · 12 fps · one local render at a time",learning:"Ratings guide matching children's creation types: story briefs, word budgets and caption groups. Source/stock ratings are review records only for now. No model retraining, self-modifying code, automatic posting or performance prediction.",paidServices:false} };
}

export function assertLocalManagerRequest(request: Request, mutation=false) {
  const url=new URL(request.url), origin=request.headers.get("origin");
  if (!["localhost","127.0.0.1","[::1]"].includes(url.hostname) || (request.headers.get("host") && request.headers.get("host")!==url.host) || (origin && origin!==url.origin) || (mutation && origin!==url.origin)) throw new Error("Open the manager directly in Phoenix Studio on this PC.");
}
