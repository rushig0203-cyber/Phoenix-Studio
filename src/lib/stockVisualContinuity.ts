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

/** Decoded dimensions only; never guess subject position or crop a wide source. */
export function stockReadableOpening(infos: Array<{ width?: number; height?: number }>): number {
  if (!infos.length || infos.length > 12 || infos.some(info => !info || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width! <= 0 || info.height! <= 0)) return 0;
  const readable = (info: typeof infos[number]) => {
    const ratio = info.width! / info.height!, target = 720 / 1280;
    return Math.min(info.width!, info.height!) >= 720 && Math.min(ratio / target, target / ratio) >= .92;
  };
  if (readable(infos[0])) return 0;
  const opening = infos.findIndex(readable);
  return opening < 0 ? 0 : opening;
}

/** Default retains the anchor. Unknown appearance preserves the remaining source order. */
export function stockVisualOrder(samples: Array<StockAppearancePair | undefined>, openingIndex = 0): number[] {
  if (!samples.length || samples.length > 12) throw new Error("Choose a bounded shot sequence.");
  if (!Number.isSafeInteger(openingIndex) || openingIndex < 0 || openingIndex >= samples.length) throw new Error("Choose an opening from the decoded shot sequence.");
  if (samples.some(pair => pair && (!validStockAppearance(pair.opening) || !validStockAppearance(pair.ending)))) throw new Error("Invalid visual-continuity sample.");
  const sourceOrder = [openingIndex, ...samples.map((_sample, index) => index).filter(index => index !== openingIndex)];
  if (samples.some(pair => !pair)) return sourceOrder;
  const distance = (a: StockAppearance, b: StockAppearance) => Math.abs(a.luma - b.luma) * 1.4
    + Math.abs(a.u - b.u) + Math.abs(a.v - b.v) + Math.abs(a.contrast - b.contrast) * .25;
  const remaining = new Set(sourceOrder.slice(1)), order = [openingIndex];
  while (remaining.size) {
    const previous = samples[order[order.length - 1]];
    // Incomplete evidence is not permission to make an unsupported reorder.
    if (!previous) return sourceOrder;
    const next = [...remaining].sort((a, b) => distance(previous.ending, samples[a]!.opening) - distance(previous.ending, samples[b]!.opening) || a - b)[0];
    order.push(next); remaining.delete(next);
  }
  return order;
}
