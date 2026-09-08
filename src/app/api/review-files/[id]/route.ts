import { NextResponse } from "next/server";
import { getReviewFile, removeReviewFile, restoreReviewFile, safeReviewId } from "@/lib/reviewFiles";
import { assertLocalChannelRequest } from "@/lib/channelConnections";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!safeReviewId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = await getReviewFile(id);
  return file ? NextResponse.json(file) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertLocalChannelRequest(request, true); } catch { return NextResponse.json({ error: "Open Phoenix directly on localhost to move files to Trash." }, { status: 403 }); }
  const { id } = await params;
  if (!safeReviewId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = await removeReviewFile(id);
  return file ? NextResponse.json({ deleted: true, recoverable: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertLocalChannelRequest(request, true); } catch { return NextResponse.json({ error: "Open Phoenix directly on localhost to restore files." }, { status: 403 }); }
  const { id } = await params;
  if (!safeReviewId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body?.action !== "restore") return NextResponse.json({ error: "Use the restore action." }, { status: 400 });
  const file = await restoreReviewFile(id);
  return file ? NextResponse.json(file) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
