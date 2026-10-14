import type { NaturalStock } from "./naturalStock";
import type { StockLicence } from "./stockProviders";

type OpenProvider = "commons" | "nasa";
type JsonObject = Record<string, unknown>;
const USER_AGENT = "PhoenixStudio/0.1 (https://github.com/rushig0203-cyber/Phoenix-Studio)";
const MAX_JSON_BYTES = 1024 * 1024;
const NASA_PAGE_SIZE = 6;
const NASA_GUIDELINES = "https://www.nasa.gov/nasa-brand-center/images-and-media/";
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function text(value: unknown, limit = 240) {
  return (typeof value === "string" ? value : "").replace(/<[^>]*>/g, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
    const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  }).replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g, entity => ({ "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" })[entity] || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function assetUrl(value: unknown, hosts: string[], prefix: string, upgradeNasa = false) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Open footage returned an invalid media address.");
  const url = new URL(value);
  // NASA's documented manifest still emits HTTP links for its HTTPS-capable asset host.
  if (upgradeNasa && url.protocol === "http:" && url.hostname === "images-assets.nasa.gov") url.protocol = "https:";
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.port || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)) throw new Error("Open footage returned an untrusted media address.");
  return url.toString();
}

async function json(url: string, signal: AbortSignal, provider: OpenProvider) {
  let response: Response;
  try { response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) }); }
  catch { throw new Error(`${provider === "commons" ? "Wikimedia Commons" : "NASA"} footage metadata could not be reached. Retry later; no paid fallback was used.`); }
  if (!response.ok) throw new Error(`${provider === "commons" ? "Wikimedia Commons" : "NASA"} footage search failed (${response.status}). Wait and retry; no paid service is used.`);
  if (!response.body || Number(response.headers.get("content-length")) > MAX_JSON_BYTES) { await response.body?.cancel(); throw new Error("Open footage metadata exceeded the safe response limit."); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new Error("Open footage metadata exceeded the safe response limit."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Open footage provider returned invalid metadata."); }
  const data = object(parsed);
  if (data.error) throw new Error("Open footage provider could not complete this metadata request.");
  return data;
}

function positive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function commonsChoice(value: unknown): NaturalStock {
  const page = object(value), info = object(array(page.videoinfo)[0]), metadata = object(info.extmetadata);
  const field = (key: string, limit?: number) => text(object(metadata[key]).value, limit);
  const id = page.pageid, title = field("ObjectName") || text(page.title).replace(/^File:/, "").replace(/\.(webm|ogv|mp4|mov)$/i, "");
  const width = positive(info.width), height = positive(info.height), duration = positive(info.duration);
  if (!Number.isSafeInteger(id) || Number(id) <= 0 || page.ns !== 6 || !width || !height || !duration || !["video/webm", "video/ogg", "video/mp4", "video/quicktime"].includes(String(info.mime))) throw new Error("Commons file has no verified video dimensions or duration.");
  if (/\b(animation|animated|computer.generated|visualization)\b/i.test(`${title} ${field("Categories", 3000)}`) || field("Restrictions", 2000)) throw new Error("Commons footage has animation or additional reuse restrictions.");
  const sourcePage = assetUrl(info.descriptionurl, ["commons.wikimedia.org"], "/wiki/File:");
  const creator = field("Artist", 160), name = field("LicenseShortName"), licenceKey = field("License").toLowerCase();
  let licence: StockLicence;
  if (field("AttributionRequired").toLowerCase() === "true") throw new Error("Commons attribution-required footage is not enabled for automatic reels.");
  if (licenceKey === "cc-zero" && /^CC0(?: 1\.0)?$/i.test(name)) {
    const url = assetUrl(field("LicenseUrl"), ["creativecommons.org"], "/publicdomain/zero/1.0");
    if (!/^https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/.test(url)) throw new Error("Commons CC0 licence is not explicit.");
    licence = { name: "CC0 1.0", url, attribution: `${creator || "Wikimedia Commons"} · ${sourcePage}`, requiresAttribution: false, verifiedBy: "provider-metadata" };
  } else if (/^(pd|public-domain)$/.test(licenceKey) && /^public domain$/i.test(name) && field("Copyrighted").toLowerCase() === "false") {
    licence = { name: "Public domain", url: "https://commons.wikimedia.org/wiki/Commons:Licensing#Material_in_the_public_domain", attribution: `${creator || "Wikimedia Commons"} · ${sourcePage}`, requiresAttribution: false, verifiedBy: "provider-metadata" };
  } else throw new Error("Commons footage needs a clear CC0/public-domain licence. Attribution-required files are not enabled for automatic reels.");
  const previewUrl = assetUrl(info.url, ["upload.wikimedia.org"], "/wikipedia/commons/");
  if (!/\.(?:webm|ogv|mp4|mov)$/i.test(new URL(previewUrl).pathname)) throw new Error("Commons returned a non-video download.");
  return { id: Number(id), provider: "commons", title: title.slice(0, 160), width, height, duration, previewUrl, image: info.thumburl ? assetUrl(info.thumburl, ["upload.wikimedia.org", "thumb.wikimedia.org"], "/wikipedia/commons/") : "", sourcePage, creator: creator || "Wikimedia Commons", licence };
}

function nasaId(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 240 || /[\u0000-\u001f\u007f/\\?#]/.test(value)) throw new Error("NASA returned an invalid video ID.");
  return value;
}

function nasaDuration(value: unknown) {
  if (positive(value)) return Number(value);
  if (typeof value !== "string") return 0;
  const clock = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(value);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const seconds = /^(\d+(?:\.\d+)?) s$/.exec(value);
  return seconds ? Number(seconds[1]) : 0;
}

function nasaChoice(item: JsonObject, manifest: JsonObject, metadata: JsonObject): NaturalStock {
  const data = object(array(item.data)[0]), id = nasaId(data.nasa_id), center = text(data.center);
  if (data.media_type !== "video" || metadata["AVAIL:MediaType"] !== "video" || metadata["AVAIL:NASAID"] !== id || text(metadata["AVAIL:Center"]) !== center || !["ARC", "AFRC", "GRC", "GSFC", "HQ", "JSC", "KSC", "LaRC", "LARC", "MSFC", "SSC"].includes(center)) throw new Error("NASA footage has no matching NASA-origin provenance.");
  const title = text(data.title), description = `${text(data.description, 12000)} ${text(metadata["AVAIL:Description"], 12000)}`;
  if ([data.description, metadata["AVAIL:Description"]].some(value => typeof value === "string" && value.length > 12000)) throw new Error("NASA footage has too much unchecked rights context.");
  if (/\b(music|soundtrack|song|copyrighted|all rights reserved|courtesy|animation|animated|visualization|computer.generated)\b/i.test(`${title} ${description}`)) throw new Error("NASA footage includes uncertain music, external rights or generated visuals.");
  const creditRaw = [data.photographer, metadata["AVAIL:Photographer"], metadata["XMP:Credit"], metadata["XMP:Creator"], metadata["AVAIL:Creator"]].flatMap(value => Array.isArray(value) ? value : [value]);
  if (creditRaw.some(value => value != null && typeof value !== "string")) throw new Error("NASA footage creator metadata is not explicit.");
  const creditValues = creditRaw.map(value => text(value)).filter(Boolean);
  const safeCredit = (credit: string) => /^NASA(?:\/(?:ARC|AFRC|GRC|GSFC|HQ|JSC|KSC|LaRC|LARC|MSFC|SSC))?$/i.test(credit);
  const rightsValues = Object.entries(metadata).filter(([key]) => /(?:Copyright|UsageTerms|Rights|License)$/i.test(key)).flatMap(([, value]) => Array.isArray(value) ? value : [value]);
  if (rightsValues.some(value => value != null && (typeof value !== "string" || value.length > 2000))) throw new Error("NASA footage rights metadata is not explicit.");
  const rights = rightsValues.map(value => text(value, 2000)).filter(Boolean);
  const guidelineNotice = /^(?:For copyright and restrictions refer to\s*)?https?:\/\/www\.nasa\.gov\/(?:multimedia\/guidelines\/index\.html|nasa-brand-center\/images-and-media\/?)(?:\s*)$/i;
  if ((!creditValues.length && !rights.some(value => guidelineNotice.test(value))) || creditValues.some(value => !safeCredit(value)) || rights.some(value => !guidelineNotice.test(value))) throw new Error("NASA footage has no clear NASA-only creator/rights evidence.");
  const descriptionCredits = [...description.matchAll(/\bcredits?\s*:\s*([^\n.]+)/gi)].map(match => match[1].trim());
  if (descriptionCredits.some(credit => !safeCredit(credit))) throw new Error("NASA footage contains third-party credits.");
  const duration = nasaDuration(metadata["QuickTime:Duration"]), width = positive(metadata["QuickTime:ImageWidth"]), height = positive(metadata["QuickTime:ImageHeight"]);
  if (!duration || !width || !height || !["video/mp4", "video/x-m4v", "video/quicktime"].includes(String(metadata["File:MIMEType"]))) throw new Error("NASA video has no verified original dimensions or duration.");
  const original = array(object(manifest.collection).items).map(value => object(value).href).find(value => {
    if (typeof value !== "string") return false;
    try { const url = new URL(assetUrl(value, ["images-assets.nasa.gov"], "/video/", true)); return decodeURIComponent(url.pathname) === `/video/${id}/${id}~orig.${metadata["File:MIMEType"] === "video/quicktime" ? "mov" : "mp4"}`; } catch { return false; }
  });
  if (!original) throw new Error("NASA original video is unavailable; resized-file dimensions were not guessed.");
  const sourcePage = `https://images.nasa.gov/details/${encodeURIComponent(id)}`;
  const thumbnail = array(item.links).map(object).find(link => link.render === "image" && link.rel === "preview");
  const creator = creditValues[0] || `NASA/${center}`;
  return { id, provider: "nasa", title, duration, width, height, previewUrl: assetUrl(original, ["images-assets.nasa.gov"], "/video/", true), image: thumbnail ? assetUrl(thumbnail.href, ["images-assets.nasa.gov"], "/video/", true) : "", sourcePage, creator,
    licence: { name: "NASA media-use guidelines (NASA-origin footage)", url: NASA_GUIDELINES, attribution: `${creator} · ${sourcePage}; edited for this reel. No NASA endorsement.`, requiresAttribution: true, verifiedBy: "provider-metadata" } };
}

async function resolveNasaItem(item: JsonObject, signal: AbortSignal) {
  const id = nasaId(object(array(item.data)[0]).nasa_id), manifest = await json(`https://images-api.nasa.gov/asset/${encodeURIComponent(id)}`, signal, "nasa");
  const metadataEntry = array(object(manifest.collection).items).map(value => object(value).href).find(value => {
    try { return decodeURIComponent(new URL(assetUrl(value, ["images-assets.nasa.gov"], "/video/", true)).pathname) === `/video/${id}/metadata.json`; } catch { return false; }
  });
  if (!metadataEntry) throw new Error("NASA video has no original metadata manifest.");
  const metadata = await json(assetUrl(metadataEntry, ["images-assets.nasa.gov"], "/video/", true), signal, "nasa");
  return nasaChoice(item, manifest, metadata);
}

export async function searchOpenStockPage(provider: OpenProvider, query: string, page: number, pageSize: number): Promise<{ videos: NaturalStock[]; hasMore: boolean }> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 3 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 24 || typeof query !== "string" || !query.trim() || query.length > 120) throw new Error("Open footage search is outside the safe page/query limits.");
  const signal = AbortSignal.timeout(45_000), videos: NaturalStock[] = [];
  if (provider === "commons") {
    const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: `${query.trim()} filetype:video`, gsrnamespace: "6", gsrlimit: String(pageSize), gsroffset: String((page - 1) * pageSize), prop: "videoinfo", viprop: "url|size|mime|extmetadata", viurlwidth: "400", format: "json" });
    const data = await json(`https://commons.wikimedia.org/w/api.php?${params}`, signal, provider);
    for (const candidate of Object.values(object(object(data.query).pages)).sort((a, b) => Number(object(a).index) - Number(object(b).index)).slice(0, pageSize)) {
      try { videos.push(commonsChoice(candidate)); } catch { /* Unsupported rights or incomplete video metadata are not offered. */ }
    }
    return { videos, hasMore: Number.isFinite(object(data.continue).gsroffset) };
  }
  if (provider !== "nasa") throw new Error("Unknown open footage provider.");
  const size = Math.min(pageSize, NASA_PAGE_SIZE), params = new URLSearchParams({ q: query.trim(), media_type: "video", page: String(page), page_size: String(size) });
  const data = await json(`https://images-api.nasa.gov/search?${params}`, signal, provider), collection = object(data.collection);
  if (!Array.isArray(collection.items)) throw new Error("NASA returned invalid search metadata.");
  let unavailable: Error | undefined;
  // NASA has no original video dimensions in search results. Resolve only six candidates serially; never launch FFprobe/model work while browsing.
  for (const candidate of array(collection.items).slice(0, size)) {
    try { videos.push(await resolveNasaItem(object(candidate), signal)); }
    catch (error) {
      if (error instanceof Error && /could not be reached|search failed|safe response limit|invalid metadata/.test(error.message)) unavailable = error;
      if (signal.aborted) break;
    }
  }
  if (!videos.length && unavailable) throw unavailable;
  const total = object(collection.metadata).total_hits;
  return { videos, hasMore: typeof total === "number" && Number.isFinite(total) ? page * size < total : array(collection.links).some(link => object(link).rel === "next") };
}

export async function resolveOpenStock(provider: OpenProvider, id: number | string): Promise<NaturalStock> {
  const signal = AbortSignal.timeout(45_000);
  if (provider === "commons") {
    if (!Number.isSafeInteger(id) || Number(id) <= 0) throw new Error("Choose a valid Commons video ID.");
    const params = new URLSearchParams({ action: "query", pageids: String(id), prop: "videoinfo", viprop: "url|size|mime|extmetadata", viurlwidth: "400", format: "json" });
    const data = await json(`https://commons.wikimedia.org/w/api.php?${params}`, signal, provider), pages = object(object(data.query).pages);
    const result = commonsChoice(pages[String(id)]);
    if (result.id !== id) throw new Error("The requested Commons video is no longer available.");
    return result;
  }
  if (provider !== "nasa") throw new Error("Unknown open footage provider.");
  const wanted = nasaId(id), params = new URLSearchParams({ nasa_id: wanted, media_type: "video", page_size: "1" });
  const data = await json(`https://images-api.nasa.gov/search?${params}`, signal, provider);
  const item = array(object(data.collection).items).find(value => object(array(object(value).data)[0]).nasa_id === wanted);
  if (!item) throw new Error("The requested NASA video is no longer available.");
  return resolveNasaItem(object(item), signal);
}
