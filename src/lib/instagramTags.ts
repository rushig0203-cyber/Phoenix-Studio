/** Explicit Instagram usernames only; public-account eligibility is decided by Meta. */
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
