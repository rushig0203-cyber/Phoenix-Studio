import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteFromS3, listCloudKeys } from "@/lib/s3";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch all referenced keys in database
    const videos = await db.video.findMany({ select: { s3Key: true } });
    const audios = await db.audioTrack.findMany({ select: { s3Key: true } });
    const exports = await db.export.findMany({ select: { s3Key: true } });
    const projects = await db.project.findMany({ select: { sourceS3Key: true } });
    const publishes = await db.publishHistory.findMany({ select: { mediaPath: true } });

    const dbKeys = new Set<string>();
    videos.forEach((v) => v.s3Key && dbKeys.add(v.s3Key));
    audios.forEach((a) => a.s3Key && dbKeys.add(a.s3Key));
    exports.forEach((e) => e.s3Key && dbKeys.add(e.s3Key));
    projects.forEach((p) => p.sourceS3Key && dbKeys.add(p.sourceS3Key));
    publishes.forEach((p) => p.mediaPath && dbKeys.add(p.mediaPath));

    // 2. Fetch all S3 objects
    const s3Objects = await listCloudKeys();

    // 3. Filter keys which are in S3 but missing from the database
    const orphanedKeys = s3Objects.filter((key) => !dbKeys.has(key));

    return NextResponse.json({
      dbKeysCount: dbKeys.size,
      s3KeysCount: s3Objects.length,
      orphanedKeys,
      orphanedKeysCount: orphanedKeys.length,
    });
  } catch (error) {
    console.error("Storage scan error:", error);
    return NextResponse.json({ error: "Failed to execute storage audit scan" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { keys } = await req.json();
    if (!Array.isArray(keys)) {
      return NextResponse.json({ error: "Invalid keys parameter structure" }, { status: 400 });
    }

    const cleanedKeys: string[] = [];
    const failedKeys: string[] = [];

    // Delete orphaned files from S3
    for (const key of keys) {
      try {
        await deleteFromS3(key);
        cleanedKeys.push(key);
      } catch (err) {
        console.error(`S3 sweep error on key ${key}:`, err);
        failedKeys.push(key);
      }
    }

    // Log administrative storage sweeps
    const adminId = (session.user as any).id;
    await db.activityLog.create({
      data: {
        userId: adminId,
        action: "ADMIN_STORAGE_CLEANUP",
        details: `Cleaned up ${cleanedKeys.length} orphaned storage files. Failed: ${failedKeys.length}.`,
      },
    });

    return NextResponse.json({
      success: true,
      cleanedCount: cleanedKeys.length,
      failedCount: failedKeys.length,
      failedKeys,
    });
  } catch (error) {
    console.error("Storage cleanup error:", error);
    return NextResponse.json({ error: "Failed to run storage cleanup sweep" }, { status: 500 });
  }
}
