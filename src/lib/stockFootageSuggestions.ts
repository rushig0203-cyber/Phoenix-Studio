import { CONTENT_IDEAS, type ContentIdea } from "./contentIdeas";

export const FOOTAGE_SUGGESTION_STORAGE_KEY = "phoenix-footage-suggestions-v1";
export const FOOTAGE_SUGGESTION_COUNT = 6;
// Keep stable IDs/cursor order, but footage chips are simple visual topics, not
// scripted premises. The richer general/business creation catalogue is intact.
const topics: Record<string, readonly [string, string]> = {
  "0-0": ["Nature", "nature"], "0-1": ["Ocean", "ocean"], "0-2": ["Birds", "birds"],
  "0-3": ["Forest", "forest"], "0-4": ["Butterflies", "butterflies"],
  "1-0": ["Cities", "city"], "1-1": ["Mountains", "mountains"], "1-2": ["Rain", "rain"], "1-3": ["Train", "train"],
  "2-0": ["Baking", "baking"], "2-1": ["Pottery", "pottery"], "2-2": ["Coffee", "coffee"], "2-3": ["Drawing", "drawing"], "2-4": ["Markets", "market"],
  "3-0": ["Cats", "cat"], "3-1": ["Dogs", "dog"], "3-2": ["Horses", "horses"], "3-3": ["Gardens", "garden"],
  "8-0": ["Parks", "park"], "8-1": ["Cycling", "cycling"], "8-2": ["Climbing", "climbing"], "8-3": ["Skating", "skateboard"],
};
const ideas = CONTENT_IDEAS.filter(idea => idea.workflow === "stock-reel").map(idea => {
  const title = topics[idea.id]?.[0] || idea.query.split(/\s+/).slice(0, 2).join(" ");
  // The selected chip must insert what it displays, not a hidden singular or
  // alternate keyword. Providers still receive the same broad topic.
  return { ...idea, title, query: title };
});
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
