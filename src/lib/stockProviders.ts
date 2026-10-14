export const AUTOMATIC_STOCK_PROVIDERS = ["pexels", "pixabay", "commons", "nasa"] as const;
export type AutomaticStockProvider = typeof AUTOMATIC_STOCK_PROVIDERS[number];
export type StockProvider = AutomaticStockProvider | "mixkit" | "dareful";
export type StockLicence = {
  name: string;
  url: string;
  attribution: string;
  requiresAttribution: boolean;
  verifiedBy: "provider-metadata" | "owner-confirmation";
};

export const STOCK_PROVIDER_NAMES: Record<StockProvider, string> = {
  pexels: "Pexels", pixabay: "Pixabay", commons: "Wikimedia Commons", nasa: "NASA", mixkit: "Mixkit", dareful: "Dareful",
};

/** Numeric catalogue IDs stay canonical; NASA and imported assets retain opaque IDs. */
export function stockMediaIdentity(provider: unknown, id: unknown): string | null {
  if (typeof provider !== "string" || !Object.hasOwn(STOCK_PROVIDER_NAMES, provider)) return null;
  if (provider === "pexels" || provider === "pixabay" || provider === "commons") {
    if ((typeof id !== "number" && typeof id !== "string") || !/^\d+$/.test(String(id))) return null;
    const numeric = Number(id);
    return Number.isSafeInteger(numeric) && numeric > 0 ? `${provider}:${numeric}` : null;
  }
  if (provider === "nasa") {
    if (typeof id !== "string" || !id || id !== id.trim() || id.length > 240 || /[\u0000-\u001f\u007f/\\?#]/.test(id)) return null;
    return `${provider}:${id}`;
  }
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return null;
  return `${provider}:${id}`;
}

export function stockLicenceName(provider: StockProvider, licence?: StockLicence) {
  return licence?.name || (provider === "pexels" ? "Pexels License" : provider === "pixabay" ? "Pixabay Content License" : `${STOCK_PROVIDER_NAMES[provider]} — source rights need review`);
}

/** Mandatory credits belong in posting text, never disguised as speech subtitles. */
export function stockPostingCredits(file: { source: { stockLicence?: StockLicence }; quality: { visualSources?: Array<{ stockLicence?: StockLicence }> } }): string[] {
  const sources = file.quality.visualSources;
  return [...new Set((sources?.length ? sources.map(source => source.stockLicence) : [file.source.stockLicence])
    .filter((licence): licence is StockLicence => !!licence?.requiresAttribution)
    .map(licence => licence.attribution.trim()).filter(Boolean))];
}

export function withStockPostingCredits(caption: string, file: Parameters<typeof stockPostingCredits>[0]) {
  const missing = stockPostingCredits(file).filter(credit => !caption.includes(credit));
  return missing.length ? `${caption.trim()}${caption.trim() ? "\n\n" : ""}${missing.join("\n")}` : caption;
}
