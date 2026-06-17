import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteFromS3 } from "@/lib/s3";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const role = (session.user as any).role;
  const { id: projectId } = await params;

  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.userId !== userId && role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { title } = await req.json();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const updated = await db.project.update({
      where: { id: projectId },
      data: { title },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update project error:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const role = (session.user as any).role;
  const { id: projectId } = await params;
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";

  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        videos: true,
        audioTracks: true,
        exports: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.userId !== userId && role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1. Collect all S3 keys to clean up
    const keysToDelete: string[] = [];
    project.videos.forEach((v) => v.s3Key && keysToDelete.push(v.s3Key));
    project.audioTracks.forEach((a) => a.s3Key && keysToDelete.push(a.s3Key));
    project.exports.forEach((e) => e.s3Key && keysToDelete.push(e.s3Key));

    // 2. Delete media payloads from S3 bucket
    for (const key of keysToDelete) {
      try {
        await deleteFromS3(key);
      } catch (s3Err) {
        console.warn(`Storage Sweep: Failed to remove key "${key}" from S3:`, s3Err);
      }
    }

    // 3. Delete from DB (Prisma cascade rules clean up clips, exports, and history)
    await db.project.delete({
      where: { id: projectId },
    });

    // 4. Log deletion audit event
    await db.activityLog.create({
      data: {
        userId,
        action: "PROJECT_DELETE",
        details: `Deleted project "${project.title}" (${projectId}) and cleared S3 storage keys.`,
        ipAddress: ip,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete project error:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
