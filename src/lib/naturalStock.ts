import { searchFootage, selectedFootage } from "./stockCatalog";
import type { FootageChoice } from "./creationDraftTypes";
import { stockPortraitScore } from "./stockReel";

export type NaturalStock = FootageChoice & { provider: "pexels" | "pixabay"; title: string };
export const configuredStock = () => ({ pexels: !!process.env.PEXELS_API_KEY?.trim(), pixabay: !!process.env.PIXABAY_API_KEY?.trim() });
const pexelsTitle = (file: FootageChoice) => new URL(file.sourcePage).pathname.replace(/^\/video\//, "").replace(/-?\d+\/?$/, "").replace(/[-/]/g, " ").trim() || "Pexels footage";

export function trustedStockUrl(value: string, provider: "pexels" | "pixabay") {
  const url = new URL(value);
  const hosts = provider === "pexels" ? /(^|\.)pexels\.com$/ : /^(cdn\.)?pixabay\.com$/;
  if (url.protocol !== "https:" || !hosts.test(url.hostname) || url.username || url.password) throw new Error("Stock provider returned an untrusted media URL.");
  return url.toString();
}

type PixabayVideo = { id: number; duration: number; tags: string; pageURL: string; user: string; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> };
export function pixabayChoice(video: PixabayVideo): NaturalStock {
  const rendition = Object.values(video.videos || {}).filter(file => file.url && file.width > 0 && file.height > 0).sort((a, b) => Math.abs(Math.min(a.width, a.height) - 720) - Math.abs(Math.min(b.width, b.height) - 720))[0];
  if (!rendition || !Number.isSafeInteger(video.id) || video.id <= 0 || !(video.duration > 0)) throw new Error("Pixabay video has no usable rendition.");
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

export function portraitFirstStock(videos: NaturalStock[]) {
  return videos.filter((video, index) => videos.findIndex(other => other.provider === video.provider && other.id === video.id) === index)
    .sort((a, b) => stockPortraitScore(b) - stockPortraitScore(a));
}

export async function searchNaturalStock(provider: "pexels" | "pixabay", query: string): Promise<NaturalStock[]> {
  if (provider === "pexels") {
    // Prefer footage actually filmed vertically. A bounded landscape fallback remains available,
    // retaining the search subject rather than padding the reel with unrelated footage.
    const portrait = await searchFootage(query, "9:16", false, 1, 12);
    const fallback = portrait.length < 8 ? await searchFootage(query, "9:16", true, 1, 12).catch(error => { if (!portrait.length) throw error; return []; }) : [];
    return portraitFirstStock([...portrait, ...fallback].map(file => ({ ...file, provider, title: pexelsTitle(file) })));
  }
  const data = await pixabay({ q: query, per_page: "12", page: "1" });
  return portraitFirstStock((data.hits || []).flatMap((video: PixabayVideo) => { try { return [pixabayChoice(video)]; } catch { return []; } }));
}

export async function resolveNaturalStock(provider: "pexels" | "pixabay", id: number): Promise<NaturalStock> {
  if (provider === "pexels") { const file = await selectedFootage(id); return { ...file, provider, title: pexelsTitle(file) }; }
  const data = await pixabay({ id: String(id) });
  const video = data.hits?.find((video: PixabayVideo) => video.id === id);
  if (!video) throw new Error("This Pixabay video is no longer available.");
  return pixabayChoice(video);
}
