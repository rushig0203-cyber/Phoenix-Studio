import { recommendationPool, type CreationRecommendation } from "./creationRecommendations";
import { stockTopicPool } from "./stockFootageSuggestions";
import type { ContentIdea } from "./contentIdeas";
import type { InstagramPerformanceResponse } from "./instagramPerformanceTypes";

export type InstagramTopicSuggestion =
  | { target: "stock"; idea: ContentIdea; evidenceCount: number }
  | { target: "creation"; idea: CreationRecommendation; evidenceCount: number };

const freshness = 48 * 60 * 60 * 1000;
const ignored = new Set("a an and are as at be by for from how i in into is it its of on one our that the their this to video videos reel reels with your good great best new make show use using clip clips footage content view views likes like scene scenes minute minutes second seconds original".split(" "));
const fresh = (value: string | undefined, now: number) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) && time <= now + 300_000 && now - time <= freshness;
};
function words(value: string) {
  return new Set(value.normalize("NFKC").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !ignored.has(word)).map(word => word.endsWith("ies") && word.length > 5 ? `${word.slice(0, -3)}y` : word.endsWith("s") && word.length >= 4 && !/(ss|us)$/.test(word) ? word.slice(0, -1) : word));
}
const creationType = (idea: CreationRecommendation) => idea.kind === "Business video" ? "business" : idea.kind === "Children's short story" ? "children-story" : idea.kind === "Children's song" ? "children-song" : "general";
const topicKey = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/** Reuse only registered editorial cards; local evidence never becomes a raw prompt. */
export function instagramTopicSuggestions(data: InstagramPerformanceResponse | null, target: InstagramTopicSuggestion["target"], now = Date.now()): InstagramTopicSuggestion[] {
  if (!data?.account?.id || !data.account.connectionRevision || ["not_connected", "permission_required"].includes(data.status)
    || !fresh(data.lastSuccessfulSyncAt, now) || !Array.isArray(data.videos) || !Array.isArray(data.summary?.topicPreferences) || !Array.isArray(data.summary?.assessments)) return [];
  const strong = new Set(data.summary.assessments.filter(item => item?.label === "stronger" && typeof item.videoId === "string").map(item => item.videoId));
  const stock = stockTopicPool(), creation = recommendationPool();
  const suggestions: InstagramTopicSuggestion[] = [], used = new Set<string>(), usedTopics = new Set<string>();
  for (const preference of data.summary.topicPreferences.slice(0, 6)) {
    if (typeof preference?.topic !== "string" || !preference.topic.trim() || preference.topic.length > 120 || /[\u0000-\u001f\u007f]/.test(preference.topic)
      || !Number.isSafeInteger(preference.evidenceCount) || preference.evidenceCount < 2 || !Array.isArray(preference.reviewIds)) continue;
    if (usedTopics.has(topicKey(preference.topic))) continue;
    const ids = new Set(preference.reviewIds.filter(id => typeof id === "string" && id));
    const matched = data.videos.filter(video => video?.reviewId && ids.has(video.reviewId) && strong.has(video.id) && fresh(video.metricsUpdatedAt, now)
      && typeof video.topic === "string" && topicKey(video.topic) === topicKey(preference.topic));
    const topicWords = words(preference.topic);
    const evidence = (type: string) => new Set(matched.filter(video => video.creationType === type).map(video => video.reviewId)).size;
    const candidates = target === "stock"
      ? stock.filter(() => evidence("source") >= 2).map(idea => ({ idea, evidenceCount: evidence("source"), terms: words(idea.query) }))
      : creation.filter(idea => evidence(creationType(idea)) >= 2).map(idea => ({ idea, evidenceCount: evidence(creationType(idea)), terms: words(`${idea.topicKey} ${idea.title.split(" — ")[0]}`) }));
    const ranked = candidates.map(candidate => ({ ...candidate, score: [...topicWords].filter(word => candidate.terms.has(word)).length }))
      .filter(candidate => candidate.score > 0 && !used.has(candidate.idea.id))
      .sort((a, b) => b.score - a.score || a.terms.size - b.terms.size);
    const choice = ranked[0];
    if (!choice) continue;
    used.add(choice.idea.id);
    usedTopics.add(topicKey(preference.topic));
    suggestions.push(target === "stock" ? { target, idea: choice.idea as ContentIdea, evidenceCount: choice.evidenceCount } : { target, idea: choice.idea as CreationRecommendation, evidenceCount: choice.evidenceCount });
    if (suggestions.length === 2) break;
  }
  return suggestions;
}
