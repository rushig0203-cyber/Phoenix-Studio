export const STUDIO_SECTIONS = ["create", "jobs", "library", "settings"] as const;
export type StudioSection = typeof STUDIO_SECTIONS[number];
export function studioSection(hash: string): StudioSection {
  const value = hash.replace(/^#/, "");
  if (value === "channels" || value === "writing-settings") return "settings";
  if (value === "storyboards") return "jobs";
  return STUDIO_SECTIONS.includes(value as StudioSection) ? value as StudioSection : "create";
}
