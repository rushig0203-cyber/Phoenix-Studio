import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { getLocalProject } from "@/lib/localProjects";

export const dynamic = "force-dynamic";

const freeStockHosts = new Set(["videos.pexels.com", "cdn.pixabay.com"]);

function freeStockUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && freeStockHosts.has(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

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
    await db.project.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Delete failed" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const local = getLocalProject(id);
    if (local) return NextResponse.json({ url: local.previewUrl });
    const userId = await requireUserId();
    const project = await ownedProject(id, userId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const url = freeStockUrl(project.originalVideoUrl);
    if (!url) return NextResponse.json({ error: "Local copy unavailable" }, { status: 404 });
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Media unavailable" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}
