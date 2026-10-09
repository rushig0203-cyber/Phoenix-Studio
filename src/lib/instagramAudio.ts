/** Public metadata only. Preview links open Instagram; audio files are never downloaded. */
export type InstagramAudioTrack = { audio_id: string; title: string; display_artist: string; preview_url?: string };
export type InstagramAudioConfiguration = { audio_id: string; audio_volume: number; video_volume: number };
export type InstagramAudioSelection = InstagramAudioConfiguration & { title: string; display_artist: string };
export type InstagramAudioSearch = { audio: import("./reelMusic").RecommendedInstagramAudio[]; reason?: string; recommendation?: import("./reelMusic").ReelMusicRecommendation };
export const INSTAGRAM_AUDIO_SEARCH_LIMIT = 6;
// Meta's June 2026 Audio API guide documents v22.0. Legacy uploads retain v21.0.
export const INSTAGRAM_AUDIO_GRAPH_VERSION = "v22.0";
export const instagramAudioId = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,40}$/.test(value) && !/[\r\n]/.test(value);
const label = (value: unknown, empty = false): value is string => typeof value === "string" && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value) && (empty || Boolean(value.trim()));
export function instagramAudioPreviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(?:www\.)?instagram\.com$/.test(url.hostname) || url.username || url.password || url.port
        || !/^\/reels\/audio\/[0-9]{1,40}\/?$/.test(url.pathname)) return undefined;
    url.search = ""; url.hash = ""; return url.href;
  } catch { return undefined; }
}
export function publicInstagramAudioTrack(value: unknown): InstagramAudioTrack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const track = value as { audio_id?: unknown; title?: unknown; display_artist?: unknown; audio_type?: unknown; on_platform_audio_preview_link?: unknown };
  if (!instagramAudioId(track.audio_id) || !label(track.title) || (track.audio_type !== undefined && track.audio_type !== "music")
      || (track.display_artist !== undefined && !label(track.display_artist, true))) return null;
  const preview = instagramAudioPreviewUrl(track.on_platform_audio_preview_link);
  return { audio_id: track.audio_id, title: track.title.trim(), display_artist: typeof track.display_artist === "string" ? track.display_artist.trim() : "",
    ...(preview ? { preview_url: preview } : {}) };
}
export function instagramAudioConfiguration(value: unknown): InstagramAudioConfiguration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const audio = value as { audio_id?: unknown; audio_volume?: unknown; video_volume?: unknown };
  if (Object.keys(audio).length !== 3 || !instagramAudioId(audio.audio_id)
      || typeof audio.audio_volume !== "number" || !Number.isInteger(audio.audio_volume) || audio.audio_volume < 1 || audio.audio_volume > 100
      || typeof audio.video_volume !== "number" || !Number.isInteger(audio.video_volume) || audio.video_volume < 1 || audio.video_volume > 100) return null;
  return { audio_id: audio.audio_id, audio_volume: audio.audio_volume, video_volume: audio.video_volume };
}
export function publicInstagramAudioSelection(value: unknown): InstagramAudioSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const audio = value as InstagramAudioSelection;
  const config = instagramAudioConfiguration({ audio_id: audio.audio_id, audio_volume: audio.audio_volume, video_volume: audio.video_volume });
  if (!config || Object.keys(audio).length !== 5 || !label(audio.title) || !label(audio.display_artist, true)) return null;
  return { ...config, title: audio.title.trim(), display_artist: audio.display_artist.trim() };
}
