import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { objectExists } from "@/lib/s3";
import { requireUserId, isUnauthorized } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const data = await req.json();
    const key = String(data.s3Key || "");
    if (!key.startsWith(`users/${userId}/videos/`)) {
      return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
    }
    const object = await objectExists(key);
    if (!object.exists) return NextResponse.json({ error: "Upload is incomplete" }, { status: 409 });

    const existing = await db.project.findFirst({ where: { userId, sourceS3Key: key } });
    if (existing) return NextResponse.json({ ...existing, sourceBytes: Number(existing.sourceBytes) });

    const title = String(data.title || data.filename || "Untitled video").trim().slice(0, 160);
    const duration = Math.max(0, Number(data.duration || 0));
    const sourceProvider = ["pexels", "pixabay"].includes(data.sourceProvider) ? data.sourceProvider : "local";
    const project = await db.project.create({
      data: {
        userId,
        title,
        duration,
        status: "COMPLETED",
        progress: 100,
        workflowState: "UPLOADED",
        sourceProvider,
        sourceMediaId: data.sourceMediaId ? String(data.sourceMediaId) : null,
        originalFilename: String(data.filename || title),
        mimeType: object.contentType || String(data.mimeType || "video/mp4"),
        sourceS3Key: key,
        sourceBytes: object.bytes,
        cloudAvailable: true,
        videos: { create: { title, url: "", s3Key: key, duration, size: `${(object.bytes / 1048576).toFixed(1)} MB`, bytes: object.bytes } },
      },
    });
    if (sourceProvider !== "local" && data.sourceMediaId) {
      await db.stockMediaUse.upsert({
        where: { userId_provider_mediaId: { userId, provider: sourceProvider, mediaId: String(data.sourceMediaId) } },
        update: { title }, create: { userId, provider: sourceProvider, mediaId: String(data.sourceMediaId), title },
      });
    }
    return NextResponse.json({ ...project, sourceBytes: Number(project.sourceBytes) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Could not finish upload" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}
