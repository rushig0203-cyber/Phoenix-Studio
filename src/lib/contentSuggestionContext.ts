import fs from "node:fs/promises";
import path from "node:path";
import type { SuggestionContext, SuggestionWorkflow } from "./contentIdeas";
import { instagramPerformanceSummary } from "./instagramPerformanceLearning";
import type { InstagramPerformanceState, InstagramPerformanceVideo } from "./instagramPerformanceTypes";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const text = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, limit) : "";
const date = (value: unknown, now: number) => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300_000 ? new Date(value).toISOString() : "";
const workflows: SuggestionWorkflow[] = ["stock-reel", "general", "business", "children-story", "children-song"];
const workflow = (value: unknown): SuggestionWorkflow | undefined => value === "source" ? "stock-reel" : workflows.includes(value as SuggestionWorkflow) ? value as SuggestionWorkflow : undefined;

/** Project only saved, completed visual metadata; notes and generated briefs are not visual evidence. */
export function suggestionContextFromMetadata(reviewValue: unknown, feedbackValue: unknown, performanceValue: unknown, now = Date.now()): SuggestionContext {
  const recent: SuggestionContext["recent"] = [];
  const originals = new Set<string>();
  const reviews = Array.isArray(reviewValue) ? reviewValue.slice(0, 5000).filter(object)
    .filter((record): record is Record<string, unknown> & { id: string } => {
      const createdAt = date(record.createdAt, now);
      return id(record.id) && !!text(record.title, 300) && !!createdAt && !record.trashedAt && record.status === "READY"
        && now - Date.parse(createdAt) <= 120 * 86_400_000 && (!object(record.processing) || record.processing.status === "COMPLETED");
    })
    .sort((a, b) => (Date.parse(String(b.createdAt || "")) || 0) - (Date.parse(String(a.createdAt || "")) || 0)) : [];
  const originalIds = new Set(reviews.filter(record => !id(record.editedFrom)).map(record => record.id));
  for (const record of reviews) {
    const title = text(record.title, 300), createdAt = date(record.createdAt, now);
    // Caption-edit copies must not hide the original's feedback and publication evidence.
    if (id(record.editedFrom) && originalIds.has(record.editedFrom)) continue;
    const original = id(record.editedFrom) ? record.editedFrom : record.id;
    if (originals.has(original)) continue;
    originals.add(original);
    const delivery = object(record.delivery) ? record.delivery : {};
    const quality = object(record.quality) ? record.quality : {};
    const analysis = object(quality.postingAnalysis) ? quality.postingAnalysis : {};
    const observations = analysis.status === "COMPLETE" && Array.isArray(analysis.observations)
      ? analysis.observations.slice(0, 6).map(value => text(value, 240)).filter(Boolean) : [];
    recent.push({ reviewId: record.id, title, createdAt, workflow: workflow(delivery.creationType) || "stock-reel", observations,
      ...(object(quality.research) ? { news: true } : {}) });
    if (recent.length === 120) break;
  }
  const reviewById = new Map(recent.map(record => [record.reviewId, record]));
  const latest = new Map<string, { value: SuggestionContext["feedback"][number]; updatedAt: string }>();
  for (const record of Array.isArray(feedbackValue) ? feedbackValue.slice(0, 2000) : []) {
    if (!object(record) || !id(record.reviewId) || !reviewById.has(record.reviewId) || !["keep", "revise"].includes(String(record.decision)) || !object(record.ratings)) continue;
    const { story, visuals } = record.ratings, updatedAt = date(record.updatedAt, now);
    if (![story, visuals].every(value => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5)) continue;
    const previous = latest.get(record.reviewId);
    if (previous && previous.updatedAt > updatedAt) continue;
    latest.set(record.reviewId, { value: { reviewId: record.reviewId, decision: record.decision as "keep" | "revise", storyRating: story as number, visualRating: visuals as number }, updatedAt });
  }
  const feedback = [...latest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 120).map(record => record.value);
  const strongerTopics: SuggestionContext["strongerTopics"] = [];
  if (object(performanceValue) && performanceValue.version === 1 && object(performanceValue.account)
    && typeof performanceValue.account.id === "string" && /^\d{1,40}$/.test(performanceValue.account.id)
    && text(performanceValue.account.connectionRevision, 200) && Array.isArray(performanceValue.videos) && performanceValue.videos.length <= 5000) {
    const videos: InstagramPerformanceVideo[] = [];
    const usedIds = new Set<string>();
    const rows = performanceValue.videos.filter(object).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    for (const row of rows) {
      if (typeof row.id !== "string" || !/^\d{1,40}$/.test(row.id) || usedIds.has(row.id) || !id(row.reviewId) || !object(row.metrics)) continue;
      const review = reviewById.get(row.reviewId), timestamp = date(row.timestamp, now), metricsUpdatedAt = date(row.metricsUpdatedAt, now);
      if (!review || review.news || !timestamp || !metricsUpdatedAt || !["REELS", "FEED"].includes(String(row.mediaProductType))
        || workflow(row.creationType) !== review.workflow) continue;
      const savedMetrics = row.metrics;
      const metric = (key: string) => {
        const value = savedMetrics[key];
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
      };
      videos.push({ id: row.id, reviewId: row.reviewId, topic: review.title, creationType: review.workflow, caption: "", timestamp,
        mediaProductType: String(row.mediaProductType), metricsUpdatedAt,
        metrics: { views: metric("views"), reach: metric("reach"), likes: metric("likes"), comments: metric("comments"), saves: metric("saves"), shares: metric("shares"), averageWatchTimeMs: null, totalWatchTimeMs: null } });
      usedIds.add(row.id);
      if (videos.length === 500) break;
    }
    for (const kind of workflows) {
      const state: InstagramPerformanceState = { version: 1, account: { id: performanceValue.account.id, name: "", connectionRevision: text(performanceValue.account.connectionRevision, 200) },
        status: ["ready", "limited", "syncing", "error", "rate_limited"].includes(String(performanceValue.status)) ? performanceValue.status as InstagramPerformanceState["status"] : "not_connected",
        detail: "", lastSuccessfulSyncAt: date(performanceValue.lastSuccessfulSyncAt, now), lastSuccessfulBatchAt: date(performanceValue.lastSuccessfulBatchAt, now),
        videos: videos.filter(video => video.creationType === kind), scannedVideos: videos.length, historyComplete: false };
      strongerTopics.push(...instagramPerformanceSummary(state, now).topicPreferences.map(topic => ({ topic: topic.topic, workflow: kind, evidenceCount: topic.evidenceCount })));
    }
  }
  return { now, recent, feedback, strongerTopics: strongerTopics.slice(0, 12) };
}

async function boundedJson(filename: string, limit: number): Promise<{ value: unknown; mtimeMs: number } | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) return;
    handle = await fs.open(filename, "r");
    const bytes = Buffer.alloc(Math.min(limit + 1, stat.size + 1));
    let length = 0;
    while (length < bytes.length) { const chunk = await handle.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
    if (length > stat.size || length > limit) return;
    return { value: JSON.parse(bytes.toString("utf8", 0, length)), mtimeMs: stat.mtimeMs };
  } catch { return; }
  finally { await handle?.close(); }
}

/** No providers, models, media scans or credential reads; optional corrupt caches contribute no evidence. */
export async function loadSuggestionContext(now = Date.now(), root = process.cwd()): Promise<SuggestionContext> {
  const reviewsRoot = path.join(root, "storage", "Phoenix Studio Review Files");
  const review = await boundedJson(path.join(reviewsRoot, "index.json"), 8 * 1024 * 1024);
  const feedback = await boundedJson(path.join(reviewsRoot, "manager-feedback.json"), 512 * 1024);
  const performance = await boundedJson(path.join(process.env.PHOENIX_INSTAGRAM_PERFORMANCE_STORAGE || path.join(root, "storage", "private"), "instagram-performance.json"), 8 * 1024 * 1024);
  let currentPerformance: unknown;
  try {
    // Any newer account edit invalidates optional cached evidence without opening the encrypted vault.
    const channels = await fs.lstat(path.join(process.env.PHOENIX_CHANNEL_STORAGE || path.join(root, "storage", "private"), "channels.enc"));
    if (performance && channels.isFile() && !channels.isSymbolicLink() && channels.mtimeMs <= performance.mtimeMs) currentPerformance = performance.value;
  } catch { /* Missing channel metadata cannot establish a current cached account. */ }
  const context = suggestionContextFromMetadata(review?.value, feedback?.value, currentPerformance, now);
  const publicationsRoot = process.env.PHOENIX_PUBLISH_STORAGE || path.join(root, "storage", "private", "review-publications");
  for (const record of context.recent) {
    for (const platform of ["instagram", "youtube", "facebook"]) {
      const journal = await boundedJson(path.join(publicationsRoot, `${record.reviewId}-${platform}.json`), 64 * 1024);
      const value = journal?.value;
      if (object(value) && value.version === 1 && id(value.id) && value.reviewId === record.reviewId && value.platform === platform && value.kind === undefined
        && value.status === "COMPLETE" && value.phase === "complete" && typeof value.remoteId === "string"
        && (platform === "youtube" ? /^[A-Za-z0-9_-]{11}$/ : /^\d{1,40}$/).test(value.remoteId)) {
        record.posted = true;
        break;
      }
    }
  }
  return context;
}
