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

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
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
