export const STUDIO_SECTIONS = ["create", "library", "settings"] as const;
export type StudioSection = typeof STUDIO_SECTIONS[number];
export function studioSection(hash: string): StudioSection {
  const value = hash.replace(/^#/, "");
  if (value === "channels" || value === "writing-settings") return "settings";
  if (value === "jobs" || value === "storyboards") return "create";
  return STUDIO_SECTIONS.includes(value as StudioSection) ? value as StudioSection : "create";
}
