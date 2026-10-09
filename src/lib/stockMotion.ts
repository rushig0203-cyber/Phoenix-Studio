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

export function stockMotionScore(output: string) {
  // Three windows of nine small frames at most; never retain source pixels.
  const scores = [...output.slice(-32768).matchAll(/lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
  if (scores.length < 3 || scores.length > 16 || scores.some(value => !Number.isFinite(value) || value < 0 || value > 255)) return undefined;
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 1000) / 1000;
}

/** Speed both picture and source sound together; final music is composed later. */
export function stockPlaybackFilters(speed = 1) {
  if (!Number.isFinite(speed) || speed < 1 || speed > 1.4) throw new Error("Stock playback may only retain or modestly accelerate footage.");
  return { video: speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${speed}`, audio: speed === 1 ? "" : `atempo=${speed},` };
}
