import type { ReviewFile } from "./reviewFiles";

/** Public visibility does not guarantee that Meta accepts an account's tags. */
// Phoenix's bounded input limit; Meta still decides account eligibility.
export const INSTAGRAM_USER_TAG_LIMIT = 20;
export const INSTAGRAM_USERNAME_LIMIT = 30;

export function instagramUsername(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const username = value.trim().replace(/^@/, "");
  if (!username || username.length > INSTAGRAM_USERNAME_LIMIT || !/^[A-Za-z0-9_.]+$/.test(username)
      || username.startsWith(".") || username.endsWith(".") || username.includes("..")) return null;
  return username.toLowerCase();
}

/** Normalize owner-entered usernames without truncating or accepting URLs/objects. */
export function instagramUserTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > INSTAGRAM_USER_TAG_LIMIT) return null;
  const tags: string[] = [];
  for (const entry of value) {
    const username = instagramUsername(entry);
    if (!username) return null;
    if (!tags.includes(username)) tags.push(username);
  }
  return tags;
}

/** Saved jobs must already contain the exact normalized, unique username list. */
export function publicInstagramUserTags(value: unknown): string[] | null {
  const tags = instagramUserTags(value);
  if (!tags || !Array.isArray(value) || tags.length !== value.length || tags.some((username, index) => username !== value[index])) return null;
  return tags;
}

// Public feeds checked on Instagram on 2026-10-11; these are topical candidates,
// not collaborators, endorsers or accounts whose tagging eligibility is assured.
export const AUTOMATIC_INSTAGRAM_TAG_PROFILES = [
  { username: "discoverearth", topics: /\b(?:nature\w*|forest\w*|woodland\w*|mountain\w*|waterfall\w*|ocean\w*|wildlife|animal\w*|horse\w*|bird\w*|rain\w*|river\w*|lake\w*|beach\w*|landscape\w*)\b/i },
  { username: "nature", topics: /\b(?:nature\w*|forest\w*|woodland\w*|tree\w*|flower\w*|mountain\w*|wildlife|bird\w*|rain\w*|waterfall\w*|park\w*|landscape\w*)\b/i },
  { username: "earthofficial", topics: /\b(?:nature\w*|wildlife|animal\w*|horse\w*|bird\w*|whale\w*|aurora\w*|forest\w*|mountain\w*|landscape\w*)\b/i },
  { username: "wonderful_places", topics: /\b(?:travel\w*|scenery|scenic|beach\w*|island\w*|mountain\w*|countryside|train\w*|railway\w*|ocean\w*|lake\w*|waterfall\w*|city|cities|landscape\w*)\b/i },
  { username: "beautifuldestinations", topics: /\b(?:travel\w*|city|cities|architecture|beach\w*|alps|mountain\w*|scenic|train\w*|railway\w*|countryside|journey\w*|island\w*)\b/i },
  { username: "earthpix", topics: /\b(?:travel\w*|city|cities|architecture|landscape\w*|destination\w*|mountain\w*|beach\w*|train\w*|railway\w*|countryside|island\w*)\b/i },
] as const;

/** No model/network work: select a few relevant profiles from saved visual evidence. */
export function automaticInstagramUserTags(file: Pick<ReviewFile, "title" | "quality"> & Partial<Pick<ReviewFile, "audience">>, accountName?: string): string[] {
  if ((file.audience && file.audience !== "general") || file.quality.research) return [];
  const analysis = file.quality.postingAnalysis;
  const observations = analysis?.status === "COMPLETE" ? analysis.observations?.filter(value => typeof value === "string").slice(0, 8).map(value => value.slice(0, 500)) : [];
  // Completed frame evidence wins over the requested topic and old posting copy.
  const evidence = observations?.length ? observations : [file.title.slice(0, 200), ...file.quality.hashtags.slice(0, 20).map(value => value.slice(0, 100))];
  const topic = evidence.join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const ownUsername = instagramUsername(accountName);
  const eligible = AUTOMATIC_INSTAGRAM_TAG_PROFILES.filter(profile => profile.username !== ownUsername && profile.topics.test(topic));
  if (!eligible.length) return [];
  let rotation = 0;
  for (const character of topic) rotation = (rotation * 31 + character.charCodeAt(0)) >>> 0;
  return Array.from({ length: Math.min(3, eligible.length) }, (_, index) => eligible[(rotation + index) % eligible.length].username);
}
