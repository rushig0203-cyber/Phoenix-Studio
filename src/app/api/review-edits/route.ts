import { NextResponse } from "next/server";
import { listReviewEdits, removeReviewEdit } from "@/lib/reviewEdits";
import { safeReviewId } from "@/lib/reviewFiles";
import { assertLocalRequest } from "@/lib/localRequest";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const reviewId = new URL(request.url).searchParams.get("reviewId");
  if (reviewId !== null && !safeReviewId(reviewId)) return NextResponse.json({ error: "Valid review file ID required." }, { status: 400 });
  return NextResponse.json(await listReviewEdits(reviewId || undefined));
}
export async function DELETE(request: Request) {
  try { assertLocalRequest(request, true); } catch { return NextResponse.json({ error: "Open this action directly in Phoenix Studio." }, { status: 403 }); }
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !safeReviewId(id)) return NextResponse.json({ error: "Valid job ID required." }, { status: 400 });
  try { const result = await removeReviewEdit(id); return NextResponse.json(result || { error: "Job not found." }, { status: result ? 200 : 404 }); }
  catch(error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove edit." }, { status: 409 }); }
}
