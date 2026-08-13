import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { decryptSecret } from "@/lib/secrets";
import { getPresignedReadUrl } from "@/lib/s3";
import { publishToPlatform } from "@/lib/publisher";
import { z } from "zod";
import fs from "node:fs/promises"; import path from "node:path"; import os from "node:os";

const bodySchema = z.object({ clipId: z.string().min(1), clipTitle: z.string().min(1).max(200), platform: z.enum(["Instagram", "YouTube"]), scheduledFor: z.string().datetime().nullable().optional(), caption: z.string().max(2200).nullable().optional(), hashtags: z.string().max(500).nullable().optional(), youtubeTitle: z.string().max(100).nullable().optional(), youtubeDesc: z.string().max(5000).nullable().optional(), youtubeTags: z.string().max(500).nullable().optional(), mediaPath: z.string().min(1), idempotencyKey: z.string().min(8).max(200).optional() });

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { const userId = await requireUserId(); const { id } = await params; const project = await db.project.findFirst({ where: { id, userId }, select: { id: true } }); if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 }); return NextResponse.json(await db.publishHistory.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 50 })); } catch (error) { return NextResponse.json({ error: "Sign in required" }, { status: isUnauthorized(error) ? 401 : 500 }); } }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let tempFile: string | null = null;
  try {
    const userId = await requireUserId(); const { id } = await params; const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid publish request" }, { status: 400 });
    const data = parsed.data; const project = await db.project.findFirst({ where: { id, userId }, select: { id: true } }); if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const settings = await db.publishSettings.findUnique({ where: { userId } });
    const connected = data.platform === "Instagram" ? settings?.instagramConnected : settings?.youtubeConnected;
    if (!connected) return NextResponse.json({ error: `Connect ${data.platform} in Settings before publishing` }, { status: 409 });
    const idempotencyKey = data.idempotencyKey || `${id}:${data.clipId}:${data.platform}:${data.scheduledFor || "now"}`;
    const existing = await db.publishHistory.findUnique({ where: { idempotencyKey } }); if (existing) return NextResponse.json({ success: existing.status === "PUBLISHED", record: existing, duplicate: true }, { status: existing.status === "FAILED" ? 409 : 200 });
    const record = await db.publishHistory.create({ data: { projectId: id, clipId: data.clipId, clipTitle: data.clipTitle, platform: data.platform, status: data.scheduledFor ? "SCHEDULED" : "PENDING", scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null, caption: data.caption, hashtags: data.hashtags, youtubeTitle: data.youtubeTitle, youtubeDesc: data.youtubeDesc, youtubeTags: data.youtubeTags, mediaPath: data.mediaPath, idempotencyKey, processingStage: data.scheduledFor ? "SCHEDULED" : "UPLOADING", privacyStatus: data.platform === "YouTube" ? "public" : null } });
    if (data.scheduledFor) return NextResponse.json({ success: true, record });
    const publicUrl = await getPresignedReadUrl(data.mediaPath, 7200);
    let mediaFile = data.mediaPath;
    if (data.platform === "YouTube") { tempFile = path.join(os.tmpdir(), `${record.id}.mp4`); const mediaRes = await fetch(publicUrl); if (!mediaRes.ok) throw new Error("Unable to read the exported clip"); await fs.writeFile(tempFile, Buffer.from(await mediaRes.arrayBuffer())); mediaFile = tempFile; }
    await db.publishHistory.update({ where: { id: record.id }, data: { attemptCount: 1, processingStage: "PUBLISHING" } });
    const result = await publishToPlatform({ projectId: id, clipId: data.clipId, clipTitle: data.clipTitle, platform: data.platform, caption: data.caption || undefined, hashtags: data.hashtags || undefined, youtubeTitle: data.youtubeTitle || undefined, youtubeDesc: data.youtubeDesc || undefined, youtubeTags: data.youtubeTags || undefined }, mediaFile, { instagramAccessToken: decryptSecret(settings?.instagramAccessToken), instagramAccountId: settings?.instagramAccountId, youtubeAccessToken: decryptSecret(settings?.youtubeAccessToken), youtubeRefreshToken: decryptSecret(settings?.youtubeRefreshToken), youtubeClientId: process.env.GOOGLE_CLIENT_ID, youtubeClientSecret: process.env.GOOGLE_CLIENT_SECRET }, publicUrl);
    const updated = await db.publishHistory.update({ where: { id: record.id }, data: result.success ? { status: "PUBLISHED", processingStage: "PUBLISHED", postUrl: result.postUrl, publishedAt: new Date(), error: null } : { status: "FAILED", processingStage: "FAILED", error: result.error || "The platform rejected the post" } });
    if (result.success) await db.project.update({ where: { id }, data: { workflowState: "PUBLISHED", publishedAt: new Date() } });
    return NextResponse.json({ success: result.success, record: updated }, { status: result.success ? 200 : 502 });
  } catch (error) { return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : error instanceof Error ? error.message : "Publish failed" }, { status: isUnauthorized(error) ? 401 : 500 }); }
  finally { if (tempFile) await fs.unlink(tempFile).catch(() => undefined); }
}
