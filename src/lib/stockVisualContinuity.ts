/** Tiny picture statistics for shot-to-shot light/colour matching, not subject recognition. */
export type StockAppearance = { luma: number; u: number; v: number; contrast: number };
export type StockAppearancePair = { opening: StockAppearance; ending: StockAppearance };

export function stockAppearanceArgs(source: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid appearance sample time.");
  return ["-hide_banner", "-nostats", "-loglevel", "info", "-filter_threads", "1", "-ss", seconds.toFixed(6),
    "-threads", "1", "-i", source, "-an", "-vf", "scale=32:18,format=yuv420p,signalstats,metadata=print",
    "-frames:v", "1", "-threads", "1", "-f", "null", "-"];
}

export function stockAppearance(output: string): StockAppearance | undefined {
  const field = (name: string) => {
    const match = output.slice(-16384).match(new RegExp(`lavfi\\.signalstats\\.${name}=(\\d+(?:\\.\\d+)?)`));
    const number = match ? Number(match[1]) : NaN;
    return Number.isFinite(number) && number >= 0 && number <= 255 ? number : undefined;
  };
  const luma = field("YAVG"), u = field("UAVG"), v = field("VAVG"), low = field("YLOW"), high = field("YHIGH");
  if (luma === undefined || u === undefined || v === undefined || low === undefined || high === undefined || high < low) return undefined;
  return { luma, u, v, contrast: high - low };
}

export function validStockAppearance(value: unknown): value is StockAppearance {
  if (!value || typeof value !== "object") return false;
  const sample = value as StockAppearance;
  return [sample.luma, sample.u, sample.v, sample.contrast].every(number => Number.isFinite(number) && number >= 0 && number <= 255);
}

/** Anchor stays first. Unknown samples keep catalogue order; ties are deterministic. */
export function stockVisualOrder(samples: Array<StockAppearancePair | undefined>): number[] {
  if (!samples.length || samples.length > 12) throw new Error("Choose a bounded shot sequence.");
  if (samples.some(pair => pair && (!validStockAppearance(pair.opening) || !validStockAppearance(pair.ending)))) throw new Error("Invalid visual-continuity sample.");
  if (samples.some(pair => !pair)) return samples.map((_sample, index) => index);
  const distance = (a: StockAppearance, b: StockAppearance) => Math.abs(a.luma - b.luma) * 1.4
    + Math.abs(a.u - b.u) + Math.abs(a.v - b.v) + Math.abs(a.contrast - b.contrast) * .25;
  const remaining = new Set(samples.map((_sample, index) => index).slice(1)), order = [0];
  while (remaining.size) {
    const previous = samples[order[order.length - 1]];
    // Incomplete evidence is not permission to make an unsupported reorder.
    if (!previous) return samples.map((_sample, index) => index);
    const next = [...remaining].sort((a, b) => distance(previous.ending, samples[a]!.opening) - distance(previous.ending, samples[b]!.opening) || a - b)[0];
    order.push(next); remaining.delete(next);
  }
  return order;
}
