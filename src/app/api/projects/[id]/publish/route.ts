import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const manualOnlyMessage =
  "Cloud publishing is disabled in free local mode. Export the finished file and post it manually.";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { const userId = await requireUserId(); const { id } = await params; const project = await db.project.findFirst({ where: { id, userId }, select: { id: true } }); if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 }); return NextResponse.json(await db.publishHistory.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 50 })); } catch (error) { return NextResponse.json({ error: "Sign in required" }, { status: isUnauthorized(error) ? 401 : 500 }); } }

export async function POST() {
  return NextResponse.json({ error: manualOnlyMessage }, { status: 410 });
}
