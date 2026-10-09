import { searchFootage, searchFootagePage, selectedFootage } from "./stockCatalog";
import type { FootageChoice } from "./creationDraftTypes";
import { stockPortraitScore } from "./stockReel";
import { visualWords } from "./stockBrief";
import { footageMetadataMismatch } from "./footageSemantics";

export type NaturalStock = FootageChoice & { provider: "pexels" | "pixabay"; title: string };
export const configuredStock = () => ({ pexels: !!process.env.PEXELS_API_KEY?.trim(), pixabay: !!process.env.PIXABAY_API_KEY?.trim() });
export const MAX_STOCK_DISCOVERY_PAGES = 3;
export const STOCK_DISCOVERY_PAGE_SIZE = 24;
const pexelsTitle = (file: FootageChoice) => new URL(file.sourcePage).pathname.replace(/^\/video\//, "").replace(/-?\d+\/?$/, "").replace(/[-/]/g, " ").trim() || "Pexels footage";

export function trustedStockUrl(value: string, provider: "pexels" | "pixabay") {
  const url = new URL(value);
  const hosts = provider === "pexels" ? /(^|\.)pexels\.com$/ : /^(cdn\.)?pixabay\.com$/;
  if (url.protocol !== "https:" || !hosts.test(url.hostname) || url.username || url.password) throw new Error("Stock provider returned an untrusted media URL.");
  return url.toString();
}

type PixabayVideo = { id: number; duration: number; type?: "film" | "animation"; tags: string; pageURL: string; user: string; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> };
export function pixabayChoice(video: PixabayVideo): NaturalStock {
  if (video.type === "animation") throw new Error("This source is marked as animation. Choose filmed footage for the real-footage reel category.");
  const rendition = Object.values(video.videos || {}).filter(file => file && typeof file.url === "string" && !!file.url && Number.isFinite(file.width) && Number.isFinite(file.height) && file.width > 0 && file.height > 0)
    .sort((a, b) => {
      const first = Math.min(a.width, a.height), second = Math.min(b.width, b.height);
      return Number(second >= 720) - Number(first >= 720)
        || (first >= 720 ? first - second || a.width * a.height - b.width * b.height : second - first || b.width * b.height - a.width * a.height);
    })[0];
  if (!rendition || !Number.isSafeInteger(video.id) || video.id <= 0 || !Number.isFinite(video.duration) || video.duration <= 0) throw new Error("Pixabay video has no usable rendition.");
  return { id: video.id, provider: "pixabay", duration: video.duration, width: rendition.width, height: rendition.height, previewUrl: trustedStockUrl(rendition.url, "pixabay"), image: rendition.thumbnail ? trustedStockUrl(rendition.thumbnail, "pixabay") : "", sourcePage: trustedStockUrl(video.pageURL, "pixabay"), creator: video.user, title: video.tags.split(",").slice(0, 3).map(word => word.trim()).join(" · ").slice(0, 120) };
}

async function pixabay(parameters: Record<string, string>) {
  if (!configuredStock().pixabay) throw new Error("Pixabay is not configured. Add its free API key locally; no paid service is used.");
  const query = new URLSearchParams({ ...parameters, key: process.env.PIXABAY_API_KEY!.trim(), safesearch: "true" });
  // Never log the URL: Pixabay authenticates in its query string.
  let response: Response;
  try { response = await fetch(`https://pixabay.com/api/videos/?${query}`, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" }); }
  catch { throw new Error("Pixabay could not be reached. Retry later; no paid fallback was used."); }
  if (!response.ok) throw new Error(`Pixabay search failed (${response.status}). Check the free key or wait if its free quota is exhausted.`);
  return response.json();
}

const catalogueGenericWords = new Set(["pexels", "pixabay", "stock", "footage", "video", "videos", "clip", "clips", "portrait", "landscape", "vertical", "horizontal", "filmed", "shot", "view"]);

function catalogueWords(value: string) {
  return [...new Set(visualWords(value.slice(0, 240)).filter(word => !catalogueGenericWords.has(word)).map(word => {
    if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + "y";
    if (word.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
    if (word.length > 4 && /ing$/.test(word)) {
      const stem = word.slice(0, -3);
      return /([b-df-hj-np-tv-z])\1$/.test(stem) ? stem.slice(0, -1) : stem;
    }
    return word.length > 3 && /s$/.test(word) && !/(?:ss|us)$/.test(word) ? word.slice(0, -1) : word;
  }))];
}

/** Catalog text only: a matching title is not visual analysis or proof of location. */
function catalogueRelevance(video: NaturalStock, wanted: string[], query: string) {
  const title = typeof video.title === "string" ? video.title : "";
  const description = catalogueWords(title);
  if (!description.length) return 1; // Unknown metadata stays available after word matches.
  if (footageMetadataMismatch(title, query)) return 0;
  const hits = wanted.filter(word => description.some(other => other === word || (word.length >= 4 && other.startsWith(word))));
  if (!hits.length) return 0;
  return hits.length / wanted.length >= .75 ? 3 : 2;
}

export function portraitFirstStock(videos: NaturalStock[], query?: string) {
  const wanted = catalogueWords(query || "");
  const unique = videos.filter((video, index) => videos.findIndex(other => other.provider === video.provider && other.id === video.id) === index);
  // Preserve the existing public helper's ordering when no meaningful query is supplied.
  if (!wanted.length) return unique.sort((a, b) => stockPortraitScore(b) - stockPortraitScore(a));
  return unique.filter(video => Number.isFinite(video.width) && Number.isFinite(video.height) && Number.isFinite(video.duration) && video.width > 0 && video.height > 0 && video.duration > 0)
    .map((video, index) => ({ video, index, relevance: catalogueRelevance(video, wanted, query || "") }))
    .sort((a, b) => b.relevance - a.relevance || stockPortraitScore(b.video) - stockPortraitScore(a.video) || a.index - b.index)
    .map(result => result.video);
}

export async function searchNaturalStock(provider: "pexels" | "pixabay", query: string): Promise<NaturalStock[]> {
  if (provider === "pexels") {
    // Prefer footage actually filmed vertically. A bounded landscape fallback remains available,
    // retaining the search subject rather than padding the reel with unrelated footage.
    const portrait = await searchFootage(query, "9:16", false, 1, 12);
    const fallback = portrait.length < 8 ? await searchFootage(query, "9:16", true, 1, 12).catch(error => { if (!portrait.length) throw error; return []; }) : [];
    return portraitFirstStock([...portrait, ...fallback].map(file => ({ ...file, provider, title: pexelsTitle(file) })), query);
  }
  // Use Pixabay's documented film category, rather than mixing animations into
  // a real-footage search. This provider label is not a frame-level authenticity check.
  const data = await pixabay({ q: query, video_type: "film", per_page: "12", page: "1" });
  return portraitFirstStock((data.hits || []).flatMap((video: PixabayVideo) => { try { return [pixabayChoice(video)]; } catch { return []; } }), query);
}

/** One explicit metadata page, all filmed orientations; no media download or AI call. */
export async function searchNaturalStockPage(provider: "pexels" | "pixabay", query: string, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_STOCK_DISCOVERY_PAGES) throw new Error("This footage page is outside the laptop-safe browsing limit. Refine your topic.");
  if (provider === "pexels") {
    const result = await searchFootagePage(query, "9:16", true, page, STOCK_DISCOVERY_PAGE_SIZE);
    return { videos: portraitFirstStock(result.videos.map(file => ({ ...file, provider, title: pexelsTitle(file) })), query), hasMore: result.hasMore };
  }
  const data = await pixabay({ q: query, video_type: "film", per_page: String(STOCK_DISCOVERY_PAGE_SIZE), page: String(page) });
  const hits = Array.isArray(data.hits) ? data.hits.slice(0, STOCK_DISCOVERY_PAGE_SIZE) : [];
  const total = Number(data.totalHits);
  const hasMore = Number.isFinite(total) && total >= 0 ? page * STOCK_DISCOVERY_PAGE_SIZE < total : hits.length >= STOCK_DISCOVERY_PAGE_SIZE;
  return { videos: portraitFirstStock(hits.flatMap((video: PixabayVideo) => { try { return [pixabayChoice(video)]; } catch { return []; } }), query), hasMore };
}

export async function resolveNaturalStock(provider: "pexels" | "pixabay", id: number): Promise<NaturalStock> {
  if (provider === "pexels") { const file = await selectedFootage(id); return { ...file, provider, title: pexelsTitle(file) }; }
  const data = await pixabay({ id: String(id) });
  const video = data.hits?.find((video: PixabayVideo) => video.id === id);
  if (!video) throw new Error("This Pixabay video is no longer available.");
  return pixabayChoice(video);
}
