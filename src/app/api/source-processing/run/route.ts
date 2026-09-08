import { NextResponse } from "next/server";
import { retrySourceJob } from "@/lib/sourceProcessing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id.trim()) {
    return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  }
  const result = await retrySourceJob(body.id.trim());
  if (!result) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (!result.queued) {
    return NextResponse.json({
      error: result.job.status === "COMPLETED"
        ? "This job is already complete."
        : "This job is currently processing.",
      job: result.job,
    }, { status: 409 });
  }
  return NextResponse.json({
    queued: true,
    job: result.job,
    message: result.changed
      ? "Job is queued. The local FIFO worker will pick it up; validated clips will be reused."
      : "Job is already queued.",
  });
}
