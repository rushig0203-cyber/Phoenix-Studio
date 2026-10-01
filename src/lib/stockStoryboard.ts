import { actionMismatch } from "./footageSemantics";
import type { CreativeBrief } from "./creativeBrief";
import { generateWritingModel, withWritingSession } from "./writingModel";
export type StockBeat = { narration: string; query: string; assetId?: number };
export type StockShot = StockBeat & { start: number; end: number; sourcePage?: string; timing: "subtitle-boundary" | "within-caption-estimate" };

/** Catch explicit subject/action swaps; this is not a semantic vision score. */
export function stockQueryMismatch(narration: string, query: string) {
  const concepts: Array<[RegExp, RegExp, string]> = [
    [/chatbot|chat bot|artificial intelligence/i, /chatbot|chat bot|automat|bot\b|artificial intelligence/i, "chatbot"],
    [/follow.?up/i, /follow.?up|reach out|check.*(?:customer|client)|after.*(?:solv|visit|purchase)/i, "follow-up"],
    [/teach|train|workshop/i, /teach|train|learn|skill|practice|practi[cs]e|listen.*question/i, "teaching/training"],
    [/coffee|espresso|cappuccino/i, /coffee|espresso|cappuccino|caffeine|cup|drink|brew/i, "coffee"],
    [/cloud|sky/i, /cloud|sky|weather|outside|outdoor|sun|rain/i, "sky/clouds"],
    [/handshake|shaking hands/i, /handshake|shak.*hand|greet|meet|welcome|thank|agreement/i, "handshake"],
    [/phone|headset|telephone|(?:video|follow.?up) call/i, /phone|headset|telephone|call|contact|talk|conversation|reach out/i, "phone call"],
    [/notebook|writing|taking notes/i, /notebook|writ|note|jot|list|paper|pen|plan|record/i, "writing"],
  ];
  return concepts.find(([visual, spoken]) => visual.test(query) && !spoken.test(narration))?.[2] || actionMismatch(narration, query);
}

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

export async function createStockStoryboard(input: { topic: string; script: string; duration: number; visualTerms?: string[]; storyboard?: StockBeat[]; creativeBrief?: CreativeBrief }): Promise<StockBeat[]> {
  if (input.storyboard?.length && input.storyboard.map(beat => beat.narration).join(" ") === input.script) return input.storyboard;
  const supplied = input.visualTerms?.map(term => term.trim()).filter(Boolean);
  const beats = narrationBeats(input.script, supplied?.length || Math.ceil(input.duration / 6));
  if (!beats.length) throw new Error("The narration has no complete visual sections.");
  if (supplied?.length) return beats.map((narration, index) => ({ narration, query: supplied[Math.floor(index * supplied.length / beats.length)] }));
  return withWritingSession(async () => {
  const continuity = `Selected structure: ${input.creativeBrief?.structure || "follow the narration"}. Preserve subjects, object states and setting when consecutive sections describe one continuing action. Explanations and comparisons may use different relevant subjects and settings; do not invent a recurring character or force a fictional shop story. Keep a coherent visual treatment, not an identical cast. Different stock actors must not be treated as proof of the same person's identity.`;
  const response = await generateWritingModel({
      model: process.env.OLLAMA_MODEL || "qwen2.5:3b", format: "json",
      prompt: `You are editing ONE coherent real-footage video, not assembling a random montage. Topic: ${input.topic}. Return JSON with a queries array containing exactly ${beats.length} strings, in order. ${continuity} Each query must be 2 to 6 English words describing the visible subject and action in its section. Use literal filmable objects and actions, not abstract advice, emotions, text overlays or unrelated office filler. Never use coffee, clouds, handshakes or laptop typing unless the narration calls for them. Do not invent visual events that contradict the narration. Narration sections: ${JSON.stringify(beats.map((narration, index) => ({ section: index + 1, narration })))}`,
      options: { temperature: 0.25, num_predict: beats.length * 70 + 128, num_thread: 2, num_ctx: 4096 },
    }, { timeoutMs: 150_000 });
  if (!response.ok) throw new Error(`Visual planning failed: the writer returned ${response.status}. Retry or provide your own visual search terms.`);
  const payload = await response.json();
  let queries: unknown;
  try { queries = JSON.parse(String(payload.response || "")).queries; } catch { /* Invalid model output is not a usable plan. */ }
  const invalid = (value: unknown) => !Array.isArray(value) || value.length !== beats.length || value.some(query => typeof query !== "string" || query.trim().length < 3 || query.length > 80 || query.trim().split(/\s+/).length > 8);
  if (invalid(queries)) {
    const repair = await generateWritingModel({ model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
        format: { type: "object", properties: { queries: { type: "array", minItems: beats.length, maxItems: beats.length, items: { type: "string", minLength: 3, maxLength: 80 } } }, required: ["queries"], additionalProperties: false },
        prompt: `The previous shot list was incomplete or malformed. Rebuild exactly ${beats.length} queries, one per numbered section, in order. Topic: ${input.topic}. ${continuity} Use 2–6 English words per query describing only the literal subject/action in that section. No generic filler. Do not rewrite, omit, merge or reorder narration. Sections: ${JSON.stringify(beats.map((narration, index) => ({ section: index + 1, narration })))}`,
        options: { temperature: .1, num_predict: beats.length * 70 + 128, num_thread: 2, num_ctx: 4096 } }, { timeoutMs: 150_000 });
    if (!repair.ok) throw new Error(`Shot-list repair failed: the writer returned ${repair.status}. The saved narration is retained for retry.`);
    try { queries = JSON.parse(String((await repair.json()).response || "")).queries; } catch { queries = undefined; }
    if (invalid(queries)) throw new Error("Visual planning returned an incomplete shot list even after automatic repair. The saved narration is retained. No random footage plan was substituted.");
  }
  const planned = beats.map((narration, index) => ({ narration, query: (queries as string[])[index].replace(/\s+/g, " ").trim() }));
  const mismatches = planned.flatMap((beat, index) => {
    const mismatch = stockQueryMismatch(beat.narration, beat.query);
    return mismatch ? [{ section: index, narration: beat.narration, rejectedQuery: beat.query, reason: `${mismatch} is not described in this section` }] : [];
  });
  if (mismatches.length) {
    // One bounded repair, restricted to the failing sections. Never shift
    // a query to the following sentence or fall back to generic office filler.
    const repaired = await generateWritingModel({ model: process.env.OLLAMA_MODEL || "qwen2.5:3b", format: "json", options: { temperature: .1, num_predict: mismatches.length * 45 + 64, num_thread: 2, num_ctx: 4096 },
      prompt: `Fix these stock footage mismatches. Return JSON {"queries": [strings]} with exactly ${mismatches.length} queries in the listed order. Each query is 2–6 literal English words. Topic: ${input.topic}. ${continuity} Depict ONLY what that section says. Do not anticipate later narration. Do not copy the rejected query. Sections: ${JSON.stringify(mismatches)}` }, { timeoutMs: 120_000 });
    let replacements: unknown;
    if (repaired.ok) { try { replacements = JSON.parse(String((await repaired.json()).response || "")).queries; } catch { /* Report invalid repair below. */ } }
    if (!Array.isArray(replacements) || replacements.length !== mismatches.length || replacements.some((query, index) => typeof query !== "string" || query.trim().length < 3 || query.length > 80 || query.trim().split(/\s+/).length > 8 || stockQueryMismatch(mismatches[index].narration, query))) {
      throw new Error(`Footage plan does not match narration in section ${mismatches[0].section + 1} (${mismatches[0].reason}). Repair failed. Retry or supply a literal visual brief; no mismatched filler was rendered.`);
    }
    for (const [index, mismatch] of mismatches.entries()) planned[mismatch.section].query = replacements[index].replace(/\s+/g, " ").trim();
  }
  return planned;
  });
}
