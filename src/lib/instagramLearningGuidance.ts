import { createHash } from "node:crypto";
import { readInstagramPerformance } from "./instagramPerformance";
import { instagramPerformanceSummary } from "./instagramPerformanceLearning";
import type { InstagramPerformanceState } from "./instagramPerformanceTypes";

type LearningGuidance = { revision: string; rules: string[]; maxDuration?: number };
const EMPTY: LearningGuidance = { revision: "", rules: [] };
const types = ["source", "general", "business", "children-story", "children-song"];

/** Recognize only the metric-derived fixed sentences, not saved captions or topic text. */
export function isInstagramLearningRule(rule: string) {
  return /^Treat \d{1,3} age\/exposure-comparable Instagram videos as observational evidence, not proof of what caused their results\. Keep the owner's topic, accuracy and quality review ahead of performance preferences\.$/.test(rule)
    || /^In \d{1,3} of \d{1,3} locally matched videos, reported average watch time was below half the runtime\. Test a clearer first visual and fewer nonessential beats; this is not a measured drop-off curve or proof of the reason viewers left\.$/.test(rule)
    || /^Test a naturally complete version near (?:1[5-9]|[23]\d|40) seconds: \d{1,3} stronger locally matched videos had a shorter median than \d{1,3} other comparable videos\. Do not speed up or pad footage solely to hit that duration; this is a test, not evidence that length caused the result\.$/.test(rule);
}

export function instagramLearningGuidanceFromState(state: InstagramPerformanceState, creationType = "general", now = Date.now()): LearningGuidance {
  if (!types.includes(creationType)) return EMPTY;
  const summary = instagramPerformanceSummary({ ...state, videos: state.videos.filter(video => !!video.reviewId && video.creationType === creationType) }, now);
  const rules = summary.rules.filter(rule => isInstagramLearningRule(rule) && (creationType === "source" || !rule.startsWith("Test a naturally complete version"))).slice(0, 3);
  // A comparable baseline alone is not an actionable production change.
  if (rules.length < 2) return EMPTY;
  const maxDuration = creationType === "source" && Number.isInteger(summary.durationExperimentSeconds)
    && summary.durationExperimentSeconds! >= 15 && summary.durationExperimentSeconds! <= 40 ? summary.durationExperimentSeconds : undefined;
  const revision = createHash("sha256").update(JSON.stringify([1, state.account?.id, state.account?.connectionRevision, creationType, rules, maxDuration])).digest("hex").slice(0, 12);
  return { revision, rules, ...(maxDuration !== undefined ? { maxDuration } : {}) };
}

/** Reads the current-account cache only; optional statistics never block content creation. */
export async function getInstagramLearningGuidance(creationType?: string): Promise<LearningGuidance> {
  try { return instagramLearningGuidanceFromState(await readInstagramPerformance(), creationType); }
  catch { return EMPTY; }
}

export function mergeInstagramLearningGuidance<T extends { revision: string; rules: string[] }>(base: T, learning: LearningGuidance): T {
  const additions = learning.rules.filter(rule => isInstagramLearningRule(rule) && !base.rules.includes(rule)).slice(0, Math.max(0, 16 - base.rules.length));
  if (!additions.length) return base;
  const digest = createHash("sha256").update(JSON.stringify([base.revision, learning.revision, additions])).digest("hex").slice(0, 12);
  return { ...base, rules: [...base.rules, ...additions], revision: base.revision.startsWith("stock-v1-") ? `stock-v1-${digest}` : digest };
}

/** Legacy short-caption bounds remain valid; only a fixed learning suffix may extend them. */
export function hasBoundedLearningRules(rules: string[], previousLimit: number) {
  if (rules.length <= previousLimit) return true;
  const firstLearning = rules.findIndex(isInstagramLearningRule);
  return rules.length <= 16 && firstLearning >= 0 && firstLearning <= previousLimit && rules.slice(firstLearning).every(isInstagramLearningRule);
}
