import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteFromS3, getPresignedReadUrl } from "@/lib/s3";
import { requireUserId, isUnauthorized } from "@/lib/session";

async function ownedProject(id: string, userId: string) {
  return db.project.findFirst({ where: { id, userId }, include: { videos: true, exports: true } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    if (!await ownedProject(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = await req.json();
    const update: { title?: string; workflowState?: string; editedAt?: Date; exportedAt?: Date } = {};
    if (typeof data.title === "string" && data.title.trim()) update.title = data.title.trim().slice(0, 160);
    if (data.event === "edited") { update.workflowState = "EDITED"; update.editedAt = new Date(); }
    if (data.event === "exported") { update.workflowState = "EDITED"; update.exportedAt = new Date(); }
    const project = await db.project.update({ where: { id }, data: update });
    return NextResponse.json({ ...project, sourceBytes: Number(project.sourceBytes) });
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Update failed" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const project = await ownedProject(id, userId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const keys = new Set([project.sourceS3Key, ...project.videos.map(v => v.s3Key), ...project.exports.map(e => e.s3Key)].filter(Boolean) as string[]);
    await Promise.all([...keys].map(key => deleteFromS3(key).catch(() => undefined)));
    await db.project.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Delete failed" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(); const { id } = await params;
    const project = await ownedProject(id, userId);
    if (!project?.sourceS3Key || !project.cloudAvailable) return NextResponse.json({ error: "Cloud copy removed" }, { status: 404 });
    const url = await getPresignedReadUrl(project.sourceS3Key, new URL(req.url).searchParams.get("download") === "1" ? 300 : 900);
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Media unavailable" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}
