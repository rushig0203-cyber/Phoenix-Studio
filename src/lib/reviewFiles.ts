import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";

export type ReviewTarget = "instagram" | "youtube";
export type ReviewStatus = "READY" | "NEEDS_RENDERER" | "FAILED";
export type ReviewPublishingFormat = "youtube-full" | "youtube-short" | "instagram-reel";
export type ReviewCreationType = "children-story" | "children-song" | "business" | "general";
export type MonetizationReviewStatus = "NOT_REVIEWED" | "CHECKED" | "NEEDS_CHANGES";

export type ReviewFile = {
  id: string;
  trashedAt?: string;
  editedFrom?: string;
  editableMaster?: boolean;
  artifacts?: import("./reviewArtifacts").ReviewArtifacts;
  captionCues?: Array<{ start: number; end: number; text: string }>;
  /** Retained editor choice; saved cues may exist even when subtitles are off. */
  captionEditing?: { enabled: boolean; position: "top" | "bottom"; size: number; color: string };
  title: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewStatus;
  targets: ReviewTarget[];
  source: {
    kind: "upload" | "pexels" | "pixabay";
    filename: string;
    providerUrl?: string;
    providerMediaId?: string;
    licence: string;
    downloadedAt?: string;
  };
  outputs: Partial<Record<ReviewTarget, { filename: string; duration: number; width: number; height: number }>>;
  quality: {
    subtitles?: { decision: "speech" | "none" | "uncertain"; reason: string };
    postingAnalysis?: {
      status: "QUEUED" | "ANALYZING" | "WAITING" | "FAILED" | "COMPLETE";
      fingerprint?: string; updatedAt: string; attempts: number; nextAttemptAt?: string;
      detail: string; model?: string; sampledAt?: number[]; observations?: string[];
      alignment?: "consistent" | "mismatch" | "unknown"; alignmentReason?: string;
    };
    research?: { source: string; url: string; publishedAt: string; fetchedAt: string; limitation: string };
    editorial?: import("./stockEditorial").EditorialReview;
    managerGuidance?: { revision: string; feedbackCount: number; rules: string[] };
    visualBrief?: string[];
    storyboard?: import("./stockStoryboard").StockShot[];
    sourceDuration?: number;
    audio: "natural-audio-preserved" | "local-music-replaced" | "local-narration-music" | "local-narration" | "supplied-song" | "no-audio" | "needs-review";
    captions: string[];
    hashtags: string[];
    postCopy?: string;
    checks: string[];
    visualSources?: Array<{
      provider: "pexels" | "pixabay";
      providerMediaId: string;
      providerUrl: string;
      creator: string;
      licence: string;
    }>;
    warning?: string;
  };
  audience: "general" | "kids-1-3" | "kids-3-6";
  /**
   * Publishing intent is separate from the rendered output so a YouTube Short
   * and a full YouTube video are not collapsed into the same platform label.
   * Optional because review files created before publishing profiles existed
   * do not contain this block.
   */
  delivery?: {
    publishingFormat: ReviewPublishingFormat;
    platform: ReviewTarget;
    aspect: "9:16" | "16:9" | "1:1" | "original";
    requestedDuration: number;
    actualDuration: number;
    creationType: ReviewCreationType;
    accountHandle?: string;
  };
  /** Original multi-part creations can be grouped without changing legacy IDs. */
  series?: {
    seriesId: string;
    seriesTitle: string;
    episodeNumber: number;
    episodeCount: number;
    episodeBeat?: string;
  };
  /**
   * This is an internal/manual checklist, never a promise that a platform will
   * approve monetization or that a video will earn revenue.
   */
  monetizationReview?: {
    status: MonetizationReviewStatus;
    madeForKids: boolean;
    originality: "original-local" | "licensed-transformed" | "owner-supplied";
    rightsBasis: string;
    checks: string[];
    manualReviewRequired?: boolean;
    syntheticDisclosureReview?: "NOT_APPLICABLE" | "REVIEW_REQUIRED" | "DISCLOSED";
    warning?: string;
  };
  processing?: {
    jobId: string;
    start: number;
    end: number;
    format: "9:16" | "16:9" | "1:1" | "original";
    score: number;
    scoreKind?: "script-checks";
    rank: number;
    reason: string;
    status: "PROCESSING" | "COMPLETED" | "FAILED";
  };
};

const root = path.join(process.cwd(), "storage", "Phoenix Studio Review Files");
const sources = path.join(root, "sources");
const outputs = path.join(root, "outputs");
const indexPath = path.join(root, "index.json");
const indexLockPath = path.join(root, ".index.lock");

export function reviewRoot() { return root; }
export function sourcePath(id: string, filename: string) { return path.join(sources, `${id}-${filename}`); }
export function outputPath(id: string, target: ReviewTarget) { return path.join(outputs, `${id}-${target}.mp4`); }

export function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "video.mp4";
}

export async function ensureReviewFolders() {
  await Promise.all([fs.mkdir(sources, { recursive: true }), fs.mkdir(outputs, { recursive: true })]);
  try {
    await fs.access(indexPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.writeFile(indexPath, "[]\n", { encoding: "utf8", flag: "wx" }).catch((createError) => {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError;
    });
  }
}

export async function readReviewFiles(includeTrash = false): Promise<ReviewFile[]> {
  await ensureReviewFolders();
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Local review index must contain a JSON array.");
    return includeTrash ? parsed : parsed.filter((file: ReviewFile) => !file.trashedAt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeReviewFilesUnlocked(files: ReviewFile[]) {
  await ensureReviewFolders();
  await writeAtomicJson(indexPath, files);
}

export async function saveReviewFile(file: ReviewFile) {
  return withFileLock(indexLockPath, async () => {
    const files = await readReviewFiles(true);
    const index = files.findIndex((item) => item.id === file.id);
    // A worker holding stale metadata must not resurrect an owner's trashed file.
    if (index >= 0 && files[index].trashedAt) return files[index];
    if (index >= 0) files[index] = file; else files.unshift(file);
    await writeReviewFilesUnlocked(files);
    return file;
  });
}

export async function getReviewFile(id: string) {
  return (await readReviewFiles()).find((file) => file.id === id) || null;
}

/** Update only the intended metadata under the index lock; never resurrect a deleted output. */
export async function updateReviewFile(id: string, change: (file: ReviewFile) => ReviewFile) {
  return withFileLock(indexLockPath, async () => {
    const files = await readReviewFiles(true);
    const index = files.findIndex(file => file.id === id && !file.trashedAt);
    if (index < 0) return null;
    files[index] = change(files[index]);
    await writeReviewFilesUnlocked(files);
    return files[index];
  });
}

export async function removeReviewFile(id: string) {
  return withFileLock(indexLockPath, async () => {
    const files = await readReviewFiles(true);
    const file = files.find((item) => item.id === id);
    if (!file) return null;
    if (file.trashedAt) return file;
    // Recoverable removal also avoids deleting media while a player/editor reads it.
    file.trashedAt = new Date().toISOString();
    await writeReviewFilesUnlocked(files);
    return file;
  });
}

export async function restoreReviewFile(id: string) {
  return withFileLock(indexLockPath, async () => {
    const files = await readReviewFiles(true);
    const file = files.find(item => item.id === id);
    if (!file) return null;
    delete file.trashedAt;
    await writeReviewFilesUnlocked(files);
    return file;
  });
}

export function makeReviewFile(input: Omit<ReviewFile, "id" | "createdAt" | "updatedAt" | "status" | "outputs"> & { id?: string; status?: ReviewStatus }) {
  const now = new Date().toISOString();
  const { id, status, ...rest } = input;
  return { ...rest, id: id || crypto.randomUUID(), createdAt: now, updatedAt: now, status: status || "NEEDS_RENDERER", outputs: {} };
}

export function safeReviewId(id: string) { return /^[a-f0-9-]{36}$/i.test(id); }
