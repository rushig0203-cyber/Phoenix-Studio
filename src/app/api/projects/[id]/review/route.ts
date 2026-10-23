import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(); const { id } = await params;
    const project = await db.project.findFirst({ where: { id, userId }, include: { generationJob: true, videos: { take: 1 } } });
    if (!project || project.sourceProvider !== "moneyprinterturbo") return NextResponse.json({ error: "Generated project not found" }, { status: 404 });
    const previewUrl = null;
    return NextResponse.json({ project: { ...project, sourceBytes: Number(project.sourceBytes) }, previewUrl, socialCopy: project.generationJob?.socialCopyJson ? JSON.parse(project.generationJob.socialCopyJson) : null });
  } catch (error) { return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Could not load review" }, { status: isUnauthorized(error) ? 401 : 500 }); }
}
