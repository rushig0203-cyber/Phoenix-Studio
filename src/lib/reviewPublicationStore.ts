import fs from "node:fs/promises";
import path from "node:path";
import type { ChannelPlatform } from "./channelConnections";
import { withFileLock } from "./fileLock";

export const publicationStoreRoot = () => process.env.PHOENIX_PUBLISH_STORAGE || path.join(process.cwd(), "storage", "private", "review-publications");
export const publicationJobPath = (reviewId: string, platform: ChannelPlatform, kind?: "story") =>
  path.join(publicationStoreRoot(), `${reviewId}-${platform}${kind === "story" ? "-story" : ""}.json`);
export const publicationPairLock = (reviewId: string, platform: ChannelPlatform, kind?: "story") =>
  `${publicationJobPath(reviewId, platform, kind)}.lock`;

/** Give accepted or concurrent posting requests priority over edit retention. */
export async function withUnpublishedReview(reviewId: string, archive: () => Promise<boolean>): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(reviewId)) return false;
  const destinations: [ChannelPlatform, "story"?][] = [["youtube"], ["facebook"], ["instagram"], ["instagram", "story"]];
  async function lock(index: number): Promise<boolean> {
    if (index < destinations.length) {
      const [platform, kind] = destinations[index];
      return withFileLock(publicationPairLock(reviewId, platform, kind), () => lock(index + 1), { timeoutMs: 250 });
    }
    for (const [platform, kind] of destinations) {
      try { await fs.lstat(publicationJobPath(reviewId, platform, kind)); return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    try {
      const history = await fs.readdir(path.join(publicationStoreRoot(), "history"));
      if (history.some(filename => filename.toLowerCase().startsWith(`${reviewId.toLowerCase()}-`))) return false;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return archive();
  }
  return lock(0);
}
