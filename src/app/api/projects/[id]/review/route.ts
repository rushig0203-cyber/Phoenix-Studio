import { NextResponse } from "next/server";
import { z } from "zod";
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

const input = z.object({ action: z.literal("approve") });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(); const { id } = await params;
    if (!input.safeParse(await request.json()).success) return NextResponse.json({ error: "Invalid review action" }, { status: 400 });
    const project = await db.project.findFirst({ where: { id, userId, sourceProvider: "moneyprinterturbo" } });
    if (!project) return NextResponse.json({ error: "Generated project not found" }, { status: 404 });
    if (project.workflowState !== "REVIEW_REQUIRED" && project.workflowState !== "APPROVED") return NextResponse.json({ error: "This video is not ready for review" }, { status: 409 });
    const updated = await db.project.update({ where: { id }, data: { workflowState: "APPROVED" } });
    return NextResponse.json({ approved: true, project: { ...updated, sourceBytes: Number(updated.sourceBytes) } });
  } catch (error) { return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Could not approve video" }, { status: isUnauthorized(error) ? 401 : 500 }); }
}
