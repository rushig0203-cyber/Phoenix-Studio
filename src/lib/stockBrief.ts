const stop = new Set("a an the and or but in on at of to for with from by is are was were be been it its this that these those your you we our they their them as so then now how what why when can will would could should one two three ways about into more most just make makes get very useful simple idea example step next start first finally".split(" "));

export function visualWords(text: string) {
  return [...new Set(text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])].filter(word => !stop.has(word));
}

/** An ordered search brief, not a claim of frame-level visual understanding. */
export function stockVisualBrief(topic: string, script: string, supplied?: string[]) {
  if (supplied?.length) return supplied.map(term => term.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8);
  const anchor = visualWords(topic).slice(0, 2).join(" ");
  const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
  const groupSize = Math.max(1, Math.ceil(sentences.length / 5));
  const terms: string[] = [];
  for (let index = 0; index < sentences.length; index += groupSize) {
    const words = visualWords(sentences.slice(index, index + groupSize).join(" ")).filter(word => !anchor.split(" ").includes(word));
    const term = `${anchor} ${words.slice(0, 2).join(" ")}`.trim();
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms.length ? terms : [visualWords(topic).slice(0, 4).join(" ") || topic.trim()];
}

export function stockScriptWordRange(duration: number) {
  return { min: Math.max(100, Math.round(duration * 2.35)), max: Math.max(120, Math.min(650, Math.round(duration * 3.1))) };
}

export function stockNarrationError(script: string, duration: number) {
  const words = script.match(/\b[\p{L}\p{N}'-]+\b/gu)?.length || 0;
  const range = stockScriptWordRange(duration);
  return words < range.min || words > range.max || !/[.!?]["'”’)]*$/.test(script.trim())
    ? `Your narration has ${words} words. Use ${range.min}–${range.max} words and a complete ending for ${duration} seconds, or change the duration. Phoenix will not replace your words.` : null;
}

export function checkStockScript(topic: string, script: string, duration: number) {
  const words = script.trim().split(/\s+/).filter(Boolean);
  const range = stockScriptWordRange(duration);
  const topicMatch = visualWords(topic).some(word => script.toLowerCase().includes(word));
  const complete = /[.!?]["'”’)]*$/.test(script.trim());
  const length = words.length >= range.min && words.length <= range.max;
  const score = (topicMatch ? 40 : 0) + (complete ? 30 : 0) + (length ? 30 : 0);
  return { score, reason: `Text checks only: topic vocabulary ${topicMatch ? "present" : "missing"}; complete ending ${complete ? "yes" : "no"}; narration length ${length ? "in range" : "needs review"}. Stock search order is a visual brief, not verified shot-to-speech alignment. Watch the result: these checks do not measure footage relevance, audio quality or likely views.` };
}
