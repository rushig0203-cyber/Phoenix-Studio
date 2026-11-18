export const REVIEW_POSTER_POLICY = "interior-v1";

export function reviewPosterSeek(duration: unknown): number {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return 0;
  const milliseconds = Math.floor(duration * 350);
  return Number.isSafeInteger(milliseconds) ? milliseconds / 1000 : 0;
}
