import type { ReviewFile } from "./reviewFiles";

const places = ["Switzerland", "Norway", "Italy", "Japan", "Iceland", "Canada", "New Zealand", "Austria", "France", "Portugal", "Greece", "Australia"];
const aliases: Record<string, RegExp> = {
  Switzerland: /\b(?:switzerland|swiss)\b/i, Norway: /\b(?:norway|norwegian)\b/i,
  Italy: /\b(?:italy|italian)\b/i, Japan: /\b(?:japan|japanese)\b/i,
  Iceland: /\b(?:iceland|icelandic)\b/i, Canada: /\b(?:canada|canadian)\b/i,
  "New Zealand": /\bnew zealand\b/i, Austria: /\b(?:austria|austrian)\b/i,
  France: /\b(?:france|french)\b/i, Portugal: /\b(?:portugal|portuguese)\b/i,
  Greece: /\b(?:greece|greek)\b/i, Australia: /\b(?:australia|australian)\b/i,
};

/** Local suggestions only. A title/model observation is never filming-location proof. */
export function instagramLocationSuggestions(file: Pick<ReviewFile, "id" | "title" | "quality">) {
  const description = [file.title.slice(0, 200), ...(file.quality.postingAnalysis?.observations || []).slice(0, 3).map(value => value.slice(0, 400))].join(" ");
  const hints = places.filter(place => aliases[place].test(description));
  let seed = 0;
  for (const character of file.id.slice(0, 80)) seed = (Math.imul(seed, 31) + character.charCodeAt(0)) >>> 0;
  const alternatives = places.filter(place => place !== "Switzerland" && !hints.includes(place));
  const start = alternatives.length ? seed % alternatives.length : 0;
  const chosen = ["Switzerland", ...Array.from({ length: Math.min(5, alternatives.length) }, (_, index) => alternatives[(start + index) % alternatives.length])];
  return { hints, places: [...new Set(chosen)].filter(place => !hints.includes(place)) };
}
