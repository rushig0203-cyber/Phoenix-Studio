import fs from "fs";
import path from "path";
import { db } from "./db";
import { triggerWebhook } from "@/app/api/projects/[id]/publish/route";
import { publishToPlatform } from "./publisher";

const globalForScheduler = globalThis as unknown as {
  schedulerInitialized: boolean | undefined;
  watchFolderInitialized: boolean | undefined;
  isProcessingQueue: boolean | undefined;
};

// Sequential queue processing lock
let isProcessingQueue = false;

export function startScheduler() {
  if (globalForScheduler.schedulerInitialized) {
    return;
  }

  globalForScheduler.schedulerInitialized = true;
  console.log("AuraClip Scheduler: Initializing background publish worker...");

  // Run the sequential publisher queue check every 15 seconds
  setInterval(async () => {
    if (isProcessingQueue) {
      return;
    }
    isProcessingQueue = true;

    try {
      const now = new Date();
      // Find the oldest due scheduled post (sequential processing)
      const dueJob = await db.publishHistory.findFirst({
        where: {
          status: "SCHEDULED",
          scheduledFor: {
            lte: now,
          },
        },
        include: {
          project: {
            include: {
              user: {
                include: {
                  publishSettings: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "asc", // FIFO order
        },
      });

      if (dueJob) {
        console.log(`AuraClip Scheduler: Processing scheduled post sequentially: job ID ${dueJob.id}`);
        await processPublishJob(dueJob);
      }
    } catch (err) {
      console.error("AuraClip Scheduler: Queue execution error:", err);
    } finally {
      isProcessingQueue = false;
    }
  }, 15000);

  // Initialize Folder Watcher check
  startWatchFolderMonitor();
}

/**
 * Process a single publish job sequentially
 */
async function processPublishJob(job: any) {
  try {
    const publishSettings = job.project.user.publishSettings;
    const webhookUrl = publishSettings?.makeWebhookUrl;

    // Mark as PENDING during active processing
    await db.publishHistory.update({
      where: { id: job.id },
      data: { status: "PENDING" },
    });

    console.log(`AuraClip Scheduler: Publishing clip "${job.clipTitle}" for platform "${job.platform}"`);

    let result;

    // Determine path configuration
    const hasDirectCredentials =
      (job.platform === "YouTube" && publishSettings?.youtubeAccessToken) ||
      (job.platform === "Instagram" && publishSettings?.instagramAccessToken && publishSettings?.instagramAccountId);

    if (hasDirectCredentials) {
      // Direct integration flow (API calls)
      let publicMediaUrl = null;
      if (job.mediaPath) {
        // Upload to transfer.sh/0x0.st first if it is Instagram Reels (Graph API requires a public URL)
        if (job.platform === "Instagram") {
          const { uploadToTransferSh } = await import("@/app/api/projects/[id]/publish/route");
          const fullPath = path.resolve(process.cwd(), job.mediaPath);
          if (fs.existsSync(fullPath)) {
            const fileName = path.basename(fullPath);
            publicMediaUrl = await uploadToTransferSh(fullPath, fileName);
          }
        }
      }

      result = await publishToPlatform(
        {
          projectId: job.projectId,
          clipId: job.clipId,
          clipTitle: job.clipTitle,
          platform: job.platform,
          caption: job.caption || undefined,
          hashtags: job.hashtags || undefined,
          youtubeTitle: job.youtubeTitle || undefined,
          youtubeDesc: job.youtubeDesc || undefined,
          youtubeTags: job.youtubeTags || undefined,
          thumbnailUrl: job.thumbnailUrl || undefined,
        },
        job.mediaPath || "",
        publishSettings,
        publicMediaUrl
      );
    } else if (webhookUrl) {
      // Make.com fallback
      result = await triggerWebhook(
        webhookUrl,
        {
          projectId: job.projectId,
          clipId: job.clipId,
          clipTitle: job.clipTitle,
          platform: job.platform,
          caption: job.caption || undefined,
          hashtags: job.hashtags || undefined,
          youtubeTitle: job.youtubeTitle || undefined,
          youtubeDesc: job.youtubeDesc || undefined,
        },
        job.mediaPath || undefined
      );
    } else {
      // Sandbox simulation mode
      await new Promise((resolve) => setTimeout(resolve, 2000));
      let postUrl = `https://instagram.com/p/simulated-post-${job.clipId}`;
      if (job.platform === "YouTube") {
        postUrl = `https://youtube.com/shorts/${job.clipId}`;
      }
      result = { success: true, postUrl };
    }

    if (result.success) {
      await db.publishHistory.update({
        where: { id: job.id },
        data: {
          status: "PUBLISHED",
          postUrl: result.postUrl,
          error: null,
        },
      });
      console.log(`AuraClip Scheduler: Successfully published job ${job.id}`);
    } else {
      await db.publishHistory.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: result.error || "Publishing failed",
        },
      });
      console.warn(`AuraClip Scheduler: Failed to publish job ${job.id}: ${result.error}`);
    }
  } catch (jobErr: any) {
    console.error(`AuraClip Scheduler: Error processing job ${job.id}:`, jobErr);
    await db.publishHistory.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: jobErr.message || "Internal scheduling error during process",
      },
    });
  }
}

/**
 * Scans watch folder at workspace root for new video files.
 * Runs on startup and check repeats every 2 hours.
 */
function startWatchFolderMonitor() {
  if (globalForScheduler.watchFolderInitialized) {
    return;
  }
  globalForScheduler.watchFolderInitialized = true;

  const watchDir = path.join(process.cwd(), "watch_folder");
  const destDir = path.join(process.cwd(), "public", "watched_videos");

  // Ensure directories exist
  if (!fs.existsSync(watchDir)) {
    fs.mkdirSync(watchDir, { recursive: true });
    console.log(`AuraClip Watch Folder: Created monitor directory at ${watchDir}`);
  }
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Scan function
  const scanFolder = async () => {
    console.log("AuraClip Watch Folder: Scanning directory for incoming videos...");
    try {
      const files = fs.readdirSync(watchDir);
      const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv"];

      for (const fileName of files) {
        const ext = path.extname(fileName).toLowerCase();
        if (!videoExtensions.includes(ext)) {
          continue;
        }

        const sourcePath = path.join(watchDir, fileName);
        const stats = fs.statSync(sourcePath);
        if (!stats.isFile()) {
          continue;
        }

        // Find default user to assign the imported video to
        const defaultUser = await db.user.findFirst({
          orderBy: { createdAt: "asc" },
        });

        if (!defaultUser) {
          console.warn("AuraClip Watch Folder: No users exist in the database yet. Skipping auto-import.");
          break;
        }

        // Generate unique project ID
        const projectId = "proj_watch_" + Math.random().toString(36).substring(2, 11);
        const destFileName = `${projectId}${ext}`;
        const destPath = path.join(destDir, destFileName);

        // Copy file to public server directory
        fs.copyFileSync(sourcePath, destPath);

        // Remove from watch folder to prevent duplicate scanning
        try {
          fs.unlinkSync(sourcePath);
        } catch (unlinkErr) {
          console.error(`AuraClip Watch Folder: Failed to delete source file ${fileName}:`, unlinkErr);
        }

        // Create project record in DB with progress = 15 (indicates pending pipeline start)
        const projectTitle = path.basename(fileName, ext);
        await db.$transaction(async (tx) => {
          const project = await tx.project.create({
            data: {
              id: projectId,
              userId: defaultUser.id,
              title: projectTitle,
              duration: 120, // Placeholder duration, browser client will probe metadata to sync actual length
              status: "UPLOADING",
              progress: 15,
              originalVideoUrl: `/watched_videos/${destFileName}`,
              thumbnailUrl: "/thumbnails/default-video.jpg",
            },
          });

          await tx.video.create({
            data: {
              projectId: project.id,
              title: projectTitle,
              url: `/watched_videos/${destFileName}`,
              duration: 120,
              size: `${Math.round(stats.size / (1024 * 1024))}MB`,
            },
          });

          await tx.activityLog.create({
            data: {
              userId: defaultUser.id,
              action: "PROJECT_CREATE",
              details: `Auto-imported video file "${fileName}" from local Watch Folder.`,
            },
          });
        });

        console.log(`AuraClip Watch Folder: Auto-created project ${projectId} for file ${fileName}`);
      }
    } catch (err) {
      console.error("AuraClip Watch Folder: Error scanning watch directory:", err);
    }
  };

  // Run initial scan on boot
  setTimeout(scanFolder, 5000);

  // Repeat every 2 hours: 2 * 60 * 60 * 1000 = 7,200,000 ms
  setInterval(scanFolder, 7200000);
}
