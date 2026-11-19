import { CONTENT_IDEAS, type ContentIdea, type SuggestionContext, type SuggestionReason } from "./contentIdeas";

export const FOOTAGE_SUGGESTION_STORAGE_KEY = "phoenix-footage-suggestions-v1";
export const FOOTAGE_SUGGESTION_COUNT = 6;
export const FOOTAGE_SUGGESTION_REFRESH_MS = 15 * 24 * 60 * 60 * 1000;
// Keep the existing IDs/cursor order; append visual keywords rather than scripted premises.
const topics: Record<string, readonly [string, string]> = {
  "0-0": ["Nature", "nature"], "0-1": ["Ocean", "ocean"], "0-2": ["Birds", "birds"],
  "0-3": ["Forest", "forest"], "0-4": ["Butterflies", "butterflies"],
  "1-0": ["Cities", "city"], "1-1": ["Mountains", "mountains"], "1-2": ["Rain", "rain"], "1-3": ["Train", "train"],
  "2-0": ["Baking", "baking"], "2-1": ["Pottery", "pottery"], "2-2": ["Coffee", "coffee"], "2-3": ["Drawing", "drawing"], "2-4": ["Markets", "market"],
  "3-0": ["Cats", "cat"], "3-1": ["Dogs", "dog"], "3-2": ["Horses", "horses"], "3-3": ["Gardens", "garden"],
  "8-0": ["Parks", "park"], "8-1": ["Cycling", "cycling"], "8-2": ["Climbing", "climbing"], "8-3": ["Skating", "skateboard"],
};
const extraTopics: Array<{ category: string; titles: string[] }> = [
  { category: "Places & travel", titles: ["Switzerland", "Norway", "Iceland", "Italy", "Japan", "Canada", "Scotland", "Austria", "New Zealand", "Alps", "Dolomites", "Fjords", "Glaciers", "Lighthouse", "Coastal road", "Countryside"] },
  { category: "Nature & wildlife", titles: ["Waterfall", "Lake", "River", "Beach", "Sunset", "Sunrise", "Aurora", "Desert", "Dunes", "Cliffs", "Island", "Meadow", "Snow", "Rainforest", "Tulips", "Lavender", "Autumn", "Spring"] },
  { category: "Animals & everyday moments", titles: ["Dolphins", "Turtles", "Deer", "Foxes", "Owls", "Penguins", "Elephants", "Jellyfish", "Otters", "Whales", "Seals", "Giraffes", "Lions", "Pandas", "Rabbits", "Flamingos", "Parrots", "Squirrels", "Dragonflies", "Bees"] },
  { category: "Movement & outdoors", titles: ["Steam train", "Railway", "Tram", "Sailing", "Kayaking", "Skiing", "Surfing", "Hiking"] },
  { category: "Architecture & design", titles: ["Architecture", "Bridges", "Castles", "Skyscrapers", "Libraries", "Museums", "Courtyards", "Staircases", "Old town", "Stone streets", "Windmills", "Greenhouses", "Lighthouses", "City lights", "Glass buildings", "Wooden houses"] },
];
// Country + one visible subject stays searchable; landlocked places do not
// receive invented coast/beach suggestions. These are not filming-location claims.
const countryTopics: Array<[string, string[]]> = [
  ["Switzerland", ["lakes", "mountains", "trains", "valleys", "villages", "waterfalls"]],
  ["Norway", ["fjords", "coast", "waterfalls", "mountains", "villages", "trains"]],
  ["Iceland", ["waterfalls", "glaciers", "coast", "volcanoes", "lagoons", "aurora"]],
  ["Italy", ["coast", "mountains", "villages", "lakes", "canals", "countryside"]],
  ["Japan", ["gardens", "trains", "forests", "mountains", "coast", "blossoms"]],
  ["Canada", ["lakes", "forests", "mountains", "coast", "trains", "snow"]],
  ["Scotland", ["lakes", "castles", "coast", "highlands", "villages", "trains"]],
  ["Austria", ["mountains", "lakes", "villages", "trains", "valleys", "forests"]],
  ["France", ["villages", "coast", "vineyards", "mountains", "lavender", "trains"]],
  ["Germany", ["castles", "forests", "lakes", "trains", "villages", "rivers"]],
  ["Portugal", ["coast", "cliffs", "villages", "trams", "vineyards", "waves"]],
  ["Spain", ["coast", "villages", "mountains", "fields", "cities", "trains"]],
  ["Greece", ["islands", "coast", "villages", "boats", "cliffs", "sunset"]],
  ["Croatia", ["coast", "islands", "waterfalls", "villages", "boats", "forests"]],
  ["Slovenia", ["lakes", "mountains", "forests", "rivers", "villages", "waterfalls"]],
  ["Finland", ["lakes", "forests", "snow", "aurora", "cabins", "coast"]],
  ["Sweden", ["lakes", "forests", "islands", "villages", "trains", "snow"]],
  ["Netherlands", ["canals", "windmills", "tulips", "cycling", "villages", "coast"]],
  ["Ireland", ["cliffs", "coast", "castles", "countryside", "villages", "rivers"]],
  ["Nepal", ["mountains", "valleys", "villages", "rivers", "forests", "trails"]],
  ["Indonesia", ["islands", "waterfalls", "forests", "volcanoes", "beaches", "terraces"]],
  ["Thailand", ["islands", "beaches", "forests", "waterfalls", "boats", "villages"]],
  ["Australia", ["coast", "beaches", "desert", "forests", "reefs", "wildlife"]],
  ["Chile", ["mountains", "glaciers", "desert", "lakes", "coast", "forests"]],
];
const ideas: ContentIdea[] = [...CONTENT_IDEAS.filter(idea => idea.workflow === "stock-reel").map(idea => {
  const title = topics[idea.id]?.[0] || idea.query.split(/\s+/).slice(0, 2).join(" ");
  // The selected chip must insert what it displays, not a hidden singular or
  // alternate keyword. Providers still receive the same broad topic.
  return { ...idea, title, query: title };
}), ...extraTopics.flatMap(({ category, titles }) => titles.map(title => ({ id: `footage-${title.toLowerCase().replace(/\s+/g, "-")}`, category, title, query: title, workflow: "stock-reel" as const }))),
...countryTopics.flatMap(([country, subjects]) => subjects.map(subject => {
  const title = `${country} ${subject}`;
  return { id: `footage-${country.toLowerCase()}-${subject}`, category: "Places & travel", title, query: title, workflow: "stock-reel" as const };
}))];
// Balance each visible batch; a long country list must not crowd out wildlife.
const animals = new Set(["Birds", "Butterflies", "Cats", "Dogs", "Horses", ...extraTopics[2].titles]);
const places = new Set(extraTopics[0].titles);
const nature = new Set(["Nature", "Ocean", "Forest", "Mountains", "Rain", "Gardens", "Parks"]);
const pools: ContentIdea[][] = Array.from({ length: FOOTAGE_SUGGESTION_COUNT }, () => []);
for (const idea of ideas) {
  const group = animals.has(idea.title) ? 0
    : idea.category === "Nature & wildlife" || nature.has(idea.title) ? 1
    : places.has(idea.title) ? 2
    : idea.category === "Movement & outdoors" || idea.title === "Train" ? 3
    : idea.category === "Architecture & design" || idea.title === "Cities" ? 4
    : countryTopics.some(([country]) => idea.title.startsWith(country + " ")) ? 2 : 5;
  pools[group].push(idea);
}
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const cursorLimit = pools.reduce((period, pool) => period / gcd(period, pool.length) * pool.length, 1) * FOOTAGE_SUGGESTION_COUNT;
function validCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < cursorLimit;
}
export function stockFootageSuggestions(cursor = 0): ContentIdea[] {
  const start = validCursor(cursor) ? cursor : 0;
  const batch = Math.floor(start / FOOTAGE_SUGGESTION_COUNT);
  return pools.map(pool => pool[batch % pool.length]);
}
export function stockTopicPool(): ContentIdea[] { return [...ideas]; }
const byId = new Map(ideas.map(idea => [idea.id, idea]));
type SuggestionStorage = Pick<Storage, "getItem" | "setItem">;
function storedFootageSuggestions(storage: SuggestionStorage, fallbackCursor = 0) {
  let cursor = validCursor(fallbackCursor) ? fallbackCursor : 0;
  let seen: string[] = [], remembered = true;
  try {
    const raw = storage.getItem(FOOTAGE_SUGGESTION_STORAGE_KEY);
    if (raw && raw.length <= 8192) {
      const saved = JSON.parse(raw);
      if (saved?.version === 1 && validCursor(saved.cursor)) {
        cursor = saved.cursor;
        if (Array.isArray(saved.seen)) {
          const known: string[] = saved.seen.filter((id: unknown): id is string => typeof id === "string" && byId.has(id));
          seen = [...new Set(known)].slice(-48);
        }
      }
    }
  } catch { remembered = false; }
  return { cursor, seen, remembered };
}
export function nextStoredFootageSuggestions(storage: Pick<Storage, "getItem" | "setItem">, fallbackCursor = 0) {
  const { cursor, seen, remembered: loaded } = storedFootageSuggestions(storage, fallbackCursor);
  let remembered = loaded;
  const nextCursor = (cursor + FOOTAGE_SUGGESTION_COUNT) % cursorLimit;
  try { storage.setItem(FOOTAGE_SUGGESTION_STORAGE_KEY, JSON.stringify({ version: 1, cursor: nextCursor, seen })); }
  catch { remembered = false; }
  return { ideas: stockFootageSuggestions(cursor), cursor, nextCursor, seen, remembered };
}
/** Record the batch actually displayed; a pending request has shown no new topics. */
export function recordStoredFootageSuggestions(storage: SuggestionStorage, batch: Array<{ id: string } | string>, nextCursor: number) {
  const saved = storedFootageSuggestions(storage, nextCursor);
  const shown = batch.slice(0, FOOTAGE_SUGGESTION_COUNT).map(idea => typeof idea === "string" ? idea : idea.id).filter(id => byId.has(id));
  const seen = [...saved.seen.filter(id => !shown.includes(id)), ...new Set(shown)].slice(-48);
  const cursor = validCursor(nextCursor) ? nextCursor : saved.cursor;
  let remembered = saved.remembered;
  try { storage.setItem(FOOTAGE_SUGGESTION_STORAGE_KEY, JSON.stringify({ version: 1, cursor, seen })); }
  catch { remembered = false; }
  return { seen, cursor, remembered };
}

const subjectWords = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const subjectPhrase = (value: string) => subjectWords(value).replace(/\b(?:bunny|bunnies)\b/g, "rabbit").replace(/\bbutterflies\b/g, "butterfly")
  .replace(/\bcities\b/g, "city").replace(/\bleaves\b/g, "leaf").replace(/\b([a-z]{3,})s\b/g, "$1");
const familyNames = ["wildlife", "nature", "travel", "outdoor movement", "architecture", "hands-on"];
const familyCues = [
  /\b(?:animals?|wildlife|birds?|butterfl(?:y|ies)|cats?|kittens?|dogs?|pupp(?:y|ies)|horses?|dolphins?|turtles?|deer|fox(?:es)?|owls?|penguins?|elephants?|jellyfish|otters?|whales?|seals?|giraffes?|lions?|pandas?|rabbits?|bunn(?:y|ies)|flamingos?|parrots?|squirrels?|dragonfl(?:y|ies)|bees?)\b/,
  /\b(?:nature|forests?|woodlands?|trees?|leaves|foliage|gardens?|parks?|waterfalls?|lakes?|rivers?|ocean|sea|beach(?:es)?|sunsets?|sunrises?|aurora|deserts?|dunes?|cliffs?|islands?|meadows?|snow|rainforests?|tulips?|lavender|autumn|spring|mountains?|glaciers?|fjords?|landscapes?)\b/,
  /\b(?:travel|scenery|scenic|alps|dolomites|countryside|coastal|villages?|journey|switzerland|norway|iceland|italy|japan|canada|scotland|austria|zealand|france|germany|portugal|spain|greece|croatia|slovenia|finland|sweden|netherlands|ireland|nepal|indonesia|thailand|australia|chile)\b/,
  /\b(?:trains?|railway|trams?|sailing|sailboats?|kayak(?:ing)?|skiing|surfing|hiking|cycling|bicycle|climbing|skating|skateboard)\b/,
  /\b(?:architecture|bridges?|castles?|skyscrapers?|libraries|library|museums?|courtyards?|staircases?|town|streets?|windmills?|greenhouses?|lighthouses?|buildings?|houses?|city|cities)\b/,
  /\b(?:bak(?:e|ing)|bread|pottery|clay|coffee|drawing|sketch|markets?|craft|cooking|kitchen|weaving)\b/,
];
const countryNames = [...countryTopics.map(([name]) => name), "New Zealand"];
function subjectKey(value: string) {
  const text = subjectWords(value);
  const country = countryNames.find(name => new RegExp(`\\b${name.toLowerCase()}\\b`).test(text));
  if (country) return `country:${country.toLowerCase()}`;
  if (/\b(?:steam train|trains?|railway)\b/.test(text)) return "train";
  return subjectPhrase(text);
}
const ideaGroup = new Map(pools.flatMap((pool, group) => pool.map(idea => [idea.id, group] as const)));
const hash = (value: string) => [...value].reduce((result, character) => (result * 31 + character.charCodeAt(0)) >>> 0, 0);
function mentionedSubjects(value: string) {
  const phrase = ` ${subjectPhrase(value)} `;
  return ideas.filter(idea => phrase.includes(` ${subjectPhrase(idea.query)} `)).map(idea => subjectKey(idea.query));
}

/** Relevance comes from saved content, not a generic rotating country list or an extra model call. */
export function personalizedStockSuggestions(context: SuggestionContext, cursor = 0, seen: string[] = []): { ideas: Array<ContentIdea & SuggestionReason>; nextCursor: number } {
  const safeCursor = Number.isSafeInteger(cursor) && cursor >= 0 && cursor < 1_000_000 ? cursor : 0;
  const period = Math.floor(context.now / FOOTAGE_SUGGESTION_REFRESH_MS);
  const recent = context.recent.filter(record => record.workflow === "stock-reel" && !record.news).slice(0, 120);
  const blocked = new Set(recent.flatMap(record => [subjectKey(record.title), ...mentionedSubjects(`${record.title} ${record.observations.slice(0, 3).join(" ")}`)]));
  const lastShown = new Map<string, number>();
  seen.slice(-48).forEach((id, index) => {
    const idea = byId.get(id);
    if (idea) lastShown.set(subjectKey(idea.query), index);
  });
  const feedback = new Map(context.feedback.slice(0, 120).map(record => [record.reviewId, record]));
  const rankingHistory = recent.some(record => record.posted)
    ? recent.filter(record => record.posted || feedback.get(record.reviewId)?.decision === "keep") : recent;
  const scores = familyNames.map(() => 0), kept = familyNames.map(() => 0), posted = familyNames.map(() => 0), measured = familyNames.map(() => 0);
  for (const record of rankingHistory.slice(0, 30)) {
    const age = Math.max(0, (context.now - Date.parse(record.createdAt)) / 86_400_000);
    const weight = Number.isFinite(age) ? (record.posted ? 8 : 4) / (1 + age / 15) : 0;
    const literal = subjectWords(record.observations.length ? record.observations.slice(0, 3).join(" ") : record.title);
    const review = feedback.get(record.reviewId);
    const approved = review?.decision === "keep" && review.storyRating >= 3 && review.visualRating >= 3;
    familyCues.forEach((cue, group) => { if (cue.test(literal)) {
      scores[group] += weight + (approved ? 4 : 0);
      if (approved) kept[group]++;
      if (record.posted) posted[group]++;
    } });
  }
  for (const preference of context.strongerTopics.slice(0, 12)) {
    if (preference.workflow !== "stock-reel" || preference.evidenceCount < 2) continue;
    familyCues.forEach((cue, group) => { if (cue.test(subjectWords(preference.topic))) { scores[group] += Math.min(4, preference.evidenceCount); measured[group] += preference.evidenceCount; } });
  }
  const hasProfile = scores.some(score => score > 0);
  const affinity = scores.map((score, group) => score + (group === 1 ? scores[0] * .35 : group === 2 ? scores[1] * .15 : 0)
    + [0.006, 0.005, 0.003, 0.004, 0.002, 0.001][group]);
  const candidates = ideas.filter(idea => !hasProfile || idea.title !== "Nature")
    .map(idea => ({ idea, subject: subjectKey(idea.query), group: ideaGroup.get(idea.id)!, tie: hash(`${period}:${safeCursor}:${idea.id}`) }))
    .sort((a, b) => (hasProfile ? affinity[b.group] - affinity[a.group] : 0) || a.tie - b.tie || a.idea.id.localeCompare(b.idea.id));
  const selected: typeof candidates = [], usedGroups = new Map<number, number>(), usedSubjects = new Set<string>();
  let countryUsed = false;
  function pickFrom(available: typeof candidates) {
    const variety = Math.min(hasProfile ? 4 : 6, new Set(available.map(candidate => candidate.group)).size);
    while (selected.length < FOOTAGE_SUGGESTION_COUNT) {
      const choice = available.find(candidate => !usedSubjects.has(candidate.subject)
        && (usedGroups.get(candidate.group) || 0) < 2
        && (usedGroups.size >= variety || !usedGroups.has(candidate.group))
        && (!countryUsed || !candidate.subject.startsWith("country:")));
      if (!choice) break;
      selected.push(choice);
      usedSubjects.add(choice.subject);
      usedGroups.set(choice.group, (usedGroups.get(choice.group) || 0) + 1);
      countryUsed ||= choice.subject.startsWith("country:");
    }
  }
  const outsideRecentHistory = candidates.filter(candidate => !blocked.has(candidate.subject));
  pickFrom(outsideRecentHistory.filter(candidate => !lastShown.has(candidate.subject)));
  if (selected.length < FOOTAGE_SUGGESTION_COUNT - 1) {
    // Keep fresh choices and revisit the oldest suggestions when the rotation runs low.
    const byLastShown = [...candidates].sort((a, b) => (lastShown.get(a.subject) ?? -1) - (lastShown.get(b.subject) ?? -1));
    pickFrom(byLastShown.filter(candidate => !blocked.has(candidate.subject)));
    if (selected.length < FOOTAGE_SUGGESTION_COUNT - 1) pickFrom(byLastShown);
  }
  const exploration = ["A fresh wildlife subject with one consistent setting.", "Explore a different natural setting and visual thread.", "A new place to explore with source-supported footage.", "Follow one journey or outdoor activity to its natural ending.", "A visual change of pace using related buildings and details.", "Try one clear hands-on process and its finished result."];
  return { ideas: selected.map(({ idea, group }) => ({ ...idea,
    basis: measured[group] ? "observed-response" as const : kept[group] ? "owner-feedback" as const : scores[group] > 0 ? "recent-content" as const : "explore" as const,
    reason: measured[group] ? `Try a new ${familyNames[group]} angle related to your measured Instagram results.`
      : kept[group] ? `Related to ${familyNames[group]} reels you kept, with a different subject.`
        : posted[group] ? `Related to your posted ${familyNames[group]} reels, with a fresh subject.`
          : scores[group] > 0 ? `Based on your recent ${familyNames[group]} reels, with a fresh subject.` : exploration[group],
  })), nextCursor: (safeCursor + FOOTAGE_SUGGESTION_COUNT) % 1_000_000 };
}
