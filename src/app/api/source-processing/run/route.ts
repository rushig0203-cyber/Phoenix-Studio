import { NextResponse } from "next/server";
import { retrySourceJob } from "@/lib/sourceProcessing";
import { assertLocalRequest } from "@/lib/localRequest";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { assertLocalRequest(request, true); }
  catch { return NextResponse.json({ error: "Open this action directly in Phoenix Studio on this PC." }, { status: 403 }); }
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  if (!body || !z.string().uuid().safeParse(body.id).success) {
    return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  }
  const result = await retrySourceJob(String(body.id));
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
