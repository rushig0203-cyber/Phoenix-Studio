/** Finite story beats. These values describe one completed action, never a loop. */
export type KidsStoryIntent = "observe" | "greet" | "approach" | "offer" | "receive" | "celebrate" | "comfort" | "untangle" | "explore" | "rest" | "perform";
export type KidsShot = "wide" | "two-shot" | "detail" | "reaction" | "speaker";
export type KidsExpression = "happy" | "worried" | "curious" | "surprised" | "determined" | "relieved" | "tired";
export type KidsAnimationPerformanceFrame = { speaker?: -1 | 0 | 1; mouthOpen?: number; active?: [boolean, boolean] };
export const KIDS_MAX_UNIQUE_FRAMES = 768;
export const KIDS_MAX_POSE_SAMPLES = 36;
export const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export const ease = (value: number) => { const t = unit(value); return t * t * (3 - 2 * t); };
export const ramp = (progress: number, start: number, end: number) => ease((progress - start) / (end - start));
export const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

export function kidsStoryBeat(progress: number) {
  const p = unit(progress);
  return { progress: p, stage: p < .16 ? "anticipation" : p < .58 ? "action" : p < .84 ? "reaction" : "settle", action: ramp(p, .14, .58), reaction: ramp(p, .58, .84), settle: ramp(p, .84, 1) };
}

/** Extra samples belong to the action; a long final hold does not replay it. */
export function quantizeKidsProgress(progress: number, samples: number) {
  const count = Math.max(1, Math.floor(samples));
  if (count === 1) return .68;
  // The first 82% of pose samples covers the anticipation and action.
  const p = unit(progress), mapped = p < .72 ? p / .72 * .82 : .82 + (p - .72) / .28 * .18;
  const q = Math.round(mapped * (count - 1)) / (count - 1);
  return Number((q < .82 ? q / .82 * .72 : .72 + (q - .82) / .18 * .28).toFixed(4));
}

/** Mouth values are audio amplitude buckets, not invented sine-wave speech. */
export function kidsMouthState(frame: KidsAnimationPerformanceFrame | undefined, fallbackSpeaker: number, song = false): { speaker: -1 | 0 | 1; mouthOpen: number } {
  const candidate = frame?.speaker ?? fallbackSpeaker;
  const speaker: -1 | 0 | 1 = candidate === 0 || candidate === 1 ? candidate : -1;
  const opening = frame?.mouthOpen === undefined ? (speaker >= 0 || song ? .5 : 0) : unit(frame.mouthOpen);
  const mouthOpen = opening < .08 ? 0 : opening < .48 ? .4 : 1;
  return { speaker: mouthOpen === 0 ? -1 : speaker, mouthOpen };
}

/** Bound the expensive raster jobs, regardless of video length or audio samples. */
export function kidsPoseBudgets(signatureCounts: number[]) {
  if (!signatureCounts.length || signatureCounts.length > 128) throw new Error("Children's animation needs between one and 128 planned scenes.");
  const cost = signatureCounts.map(value => Math.max(1, Math.floor(value)));
  const baseCost = cost.reduce((sum, value) => sum + value, 0);
  if (baseCost > KIDS_MAX_UNIQUE_FRAMES) throw new Error("The dialogue needs fewer animation scene breaks to fit this laptop's drawing budget.");
  const common = Math.max(1, Math.min(KIDS_MAX_POSE_SAMPLES, Math.floor(KIDS_MAX_UNIQUE_FRAMES / baseCost)));
  const budgets = cost.map(() => common);
  let remaining = KIDS_MAX_UNIQUE_FRAMES - common * baseCost;
  for (let i = 0; i < budgets.length; i++) {
    const extra = Math.min(KIDS_MAX_POSE_SAMPLES - budgets[i], Math.floor(remaining / cost[i]));
    budgets[i] += extra;
    remaining -= extra * cost[i];
  }
  return budgets;
}

export function kidsShotFor(intent: KidsStoryIntent, index: number, speaker: number, hasObject: boolean): KidsShot {
  if (index === 0) return "wide";
  if (speaker >= 0) return "speaker";
  if (intent === "observe" || intent === "comfort") return "reaction";
  if (hasObject && (intent === "untangle" || intent === "explore")) return "detail";
  if (intent === "approach") return "wide";
  return "two-shot";
}
