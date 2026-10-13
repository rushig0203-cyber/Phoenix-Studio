import { CONTENT_IDEAS, type ContentIdea } from "./contentIdeas";

export const FOOTAGE_SUGGESTION_STORAGE_KEY = "phoenix-footage-suggestions-v1";
export const FOOTAGE_SUGGESTION_COUNT = 6;
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
  { category: "Animals & everyday moments", titles: ["Dolphins", "Turtles", "Deer", "Foxes", "Owls", "Penguins", "Elephants", "Jellyfish"] },
  { category: "Movement & outdoors", titles: ["Steam train", "Railway", "Tram", "Sailing", "Kayaking", "Skiing", "Surfing", "Hiking"] },
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
function validCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < ideas.length;
}
export function stockFootageSuggestions(cursor = 0): ContentIdea[] {
  const start = validCursor(cursor) ? cursor : 0;
  return Array.from({ length: Math.min(FOOTAGE_SUGGESTION_COUNT, ideas.length) }, (_, index) => ideas[(start + index) % ideas.length]);
}
export function nextStoredFootageSuggestions(storage: Pick<Storage, "getItem" | "setItem">, fallbackCursor = 0) {
  let cursor = validCursor(fallbackCursor) ? fallbackCursor : 0;
  let remembered = true;
  try {
    const raw = storage.getItem(FOOTAGE_SUGGESTION_STORAGE_KEY);
    if (raw && raw.length <= 256) {
      const saved = JSON.parse(raw);
      if (saved?.version === 1 && validCursor(saved.cursor)) cursor = saved.cursor;
    }
  } catch { remembered = false; /* Continue in memory if browser storage is unavailable/corrupt. */ }
  const nextCursor = (cursor + FOOTAGE_SUGGESTION_COUNT) % ideas.length;
  try { storage.setItem(FOOTAGE_SUGGESTION_STORAGE_KEY, JSON.stringify({ version: 1, cursor: nextCursor })); }
  catch { remembered = false; }
  return { ideas: stockFootageSuggestions(cursor), nextCursor, remembered };
}
