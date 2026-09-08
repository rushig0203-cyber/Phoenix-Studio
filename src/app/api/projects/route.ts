import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { localProjects } from "@/lib/localProjects";

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

export async function GET() {
  try {
    const userId = await requireUserId();
    const projects = await db.project.findMany({
      where: { userId },
      include: {
        publishHistories: { where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 2 },
      },
      orderBy: { createdAt: "desc" },
    });
    const result = await Promise.all(projects.map(async project => ({
      ...project,
      sourceBytes: Number(project.sourceBytes),
      previewUrl: freeStockUrl(project.originalVideoUrl),
      cloudAvailable: false,
    })));
    const localLibrary = localProjects.map((project) => ({
      ...project,
      workflowState: "REVIEW_REQUIRED",
      sourceProvider: "Local device",
      cloudAvailable: false,
      createdAt: new Date(0).toISOString(),
      publishHistories: [],
    }));
    return NextResponse.json([...localLibrary, ...result]);
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Could not load library" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}
