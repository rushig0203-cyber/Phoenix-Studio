import type { FootageChoice } from "./creationDraftTypes";

function allowedUrl(value: unknown, host: RegExp) {
  if (typeof value !== "string") throw new Error("Pexels returned an invalid media address.");
  const url = new URL(value);
  if (url.protocol !== "https:" || !host.test(url.hostname) || url.username || url.password) throw new Error("Pexels returned an untrusted media address.");
  return url.toString();
}

type PexelsVideo = { id: number; duration: number; image: string; url: string; user?: { name: string }; video_files: Array<{ file_type: string; width: number; height: number; link: string }> };

export function footageChoice(video: PexelsVideo): FootageChoice {
  const file = video.video_files?.filter(file => file && file.file_type === "video/mp4" && typeof file.link === "string" && !!file.link
    && Number.isFinite(file.width) && Number.isFinite(file.height) && file.width > 0 && file.height > 0)
    .sort((a, b) => {
      const first = Math.min(a.width, a.height), second = Math.min(b.width, b.height);
      // Avoid upscaling when a sufficient rendition exists, without choosing
      // needless 4K downloads. Legacy/manual callers keep the best SD fallback.
      return Number(second >= 720) - Number(first >= 720)
        || (first >= 720 ? first - second || a.width * a.height - b.width * b.height : second - first || b.width * b.height - a.width * a.height);
    })[0];
  if (!file || !Number.isSafeInteger(video.id) || video.id <= 0 || !Number.isFinite(video.duration) || video.duration <= 0) throw new Error("Pexels footage is missing playable video metadata.");
  return {
    id: video.id, duration: video.duration, width: file.width, height: file.height,
    previewUrl: allowedUrl(file.link, /(^|\.)pexels\.com$/),
    image: allowedUrl(video.image, /(^|\.)pexels\.com$/),
    sourcePage: allowedUrl(video.url, /^(www\.)?pexels\.com$/),
    creator: String(video.user?.name || "Pexels contributor").slice(0, 100),
  };
}

async function pexels(route: string) {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) throw new Error("Add your free Pexels API key to use footage search. No paid provider is used.");
  const response = await fetch(`https://api.pexels.com/v1/videos/${route}`, {
    headers: { Authorization: key }, signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 429 ? "Pexels free search limit reached. Wait and retry; no paid fallback was used." : `Pexels search failed (${response.status}). Check the free API key or retry.`);
  return response.json();
}

export async function searchFootagePage(query: string, aspect: "9:16" | "16:9", anyOrientation = false, page = 1, pageSize = 8) {
  const boundedPage = Math.max(1, Math.min(3, Math.trunc(page))), boundedSize = Math.min(40, Math.max(8, Math.trunc(pageSize)));
  const params = new URLSearchParams({ query, per_page: String(boundedSize), page: String(boundedPage), orientation: aspect === "9:16" ? "portrait" : "landscape" });
  if (anyOrientation) params.delete("orientation");
  const data = await pexels(`search?${params}`);
  const results: FootageChoice[] = [];
  for (const video of (Array.isArray(data.videos) ? data.videos : []).slice(0, boundedSize)) {
    try { results.push(footageChoice(video)); } catch { /* Invalid assets are not offered for approval. */ }
  }
  const total = Number(data.total_results);
  const hasMore = Number.isFinite(total) && total >= 0 ? boundedPage * boundedSize < total
    : typeof data.next_page === "string" && !!data.next_page;
  return { videos: results, hasMore };
}

/** Backward-compatible planning search; browsing consumes the page metadata above. */
export async function searchFootage(query: string, aspect: "9:16" | "16:9", anyOrientation = false, page = 1, pageSize = 8) {
  return (await searchFootagePage(query, aspect, anyOrientation, page, pageSize)).videos;
}

/** Resolve the ID ourselves; never trust a browser-supplied download URL. */
export async function selectedFootage(id: number) {
  const video = footageChoice(await pexels(`videos/${id}`));
  if (video.id !== id) throw new Error("The requested Pexels footage is no longer available.");
  return video;
}
