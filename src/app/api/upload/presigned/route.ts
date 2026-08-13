import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPresignedUploadUrl } from "@/lib/s3";
import { rateLimit } from "@/lib/rateLimit";
import { randomUUID } from "crypto";
import { ensureCloudCapacity } from "@/lib/storageQuota";

const ALLOWED_VIDEO = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
const ALLOWED_AUDIO = ["audio/mpeg", "audio/wav", "audio/x-m4a", "audio/ogg", "audio/aac", "audio/mp3"];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";

  // Rate limit S3 ticket generation requests to 15 per minute per user/IP
  if (!rateLimit(`upload:${userId || ip}`, 15)) {
    return NextResponse.json(
      { error: "Too many upload configuration requests. Please slow down." },
      { status: 429 }
    );
  }

  try {
    const { filename, fileType, bytes, kind } = await req.json();
    if (!filename || !fileType) {
      return NextResponse.json({ error: "Missing filename or fileType" }, { status: 400 });
    }
    const fileBytes = Number(bytes || 0);
    if (!Number.isFinite(fileBytes) || fileBytes <= 0 || fileBytes > 5 * 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
    }
    await ensureCloudCapacity(userId, fileBytes);

    const isVideo = ALLOWED_VIDEO.includes(fileType) || fileType.startsWith("video/");
    const isAudio = ALLOWED_AUDIO.includes(fileType) || fileType.startsWith("audio/");

    if (!isVideo && !isAudio) {
      return NextResponse.json(
        { error: "Invalid format. Allowed: MP4, MOV, AVI, WebM, MP3, WAV, M4A, OGG, AAC." },
        { status: 400 }
      );
    }

    const uniqueId = randomUUID();
    const sanitizedName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    
    const folder = kind === "export" && isVideo ? "exports" : isVideo ? "videos" : "audio";
    const s3Key = `users/${userId}/${folder}/${uniqueId}_${sanitizedName}`;

    const uploadUrl = await getPresignedUploadUrl(s3Key, fileType);
    
    return NextResponse.json({
      uploadUrl,
      s3Key,
    });
  } catch (error) {
    console.error("Presigned URL error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload unavailable" }, { status: 500 });
  }
}
