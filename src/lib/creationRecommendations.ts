import { CONTENT_IDEAS } from "./contentIdeas";
import { publishingProfile, type PublishingFormat } from "./publishingFormats";

export const CREATION_KINDS = ["Children's short story", "Children's song", "Business video", "General video"] as const;
export type CreationKind = typeof CREATION_KINDS[number];
export const RECOMMENDATION_GROUPS = ["Practical life", "Food & craft", "Nature & places", "Science & curiosity", "Hobbies", "Work & business", "Fiction", "Children"] as const;
type RecommendationGroup = typeof RECOMMENDATION_GROUPS[number];
export type CreationRecommendation = {
  id: string;
  topicKey: string;
  angleKey: string;
  title: string;
  category: RecommendationGroup;
  kind: CreationKind;
  audience: "General audience" | "Working adults" | "Ages 3–6";
};

export const RECOMMENDATION_STORAGE_KEY = "phoenix-recommendations-v1";
export const RECOMMENDATION_HISTORY_LIMIT = 96;
export type RecommendationMemory = { version: 1; shown: string[]; cursor: number };
export const emptyRecommendationMemory = (): RecommendationMemory => ({ version: 1, shown: [], cursor: 0 });

// Keys describe a subject, not its headline: another angle on the same subject
// must not masquerade as a completely fresh topic on the next visit.
export function canonicalRecommendationKey(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function seedGroup(category: string): RecommendationGroup {
  if (category === "Children's original stories") return "Children";
  if (category === "Food & craft") return "Food & craft";
  if (category === "Small business" || category === "Work & practical skills") return "Work & business";
  if (category === "Everyday learning") return "Science & curiosity";
  if (category === "Home & hobbies" || category === "Movement & outdoors") return "Hobbies";
  return "Nature & places";
}

const seedRecommendations: CreationRecommendation[] = CONTENT_IDEAS.map(idea => {
  const kind: CreationKind = idea.workflow === "children-story" ? "Children's short story" : idea.workflow === "business" ? "Business video" : "General video";
  return {
    id: `catalogue-${idea.id}`,
    topicKey: canonicalRecommendationKey(idea.query),
    angleKey: canonicalRecommendationKey(idea.title),
    title: idea.title,
    category: seedGroup(idea.category),
    kind,
    audience: kind === "Children's short story" ? "Ages 3–6" : kind === "Business video" ? "Working adults" : "General audience",
  };
});

// These are editorial starting points, not claimed live trends or model output.
// Fiction currently uses the supported children's 2D workflow; no unsupported
// adult-fiction renderer or automatic song generation is implied by a card.
const additions: Array<[string, string, RecommendationGroup, CreationKind, string]> = [
  ["packing-a-bag", "checklist", "Practical life", "General video", "Pack a day bag by walking through the day ahead"],
  ["finding-lost-items", "retracing", "Practical life", "General video", "Retrace your steps when a small everyday item goes missing"],
  ["fridge-leftovers", "visible-system", "Practical life", "General video", "An eat-first shelf that makes yesterday's leftovers easier to spot"],
  ["instructions", "demonstration", "Practical life", "General video", "Show one clear step instead of giving five instructions at once"],
  ["choosing-a-route", "comparison", "Practical life", "General video", "Compare two walking routes: shade, crossings and quieter streets"],
  ["paper-folding", "experiment", "Science & curiosity", "General video", "Why a folded sheet of paper can hold more than a flat one"],
  ["reflections", "observation", "Science & curiosity", "General video", "Look for the difference between a reflection and a shadow"],
  ["evaporation", "observation", "Science & curiosity", "General video", "Follow a puddle as it slowly disappears after the rain"],
  ["seeds", "comparison", "Science & curiosity", "General video", "Compare the different ways seeds travel: float, cling and glide"],
  ["pottery-wheel-hands", "process", "Food & craft", "General video", "Follow a lump of clay from rough shape to the potter's final rim"],
  ["kneading-bread-dough", "texture", "Food & craft", "General video", "Watch how the surface of bread dough changes while it is kneaded"],
  ["herbs-windowsill", "small-space", "Hobbies", "General video", "Make room for one useful herb on a small windowsill"],
  ["bird-nest", "materials", "Nature & places", "General video", "The tiny materials a bird carries while building a nest"],
  ["repair-shop-customer", "comparison", "Work & business", "Business video", "A vague repair update versus an update a customer can act on"],
  ["bakery-preparing-bread", "behind-the-scenes", "Work & business", "Business video", "Show the small checks a bakery makes before opening its doors"],
  ["moon-mail", "misunderstanding", "Fiction", "Children's short story", "A little owl delivers a letter to the moon and discovers a new friend"],
  ["paper-boat-journey", "teamwork", "Fiction", "Children's short story", "Two friends guide a paper boat around a leaf without spoiling its voyage"],
  ["rainbow-puddle", "discovery", "Fiction", "Children's short story", "A curious bunny tries to carry a rainbow home from a puddle"],
  ["missing-bell", "listening", "Fiction", "Children's short story", "A fox follows gentle sounds to find a lost little bell"],
  ["tiny-stage", "courage", "Fiction", "Children's short story", "A shy bear finds a way to join the forest puppet show"],
  ["toy-tidy-song", "call-and-response", "Children", "Children's song", "An original tidy-up song with a place for every toy"],
  ["rainy-day-song", "rhythm", "Children", "Children's song", "An original rainy-day song with soft taps and puddle splashes"],
  ["butterfly-counting-song", "counting", "Children", "Children's song", "An original counting song as five butterflies visit a garden"],
];

const RECOMMENDATIONS: CreationRecommendation[] = [...seedRecommendations, ...additions.map(([topicKey, angleKey, category, kind, title]) => ({
  id: `${topicKey}:${angleKey}`, topicKey, angleKey, category, kind, title,
  audience: kind.startsWith("Children") ? "Ages 3–6" as const : kind === "Business video" ? "Working adults" as const : "General audience" as const,
}))];
const recommendationById = new Map(RECOMMENDATIONS.map(idea => [idea.id, idea]));

export function recommendationPool(): CreationRecommendation[] { return [...RECOMMENDATIONS]; }

export function parseRecommendationMemory(raw: string | null): RecommendationMemory {
  if (!raw || raw.length > 32_768) return emptyRecommendationMemory();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return emptyRecommendationMemory();
    const candidate = value as Partial<RecommendationMemory>;
    if (candidate.version !== 1 || !Array.isArray(candidate.shown)) return emptyRecommendationMemory();
    const known = candidate.shown.slice(-RECOMMENDATION_HISTORY_LIMIT).filter((id): id is string => typeof id === "string" && recommendationById.has(id));
    const shown = [...new Set(known.slice().reverse())].reverse();
    const cursor = Number.isSafeInteger(candidate.cursor) && Number(candidate.cursor) >= 0 ? Number(candidate.cursor) % RECOMMENDATION_GROUPS.length : 0;
    return { version: 1, shown, cursor };
  } catch { return emptyRecommendationMemory(); }
}

export function creationRecommendations(memory = emptyRecommendationMemory()): { ideas: CreationRecommendation[]; memory: RecommendationMemory } {
  const safe = parseRecommendationMemory(JSON.stringify(memory));
  const shown = safe.shown.map(id => recommendationById.get(id)!);
  const lastTopic = new Map(shown.map((idea, index) => [idea.topicKey, index]));
  const lastAngle = new Map(shown.map((idea, index) => [`${idea.topicKey}:${idea.angleKey}`, index]));
  const ideas: CreationRecommendation[] = [];
  const usedTopics = new Set<string>();
  const usedGroups = new Set<RecommendationGroup>();
  while (ideas.length < 6) {
    const candidates = RECOMMENDATIONS.filter(idea => !usedTopics.has(idea.topicKey));
    if (!candidates.length) break;
    const unseen = candidates.filter(idea => !lastTopic.has(idea.topicKey));
    // Exhaust unseen subjects first. Once the catalogue is exhausted, reuse
    // least-recent subjects/angles instead of producing an empty or stuck list.
    const available = unseen.length ? unseen : candidates;
    const differentGroup = available.filter(idea => !usedGroups.has(idea.category));
    const varied = differentGroup.length ? differentGroup : available;
    varied.sort((a, b) => {
      if (!unseen.length) {
        const recency = (lastTopic.get(a.topicKey) ?? -1) - (lastTopic.get(b.topicKey) ?? -1);
        if (recency) return recency;
      }
      const groupOrder = (idea: CreationRecommendation) => (RECOMMENDATION_GROUPS.indexOf(idea.category) - safe.cursor + RECOMMENDATION_GROUPS.length) % RECOMMENDATION_GROUPS.length;
      return groupOrder(a) - groupOrder(b) || (lastAngle.get(`${a.topicKey}:${a.angleKey}`) ?? -1) - (lastAngle.get(`${b.topicKey}:${b.angleKey}`) ?? -1);
    });
    const choice = varied[0];
    ideas.push(choice);
    usedTopics.add(choice.topicKey);
    usedGroups.add(choice.category);
  }
  const selectedIds = new Set(ideas.map(idea => idea.id));
  return {
    ideas,
    memory: { version: 1, shown: [...safe.shown.filter(id => !selectedIds.has(id)), ...selectedIds].slice(-RECOMMENDATION_HISTORY_LIMIT), cursor: (safe.cursor + 6) % RECOMMENDATION_GROUPS.length },
  };
}

type RecommendationStorage = Pick<Storage, "getItem" | "setItem">;
export function nextStoredRecommendations(storage: RecommendationStorage, fallback = emptyRecommendationMemory()) {
  let current = fallback;
  let remembered = true;
  try {
    const saved = parseRecommendationMemory(storage.getItem(RECOMMENDATION_STORAGE_KEY));
    if (saved.shown.length) current = parseRecommendationMemory(JSON.stringify({ ...saved, shown: [...fallback.shown, ...saved.shown] }));
  } catch { remembered = false; }
  const next = creationRecommendations(current);
  try { storage.setItem(RECOMMENDATION_STORAGE_KEY, JSON.stringify(next.memory)); }
  catch { remembered = false; }
  return { ...next, remembered };
}

type RecommendationForm = { kind: CreationKind; topic: string; autoIdea: boolean; publishingFormat: PublishingFormat; duration: number; batchCount: 1 | 10; narration: string };
export function applyRecommendationToForm<T extends RecommendationForm>(current: T, recommendation: CreationRecommendation) {
  const idea = recommendationById.get(recommendation.id);
  if (!idea || typeof recommendation.title !== "string" || !recommendation.title.trim() || recommendation.title.length > 400
      || /[\u0000-\u001f\u007f]/.test(recommendation.title)) return current;
  const changedType = current.kind !== idea.kind;
  const format = changedType ? idea.kind === "Children's song" ? "youtube-full" : "youtube-short" : current.publishingFormat;
  return {
    ...current,
    kind: idea.kind,
    // Keep the visible card's exact sentence. The registered ID controls the
    // supported workflow, but never substitutes a different catalogue title.
    topic: recommendation.title,
    autoIdea: false,
    publishingFormat: format,
    duration: changedType ? publishingProfile(format).defaultDuration : current.duration,
    batchCount: changedType ? (idea.kind === "Children's short story" && !current.narration.trim() ? 10 : 1) as 1 | 10 : current.batchCount,
  };
}
