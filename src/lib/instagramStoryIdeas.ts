import type { ReviewFile } from "./reviewFiles";

/** Small local prompts, not uploaded Stories or fabricated trending research. */
export function instagramStoryIdeas(file: ReviewFile, day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())): string[] {
  const observations = file.quality.postingAnalysis?.status === "COMPLETE" ? file.quality.postingAnalysis.observations || [] : [];
  const detail = (observations.find(value => typeof value === "string" && value.trim()) || file.title).replace(/\s+/g, " ").trim().slice(0, 160);
  const seed = [...`${file.id}:${day}`].reduce((total, value) => (total * 31 + value.charCodeAt(0)) >>> 0, 0);
  const intros = ["A detail from today’s Reel", "Today’s closer look", "One moment worth a second look"];
  const questions = ["Which detail stood out to you in this video?", "What would you like to see more of in the next Reel?", "What caught your eye first?"];
  const polls = ["Next Reel: wide views or close-up details?", "Would you watch this moment once or replay it?", "Next Story: a quick teaser or a closer look?"];
  return [`${intros[seed % intros.length]}: ${detail}`, questions[(seed >>> 3) % questions.length], `Poll idea — ${polls[(seed >>> 6) % polls.length]}`];
}
