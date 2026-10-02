import { z } from "zod";
import { assertLocalRequest } from "@/lib/localRequest";
import { configuredStock, portraitFirstStock, resolveNaturalStock, searchNaturalStock, trustedStockUrl } from "@/lib/naturalStock";
import { createSourceJob, createStockReelJob, findStockSourceJob, ffmpegAvailable, type StockReelDownload } from "@/lib/sourceProcessing";
import { JobHistoryConflictError } from "@/lib/jobHistory";
import { MAX_STOCK_REEL_BYTES, MAX_STOCK_SHOTS, planStockIntervals } from "@/lib/stockReel";

const providerSchema = z.enum(["pexels", "pixabay"]);
const optionsSchema = z.object({ audio: z.enum(["auto", "original", "music", "ambience-music"]).default("auto"), mood: z.enum(["reflective", "warm", "journey"]).default("reflective"), transition: z.enum(["cut", "soft"]).default("cut"), framing: z.enum(["auto", "fit"]).default("auto") });

async function openStockVideo(url: string) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("video/")) { await response.body?.cancel(); throw new Error("The provider did not return a playable video stream."); }
  const expectedBytes = Number(response.headers.get("content-length")) || undefined;
  if (expectedBytes && expectedBytes > MAX_STOCK_REEL_BYTES) { await response.body.cancel(); throw new Error("This rendition exceeds the 500 MB laptop-safe stock limit. Choose another clip."); }
  return { stream: response.body, expectedBytes };
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
    const results = await Promise.allSettled(providers.map(name => searchNaturalStock(name, query)));
    return Response.json({ configured, videos: portraitFirstStock(results.flatMap(result => result.status === "fulfilled" ? result.value : [])), errors: results.flatMap(result => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "Stock search failed."] : []), query });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Search failed." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const input = z.object({
      provider: providerSchema.optional(), id: z.number().int().positive().optional(), requestId: z.string().uuid(), caption: z.string().trim().max(150).default(""), duration: z.number().int().min(15).max(105).default(60), theme: z.string().trim().max(100).default(""), options: optionsSchema.default({ audio: "auto", mood: "reflective", transition: "cut", framing: "auto" }),
      shots: z.array(z.object({ provider: providerSchema, id: z.number().int().positive(), start: z.number().finite().nonnegative(), end: z.number().finite().positive() }).refine(shot => shot.end > shot.start, "A shot must end after it starts.")).min(1).max(MAX_STOCK_SHOTS).optional(),
    }).refine(value => value.shots || (value.provider && value.id), "Choose footage before creating a reel.").refine(value => !value.shots || value.shots.length < 2 || value.theme.length >= 2, "Related shots need a shared subject or place.").parse(await request.json());
    const existing = await findStockSourceJob(input.requestId);
    if (existing) return Response.json({ job: existing, existing: true });
    if (!(await ffmpegAvailable())) return Response.json({ error: "FFmpeg and FFprobe are required before downloading or processing footage." }, { status: 503 });
    let job;
    if (input.shots) {
      if (new Set(input.shots.map(shot => `${shot.provider}:${shot.id}`)).size !== input.shots.length) throw new Error("Choose each source once. Trim its useful interval instead of repeating footage.");
      const downloads: StockReelDownload[] = [], durations: Array<{ duration: number; start: number; end: number }> = [];
      for (const shot of input.shots) {
        const video = await resolveNaturalStock(shot.provider, shot.id), url = trustedStockUrl(video.previewUrl, shot.provider);
        durations.push({ duration: video.duration, start: shot.start, end: shot.end });
        downloads.push({ provider: shot.provider, mediaId: String(shot.id), sourcePage: video.sourcePage, creator: video.creator, title: video.title, start: shot.start, end: shot.end, open: () => openStockVideo(url) });
      }
      planStockIntervals(durations, input.duration); // Reject impossible trims before any media download.
      job = await createStockReelJob(downloads, { requestId: input.requestId, caption: input.caption, theme: input.theme, maxDuration: input.duration, options: input.options });
    } else {
      const provider = input.provider!, id = input.id!, video = await resolveNaturalStock(provider, id), opened = await openStockVideo(trustedStockUrl(video.previewUrl, provider));
      job = await createSourceJob(opened.stream, `${provider}-${id}.mp4`, "coverage", input.caption || video.title, opened.expectedBytes, {
        provider, mediaId: String(id), sourcePage: video.sourcePage, creator: video.creator, requestId: input.requestId, caption: input.caption, maxDuration: input.duration,
      });
    }
    return Response.json({ job, message: "Real footage queued. Original visuals and usable audio are preserved; no AI video or generated voice is requested." }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not queue stock reel." }, { status: error instanceof JobHistoryConflictError ? 409 : 400 }); }
}
