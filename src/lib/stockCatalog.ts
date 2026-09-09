import type { FootageChoice } from "./creationDraftTypes";

function allowedUrl(value: unknown, host: RegExp) {
  if (typeof value !== "string") throw new Error("Pexels returned an invalid media address.");
  const url = new URL(value);
  if (url.protocol !== "https:" || !host.test(url.hostname) || url.username || url.password) throw new Error("Pexels returned an untrusted media address.");
  return url.toString();
}

type PexelsVideo = { id: number; duration: number; image: string; url: string; user?: { name: string }; video_files: Array<{ file_type: string; width: number; height: number; link: string }> };

export function footageChoice(video: PexelsVideo): FootageChoice {
  const file = video.video_files?.filter(file => file.file_type === "video/mp4" && file.width > 0 && file.height > 0)
    .sort((a, b) => Math.abs(Math.min(a.width, a.height) - 720) - Math.abs(Math.min(b.width, b.height) - 720))[0];
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

export async function searchFootage(query: string, aspect: "9:16" | "16:9") {
  const params = new URLSearchParams({ query, per_page: "8", page: "1", orientation: aspect === "9:16" ? "portrait" : "landscape" });
  const data = await pexels(`search?${params}`);
  const results: FootageChoice[] = [];
  for (const video of data.videos || []) {
    try { results.push(footageChoice(video)); } catch { /* Invalid assets are not offered for approval. */ }
  }
  return results;
}

/** Resolve the ID ourselves; never trust a browser-supplied download URL. */
export async function selectedFootage(id: number) {
  const video = footageChoice(await pexels(`videos/${id}`));
  if (video.id !== id) throw new Error("The requested Pexels footage is no longer available.");
  return video;
}
