/** Small, shared stock-reel planning helpers. No provider credentials or model calls. */
export type StockReelOptions = {
  audio: "auto" | "original" | "music" | "ambience-music";
  mood: "reflective" | "warm" | "journey";
  transition: "cut" | "soft";
  framing: "auto" | "fit";
};

export const DEFAULT_STOCK_REEL_OPTIONS: StockReelOptions = { audio: "auto", mood: "reflective", transition: "cut", framing: "auto" };
export const STOCK_REEL_FPS = 24;
export const MAX_STOCK_SHOTS = 6;
export const MAX_STOCK_REEL_BYTES = 500 * 1024 * 1024;

export type StockIntervalInput = { duration: number; start?: number; end?: number };
export type StockInterval = { start: number; end: number; outputStart: number; outputEnd: number; frames: number };

/** Preserve the selected order and every selected shot; shorten proportionally at the cap. */
export function planStockIntervals(shots: StockIntervalInput[], maximum: number): StockInterval[] {
  if (!shots.length || shots.length > MAX_STOCK_SHOTS || !Number.isFinite(maximum) || maximum <= 0 || maximum > 105) throw new Error("Choose one to six shots and a reel length up to 105 seconds.");
  const selected = shots.map(shot => {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) throw new Error("A selected shot has no readable duration.");
    const start = shot.start ?? 0, end = shot.end ?? shot.duration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= shot.duration || end > shot.duration + .15) throw new Error("A shot's trim lies outside the available footage. Choose its interval again.");
    return { start, end: Math.min(end, shot.duration) };
  });
  const total = selected.reduce((sum, shot) => sum + shot.end - shot.start, 0);
  const scale = Math.min(1, maximum / total);
  let cumulative = 0, frameCursor = 0;
  return selected.map(shot => {
    cumulative += (shot.end - shot.start) * scale;
    const nextFrame = Math.round(cumulative * STOCK_REEL_FPS);
    const frames = nextFrame - frameCursor;
    if (frames < 1) throw new Error("A selected interval is shorter than one video frame.");
    const outputStart = frameCursor / STOCK_REEL_FPS, outputEnd = nextFrame / STOCK_REEL_FPS;
    frameCursor = nextFrame;
    // Keep the selected ending when the total exceeds the cap, instead of cutting
    // the last action off halfway. The UI displays the shortened source interval.
    const end = shot.end, start = Math.max(shot.start, end - frames / STOCK_REEL_FPS);
    return { start, end, outputStart, outputEnd, frames };
  });
}

export function stockPortraitScore(video: { width: number; height: number; duration: number }) {
  const ratio = video.width / video.height;
  return (ratio <= .7 ? 3 : ratio < 1 ? 2 : 0) + Math.min(1, Math.min(video.width, video.height) / 720) * .2;
}

/** Fill only when the native aspect already retains at least 92% of the picture. */
export function stockFraming(info: { width: number; height: number }, mode: StockReelOptions["framing"] = "auto") {
  const aspect = info.width / info.height, target = 720 / 1280;
  const retained = Math.min(aspect / target, target / aspect);
  const fills = mode === "auto" && retained >= .92;
  return {
    name: "9:16" as const, width: 720, height: 1280,
    filter: fills
      ? "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1"
      : "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=#e5eae4,setsar=1",
    description: fills ? `Native portrait frame fills 9:16; ${Math.round(retained * 100)}% of the picture retained` : "Entire source picture retained inside a quiet pale 9:16 frame",
  };
}

/** A quiet stream can be valuable ambience. Only absent/nearly digital-silent audio is replaced automatically. */
export function stockAudioUsable(hasAudio: boolean, mean: number, peak: number) {
  return hasAudio && Number.isFinite(mean) && Number.isFinite(peak) && mean > -85 && peak > -75;
}

export function stockMusicMixGain(sourceMeans: number[]) {
  const measured = sourceMeans.filter(Number.isFinite);
  // This composition is around -24 dB RMS. Keep its bed roughly 12 dB below
  // even the quietest retained source, rather than burying a quiet stream.
  return measured.length ? Math.min(.28, 10 ** ((Math.min(...measured) + 12) / 20)) : 1;
}

export function stockShotFades(duration: number, index: number, count: number, transition: StockReelOptions["transition"]) {
  const fade = Math.min(.18, duration / 8);
  const video = transition === "soft" ? `${index > 0 ? `,fade=t=in:st=0:d=${fade.toFixed(3)}` : ""}${index < count - 1 ? `,fade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade.toFixed(3)}` : ""}` : "";
  // Tiny sound ramps remove clicks at edits; preserve the actual nature sound and its duration.
  const audio = `${index > 0 ? ",afade=t=in:st=0:d=0.035" : ""}${index < count - 1 ? `,afade=t=out:st=${Math.max(0, duration - .035).toFixed(3)}:d=0.035` : ""}`;
  return { video, audio };
}

/** Original modest instrumental compositions, varied by reel identity and mood. 16 kHz mono keeps RAM below 4 MB. */
export function stockMusicWav(duration: number, mood: StockReelOptions["mood"], seed: string) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 106) throw new Error("Local music duration exceeds the bounded reel limit.");
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const sampleRate = 16000, length = Math.ceil(duration * sampleRate), pcm = Buffer.alloc(44 + length * 2);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + length * 2, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sampleRate, 24); pcm.writeUInt32LE(sampleRate * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(length * 2, 40);
  const progressions = mood === "journey" ? [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]] : mood === "warm" ? [[0, 4, 7, 11], [5, 9, 12, 16], [9, 12, 16, 19], [7, 11, 14, 17]] : [[0, 3, 7, 10], [8, 12, 15, 19], [5, 8, 12, 15], [7, 10, 14, 17]];
  const tonic = 45 + hash % 7, beat = 60 / (mood === "journey" ? 88 + hash % 9 : mood === "warm" ? 72 + hash % 9 : 62 + hash % 7);
  const chordLength = beat * 8, phase = (hash % 1000) / 1000;
  const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate, chordIndex = Math.floor(time / chordLength), chord = progressions[(chordIndex + (hash >>> 8) % 4) % 4];
    const local = time % chordLength, padEnvelope = Math.min(1, local / .7) * Math.min(1, (chordLength - local) / .9);
    let pad = 0;
    for (const note of chord) pad += Math.sin(2 * Math.PI * frequency(tonic + note) * time + phase) / chord.length;
    const pulseIndex = Math.floor(time / (beat * 2)), note = chord[(pulseIndex + (hash >>> 12)) % chord.length] + tonic + 12;
    const age = time % (beat * 2), pluckEnvelope = Math.min(1, age / .025) * Math.exp(-age * (mood === "reflective" ? 2 : 3));
    const pluck = Math.sin(2 * Math.PI * frequency(note) * age) * pluckEnvelope;
    const bass = Math.sin(2 * Math.PI * frequency(tonic + chord[0] - 12) * time) * padEnvelope;
    const endFade = Math.min(1, time / .65, Math.max(0, duration - time) / 1.1);
    const value = (pad * .115 * padEnvelope + pluck * .10 + bass * .035) * endFade;
    pcm.writeInt16LE(Math.round(Math.max(-.8, Math.min(.8, value)) * 32767), 44 + index * 2);
  }
  return pcm;
}
