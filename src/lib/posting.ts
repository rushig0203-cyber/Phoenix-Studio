import type { ReviewFile, ReviewTarget } from "./reviewFiles";
import { captionHashtags, INSTAGRAM_HASHTAG_LIMIT, VIDEO_HASHTAG_BANK_LIMIT, videoHashtags } from "./postingCopyPolicy";

const providerTag = /^#(?:pexels|pixabay)(?:videos?|footage)?$/iu;

/** Stock catalogue names are provenance, not tags describing the finished reel. */
export function postingHashtags(tags: string[]) {
  return videoHashtags(tags.filter(tag => !providerTag.test(tag.normalize("NFKC"))));
}

function stockPage(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^(?:www\.)?(?:pexels|pixabay)\.com$/i.test(url.hostname);
  } catch { return false; }
}

/**
 * Omit Phoenix's old stock-credit footers without changing the saved metadata.
 * Only recognized generated structures are removed: ordinary owner text,
 * standalone URLs, other source credits and report citations remain intact.
 */
export function stripFootageProvenance(copy: string, file: ReviewFile) {
  const visual = file.quality.visualSources || [];
  const knownCredits = new Set<string>();
  const knownShotCredits = new Set(visual.flatMap((source, index) => stockPage(source.providerUrl)
    ? [`Shot ${index + 1}: ${source.creator} / ${source.provider} — ${source.providerUrl}`] : []));
  const creators = new Map<string, Set<string>>();
  const remember = (provider: string, creator: string | undefined, sourceUrl: string | undefined, licence: string | undefined) => {
    if (!/^(?:pexels|pixabay)$/i.test(provider)) return;
    const key = provider.toLowerCase();
    if (creator) {
      const names = creators.get(key) || new Set<string>(); names.add(creator.trim().toLowerCase()); creators.set(key, names);
    }
    const url = sourceUrl && stockPage(sourceUrl) ? new URL(sourceUrl) : undefined;
    if (url) { url.search = ""; url.hash = ""; }
    knownCredits.add([provider, creator, url?.href, licence].filter(Boolean).join(" · ").replace(/[\u0000-\u001f]/g, " ").slice(0, 600).toLowerCase());
  };
  visual.forEach(source => remember(source.provider, source.creator, source.providerUrl, source.licence));
  const source = file.source;
  if (source) {
    // Single-source exports stored their creator in the licence field before
    // visualSources was introduced. Do not mistake other owner text for it.
    const creator = source.licence?.match(/^(?:Pexels License|Pixabay Content License) · (.+?) · verify reuse rights before posting$/i)?.[1];
    remember(source.kind, creator, source.providerUrl, source.licence);
    remember(source.kind, undefined, source.providerUrl, source.licence);
  }
  const urlsOnly = (text: string) => {
    const urls = text.trim().split(/\s+/).filter(Boolean);
    return urls.length > 0 && urls.every(stockPage);
  };
  const stockCredit = (text: string) => /^(?:pexels|pixabay)\s*·/i.test(text.trim())
    && (knownCredits.has(text.trim().toLowerCase()) || (text.match(/https:\/\/[^\s<>()]+/gu) || []).some(stockPage));
  const lines = copy.replace(/\r\n?/g, "\n").split("\n"), kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], footage = line.match(/^\s*Footage sources?:\s*(.*)$/i);
    // Older assembled reels appended one generated credit per ordered shot.
    // Match the complete saved provenance, not arbitrary "Shot 1" narration.
    if (knownShotCredits.has(line.trim())) continue;
    if (footage && (urlsOnly(footage[1]) || (!footage[1] && urlsOnly(lines[index + 1] || "")))) {
      while (index + 1 < lines.length && urlsOnly(lines[index + 1])) index++;
      continue;
    }
    const legacy = line.match(/^\s*Footage:\s*(.+?)\s*\/\s*(pexels|pixabay)\.\s*$/i);
    if (legacy && creators.get(legacy[2].toLowerCase())?.has(legacy[1].trim().toLowerCase())) continue;
    if (/^\s*Source credits:\s*$/i.test(line)) {
      const entries: string[] = []; let removed = false;
      let next = index + 1;
      while (next < lines.length && lines[next].trim() && !/^\s*Report source:/i.test(lines[next])) {
        if (stockCredit(lines[next])) removed = true; else entries.push(lines[next]);
        next++;
      }
      if (removed) { if (entries.length) kept.push(line, ...entries); index = next - 1; continue; }
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function postingCaption(file: ReviewFile) {
  return stripFootageProvenance(file.quality.postCopy?.trim() || "", file) || file.title;
}

export function postingText(file: ReviewFile, target?: ReviewTarget) {
  const caption = postingCaption(file);
  const embedded = captionHashtags(caption);
  const present = new Set(embedded.map(tag => tag.toLowerCase()));
  const maximum = target === "instagram" ? INSTAGRAM_HASHTAG_LIMIT : VIDEO_HASHTAG_BANK_LIMIT;
  const hashtags = postingHashtags(file.quality.hashtags).filter(tag => !present.has(tag.normalize("NFKC").toLowerCase()))
    .slice(0, Math.max(0, maximum - embedded.length));
  // Preserve owner-written text and report citations. An edited caption
  // already over Instagram's limit must be corrected explicitly, not rewritten.
  return [caption, hashtags.join(" ")].filter(Boolean).join("\n\n");
}

export function postingDownload(file: ReviewFile, preferred?: ReviewTarget) {
  if (file.status !== "READY" || file.trashedAt) return null;
  const target = preferred && file.outputs[preferred] ? preferred
    : file.delivery?.platform && file.outputs[file.delivery.platform] ? file.delivery.platform
      : file.outputs.instagram ? "instagram" : file.outputs.youtube ? "youtube" : null;
  return target ? { target, url: `/api/review-files/${encodeURIComponent(file.id)}/media?target=${target}` } : null;
}
