export type StockBeat = { narration: string; query: string; assetId?: number };
export type StockShot = StockBeat & { start: number; end: number; sourcePage?: string; timing: "subtitle-boundary" | "within-caption-estimate" };

export function readStockShots(value: unknown, duration: number): StockShot[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("The renderer did not return a usable timed footage plan.");
  let end = 0;
  const shots = value.map((item): StockShot => {
    if (!item || typeof item.narration !== "string" || typeof item.query !== "string" || !Number.isFinite(item.start) || !Number.isFinite(item.end) || Math.abs(item.start - end) > 0.02 || item.end <= item.start || !["subtitle-boundary", "within-caption-estimate"].includes(item.timing)) throw new Error("The rendered footage plan has invalid or missing section timings.");
    end = item.end;
    let sourcePage: string | undefined;
    if (typeof item.sourcePage === "string") {
      const url = new URL(item.sourcePage);
      if (url.protocol === "https:" && /^(www\.)?(pexels\.com|pixabay\.com)$/.test(url.hostname) && !url.username && !url.password) sourcePage = `${url.origin}${url.pathname}`;
    }
    return { narration: item.narration.slice(0, 4000), query: item.query.slice(0, 80), start: item.start, end: item.end, timing: item.timing, sourcePage };
  });
  if (Math.abs(end - duration) > 0.15) throw new Error("The footage plan does not cover the finished video's duration.");
  return shots;
}

/** Keep complete sentences together. Only the renderer's spoken subtitle timings determine cuts. */
export function narrationBeats(script: string, count: number): string[] {
  const sentences = script.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g)?.map(s => s.trim()).filter(Boolean) || [];
  const target = Math.max(1, Math.min(18, count, sentences.length));
  const groups: string[] = [];
  let cursor = 0;
  for (let group = 0; group < target; group++) {
    const remaining = sentences.slice(cursor).join(" ").split(/\s+/).length;
    const budget = remaining / (target - group);
    const selected: string[] = [];
    let words = 0;
    while (cursor < sentences.length && (group === target - 1 || !selected.length || words < budget)) {
      if (selected.length && sentences.length - cursor <= target - group - 1) break;
      const nextWords = sentences[cursor].split(/\s+/).length;
      if (selected.length && group < target - 1 && Math.abs(words - budget) <= Math.abs(words + nextWords - budget)) break;
      const sentence = sentences[cursor++];
      selected.push(sentence);
      words += sentence.split(/\s+/).length;
    }
    groups.push(selected.join(" "));
  }
  return groups;
}

export async function createStockStoryboard(input: { topic: string; script: string; duration: number; visualTerms?: string[]; storyboard?: StockBeat[] }): Promise<StockBeat[]> {
  if (input.storyboard?.length && input.storyboard.map(beat => beat.narration).join(" ") === input.script) return input.storyboard;
  const supplied = input.visualTerms?.map(term => term.trim()).filter(Boolean);
  const beats = narrationBeats(input.script, supplied?.length || Math.ceil(input.duration / 9));
  if (!beats.length) throw new Error("The narration has no complete visual sections.");
  if (supplied?.length) return beats.map((narration, index) => ({ narration, query: supplied[Math.floor(index * supplied.length / beats.length)] }));
  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "qwen2.5:3b", stream: false, format: "json",
      prompt: `Plan real stock footage for this video: ${input.topic}. Return JSON with a queries array containing exactly ${beats.length} strings, in order. Each query must be 2 to 6 English words describing a visible subject and action in its narration section. Use literal filmable objects and actions, not abstract advice, emotions, text overlays or unrelated office filler. Do not invent visual events that contradict the narration. Narration sections: ${JSON.stringify(beats.map((narration, index) => ({ section: index + 1, narration })))}`,
      options: { temperature: 0.25, num_predict: beats.length * 35 + 64, num_thread: 2 },
    }), signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) throw new Error(`Visual planning failed: local Ollama returned ${response.status}. Retry or provide your own visual search terms.`);
  const payload = await response.json();
  let queries: unknown;
  try { queries = JSON.parse(String(payload.response || "")).queries; } catch { /* Invalid model output is not a usable plan. */ }
  if (!Array.isArray(queries) || queries.length !== beats.length || queries.some(query => typeof query !== "string" || query.trim().length < 3 || query.length > 80 || query.trim().split(/\s+/).length > 8)) {
    throw new Error("Local visual planning returned an incomplete shot list. Retry or add your own visual search terms. No random footage plan was substituted.");
  }
  return beats.map((narration, index) => ({ narration, query: (queries as string[])[index].replace(/\s+/g, " ").trim() }));
}
