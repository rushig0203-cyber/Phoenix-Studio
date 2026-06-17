import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPresignedUploadUrl } from "@/lib/s3";
import { rateLimit } from "@/lib/rateLimit";
import { randomUUID } from "crypto";

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
    const { filename, fileType } = await req.json();
    if (!filename || !fileType) {
      return NextResponse.json({ error: "Missing filename or fileType" }, { status: 400 });
    }

    const isVideo = ALLOWED_VIDEO.includes(fileType) || fileType.startsWith("video/");
    const isAudio = ALLOWED_AUDIO.includes(fileType) || fileType.startsWith("audio/");

    if (!isVideo && !isAudio) {
      return NextResponse.json(
        { error: "Invalid format. Allowed: MP4, MOV, AVI, WebM, MP3, WAV, M4A, OGG, AAC." },
        { status: 400 }
      );
    }

    const fileExt = filename.split(".").pop() || (isVideo ? "mp4" : "mp3");
    const uniqueId = randomUUID();
    const sanitizedName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    
    const folder = isVideo ? "videos" : "audio";
    const s3Key = `${folder}/${userId}/${uniqueId}_${sanitizedName}`;

    const uploadUrl = await getPresignedUploadUrl(s3Key, fileType);
    
    // Fallback to localstack/mock/standard bucket URL formats
    const s3Domain = process.env.S3_ENDPOINT 
      ? `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_NAME || "auraclip-storage"}`
      : `https://${process.env.S3_BUCKET_NAME || "auraclip-storage"}.s3.amazonaws.com`;
    
    const downloadUrl = `${s3Domain}/${s3Key}`;

    return NextResponse.json({
      uploadUrl,
      s3Key,
      downloadUrl,
    });
  } catch (error) {
    console.error("Presigned URL error:", error);
    return NextResponse.json({ error: "Internal server upload failure" }, { status: 500 });
  }
}
