import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { renderKidsVideo, type KidsRenderInput } from "./kidsRenderer";
import { withFileLock } from "./fileLock";
import { JobHistoryConflictError } from "./jobHistory";
import { tryWithLocalRenderSlot, retainExternalRender, finishExternalRender, reconcileHeavyLease } from "./renderResources";
import { requireSongAudio } from "./songAudio";
import { inferPublishingFormat, publishingProfile, type PublishingFormat } from "./publishingFormats";
import { socialHandle } from "./socialAccounts";
import { stockVisualBrief, stockNarrationError, checkStockScript } from "./stockBrief";
import { createStockStoryboard, readStockShots, type StockBeat } from "./stockStoryboard";
import { getCreativeGuidance } from "./qualityManager";
import type { CreativeGuidance } from "./managerTypes";
import { generateWritingModel, withWritingSession, isWritingWaitError } from "./writingModel";
import { editStockNarration, stockVoiceRate, stockPostCopy, type EditorialReview, type EditorialAttempt } from "./stockEditorial";
import { newsWritingContext, type NewsResearch } from "./newsResearch";
import { artifactReference, type ReviewArtifacts } from "./reviewArtifacts";
import { parseSrt, validateTimedCaptions } from "./timedCaptions";
import { prepareStockCreation, type StockPreparation } from "./stockPreparation";
import { planCreativeBrief, creativeBriefInstructions, type CreativeBrief } from "./creativeBrief";
import {
  ensureReviewFolders,
  getReviewFile,
  makeReviewFile,
  outputPath,
  readReviewFiles,
  safeFilename,
  saveReviewFile,
} from "./reviewFiles";

export type { PublishingFormat } from "./publishingFormats";

export type GenerationInput = {
  research?: NewsResearch;
  reviewMode?: "final" | "storyboard";
  scriptLocked?: boolean;
  scriptApproved?: boolean;
  sceneNarration?: string[];
  songMode?: "recording" | "local-ace";
  songStyle?: string;
  songAudioId?: string;
  requestId?: string;
  topic: string;
  script?: string;
  scriptOrigin?: "owner" | "local-model";
  editorial?: EditorialReview;
  editorialAttempts?: EditorialAttempt[];
  creativeBrief?: CreativeBrief;
  managerGuidance?: CreativeGuidance;
  rendererProtocol?: 1;
  stockPreparation?: StockPreparation;
  visualTerms?: string[];
  visualTermsOrigin?: "owner" | "local-model";
  storyboard?: StockBeat[];
  language: string;
  duration: number;
  requestedDuration?: number;
  aspect: "9:16" | "16:9";
  voice: string;
  subtitleStyle: string;
  visualSource: "stock" | "local-ai" | "both";
  targetPlatform: "Instagram" | "YouTube";
  publishingFormat?: PublishingFormat;
  creationType?: "children-story" | "children-song" | "business" | "general";
  audienceAge?: "3-6";
  seriesId?: string;
  seriesTitle?: string;
  episodeNumber?: number;
  episodeCount?: number;
  episodeBeat?: string;
};

type AttemptRecord = { at: string; attempt: number; error: string };

export type LocalGenerationJob = {
  id: string;
  projectId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  archivedAt?: string;
  progress: number;
  stage: string;
  providerTaskId?: string;
  resourceReleasedTaskId?: string;
  requestKey?: string;
  pollFailureCount?: number;
  providerLeaseOwner?: string;
  providerLeaseExpiresAt?: string;
  localRenderLeaseOwner?: string;
  localRenderLeaseExpiresAt?: string;
  submissionUncertainSince?: string;
  requestJson: string;
  error?: string;
  duration: number;
  requestedDuration?: number;
  retryCount: number;
  manualRetryCount?: number;
  attempts?: AttemptRecord[];
  nextAttemptAt?: string;
  queuedAt: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
  project: { title: string };
};

type ProbeResult = { duration: number; width: number; height: number; hasAudio: boolean };

const root = path.join(process.cwd(), "storage", "Phoenix Studio Review Files");
const jobsPath = path.join(root, "ai-creation-jobs.json");
const jobsLockPath = path.join(root, ".ai-creation-jobs.lock");
const ffprobe = process.env.PHOENIX_FFPROBE_PATH?.trim() || path.join(
  process.cwd(),
  "node_modules",
  "@ffprobe-installer",
  `${process.platform}-${process.arch}`,
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
);
const execFileAsync = promisify(execFile);
const MAX_LOCAL_RENDER_BYTES = 2 * 1024 * 1024 * 1024;
const PROCESS_OWNER = `${process.pid}-${crypto.randomUUID()}`;
const PROVIDER_LEASE_MS = 3 * 60 * 1000;
const LOCAL_RENDER_LEASE_MS = 2 * 60 * 1000;

function providerBase() {
  const configured = process.env.MPT_BASE_URL?.replace(/\/$/, "");
  if (!configured) throw new Error("The optional free stock-video renderer is not configured.");
  const url = new URL(configured);
  if (!["127.0.0.1", "localhost", "::1", "host.docker.internal"].includes(url.hostname)) {
    throw new Error("Free mode only permits a MoneyPrinter service running on this PC.");
  }
  return url;
}

const providerUrl = (route: string) => new URL(route.startsWith("/") ? route : `/${route}`, providerBase()).toString();
const providerHeaders = (requestId?: string) => ({
  "Content-Type": "application/json",
  ...(process.env.MPT_API_TOKEN ? { "x-api-key": process.env.MPT_API_TOKEN } : {}),
  ...(requestId ? { "x-task-id": requestId } : {}),
});

function absoluteProviderUrl(value: string) {
  const base = providerBase();
  const result = new URL(value, base);
  if (result.origin !== base.origin) {
    throw new Error("The local stock renderer returned a non-local download URL, which free mode rejected.");
  }
  return result.toString();
}

class SubmissionUncertainError extends Error {}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findProviderTask(requestId: string, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(providerUrl("/api/v1/tasks?page=1&page_size=100"), {
        headers: providerHeaders(),
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        const payload = await response.json();
        const tasks = payload?.data?.tasks;
        if (Array.isArray(tasks)) {
          const match = tasks.find((task: { request_id?: string; task_id?: string }) => task.request_id === requestId);
          if (match?.task_id) return String(match.task_id);
        }
      }
    } catch {
      // The next bounded reconciliation attempt may still succeed.
    }
    if (attempt + 1 < attempts) await delay(1_000);
  }
  return undefined;
}

async function ensureJobsFile() {
  await ensureReviewFolders();
  try {
    await fs.access(jobsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.writeFile(jobsPath, "[]\n", { encoding: "utf8", flag: "wx" }).catch((createError) => {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError;
    });
  }
}

async function readJobsUnlocked(): Promise<LocalGenerationJob[]> {
  await ensureJobsFile();
  const parsed = JSON.parse(await fs.readFile(jobsPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Local AI job store must contain a JSON array.");
  return parsed.map((job) => ({ ...job, queuedAt: job.queuedAt || job.createdAt }));
}

async function writeJobsUnlocked(jobs: LocalGenerationJob[]) {
  await ensureJobsFile();
  const temporary = `${jobsPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await fs.rename(temporary, jobsPath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  await fs.rm(temporary, { force: true }).catch(() => undefined);
  throw lastError;
}

async function mutateJobs<T>(mutation: (jobs: LocalGenerationJob[]) => Promise<T> | T) {
  return withFileLock(jobsLockPath, async () => {
    const jobs = await readJobsUnlocked();
    const result = await mutation(jobs);
    await writeJobsUnlocked(jobs);
    return result;
  });
}

function withTiming(job: LocalGenerationJob): LocalGenerationJob {
  const active = job.status === "RUNNING";
  // A retry/regeneration is a new processing attempt. Measuring from createdAt
  // made a 30-second rerender look hours old and produced wildly incorrect ETAs.
  const startValue = job.startedAt || job.queuedAt || job.createdAt;
  const start = new Date(startValue).getTime();
  const settled = job.status === "COMPLETED" || job.status === "FAILED";
  const end = job.finishedAt
    ? new Date(job.finishedAt).getTime()
    : settled
      ? new Date(job.updatedAt).getTime()
      : Date.now();
  const elapsedSeconds = start ? Math.max(0, Math.round((end - start) / 1000)) : 0;
  let estimatedRemainingSeconds: number | undefined;
  if (active && job.progress > 1) {
    let input: GenerationInput | undefined;
    try {
      input = JSON.parse(job.requestJson) as GenerationInput;
    } catch {
      // Legacy jobs can keep the generic progress-based estimate below.
    }
    const children = input?.creationType === "children-story" || input?.creationType === "children-song";
    if (children) {
      const duration = Number(input?.duration || 60);
      // Local writing and voice work dominate the first stages, while FFmpeg
      // encodes faster than real time. A linear 8%-complete estimate therefore
      // turns a one-minute video into a fake multi-hour wait.
      if (job.progress < 24) {
        estimatedRemainingSeconds = Math.max(30, Math.round(90 + duration * 0.8 - elapsedSeconds));
      } else if (job.progress < 38) {
        estimatedRemainingSeconds = Math.max(25, Math.round(30 + duration * 0.45));
      } else if (job.progress < 58) {
        estimatedRemainingSeconds = Math.max(20, Math.round(15 + duration * 0.45));
      } else if (job.progress < 92) {
        estimatedRemainingSeconds = Math.max(5, Math.round(((92 - job.progress) / 34) * duration * 0.45 + 5));
      } else {
        estimatedRemainingSeconds = 5;
      }
    } else {
      estimatedRemainingSeconds = Math.max(1, Math.round((elapsedSeconds * (100 - job.progress)) / job.progress));
    }
  }
  return { ...job, elapsedSeconds, estimatedRemainingSeconds };
}

export async function listGenerationJobs(): Promise<LocalGenerationJob[]> {
  return (await readJobsUnlocked()).filter((job) => !job.archivedAt).map(withTiming);
}

/** Keep a tombstone so stale retries and duplicate submissions cannot restore removed jobs. */
export async function removeGenerationJob(id: string) {
  return mutateJobs((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) return null;
    const job = jobs[index];
    if (job.archivedAt) return job;
    if (job.status === "RUNNING") {
      throw new JobHistoryConflictError("This video is rendering. It can be removed from the manager after it finishes or fails.");
    }
    const now = new Date().toISOString();
    jobs[index] = {
      ...job,
      status: job.status === "QUEUED" ? "CANCELLED" : job.status,
      stage: job.status === "QUEUED" ? "Cancelled before rendering" : job.stage,
      archivedAt: now,
      finishedAt: job.finishedAt || now,
      updatedAt: now,
      nextAttemptAt: undefined,
      providerLeaseOwner: undefined,
      providerLeaseExpiresAt: undefined,
      localRenderLeaseOwner: undefined,
      localRenderLeaseExpiresAt: undefined,
    };
    return jobs[index];
  });
}

async function updateJob(id: string, change: Partial<LocalGenerationJob>, resetProgress = false) {
  return mutateJobs((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].archivedAt || jobs[index].status === "CANCELLED") return null;
    const current = jobs[index];
    const progress = change.progress === undefined
      ? current.progress
      : resetProgress
        ? change.progress
        : Math.max(current.progress, change.progress);
    jobs[index] = { ...current, ...change, progress, updatedAt: new Date().toISOString() };
    return jobs[index];
  });
}

function isChildrenGenerationJob(job: LocalGenerationJob) {
  try {
    const input = JSON.parse(job.requestJson) as GenerationInput;
    return input.creationType === "children-story" || input.creationType === "children-song";
  } catch {
    return false;
  }
}

async function claimQueuedJob() {
  return mutateJobs((jobs) => {
    const now = Date.now();
    const childrenRenderAlreadyRunning = jobs.some((job) => job.status === "RUNNING" && isChildrenGenerationJob(job));
    const candidate = jobs
      .filter((job) =>
        !job.archivedAt && job.status === "QUEUED" &&
        (!job.nextAttemptAt || new Date(job.nextAttemptAt).getTime() <= now) &&
        !(childrenRenderAlreadyRunning && isChildrenGenerationJob(job))
      )
      .sort((left, right) => new Date(left.queuedAt).getTime() - new Date(right.queuedAt).getTime())[0];
    if (!candidate) return null;
    const index = jobs.findIndex((job) => job.id === candidate.id);
    const startedAt = new Date().toISOString();
    jobs[index] = {
      ...candidate,
      status: "RUNNING",
      progress: Math.max(1, candidate.progress),
      stage: candidate.retryCount ? `Starting local attempt ${candidate.retryCount + 1} of 3` : "Starting local creation",
      error: undefined,
      nextAttemptAt: undefined,
      startedAt,
      finishedAt: undefined,
      ...(isChildrenGenerationJob(candidate) ? {
        localRenderLeaseOwner: PROCESS_OWNER,
        localRenderLeaseExpiresAt: new Date(now + LOCAL_RENDER_LEASE_MS).toISOString(),
      } : {}),
      updatedAt: startedAt,
    };
    return jobs[index];
  });
}

export const isGeneratorConfigured = () => Boolean(process.env.MPT_BASE_URL);

export async function requireStockStoryboardRenderer(approvedFootage = false) {
  const response = await fetch(providerUrl("/openapi.json"), { headers: providerHeaders(), signal: AbortSignal.timeout(8_000) });
  const api = response.ok ? await response.json() : null;
  if (!api?.components?.schemas?.TaskVideoRequest?.properties?.phoenix_storyboard) {
    throw new Error("The local stock renderer needs the Phoenix storyboard update. Apply the integrations patch and restart MoneyPrinterTurbo before creating a stock video.");
  }
  if (approvedFootage && !api?.components?.schemas?.PhoenixStoryBeat?.properties?.assetId) throw new Error("Restart the local renderer with the approved-footage update before rendering. Phoenix will not ignore your selected clips.");
  if (!api?.components?.schemas?.TaskVideoRequest?.properties?.phoenix_artifacts_version) throw new Error("The local renderer needs the editable-artifacts update. Apply the current integrations patch and restart it before creating a video; existing exports are retained.");
}

export async function generatorReachable() {
  try {
    const response = await fetch(providerUrl("/api/v1/tasks?page=1&page_size=1"), {
      headers: providerHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function normalizeGenerationInput(input: GenerationInput): GenerationInput {
  const publishingFormat = inferPublishingFormat(input);
  const profile = publishingProfile(publishingFormat);
  return {
    ...input,
    publishingFormat,
    requestedDuration: input.requestedDuration ?? input.duration,
    aspect: profile.aspect,
    targetPlatform: profile.platform,
  };
}

function makeGenerationJob(rawInput: GenerationInput, requestKey = rawInput.requestId) {
  const input = normalizeGenerationInput(rawInput);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    id,
    projectId: id,
    status: "QUEUED",
    progress: 0,
    stage: "Queued for local creation",
    requestKey,
    requestJson: JSON.stringify(input),
    duration: input.duration,
    requestedDuration: input.requestedDuration ?? input.duration,
    retryCount: 0,
    queuedAt: now,
    createdAt: now,
    updatedAt: now,
    project: { title: input.topic },
  } satisfies LocalGenerationJob;
}

export async function createGenerationJobs(_userId: string, inputs: GenerationInput[]) {
  if (!inputs.length) throw new Error("At least one local creation request is required.");
  const normalizedInputs = inputs.map(normalizeGenerationInput);
  const batchRequestId = normalizedInputs[0].requestId;
  const requestKeys = normalizedInputs.map((input, index) =>
    inputs.length > 1 && batchRequestId ? `${batchRequestId}:${index + 1}` : input.requestId
  );
  const created = normalizedInputs.map((input, index) => makeGenerationJob(input, requestKeys[index]));
  return mutateJobs((jobs) => {
    if (batchRequestId) {
      const existing = jobs.filter((candidate) =>
        candidate.requestKey === batchRequestId || candidate.requestKey?.startsWith(`${batchRequestId}:`)
      );
      if (existing.some((job) => job.archivedAt || job.status === "CANCELLED")) {
        throw new JobHistoryConflictError("This request was removed from the manager. Start a new creation to create another video.");
      }
      if (existing.length) return existing;
    }
    jobs.push(...created);
    return created;
  });
}

export async function createGenerationJob(userId: string, input: GenerationInput) {
  return (await createGenerationJobs(userId, [input]))[0];
}

export async function retryGenerationJob(id: string) {
  return mutateJobs((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].archivedAt || jobs[index].status === "CANCELLED") return null;
    const job = jobs[index];
    if (job.status !== "FAILED") throw new Error("Only failed jobs can be retried.");
    const now = new Date().toISOString();
    const rendererTaskIsMissing = /\(404\)|no longer exists|was lost/i.test(job.error || "");
    if (job.providerTaskId && !rendererTaskIsMissing) {
      jobs[index] = {
        ...job,
        status: "RUNNING",
        progress: Math.max(18, job.progress),
        stage: "Reconnecting to the existing local stock render",
        error: undefined,
        pollFailureCount: 0,
        manualRetryCount: (job.manualRetryCount || 0) + 1,
        nextAttemptAt: undefined,
        providerLeaseOwner: undefined,
        providerLeaseExpiresAt: undefined,
        localRenderLeaseOwner: undefined,
        localRenderLeaseExpiresAt: undefined,
        updatedAt: now,
        finishedAt: undefined,
      };
      return jobs[index];
    }
    jobs[index] = {
      ...job,
      status: "QUEUED",
      progress: 0,
      stage: rendererTaskIsMissing
        ? "Renderer restarted; safely queued as a new local render"
        : "Manually queued for another local attempt",
      providerTaskId: undefined,
      pollFailureCount: 0,
      submissionUncertainSince: undefined,
      providerLeaseOwner: undefined,
      providerLeaseExpiresAt: undefined,
      localRenderLeaseOwner: undefined,
      localRenderLeaseExpiresAt: undefined,
      error: undefined,
      retryCount: 0,
      manualRetryCount: (job.manualRetryCount || 0) + 1,
      nextAttemptAt: undefined,
      queuedAt: now,
      updatedAt: now,
      startedAt: undefined,
      finishedAt: undefined,
    };
    return jobs[index];
  });
}

export async function regenerateGenerationJob(id: string) {
  return mutateJobs(async (jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].archivedAt) return null;
    if (jobs[index].status !== "COMPLETED") throw new Error("Only completed AI creations can be regenerated.");
    const input = JSON.parse(jobs[index].requestJson) as GenerationInput;
    if (input.creationType === "children-song") {
      await requireSongAudio(input.songAudioId, input.duration);
      if (!input.script?.trim()) throw new Error("Open AI Creation and add the lyrics from your recording.");
    }
    const requestKey = `regenerate:${id}`;
    if (input.creationType === "business" || input.creationType === "general") {
      // Unknown legacy text is retained to avoid discarding an owner's words.
      if (input.scriptOrigin === "local-model") delete input.script;
      if (input.visualTermsOrigin === "local-model") delete input.visualTerms;
      delete input.storyboard;
      delete input.stockPreparation;
      delete input.editorial;
    }
    const pending = jobs.find(job => job.requestKey === requestKey && !job.archivedAt && ["QUEUED", "RUNNING"].includes(job.status));
    if (pending) return pending;
    // A failed replacement must never remove the user's finished original.
    const replacement = makeGenerationJob({ ...input, requestId: crypto.randomUUID() }, requestKey);
    replacement.stage = "Queued as a new copy; original video retained";
    jobs.push(replacement);
    return replacement;
  });
}

function topicTerms(topic: string) {
  const stop = new Set(["about", "after", "also", "and", "are", "back", "been", "being", "but", "can", "could", "ever", "for", "from", "had", "has", "have", "hey", "how", "into", "its", "just", "like", "not", "our", "out", "that", "the", "their", "them", "then", "there", "these", "they", "this", "three", "through", "too", "very", "was", "ways", "welcome", "were", "what", "when", "where", "which", "who", "will", "with", "would", "you", "your"]);
  return [...new Set(topic.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])]
    .filter((term) => !stop.has(term))
    .slice(0, 8);
}

function stockSearchTerms(input: GenerationInput) {
  return stockVisualBrief(input.topic, input.script || "", input.visualTerms);
}

function captionLines(script?: string) {
  const words = String(script || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  for (let index = 0; index < words.length; index += 8) lines.push(words.slice(index, index + 8).join(" "));
  return lines.slice(0, 100);
}

function topicHashtags(topic: string, type?: GenerationInput["creationType"]) {
  return [
    "#PhoenixStudio",
    type === "business" ? "#BusinessTips" : "#LearnSomething",
    ...topicTerms(topic).map((word) => `#${word[0].toUpperCase()}${word.slice(1)}`),
  ].slice(0, 9);
}

function publishingFormatFor(input: GenerationInput) {
  return inferPublishingFormat(input);
}

function validatePublishingOutput(input: GenerationInput, media: ProbeResult) {
  const format = publishingFormatFor(input);
  const profile = publishingProfile(format);
  const isVertical = media.height > media.width;
  const correctAspect = profile.aspect === "9:16" ? isVertical : media.width > media.height;
  if (!correctAspect) {
    throw new Error(`Rendered video is ${media.width}x${media.height}, but ${profile.label} requires ${profile.aspect}.`);
  }
  if (media.duration < profile.minDuration - 1 || media.duration > profile.maxDuration + 1) {
    throw new Error(`Rendered video is ${media.duration.toFixed(1)} seconds, but ${profile.label} requires ${profile.minDuration}–${profile.maxDuration} seconds.`);
  }
  return { format, profile };
}

function seriesMetadata(input: GenerationInput) {
  if (!input.seriesId || !input.seriesTitle || !input.episodeNumber || !input.episodeCount) return undefined;
  return {
    seriesId: input.seriesId,
    seriesTitle: input.seriesTitle,
    episodeNumber: input.episodeNumber,
    episodeCount: input.episodeCount,
    episodeBeat: input.episodeBeat,
  };
}

function contentWordSet(value: string) {
  return new Set((value.toLowerCase().match(/[a-z]{3,}/g) || []).filter((word) => !["the", "and", "with", "that", "they", "their", "then"].includes(word)));
}

function wordSetSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(1, new Set([...left, ...right]).size);
}

async function highestSeriesSimilarity(seriesId: string | undefined, captions: string[]) {
  if (!seriesId) return 0;
  const current = contentWordSet(captions.join(" "));
  const earlier = (await readReviewFiles()).filter((file) => file.series?.seriesId === seriesId);
  return earlier.reduce((highest, file) => Math.max(highest, wordSetSimilarity(current, contentWordSet(file.quality.captions.join(" ")))), 0);
}

async function rerankCompletedSeries(seriesId?: string) {
  if (!seriesId) return;
  const files = (await readReviewFiles())
    .filter((file) => file.status === "READY" && file.series?.seriesId === seriesId && file.processing)
    .sort((left, right) => {
      const scoreDifference = (right.processing?.score || 0) - (left.processing?.score || 0);
      return scoreDifference || (left.series?.episodeNumber || 0) - (right.series?.episodeNumber || 0);
    });
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (!file.processing || file.processing.rank === index + 1) continue;
    file.processing.rank = index + 1;
    await saveReviewFile(file);
  }
}

async function renewLocalRenderLease(id: string) {
  return mutateJobs((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].localRenderLeaseOwner !== PROCESS_OWNER || jobs[index].status !== "RUNNING") return false;
    jobs[index].localRenderLeaseExpiresAt = new Date(Date.now() + LOCAL_RENDER_LEASE_MS).toISOString();
    jobs[index].updatedAt = new Date().toISOString();
    return true;
  });
}

async function releaseLocalRenderLease(id: string) {
  return mutateJobs((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].localRenderLeaseOwner !== PROCESS_OWNER) return false;
    jobs[index].localRenderLeaseOwner = undefined;
    jobs[index].localRenderLeaseExpiresAt = undefined;
    jobs[index].updatedAt = new Date().toISOString();
    return true;
  });
}

function cleanScript(value: string) {
  return value
    .replace(/```[a-z]*|```/gi, "")
    .replace(/^\s*(script|narration|voiceover)\s*:\s*/i, "")
    .replace(/^\s*[-*#]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value: string) {
  return value.match(/\b[\p{L}\p{N}'-]+\b/gu)?.length || 0;
}

export function fitStockScriptToDuration(value: string, duration: number) {
  const cleaned = cleanScript(value);
  // Never discard the payoff to fit a word budget. The editor must rewrite
  // the whole story or fail explicitly, rather than return its first N words.
  return stockNarrationError(cleaned, duration) ? "" : cleaned;
}

export async function createStockScript(input: GenerationInput, onStage: (stage: string) => Promise<unknown> = async () => {}) {
  const researchContext = newsWritingContext(input.research);
  if (input.script?.trim() && (input.scriptOrigin !== "local-model" || input.scriptApproved)) {
    const script = cleanScript(input.script);
    const error = stockNarrationError(script, input.duration);
    if (error) throw new Error(error);
    return script;
  }
  return withWritingSession(async () => {
  const targetWords = Math.max(125, Math.min(600, Math.round(input.duration * 2.78)));
  const guidance = await getCreativeGuidance(input.creationType);
  input.managerGuidance = guidance;
  const prompt = `Write an original ${input.creationType === "business" ? "practical business" : "educational general-interest"} social-video narration about: ${input.topic}\nTarget ${targetWords} words (within 10%). Follow the chosen outline and answer its actual viewer question. Use the selected structure rather than turning every subject into a fictional character story. Each beat adds a distinct useful detail and follows logically from the previous one. Start with the concrete problem or useful detail immediately. Preserve the complete promised payoff. Explain why rather than merely listing things. Use short spoken sentences and specific examples where helpful. Maintain a coherent setting when depicting a continuing action, but do not force every comparison or explanation into one setting. Plain spoken English only. No greetings, headings, lists, hashtags, stage directions, unsupported statistics, invented citations, financial promises, marketing filler or copied slogans. The outline is planning DATA: do not speak its labels or visual instructions.`;
  try {
    let rawScript = cleanScript(input.script || "");
    if (!rawScript) {
    await onStage("Considering three useful angles and planning the complete payoff");
    input.creativeBrief = await planCreativeBrief({ ...input, feedbackRevision: guidance.revision, guidance: guidance.rules, saved: input.creativeBrief });
    await onStage("Creative brief saved — writing the selected explanation and complete ending");
    const response = await generateWritingModel({
        model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
        prompt: `${prompt}\nSelected outline: ${creativeBriefInstructions(input.creativeBrief)}\nImprovements from your structured reviews: ${guidance.rules.join(" ") || "Keep useful specifics and a coherent explanation."}${researchContext}`,
        options: { temperature: 0.55, num_predict: Math.ceil(targetWords * 2.35) + 64, num_thread: 2, num_ctx: 4096 },
      }, { timeoutMs: Math.max(150_000, input.duration * 1_200) });
    if (!response.ok) throw new Error(`The selected writer returned ${response.status}`);
    rawScript = cleanScript(String((await response.json()).response || ""));
    if (countWords(rawScript) < 40) throw new Error("Local script was incomplete");
    // Persist completed writing before the next admission check. A resource wait
    // in the editor should resume this draft, not ask the writer to replace it.
    input.script = rawScript;
    input.scriptOrigin = "local-model";
    await onStage("Narration saved — preparing the editorial check");
    }
    if (countWords(rawScript) < 40) throw new Error("Local script was incomplete");
    const { script, editorial } = await editStockNarration({ ...input, script: rawScript, feedbackRevision: guidance.revision, guidanceRules: guidance.rules, briefInstructions: input.creativeBrief ? creativeBriefInstructions(input.creativeBrief) : undefined }, onStage, async attempt => {
      input.editorialAttempts = [...(input.editorialAttempts || []), attempt].slice(-20);
      if (input.script && input.script !== attempt.script) {
        input.storyboard = undefined;
        input.stockPreparation = undefined;
        if (input.visualTermsOrigin === "local-model") input.visualTerms = undefined;
      }
      input.script = attempt.script;
      input.scriptOrigin = "local-model";
      await onStage(attempt.error ? "Editorial attempt saved — local review needs attention" : "Editorial evidence and narration saved");
    });
    input.editorial = editorial;
    if (input.script && script !== input.script) {
      input.storyboard = undefined;
      if (input.visualTermsOrigin === "local-model") input.visualTerms = undefined;
    }
    return script;
  } catch (error) {
    if (isWritingWaitError(error)) throw error;
    throw new Error(`Narration needs another attempt: ${error instanceof Error ? error.message : String(error)}. No generic replacement script was used. Retry, or supply your own narration in Create a video.`);
  }
  });
}

async function replaceFile(temporary: string, destination: string) {
  await fs.rm(destination, { force: true });
  await fs.rename(temporary, destination);
}

async function copyFileAtomically(source: string, destination: string) {
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await fs.copyFile(source, temporary);
  await replaceFile(temporary, destination);
}

async function downloadLocalOutput(url: string, destination: string, maximumBytes = MAX_LOCAL_RENDER_BYTES) {
  const response = await fetch(absoluteProviderUrl(url), {
    headers: providerHeaders(),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error("The local stock-video render could not be downloaded.");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error("The local renderer artifact exceeded its size limit.");
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maximumBytes) callback(new Error("The local renderer artifact exceeded its size limit."));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as never), counter, fsSync.createWriteStream(temporary));
    await replaceFile(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function probeVideo(file: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", file,
  ], { timeout: 30_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find((stream: { codec_type?: string }) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream: { codec_type?: string }) => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration || video?.duration || 0);
  const width = Number(video?.width || 0);
  const height = Number(video?.height || 0);
  if (!video || !audio || !Number.isFinite(duration) || duration < 5 || !width || !height) {
    throw new Error("The local stock renderer output failed video/audio validation.");
  }
  return { duration, width, height, hasAudio: Boolean(audio) };
}

async function existingReadyOutput(job: LocalGenerationJob, input: GenerationInput) {
  const review = await getReviewFile(job.id);
  if (!review || review.status !== "READY") return false;
  const target = input.targetPlatform === "YouTube" ? "youtube" : "instagram";
  try {
    const media = await probeVideo(outputPath(review.id, target));
    validatePublishingOutput(input, media);
    await updateJob(job.id, {
      status: "COMPLETED",
      progress: 100,
      stage: "Existing validated result restored",
      error: undefined,
      finishedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function retainStockArtifacts(id: string, destination: string, media: ProbeResult, raw: unknown) {
  const data = raw as { version?: unknown; clean_video?: unknown; caption_file?: unknown; narration_file?: unknown; music_present?: unknown; music_file?: unknown; caption_count?: unknown } | undefined;
  if (!data || data.version !== 1 || typeof data.clean_video !== "string" || typeof data.caption_file !== "string" || typeof data.narration_file !== "string" || typeof data.music_present !== "boolean" || (data.music_present && typeof data.music_file !== "string")) throw new Error("The local renderer did not return required clean-video, caption and audio artifacts. Retry after updating the renderer; no falsely complete review was created.");
  const directory = path.join(root, "work", `stock-${id}`);
  await fs.mkdir(directory, { recursive: true });
  const clean = path.join(directory, "clean.mp4"), captions = path.join(directory, "captions.srt"), narration = path.join(directory, "narration.mp3");
  await downloadLocalOutput(data.clean_video, clean);
  const master = await probeVideo(clean);
  if (!master.hasAudio || master.width !== media.width || master.height !== media.height || Math.abs(master.duration - media.duration) > .2) throw new Error("Clean stock master does not match the finished video's duration, dimensions or audio.");
  await downloadLocalOutput(data.caption_file, captions, 2 * 1024 * 1024);
  const cues = validateTimedCaptions(parseSrt(await fs.readFile(captions, "utf8")), media.duration);
  if (data.caption_count !== cues.length) throw new Error("Saved captions do not match the renderer's reported caption artifact.");
  await downloadLocalOutput(data.narration_file, narration, 64 * 1024 * 1024);
  const requireAudio = async (filename: string) => {
    const { stdout } = await execFileAsync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", filename], { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(stdout);
    if (!probe.streams?.some((stream: { codec_type: string }) => stream.codec_type === "audio") || !(Number(probe.format?.duration) > 0)) throw new Error("The renderer returned an invalid narration or music artifact.");
  };
  await requireAudio(narration);
  const music = data.music_present ? path.join(directory, "music-source.audio") : undefined;
  if (music) { await downloadLocalOutput(data.music_file as string, music, 128 * 1024 * 1024); await requireAudio(music); }
  const artifacts: ReviewArtifacts = { version: 1, renderRevision: "stock-artifacts-v1", finalVideo: artifactReference(destination), editing: { video: artifactReference(clean), offsetSeconds: 0, captionsBaked: false }, captions: artifactReference(captions), narration: artifactReference(narration), music: music ? artifactReference(music) : undefined };
  return { artifacts, cues, musicPresent: data.music_present };
}

async function completeStockJob(job: LocalGenerationJob, input: GenerationInput, videoUrl: string, shots?: unknown, artifacts?: unknown) {
  const target = input.targetPlatform === "YouTube" ? "youtube" : "instagram";
  const accountHandle = target === "instagram" ? socialHandle("instagram") : undefined;
  const destination = outputPath(job.id, target);
  await updateJob(job.id, { progress: 92, stage: "Saving and validating the local stock render" });
  await downloadLocalOutput(videoUrl, destination);
  const media = await probeVideo(destination);
  const { format } = validatePublishingOutput(input, media);
  const retained = input.rendererProtocol === 1 || artifacts ? await retainStockArtifacts(job.id, destination, media, artifacts) : undefined;
  const review = makeReviewFile({
    id: job.id,
    title: input.topic.slice(0, 120),
    targets: [target],
    source: { kind: "pexels", filename: safeFilename(`stock-${job.id}.mp4`), licence: "Pexels free stock footage assembled by the local MoneyPrinterTurbo service" },
    audience: "general",
    quality: {
      audio: retained ? retained.musicPresent ? "local-narration-music" : "local-narration" : "needs-review",
      captions: retained ? retained.cues.map(cue => cue.text) : captionLines(input.script),
      hashtags: topicHashtags(input.topic, input.creationType),
      postCopy: stockPostCopy(input.script || "", input.topic) + (input.research ? `\nReport: ${input.research.source}, ${input.research.publishedAt.slice(0, 10)} — ${input.research.url}\nIllustrative stock footage; not footage of this event. Single-source summary; verify developments before posting.` : ""),
      research: input.research ? { source: input.research.source, url: input.research.url, publishedAt: input.research.publishedAt, fetchedAt: input.research.fetchedAt, limitation: input.research.limitation } : undefined,
      editorial: input.editorial,
      managerGuidance: input.managerGuidance,
      checks: [input.scriptOrigin === "owner" ? "Owner narration preserved" : "Model-written narration with no generic fallback", ...(input.editorial?.checks || []), "Free Pexels footage searched in visual-brief order", "Video and audio streams validated", retained ? "Actual timed captions and clean narrated master retained" : "Legacy render: caption and music artifacts were not verified", "No paid AI video provider used"],
      visualBrief: stockSearchTerms(input),
      storyboard: input.storyboard?.length ? readStockShots(shots, media.duration) : undefined,
      warning: `${input.research ? input.research.limitation + " " : ""}${retained && !retained.musicPresent ? "Background music was not mixed successfully; narration is retained. " : !retained ? "Legacy caption/music status needs manual review. " : ""}Stock search is keyword-based, not visual understanding. Review every shot against the narration before posting.`,
    },
    processing: { jobId: job.id, start: 0, end: media.duration, format: input.aspect, score: checkStockScript(input.topic, input.script || "", input.duration).score, scoreKind: "script-checks", rank: 0, reason: checkStockScript(input.topic, input.script || "", input.duration).reason, status: "COMPLETED" },
    delivery: {
      publishingFormat: format,
      platform: target,
      aspect: input.aspect,
      requestedDuration: input.requestedDuration ?? input.duration,
      actualDuration: media.duration,
      creationType: input.creationType || "general",
      accountHandle,
    },
    monetizationReview: {
      status: "NOT_REVIEWED",
      madeForKids: false,
      originality: "licensed-transformed",
      rightsBasis: "Pexels free-stock footage with an original local script, narration, music, captions, and edit.",
      checks: ["Confirm every stock clip still matches its provider licence", "Watch the complete export for factual and visual accuracy", "Confirm title, thumbnail, and upload copy are original"],
      manualReviewRequired: true,
      syntheticDisclosureReview: "REVIEW_REQUIRED",
      warning: "Licensed footage alone does not guarantee monetization. Complete the manual originality and rights review before posting.",
    },
  });
  review.outputs = { [target]: { filename: path.basename(destination), duration: media.duration, width: media.width, height: media.height } };
  review.artifacts = retained?.artifacts;
  review.captionCues = retained?.cues;
  review.editableMaster = !!retained;
  review.status = "READY";
  await saveReviewFile(review);
  await updateJob(job.id, { status: "COMPLETED", progress: 100, stage: "Stock video ready for review", duration: media.duration, error: undefined, finishedAt: new Date().toISOString() });
}

async function runChildrenJob(job: LocalGenerationJob, input: GenerationInput) {
  if (await existingReadyOutput(job, input)) return;
  const creationType = input.creationType as KidsRenderInput["creationType"];
  const episodeLabel = input.episodeNumber && input.episodeCount
    ? `Part ${input.episodeNumber} of ${input.episodeCount} · `
    : "";
  await updateJob(job.id, { progress: 2, stage: `${episodeLabel}starting free local children renderer`, error: undefined });
  const result = await renderKidsVideo(job.id, {
    songMode: input.songMode,
    scriptApproved: input.scriptApproved,
    scriptLocked: input.scriptLocked,
    sceneNarration: input.sceneNarration,
    songAudioId: input.songAudioId,
    topic: input.topic,
    duration: input.duration,
    publishingFormat: input.publishingFormat,
    targetPlatform: input.targetPlatform,
    creationType,
    script: input.script,
    voice: input.voice,
    aspect: input.aspect,
    seriesId: input.seriesId,
    seriesTitle: input.seriesTitle,
    episodeNumber: input.episodeNumber,
    episodeCount: input.episodeCount,
    episodeBeat: input.episodeBeat,
  }, async (progress, stage) => updateJob(job.id, { progress, stage: `${episodeLabel}${stage}` }));
  const similarity = await highestSeriesSimilarity(input.seriesId, result.captions);
  const tooSimilarToEarlierPart = similarity >= 0.72;
  const target = input.targetPlatform === "YouTube" ? "youtube" : "instagram";
  const accountHandle = target === "instagram" ? socialHandle("instagram") : undefined;
  const destination = outputPath(job.id, target);
  await copyFileAtomically(result.file, destination);
  const media = await probeVideo(destination);
  const { format } = validatePublishingOutput(input, media);
  const review = makeReviewFile({
    id: job.id,
    title: input.topic.slice(0, 120),
    targets: [target],
    source: result.visualMode === "pixabay-animation"
      ? {
          kind: "pixabay",
          filename: safeFilename(`local-cartoon-${job.id}.mp4`),
          providerUrl: result.visualSources[0]?.pageUrl,
          providerMediaId: result.visualSources[0] ? String(result.visualSources[0].id) : undefined,
          licence: "Pixabay Content License backgrounds transformed with original Phoenix characters, script, vocals, music, captions, and editing",
          downloadedAt: new Date().toISOString(),
        }
      : { kind: "upload", filename: safeFilename(`local-cartoon-${job.id}.mp4`), licence: input.songMode === "local-ace" ? "Original local animation with ACE-Step generated music and singing; review audio originality before publishing" : input.songAudioId ? "Original local animation with user-supplied song audio; user must hold audio rights" : "Original local cartoon rendered with Ollama, Windows voice, and FFmpeg" },
    audience: "kids-3-6",
    quality: {
      audio: input.songAudioId ? "supplied-song" : "local-narration-music",
      managerGuidance: result.managerGuidance,
      captions: result.captions,
      hashtags: input.episodeNumber ? [...new Set([...result.hashtags, `#Part${input.episodeNumber}`])].slice(0, 10) : result.hashtags,
      postCopy: input.episodeNumber && input.episodeCount
        ? `${input.seriesTitle} · Part ${input.episodeNumber} of ${input.episodeCount}. ${result.postCopy}${accountHandle ? ` Prepared for ${accountHandle}.` : ""}`
        : `${result.postCopy}${accountHandle ? ` Prepared for ${accountHandle}.` : ""}`,
      checks: [
        input.songMode === "local-ace" ? "Approved lyrics sent to local ACE-Step; listen for pronunciation and missing words" : input.songAudioId ? "User-supplied lyrics retained for the recording" : "Original topic-matched script created locally",
        result.visualMode === "pixabay-animation"
          ? `${result.visualSources.length} free licensed Pixabay animation backgrounds transformed with original recurring character and story overlays`
          : "Consistent topic-matched 2D cartoon characters and scenes created locally",
        input.songMode === "local-ace" ? "Local ACE-Step audio preserved at original pitch; singing quality requires owner review" : input.songAudioId ? "Owner-supplied sung recording preserved at its original pitch" : "Local spoken narration with original background music",
        input.songAudioId ? "Lyrics burned in with estimated timing; adjust synchronization in Edit video" : "Short captions timed and burned into the video",
        "Duration, picture, and audio validated before review",
        input.songAudioId ? "No paid API used; review rights to your supplied song before posting" : "No paid API or unlicensed footage used",
      ],
      visualSources: result.visualSources.map((source) => ({
        provider: "pixabay" as const,
        providerMediaId: String(source.id),
        providerUrl: source.pageUrl,
        creator: source.creator,
        licence: "Pixabay Content License",
      })),
      warning: tooSimilarToEarlierPart
        ? `This part shares ${Math.round(similarity * 100)}% of its significant words with an earlier part. Rewrite it before posting so the series is not repetitive.`
        : undefined,
    },
    processing: {
      jobId: job.id,
      start: 0,
      end: media.duration,
      format: result.format,
      score: tooSimilarToEarlierPart ? Math.max(0, result.score - 15) : result.score,
      scoreKind: "script-checks",
      rank: 0,
      reason: `${result.reason}${input.seriesId ? ` Cross-part similarity: ${Math.round(similarity * 100)}%.` : ""}`,
      status: "COMPLETED",
    },
    delivery: {
      publishingFormat: format,
      platform: target,
      aspect: result.format,
      requestedDuration: input.requestedDuration ?? input.duration,
      actualDuration: media.duration,
      creationType,
      accountHandle,
    },
    series: seriesMetadata(input),
    monetizationReview: {
      status: tooSimilarToEarlierPart ? "NEEDS_CHANGES" : "NOT_REVIEWED",
      madeForKids: true,
      originality: input.songMode === "local-ace" ? "original-local" : input.songAudioId ? "owner-supplied" : result.visualMode === "pixabay-animation" ? "licensed-transformed" : "original-local",
      rightsBasis: input.songMode === "local-ace" ? "Locally generated ACE-Step music and singing with approved lyrics and original 2D animation. Review for recognizable copied music and verify model/lyric rights before publishing." : input.songAudioId ? "User-supplied recording and lyrics with local animation. Confirm permission for commercial use of both music and lyrics." : result.visualMode === "pixabay-animation"
        ? "Free Pixabay animation backgrounds transformed with original recurring characters, story props, local script, rhythmic vocals, original music, captions, and editing."
        : "Original local script, procedural cartoon scenes, local synthetic voice, and locally generated accompaniment.",
      checks: ["Confirm the story, lyrics, melody, characters, and title do not copy a reference", "Watch for caption, pronunciation, identity, and audio problems", "Set the upload audience to made for kids", "Review the platform synthetic-content disclosure before upload"],
      manualReviewRequired: true,
      syntheticDisclosureReview: "REVIEW_REQUIRED",
      warning: tooSimilarToEarlierPart
        ? "This episode is too similar to an earlier part and should be rewritten before posting. Made-for-kids restrictions also apply."
        : "Manual review is required. Made-for-kids features and personalized advertising are restricted, and earnings are never guaranteed.",
    },
  });
  review.outputs = { [target]: { filename: path.basename(destination), duration: media.duration, width: media.width, height: media.height } };
  review.status = "READY";
  const kidsDirectory = path.dirname(result.file);
  const kidsCaptions = validateTimedCaptions(parseSrt(await fs.readFile(path.join(kidsDirectory, "captions.srt"), "utf8")), media.duration);
  review.artifacts = { version: 1, renderRevision: "kids-artifacts-v1", finalVideo: artifactReference(destination), editing: { video: artifactReference(path.join(kidsDirectory, "clean.mp4")), offsetSeconds: 0, captionsBaked: false }, captions: artifactReference(path.join(kidsDirectory, "captions.srt")) };
  review.captionCues = kidsCaptions;
  review.editableMaster = true;
  await saveReviewFile(review);
  await rerankCompletedSeries(input.seriesId);
  await updateJob(job.id, { status: "COMPLETED", progress: 100, stage: `${episodeLabel}children's video ready for review`, requestJson: JSON.stringify({ ...input, script: result.script }), duration: media.duration, error: undefined, finishedAt: new Date().toISOString() });
}

async function startStockJob(job: LocalGenerationJob, input: GenerationInput) {
  if (await existingReadyOutput(job, input)) return;
  if (!(await generatorReachable())) throw new Error("The free local stock-video service is offline.");
  await requireStockStoryboardRenderer(Boolean(input.storyboard?.some(beat => beat.assetId)));
  await updateJob(job.id, { progress: 5, stage: "Preparing the script and exact footage through the shared creation pipeline" });
  const plan = await prepareStockCreation(input, input.stockPreparation?.scenes, (saved, _scenes, stage) => updateJob(job.id, { stage, requestJson: JSON.stringify(saved) }));
  const script = plan.input.script!;
  const storyboard = plan.input.storyboard!;
  const prepared: GenerationInput = { ...plan.input, rendererProtocol: 1, visualTerms: storyboard.map(beat => beat.query), visualTermsOrigin: input.visualTermsOrigin || (input.visualTerms?.length ? "owner" : "local-model") };
  await updateJob(job.id, { progress: 12, stage: "Submitting the script to the local stock-video renderer", requestJson: JSON.stringify(prepared) });
  let response: Response;
  await retainExternalRender(job.id);
  try {
    response = await fetch(providerUrl(process.env.MPT_CREATE_PATH || "/api/v1/videos"), {
      method: "POST",
      headers: providerHeaders(job.id),
      body: JSON.stringify({
      video_subject: prepared.topic,
      video_script: script,
      video_terms: stockSearchTerms(prepared),
      phoenix_storyboard: storyboard,
      phoenix_artifacts_version: 1,
      video_language: prepared.language,
      video_aspect: prepared.aspect,
      voice_name: prepared.voice === "local-windows-voice" ? "en-US-JennyNeural-Female" : prepared.voice,
      voice_rate: stockVoiceRate(script, prepared.duration),
      video_source: "pexels",
      match_materials_to_script: true,
      n_threads: 1,
      video_clip_duration: 6,
      video_concat_mode: "sequential",
      video_transition_mode: null,
      video_count: 1,
      bgm_type: "random",
      bgm_volume: 0.06,
      subtitle_enabled: true,
      subtitle_position: "bottom",
      font_size: prepared.aspect === "9:16" ? 42 : 34,
      text_fore_color: "#FFFFFF",
      text_background_color: true,
      stroke_color: "#000000",
      stroke_width: 2,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const reconciled = await findProviderTask(job.id, 3);
    if (reconciled) {
      await retainExternalRender(job.id, reconciled);
      await updateJob(job.id, {
        providerTaskId: reconciled,
        progress: 18,
        stage: "Local stock-video render reconciled after an interrupted response",
        requestJson: JSON.stringify(prepared),
        pollFailureCount: 0,
        submissionUncertainSince: undefined,
      });
      return;
    }
    throw new SubmissionUncertainError(error instanceof Error ? error.message : "The local renderer submission response was interrupted.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 408) await finishExternalRender(job.id);
    else throw new SubmissionUncertainError(`Local renderer returned ${response.status}; reconciling the request before any retry.`);
    throw new Error(payload.message || payload.error || "The free local stock renderer rejected the request.");
  }
  const data = payload.data || payload;
  const taskId = String(data.task_id || data.taskId || data.id || await findProviderTask(job.id, 2) || "");
  if (!taskId) throw new SubmissionUncertainError("The local stock renderer did not return a task ID; reconciling before another submission.");
  await retainExternalRender(job.id, taskId);
  await updateJob(job.id, {
    providerTaskId: taskId,
    progress: 18,
    stage: "Local stock-video render accepted",
    requestJson: JSON.stringify(prepared),
    pollFailureCount: 0,
    submissionUncertainSince: undefined,
  });
}

async function retryOrFail(job: LocalGenerationJob, error: unknown, failedStage: string) {
  if (isWritingWaitError(error)) {
    return updateJob(job.id, { status: "QUEUED", stage: error.message, error: undefined, nextAttemptAt: new Date(Date.now() + error.retryAfterMs).toISOString(), startedAt: undefined, finishedAt: undefined, providerLeaseOwner: undefined, providerLeaseExpiresAt: undefined, localRenderLeaseOwner: undefined, localRenderLeaseExpiresAt: undefined });
  }
  const message = error instanceof Error ? error.message : "Local creation failed";
  const attempt = job.retryCount + 1;
  const history = [...(job.attempts || []), { at: new Date().toISOString(), attempt, error: message }].slice(-12);
  if (attempt < 3) {
    const delaySeconds = attempt === 1 ? 5 : 15;
    return updateJob(job.id, { status: "QUEUED", progress: 0, stage: `${failedStage}; automatic retry ${attempt} of 3 in ${delaySeconds}s`, providerTaskId: undefined, pollFailureCount: 0, providerLeaseOwner: undefined, providerLeaseExpiresAt: undefined, localRenderLeaseOwner: undefined, localRenderLeaseExpiresAt: undefined, submissionUncertainSince: undefined, error: message, retryCount: attempt, attempts: history, nextAttemptAt: new Date(Date.now() + delaySeconds * 1000).toISOString(), queuedAt: new Date().toISOString(), startedAt: undefined, finishedAt: undefined }, true);
  }
  return updateJob(job.id, { status: "FAILED", stage: `${failedStage} after 3 local attempts`, error: message, retryCount: attempt, attempts: history, providerTaskId: undefined, pollFailureCount: 0, providerLeaseOwner: undefined, providerLeaseExpiresAt: undefined, localRenderLeaseOwner: undefined, localRenderLeaseExpiresAt: undefined, submissionUncertainSince: undefined, finishedAt: new Date().toISOString() });
}

async function processNextGenerationJobAdmitted() {
  const job = await claimQueuedJob();
  if (!job) return null;
  const input = JSON.parse(job.requestJson) as GenerationInput;
  const children = input.creationType === "children-story" || input.creationType === "children-song";
  const localHeartbeat = children
    ? setInterval(() => void renewLocalRenderLease(job.id), Math.floor(LOCAL_RENDER_LEASE_MS / 3))
    : null;
  localHeartbeat?.unref();
  try {
    if (children) await runChildrenJob(job, input);
    else await startStockJob(job, input);
    return (await listGenerationJobs()).find((item) => item.id === job.id) || null;
  } catch (error) {
    if (error instanceof SubmissionUncertainError) {
      const now = new Date().toISOString();
      return updateJob(job.id, {
        status: "RUNNING",
        stage: "Confirming whether the local stock renderer accepted this job",
        error: error.message,
        submissionUncertainSince: now,
        nextAttemptAt: new Date(Date.now() + 5_000).toISOString(),
      });
    }
    return retryOrFail(job, error, "Creation attempt failed");
  } finally {
    if (localHeartbeat) {
      clearInterval(localHeartbeat);
      await releaseLocalRenderLease(job.id);
    }
  }
}

export async function processNextGenerationJob() {
  const result = await tryWithLocalRenderSlot(processNextGenerationJobAdmitted, "Video creation");
  return result.acquired ? result.value : null;
}

/** Independent of normal job polling: even a failed status poll must not abandon
 * a Python render and start competing work. Network uncertainty retains the slot.
 */
export async function reconcileRenderResources() {
  await reconcileHeavyLease(async external => {
    let taskId = external.taskId;
    if (!taskId) {
      const response = await fetch(providerUrl("/api/v1/tasks?page=1&page_size=100"), { headers: providerHeaders(), signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error("Renderer task inventory unavailable");
      const data = (await response.json()).data;
      if (!Array.isArray(data?.tasks)) throw new Error("Invalid renderer task inventory");
      taskId = data.tasks.find((task: { request_id?: string }) => task.request_id === external.jobId)?.task_id;
      if (!taskId) {
        // A complete successful inventory and grace period establish rejection;
        // an incomplete page or unreachable endpoint does not.
        if (Date.now() - Date.parse(external.submittedAt) > 60_000 && Number.isFinite(data.total) && data.total <= data.tasks.length) {
          await updateJob(external.jobId, { submissionUncertainSince: undefined, status: "QUEUED", stage: "Submission was not accepted; safely queued again", nextAttemptAt: new Date(Date.now() + 5_000).toISOString() });
          return { state: "terminal" };
        }
        return { state: "unknown", error: "Confirming the previous renderer submission; another render will not start yet." };
      }
      await updateJob(external.jobId, { providerTaskId: taskId, submissionUncertainSince: undefined, status: "RUNNING", stage: "Reconnected to existing stock task" });
    }
    const response = await fetch(providerUrl(`/api/v1/tasks/${encodeURIComponent(taskId!)}`), { headers: providerHeaders(), signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) {
      await recordRendererTerminal(external.jobId, taskId!);
      return { state: "terminal" };
    }
    if (!response.ok) throw new Error("Renderer status unavailable");
    const data = (await response.json()).data;
    const state = data?.state ?? data?.status;
    const terminal = state === 1 || state === -1 || ["COMPLETED", "SUCCESS", "SUCCEEDED", "FINISHED", "FAILED", "ERROR", "CANCELLED"].includes(String(state).toUpperCase());
    if (terminal) {
      await recordRendererTerminal(external.jobId, taskId!);
      return { state: "terminal" };
    }
    return { state: "running", taskId };
  });
}

/** Terminal resource evidence must also reach archived tombstones. Ordinary job
 * updates intentionally reject those; skipping the marker would adopt the same
 * retired task again on every queue tick. This never revives or edits its status.
 */
async function recordRendererTerminal(jobId: string, taskId: string) {
  await mutateJobs(jobs => {
    const job = jobs.find(item => item.id === jobId);
    if (job?.providerTaskId === taskId) job.resourceReleasedTaskId = taskId;
  });
}

async function claimProviderJob() {
  return mutateJobs((jobs) => {
    const now = Date.now();
    const candidate = jobs
      .filter((job) =>
        !job.archivedAt && job.status === "RUNNING" &&
        Boolean(job.providerTaskId) &&
        (!job.nextAttemptAt || new Date(job.nextAttemptAt).getTime() <= now) &&
        (!job.providerLeaseExpiresAt || new Date(job.providerLeaseExpiresAt).getTime() <= now)
      )
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())[0];
    if (!candidate) return null;
    const index = jobs.findIndex((job) => job.id === candidate.id);
    jobs[index] = {
      ...candidate,
      providerLeaseOwner: PROCESS_OWNER,
      providerLeaseExpiresAt: new Date(now + PROVIDER_LEASE_MS).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return jobs[index];
  });
}

async function renewProviderLease(id: string) {
  return mutateJobs((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].providerLeaseOwner !== PROCESS_OWNER || jobs[index].status !== "RUNNING") return false;
    jobs[index].providerLeaseExpiresAt = new Date(Date.now() + PROVIDER_LEASE_MS).toISOString();
    jobs[index].updatedAt = new Date().toISOString();
    return true;
  });
}

async function releaseProviderLease(id: string) {
  return mutateJobs((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].providerLeaseOwner !== PROCESS_OWNER) return false;
    jobs[index].providerLeaseOwner = undefined;
    jobs[index].providerLeaseExpiresAt = undefined;
    jobs[index].updatedAt = new Date().toISOString();
    return true;
  });
}

async function pollClaimedStockJob(job: LocalGenerationJob) {
  const heartbeat = setInterval(() => void renewProviderLease(job.id), Math.floor(PROVIDER_LEASE_MS / 3));
  heartbeat.unref();
  try {
    const route = (process.env.MPT_STATUS_PATH || "/api/v1/tasks/{taskId}").replace("{taskId}", encodeURIComponent(job.providerTaskId || ""));
    const response = await fetch(providerUrl(route), { headers: providerHeaders(), signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) {
      await updateJob(job.id, { resourceReleasedTaskId: job.providerTaskId });
      await finishExternalRender(job.id, job.providerTaskId);
      await updateJob(job.id, {
        status: "FAILED",
        stage: "Local renderer task was lost after the renderer restarted",
        error: "The local renderer task no longer exists (404). Retry will safely start a new local render.",
        providerTaskId: undefined,
        pollFailureCount: 0,
        finishedAt: new Date().toISOString(),
      });
      return;
    }
    if (!response.ok) throw new Error(`Local stock renderer status failed (${response.status}).`);
    const payload = await response.json();
    const data = payload.data || payload;
    const rawState = data.state ?? data.status;
    const state = typeof rawState === "number" ? (rawState === 1 ? "COMPLETED" : rawState === -1 ? "FAILED" : "RUNNING") : String(rawState || "").toUpperCase();
    const providerProgress = Math.max(0, Math.min(100, Number(data.progress || 0)));
    const progress = Math.max(18, Math.min(90, 18 + Math.round(providerProgress * 0.72)));
    if (["COMPLETED", "SUCCESS", "SUCCEEDED", "FINISHED"].includes(state)) {
      await updateJob(job.id, { resourceReleasedTaskId: job.providerTaskId });
      await finishExternalRender(job.id, job.providerTaskId);
      const input = JSON.parse(job.requestJson) as GenerationInput;
      // `videos` contains the final narration/music/subtitle mux. The
      // `combined_videos` files are picture-only intermediates.
      const output = data.video_url || data.videoUrl || data.outputUrl || data.videos?.[0];
      if (!output) throw new Error("The local renderer completed without a video URL.");
      await completeStockJob(job, input, String(output), data.phoenix_storyboard, data.phoenix_artifacts);
    } else if (["FAILED", "ERROR", "CANCELLED"].includes(state)) {
      await updateJob(job.id, { resourceReleasedTaskId: job.providerTaskId });
      await finishExternalRender(job.id, job.providerTaskId);
      await retryOrFail(job, new Error(String(data.error || data.message || payload.message || "Rendering failed.")), "Stock-video render failed");
    } else {
      await updateJob(job.id, { progress, stage: typeof data.phoenix_stage === "string" ? data.phoenix_stage.slice(0, 200) : `Rendering locally · provider ${Math.round(providerProgress)}%`, error: undefined, pollFailureCount: 0, nextAttemptAt: undefined });
    }
  } catch (error) {
    const failures = (job.pollFailureCount || 0) + 1;
    const message = error instanceof Error ? error.message : "Local status check failed";
    if (failures >= 3) {
      // Preserve providerTaskId. Manual retry reconnects to this same render
      // instead of creating a duplicate provider job.
      await updateJob(job.id, {
        status: "FAILED",
        stage: "Could not read local renderer status after three checks",
        pollFailureCount: failures,
        error: `${message} The existing local render was preserved; Retry will reconnect to it.`,
        finishedAt: new Date().toISOString(),
      });
    } else {
      await updateJob(job.id, {
        pollFailureCount: failures,
        error: message,
        stage: `Local status check failed; reconnecting ${failures} of 3`,
        nextAttemptAt: new Date(Date.now() + failures * 5_000).toISOString(),
      });
    }
  } finally {
    clearInterval(heartbeat);
    await releaseProviderLease(job.id);
  }
}

async function pollStockJobs() {
  for (let index = 0; index < 3; index++) {
    const job = await claimProviderJob();
    if (!job) break;
    await pollClaimedStockJob(job);
  }
}

async function recoverInterruptedLocalJobs() {
  const jobs = (await listGenerationJobs()).filter((item) => item.status === "RUNNING" && !item.providerTaskId);
  for (const job of jobs) {
    const input = JSON.parse(job.requestJson) as GenerationInput;
    const children = input.creationType === "children-story" || input.creationType === "children-song";
    const now = Date.now();
    if (children) {
      const leaseExpiresAt = job.localRenderLeaseExpiresAt
        ? new Date(job.localRenderLeaseExpiresAt).getTime()
        : 0;
      if (leaseExpiresAt > now) continue;
      await retryOrFail(job, new Error("The previous local children render stopped before completion."), "Interrupted local children render");
      continue;
    }
    if (!children && (!job.nextAttemptAt || new Date(job.nextAttemptAt).getTime() <= now)) {
      const reconciled = await findProviderTask(job.id);
      if (reconciled) {
        await updateJob(job.id, {
          providerTaskId: reconciled,
          progress: 18,
          stage: "Reconnected to the existing local stock render",
          error: undefined,
          pollFailureCount: 0,
          submissionUncertainSince: undefined,
          nextAttemptAt: undefined,
        });
        continue;
      }
      if (job.submissionUncertainSince) {
        const uncertainFor = now - new Date(job.submissionUncertainSince).getTime();
        if (uncertainFor >= 0) {
          await updateJob(job.id, {
            stage: "Still confirming the local renderer submission",
            nextAttemptAt: new Date(now + 5_000).toISOString(),
          });
          continue;
        }
      }
    }
    if (now - new Date(job.updatedAt).getTime() >= 15 * 60 * 1000 || job.submissionUncertainSince) {
      await retryOrFail(job, new Error("Phoenix stopped before this local render could be confirmed."), "Interrupted local render");
    }
  }
}

let cycleRunning = false;

export async function pollGenerationJobs() {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    await recoverInterruptedLocalJobs();
    await pollStockJobs();
    await processNextGenerationJob();
  } finally {
    cycleRunning = false;
  }
}

export async function startGeneration(id: string) {
  return (await listGenerationJobs()).find((item) => item.id === id && item.status === "QUEUED") || null;
}
