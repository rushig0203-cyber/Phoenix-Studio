import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/localRequest";
import { JobHistoryConflictError } from "@/lib/jobHistory";
import {
  createSourceJob,
  MAX_SOURCE_BYTES,
  readSourceJobs,
  removeSourceJob,
  SourceUploadInterruptedError,
  SourceUploadTooLargeError,
  sourceProcessingPreflight,
  sourceJobWithTiming,
  type ProcessingMode,
} from "@/lib/sourceProcessing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodedHeader(request: Request, name: string) {
  const value = request.headers.get(name) || "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

function contentLength(request: Request) {
  const parsed = Number(request.headers.get("content-length"));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("statusOnly") === "1") {
      const jobs = await readSourceJobs();
      return NextResponse.json({ jobs: jobs.map((job) => sourceJobWithTiming(job)) });
    }
    const [preflight, jobs] = await Promise.all([
      sourceProcessingPreflight(),
      readSourceJobs(),
    ]);
    return NextResponse.json({
      rendererAvailable: preflight.ready,
      preflight,
      jobs: jobs.map((job) => sourceJobWithTiming(job)),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not load source processing status.",
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try { assertLocalRequest(request, true); }
  catch { return NextResponse.json({ error: "Open this action directly in Phoenix Studio on this PC." }, { status: 403 }); }
  try {
    const filename = decodedHeader(request, "x-phoenix-filename");
    const title = decodedHeader(request, "x-phoenix-title");
    const mode = (request.headers.get("x-phoenix-mode") === "highlights" ? "highlights" : "coverage") as ProcessingMode;
    const size = contentLength(request);
    const contentType = request.headers.get("content-type") || "";
    if (!filename || !request.body) return NextResponse.json({ error: "Choose a video file." }, { status: 400 });
    if (!contentType.startsWith("video/") && !/\.(mp4|mov|avi|webm|mkv)$/i.test(filename)) {
      return NextResponse.json({ error: "Choose a supported video file." }, { status: 400 });
    }
    if (size && size > MAX_SOURCE_BYTES) throw new SourceUploadTooLargeError();

    const preflight = await sourceProcessingPreflight(true);
    if (!preflight.ready) {
      return NextResponse.json({ error: preflight.summary, preflight }, { status: 503 });
    }
    console.log("[source-processing] bounded streaming upload started", { filename, size: size || "unknown", mode });
    const job = await createSourceJob(request.body, filename, mode, title, size);
    console.log("[source-processing] upload queued", { jobId: job.id, filename, size: size || "unknown", mode });
    return NextResponse.json({
      job,
      rendererAvailable: true,
      preflight,
      message: preflight.firstModelDownloadRequired
        ? "Upload complete. Queued in FIFO order; the first transcription will download the Whisper model once."
        : "Upload complete. Queued in FIFO order and visible in Workflow Manager.",
    }, { status: 201 });
  } catch (error) {
    console.error("[source-processing] upload failed", error);
    const status = error instanceof SourceUploadTooLargeError
      ? 413
      : error instanceof SourceUploadInterruptedError
        ? 400
        : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not queue source video.",
    }, { status });
  }
}

export async function DELETE(request: Request) {
  try { assertLocalRequest(request, true); }
  catch { return NextResponse.json({ error: "Open this action directly in Phoenix Studio on this PC." }, { status: 403 }); }
  const parsed = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsed.success) return NextResponse.json({ error: "A valid job id is required." }, { status: 400 });
  try {
    const job = await removeSourceJob(parsed.data);
    return job
      ? NextResponse.json({ deleted: true, cancelled: job.status === "CANCELLED", filesRetained: true })
      : NextResponse.json({ error: "Job not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove this job." }, {
      status: error instanceof JobHistoryConflictError ? 409 : 500,
    });
  }
}
