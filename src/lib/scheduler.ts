import { db } from "./db";
import { triggerWebhook } from "@/app/api/projects/[id]/publish/route";

const globalForScheduler = globalThis as unknown as {
  schedulerInitialized: boolean | undefined;
};

export function startScheduler() {
  if (globalForScheduler.schedulerInitialized) {
    return;
  }

  globalForScheduler.schedulerInitialized = true;
  console.log("AuraClip Scheduler: Initializing background publish worker...");

  // Run the check every 30 seconds
  setInterval(async () => {
    try {
      const now = new Date();
      const dueJobs = await db.publishHistory.findMany({
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
      });

      if (dueJobs.length === 0) {
        return;
      }

      console.log(`AuraClip Scheduler: Found ${dueJobs.length} due scheduled posts. Processing...`);

      for (const job of dueJobs) {
        try {
          const webhookUrl = job.project.user.publishSettings?.makeWebhookUrl;

          // Mark as PENDING during processing
          await db.publishHistory.update({
            where: { id: job.id },
            data: { status: "PENDING" },
          });

          console.log(`AuraClip Scheduler: Publishing clip "${job.clipTitle}" for platform "${job.platform}"`);

          let result;
          if (webhookUrl) {
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
            // Simulate processing latency
            await new Promise((resolve) => setTimeout(resolve, 1500));
            let postUrl = `https://instagram.com/p/simulated-post-${job.clipId}`;
            if (job.platform === "YouTube") {
              postUrl = `https://youtube.com/shorts/simulated-shorts-${job.clipId}`;
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
                error: result.error || "Failed to trigger Make.com webhook",
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
              error: jobErr.message || "Internal scheduling error",
            },
          });
        }
      }
    } catch (err) {
      console.error("AuraClip Scheduler: Fatal check interval error:", err);
    }
  }, 30_000);
}
