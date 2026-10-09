import type { NaturalStock } from "./naturalStock";
import { footageMetadataMismatch } from "./footageSemantics";
import { planStockIntervals, stockPortraitScore, type StockReelOptions } from "./stockReel";

export const AUTOMATIC_STOCK_REEL_MAX_DURATION = 40;
export const AUTOMATIC_STOCK_MIN_NATIVE_EDGE = 720;
export const AUTOMATIC_STOCK_REEL_OPTIONS: StockReelOptions = {
  audio: "music", mood: "reflective", transition: "cut", framing: "auto", pacing: "cinematic", musicVersion: 2, shotCadence: "adaptive-v2", reusePolicy: "four-in-18-months-v1",
};

/** Lightweight topic cue, not a claim to have understood the video's emotion. */
export function automaticStockReelOptions(topic: string): StockReelOptions {
  const words = topic.toLowerCase();
  const mood: StockReelOptions["mood"] = /\b(?:sunrise|sunset|sunshine|sunny|bird|birds|flower|flowers|garden|gardens|family|child|children|cafe|coffee|spring)\b/.test(words) ? "warm"
    : /\b(?:city|cities|street|streets|travel|journey|adventure|hiking|running|cycling|sport|sports|waterfall|waterfalls|river|rivers|ocean|waves|surfing)\b/.test(words) ? "journey"
      : "reflective";
  return { ...AUTOMATIC_STOCK_REEL_OPTIONS, mood };
}
export const AUTOMATIC_STOCK_REEL_MIN_SOURCES = 4;
export const AUTOMATIC_STOCK_REEL_MAX_SOURCES = 10;
const MAX_COMPANION_RESOLUTIONS = 16;

// These describe presentation or a catalog request, rather than its subject.
const genericWords = new Set("a an the and or in on at of to for with from by is are as into through over under video videos clip clips footage stock pexels pixabay filmed film shot shots view views portrait landscape vertical horizontal beautiful cinematic amazing stunning scenic scenery nature natural travel session sessions suggestion suggestions aerial drone camera closeup wide angle slow motion commercial advertisement".split(" "));
const animationMetadata = /\b(?:animated|animation|cartoon|cgi|3d\s+render(?:ed|ing)?|computer\s+generated)\b/i;
const slowMotionMetadata = /\b(?:slow[\s_-]*motion|slow[\s_-]*mo|slo[\s_-]*mo)\b/i;

type CatalogContext = { name: string; cue: RegExp; search: string; natural?: boolean };
// The selected starting shot, not a broad search word, determines the reel's
// setting. Keep underwater separate from shores, and sky separate from ground
// scenery, even when both catalog entries contain "ocean", "sun" or "nature".
// Ordered, explicit catalog cues only: no frame-level or geographic claims.
const catalogContexts: CatalogContext[] = [
  { name: "underwater", cue: /\b(?:underwater|corals?|reefs?|scuba|snorkel\w*|submerged|marine life|sea life)\b/i, search: "underwater", natural: true },
  { name: "bird nest", cue: /\b(?:birds?|chicks?)\b[\s\S]*\b(?:nests?|nesting)\b|\b(?:nests?|nesting)\b[\s\S]*\b(?:birds?|chicks?)\b/i, search: "bird nest", natural: true },
  { name: "birds flying", cue: /\b(?:birds?|flocks?)\b[\s\S]*\b(?:fly\w*|soar\w*|flight)\b|\b(?:fly\w*|soar\w*)\b[\s\S]*\b(?:birds?|flocks?)\b/i, search: "birds flying", natural: true },
  { name: "bird portrait", cue: /\b(?:birds?|kingfishers?|robins?|eagles?|parrots?|sparrows?|owls?)\b/i, search: "bird", natural: true },
  { name: "train", cue: /\b(?:trains?|railways?|railroads?|locomotives?)\b/i, search: "train" },
  { name: "waterfall", cue: /\b(?:waterfalls?|cascades?)\b/i, search: "waterfall", natural: true },
  { name: "river", cue: /\b(?:rivers?|streams?|creeks?)\b/i, search: "river", natural: true },
  { name: "lake", cue: /\b(?:lakes?|ponds?|lagoons?)\b/i, search: "lake", natural: true },
  { name: "coast", cue: /\b(?:oceans?|seas?|beaches?|coasts?|coastal|seaside|shore\w*|waves?|surf\w*)\b/i, search: "ocean", natural: true },
  { name: "city", cue: /\b(?:cities|city|urban|skylines?|skyscrapers?|streets?|buildings?)\b/i, search: "city" },
  { name: "mountain", cue: /\b(?:mountains?|alpine|alps|peaks?|summits?|hills?|valleys?)\b/i, search: "mountain", natural: true },
  { name: "forest", cue: /\b(?:forests?|woodlands?|woods|jungles?|canop(?:y|ies)|trees?|palms?)\b/i, search: "forest", natural: true },
  { name: "garden", cue: /\b(?:flowers?|gardens?|petals?|blossoms?|tulips?|roses?)\b/i, search: "garden", natural: true },
  { name: "field", cue: /\b(?:meadows?|fields?|grasslands?|grass|countryside|pastures?)\b/i, search: "meadow", natural: true },
  { name: "sky", cue: /\b(?:sk(?:y|ies)|clouds?|sun|sunrise|sunset|moon|stars?)\b/i, search: "sky", natural: true },
];
const catalogContext = (description: string) => catalogContexts.find(context => context.cue.test(description));
const naturalTopic = (query: string) => subjectWords(query).length === 0 && /\b(?:nature|natural)\b/i.test(query);
const representedMedia = /\b(?:book|books|wallpapers?|screenshots?|illustrations?|paintings?|posters?|logos?|drawings?)\b/i;
const visiblePeople = /\b(?:people|person|men|man|women|woman|child|children|hikers?|hiking|walking|divers?|scuba|snorkel\w*|surfers?|surfing|paddleboard\w*|kitesurf\w*)\b/i;
const industrialTransport = /\b(?:ships?|boats?|yachts?|transporters?|freighters?|ports?|harbou?rs?|aircraft|airplanes?|planes?)\b/i;
const contextDetails = [
  { name: "snow", cue: /\b(?:snow\w*|winter|ice|icy|glaciers?)\b/i, search: "snow" },
  { name: "sunrise", cue: /\b(?:sunrise|dawn|daybreak)\b/i, search: "sunrise" },
  { name: "sunset", cue: /\b(?:sunset|dusk)\b/i, search: "sunset" },
  { name: "night", cue: /\b(?:night|nighttime|moonlit|stars?|starry)\b/i, search: "night" },
];

function contextMatch(anchorDescription: string, description: string) {
  const context = catalogContext(anchorDescription), candidateContext = catalogContext(description);
  if (context && (!candidateContext || candidateContext.name !== context.name)) return false;
  // Weather alone is not a licence to insert a different main subject. When
  // the chosen rain shot has no plant-detail evidence, skip leaves/plants and
  // garden close-ups rather than filling a fixed duration with them.
  const plantDetail = /\b(?:leaves|leaf|plants?|flowers?|petals?|blossoms?)\b/i;
  if (plantDetail.test(description) && !plantDetail.test(anchorDescription) && /\b(?:rain|raindrops?|storm|snow)\b/i.test(anchorDescription)) return false;
  const closeDetail = /\b(?:macro|close[\s_-]*up|closeup|detail)\b/i;
  if (closeDetail.test(description) && !closeDetail.test(anchorDescription) && !subjectWords(description).some(word => subjectWords(anchorDescription).includes(word) && !["rain", "water", "forest", "tree"].includes(word))) return false;
  // A title such as "cover of the book The City of the Night" is not a city
  // scene. Likewise, do not turn a peaceful landscape into a human/sport or
  // industrial montage simply because its catalog title shares the location.
  for (const cue of [representedMedia, visiblePeople, industrialTransport]) {
    if (cue.test(description) && !cue.test(anchorDescription)) return false;
  }
  // Explicit snow/day-phase metadata must agree. Unknown titles are not
  // evidence that another scene has the starting shot's defining conditions.
  const details = contextDetails.filter(detail => detail.cue.test(anchorDescription));
  if (details.some(detail => !detail.cue.test(description))) return false;
  const candidateDetails = contextDetails.filter(detail => detail.cue.test(description));
  if (candidateDetails.some(detail => details.some(other => other.name !== "snow" && detail.name !== "snow" && other.name !== detail.name))) return false;
  return true;
}

/** Reuse the existing bounded searches with a more useful query, not more calls. */
export function automaticStockCompanionQuery(anchor: NaturalStock, query: string) {
  const description = catalogDescription(anchor), context = catalogContext(description);
  const wanted = subjectWords(query);
  if (!context || (!naturalTopic(query) && wanted.length > 1)) return query;
  const detail = contextDetails.find(item => item.cue.test(description));
  const core = naturalTopic(query) ? context.search : query.trim();
  return [...new Set([core, context.search, detail?.search].filter((word): word is string => !!word))].join(" ").slice(0, 100);
}

function subjectWords(value: string) {
  return [...new Set((value.toLowerCase().match(/[\p{L}][\p{L}\p{N}]{1,}/gu) || [])
    .filter(word => !genericWords.has(word)).map(word => {
      if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + "y";
      if (word.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
      if (word.length > 4 && /ing$/.test(word)) {
        const stem = word.slice(0, -3);
        return /([b-df-hj-np-tv-z])\1$/.test(stem) ? stem.slice(0, -1) : stem;
      }
      return word.length > 3 && /s$/.test(word) && !/(?:ss|us)$/.test(word) ? word.slice(0, -1) : word;
    }))];
}

function catalogDescription(video: NaturalStock) {
  let pageWords = "";
  try { pageWords = decodeURIComponent(new URL(video.sourcePage).pathname).replace(/[-_/]/g, " "); } catch { /* Unknown catalog text is not relevance evidence. */ }
  return `${typeof video.title === "string" ? video.title : ""} ${pageWords}`.slice(0, 480);
}

function validFilmedSource(video: NaturalStock) {
  return (video.provider === "pexels" || video.provider === "pixabay")
    && Number.isSafeInteger(video.id) && video.id > 0
    && Number.isFinite(video.width) && Number.isFinite(video.height) && Math.min(video.width, video.height) >= AUTOMATIC_STOCK_MIN_NATIVE_EDGE
    && Number.isFinite(video.duration) && video.duration >= 1
    && !animationMetadata.test(catalogDescription(video))
    && !slowMotionMetadata.test(catalogDescription(video));
}

function queryMatch(video: NaturalStock, query: string, wanted: string[]) {
  const description = catalogDescription(video), words = subjectWords(description);
  if (!validFilmedSource(video) || footageMetadataMismatch(description, query)) return 0;
  if (naturalTopic(query)) return catalogContext(description)?.natural && !representedMedia.test(description) ? 1 : 0;
  if (!wanted.length) return 0;
  const matches = wanted.filter(word => words.includes(word));
  // Preserve the leading subject/place words in longer requests. A broad shared
  // word like "city" cannot turn "Sun City" into unrelated city footage.
  return wanted.slice(0, 2).every(word => words.includes(word)) && matches.length >= Math.ceil(wanted.length * .75)
    ? matches.length : 0;
}

/** Offer only starting cards that the automatic POST can accept. */
export function automaticStockChoices(videos: NaturalStock[], query: string, unavailable: ReadonlySet<string> = new Set()) {
  const wanted = subjectWords(query), seen = new Set<string>();
  return videos.filter(video => {
    const identity = `${video.provider}:${video.id}`;
    if (seen.has(identity) || unavailable.has(identity) || !queryMatch(video, query, wanted)) return false;
    seen.add(identity);
    return true;
  });
}

/** Catalog matching only. This does not inspect frames or verify a location. */
export function automaticStockCompanions(anchor: NaturalStock, candidates: NaturalStock[], query: string, recentlyUsed: ReadonlySet<string> = new Set(), unavailable: ReadonlySet<string> = new Set()) {
  const wanted = subjectWords(query), anchorDescription = catalogDescription(anchor), anchorWords = subjectWords(anchorDescription);
  if (unavailable.has(`${anchor.provider}:${anchor.id}`)) throw new Error("This starting clip has reached its four-use limit within 18 months. Choose fresh footage; Phoenix will not recycle an overused clip.");
  if (slowMotionMetadata.test(anchorDescription)) throw new Error("This starting video is labelled as slow motion. Choose another starting video for a brisk reel.");
  if (!Number.isFinite(anchor.width) || !Number.isFinite(anchor.height) || Math.min(anchor.width, anchor.height) < AUTOMATIC_STOCK_MIN_NATIVE_EDGE) throw new Error("This starting video has no native 720p rendition. Choose another starting video; automatic reels do not upscale low-resolution footage.");
  if (!queryMatch(anchor, query, wanted)) throw new Error("This starting video does not have enough catalog detail for the topic. Choose another starting video or try a broader topic.");
  const seen = new Set([`${anchor.provider}:${anchor.id}`]);
  return candidates.flatMap((video, index) => {
    const identity = `${video.provider}:${video.id}`;
    if (seen.has(identity) || unavailable.has(identity)) return [];
    seen.add(identity);
    const matches = queryMatch(video, query, wanted), description = catalogDescription(video);
    if (!matches || footageMetadataMismatch(description, anchorDescription) || !contextMatch(anchorDescription, description)) return [];
    const related = subjectWords(description).filter(word => anchorWords.includes(word));
    if (!related.length && !naturalTopic(query)) return [];
    return [{ video, index, reused: recentlyUsed.has(identity), score: matches * 10 + related.length * 2 + stockPortraitScore(video) }];
  }).sort((a, b) => Number(a.reused) - Number(b.reused) || b.score - a.score || a.index - b.index).map(result => result.video);
}

type StockReelHistoryEntry = {
  status: string; archivedAt?: string; finishedAt?: string; updatedAt?: string; createdAt?: string;
  stockSource?: { shots?: Array<{ provider: string; mediaId: string }> };
};
/** Small local diversity preference, not a promise of unseen scenes or new stock. */
export function recentStockMediaIdentities(jobs: readonly StockReelHistoryEntry[], historyLimit: 10 | 20 = 10) {
  if (historyLimit !== 10 && historyLimit !== 20) throw new Error("Choose a bounded recent reel history of 10 or 20 completed jobs.");
  const recent = jobs.filter(job => job.status === "COMPLETED" && !job.archivedAt && (job.stockSource?.shots?.length || 0) > 1)
    .map((job, index) => ({ job, index, completed: [job.finishedAt, job.updatedAt, job.createdAt].map(value => Date.parse(value || "")).find(Number.isFinite) || 0 }))
    .sort((a, b) => b.completed - a.completed || b.index - a.index).slice(0, historyLimit);
  const identities = new Set<string>();
  for (const { job } of recent) for (const shot of job.stockSource!.shots!) {
    const id = Number(shot.mediaId);
    if ((shot.provider === "pexels" || shot.provider === "pixabay") && /^\d+$/.test(shot.mediaId) && Number.isSafeInteger(id) && id > 0) identities.add(`${shot.provider}:${id}`);
  }
  return identities;
}

type CatalogAccess = {
  search: (provider: NaturalStock["provider"], query: string) => Promise<NaturalStock[]>;
  resolve: (provider: NaturalStock["provider"], id: number) => Promise<NaturalStock>;
};

/** Resolve IDs again before download; a search result never supplies trusted trims or media. */
export async function automaticStockSources(anchor: NaturalStock, query: string, providers: NaturalStock["provider"][], catalog: CatalogAccess, recentlyUsed: ReadonlySet<string> = new Set(), unavailable: ReadonlySet<string> = new Set()) {
  // Reject an unrelated selected ID before asking either catalog for companions.
  automaticStockCompanions(anchor, [], query, recentlyUsed, unavailable);
  const companionQuery = automaticStockCompanionQuery(anchor, query);
  const searches = await Promise.allSettled([...new Set(providers)].map(provider => catalog.search(provider, companionQuery)));
  const candidates = automaticStockCompanions(anchor, searches.flatMap(result => result.status === "fulfilled" ? result.value : []), query, recentlyUsed, unavailable);
  const sources = [anchor];
  for (const candidate of candidates.slice(0, MAX_COMPANION_RESOLUTIONS)) {
    if (sources.length >= AUTOMATIC_STOCK_REEL_MAX_SOURCES) break;
    try {
      const authoritative = await catalog.resolve(candidate.provider, candidate.id);
      if (authoritative.provider !== candidate.provider || authoritative.id !== candidate.id) continue;
      if (!automaticStockCompanions(anchor, [authoritative], query, recentlyUsed, unavailable).length) continue;
      sources.push(authoritative);
      // Gather enough related variety for a compact edit. This is a search
      // stopping preference, not a render target: real motion and picture
      // bounds determine the final duration after download.
      if (sources.length >= 8) {
        try {
          const preview = planStockIntervals(sources.map(video => ({ duration: video.duration, trimMode: "auto" })), AUTOMATIC_STOCK_REEL_MAX_DURATION, "cinematic", undefined, "adaptive-v2");
          if (preview.at(-1)!.outputEnd >= 20) break;
        } catch { /* Resolve more related sources when the real windows are short. */ }
      }
    } catch { /* Skip missing, animated or changed catalog entries; never add unrelated filler. */ }
  }
  if (sources.length < AUTOMATIC_STOCK_REEL_MIN_SOURCES) throw new Error("Not enough related footage at native 720p was found in the starting video's context for a coherent reel. Clips at their four-use/18-month limit are excluded. Try another starting video; Phoenix will not add unrelated filler, upscale, slow or repeat footage.");
  planStockIntervals(sources.map(video => ({ duration: video.duration, trimMode: "auto" })), AUTOMATIC_STOCK_REEL_MAX_DURATION, "cinematic", undefined, AUTOMATIC_STOCK_REEL_OPTIONS.shotCadence);
  return sources;
}

export function automaticStockReelMessage(clipCount: number, existing = false) {
  return `${existing ? "Your existing reel uses" : "Reel queued with"} ${clipCount} related videos. ${existing ? "Its saved timing and sound choices are retained." : "Phoenix chooses compact cuts, length and modest speed-ups from sampled movement, with one continuous original instrumental across all shots."}`;
}
