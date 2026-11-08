export const STUDIO_SECTIONS = ["create", "library", "insights", "settings"] as const;
export type StudioSection = typeof STUDIO_SECTIONS[number];
export function studioSection(hash: string): StudioSection {
  const value = hash.replace(/^#/, "").split("?", 1)[0];
  if (value === "channels" || value === "writing-settings") return "settings";
  if (value === "jobs" || value === "storyboards") return "create";
  return STUDIO_SECTIONS.includes(value as StudioSection) ? value as StudioSection : "create";
}

export function insightReviewId(hash: string): string | undefined {
  if (studioSection(hash) !== "insights") return;
  const id = new URLSearchParams(hash.split("?", 2)[1] || "").get("review");
  return id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ? id : undefined;
}
