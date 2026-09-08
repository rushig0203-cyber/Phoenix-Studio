import { NextResponse } from "next/server";
import { listReviewEdits, removeReviewEdit } from "@/lib/reviewEdits";
import { safeReviewId } from "@/lib/reviewFiles";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json(await listReviewEdits()); }
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !safeReviewId(id)) return NextResponse.json({ error: "Valid job ID required." }, { status: 400 });
  try { const result = await removeReviewEdit(id); return NextResponse.json(result || { error: "Job not found." }, { status: result ? 200 : 404 }); }
  catch(error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove edit." }, { status: 409 }); }
}
