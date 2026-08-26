import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";
import { uploadToTransferSh, triggerWebhook } from "@/lib/publisher";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  let userId = (session?.user as any)?.id;

  if (!userId) {
    try {
      const defaultUser = await db.user.findFirst();
      userId = defaultUser?.id || "cmqh695mz0000y4jl85hnwwpl";
    } catch {
      userId = "cmqh695mz0000y4jl85hnwwpl";
    }
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
  let userId = (session?.user as any)?.id;

  if (!userId) {
    try {
      const defaultUser = await db.user.findFirst();
      userId = defaultUser?.id || "cmqh695mz0000y4jl85hnwwpl";
    } catch {
      userId = "cmqh695mz0000y4jl85hnwwpl";
    }
  }
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

    // Ensure the project exists in the database to satisfy the foreign key constraint.
    // This handles demo/fallback projects and localStorage-only projects.
    const projectExists = await db.project.findUnique({
      where: { id: projectId },
    });

    if (!projectExists) {
      await db.project.create({
        data: {
          id: projectId,
          userId,
          title: clipTitle || "Demo Video Project",
          status: "COMPLETED",
          progress: 100,
          duration: 0.0,
        },
      });
    }

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

    const hasDirectYoutube = settings?.youtubeConnected && !!settings?.youtubeAccessToken;
    const hasDirectInstagram = settings?.instagramConnected && !!settings?.instagramAccessToken && !!settings?.instagramAccountId;
    const hasDirectCredentials =
      (historyRecord.platform === "YouTube" && hasDirectYoutube) ||
      (historyRecord.platform === "Instagram" && hasDirectInstagram);

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
      // Share Link Mode - upload the video to transfer.sh/0x0.st and return the URL
      if (historyRecord.mediaPath) {
        const fullPath = path.resolve(process.cwd(), historyRecord.mediaPath);
        if (fs.existsSync(fullPath)) {
          const fileName = path.basename(fullPath);
          console.log(`AuraClip: Uploading ${fileName} to public host for Shareable Link...`);
          const uploadedUrl = await uploadToTransferSh(fullPath, fileName);
          if (uploadedUrl) {
            triggerResult = { success: true, postUrl: uploadedUrl };
          } else {
            console.log(`AuraClip: Public upload failed. Falling back to local static URL.`);
            const localUrl = `/temp_publishes/${fileName}`;
            triggerResult = { 
              success: true, 
              postUrl: localUrl,
              error: "Public upload failed. Fallback to local server download link." 
            };
          }
        } else {
          triggerResult = { success: false, error: `Media file not found at path: ${historyRecord.mediaPath}` };
        }
      } else {
        triggerResult = { success: false, error: "No media file path found for publishing." };
      }
    }

    let updatedRecord;
    if (triggerResult.success) {
      updatedRecord = await db.publishHistory.update({
        where: { id: historyRecord.id },
        data: {
          status: "PUBLISHED",
          postUrl: triggerResult.postUrl,
          error: triggerResult.error || null,
        },
      });

      // ── Auto-save to Desktop "AuraClips Posted Reels" folder ──────────────
      try {
        if (historyRecord.mediaPath) {
          const srcPath = path.resolve(process.cwd(), historyRecord.mediaPath);
          if (fs.existsSync(srcPath)) {
            const desktopBase = path.join(
              process.env.USERPROFILE || process.env.HOME || "",
              "Desktop",
              "AuraClips Posted Reels"
            );
            const platformFolder =
              historyRecord.platform === "YouTube" ? "YouTube" : "Instagram";
            const destDir = path.join(desktopBase, platformFolder);

            // Ensure destination folder exists
            await fs.promises.mkdir(destDir, { recursive: true });

            // Safe filename: clip title + timestamp (no overwrite risk)
            const safeTitle = (historyRecord.clipTitle || "clip")
              .replace(/[^a-zA-Z0-9 _-]/g, "")
              .trim()
              .replace(/\s+/g, "_")
              .slice(0, 60);
            const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const destFile = path.join(destDir, `${safeTitle}_${ts}.mp4`);

            await fs.promises.copyFile(srcPath, destFile);
            console.log(`AuraClip: Auto-saved posted reel → ${destFile}`);
          }
        }
      } catch (copyErr) {
        // Non-fatal — don't fail the publish because of a file copy error
        console.warn("AuraClip: Could not auto-save to desktop Posted Reels folder:", copyErr);
      }
      // ─────────────────────────────────────────────────────────────────────
    } else {
      const fileName = historyRecord.mediaPath ? path.basename(historyRecord.mediaPath) : `clip_${historyRecord.clipId}.mp4`;
      const localUrl = `/temp_publishes/${fileName}`;
      updatedRecord = await db.publishHistory.update({
        where: { id: historyRecord.id },
        data: {
          status: "FAILED",
          error: triggerResult.error || "Failed to trigger webhook",
          postUrl: localUrl, // Save local static URL in history so user can download the video
        },
      });
    }

    return NextResponse.json({ success: triggerResult.success, record: updatedRecord });
  } catch (error: any) {
    console.error("Publish action API error:", error);
    return NextResponse.json({ error: error.message || "Failed to trigger publishing" }, { status: 500 });
  }
}
