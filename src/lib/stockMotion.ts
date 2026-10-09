/** Tiny sampled movement measurements, not a semantic or full-video review. */
export type StockMotionWindow = { start: number; end: number; motion: number };

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
