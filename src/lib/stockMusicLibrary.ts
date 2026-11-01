import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import manifest from "../../assets/music/lofi-cc0-v1/manifest.json";
import type { StockReelOptions } from "./stockReel";
import type { ReelMusicBrief } from "./reelMusic";

/** Editorial mapping into this small licensed catalogue, never BPM or trend evidence. */
export function stockRecordingMood(brief: ReelMusicBrief | undefined, fallback: StockReelOptions["mood"]): StockReelOptions["mood"] {
  if (!brief || brief.mood === "uncertain") return fallback;
  return brief.mood === "warm" || brief.mood === "playful" ? "warm"
    : brief.mood === "energetic" || brief.mood === "uplifting" ? "journey" : "reflective";
}

export type StockRecordingSelection = { library: "cc0-lofi-v1"; trackId: string; offsetSeconds: number };
export type StockRecordingCredit = { trackId: string; title: string; artist: string; licence: "CC0-1.0"; sourcePage: string; assetSha256: string; originalOffsetSeconds: number };

/** Match the editorial mood before rotating recordings; saved retries keep their choice. */
export function selectStockRecording(mood: StockReelOptions["mood"], seed: string, recent: string[]): StockRecordingSelection {
  if (!["reflective", "warm", "journey"].includes(mood) || !seed || seed.length > 256) throw new Error("A supported mood and bounded reel seed are required for recorded music.");
  const history = recent.slice(0, 20), hash = (id: string) => crypto.createHash("sha256").update(`${seed}:${id}`).digest("hex");
  const age = (id: string) => history.includes(id) ? history.indexOf(id) : 100;
  const matching = manifest.recordings.filter(track => track.moods.includes(mood));
  if (!matching.length) throw new Error("No licensed recording matches this reel's selected mood.");
  const pool = matching.filter(track => !history.slice(0, 3).includes(track.id));
  const track = (pool.length ? pool : matching).slice().sort((a, b) => age(b.id) - age(a.id) || hash(a.id).localeCompare(hash(b.id)))[0];
  return { library: "cc0-lofi-v1", trackId: track.id, offsetSeconds: Number.parseInt(hash(track.id).slice(0, 2), 16) % 13 };
}

export function stockRecordingMetadata(selection: StockRecordingSelection): { filename: string; bytes: number; credit: StockRecordingCredit } {
  const track = manifest.recordings.find(item => item.id === selection.trackId);
  if (selection.library !== "cc0-lofi-v1" || !track || !Number.isInteger(selection.offsetSeconds) || selection.offsetSeconds < 0 || selection.offsetSeconds > 12
      || manifest.licence !== "CC0-1.0" || manifest.library !== selection.library || !/^[a-z-]+\.m4a$/.test(track.filename) || !/^[a-f0-9]{64}$/.test(track.sha256) || track.bytes > 1_200_000) throw new Error("This saved licensed music choice is invalid. No different soundtrack was substituted.");
  return { filename: track.filename, bytes: track.bytes, credit: { trackId: track.id, title: track.title, artist: manifest.artist, licence: "CC0-1.0", sourcePage: manifest.sourcePage, assetSha256: track.sha256, originalOffsetSeconds: track.originalOffsetSeconds + selection.offsetSeconds } };
}

/** Small committed media, not a runtime download, provider request or model. */
export async function stockRecordingFile(selection: StockRecordingSelection) {
  const { filename, bytes, credit } = stockRecordingMetadata(selection);
  const directory = path.join(process.cwd(), "assets", "music", "lofi-cc0-v1"), candidate = path.join(directory, filename);
  try {
    const link = await fs.lstat(candidate);
    if (!link.isFile() || link.isSymbolicLink() || link.size !== bytes || path.dirname(await fs.realpath(candidate)) !== await fs.realpath(directory)) throw new Error();
    const handle = await fs.open(candidate, "r");
    try {
      const data = Buffer.alloc(bytes + 1); let offset = 0;
      while (offset < data.length) { const read = await handle.read(data, offset, data.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
      if (offset !== bytes || crypto.createHash("sha256").update(data.subarray(0, offset)).digest("hex") !== credit.assetSha256) throw new Error();
    } finally { await handle.close(); }
    return candidate;
  } catch { throw new Error("A bundled licensed music file is missing or changed. Restore the current Phoenix update; the saved soundtrack was not replaced."); }
}

export function stockRecordingPreparationArgs(input: string, output: string, selection: StockRecordingSelection, duration: number) {
  stockRecordingMetadata(selection);
  if (!Number.isFinite(duration) || duration < 1 || duration > 40) throw new Error("Recorded automatic music requires a real reel duration of 1–40 seconds.");
  return ["-y", "-hide_banner", "-loglevel", "error", "-filter_threads", "1", "-threads", "1", "-ss", String(selection.offsetSeconds), "-i", input,
    "-t", duration.toFixed(6), "-vn", "-af", `afade=t=in:st=0:d=0.08,afade=t=out:st=${Math.max(0, duration - .8).toFixed(6)}:d=0.8`,
    "-c:a", "flac", "-sample_fmt", "s16", "-compression_level", "5", "-threads", "1", "-ar", "48000", "-ac", "2", output];
}
