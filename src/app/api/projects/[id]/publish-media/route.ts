import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { uploadBuffer } from "@/lib/s3";
import { ensureCloudCapacity } from "@/lib/storageQuota";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(); const { id } = await params;
    const project = await db.project.findFirst({ where: { id, userId }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const form = await req.formData(); const file = form.get("file"); const clipId = String(form.get("clipId") || "clip");
    if (!(file instanceof File) || !file.type.startsWith("video/")) return NextResponse.json({ error: "A valid video file is required" }, { status: 400 });
    if (file.size > 500 * 1024 * 1024) return NextResponse.json({ error: "Published clips must be smaller than 500 MB" }, { status: 413 });
    await ensureCloudCapacity(userId, file.size);
    const key = `users/${userId}/projects/${id}/publishes/${clipId}-${crypto.randomUUID()}.mp4`;
    await uploadBuffer(key, Buffer.from(await file.arrayBuffer()), file.type || "video/mp4");
    return NextResponse.json({ key, path: key });
  } catch (error) { return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : error instanceof Error ? error.message : "Upload failed" }, { status: isUnauthorized(error) ? 401 : 500 }); }
}
