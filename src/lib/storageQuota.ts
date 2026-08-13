import { db } from "@/lib/db";
import { deleteFromS3, getCloudUsage, STORAGE_LIMIT_BYTES, STORAGE_TARGET_BYTES } from "@/lib/s3";

export async function ensureCloudCapacity(userId: string, incomingBytes: number) {
  const usage = await getCloudUsage(`users/${userId}/`);
  if (usage.bytes + incomingBytes <= STORAGE_LIMIT_BYTES) return usage;

  const published = await db.project.findMany({
    where: { userId, workflowState: "PUBLISHED", cloudAvailable: true },
    include: { videos: true, exports: { orderBy: { createdAt: "asc" } }, publishHistories: true },
    orderBy: { publishedAt: "asc" },
  });

  let currentBytes = usage.bytes;
  for (const project of published) {
    for (const item of project.exports) {
      if (!item.s3Key) continue;
      await deleteFromS3(item.s3Key).catch(() => undefined);
      currentBytes -= Number(item.bytes || 0);
      await db.export.update({ where: { id: item.id }, data: { s3Key: null, downloadUrl: null } });
    }
    for (const publish of project.publishHistories) {
      if (!publish.mediaPath) continue;
      await deleteFromS3(publish.mediaPath).catch(() => undefined);
      await db.publishHistory.update({ where: { id: publish.id }, data: { mediaPath: null } });
    }
    currentBytes = (await getCloudUsage(`users/${userId}/`)).bytes;
    if (currentBytes + incomingBytes <= STORAGE_TARGET_BYTES) break;

    for (const video of project.videos) {
      if (!video.s3Key) continue;
      await deleteFromS3(video.s3Key).catch(() => undefined);
      currentBytes -= Number(video.bytes || 0);
      await db.video.update({ where: { id: video.id }, data: { s3Key: null, url: "" } });
    }
    if (project.sourceS3Key) await deleteFromS3(project.sourceS3Key).catch(() => undefined);
    await db.project.update({
      where: { id: project.id },
      data: { sourceS3Key: null, originalVideoUrl: null, cloudAvailable: false, sourceBytes: 0 },
    });
    currentBytes = (await getCloudUsage(`users/${userId}/`)).bytes;
    if (currentBytes + incomingBytes <= STORAGE_TARGET_BYTES) break;
  }

  if (currentBytes + incomingBytes > STORAGE_LIMIT_BYTES) {
    throw new Error("Storage full. Delete a file to continue.");
  }
  return { bytes: Math.max(0, currentBytes), objects: usage.objects };
}
