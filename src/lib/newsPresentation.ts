export const NEWS_CAPTION_STYLE = "measured-phrases-v1";

export function newsPresentation(aspect: "9:16" | "16:9") {
  return {
    phoenix_news_caption_style: NEWS_CAPTION_STYLE,
    subtitle_position: "custom",
    custom_position: 78,
    font_size: aspect === "9:16" ? 34 : 28,
    text_fore_color: "#FFFFFF",
    text_background_color: false,
    rounded_subtitle_background: false,
    stroke_color: "#000000",
    stroke_width: 1,
    voice_rate: 1.08,
    // Random music can contradict a serious report; clear narration is sufficient.
    bgm_type: "",
    bgm_volume: 0,
  };
}

export function supportsNewsPresentation(properties: unknown) {
  type Field = { const?: unknown; enum?: unknown; type?: unknown; anyOf?: Field[] };
  const field = (properties as { phoenix_news_caption_style?: Field } | undefined)?.phoenix_news_caption_style;
  if (!field || typeof field !== "object" || (field.anyOf !== undefined && !Array.isArray(field.anyOf))) return false;
  const variants = field.anyOf ?? [field];
  const exact = (variant: Field) => Boolean(variant && typeof variant === "object" && (variant.const === NEWS_CAPTION_STYLE || (Array.isArray(variant.enum) && variant.enum.length === 1 && variant.enum[0] === NEWS_CAPTION_STYLE)));
  return variants.some(exact) && variants.every(variant => exact(variant) || variant?.type === "null");
}
