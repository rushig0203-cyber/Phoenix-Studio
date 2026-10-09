/** Versioned local-renderer contract: never retime or hold footage to fill narration. */
export const STOCK_PLAYBACK_POLICY = "native-speed-v1";

export function supportsNativeStockPlayback(properties: unknown): boolean {
  const field = (properties as { phoenix_playback_policy?: { const?: unknown; enum?: unknown } } | undefined)?.phoenix_playback_policy;
  return field?.const === STOCK_PLAYBACK_POLICY || (Array.isArray(field?.enum) && field.enum.length === 1 && field.enum[0] === STOCK_PLAYBACK_POLICY);
}
