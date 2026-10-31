export const LOCAL_STOCK_VOICE_PROTOCOL = "windows-speech-events-v1";

/** Require the exact nullable OpenAPI contract, not an arbitrary voice string. */
export function supportsLocalStockVoice(properties: unknown) {
  type Field = { const?: unknown; enum?: unknown; type?: unknown; anyOf?: Field[] };
  const field = (properties as { phoenix_local_voice_protocol?: Field } | undefined)?.phoenix_local_voice_protocol;
  if (!field || typeof field !== "object" || (field.anyOf !== undefined && !Array.isArray(field.anyOf))) return false;
  const variants = field.anyOf ?? [field];
  const exact = (variant: Field) => Boolean(variant && typeof variant === "object" && (variant.const === LOCAL_STOCK_VOICE_PROTOCOL || (Array.isArray(variant.enum) && variant.enum.length === 1 && variant.enum[0] === LOCAL_STOCK_VOICE_PROTOCOL)));
  return variants.some(exact) && variants.every(variant => exact(variant) || variant?.type === "null");
}
