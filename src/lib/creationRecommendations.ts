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
export const RECOMMENDATION_HISTORY_LIMIT = 256;
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

const seedBriefs: Record<string, string> = {
  "0-0": "Follow falling water into ripples; keep the waterfall setting through the final quiet detail.",
  "0-1": "Build from an approaching wave to foam retreating; finish on another clean arrival.",
  "0-2": "Follow nest materials and careful placement, ending on the nest rather than unrelated flying birds.",
  "0-3": "Move from a shaded canopy to light on the forest floor, with one consistent woodland mood.",
  "0-4": "Begin on a landing butterfly, follow its movement around flowers, and end as it lifts away.",
  "1-0": "Connect empty streets, opening shutters and morning movement without jumping between unrelated places.",
  "1-1": "Follow the path, a small trail detail and the wider landscape; end with the view, not a long speech.",
  "1-2": "Keep wet streets and reflections together; reveal the strongest reflection at the end.",
  "1-3": "Connect window views, passing fields and railway movement into one consistent countryside journey.",
  "2-0": "Show hands folding and pressing dough, explaining one visible texture change before the final shape.",
  "2-1": "Explain one shaping step using hands and clay; end on the visible result instead of unrelated workshop footage.",
  "2-2": "Follow measured grounds, pouring and the finished cup; make each spoken step match its shot.",
  "2-3": "Follow rough lines into shading and a finished detail; keep the drawing subject consistent.",
  "2-4": "Link a stall, fresh produce and a close detail, ending on the strongest color or texture.",
  "3-0": "Follow a stretch, a small look outside and a settled pose; keep the cat and window context together.",
  "3-1": "Build from a sniff to an interesting discovery, keeping the park setting and a clear finish.",
  "3-2": "Keep grazing, herd movement and a final wide field view together; avoid an unrelated beach scene.",
  "3-3": "Reveal an insect or flower detail after the wider garden view, with a concise final observation.",
  "4-0": "Contrast a vague wait message with the exact next action and when the customer will hear back.",
  "4-1": "Give a short example naming the delay, what is being done and the next update time.",
  "4-2": "Follow dough, trays and opening preparations; show one practical check before the first customer arrives.",
  "4-3": "Contrast just checking in with a message naming the customer's issue, next action and timing.",
  "5-0": "Turn one unclear request into an action someone can do today; finish with a concrete example.",
  "5-1": "Show the decision, needed information and one next step; skip a long list of meeting tips.",
  "5-2": "Compare the same task before and after, explaining the single change that produced a visible result.",
  "5-3": "Demonstrate a note with the current state, next action and who owns it, then show a complete example.",
  "6-0": "Compare two attempts at one line or shading exercise, ending with what changed.",
  "6-1": "Teach one word through an everyday example and a second use, not a long vocabulary list.",
  "6-2": "Compare shadow positions around the same object and explain the visible difference.",
  "6-3": "Start with one leaf, reveal veins or repeated shapes, and end with an observation viewers can try.",
  "7-0": "Show a cluttered starting point, one accessible arrangement and how a tool returns to its place.",
  "7-1": "Follow a pot, planting and a usable windowsill space; explain one manageable first step.",
  "7-2": "Show thread, button placement and the final fastening in order, with a short usable takeaway.",
  "7-3": "Separate the work area from storage and demonstrate the finished surface without a long checklist.",
  "8-0": "Connect the path, movement and one park detail, ending at a natural stopping point.",
  "8-1": "Keep cycling and the waterfront context together, with a stronger movement shot near the finish.",
  "8-2": "Show a hold, a deliberate move and the next stable position rather than a random sports montage.",
  "8-3": "Follow one attempt and a cleaner landing; end with the result instead of repeating the setup.",
  "9-0": "Use one small disagreement, a clear turn-taking action and a warm complete ending for ages 3–6.",
  "9-1": "Make the mess, one teamwork choice and the tidy result visible, with simple age-appropriate dialogue.",
  "9-2": "Give each friend one helpful action, then end on the star's happy return rather than another problem.",
  "9-3": "Follow the tangled kite, two patient actions and a successful flight with a complete ending.",
};
const seedRecommendations: CreationRecommendation[] = CONTENT_IDEAS.map(idea => {
  const kind: CreationKind = idea.workflow === "children-story" ? "Children's short story" : idea.workflow === "business" ? "Business video" : "General video";
  return {
    id: `catalogue-${idea.id}`,
    topicKey: canonicalRecommendationKey(idea.query),
    angleKey: canonicalRecommendationKey(idea.title),
    title: seedBriefs[idea.id] ? `${idea.title} — ${seedBriefs[idea.id]}` : idea.title,
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
  ["lake-reflection", "reveal", "Nature & places", "General video", "When a lake becomes a mirror — Start on a water detail, reveal the reflected landscape and explain what changes when ripples arrive."],
  ["coastal-tide", "movement", "Nature & places", "General video", "The shore changes with every wave — Connect approaching water, foam patterns and retreating water; end with one complete wave cycle."],
  ["alpine-valley", "scale", "Nature & places", "General video", "A small path beneath enormous mountains — Reveal the scale from a trail detail to a wider valley view, keeping one alpine setting."],
  ["fjord-shore", "reveal", "Nature & places", "General video", "Why a narrow shoreline feels so dramatic — Connect steep slopes, quiet water and the wider inlet without switching to an unrelated coast."],
  ["rail-window", "journey", "Nature & places", "General video", "The best part of a train journey is outside the window — Follow changing countryside views and end on the strongest passing landscape."],
  ["old-town-morning", "observation", "Nature & places", "General video", "An old town before the crowds arrive — Connect quiet lanes, shutters and one street detail into a short morning observation."],
  ["snow-texture", "contrast", "Nature & places", "General video", "Snow changes the way a landscape looks — Move from a textured close detail to the wider scene and finish on a clear visual contrast."],
  ["desert-lines", "patterns", "Nature & places", "General video", "Look at the lines wind leaves in sand — Reveal small ripples before the larger dune shapes, keeping the same desert context."],
  ["autumn-path", "color", "Nature & places", "General video", "One autumn walk, three details worth noticing — Connect a leaf, the path and the canopy; finish with the strongest matching color."],
  ["misty-woodland", "reveal", "Nature & places", "General video", "A forest gradually appearing through mist — Keep tree silhouettes, filtered light and the woodland floor together with a natural reveal."],
  ["otter-river", "observation", "Nature & places", "General video", "A small animal's busy moment beside the water — Follow a visible otter behavior, with one short explanation and no invented animal thoughts."],
  ["shore-birds", "movement", "Nature & places", "General video", "Watch a shorebird work along the waterline — Connect walking, searching and a clear final action, avoiding unrelated nest or sky footage."],
  ["bread-scoring", "process", "Food & craft", "General video", "One cut changes the look of a bread loaf — Show scoring and the resulting surface in order; explain only the visible baking step."],
  ["latte-pattern", "process", "Food & craft", "General video", "Follow a latte pattern from the first pour — Keep the cup and pouring action together, ending on the finished shape."],
  ["knife-onion", "technique", "Food & craft", "General video", "A neater way to prepare an onion — Demonstrate one controlled cutting step and its result without rushing or skipping safety."],
  ["ceramic-glaze", "contrast", "Food & craft", "General video", "A ceramic surface changes with glaze — Compare an untreated detail and the finish, explaining one visible texture or color change."],
  ["weaving-pattern", "process", "Food & craft", "General video", "Watch a woven pattern grow one pass at a time — Follow thread placement into a recognizable section and finish on the completed detail."],
  ["fruit-preparation", "process", "Food & craft", "General video", "From a whole fruit to a simple plate — Show a short preparation sequence and a finished arrangement using matching footage."],
  ["book-shelf-space", "comparison", "Practical life", "General video", "Make a bookshelf easier to use, not just prettier — Compare a crowded section with one clear grouping and a useful final arrangement."],
  ["entryway-shoes", "visible-system", "Practical life", "General video", "A small entryway that is easier to leave — Give keys, shoes and a day bag clear places, then show the next departure."],
  ["laundry-fold", "demonstration", "Practical life", "General video", "One consistent fold makes a drawer easier to scan — Show a single garment fold and the matching drawer arrangement."],
  ["desk-light", "comparison", "Practical life", "General video", "Notice what moving a lamp changes — Compare the same work surface before and after, ending on the clearer setup."],
  ["water-surface-tension", "experiment", "Science & curiosity", "General video", "Watch a water droplet hold its shape — Use one close observation to explain the surface, then show what changes when it spreads."],
  ["magnet-objects", "comparison", "Science & curiosity", "General video", "Which everyday objects respond to a magnet? — Compare a few visible objects, explain the difference and end with one simple test."],
  ["soap-bubble-light", "observation", "Science & curiosity", "General video", "The moving colors on a soap bubble — Follow one bubble surface and explain the shifting pattern without a long science lecture."],
  ["spinning-top", "observation", "Science & curiosity", "General video", "A spinning top changes as it slows — Connect the steady spin, wobble and natural stop with one concise explanation."],
  ["guitar-chord-change", "practice", "Hobbies", "General video", "Practice one clean guitar chord change — Compare slow finger placement and a smoother attempt, ending on that specific improvement."],
  ["camera-frame-choice", "comparison", "Hobbies", "General video", "Move a little and change the photograph — Compare two frames of the same subject and explain the useful composition difference."],
  ["customer-price-explanation", "comparison", "Work & business", "Business video", "Explain what a customer is paying for — Replace a vague price claim with the included work, one clear limit and the next step."],
  ["customer-order-update", "example", "Work & business", "Business video", "An order update that answers the actual question — Give a short example with the current stage, expected next action and update timing."],
  ["customer-feedback-response", "example", "Work & business", "Business video", "Respond to feedback without an empty apology — Acknowledge one specific issue, explain the action and close with a useful next step."],
  ["customer-handover", "demonstration", "Work & business", "Business video", "Finish a service with a clear handover — Show the completed work, one practical care note and how the customer can get help."],
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
