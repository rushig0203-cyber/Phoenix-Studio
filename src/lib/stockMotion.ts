/** Tiny sampled movement measurements, not a semantic or full-video review. */
export type StockMotionWindow = { start: number; end: number; motion: number; greenFraction?: number };

export const STOCK_COLOUR_FRAME_BYTES = 96 * 54 * 3;
export const STOCK_COLOUR_MAX_BYTES = STOCK_COLOUR_FRAME_BYTES * 16;

/** Same existing 2fps/96px windows, streamed raw; no additional decoding pass. */
export function stockGreeneryArgs(source: string, window: { start: number; end: number }) {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < 0 || window.end <= window.start || window.end - window.start > 4.5 + 1e-7) throw new Error("Invalid bounded colour sample window.");
  return ["-hide_banner", "-nostats", "-loglevel", "error", "-filter_threads", "1", "-ss", window.start.toFixed(6), "-t", (window.end - window.start).toFixed(6),
    "-threads", "1", "-i", source, "-an", "-vf", "fps=2,scale=96:54,format=rgb24", "-frames:v", "16",
    "-threads", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"];
}

/** Colour is a modest composition cue, not proof of plants, season or location. */
export function stockGreeneryEvidence(pixels: Buffer): { motion: number; greenFraction: number } | undefined {
  const count = pixels.length / STOCK_COLOUR_FRAME_BYTES;
  if (!Number.isInteger(count) || count < 4 || count > 16) return undefined;
  const green: number[] = [], movements: number[] = [];
  for (let frame = 0; frame < count; frame++) {
    let qualifying = 0, delta = 0;
    const offset = frame * STOCK_COLOUR_FRAME_BYTES;
    for (let pixel = 0; pixel < STOCK_COLOUR_FRAME_BYTES; pixel += 3) {
      const r = pixels[offset + pixel], g = pixels[offset + pixel + 1], b = pixels[offset + pixel + 2];
      // Reject neutral grey and blue sky. Do not count nearly black codec noise.
      if (g >= 24 && g - r >= 8 && g - b >= 8 && g >= r * 1.08 && g >= b * 1.08) qualifying++;
      if (frame) {
        const previous = offset + pixel - STOCK_COLOUR_FRAME_BYTES;
        delta += Math.abs(.2126 * (r - pixels[previous]) + .7152 * (g - pixels[previous + 1]) + .0722 * (b - pixels[previous + 2]));
      }
    }
    green.push(qualifying / (96 * 54));
    if (frame) movements.push(delta / (96 * 54));
  }
  const median = (values: number[]) => {
    const ordered = values.sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  };
  return { motion: Math.round(median(movements) * 1000) / 1000, greenFraction: Math.round(median(green) * 10000) / 10000 };
}

/** Preserve greenery when motion alone would choose a pan away into the sky. */
export function stockGreenerySelection(windows: StockMotionWindow[][]): { indices: number[]; windows: StockMotionWindow[][]; threshold?: number } {
  if (!Array.isArray(windows) || !windows.length || windows.length > 10 || windows.some(parts => !Array.isArray(parts) || parts.length > 3 || parts.some(window => !Number.isFinite(window.motion) || window.motion < 0 || window.motion > 255 || (window.greenFraction !== undefined && (!Number.isFinite(window.greenFraction) || window.greenFraction < 0 || window.greenFraction > 1))))) throw new Error("Invalid bounded greenery evidence.");
  const anchor = windows[0]?.filter(window => window.greenFraction !== undefined);
  if (!anchor?.length) return { indices: windows.map((_window, index) => index), windows };
  const threshold = Math.max(.06, Math.min(.18, Math.max(...anchor.map(window => window.greenFraction!)) * .45));
  if (!anchor.some(window => window.greenFraction! >= threshold)) throw new Error("The selected greenery shot has no sustained green-colour evidence in its sampled windows. Choose another starting shot; Phoenix will not fill the reel with grey or sky-only footage.");
  const indices: number[] = [], selected: StockMotionWindow[][] = [];
  windows.forEach((parts, index) => {
    const measured = parts.filter(window => window.greenFraction !== undefined);
    // Missing samples remain explicitly unknown, not invented validation.
    if (!measured.length) { indices.push(index); selected.push(parts); return; }
    const eligible = measured.filter(window => window.greenFraction! >= threshold);
    if (!eligible.length) return;
    const maximum = Math.max(...eligible.map(window => window.greenFraction!));
    indices.push(index);
    // Keep motion choice within the greener measured windows of that source.
    selected.push(eligible.filter(window => window.greenFraction! >= maximum * .75));
  });
  return { indices, windows: selected, threshold };
}

export function stockMotionSamples(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("Invalid picture bounds for motion sampling.");
  const span = Math.min(4.5, end - start);
  const positions = [start, start + (end - start - span) / 2, end - span];
  return positions.filter((position, index) => !positions.slice(0, index).some(previous => Math.abs(previous - position) < 1))
    .map(position => ({ start: position, end: position + span }));
}

export function stockMotionArgs(source: string, window: { start: number; end: number }) {
  return ["-hide_banner", "-nostats", "-loglevel", "info", "-filter_threads", "1", "-ss", window.start.toFixed(6), "-t", (window.end - window.start).toFixed(6),
    "-threads", "1", "-i", source, "-an", "-vf", "fps=2,scale=96:54,format=yuv420p,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-threads", "1", "-f", "null", "-"];
}

function stockMotionValues(output: string): number[] | undefined {
  // Three windows of nine small frames at most; never retain source pixels.
  const scores = [...output.slice(-32768).matchAll(/lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
  if (scores.length < 3 || scores.length > 16 || scores.some(value => !Number.isFinite(value) || value < 0 || value > 255)) return undefined;
  return scores;
}

/** Historical saved recipes retain their arithmetic-mean movement score. */
export function stockMotionScore(output: string) {
  const scores = stockMotionValues(output);
  if (!scores) return undefined;
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 1000) / 1000;
}

/**
 * The median favours sustained sampled pixel movement over one/two exposure or
 * edit spikes, without more decoded frames. It is not scene/action recognition;
 * gradual camera movement and animated water can still score as movement.
 */
export function stockSustainedMotionScore(output: string) {
  const scores = stockMotionValues(output);
  if (!scores) return undefined;
  const ordered = [...scores].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  return Math.round(median * 1000) / 1000;
}

/** Speed both picture and source sound together; final music is composed later. */
export function stockPlaybackFilters(speed = 1) {
  if (!Number.isFinite(speed) || speed < 1 || speed > 1.4) throw new Error("Stock playback may only retain or modestly accelerate footage.");
  return { video: speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${speed}`, audio: speed === 1 ? "" : `atempo=${speed},` };
}

/** The prepared shot's sound is already trimmed/accelerated into output time. */
export function stockSpeechSampleArgs(shotFile: string, sampleFile: string, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 105) throw new Error("Invalid prepared-shot speech duration.");
  return ["-y", "-hide_banner", "-loglevel", "error", "-filter_threads", "1", "-filter_complex_threads", "1", "-t", duration.toFixed(6),
    "-threads", "1", "-i", shotFile, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", sampleFile];
}
