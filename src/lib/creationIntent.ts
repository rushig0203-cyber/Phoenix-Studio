import type { CreationKind } from "./creationRecommendations";

/** Conservative routing, not a claim of semantic understanding. */
export function creationIntent(topic: string): CreationKind {
  const childAudience = /\b(?:kids?|children|toddlers?|preschool|nursery|bedtime)\b|ages?\s*3\s*[-–]\s*6/i.test(topic);
  if (childAudience && /\b(?:song|sing|rhyme|music)\b/i.test(topic)) return "Children's song";
  if (childAudience && /\b(?:story|tale|animation|animated|cartoon)\b/i.test(topic)) return "Children's short story";
  if (/\b(?:business|customer service|marketing|sales|entrepreneur|shopkeeper)\b/i.test(topic)) return "Business video";
  return "General video";
}

export function completedTransitions<T extends { id: string; kind: string; status: string }>(previous: Map<string, string>, jobs: T[]): T[] {
  return jobs.filter(job => job.status === "COMPLETED" && ["QUEUED", "RUNNING", "PROCESSING"].includes(previous.get(`${job.kind}:${job.id}`) || ""));
}
