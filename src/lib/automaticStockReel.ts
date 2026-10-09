import type { NaturalStock } from "./naturalStock";
import { footageMetadataMismatch } from "./footageSemantics";
import { planStockIntervals, stockPortraitScore, type StockReelOptions } from "./stockReel";

export const AUTOMATIC_STOCK_REEL_MAX_DURATION = 40;
export const AUTOMATIC_STOCK_MIN_NATIVE_EDGE = 720;
export const AUTOMATIC_STOCK_REEL_OPTIONS: StockReelOptions = {
  audio: "music", mood: "reflective", transition: "cut", framing: "auto", pacing: "cinematic", musicVersion: 2, shotCadence: "adaptive-v2", continuity: "visual-v1", reusePolicy: "four-in-18-months-v1",
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
  { name: "park", cue: /\bparks?\b/i, search: "park", natural: true },
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
const parkingScene = /\b(?:parking|car parks?)\b/i;
const amusementScene = /\b(?:amusement|theme)\s+parks?\b|\bfairgrounds?\b|\bferris\s+wheels?\b/i;
const rainBuiltScene = /\b(?:billboards?|buildings?|skyscrapers?|parking|car parks?|cars?|vehicles?)\b/i;
const builtVegetationSetting = /\b(?:skylines?|skyscrapers?|buildings?|roads?|roadside|streets?|traffic|highways?|motorways?|cars?|vehicles?|parking)\b/i;
const greenVegetationCue = /\b(?:green|lush|verdant|foliage|flowering|blossoming|blossoms?|flowers?)\b/i;
const explicitGreenColourCue = /\b(?:green|lush|verdant|foliage)\b/i;
const naturalHabitatCue = /\b(?:forests?|woodlands?|woods|jungles?|gardens?|flowers?|petals?|blossoms?|tulips?|roses?)\b/i;
const animalFamilies: Array<{ name: string; cue: RegExp }> = [
  { name: "horse", cue: /\b(?:horses?|ponies|foals?|equine|equestrian)\b/i },
  { name: "dog", cue: /\b(?:dogs?|puppies|canine)\b/i },
  { name: "cat", cue: /\b(?:cats?|kittens?|feline)\b/i },
  { name: "bird", cue: /\b(?:birds?|eagles?|owls?|parrots?|sparrows?|robins?|kingfishers?|flocks?)\b/i },
  { name: "deer", cue: /\b(?:deer|elk|moose|reindeer)\b/i },
  { name: "cattle", cue: /\b(?:cows?|cattle|bulls?|calves?)\b/i },
  { name: "sheep", cue: /\b(?:sheep|lambs?)\b/i },
  { name: "goat", cue: /\bgoats?\b/i },
  { name: "elephant", cue: /\belephants?\b/i },
  { name: "giraffe", cue: /\bgiraffes?\b/i },
  { name: "lion", cue: /\blions?\b/i },
  { name: "tiger", cue: /\btigers?\b/i },
  { name: "bear", cue: /\bbears?\b/i },
  { name: "fox", cue: /\bfox(?:es)?\b/i },
  { name: "rabbit", cue: /\b(?:rabbits?|hares?)\b/i },
  { name: "squirrel", cue: /\bsquirrels?\b/i },
  { name: "monkey", cue: /\b(?:monkeys?|apes?|primates?)\b/i },
  { name: "dolphin", cue: /\bdolphins?\b/i },
  { name: "whale", cue: /\bwhales?\b/i },
  { name: "seal", cue: /\b(?:seals?|sea lions?)\b/i },
  { name: "fish", cue: /\b(?:fish|fishes)\b/i },
];
// Keep named subjects/actions from the chosen shot, not merely its background.
// Generic people/walking are deliberately not a lock: a park reel can still
// vary its visitors. These are explicit catalogue cues, not visual recognition.
const outdoorActivities: Array<{ name: string; cue: RegExp }> = [
  { name: "hiking", cue: /\b(?:hikers?|hiking|trekking)\b/i },
  { name: "climbing", cue: /\b(?:climbers?|climbing)\b/i },
  { name: "cycling", cue: /\b(?:cyclists?|cycling|biking|bicycles?)\b/i },
  { name: "skating", cue: /\b(?:skaters?|skating|skateboards?|skateboarding|rollerblading)\b/i },
  { name: "skiing", cue: /\b(?:skiers?|skiing|skis)\b/i },
];
const contextDetails = [
  { name: "snow", cue: /\b(?:snow\w*|winter|ice|icy|glaciers?)\b/i, search: "snow" },
  { name: "sunrise", cue: /\b(?:sunrise|dawn|daybreak)\b/i, search: "sunrise" },
  { name: "sunset", cue: /\b(?:sunset|dusk)\b/i, search: "sunset" },
  { name: "night", cue: /\b(?:night|nighttime|midnight|moonlit|stars?|starry)\b|\bafter\s+dark\b/i, search: "night" },
];
const dayPhases: Array<{ name: string; cue: RegExp }> = [
  { name: "dawn", cue: /\b(?:sunrise|dawn|daybreak)\b/i },
  { name: "day", cue: /\b(?:day|daytime|daylight|noon|midday)\b/i },
  { name: "dusk", cue: /\b(?:sunset|dusk|twilight|evening)\b/i },
  { name: "night", cue: /\b(?:night|nighttime|midnight|moonlit|stars?|starry)\b|\bafter\s+dark\b/i },
];
const explicitDayPhase = (description: string) => dayPhases.find(phase => phase.cue.test(description))?.name;
const explicitAnimalFamilies = (description: string) => animalFamilies.filter(family => family.cue.test(description)).map(family => family.name);
const explicitOutdoorActivities = (description: string) => outdoorActivities.filter(activity => activity.cue.test(description)).map(activity => activity.name);
function dayPhaseCompatible(anchorPhase: string | undefined, candidatePhase: string | undefined, preferredPhase?: string) {
  if (anchorPhase) {
    // Sunrise, sunset and night clips require matching catalog evidence; daytime
    // anchors may pair with unlabeled clips because daylight is often omitted.
    if (["dawn", "dusk", "night"].includes(anchorPhase)) return candidatePhase === anchorPhase;
    return !candidatePhase || candidatePhase === anchorPhase;
  }
  return !candidatePhase || !preferredPhase || candidatePhase === preferredPhase;
}

function contextMatch(anchorDescription: string, description: string) {
  const context = catalogContext(anchorDescription), candidateContext = catalogContext(description);
  if (context && (!candidateContext || candidateContext.name !== context.name)) return false;
  // "Park" or "trees" in a title must not turn an explicitly lush/natural
  // scene into a skyline/road/traffic edit. Urban vegetation remains an option
  // when the selected anchor explicitly establishes that built setting.
  const naturalVegetationAnchor = ["park", "forest", "garden"].includes(context?.name || "")
    && (greenVegetationCue.test(anchorDescription) || naturalHabitatCue.test(anchorDescription))
    && !builtVegetationSetting.test(anchorDescription);
  if (naturalVegetationAnchor && builtVegetationSetting.test(description)) return false;
  // A generic urban park/plaza title is not evidence of the chosen lush scene.
  // Explicitly green city parks remain eligible, avoiding a blanket city ban.
  if (naturalVegetationAnchor && /\b(?:city|cities|urban|cityscape|plazas?|squares?)\b/i.test(description)
    && !greenVegetationCue.test(description)) return false;
  const anchorParking = parkingScene.test(anchorDescription), candidateParking = parkingScene.test(description);
  if (candidateParking !== anchorParking) return false;
  const anchorAmusement = amusementScene.test(anchorDescription), candidateAmusement = amusementScene.test(description);
  if (candidateAmusement !== anchorAmusement) return false;
  const anchorAnimals = explicitAnimalFamilies(anchorDescription), candidateAnimals = explicitAnimalFamilies(description);
  if (candidateAnimals.some(animal => !anchorAnimals.includes(animal))
    || anchorAnimals.some(animal => !candidateAnimals.includes(animal))) return false;
  const anchorActivities = explicitOutdoorActivities(anchorDescription), candidateActivities = explicitOutdoorActivities(description);
  if (anchorActivities.some(activity => !candidateActivities.includes(activity))) return false;
  // For a rain-only anchor, a named built scene is a new subject, not a
  // harmless shared-weather match. Retain such footage only when the anchor
  // itself establishes that setting; keep natural rain/water scenes eligible.
  if (/\b(?:rain|raindrops?|storm)\b/i.test(anchorDescription)
    && rainBuiltScene.test(description) && !rainBuiltScene.test(anchorDescription)) return false;
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
  // Preserve explicit defining dawn/dusk/night context rather than treating
  // an unlabeled scene as proof of the selected lighting condition.
  if (contextDetails.slice(1).some(detail => detail.cue.test(anchorDescription) && !detail.cue.test(description))) return false;
  // Explicit snow context must agree; absent catalog detail remains unknown.
  const snow = contextDetails[0].cue;
  if (snow.test(anchorDescription) !== snow.test(description)) return false;
  return true;
}

/** Explicit catalogue greenery intent only, not a claim to recognize a scene. */
export function automaticStockGreeneryFocus(anchor: NaturalStock): boolean {
  const description = catalogDescription(anchor), context = catalogContext(description);
  return ["park", "forest", "garden", "field"].includes(context?.name || "")
    && explicitGreenColourCue.test(description) && !builtVegetationSetting.test(description);
}

/** Reuse the existing bounded searches with a more useful query, not more calls. */
export function automaticStockCompanionQuery(anchor: NaturalStock, query: string) {
  const description = catalogDescription(anchor), context = catalogContext(description);
  const wanted = subjectWords(query);
  const enrichSetting = !!context && (naturalTopic(query) || wanted.length <= 1);
  const detail = enrichSetting ? contextDetails.find(item => item.cue.test(description)) : undefined;
  const core = naturalTopic(query) && context ? context.search : query.trim();
  const setting = enrichSetting ? context?.search : undefined;
  const greenery = enrichSetting && ["park", "forest", "garden"].includes(context?.name || "") && explicitGreenColourCue.test(description) ? "green" : undefined;
  const established = subjectWords([core, setting, greenery, detail?.search].filter(Boolean).join(" "));
  const subjects = [...explicitAnimalFamilies(description), ...explicitOutdoorActivities(description)]
    .filter(subject => !subjectWords(subject).every(word => established.includes(word)));
  const seen = new Set<string>();
  return [core, setting, greenery, ...subjects, detail?.search].filter((part): part is string => !!part).filter((part, index) => {
    const words = subjectWords(part);
    if (index > 0 && words.length && words.every(word => seen.has(word))) return false;
    for (const word of words) seen.add(word);
    return true;
  }).join(" ").slice(0, 100);
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
  // A bird's-eye camera view is not evidence of a bird in the scene. Normalize
  // both the display title and provider slug before subject/context checks.
  return `${typeof video.title === "string" ? video.title : ""} ${pageWords}`.slice(0, 480)
    .replace(/\bbirds?(?:['’]s|[\s_-]+s|['’])?[\s_-]*eye[\s_-]+view\b|\bbird(?:['’]s|[\s_-]+s)[\s_-]*eye\b/gi, "aerial view");
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
  // Inflection normalization must not turn 'parking' into the subject 'park',
  // including starting cards, before an owner can accidentally choose one.
  if (/\bparks?\b/i.test(query) && !parkingScene.test(query) && parkingScene.test(description)) return 0;
  if (parkingScene.test(query) && !parkingScene.test(description)) return 0;
  if (/\bparks?\b/i.test(query) && !amusementScene.test(query) && amusementScene.test(description)) return 0;
  if (amusementScene.test(query) && !amusementScene.test(description)) return 0;
  if (naturalTopic(query)) return catalogContext(description)?.natural && !representedMedia.test(description)
    && !parkingScene.test(description) && !amusementScene.test(description) ? 1 : 0;
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
  const eligible = candidates.flatMap((video, index) => {
    const identity = `${video.provider}:${video.id}`;
    if (seen.has(identity) || unavailable.has(identity)) return [];
    seen.add(identity);
    const matches = queryMatch(video, query, wanted), description = catalogDescription(video);
    if (!matches || footageMetadataMismatch(description, anchorDescription) || !contextMatch(anchorDescription, description)) return [];
    const related = subjectWords(description).filter(word => anchorWords.includes(word));
    if (!related.length && !naturalTopic(query)) return [];
    const aspect = video.width / video.height, target = 720 / 1280;
    const retained = Math.min(aspect / target, target / aspect);
    return [{ video, index, reused: recentlyUsed.has(identity), fullFramePortrait: retained >= .92, phase: explicitDayPhase(description), score: matches * 10 + related.length * 2 + stockPortraitScore(video) }];
  });
  // If the owner-selected anchor has no labeled phase, keep explicitly phased
  // companions consistent with the most common phase in this eligible set.
  // Unlabeled sources remain unknown rather than being assigned a time of day.
  const anchorPhase = explicitDayPhase(anchorDescription);
  const phaseCounts = new Map<string, number>();
  for (const item of eligible) if (item.phase) phaseCounts.set(item.phase, (phaseCounts.get(item.phase) || 0) + 1);
  const companionPhase = [...phaseCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return eligible.filter(item => dayPhaseCompatible(anchorPhase, item.phase, companionPhase))
    .sort((a, b) => Number(b.fullFramePortrait) - Number(a.fullFramePortrait)
      || Number(a.reused) - Number(b.reused) || b.score - a.score || a.index - b.index).map(result => result.video);
}

type StockReelHistoryEntry = {
  status: string; archivedAt?: string; finishedAt?: string; updatedAt?: string; createdAt?: string;
  stockSource?: { shots?: Array<{ provider: string; mediaId: string }>; renderedShots?: Array<{ provider: string; mediaId: string }> };
};
/** Small local diversity preference, not a promise of unseen scenes or new stock. */
export function recentStockMediaIdentities(jobs: readonly StockReelHistoryEntry[], historyLimit: 10 | 20 = 10) {
  if (historyLimit !== 10 && historyLimit !== 20) throw new Error("Choose a bounded recent reel history of 10 or 20 completed jobs.");
  const recent = jobs.filter(job => job.status === "COMPLETED" && !job.archivedAt && (job.stockSource?.shots?.length || 0) > 1)
    .map((job, index) => ({ job, index, completed: [job.finishedAt, job.updatedAt, job.createdAt].map(value => Date.parse(value || "")).find(Number.isFinite) || 0 }))
    .sort((a, b) => b.completed - a.completed || b.index - a.index).slice(0, historyLimit);
  const identities = new Set<string>();
  for (const { job } of recent) for (const shot of job.stockSource!.renderedShots ?? job.stockSource!.shots!) {
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
  const anchorPhase = explicitDayPhase(catalogDescription(anchor));
  const preferredPhase = anchorPhase || candidates.map(candidate => explicitDayPhase(catalogDescription(candidate))).find(Boolean);
  const sources = [anchor];
  for (const candidate of candidates.slice(0, MAX_COMPANION_RESOLUTIONS)) {
    if (sources.length >= AUTOMATIC_STOCK_REEL_MAX_SOURCES) break;
    try {
      const authoritative = await catalog.resolve(candidate.provider, candidate.id);
      if (authoritative.provider !== candidate.provider || authoritative.id !== candidate.id) continue;
      const candidatePhase = explicitDayPhase(catalogDescription(candidate)), resolvedPhase = explicitDayPhase(catalogDescription(authoritative));
      if (candidatePhase && resolvedPhase && candidatePhase !== resolvedPhase) continue;
      if (!dayPhaseCompatible(anchorPhase, explicitDayPhase(catalogDescription(authoritative)), preferredPhase)) continue;
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
