import crypto from "node:crypto";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/localRequest";
import { JobHistoryConflictError } from "@/lib/jobHistory";
import { createSourceJob, findStockSourceJob, ffmpegAvailable, SourceUploadTooLargeError, type SourceJob } from "@/lib/sourceProcessing";
import { MAX_STOCK_REEL_BYTES } from "@/lib/stockReel";
import type { StockLicence } from "@/lib/stockProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pendingImports = new Map<string, Promise<SourceJob>>();
class ImportRendererUnavailable extends Error {}

function header(request: Request, name: string) {
  try { return decodeURIComponent(request.headers.get(name) || "").trim(); }
  catch { throw new Error("An import field could not be read. Choose the file and source page again."); }
}

/** Downloads remain owner-selected: no scraping or arbitrary remote URL fetching. */
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const provider = z.enum(["mixkit", "dareful"]).parse(request.headers.get("x-phoenix-stock-provider"));
    const requestId = z.string().uuid().parse(request.headers.get("x-phoenix-request-id"));
    const filename = z.string().min(1).max(255).parse(header(request, "x-phoenix-filename"));
    const title = z.string().max(160).parse(header(request, "x-phoenix-title"));
    const creator = z.string().max(120).parse(header(request, "x-phoenix-creator"));
    const source = new URL(z.string().url().max(1000).parse(header(request, "x-phoenix-source-page")));
    const allowedHost = provider === "mixkit" ? /^(www\.)?mixkit\.co$/ : /^(www\.)?dareful\.com$/;
    if (source.protocol !== "https:" || !allowedHost.test(source.hostname) || source.username || source.password || source.port
      || (provider === "mixkit" ? !/^\/free-stock-video\/[^/]+\/?$/.test(source.pathname)
        : !/^\/[^/]+\/?$/.test(source.pathname) || /^\/(?:about|sitemap|category|tag|privacy|terms)(?:[.\-/]|$)/i.test(source.pathname))) throw new Error("Use the original clip page on the selected footage website, not a download, category or home page.");
    if (request.headers.get("x-phoenix-licence-confirmed") !== "true") throw new Error("Confirm the clip's licence before importing. Mixkit Restricted clips cannot be used here.");
    if (provider === "dareful" && !creator) throw new Error("Dareful requires the original creator's name for attribution.");
    if (!request.body || !/\.(mp4|mov|webm|mkv)$/i.test(filename)) throw new Error("Choose a downloaded MP4, MOV, WebM or MKV video.");
    const rawSize = request.headers.get("content-length");
    const size = rawSize === null ? undefined : Number(rawSize);
    if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0)) throw new Error("The upload size is invalid.");
    if (size && size > MAX_STOCK_REEL_BYTES) throw new SourceUploadTooLargeError(MAX_STOCK_REEL_BYTES);
    source.hostname = source.hostname.replace(/^www\./, ""); source.search = ""; source.hash = "";
    const sourcePage = source.toString();
    const licence: StockLicence = provider === "dareful" ? {
      name: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/",
      attribution: `Footage: ${creator} — ${sourcePage} — CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); edited for this reel.`,
      requiresAttribution: true, verifiedBy: "owner-confirmation",
    } : { name: "Mixkit Stock Video Free License", url: "https://mixkit.co/license/modal/videoFree/", attribution: "", requiresAttribution: false, verifiedBy: "owner-confirmation" };
    const mediaId = crypto.createHash("sha256").update(sourcePage).digest("hex");
    const active = pendingImports.get(requestId);
    if (active) { await request.body.cancel(); return Response.json({ job: await active, existing: true, message: "Your existing footage import is saved in Jobs." }); }
    const submission = (async () => {
      const existing = await findStockSourceJob(requestId);
      if (existing) { await request.body!.cancel(); return existing; }
      if (!(await ffmpegAvailable())) throw new ImportRendererUnavailable("FFmpeg and FFprobe are required before processing imported footage.");
      return createSourceJob(request.body!, filename, "coverage", title || filename.replace(/\.[^.]+$/, ""), size, {
        provider, mediaId, sourcePage, creator: creator || "Mixkit contributor", licence, requestId, caption: "", maxDuration: 40,
        options: { audio: "music", mood: "reflective", transition: "cut", framing: "auto", pacing: "cinematic", reusePolicy: "four-in-18-months-v1" },
      });
    })();
    pendingImports.set(requestId, submission);
    try { return Response.json({ job: await submission, message: "Downloaded footage imported and queued. Review the finished reel in Jobs before posting." }, { status: 201 }); }
    finally { if (pendingImports.get(requestId) === submission) pendingImports.delete(requestId); }
  } catch (error) {
    await request.body?.cancel().catch(() => undefined);
    return Response.json({ error: error instanceof Error ? error.message : "Could not import this downloaded footage." }, {
      status: error instanceof SourceUploadTooLargeError ? 413 : error instanceof JobHistoryConflictError ? 409 : error instanceof ImportRendererUnavailable ? 503 : 400,
    });
  }
}
