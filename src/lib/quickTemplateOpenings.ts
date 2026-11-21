import { automaticStockChoices, automaticStockCompanions } from "./automaticStockReel";
import { configuredStock, searchNaturalStockPage, trustedStockUrl } from "./naturalStock";
import type { QuickTemplateOpening } from "./quickTemplates";
import { readStockReuseBlocked } from "./sourceProcessing";
import { AUTOMATIC_STOCK_PROVIDERS } from "./stockProviders";

/** Read at most two catalog pages per card. Rendering starts only when the user chooses it. */
export async function quickTemplateOpenings<T extends { query: string }>(ideas: T[], signal: AbortSignal) {
  const configured = configuredStock();
  const providers = AUTOMATIC_STOCK_PROVIDERS.filter(provider => configured[provider]).slice(0, 2);
  const unavailable = await readStockReuseBlocked();
  const searches = await Promise.all(ideas.map(async idea => {
    const options: Array<QuickTemplateOpening & { enoughRelated: boolean }> = [];
    for (const provider of providers) {
      if (signal.aborted) break;
      try {
        const { videos } = await searchNaturalStockPage(provider, idea.query);
        const candidates = automaticStockChoices(videos, idea.query, unavailable).slice(0, 8).flatMap(video => {
          if (!video.image) return [];
          try { return [{ video, image: trustedStockUrl(video.image, video.provider) }]; }
          catch { return []; }
        });
        const ranked = candidates.map(({ video, image }) => ({
          provider: video.provider, id: video.id, image,
          enoughRelated: automaticStockCompanions(video, videos, idea.query, undefined, unavailable).length >= 3,
        })).sort((first, second) => Number(second.enoughRelated) - Number(first.enoughRelated));
        options.push(...ranked);
        if (ranked[0]?.enoughRelated) break;
      } catch { /* Keep catalog failures scoped to this topic. */ }
    }
    return options.sort((first, second) => Number(second.enoughRelated) - Number(first.enoughRelated));
  }));

  const shown = new Set<string>();
  return ideas.map((idea, index) => {
    const selected = searches[index].find(source => !shown.has(`${source.provider}:${source.id}`));
    if (!selected) return idea;
    const { provider, id, image } = selected;
    shown.add(`${provider}:${id}`);
    return { ...idea, opening: { provider, id, image } };
  });
}
