import type { ReviewFile } from "./reviewFiles";

/** A candidate bank is not the platform's allowed posting count. */
export const VIDEO_HASHTAG_BANK_LIMIT = 20;
export const INSTAGRAM_HASHTAG_LIMIT = 5;
export const STOCK_POSTING_CAPTION_WORD_LIMIT = 24;
export const STOCK_POSTING_CAPTION_CHARACTER_LIMIT = 160;
export const YOUTUBE_DESCRIPTION_BYTE_LIMIT = 5000;

/** YouTube validates the description as UTF-8 bytes, not JavaScript characters. */
export function youtubePostingTextIssue(title: string, description: string) {
  if (/[<>]/.test(title)) return "YouTube titles cannot contain < or >. Edit the title before uploading.";
  if (/[<>]/.test(description)) return "YouTube descriptions cannot contain < or >. Edit the description before uploading.";
  if (new TextEncoder().encode(description).byteLength > YOUTUBE_DESCRIPTION_BYTE_LIMIT) {
    return `YouTube descriptions must contain at most ${YOUTUBE_DESCRIPTION_BYTE_LIMIT} UTF-8 bytes. Shorten the description before uploading.`;
  }
  return undefined;
}

/** Narrated creations keep their existing copy policy; speech cues are separate. */
export function usesConciseStockPostingCaption(file: Pick<ReviewFile, "source" | "quality">) {
  return file.source.kind !== "upload" && ["natural-audio-preserved", "local-music-replaced", "no-audio", "needs-review"].includes(file.quality.audio);
}

/** Reject verbose generated candidates without cutting a sentence or owner text. */
export function stockPostingCaptionIssue(copy: string) {
  const clean = copy.trim().normalize("NFKC").replace(/[‐-―]/g, "-");
  if (clean.length > STOCK_POSTING_CAPTION_CHARACTER_LIMIT || (clean.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length > STOCK_POSTING_CAPTION_WORD_LIMIT) return "Use one short sentence focused on one visible subject or action.";
  if ((clean.match(/[^.!?。！？]+[.!?。！？]*/gu) || []).filter(sentence => sentence.trim()).length > 1 || /[\r\n;]/.test(clean)) return "Use one sentence, without a scene list.";
  if (captionHashtags(clean).length) return "Keep hashtags outside the caption.";
  if (/\b(?:(?:is|are)\s+(?:being\s+)?shown|(?:video|scene)\s+shifts?\b|in\s+(?:these|the\s+sampled)\s+frames)\b/i.test(clean)) return "Describe the visible subject directly, without describing the video or sampled frames.";
  if (/\b(?:first[\s-]+person (?:view|perspective)|the (?:video|camera|scene)|(?:close[\s-]*up|wide[\s-]*angle|aerial|low[\s-]*angle) (?:view|shot)|shots? of|followed by|cuts? to|from .+ to .+)\b/i.test(clean)) return "Describe the subject naturally, without camera directions or a shot inventory.";
  if (/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|multiple|different|various)(?:[\s-]+(?:distinct|different|separate|brief|successive))*[\s-]+(?:scenes?|shots?|clips?|frames?)\b/i.test(clean)) return "Describe the visible subject, not how many scenes or shots were edited together.";
  return undefined;
}

/** Include tags already typed into a caption; duplicates still consume slots. */
export function captionHashtags(copy: string) {
  return copy.normalize("NFKC").match(/#[\p{L}\p{N}_]+/gu) || [];
}

/** Small local checks; caption history never leaves this laptop. */
export function postingCaptionOnly(copy: string) {
  return copy.split(/\n(?:Footage sources?:|Report source:)/i, 1)[0].trim();
}

function words(copy: string) {
  return postingCaptionOnly(copy).normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function similarity(left: string, right: string) {
  const a = words(left), b = words(right);
  if (a.join(" ") === b.join(" ")) return 1;
  if (!a.length || !b.length) return 0;
  const pairs = (items: string[]) => new Set(items.map((word, index) => `${word} ${items[index + 1] || ""}`));
  const x = pairs(a), y = pairs(b);
  const overlap = [...x].filter(pair => y.has(pair)).length;
  return overlap / Math.max(x.size, y.size);
}

/** Keep the model's preference unless a valid supplied alternative avoids a near-exact recent repeat. */
export function choosePostingCaption(caption: string, alternatives: string[], previousCopies: string[], conciseStockCaption = false) {
  const candidates = [...new Set([caption, ...alternatives].map(text => text.trim()).filter(Boolean))].slice(0, 4)
    .filter(text => !conciseStockCaption || !stockPostingCaptionIssue(text));
  if (!candidates.length) throw new Error("No grounded posting caption was supplied.");
  const history = previousCopies.map(postingCaptionOnly).filter(Boolean).slice(0, 30);
  const scored = candidates.map(text => ({ text, similarity: Math.max(0, ...history.map(old => similarity(text, old))) }));
  const preferred = scored[0];
  const chosen = preferred.similarity >= 0.8 ? scored.find(candidate => candidate.similarity < 0.8) || preferred : preferred;
  return { caption: chosen.text, variation: chosen.similarity >= 0.8 ? "similar" as const : "distinct" as const };
}

/** Relevance comes from the video analysis, not random or engagement-bait tags. */
export function videoHashtags(tags: string[]) {
  const seen = new Set<string>();
  return tags.filter(tag => {
    if (!/^#[\p{L}\p{N}_]{2,40}$/u.test(tag)) return false;
    const key = tag.normalize("NFKC").toLowerCase();
    if (/^#(?:phoenixstudio|viral|fyp|trending|explorepage)$/.test(key) || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, VIDEO_HASHTAG_BANK_LIMIT);
}

export function postingAnalysisMayApply(current: ReviewFile, snapshot: ReviewFile, startedAt: string) {
  return current.status === "READY" && current.quality.postingAnalysis?.status === "ANALYZING"
    && current.quality.postingAnalysis.updatedAt === startedAt && current.editedFrom === snapshot.editedFrom
    && current.quality.postingTextOrigin === snapshot.quality.postingTextOrigin
    && current.quality.postCopy === snapshot.quality.postCopy && JSON.stringify(current.outputs) === JSON.stringify(snapshot.outputs)
    && JSON.stringify(current.quality.hashtags) === JSON.stringify(snapshot.quality.hashtags);
}
