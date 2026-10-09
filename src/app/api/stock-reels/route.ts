import { z } from "zod";
import { assertLocalRequest } from "@/lib/localRequest";
import { configuredStock, MAX_STOCK_DISCOVERY_PAGES, portraitFirstStock, resolveNaturalStock, searchNaturalStock, searchNaturalStockPage, trustedStockUrl, type NaturalStock } from "@/lib/naturalStock";
import { createSourceJob, createStockReelJob, findStockSourceJob, ffmpegAvailable, readSourceJobs, readStockReuseBlocked, type SourceJob, type StockReelDownload } from "@/lib/sourceProcessing";
import { JobHistoryConflictError } from "@/lib/jobHistory";
import { MAX_STOCK_REEL_BYTES, MAX_STOCK_SHOTS, planStockIntervals } from "@/lib/stockReel";
import { AUTOMATIC_STOCK_REEL_MAX_DURATION, automaticStockReelOptions, automaticStockChoices, automaticStockReelMessage, automaticStockSources, recentStockMediaIdentities } from "@/lib/automaticStockReel";
import { getStockProductionGuidance } from "@/lib/stockProductionGuidance";

const providerSchema = z.enum(["pexels", "pixabay"]);
const optionsSchema = z.object({ audio: z.enum(["auto", "original", "music", "ambience-music"]).default("auto"), mood: z.enum(["reflective", "warm", "journey"]).default("reflective"), transition: z.enum(["cut", "soft"]).default("cut"), framing: z.enum(["auto", "fit"]).default("auto"), pacing: z.enum(["cinematic", "selected"]).optional() });
const automaticSubmissions = new Map<string, Promise<{ job: SourceJob; existing: boolean }>>();
const processingUnavailable = "FFmpeg and FFprobe are required before downloading or processing footage.";
class StockProcessingUnavailableError extends Error {}

async function openStockVideo(url: string) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("video/")) { await response.body?.cancel(); throw new Error("The provider did not return a playable video stream."); }
  const expectedBytes = Number(response.headers.get("content-length")) || undefined;
  if (expectedBytes && expectedBytes > MAX_STOCK_REEL_BYTES) { await response.body.cancel(); throw new Error("This rendition exceeds the 500 MB laptop-safe stock limit. Choose another clip."); }
  return { stream: response.body, expectedBytes };
}

async function queueAutomaticStockReel(input: { provider: "pexels" | "pixabay"; id: number; query: string; requestId: string }) {
  if (!(await ffmpegAvailable())) throw new StockProcessingUnavailableError(processingUnavailable);
  // Read only bounded local structured choices. A corrupt store is actionable,
  // not a reason to pretend the manager learned or silently discard preferences.
  const managerGuidance = await getStockProductionGuidance();
  const unavailable = await readStockReuseBlocked();
  const { query, provider } = input, anchor = await resolveNaturalStock(provider, input.id);
  if (anchor.provider !== provider || anchor.id !== input.id) throw new Error("This starting video is no longer available.");
  const configured = configuredStock();
  const providers = (["pexels", "pixabay"] as const).filter(name => configured[name]);
  const recentlyUsed = recentStockMediaIdentities(await readSourceJobs(), managerGuidance.historyLimit);
  const sources = await automaticStockSources(anchor, query, providers, { search: searchNaturalStock, resolve: resolveNaturalStock }, recentlyUsed, unavailable);
  const downloads: StockReelDownload[] = sources.map(video => {
    const url = trustedStockUrl(video.previewUrl, video.provider);
    return { provider: video.provider, mediaId: String(video.id), sourcePage: video.sourcePage, creator: video.creator, title: video.title, start: 0, end: video.duration, trimMode: "auto", open: () => openStockVideo(url) };
  });
  const options = automaticStockReelOptions(query);
  planStockIntervals(sources.map(video => ({ duration: video.duration, start: 0, end: video.duration, trimMode: "auto" as const })), AUTOMATIC_STOCK_REEL_MAX_DURATION, options.pacing, options.minDuration, options.shotCadence);
  return createStockReelJob(downloads, { requestId: input.requestId, caption: "", theme: query, maxDuration: AUTOMATIC_STOCK_REEL_MAX_DURATION, options,
    managerGuidance: { revision: managerGuidance.revision, feedbackCount: managerGuidance.feedbackCount, rules: managerGuidance.rules } });
}

function automaticStockResponse(job: SourceJob, existing = false) {
  const clipCount = job.stockSource?.shots?.length || 1;
  return Response.json({ job, ...(existing ? { existing: true } : {}), clipCount, message: automaticStockReelMessage(clipCount, existing) }, { status: existing ? 200 : 201 });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const params = new URL(request.url).searchParams;
    const query = z.string().trim().min(2).max(100).parse(params.get("q"));
    const provider = z.enum(["all", "pexels", "pixabay"]).parse(params.get("provider") || "all");
    const configured = configuredStock();
    const providers = (["pexels", "pixabay"] as const).filter(name => (provider === "all" || name === provider) && configured[name]);
    if (params.get("browse") === "true") {
      const cursorSchema = z.object({ pexels: z.number().int().min(1).max(MAX_STOCK_DISCOVERY_PAGES).nullable(), pixabay: z.number().int().min(1).max(MAX_STOCK_DISCOVERY_PAGES).nullable(), limited: z.boolean().default(false) }).strict();
      const rawCursor = params.get("cursor");
      if (rawCursor && rawCursor.length > 160) throw new Error("Invalid footage browsing cursor.");
      const cursor = rawCursor ? cursorSchema.parse(JSON.parse(rawCursor)) : { pexels: 1, pixabay: 1, limited: false };
      const unavailable = params.get("automatic") === "true" ? await readStockReuseBlocked() : new Set<string>();
      const videos: NaturalStock[] = [], errors: string[] = [];
      // One page per available provider, sequentially. Only an explicit More videos
      // action reaches the next page; failures keep their own page for safe retry.
      for (const name of ["pexels", "pixabay"] as const) {
        if (!providers.includes(name)) { cursor[name] = null; continue; }
        const page = cursor[name];
        if (page === null) continue;
        try {
          const found = await searchNaturalStockPage(name, query, page);
          videos.push(...found.videos);
          if (found.hasMore && page >= MAX_STOCK_DISCOVERY_PAGES) cursor.limited = true;
          cursor[name] = found.hasMore && page < MAX_STOCK_DISCOVERY_PAGES ? page + 1 : null;
        } catch (error) { errors.push(error instanceof Error ? error.message : `${name} search failed.`); }
      }
      const ordered = portraitFirstStock(videos, query);
      return Response.json({ configured, videos: params.get("automatic") === "true" ? automaticStockChoices(ordered, query, unavailable) : ordered, errors, query,
        pagination: { cursor: cursor.pexels !== null || cursor.pixabay !== null ? JSON.stringify(cursor) : null, limited: cursor.limited, partial: errors.length > 0 } });
    }
    const unavailable = params.get("automatic") === "true" ? await readStockReuseBlocked() : new Set<string>();
    const results = await Promise.allSettled(providers.map(name => searchNaturalStock(name, query)));
    const videos = portraitFirstStock(results.flatMap(result => result.status === "fulfilled" ? result.value : []), query);
    return Response.json({ configured, videos: params.get("automatic") === "true" ? automaticStockChoices(videos, query, unavailable) : videos, errors: results.flatMap(result => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "Stock search failed."] : []), query });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Search failed." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const input = z.object({
      automatic: z.boolean().default(false), query: z.string().trim().min(2).max(100).optional(),
      provider: providerSchema.optional(), id: z.number().int().positive().optional(), requestId: z.string().uuid(), caption: z.string().trim().max(150).default(""), duration: z.number().int().min(15).max(105).default(60), theme: z.string().trim().max(100).default(""), options: optionsSchema.default({ audio: "auto", mood: "reflective", transition: "cut", framing: "auto" }),
      shots: z.array(z.object({ provider: providerSchema, id: z.number().int().positive(), start: z.number().finite().nonnegative(), end: z.number().finite().positive(), trimMode: z.enum(["auto", "manual"]).optional() }).refine(shot => shot.end > shot.start, "A shot must end after it starts.")).min(1).max(MAX_STOCK_SHOTS).optional(),
    }).refine(value => value.shots || (value.provider && value.id), "Choose footage before creating a reel.").refine(value => !value.shots || value.shots.length < 2 || value.theme.length >= 2, "Related shots need a shared subject or place.").refine(value => !value.automatic || (!value.shots && value.provider && value.id && value.query), "Automatic reels need a topic and one starting video.").parse(await request.json());
    if (input.automatic) {
      // Share the complete preparation/download promise, not only the saved job.
      // A retry arriving before queue persistence must not download a second set.
      // The UUID owns the first submitted recipe, matching saved-job lookup;
      // choosing another topic/source requires a new UUID (as the UI already does).
      const pending = automaticSubmissions.get(input.requestId);
      if (pending) return automaticStockResponse((await pending).job, true);
      const submission = (async () => {
        const existing = await findStockSourceJob(input.requestId);
        if (existing) return { job: existing, existing: true };
        const job = await queueAutomaticStockReel({ provider: input.provider!, id: input.id!, query: input.query!, requestId: input.requestId });
        return { job, existing: false };
      })();
      automaticSubmissions.set(input.requestId, submission);
      try { const accepted = await submission; return automaticStockResponse(accepted.job, accepted.existing); }
      finally { if (automaticSubmissions.get(input.requestId) === submission) automaticSubmissions.delete(input.requestId); }
    }
    const existing = await findStockSourceJob(input.requestId);
    if (existing) return Response.json({ job: existing, existing: true });
    if (!(await ffmpegAvailable())) return Response.json({ error: processingUnavailable }, { status: 503 });
    const unavailable = await readStockReuseBlocked();
    const requestedIds = input.shots ? input.shots.map(shot => `${shot.provider}:${shot.id}`) : [`${input.provider}:${input.id}`];
    if (requestedIds.some(identity => unavailable.has(identity))) throw new Error("A selected stock clip has reached its four-use limit within 18 months. Choose different footage; Phoenix will not recycle an overused clip.");
    let job;
    if (input.shots) {
      if (new Set(input.shots.map(shot => `${shot.provider}:${shot.id}`)).size !== input.shots.length) throw new Error("Choose each source once. Trim its useful interval instead of repeating footage.");
      const downloads: StockReelDownload[] = [], durations: Array<{ duration: number; start: number; end: number; trimMode?: "auto" | "manual" }> = [];
      for (const shot of input.shots) {
        const video = await resolveNaturalStock(shot.provider, shot.id), url = trustedStockUrl(video.previewUrl, shot.provider);
        durations.push({ duration: video.duration, start: shot.start, end: shot.end, trimMode: shot.trimMode });
        downloads.push({ provider: shot.provider, mediaId: String(shot.id), sourcePage: video.sourcePage, creator: video.creator, title: video.title, start: shot.start, end: shot.end, trimMode: shot.trimMode, open: () => openStockVideo(url) });
      }
      planStockIntervals(durations, input.duration, input.options.pacing); // Reject impossible trims before any media download.
      job = await createStockReelJob(downloads, { requestId: input.requestId, caption: input.caption, theme: input.theme, maxDuration: input.duration, options: input.options });
    } else {
      const provider = input.provider!, id = input.id!, video = await resolveNaturalStock(provider, id), opened = await openStockVideo(trustedStockUrl(video.previewUrl, provider));
      job = await createSourceJob(opened.stream, `${provider}-${id}.mp4`, "coverage", input.caption || video.title, opened.expectedBytes, {
        provider, mediaId: String(id), sourcePage: video.sourcePage, creator: video.creator, requestId: input.requestId, caption: input.caption, maxDuration: input.duration,
      });
    }
    return Response.json({ job, message: "Real footage queued. Original visuals and usable audio are preserved; no AI video or generated voice is requested." }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not queue stock reel." }, { status: error instanceof JobHistoryConflictError ? 409 : error instanceof StockProcessingUnavailableError ? 503 : 400 }); }
}
