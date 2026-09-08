import { NextResponse } from "next/server";
import { getReviewEditState, queueReviewEdit, saveReviewEditDraft } from "@/lib/reviewEdits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Context) {
  try { return NextResponse.json(await getReviewEditState((await params).id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Editor unavailable." }, { status: 404 }); }
}
export async function PATCH(request: Request, { params }: Context) {
  try { return NextResponse.json({ draft: await saveReviewEditDraft((await params).id, await request.json()) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save draft." }, { status: 400 }); }
}
export async function POST(request: Request, { params }: Context) {
  try { return NextResponse.json(await queueReviewEdit((await params).id, await request.json()), { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not queue edited copy." }, { status: 400 }); }
}
