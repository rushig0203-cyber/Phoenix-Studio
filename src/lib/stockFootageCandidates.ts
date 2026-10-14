import type { NaturalStock } from "./naturalStock";
import { AUTOMATIC_STOCK_PROVIDERS, stockMediaIdentity } from "./stockProviders";

export const FOOTAGE_SEARCH_DELAY_MS = 600;
export const FOOTAGE_CANDIDATE_PAGE_SIZE = 20;
export const MAX_FOOTAGE_CANDIDATES = 120;
/** Keep lightweight provider cards; never pad a sparse search or load videos. */
export function stockFootageCandidates(value: unknown): NaturalStock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((video): video is NaturalStock => {
    if (!video || typeof video !== "object" || !AUTOMATIC_STOCK_PROVIDERS.includes(video.provider) || !stockMediaIdentity(video.provider, video.id) || typeof video.title !== "string"
      || !Number.isFinite(video.duration) || video.duration <= 0
      || !Number.isFinite(video.width) || video.width <= 0 || !Number.isFinite(video.height) || video.height <= 0) return false;
    const key = `${video.provider}:${video.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, MAX_FOOTAGE_CANDIDATES);
}

/** Keep the bounded pool in memory; only one small thumbnail page is mounted. */
export function mergeStockFootageCandidates(previous: NaturalStock[], value: unknown): NaturalStock[] {
  return stockFootageCandidates([...previous, ...stockFootageCandidates(value)]);
}
