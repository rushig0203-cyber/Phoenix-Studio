import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";

/**
 * Upload a local video file to transfer.sh to get a temporary public URL.
 * transfer.sh is free, needs no account, and returns a direct download link
 * that Make.com can use as the Video URL for Instagram and YouTube modules.
 * Files are auto-deleted after 14 days.
 */
export async function uploadToTransferSh(filePath: string, fileName: string): Promise<string | null> {
  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: "video/mp4" });

    // Use 0x0.st as primary (more reliable) and transfer.sh as fallback
    const uploadHosts = [
      {
        url: `https://0x0.st`,
        method: "POST",
        buildBody: () => {
          const fd = new FormData();
          fd.append("file", blob, fileName);
          return fd;
        },
        parseUrl: (text: string) => text.trim(),
      },
      {
        url: `https://transfer.sh/${encodeURIComponent(fileName)}`,
        method: "PUT",
        buildBody: () => blob,
        parseUrl: (text: string) => text.trim(),
      },
    ];

    for (const host of uploadHosts) {
      try {
        const res = await fetch(host.url, {
          method: host.method,
          body: host.buildBody() as BodyInit,
          headers: host.method === "PUT" ? { "Content-Type": "video/mp4" } : {},
          signal: AbortSignal.timeout(60_000), // 60s timeout
        });
        if (res.ok) {
          const url = host.parseUrl(await res.text());
          if (url.startsWith("http")) return url;
        }
      } catch {
        // try next host
      }
    }

    console.error("AuraClip: All public upload hosts failed.");
    return null;
  } catch (err) {
    console.error("AuraClip: Failed to upload clip to public host:", err);
    return null;
  }
}

// Helper to trigger the Make.com webhook with JSON payload including a public mediaUrl
export async function triggerWebhook(
  webhookUrl: string,
  payload: {
    projectId: string;
    clipId: string;
    clipTitle: string;
    platform: string;
    caption?: string;
    hashtags?: string;
    youtubeTitle?: string;
    youtubeDesc?: string;
  },
  mediaPath?: string
): Promise<{ success: boolean; postUrl?: string; error?: string }> {
  try {
    // Auto-upload clip to a free public host so Make.com can access the Video URL
    let mediaUrl: string | undefined;
    if (mediaPath) {
      const fullPath = path.resolve(process.cwd(), mediaPath);
      if (fs.existsSync(fullPath)) {
        const fileName = path.basename(fullPath);
        console.log(`AuraClip: Uploading ${fileName} to public host for Make.com...`);
        const uploaded = await uploadToTransferSh(fullPath, fileName);
        if (uploaded) {
          mediaUrl = uploaded;
          console.log(`AuraClip: Public media URL ready → ${mediaUrl}`);
        } else {
          console.warn("AuraClip: Could not upload to public host. Make.com will receive no mediaUrl.");
        }
      } else {
        return { success: false, error: `Media file not found at path: ${mediaPath}` };
      }
    }

    // Send clean JSON to Make.com so every field is individually mappable
    const jsonPayload = {
      projectId: payload.projectId,
      clipId: payload.clipId,
      clipTitle: payload.clipTitle,
      platform: payload.platform,
      mediaUrl,                              // ← direct public video URL for Instagram/YouTube
      instagram: {
        caption: payload.caption || "",
        hashtags: payload.hashtags || "",
      },
      youtube: {
        title: payload.youtubeTitle || "",
        description: payload.youtubeDesc || "",
        hashtags: payload.hashtags || "",
      },
      timestamp: new Date().toISOString(),
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonPayload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Webhook responded with status ${res.status}: ${text}` };
    }

    let postUrl = `https://instagram.com/p/mock-post-${payload.clipId}`;
    if (payload.platform === "YouTube") {
      postUrl = `https://youtube.com/shorts/mock-shorts-${payload.clipId}`;
    }

    try {
      const data = await res.json();
      if (data.postUrl) postUrl = data.postUrl;
    } catch {
      // Non-JSON response is fine, use fallback
    }

    return { success: true, postUrl };
  } catch (error: any) {
    console.error("AuraClip Publishing: Webhook trigger failed:", error);
    return { success: false, error: error.message || "Network request failed" };
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  try {
    const history = await db.publishHistory.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(history);
  } catch (error) {
    console.error("Fetch publish history error:", error);
    return NextResponse.json({ error: "Failed to fetch publish history" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const { id: projectId } = await params;

  try {
    const body = await req.json();
    const {
      id: historyId, // For retries
      clipId,
      clipTitle,
      platform,
      scheduledFor,
      caption,
      hashtags,
      youtubeTitle,
      youtubeDesc,
      youtubeTags,
      thumbnailUrl,
      mediaPath,
    } = body;

    const settings = await db.publishSettings.findUnique({
      where: { userId },
    });

    const hasWebhook = settings && !!settings.makeWebhookUrl;

    // Determine initial status
    const isScheduled = !!scheduledFor;
    const initialStatus = isScheduled ? "SCHEDULED" : "PENDING";

    let historyRecord;

    if (historyId) {
      // This is a retry trigger
      historyRecord = await db.publishHistory.findUnique({
        where: { id: historyId },
      });
      if (!historyRecord) {
        return NextResponse.json({ error: "History record not found for retry" }, { status: 404 });
      }
    } else {
      // Create new record
      historyRecord = await db.publishHistory.create({
        data: {
          projectId,
          clipId,
          clipTitle,
          platform,
          status: initialStatus,
          scheduledFor: isScheduled ? new Date(scheduledFor) : null,
          caption,
          hashtags,
          youtubeTitle,
          youtubeDesc,
          youtubeTags,
          thumbnailUrl,
          mediaPath,
        },
      });
    }

    if (isScheduled && !historyId) {
      return NextResponse.json({ success: true, record: historyRecord });
    }

    // Publish immediately
    // Update record to PENDING first
    await db.publishHistory.update({
      where: { id: historyRecord.id },
      data: { status: "PENDING" },
    });

    let triggerResult;

    const hasDirectCredentials =
      (historyRecord.platform === "YouTube" && settings?.youtubeAccessToken) ||
      (historyRecord.platform === "Instagram" && settings?.instagramAccessToken && settings?.instagramAccountId);

    if (hasDirectCredentials) {
      let publicMediaUrl = null;
      if (historyRecord.mediaPath) {
        if (historyRecord.platform === "Instagram") {
          const fullPath = path.resolve(process.cwd(), historyRecord.mediaPath);
          if (fs.existsSync(fullPath)) {
            const fileName = path.basename(fullPath);
            publicMediaUrl = await uploadToTransferSh(fullPath, fileName);
          }
        }
      }

      const { publishToPlatform } = await import("@/lib/publisher");
      triggerResult = await publishToPlatform(
        {
          projectId,
          clipId: historyRecord.clipId,
          clipTitle: historyRecord.clipTitle,
          platform: historyRecord.platform,
          caption: historyRecord.caption || undefined,
          hashtags: historyRecord.hashtags || undefined,
          youtubeTitle: historyRecord.youtubeTitle || undefined,
          youtubeDesc: historyRecord.youtubeDesc || undefined,
          youtubeTags: historyRecord.youtubeTags || undefined,
          thumbnailUrl: historyRecord.thumbnailUrl || undefined,
        },
        historyRecord.mediaPath || "",
        settings,
        publicMediaUrl
      );
    } else if (hasWebhook) {
      triggerResult = await triggerWebhook(
        settings.makeWebhookUrl!,
        {
          projectId,
          clipId: historyRecord.clipId,
          clipTitle: historyRecord.clipTitle,
          platform: historyRecord.platform,
          caption: historyRecord.caption || undefined,
          hashtags: historyRecord.hashtags || undefined,
          youtubeTitle: historyRecord.youtubeTitle || undefined,
          youtubeDesc: historyRecord.youtubeDesc || undefined,
        },
        historyRecord.mediaPath || undefined
      );
    } else {
      // Simulate successful publish latency
      await new Promise((resolve) => setTimeout(resolve, 1500));
      let postUrl = `https://instagram.com/p/simulated-post-${historyRecord.clipId}`;
      if (historyRecord.platform === "YouTube") {
        postUrl = `https://youtube.com/shorts/simulated-shorts-${historyRecord.clipId}`;
      }
      triggerResult = { success: true, postUrl };
    }

    let updatedRecord;
    if (triggerResult.success) {
      updatedRecord = await db.publishHistory.update({
        where: { id: historyRecord.id },
        data: {
          status: "PUBLISHED",
          postUrl: triggerResult.postUrl,
          error: null,
        },
      });
    } else {
      updatedRecord = await db.publishHistory.update({
        where: { id: historyRecord.id },
        data: {
          status: "FAILED",
          error: triggerResult.error || "Failed to trigger webhook",
        },
      });
    }

    return NextResponse.json({ success: triggerResult.success, record: updatedRecord });
  } catch (error: any) {
    console.error("Publish action API error:", error);
    return NextResponse.json({ error: error.message || "Failed to trigger publishing" }, { status: 500 });
  }
}
