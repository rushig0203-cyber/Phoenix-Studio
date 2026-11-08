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

export type StockRecordingSelection = { library: "cc0-lofi-v1"; trackId: string; offsetSeconds: number; timing?: "onset-v1" };
export type StockRecordingCredit = { trackId: string; title: string; artist: string; licence: "CC0-1.0"; sourcePage: string; assetSha256: string; originalOffsetSeconds: number; timing?: "onset-v1" };

/** Match the editorial mood before rotating recordings; saved retries keep their choice. */
export function selectStockRecording(mood: StockReelOptions["mood"], seed: string, recent: string[], measuredTiming = true, cutTimes: number[] = []): StockRecordingSelection {
  if (!["reflective", "warm", "journey"].includes(mood) || !seed || seed.length > 256) throw new Error("A supported mood and bounded reel seed are required for recorded music.");
  if (cutTimes.length > 11 || cutTimes.some((time, index) => !Number.isFinite(time) || time <= 0 || time >= 40 || index > 0 && time <= cutTimes[index - 1])) throw new Error("Recording selection needs up to eleven ordered final edit times.");
  const history = recent.slice(0, 20), hash = (id: string) => crypto.createHash("sha256").update(`${seed}:${id}`).digest("hex");
  const age = (id: string) => history.includes(id) ? history.indexOf(id) : 100;
  const matching = manifest.recordings.filter(track => track.moods.includes(mood));
  if (!matching.length) throw new Error("No licensed recording matches this reel's selected mood.");
  const pool = matching.filter(track => !history.slice(0, 3).includes(track.id));
  let track = (pool.length ? pool : matching).slice().sort((a, b) => age(b.id) - age(a.id) || hash(a.id).localeCompare(hash(b.id)))[0];
  let alignedOffset: number | undefined;
  if (measuredTiming && cutTimes.length) {
    const eligible = pool.length ? pool : matching.filter(candidate => age(candidate.id) === age(track.id));
    const choices = eligible.flatMap(candidate => candidate.onsets.seconds.filter(start => start >= .2 && start <= 12).map(start => {
      const distances = cutTimes.map(cut => Math.min(...candidate.onsets.seconds.map(onset => Math.abs(onset - start - cut))));
      return { track: candidate, start, matched: distances.filter(distance => distance <= 4 / 24).length,
        distance: distances.reduce((sum, distance) => sum + Math.min(.5, distance), 0), tie: hash(`${candidate.id}:${start}`) };
    })).sort((a, b) => b.matched - a.matched || a.distance - b.distance || a.tie.localeCompare(b.tie));
    if (choices.length) { track = choices[0].track; alignedOffset = choices[0].start; }
  }
  const starts = track.onsets.seconds.filter(seconds => seconds >= .2 && seconds <= 12);
  const choice = Number.parseInt(hash(track.id).slice(0, 4), 16);
  return measuredTiming && starts.length
    ? { library: "cc0-lofi-v1", trackId: track.id, offsetSeconds: alignedOffset ?? starts[choice % starts.length], timing: "onset-v1" }
    : { library: "cc0-lofi-v1", trackId: track.id, offsetSeconds: Number.parseInt(hash(track.id).slice(0, 2), 16) % 13 };
}

export function stockRecordingMetadata(selection: StockRecordingSelection): { filename: string; bytes: number; credit: StockRecordingCredit } {
  const track = manifest.recordings.find(item => item.id === selection.trackId);
  if (selection.library !== "cc0-lofi-v1" || !track || !Number.isFinite(selection.offsetSeconds) || selection.offsetSeconds < 0 || selection.offsetSeconds > 12
      || (selection.timing === undefined ? !Number.isInteger(selection.offsetSeconds) : selection.timing !== "onset-v1" || !track.onsets.seconds.includes(selection.offsetSeconds))
      || manifest.licence !== "CC0-1.0" || manifest.library !== selection.library || !/^[a-z-]+\.m4a$/.test(track.filename) || !/^[a-f0-9]{64}$/.test(track.sha256) || track.bytes > 1_200_000) throw new Error("This saved licensed music choice is invalid. No different soundtrack was substituted.");
  return { filename: track.filename, bytes: track.bytes, credit: { trackId: track.id, title: track.title, artist: manifest.artist, licence: "CC0-1.0", sourcePage: manifest.sourcePage, assetSha256: track.sha256, originalOffsetSeconds: track.originalOffsetSeconds + selection.offsetSeconds, ...(selection.timing ? { timing: selection.timing } : {}) } };
}

/** Verified recording attacks, not an inferred tempo/downbeat or a runtime model. */
export function stockRecordingOnsets(selection: StockRecordingSelection): number[] {
  stockRecordingMetadata(selection);
  if (selection.timing !== "onset-v1") return [];
  return manifest.recordings.find(track => track.id === selection.trackId)!.onsets.seconds
    .map(seconds => Number((seconds - selection.offsetSeconds).toFixed(3))).filter(seconds => seconds > 0 && seconds <= 40);
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
  const fadeIn = selection.timing === "onset-v1" ? .012 : .08, fadeOut = selection.timing === "onset-v1" ? .35 : .8;
  return ["-y", "-hide_banner", "-loglevel", "error", "-filter_threads", "1", "-threads", "1", "-ss", String(selection.offsetSeconds), "-i", input,
    "-t", duration.toFixed(6), "-vn", "-af", `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(6)}:d=${fadeOut}`,
    "-c:a", "flac", "-sample_fmt", "s16", "-compression_level", "5", "-threads", "1", "-ar", "48000", "-ac", "2", output];
}
