import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedReadUrl } from "@/lib/s3";
import { requireUserId, isUnauthorized } from "@/lib/session";

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
      previewUrl: project.cloudAvailable && project.sourceS3Key ? await getPresignedReadUrl(project.sourceS3Key, 900).catch(() => null) : null,
    })));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Could not load library" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}
