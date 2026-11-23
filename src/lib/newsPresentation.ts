export const NEWS_CAPTION_STYLE = "measured-phrases-v1";
export const STOCK_NARRATION_PROTOCOL = "measured-speech-v1";

function narrationPresentation(aspect: "9:16" | "16:9") {
  return {
    subtitle_position: "custom",
    custom_position: 78,
    font_size: aspect === "9:16" ? 34 : 28,
    text_fore_color: "#FFFFFF",
    text_background_color: false,
    rounded_subtitle_background: false,
    stroke_color: "#000000",
    stroke_width: 1,
    voice_volume: 1,
    // Only an explicitly selected, verified quiet bed can enable music.
    bgm_type: "",
    bgm_volume: 0,
  };
}

export function stockNarrationPresentation(aspect: "9:16" | "16:9") {
  return { ...narrationPresentation(aspect), phoenix_narration_protocol: STOCK_NARRATION_PROTOCOL };
}

export function newsPresentation(aspect: "9:16" | "16:9") {
  return { ...narrationPresentation(aspect), phoenix_news_caption_style: NEWS_CAPTION_STYLE, voice_rate: 1.08 };
}

function supportsPresentationField(field: unknown, expected: string) {
  type Field = { const?: unknown; enum?: unknown; type?: unknown; anyOf?: Field[] };
  if (!field || typeof field !== "object") return false;
  const capability = field as Field;
  if (capability.anyOf !== undefined && !Array.isArray(capability.anyOf)) return false;
  const variants = capability.anyOf ?? [capability];
  const exact = (variant: Field) => Boolean(variant && typeof variant === "object" && (variant.const === expected || (Array.isArray(variant.enum) && variant.enum.length === 1 && variant.enum[0] === expected)));
  return variants.some(exact) && variants.every(variant => exact(variant) || variant?.type === "null");
}

export function supportsNewsPresentation(properties: unknown) {
  return supportsPresentationField((properties as { phoenix_news_caption_style?: unknown } | undefined)?.phoenix_news_caption_style, NEWS_CAPTION_STYLE);
}

export function supportsStockNarrationPresentation(properties: unknown) {
  return supportsPresentationField((properties as { phoenix_narration_protocol?: unknown } | undefined)?.phoenix_narration_protocol, STOCK_NARRATION_PROTOCOL);
}
