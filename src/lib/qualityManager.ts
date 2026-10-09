import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { withFileLock } from "./fileLock";
import { getReviewFile, readReviewFiles, reviewRoot, type ReviewFile } from "./reviewFiles";
import type { CreativeFeedback, CreativeGuidance, FeedbackDimension, QualityAssessment, QualityManagerState } from "./managerTypes";
import { FEEDBACK_REQUESTS, type FeedbackRequest } from "./managerTypes";
import { publishingProfile, inferPublishingFormat } from "./publishingFormats";
import { STOCK_FEEDBACK_MAX_BYTES, readBoundedManagerFeedback, stockProductionGuidanceFromFeedback } from "./stockProductionGuidance";

const feedbackPath = () => path.join(reviewRoot(), "manager-feedback.json");
const rating = z.number().int().min(1).max(5);
const schema = z.object({ reviewId: z.string().uuid(), decision: z.enum(["keep", "revise"]), ratings: z.object({ story: rating, visuals: rating, audio: rating, captions: rating }), note: z.string().trim().max(1000).default(""), requests: z.array(z.enum(FEEDBACK_REQUESTS)).max(FEEDBACK_REQUESTS.length).default([]).transform(values => [...new Set(values)]) });
const dimensions: FeedbackDimension[] = ["story", "visuals", "audio", "captions"];

async function readArray<T>(filename: string): Promise<T[]> {
  try { const data = JSON.parse(await fs.readFile(filename, "utf8")); if (!Array.isArray(data)) throw new Error("Invalid local manager data."); return data; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export function readCreativeFeedback() { return readBoundedManagerFeedback(feedbackPath()); }

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
    const serialized = JSON.stringify(records, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > STOCK_FEEDBACK_MAX_BYTES) throw new Error("Saved manager feedback has reached the 512 KiB local planning limit. Existing reviews are preserved; reduce notes or archive feedback explicitly before adding more.");
    const temporary = `${feedbackPath()}.${crypto.randomUUID()}.tmp`;
    try {
      const handle=await fs.open(temporary,"wx");
      try {await handle.writeFile(serialized,"utf8");await handle.sync();} finally {await handle.close();}
      await fs.rename(temporary,feedbackPath());
    }
    finally { await fs.rm(temporary, { force: true }); }
    return feedback;
  });
}

// Feedback is converted to a bounded set of production rules. Notes never
// become executable instructions, new dependencies, paid calls or auto-posts.
export function guidanceFromFeedback(records: CreativeFeedback[], creationType?: string): CreativeGuidance {
  if (creationType === "source") {
    const stock = stockProductionGuidanceFromFeedback(records);
    return { feedbackCount: stock.feedbackCount, revision: stock.revision, policyVersion: stock.policyVersion, rules: stock.rules,
      requests: stock.requests, priorities: stock.priorities,
      maxCaptionWords: stock.shorterPostingCaption ? 7 : 10, wordsPerSecond: 1.95 };
  }
  const relevant = records.filter(record => !creationType || record.creationType === creationType);
  const policyVersion = 3;
  const requests = FEEDBACK_REQUESTS.filter(request => relevant.some(record => record.requests?.includes(request)));
  const requestDimensions: Record<FeedbackRequest, FeedbackDimension> = { "clearer-explanation": "story", "less-repetition": "story", "stronger-ending": "story", "matching-visuals": "visuals", "natural-sentences": "audio" };
  const weakness = (dimension: FeedbackDimension) => relevant.reduce((sum, record) => sum + (record.ratings[dimension] <= 2 ? 1 : 0), 0);
  const priorities = dimensions.filter(dimension => weakness(dimension) > 0 || requests.some(request => requestDimensions[request] === dimension)).sort((a, b) => weakness(b) - weakness(a));
  const rules: Record<FeedbackDimension, string> = {
    story: creationType?.startsWith("children") ? "Use one clear problem, a visible attempt, its consequence, the other lead's reaction and a changed attempt that resolves the opening. Give each named lead a different approach and short attributed dialogue; show the payoff with the central object. Avoid filler and repeated moral speeches." : "Answer the actual viewer question using the structure it needs: explanation, comparison, demonstration, worked example or story. Start with a concrete problem or observation. Each beat adds a useful detail and explains its cause or condition; the ending delivers the opening's promise with an answer or usable next step. Do not force a fictional character or moral onto an explanation.",
    visuals: creationType?.startsWith("children") ? "Use only the two named animal leads and supported props: flowers, stars, ball, kite, drum, bridge, toys, letter, umbrella or bus. Describe one actor's visible action and the listener's reaction. Keep object states continuous and show a pass or changed attempt before its result; use wide, prop-detail and reaction views when helpful." : "Match each shot to its own narration and retain a coherent visual treatment. Preserve a setting and subject for a continuing action; explanations and comparisons may show different relevant examples. Stock actors and locations are illustrative, not proof of the same person's identity, a named place or an exact before/after result.",
    audio: "Use a calmer word budget and short spoken sentences. Listen for rushed or robotic narration; the local voice is speech, not singing.",
    captions: "Use shorter caption groups, preserve the spoken words and leave time to read. Human synchronization review is still required.",
  };
  const specificRules: Record<FeedbackRequest, string> = {
    "clearer-explanation": "Replace vague advice with a concrete example, explain why it works, and state any necessary conditions. Do not invent facts or statistics to sound specific.",
    "less-repetition": "Each beat must add new information or advance the action. Remove paraphrases of earlier points and generic motivational filler; do not pad to reach duration.",
    "stronger-ending": "The final lines must answer the exact question or resolve the action introduced at the opening. Do not substitute a generic moral or call to action for the promised answer.",
    "matching-visuals": "Describe literal observable subjects and actions for each narration beat. Never imply a stock shot demonstrates something it cannot show or use unrelated scenery to fill time.",
    "natural-sentences": "Use short conversational sentences, natural pauses and one thought per breath. Avoid stacked clauses, jargon and forced rhyme. This is narration guidance, not proof of voice quality.",
  };
  // Notes are review records, never executable prompts. Hash only the bounded
  // production choices; ordering and an edited note do not invalidate all jobs.
  const revision = crypto.createHash("sha256").update(JSON.stringify([policyVersion, creationType || "all", relevant.map(record => [record.reviewId,record.ratings,record.decision,FEEDBACK_REQUESTS.filter(request => record.requests?.includes(request))]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))])).digest("hex").slice(0,12);
  return { feedbackCount: relevant.length, revision, policyVersion, requests, priorities, rules: [...priorities.map(dimension => rules[dimension]), ...requests.map(request => specificRules[request])], maxCaptionWords: priorities.includes("captions") ? 7 : 10, wordsPerSecond: priorities.includes("audio") || priorities.includes("story") ? 1.7 : 1.95 };
}
export async function getCreativeGuidance(creationType?: string) { return guidanceFromFeedback(await readCreativeFeedback(), creationType); }

export function assessReview(file: ReviewFile, feedback?: CreativeFeedback): QualityAssessment {
  const blockers: string[] = [], checks: string[] = [];
  for (const warning of file.quality.editorial?.warnings || []) checks.push(`Editorial review warning: ${warning}`);
  const outputs = Object.values(file.outputs || {});
  if (!outputs.length || outputs.some(output => !output || !Number.isFinite(output.duration) || output.duration <= 0 || output.width <= 0 || output.height <= 0)) blockers.push("No valid finished-video metadata. Export or repair the file first.");
  else checks.push("Saved export metadata includes duration and picture dimensions; watch the file to verify playback.");
  if (file.delivery) {
    const profile = publishingProfile(inferPublishingFormat({ ...file.delivery, duration: file.delivery.requestedDuration, targetPlatform: file.delivery.platform === "instagram" ? "Instagram" : "YouTube" }));
    const outside = outputs.some(output => output && (file.editedFrom
      ? Math.abs(output.duration - file.delivery!.requestedDuration) > .25
      : output.duration < profile.minDuration - 1 || output.duration > profile.maxDuration + 1));
    if (outside) blockers.push("Finished length is outside the selected publishing range or explicit edit trim. Check the export.");
    else checks.push("Finished duration fits the selected publishing range or explicit edit trim; narration may finish before the approximate target.");
  }
  if (file.delivery?.creationType === "children-song" && file.quality.audio !== "supplied-song") blockers.push("This song uses spoken narration, not verified singing. Supply a real song recording before treating it as a song.");
  if (["no-audio", "needs-review"].includes(file.quality.audio)) blockers.push("Audio needs repair or confirmation.");
  const narrationLed = (file.delivery && ["children-story", "children-song", "business", "general"].includes(file.delivery.creationType))
    || ["local-narration", "local-narration-music", "supplied-song"].includes(file.quality.audio);
  if (!file.quality.captions.some(caption => caption.trim())) {
    if (narrationLed || file.quality.subtitles?.decision === "speech") blockers.push("No speech caption text is saved. Add accurate captions in Edit video.");
    else checks.push(file.quality.subtitles?.decision === "none" ? "Subtitles intentionally omitted: no confidently detected speech requires them. Posting copy is separate." : "No subtitles are saved for this source footage. Check audible speech before posting; do not invent subtitles for music or scenery.");
  }
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
  const [files, feedback, ai, source, edits, drafts] = await Promise.all([
    readReviewFiles(), readCreativeFeedback(),
    readArray<{status:string;archivedAt?:string}>(path.join(reviewRoot(),"ai-creation-jobs.json")),
    readArray<{status:string;archivedAt?:string}>(path.join(reviewRoot(),"source-processing-jobs.json")),
    readArray<{status:string;archivedAt?:string}>(path.join(reviewRoot(),"review-edit-jobs.json")),
    readArray<{status:string;archivedAt?:string}>(path.join(reviewRoot(),"creation-drafts.json")),
  ]);
  const jobs = [...ai,...source,...edits,...drafts.filter(draft => !["ARCHIVED", "APPROVED"].includes(draft.status))].filter(job => !job.archivedAt);
  const map = new Map(feedback.map(item => [item.reviewId,item]));
  const assessments = files.filter(file => file.status === "READY").map(file => assessReview(file,map.get(file.id))).reverse();
  return { mode:"local-feedback", checkedAt:new Date().toISOString(), queued:jobs.filter(job=>job.status==="QUEUED").length, running:jobs.filter(job=>["RUNNING","PROCESSING","PLANNING","APPROVING"].includes(job.status)).length, failed:jobs.filter(job=>["FAILED","BLOCKED"].includes(job.status)).length, reviewReady:assessments.length, guidance:guidanceFromFeedback(feedback), assessments,
    capabilities:{singing:false,animation:"Limited 2D · 720p · 12 fps · one local render at a time",learning:"Lumina uses structured reviews for matching children's briefs and business/general writing, including the configured Groq writer. New automatic stock reels snapshot bounded source-review rules: weak visuals or repeated points prefer a larger recent-footage history, and weak caption ratings request shorter grounded posting copy. Free-text notes remain review records. No model retraining, automatic chat reading, self-modifying code, automatic posting or performance prediction.",paidServices:false} };
}

export function assertLocalManagerRequest(request: Request, mutation=false) {
  const url=new URL(request.url), origin=request.headers.get("origin");
  if (!["localhost","127.0.0.1","[::1]"].includes(url.hostname) || (request.headers.get("host") && request.headers.get("host")!==url.host) || (origin && origin!==url.origin) || (mutation && origin!==url.origin)) throw new Error("Open the manager directly in Phoenix Studio on this PC.");
}
