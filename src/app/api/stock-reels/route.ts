import { z } from "zod";
import { assertLocalRequest } from "@/lib/localRequest";
import { configuredStock, resolveNaturalStock, searchNaturalStock, trustedStockUrl } from "@/lib/naturalStock";
import { createSourceJob, findStockSourceJob, ffmpegAvailable } from "@/lib/sourceProcessing";
import { JobHistoryConflictError } from "@/lib/jobHistory";

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
    return Response.json({ configured, videos: results.flatMap(result => result.status === "fulfilled" ? result.value : []), errors: results.flatMap(result => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "Stock search failed."] : []), query });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Search failed." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const input = z.object({ provider: z.enum(["pexels", "pixabay"]), id: z.number().int().positive(), requestId: z.string().uuid(), caption: z.string().trim().max(150).default(""), duration: z.number().int().min(15).max(105).default(60) }).parse(await request.json());
    const existing = await findStockSourceJob(input.requestId);
    if (existing) return Response.json({ job: existing, existing: true });
    if (!(await ffmpegAvailable())) return Response.json({ error: "FFmpeg and FFprobe are required before downloading or processing footage." }, { status: 503 });
    const video = await resolveNaturalStock(input.provider, input.id);
    const url = trustedStockUrl(video.previewUrl, input.provider);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("video/")) throw new Error("The provider did not return a playable video stream.");
    const length = Number(response.headers.get("content-length")) || undefined;
    if (length && length > 500 * 1024 * 1024) { await response.body.cancel(); throw new Error("This rendition exceeds the 500 MB laptop-safe stock limit. Choose another clip."); }
    const job = await createSourceJob(response.body, `${input.provider}-${input.id}.mp4`, "coverage", input.caption || video.title, length, {
      provider: input.provider, mediaId: String(input.id), sourcePage: video.sourcePage, creator: video.creator, requestId: input.requestId, caption: input.caption, maxDuration: input.duration,
    });
    return Response.json({ job, message: "Real footage queued. Original visuals and usable audio are preserved; no AI video or generated voice is requested." }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not queue stock reel." }, { status: error instanceof JobHistoryConflictError ? 409 : 400 }); }
}
