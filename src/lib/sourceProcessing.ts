import crypto from "node:crypto";
import os from "node:os";
import { artifactReference } from "./reviewArtifacts";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { localMusicWav } from "./kidsRenderer";
import { socialHandle } from "./socialAccounts";
import { JobHistoryConflictError } from "./jobHistory";
import { STOCK_REUSE_POLICY, assertStockReuseAvailable, stockReuseBlocked } from "./stockReuse";
import { DEFAULT_STOCK_REEL_OPTIONS, MAX_STOCK_REEL_BYTES, MAX_STOCK_SHOTS, STOCK_REEL_FPS, STOCK_REEL_EDIT_VERSION, assertStockReelMinimum, planStockIntervals, reorderStockIntervals, stockAudioUsable, stockFraming, stockMusicArrangement, stockMusicArrangementDescription, stockMusicMixGain, stockMusicWav, stockShotFades, type StockInterval, type StockReelOptions } from "./stockReel";
import { stockMotionSamples, stockMotionArgs, stockMotionScore, stockSustainedMotionScore, stockGreeneryArgs, stockGreeneryEvidence, stockGreenerySelection, STOCK_COLOUR_MAX_BYTES, stockPlaybackFilters, stockSpeechSampleArgs, type StockMotionWindow } from "./stockMotion";
import { stockAppearanceArgs, stockAppearance, validStockAppearance, stockVisualOrder, type StockAppearancePair } from "./stockVisualContinuity";
import { cleanupStockTemporaries } from "./stockTemporaryCleanup";
import {
  FFMPEG_ENCODER_RESOURCE_ARGS,
  FFMPEG_FILTER_RESOURCE_ARGS,
  lowerChildProcessPriority,
  tryWithLocalRenderSlot,
} from "./renderResources";
import {
  ensureReviewFolders,
  makeReviewFile,
  outputPath,
  readReviewFiles,
  saveReviewFile,
  safeFilename,
  sourcePath,
  type ReviewFile,
} from "./reviewFiles";

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024;

export type ProcessingMode = "coverage" | "highlights";
export type ProcessingStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "BLOCKED" | "CANCELLED";
export type StockReelShot = { provider: "pexels" | "pixabay"; mediaId: string; sourcePage: string; creator: string; title: string; sourceFile: string; start: number; end: number; trimMode?: "auto" | "manual" };
export type SourceJob = {
  stockSource?: { provider: "pexels" | "pixabay"; mediaId: string; sourcePage: string; creator: string; requestId: string; caption: string; maxDuration: number; theme?: string; shots?: StockReelShot[]; renderedShots?: Array<{ provider: "pexels" | "pixabay"; mediaId: string }>; options?: StockReelOptions; editVersion?: 1 | 2; managerGuidance?: ReviewFile["quality"]["managerGuidance"] };
  id: string;
  title: string;
  sourceFile: string;
  mode: ProcessingMode;
  status: ProcessingStatus;
  archivedAt?: string;
  progress: number;
  stage: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  completedClips: number;
  totalClips: number;
  reviewIds: string[];
  attempts?: number;
  queuedAt?: string;
  attemptStartedProgress?: number;
};

export type SourceJobWithTiming = SourceJob & {
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
};

export type SourceProcessingPreflight = {
  ready: boolean;
  checkedAt: string;
  summary: string;
  dependencies: {
    ffmpeg: boolean;
    ffprobe: boolean;
    python: boolean;
    fasterWhisper: boolean;
  };
  details: {
    ffmpeg: string;
    ffprobe: string;
    python: string;
    fasterWhisper: string;
  };
  whisperModel: {
    name: string;
    cached: boolean;
    status: "cached" | "download-required" | "unavailable";
    message: string;
  };
  firstModelDownloadRequired: boolean;
};

type MediaInfo = { duration: number; videoDuration?: number; width: number; height: number; hasAudio: boolean; videoCodec?: string; pixelFormat?: string; frameRate?: number; audioCodec?: string; audioSampleRate?: number; audioChannels?: number };
export type Silence = { start: number; end: number };
export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  avgLogprob?: number;
  noSpeechProbability?: number;
};
type BoundaryKind = "silence" | "transcript" | "target";
export type BaseCut = { start: number; end: number; boundary: BoundaryKind };
export type AudioState = { usable: boolean; mean: number; max: number };
type CutMetrics = {
  hookSignals: number;
  transcriptWords: number;
  transcriptConfidence: number;
  silenceRatio: number;
  audio: AudioState;
};
export type SourceCut = BaseCut & { score: number; rank: number; metrics: CutMetrics };
type Cut = SourceCut;
type CaptionCue = { start: number; end: number; lines: string[] };
type PythonCommand = { command: string; prefixArgs: string[]; label: string };
type RunOptions = {
  cwd?: string;
  onOutput?: (chunk: string, channel: "stdout" | "stderr") => void | Promise<void>;
  onStdoutBinary?: (chunk: Buffer) => void;
};

const reviewRoot = path.join(process.cwd(), "storage", "Phoenix Studio Review Files");
const jobsPath = path.join(reviewRoot, "source-processing-jobs.json");
const jobsLockPath = path.join(reviewRoot, "source-processing-jobs.lock");
const processorLockPath = path.join(reviewRoot, "source-processing-worker.lock");
const workRoot = path.join(reviewRoot, "work");
const ffmpegPath = process.env.PHOENIX_FFMPEG_PATH?.trim()
  || path.join(process.cwd(), "node_modules", "@ffmpeg-installer", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobePath = process.env.PHOENIX_FFPROBE_PATH?.trim()
  || path.join(process.cwd(), "node_modules", "@ffprobe-installer", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const whisperScript = path.join(process.cwd(), "scripts", "transcribe-local.py");
const whisperModels = path.join(reviewRoot, "models", "whisper");
const defaultWhisperModel = process.env.PHOENIX_WHISPER_MODEL?.trim() || "base";
const legacyWhisperPython = "C:\\Users\\rishi\\Documents\\MoneyPrinterTurbo\\.venv\\Scripts\\python.exe";
const hookPattern = /\b(why|how|secret|surprise|important|never|best|first|imagine|discover|mistake|warning|truth|easy|fast|must|watch|listen)\b|[?!]/gi;

let jobMutationTail: Promise<void> = Promise.resolve();
let processorPromise: Promise<SourceJob | null> | null = null;
let resolvedPython: PythonCommand | null = null;
let preflightCache: { expiresAt: number; value: SourceProcessingPreflight } | null = null;

export class SourceUploadTooLargeError extends Error {
  readonly statusCode = 413;

  constructor(maximum = MAX_SOURCE_BYTES) {
    super(maximum === MAX_SOURCE_BYTES ? "Files larger than 5 GB are not supported." : "The selected stock footage exceeds the shared 500 MB laptop-safe download limit. Choose fewer or smaller sources.");
    this.name = "SourceUploadTooLargeError";
  }
}

export class SourceUploadInterruptedError extends Error {
  readonly statusCode = 400;

  constructor(received: number, expected: number) {
    super(`Upload was interrupted (${received} of ${expected} bytes received).`);
    this.name = "SourceUploadInterruptedError";
  }
}

/** Exported for a small-stream regression test; production always passes MAX_SOURCE_BYTES. */
export class SourceByteLimitTransform extends Transform {
  bytes = 0;

  constructor(private readonly maximum: number) {
    super();
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
    const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
    this.bytes += bytes;
    if (this.bytes > this.maximum) {
      callback(new SourceUploadTooLargeError(this.maximum));
      return;
    }
    callback(null, chunk);
  }
}

async function ensure() {
  await ensureReviewFolders();
  await fs.mkdir(workRoot, { recursive: true });
  await fs.writeFile(jobsPath, "[]\n", { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

async function readJobsUnlocked(): Promise<SourceJob[]> {
  await ensure();
  try {
    const parsed = JSON.parse(await fs.readFile(jobsPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("The source-processing queue is not a JSON array.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Could not read the source-processing queue: ${error instanceof Error ? error.message : "unknown storage error"}`);
  }
}

async function saveJobsUnlocked(jobs: SourceJob[]) {
  await ensure();
  const temporary = `${jobsPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fs.rename(temporary, jobsPath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  await fs.rm(temporary, { force: true }).catch(() => undefined);
  throw lastError;
}

async function acquireJobsFileLock() {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const handle = await fs.open(jobsLockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
      return async () => {
        await handle.close().catch(() => undefined);
        await fs.rm(jobsLockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== "EEXIST") throw error;
      const stat = await fs.stat(jobsLockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 120_000) {
        await fs.rm(jobsLockPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw new Error("The source-processing queue is busy; try again in a moment.");
      await new Promise((resolve) => setTimeout(resolve, 40 + Math.floor(Math.random() * 40)));
    }
  }
}

async function withJobMutation<T>(operation: () => Promise<T>): Promise<T> {
  let release: () => void = () => {};
  const previous = jobMutationTail;
  jobMutationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  let releaseFileLock: (() => Promise<void>) | null = null;
  try {
    await ensure();
    releaseFileLock = await acquireJobsFileLock();
    return await operation();
  } finally {
    if (releaseFileLock) await releaseFileLock();
    release();
  }
}

export async function readSourceJobs(): Promise<SourceJob[]> {
  return (await readJobsUnlocked()).filter((job) => !job.archivedAt);
}

/** The reuse limit includes retained archived completions, unlike job browsing. */
export async function readStockReuseBlocked() {
  return stockReuseBlocked(await readJobsUnlocked());
}

function validateStockReusePolicy(options?: StockReelOptions) {
  if (options?.reusePolicy !== undefined && options.reusePolicy !== STOCK_REUSE_POLICY) throw new Error("This stock reuse policy is unsupported. Start a new stock footage request.");
}

function stockReuseShots(stock: NonNullable<SourceJob["stockSource"]>) {
  return stock.shots === undefined ? [{ provider: stock.provider, mediaId: stock.mediaId }] : stock.shots;
}

export async function findStockSourceJob(requestId: string) {
  const job = (await readJobsUnlocked()).find(job => job.stockSource?.requestId === requestId);
  if (job?.archivedAt || job?.status === "CANCELLED") throw new JobHistoryConflictError("This request was removed. Start a new stock reel rather than reviving a cancelled job.");
  return job;
}

export function sourceJobWithTiming(job: SourceJob, now = Date.now()): SourceJobWithTiming {
  const started = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
  const finished = job.finishedAt ? Date.parse(job.finishedAt) : Number.NaN;
  const end = Number.isFinite(finished) ? finished : now;
  const elapsedSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((end - started) / 1000)) : 0;
  let estimatedRemainingSeconds: number | null = null;
  if (job.status === "COMPLETED") {
    estimatedRemainingSeconds = 0;
  } else if (job.status === "PROCESSING" && elapsedSeconds > 0 && job.progress < 100) {
    const attemptStart = Math.min(job.progress, Math.max(0, job.attemptStartedProgress || 0));
    const gained = job.progress - attemptStart;
    if (gained >= 1) {
      estimatedRemainingSeconds = Math.max(1, Math.ceil((100 - job.progress) * elapsedSeconds / gained));
    }
  }
  return { ...job, elapsedSeconds, estimatedRemainingSeconds };
}

export async function updateJob(id: string, change: Partial<SourceJob>) {
  return withJobMutation(async () => {
    const jobs = await readJobsUnlocked();
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].archivedAt || jobs[index].status === "CANCELLED") return null;
    const current = jobs[index];
    const nextProgress = change.progress === undefined
      ? current.progress
      : Math.max(current.progress, Math.min(100, Math.max(0, Math.round(change.progress))));
    jobs[index] = {
      ...current,
      ...change,
      progress: nextProgress,
      reviewIds: change.reviewIds ? [...new Set(change.reviewIds)] : current.reviewIds,
      updatedAt: new Date().toISOString(),
    };
    await saveJobsUnlocked(jobs);
    return jobs[index];
  });
}

export async function getSourceJob(id: string) {
  return (await readSourceJobs()).find((job) => job.id === id) || null;
}

export async function removeSourceJob(id: string) {
  return withJobMutation(async () => {
    const jobs = await readJobsUnlocked();
    const index = jobs.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const job = jobs[index];
    if (job.archivedAt) return job;
    if (job.status === "PROCESSING") {
      throw new JobHistoryConflictError("This source video is processing. It can be removed from the manager after it finishes or fails.");
    }
    const now = new Date().toISOString();
    jobs[index] = {
      ...job,
      status: job.status === "QUEUED" ? "CANCELLED" : job.status,
      stage: job.status === "QUEUED" ? "Cancelled before processing" : job.stage,
      archivedAt: now,
      finishedAt: job.finishedAt ?? (job.status === "COMPLETED" ? job.createdAt : now),
      updatedAt: now,
    };
    await saveJobsUnlocked(jobs);
    return jobs[index];
  });
}

export async function retrySourceJob(id: string) {
  return withJobMutation(async () => {
    const jobs = await readJobsUnlocked();
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0 || jobs[index].archivedAt || jobs[index].status === "CANCELLED") return null;
    const job = jobs[index];
    if (job.status === "PROCESSING" || job.status === "COMPLETED") return { job, queued: false, changed: false };
    if (job.status === "QUEUED") return { job, queued: true, changed: false };
    if (job.stockSource !== undefined) {
      if (!job.stockSource || typeof job.stockSource !== "object" || !["FAILED", "BLOCKED"].includes(job.status)) throw new Error("This stock retry has invalid saved metadata or status. Its history was not changed.");
      validateStockReusePolicy(job.stockSource.options);
      // Self-exclusion affects the allowance, not validation of the reservation
      // we are about to save with this job's original creation timestamp.
      stockReuseBlocked([{ ...job, status: "QUEUED", finishedAt: undefined }]);
      assertStockReuseAvailable(stockReuseShots(job.stockSource), jobs, Date.now(), job.id);
    }
    jobs[index] = {
      ...job,
      status: "QUEUED",
      queuedAt: new Date().toISOString(),
      stage: job.completedClips > 0
        ? `Queued for safe retry · ${job.completedClips} completed clip${job.completedClips === 1 ? "" : "s"} will be checked and reused`
        : "Queued for safe retry",
      error: undefined,
      finishedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    await saveJobsUnlocked(jobs);
    return { job: jobs[index], queued: true, changed: true };
  });
}

async function run(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true });
    lowerChildProcessPriority(child.pid);
    let output = "";
    let callbackTail: Promise<void> = Promise.resolve();
    const capture = (channel: "stdout" | "stderr", value: Buffer) => {
      if (channel === "stdout" && options.onStdoutBinary) {
        try { options.onStdoutBinary(value); }
        catch (error) { child.kill(); reject(error); }
        return; // Raw RGB pixels must never become a text log or progress event.
      }
      const text = value.toString();
      output = (output + text).slice(-128 * 1024);
      if (options.onOutput) callbackTail = callbackTail.then(() => options.onOutput?.(text, channel)).then(() => undefined);
    };
    child.stdout.on("data", (data: Buffer) => capture("stdout", data));
    child.stderr.on("data", (data: Buffer) => capture("stderr", data));
    child.on("error", reject);
    child.on("close", (code) => {
      void callbackTail.then(() => {
        if (code === 0) resolve(output);
        else reject(new Error(output.slice(-2400) || `${path.basename(command)} failed (${code})`));
      }).catch(reject);
    });
  });
}

function uniquePythonCandidates() {
  const configured = process.env.PHOENIX_WHISPER_PYTHON?.trim();
  const candidates: PythonCommand[] = [];
  if (configured) candidates.push({ command: configured, prefixArgs: [], label: configured });
  candidates.push({ command: legacyWhisperPython, prefixArgs: [], label: legacyWhisperPython });
  if (process.platform === "win32") candidates.push({ command: "py", prefixArgs: ["-3"], label: "py -3" });
  candidates.push({ command: process.platform === "win32" ? "python" : "python3", prefixArgs: [], label: process.platform === "win32" ? "python" : "python3" });
  return candidates.filter((candidate, index, all) => all.findIndex((item) => `${item.command}\0${item.prefixArgs.join("\0")}` === `${candidate.command}\0${candidate.prefixArgs.join("\0")}`) === index);
}

async function locatePython() {
  if (resolvedPython) return resolvedPython;
  for (const candidate of uniquePythonCandidates()) {
    try {
      await run(candidate.command, [...candidate.prefixArgs, "--version"]);
      resolvedPython = candidate;
      return candidate;
    } catch {
      // Try the next local Python candidate.
    }
  }
  return null;
}

async function binaryCheck(binary: string, label: string) {
  try {
    await fs.access(binary);
    const version = await run(binary, ["-version"]);
    const firstLine = version.split(/\r?\n/, 1)[0]?.trim();
    return { available: true, detail: firstLine || `${label} is available` };
  } catch (error) {
    return { available: false, detail: `${label} is unavailable at ${binary}: ${error instanceof Error ? error.message : "not found"}` };
  }
}

export async function sourceProcessingPreflight(force = false, stockOnly = false): Promise<SourceProcessingPreflight> {
  if (!stockOnly && !force && preflightCache && preflightCache.expiresAt > Date.now()) return preflightCache.value;
  // Real-footage reels never need to import Python/model libraries just to check
  // video tools. Only examine speech support when a cached model can be admitted.
  const cachedMarker = path.join(whisperModels, `.phoenix-${defaultWhisperModel.replace(/[^a-zA-Z0-9]/g, "-")}-ready`);
  const allowSpeechCheck = !stockOnly || (os.freemem() >= 900 * 1024 * 1024 && await fs.access(cachedMarker).then(() => true, () => false));

  const [ffmpegCheck, ffprobeCheck, python] = await Promise.all([
    binaryCheck(ffmpegPath, "FFmpeg"),
    binaryCheck(ffprobePath, "FFprobe"),
    allowSpeechCheck ? locatePython() : Promise.resolve(null),
  ]);
  let fasterWhisper = false;
  let modelCached = false;
  let whisperModelName = defaultWhisperModel;
  let whisperDetail = "faster-whisper could not be checked because Python is unavailable.";
  if (python) {
    try {
      const raw = await run(python.command, [
        ...python.prefixArgs,
        whisperScript,
        "--check",
        "--model-dir",
        whisperModels,
      ]);
      const check = JSON.parse(raw.trim()) as { fasterWhisper?: boolean; modelCached?: boolean; detail?: string; model?: string };
      fasterWhisper = check.fasterWhisper === true;
      modelCached = check.modelCached === true;
      if (check.model?.trim()) whisperModelName = check.model.trim();
      whisperDetail = check.detail || (fasterWhisper ? "faster-whisper is installed" : "faster-whisper is not installed");
    } catch (error) {
      whisperDetail = `Could not load the transcription preflight: ${error instanceof Error ? error.message : "unknown Python error"}`;
    }
  }

  const dependencies = {
    ffmpeg: ffmpegCheck.available,
    ffprobe: ffprobeCheck.available,
    python: Boolean(python),
    fasterWhisper,
  };
  const ready = Object.values(dependencies).every(Boolean);
  const missing = Object.entries(dependencies).filter(([, available]) => !available).map(([name]) => name);
  const whisperModel: SourceProcessingPreflight["whisperModel"] = !fasterWhisper
    ? { name: whisperModelName, cached: false, status: "unavailable", message: "Install faster-whisper before processing source videos." }
    : modelCached
      ? { name: whisperModelName, cached: true, status: "cached", message: `The Whisper ${whisperModelName} model is cached locally and ready.` }
      : { name: whisperModelName, cached: false, status: "download-required", message: `The first audio source will download the free Whisper ${whisperModelName} model once; the initial transcription can take several extra minutes.` };
  const value: SourceProcessingPreflight = {
    ready,
    checkedAt: new Date().toISOString(),
    summary: ready
      ? (modelCached ? "Local video and transcription tools are ready." : whisperModel.message)
      : `Source processing is unavailable. Missing: ${missing.join(", ")}.`,
    dependencies,
    details: {
      ffmpeg: ffmpegCheck.detail,
      ffprobe: ffprobeCheck.detail,
      python: python ? `Python is available via ${python.label}.` : "Python 3 is unavailable. Set PHOENIX_WHISPER_PYTHON to a Python executable.",
      fasterWhisper: whisperDetail,
    },
    whisperModel,
    firstModelDownloadRequired: ready && !modelCached,
  };
  if (!stockOnly) preflightCache = { expiresAt: Date.now() + 20_000, value };
  return value;
}

export async function ffmpegAvailable() {
  const checks = await Promise.all([binaryCheck(ffmpegPath, "FFmpeg"), binaryCheck(ffprobePath, "FFprobe")]);
  return checks.every(check => check.available);
}

async function probe(file: string): Promise<MediaInfo> {
  const raw = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,pix_fmt,avg_frame_rate,width,height,sample_rate,channels,duration,nb_frames",
    "-of", "json",
    file,
  ]);
  const data = JSON.parse(raw) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string; avg_frame_rate?: string; width?: number; height?: number; sample_rate?: string; channels?: number; duration?: string; nb_frames?: string }>;
  };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  const rate = video?.avg_frame_rate?.split("/").map(Number);
  const frameRate = rate?.length === 2 && rate[1] > 0 ? rate[0] / rate[1] : undefined;
  const pictureSeconds = Number(video?.duration), frameSeconds = frameRate && Number(video?.nb_frames) / frameRate;
  return {
    duration: Number(data.format?.duration || 0),
    videoDuration: pictureSeconds > 0 && Number.isFinite(pictureSeconds) ? pictureSeconds : frameSeconds && Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : undefined,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name,
    pixelFormat: video?.pix_fmt,
    frameRate,
    audioCodec: audio?.codec_name,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    audioChannels: audio?.channels,
  };
}

async function silences(file: string, hasAudio: boolean, duration: number) {
  if (!hasAudio) return [] as Silence[];
  const raw = await run(ffmpegPath, [
    "-hide_banner", "-nostats", ...FFMPEG_FILTER_RESOURCE_ARGS,
    "-threads", "1", "-i", file,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-af", "silencedetect=noise=-34dB:d=0.65",
    "-f", "null",
    "-",
  ]);
  const events = [...raw.matchAll(/silence_(start|end):\s*([0-9.]+)/g)];
  const result: Silence[] = [];
  let start: number | undefined;
  for (const event of events) {
    const value = Number(event[2]);
    if (event[1] === "start") start = value;
    else if (start !== undefined) {
      result.push({ start, end: value });
      start = undefined;
    }
  }
  if (start !== undefined) result.push({ start, end: duration });
  return result;
}

async function audioState(file: string, hasAudio: boolean, start: number, end: number): Promise<AudioState> {
  if (!hasAudio) return { usable: false, mean: -99, max: -99 };
  const raw = await run(ffmpegPath, [
    "-hide_banner", "-nostats", ...FFMPEG_FILTER_RESOURCE_ARGS,
    "-ss", start.toFixed(3),
    "-t", Math.max(0.05, end - start).toFixed(3),
    "-threads", "1", "-i", file,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);
  const mean = Number(raw.match(/mean_volume:\s*(-?(?:[0-9.]+|inf)) dB/i)?.[1] || -99);
  const max = Number(raw.match(/max_volume:\s*(-?(?:[0-9.]+|inf)) dB/i)?.[1] || -99);
  return {
    usable: Number.isFinite(mean) && Number.isFinite(max) && mean > -40 && max > -24,
    mean: Number.isFinite(mean) ? mean : -99,
    max: Number.isFinite(max) ? max : -99,
  };
}

export function normaliseTranscriptSegments(items: TranscriptSegment[], duration: number) {
  const sorted = items
    .map((item) => ({
      start: Math.max(0, Math.min(duration, Number(item.start))),
      end: Math.max(0, Math.min(duration, Number(item.end))),
      text: String(item.text || "").replace(/\s+/g, " ").trim(),
      avgLogprob: Number.isFinite(Number(item.avgLogprob)) ? Number(item.avgLogprob) : undefined,
      noSpeechProbability: Number.isFinite(Number(item.noSpeechProbability)) ? Number(item.noSpeechProbability) : undefined,
    }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start && item.text)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const result: TranscriptSegment[] = [];
  for (const item of sorted) {
    const previous = result.at(-1);
    const currentKey = item.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const previousKey = previous?.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() || "";
    const duplicate = previous
      && item.start <= previous.end + 1.5
      && (currentKey === previousKey || (currentKey.length > 12 && (currentKey.includes(previousKey) || previousKey.includes(currentKey))));
    if (duplicate && previous) {
      previous.end = Math.max(previous.end, item.end);
      if (item.text.length > previous.text.length) {
        previous.text = item.text;
        previous.avgLogprob = item.avgLogprob;
        previous.noSpeechProbability = item.noSpeechProbability;
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

async function cachedTranscript(output: string, duration: number, expectedModel = defaultWhisperModel) {
  try {
    const data = JSON.parse(await fs.readFile(output, "utf8")) as { segments?: TranscriptSegment[]; complete?: boolean; model?: string; duration?: number };
    if (!Array.isArray(data.segments) || data.complete === false || data.model !== expectedModel || (data.duration !== undefined && Math.abs(data.duration - duration) > 1)) return null;
    return normaliseTranscriptSegments(data.segments, duration);
  } catch {
    return null;
  }
}

async function transcribe(
  file: string,
  jobId: string,
  hasAudio: boolean,
  duration: number,
  onProgress: (progress: number, stage: string) => Promise<unknown>,
  limitDuration = false,
) {
  if (!hasAudio) return [] as TranscriptSegment[];
  const directory = path.join(workRoot, `source-${jobId}`);
  const output = path.join(directory, "transcript.json");
  await fs.mkdir(directory, { recursive: true });
  const cached = await cachedTranscript(output, duration);
  if (cached) {
    await onProgress(30, "Reusing the completed local transcript");
    return cached;
  }

  const preflight = await sourceProcessingPreflight();
  const python = resolvedPython || await locatePython();
  if (!python || !preflight.dependencies.fasterWhisper) throw new Error(preflight.summary);
  await onProgress(
    15,
    preflight.firstModelDownloadRequired
      ? `Downloading the free Whisper ${preflight.whisperModel.name} model for the first transcription · one-time local setup`
      : `Loading the cached Whisper ${preflight.whisperModel.name} model`,
  );
  let markerBuffer = "";
  let lastReported = 15;
  await run(python.command, [
    ...python.prefixArgs,
    whisperScript,
    "--input", file,
    "--output", output,
    "--model-dir", whisperModels,
    ...(limitDuration ? ["--duration", String(duration)] : []),
  ], {
    onOutput: async (chunk) => {
      markerBuffer += chunk;
      const lines = markerBuffer.split(/\r?\n/);
      markerBuffer = lines.pop() || "";
      for (const line of lines) {
        const percent = Number(line.match(/^PHOENIX_PROGRESS:(\d+)$/)?.[1]);
        if (Number.isFinite(percent)) {
          const mapped = Math.min(29, 17 + Math.floor(percent * 0.12));
          if (mapped > lastReported) {
            lastReported = mapped;
            await onProgress(mapped, `Transcribing speech locally · ${Math.min(100, percent)}%`);
          }
        } else if (line === "PHOENIX_STATUS:model-ready") {
          await onProgress(Math.max(lastReported, 17), "Whisper model ready · starting local transcription");
        }
      }
    },
  });
  preflightCache = null;
  const completed = await cachedTranscript(output, duration, preflight.whisperModel.name);
  if (!completed) throw new Error("Whisper did not produce a complete transcript file.");
  await onProgress(30, completed.length ? "Local transcript complete" : "Transcription complete · no speech was detected");
  return completed;
}

function overlap(start: number, end: number, item: Silence) {
  return Math.max(0, Math.min(end, item.end) - Math.max(start, item.start));
}

function naturalBoundaries(quiet: Silence[], segments: TranscriptSegment[]) {
  const candidates: Array<{ time: number; kind: Exclude<BoundaryKind, "target"> }> = [];
  for (const item of quiet) candidates.push({ time: (item.start + item.end) / 2, kind: "silence" });
  for (const item of segments) candidates.push({ time: item.end, kind: "transcript" });
  return candidates;
}

function closestBoundary(
  candidates: ReturnType<typeof naturalBoundaries>,
  minimum: number,
  maximum: number,
  target: number,
) {
  const available = candidates.filter((candidate) => candidate.time >= minimum && candidate.time <= maximum);
  return available.sort((a, b) => {
    const aPenalty = Math.abs(a.time - target) - (a.kind === "silence" ? 3 : 0);
    const bPenalty = Math.abs(b.time - target) - (b.kind === "silence" ? 3 : 0);
    return aPenalty - bPenalty;
  })[0] || { time: target, kind: "target" as const };
}

/** Pure planner exported so boundary behavior can be regression-tested without rendering media. */
export function planCoverageCuts(duration: number, quiet: Silence[] = [], segments: TranscriptSegment[] = []): BaseCut[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (duration <= 180) return [{ start: 0, end: duration, boundary: "target" }];

  const natural = naturalBoundaries(quiet, segments);
  // Every duration of at least four minutes can be partitioned into 120–180 second clips.
  // The 181–239 second interval is mathematically impossible without a gap or overlap, so
  // it is split evenly while preserving the entire source.
  const strictRangePossible = duration >= 240;
  const minimumCount = Math.ceil(duration / 180);
  const maximumCount = Math.max(minimumCount, Math.floor(duration / 120));
  const count = strictRangePossible
    ? Math.max(minimumCount, Math.min(maximumCount, Math.round(duration / 150)))
    : 2;
  const points = [0];
  let start = 0;
  for (let index = 1; index < count; index += 1) {
    const remaining = count - index;
    const evenTarget = duration * index / count;
    const minimum = strictRangePossible
      ? Math.max(start + 120, duration - remaining * 180)
      : Math.max(start + 60, duration - remaining * 180);
    const maximum = strictRangePossible
      ? Math.min(start + 180, duration - remaining * 120)
      : Math.min(start + 180, duration - remaining * 60);
    const target = Math.max(minimum, Math.min(maximum, evenTarget));
    const selected = closestBoundary(natural, minimum, maximum, target);
    points.push(selected.time);
    start = selected.time;
  }
  points.push(duration);

  return points.slice(0, -1).map((startPoint, index) => {
    const endPoint = points[index + 1];
    const match = natural.find((candidate) => Math.abs(candidate.time - endPoint) < 0.001);
    return { start: startPoint, end: endPoint, boundary: match?.kind || "target" };
  });
}

function clipText(part: BaseCut, segments: TranscriptSegment[]) {
  return segments.filter((item) => {
    const midpoint = (item.start + item.end) / 2;
    return midpoint >= part.start && midpoint < part.end;
  });
}

function scoreCuts(base: BaseCut[], quiet: Silence[], segments: TranscriptSegment[], audioByCut: AudioState[]) {
  const scored = base.map((part, index): Cut => {
    const duration = part.end - part.start;
    const clipSegments = clipText(part, segments);
    const text = clipSegments.map((item) => item.text).join(" ");
    const transcriptWords = text.match(/[\p{L}\p{N}]+/gu)?.length || 0;
    const openingText = clipSegments
      .filter((item) => (item.start + item.end) / 2 < part.start + 20)
      .map((item) => item.text)
      .join(" ");
    const hookSignals = (text.match(hookPattern)?.length || 0) + (openingText.match(hookPattern)?.length || 0);
    const silenceSeconds = quiet.reduce((sum, item) => sum + overlap(part.start, part.end, item), 0);
    const silenceRatio = duration > 0 ? Math.min(1, silenceSeconds / duration) : 1;
    const audio = audioByCut[index] || { usable: false, mean: -99, max: -99 };
    const wordsPerMinute = duration > 0 ? transcriptWords / duration * 60 : 0;
    const confidenceSamples = clipSegments
      .map((segment) => {
        if (segment.avgLogprob === undefined && segment.noSpeechProbability === undefined) return null;
        const logProbability = segment.avgLogprob === undefined ? 0.65 : Math.max(0, Math.min(1, (segment.avgLogprob + 1.5) / 1.5));
        const speechProbability = segment.noSpeechProbability === undefined ? 0.8 : 1 - Math.max(0, Math.min(1, segment.noSpeechProbability));
        return (logProbability + speechProbability) / 2;
      })
      .filter((value): value is number => value !== null);
    const transcriptConfidence = confidenceSamples.length
      ? confidenceSamples.reduce((sum, value) => sum + value, 0) / confidenceSamples.length
      : (transcriptWords ? 0.65 : 0);
    const hookScore = Math.min(22, hookSignals * 5);
    const transcriptScore = Math.min(23, wordsPerMinute / 9 + transcriptConfidence * 7);
    const silenceScore = Math.max(0, 20 * (1 - silenceRatio * 2.2));
    const audioScore = audio.usable ? Math.max(8, Math.min(20, 20 - Math.abs(-20 - audio.mean) * 0.45)) : 0;
    const durationScore = Math.max(0, 15 - Math.abs(150 - duration) / 5);
    const score = Math.max(1, Math.min(100, Math.round(hookScore + transcriptScore + silenceScore + audioScore + durationScore)));
    return { ...part, score, rank: 0, metrics: { hookSignals, transcriptWords, transcriptConfidence, silenceRatio, audio } };
  });
  [...scored].sort((a, b) => b.score - a.score || a.start - b.start).forEach((part, index) => {
    part.rank = index + 1;
  });
  return scored;
}

/** Pure ranking hook for regression tests and future score-breakdown UI. */
export function rankSourceCutCandidates(
  base: BaseCut[],
  quiet: Silence[],
  segments: TranscriptSegment[],
  audioByCut: AudioState[],
) {
  return scoreCuts(base, quiet, segments, audioByCut);
}

function chooseCuts(scored: Cut[], mode: ProcessingMode, sourceDuration: number) {
  if (mode === "coverage") return scored;
  const count = Math.min(scored.length, Math.max(1, Math.min(8, Math.round(sourceDuration / 420))));
  return [...scored]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, count)
    // Review files are prepended to the index, so render the weakest selected
    // candidate first and rank 1 last. The highest-ranked result then appears first.
    .sort((a, b) => b.rank - a.rank);
}

function words(text: string) {
  const stop = new Set(["about", "after", "also", "and", "are", "because", "been", "being", "but", "can", "could", "did", "does", "for", "from", "had", "has", "have", "her", "here", "him", "his", "how", "into", "its", "just", "like", "more", "not", "only", "our", "out", "she", "some", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "through", "too", "very", "was", "were", "what", "when", "where", "which", "who", "will", "with", "would", "you", "your"]);
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []) {
    if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([word]) => word);
}

function splitCaptionLines(text: string) {
  const sourceWords = text.replace(/[{}<>\u0000]/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of sourceWords) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && (candidate.length > 38 || line.split(" ").length >= 7)) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  const cues: string[][] = [];
  for (let index = 0; index < lines.length; index += 2) cues.push(lines.slice(index, index + 2));
  return cues;
}

export function buildCaptionCues(part: BaseCut, segments: TranscriptSegment[]) {
  const source = clipText(part, segments);
  const cues: CaptionCue[] = [];
  let previousKey = "";
  for (const segment of source) {
    const lineGroups = splitCaptionLines(segment.text);
    const start = Math.max(part.start, segment.start);
    const end = Math.min(part.end, segment.end);
    const span = Math.max(0.35, end - start);
    lineGroups.forEach((lines, index) => {
      const key = lines.join(" ").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!key || key === previousKey) return;
      previousKey = key;
      const cueStart = start + span * index / lineGroups.length;
      const cueEnd = start + span * (index + 1) / lineGroups.length;
      cues.push({
        start: Math.max(0, cueStart - part.start),
        end: Math.min(part.end - part.start, Math.max(cueStart + 0.35, cueEnd) - part.start),
        lines,
      });
    });
  }
  const safeCues: CaptionCue[] = [];
  for (const cue of cues.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const start = Math.max(cue.start, safeCues.at(-1)?.end || 0);
    const end = Math.min(part.end - part.start, Math.max(start + 0.35, cue.end));
    if (end > start) safeCues.push({ ...cue, start, end });
  }
  return safeCues;
}

/** Posting descriptions are never substituted for spoken words. Decide per output interval. */
export function automaticSubtitles(part: BaseCut, segments: TranscriptSegment[], audioPreserved: boolean, analysisError?: string) {
  if (!audioPreserved) return { cues: [] as CaptionCue[], decision: "none" as const, reason: "No source speech is audible in the output: source audio was absent or replaced with music." };
  if (analysisError) return { cues: [] as CaptionCue[], decision: "uncertain" as const, reason: analysisError };
  const candidates = clipText(part, segments);
  const reliable = candidates.filter(segment => typeof segment.avgLogprob === "number" && segment.avgLogprob >= -0.9
    && typeof segment.noSpeechProbability === "number" && segment.noSpeechProbability < 0.45
    && /[\p{L}\p{N}]/u.test(segment.text) && !/^\s*[\[(].*[\])]\s*$/.test(segment.text));
  const cues = buildCaptionCues(part, reliable);
  return cues.length ? { cues, decision: "speech" as const, reason: "Subtitles added only for locally detected, confidently transcribed speech; check recognition accuracy before posting." }
    : { cues, decision: candidates.length ? "uncertain" as const : "none" as const, reason: candidates.length ? "Speech recognition was uncertain. No guessed subtitles were burned in; review the audio." : "No confident speech was detected in this interval. No subtitles were added." };
}

function srtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const secs = Math.floor(milliseconds % 60_000 / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

function clipSrt(cues: CaptionCue[]) {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.lines.join("\n")}\n`).join("\n");
}

/** Use output-pixel coordinates; SRT's implicit 384x288 canvas inflated portrait captions. */
export function sourceCaptionAss(cues: CaptionCue[], width: number, height: number) {
  const font = Math.round(Math.min(width, height) * 0.042);
  const margin = Math.round(width * 0.07);
  const stamp = (seconds: number) => {
    const cs = Math.max(0, Math.round(seconds * 100));
    return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,${font},&H00FFFFFF,&H00FFFFFF,&H00202020,&H88000000,0,0,0,0,100,100,0,0,1,2,1,2,${margin},${margin},${Math.round(height * 0.08)},1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n` + cues.map(cue => `Dialogue: 0,${stamp(cue.start)},${stamp(cue.end)},Default,,0,0,0,,${cue.lines.map(line => line.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/[\r\n]+/g, " ")).join("\\N")}`).join("\n");
}

function summary(title: string, text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean ? `${clean.slice(0, 210)}${clean.length > 210 ? "…" : ""}` : `${title} — review this visual segment before posting.`;
}

function formatFor(info: MediaInfo) {
  if (info.height >= info.width * 1.15) {
    return { name: "9:16" as const, width: 720, height: 1280, filter: "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=#101710" };
  }
  if (info.width >= info.height * 1.15) {
    return { name: "16:9" as const, width: 1280, height: 720, filter: "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#101710" };
  }
  const factor = Math.min(1, 720 / Math.max(info.width, info.height));
  const width = Math.max(2, Math.floor(info.width * factor / 2) * 2), height = Math.max(2, Math.floor(info.height * factor / 2) * 2);
  return { name: "original" as const, width, height, filter: `scale=${width}:${height}` };
}

function clipSignature(job: SourceJob, part: Cut, format: string, cues: CaptionCue[]) {
  return crypto.createHash("sha256").update(JSON.stringify({
    version: 6,
    jobId: job.id,
    start: part.start.toFixed(3),
    end: part.end.toFixed(3),
    format,
    stockPlan: job.stockSource ? { shots: job.stockSource.shots, options: job.stockSource.options, editVersion: job.stockSource.editVersion, audioPolicy: job.stockSource.shots?.length ? "section-aware-v1" : undefined } : undefined,
    audio: part.metrics.audio.usable ? "normalized-source" : "local-music",
    captions: cues.map((cue) => [cue.start.toFixed(3), cue.end.toFixed(3), cue.lines]),
  })).digest("hex").slice(0, 20);
}

function deterministicReviewId(signature: string) {
  const hash = crypto.createHash("sha256")
    .update(`source-processing-v3\0${signature}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function reusableReview(file: ReviewFile | undefined, signature: string) {
  return Boolean(
    file?.status === "READY"
    && file.processing?.status === "COMPLETED"
    && file.quality.checks.includes(`Pipeline signature ${signature}`),
  );
}

function reviewMatches(file: ReviewFile, jobId: string, part: BaseCut, format: string) {
  return file.processing?.jobId === jobId
    && Math.abs(file.processing.start - part.start) < 0.05
    && Math.abs(file.processing.end - part.end) < 0.05
    && file.processing.format === format;
}

function findMatchingReview(files: ReviewFile[], job: SourceJob, part: BaseCut, format: string, used: Set<string>) {
  const matches = files.filter((file) => !used.has(file.id) && reviewMatches(file, job.id, part, format));
  return matches.sort((a, b) => {
    const aKnown = job.reviewIds.indexOf(a.id);
    const bKnown = job.reviewIds.indexOf(b.id);
    if (aKnown >= 0 || bKnown >= 0) return (aKnown < 0 ? Number.MAX_SAFE_INTEGER : aKnown) - (bKnown < 0 ? Number.MAX_SAFE_INTEGER : bKnown);
    return Number(b.status === "READY") - Number(a.status === "READY");
  })[0];
}

async function validOutput(file: string, expectedDuration: number, minDuration?: number) {
  try {
    const stat = await fs.stat(file);
    if (stat.size < 1024) return null;
    const info = await probe(file);
    if (!info.width || !info.height || !info.hasAudio || Math.abs(info.duration - expectedDuration) > 2) return null;
    assertStockReelMinimum(info.videoDuration, minDuration);
    return info;
  } catch {
    return null;
  }
}

async function replaceFile(temporary: string, destination: string) {
  await fs.rm(destination, { force: true });
  await fs.rename(temporary, destination);
}

async function copyFileAtomically(source: string, destination: string) {
  const temporary = `${destination}.partial-${crypto.randomUUID()}`;
  try {
    await fs.copyFile(source, temporary);
    await replaceFile(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function renderClip(
  source: string,
  item: ReviewFile,
  part: Cut,
  format: ReturnType<typeof formatFor>,
  cues: CaptionCue[],
  clipDirectory: string,
  onProgress: (fraction: number) => Promise<unknown>,
  stockAudio?: { mood: StockReelOptions["mood"]; seed: string },
) {
  await fs.mkdir(clipDirectory, { recursive: true });
  const duration = part.end - part.start;
  const subtitlePath = path.join(clipDirectory, "captions.srt");
  if (cues.length) await fs.writeFile(subtitlePath, clipSrt(cues), "utf8");
  if (cues.length) await fs.writeFile(path.join(clipDirectory, "captions.ass"), sourceCaptionAss(cues, format.width, format.height), "utf8");
  const musicPath = path.join(clipDirectory, "music.wav");
  if (!part.metrics.audio.usable) await fs.writeFile(musicPath, stockAudio ? stockMusicWav(duration, stockAudio.mood, stockAudio.seed) : localMusicWav(duration, false));

  // A posting description is never an overlay or invented speech caption.
  const subtitleFilter = cues.length ? ",ass=captions.ass" : "";
  const destination = outputPath(item.id, "instagram");
  const temporary = `${destination}.partial-${crypto.randomUUID()}.mp4`;
  const args = ["-y", ...FFMPEG_FILTER_RESOURCE_ARGS, "-ss", part.start.toFixed(3), "-t", duration.toFixed(3), "-threads", "1", "-i", source];
  if (!part.metrics.audio.usable) args.push("-i", musicPath);
  args.push("-vf", `${format.filter}${stockAudio ? `,fps=${STOCK_REEL_FPS},setpts=PTS-STARTPTS` : ""}${subtitleFilter}`, "-map", "0:v:0", "-map", part.metrics.audio.usable ? "0:a:0" : "1:a:0");
  // Bound time, not encoded picture count: a frame ceiling can cut off AAC's
  // final packets on the captioned/incompatible stock re-encode path as well.
  if (stockAudio) args.push("-r", String(STOCK_REEL_FPS), "-t", duration.toFixed(3));
  if (part.metrics.audio.usable) args.push("-af", stockAudio ? "alimiter=limit=0.97:level=false" : "loudnorm=I=-16:TP=-1.5:LRA=11");
  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    ...FFMPEG_ENCODER_RESOURCE_ARGS,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    temporary,
  );

  let progressBuffer = "";
  let lastPercent = -1;
  try {
    await run(ffmpegPath, args, {
      cwd: clipDirectory,
      onOutput: async (chunk, channel) => {
        if (channel !== "stdout") return;
        progressBuffer += chunk;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || "";
        for (const line of lines) {
          const match = line.match(/^out_time=(\d+):(\d+):([0-9.]+)$/);
          if (!match) continue;
          const rendered = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          const percent = Math.max(0, Math.min(99, Math.floor(rendered / duration * 100)));
          if (percent >= lastPercent + 3) {
            lastPercent = percent;
            await onProgress(percent / 100);
          }
        }
      },
    });
    await replaceFile(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  const youtube = outputPath(item.id, "youtube");
  await copyFileAtomically(destination, youtube);
  const [instagramInfo, youtubeInfo] = await Promise.all([
    validOutput(destination, duration),
    validOutput(youtube, duration),
  ]);
  if (!instagramInfo || !youtubeInfo) throw new Error("The rendered clip did not pass local duration, video, and audio validation.");
  item.artifacts = { version: 1, renderRevision: "source-artifacts-v1", finalVideo: artifactReference(destination),
    editing: { video: artifactReference(source), offsetSeconds: part.start, captionsBaked: false, replacementAudio: part.metrics.audio.usable ? undefined : artifactReference(musicPath) },
    captions: cues.length ? artifactReference(subtitlePath) : undefined, original: artifactReference(source), music: part.metrics.audio.usable ? undefined : artifactReference(musicPath) };
  return { destination, youtube, instagramInfo, youtubeInfo };
}

function clipReason(part: Cut) {
  const { hookSignals, transcriptWords, transcriptConfidence, silenceRatio, audio } = part.metrics;
  const audioText = audio.usable ? `usable source audio (${audio.mean.toFixed(1)} dB mean)` : "weak or missing source audio";
  return `Ranked from ${hookSignals} weighted hook signal${hookSignals === 1 ? "" : "s"}, ${transcriptWords} transcript words at ${Math.round(transcriptConfidence * 100)}% estimated clarity, ${Math.round(silenceRatio * 100)}% detected silence, and ${audioText}. This is a recommendation, not a promise of views.`;
}

function buildReviewItem(
  job: SourceJob,
  part: Cut,
  format: ReturnType<typeof formatFor>,
  cues: CaptionCue[],
  existing?: ReviewFile,
  subtitles?: ReviewFile["quality"]["subtitles"],
) {
  const signature = clipSignature(job, part, format.name, cues);
  const readableCaptions = cues.map((cue) => cue.lines.join(" "));
  const copyText = readableCaptions.join(" ");
  const keywords = words(`${job.title} ${copyText}`).slice(0, 5);
  const titleWords = copyText.split(/\s+/).filter(Boolean).slice(0, 9);
  const clipTitle = titleWords.length >= 4
    ? titleWords.join(" ").replace(/[.,!?]+$/, "").trim()
    : `${job.title} — clip ${part.rank}`;
  const audioDecision = part.metrics.audio.usable ? "natural-audio-preserved" as const : "local-music-replaced" as const;
  const item: ReviewFile = makeReviewFile({
    title: clipTitle,
    targets: ["instagram", "youtube"],
    source: job.stockSource ? { kind: job.stockSource.provider, filename: job.sourceFile, providerUrl: job.stockSource.sourcePage, providerMediaId: job.stockSource.mediaId, licence: `${job.stockSource.provider === "pexels" ? "Pexels License" : "Pixabay Content License"} · ${job.stockSource.creator} · verify reuse rights before posting`, downloadedAt: job.createdAt } : { kind: "upload", filename: job.sourceFile, licence: "Local file supplied by studio owner" },
    audience: "general",
    quality: {
      sourceDuration: part.end - part.start,
      audio: audioDecision,
      captions: readableCaptions,
      subtitles,
      postingTextOrigin: job.stockSource?.caption.trim() ? "owner" : "automatic",
      hashtags: ["#Shorts", "#PhoenixStudio", ...keywords.map((word) => `#${word[0].toUpperCase()}${word.slice(1)}`)].slice(0, 8),
      postCopy: job.stockSource ? job.stockSource.caption : `${summary(clipTitle, copyText)} Prepared for ${socialHandle("instagram")} and YouTube Shorts.`,
      checks: [
        `${job.mode === "coverage" ? "Contiguous coverage" : "Highlight candidate"} ${part.start.toFixed(3)}s–${part.end.toFixed(3)}s`,
        `End boundary selected from ${part.boundary === "target" ? "the balanced duration target" : part.boundary}`,
        `Attention score ${part.score}/100 · rank ${part.rank}`,
        part.metrics.audio.usable
          ? `This clip's source audio was preserved and normalized (${part.metrics.audio.mean.toFixed(1)} dB mean before normalization)`
          : "This clip's weak or missing source audio was replaced with a locally generated music bed",
        subtitles?.reason || (cues.length
          ? `${cues.length} readable, de-duplicated caption cue${cues.length === 1 ? "" : "s"} transcribed locally with Whisper`
          : "No speech caption cues were available for this interval"),
        `Pipeline signature ${signature}`,
      ],
      warning: part.metrics.audio.usable
        ? undefined
        : "Source audio in this clip was weak or missing, so Phoenix replaced it with a locally generated music bed.",
    },
    processing: {
      jobId: job.id,
      start: part.start,
      end: part.end,
      format: format.name,
      score: part.score,
      rank: part.rank,
      reason: job.stockSource ? "Real stock footage; subtitles depend on speech detection, not the stock title. Attention potential has not been assessed; check composition, sound and relevance yourself." : clipReason(part),
      status: "PROCESSING",
    },
    monetizationReview: {
      status: "NOT_REVIEWED",
      madeForKids: false,
      originality: job.stockSource ? "licensed-transformed" : "owner-supplied",
      rightsBasis: job.stockSource ? `Provider source retained: ${job.stockSource.sourcePage}. A stock licence does not guarantee originality or monetization eligibility.` : "Source episode supplied locally by the studio owner; ownership and upload rights must be confirmed manually.",
      checks: ["Confirm ownership or commercial reuse rights for the source episode", "Watch the complete clip and captions before posting", "Confirm any music and voices in the source are cleared for the target platform"],
      manualReviewRequired: true,
      syntheticDisclosureReview: "NOT_APPLICABLE",
      warning: job.stockSource ? "Review provider rights and any identifiable people, brands or music. A captioned stock clip is not guaranteed to qualify for monetization." : "Phoenix cannot verify ownership of an uploaded episode. Confirm commercial rights before posting.",
    },
  });
  item.id = existing?.id || deterministicReviewId(signature);
  if (existing?.artifacts) item.artifacts = existing.artifacts;
  if (existing && reusableReview(existing, signature)) {
    item.quality.postingAnalysis = existing.quality.postingAnalysis;
    item.quality.postingTextOrigin = existing.quality.postingTextOrigin
      ?? (existing.quality.postingAnalysis ? "automatic" : item.quality.postingTextOrigin);
    item.quality.postCopy = existing.quality.postCopy;
    item.quality.hashtags = existing.quality.hashtags;
  }
  if (existing) item.createdAt = existing.createdAt;
  item.updatedAt = new Date().toISOString();
  return item;
}

export async function createSourceJob(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  mode: ProcessingMode,
  title?: string,
  expectedBytes?: number,
  stockSource?: SourceJob["stockSource"],
) {
  if (stockSource) {
    try {
      const existing = await findStockSourceJob(stockSource.requestId);
      if (existing) { await stream.cancel().catch(() => undefined); return existing; }
      validateStockReusePolicy(stockSource.options);
      assertStockReuseAvailable(stockReuseShots(stockSource), await readJobsUnlocked());
    } catch (error) {
      await stream.cancel().catch(() => undefined);
      throw error;
    }
  }
  await ensure();
  if (expectedBytes && expectedBytes > MAX_SOURCE_BYTES) throw new SourceUploadTooLargeError();
  const id = crypto.randomUUID();
  const name = safeFilename(filename);
  const source = sourcePath(id, name);
  const limiter = new SourceByteLimitTransform(stockSource ? 500 * 1024 * 1024 : MAX_SOURCE_BYTES);
  try {
    await pipeline(Readable.fromWeb(stream as never), limiter, createWriteStream(source, { flags: "wx" }));
    const stat = await fs.stat(source);
    if (!stat.size) throw new Error("The uploaded video was empty.");
    if (expectedBytes && stat.size !== expectedBytes) throw new SourceUploadInterruptedError(stat.size, expectedBytes);
    const now = new Date().toISOString();
    const job: SourceJob = {
      stockSource,
      id,
      title: title?.trim() || filename.replace(/\.[^.]+$/, ""),
      sourceFile: name,
      mode,
      status: "QUEUED",
      progress: 1,
      stage: "Upload verified · waiting in the FIFO queue",
      createdAt: now,
      updatedAt: now,
      completedClips: 0,
      totalClips: 0,
      reviewIds: [],
      attempts: 0,
      queuedAt: now,
    };
    const accepted = await withJobMutation(async () => {
      const jobs = await readJobsUnlocked();
      if (stockSource) {
        const existing = jobs.find(item => item.stockSource?.requestId === stockSource.requestId);
        if (existing?.archivedAt || existing?.status === "CANCELLED") throw new JobHistoryConflictError("This stock request was cancelled or removed. Start a new request.");
        if (existing) return existing;
        assertStockReuseAvailable(stockReuseShots(stockSource), jobs);
      }
      jobs.unshift(job);
      await saveJobsUnlocked(jobs);
      return job;
    });
    if (accepted.id !== job.id) await fs.rm(source, { force: true }); // This attempt's duplicate staging file only.
    return accepted;
  } catch (error) {
    await fs.rm(source, { force: true }).catch(() => undefined);
    throw error;
  }
}

export type StockReelDownload = Omit<StockReelShot, "sourceFile"> & {
  open: () => Promise<{ stream: ReadableStream<Uint8Array>; expectedBytes?: number }>;
};

/** Downloads one source at a time directly to disk, with one aggregate budget and FIFO job. */
export async function createStockReelJob(
  downloads: StockReelDownload[],
  input: { requestId: string; caption: string; theme: string; maxDuration: number; options: StockReelOptions; managerGuidance?: ReviewFile["quality"]["managerGuidance"] },
) {
  if (!downloads.length || downloads.length > MAX_STOCK_SHOTS) throw new Error(`Choose one to ${MAX_STOCK_SHOTS} related source shots.`);
  if (downloads.some(shot => shot.trimMode !== undefined && shot.trimMode !== "auto" && shot.trimMode !== "manual")) throw new Error("A source shot has an invalid trim mode.");
  // The API resolves the actual provider duration. Check interval/pacing shape
  // again here before opening streams; decoded source duration is checked later.
  const previous = await findStockSourceJob(input.requestId);
  if (previous) return previous;
  validateStockReusePolicy(input.options);
  assertStockReuseAvailable(downloads, await readJobsUnlocked());
  planStockIntervals(downloads.map(shot => ({ duration: shot.end, start: shot.start, end: shot.end, trimMode: shot.trimMode })), input.maxDuration, input.options.pacing, input.options.minDuration, input.options.shotCadence);
  await ensure();
  const id = crypto.randomUUID(), staged: string[] = [], shots: StockReelShot[] = [];
  let bytes = 0;
  try {
    for (let index = 0; index < downloads.length; index += 1) {
      const shot = downloads[index], filename = safeFilename(`shot-${index + 1}-${shot.provider}-${shot.mediaId}.mp4`), destination = sourcePath(id, filename);
      const { stream, expectedBytes } = await shot.open();
      if (expectedBytes && expectedBytes > MAX_STOCK_REEL_BYTES - bytes) { await stream.cancel(); throw new SourceUploadTooLargeError(MAX_STOCK_REEL_BYTES); }
      const limiter = new SourceByteLimitTransform(MAX_STOCK_REEL_BYTES - bytes);
      staged.push(destination);
      await pipeline(Readable.fromWeb(stream as never), limiter, createWriteStream(destination, { flags: "wx" }));
      if (!limiter.bytes) throw new Error("One provider returned an empty video.");
      if (expectedBytes && limiter.bytes !== expectedBytes) throw new SourceUploadInterruptedError(limiter.bytes, expectedBytes);
      bytes += limiter.bytes;
      shots.push({ provider: shot.provider, mediaId: shot.mediaId, sourcePage: shot.sourcePage, creator: shot.creator, title: shot.title, start: shot.start, end: shot.end, trimMode: shot.trimMode, sourceFile: filename });
    }
    const now = new Date().toISOString(), first = shots[0];
    const job: SourceJob = {
      id, title: input.caption || input.theme || first.title, sourceFile: first.sourceFile,
      stockSource: { provider: first.provider, mediaId: first.mediaId, sourcePage: first.sourcePage, creator: first.creator, requestId: input.requestId, caption: input.caption, theme: input.theme, maxDuration: input.maxDuration, options: input.options, shots, ...(input.options.pacing !== undefined ? { editVersion: STOCK_REEL_EDIT_VERSION } : {}), ...(input.managerGuidance ? { managerGuidance: input.managerGuidance } : {}) },
      mode: "coverage", status: "QUEUED", progress: 1, stage: `${shots.length} source shot${shots.length === 1 ? "" : "s"} verified · waiting in the FIFO queue`, createdAt: now, updatedAt: now, completedClips: 0, totalClips: 1, reviewIds: [], attempts: 0, queuedAt: now,
    };
    const accepted = await withJobMutation(async () => {
      const jobs = await readJobsUnlocked(), duplicate = jobs.find(item => item.stockSource?.requestId === input.requestId);
      if (duplicate?.archivedAt || duplicate?.status === "CANCELLED") throw new JobHistoryConflictError("This stock request was cancelled or removed. Start a new request.");
      if (duplicate) return duplicate;
      assertStockReuseAvailable(shots, jobs);
      jobs.unshift(job); await saveJobsUnlocked(jobs); return job;
    });
    if (accepted.id !== id) for (const filename of staged) await fs.rm(filename, { force: true });
    return accepted;
  } catch (error) {
    for (const filename of staged) await fs.rm(filename, { force: true }).catch(() => undefined);
    throw error;
  }
}

function processIsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireProcessorLease() {
  const token = crypto.randomUUID();
  const acquired = await withJobMutation(async () => {
    const payload = JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() });
    try {
      await fs.writeFile(processorLockPath, payload, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const [raw, stat] = await Promise.all([
        fs.readFile(processorLockPath, "utf8").catch(() => ""),
        fs.stat(processorLockPath).catch(() => null),
      ]);
      let owner: { pid?: number; token?: string } = {};
      try {
        owner = JSON.parse(raw) as { pid?: number; token?: string };
      } catch {
        // A fresh unreadable lock is treated as active below.
      }
      const fresh = Boolean(stat && Date.now() - stat.mtimeMs < 120_000);
      if (processIsAlive(Number(owner.pid)) || (!owner.pid && fresh)) return false;
      await fs.rm(processorLockPath, { force: true });
      await fs.writeFile(processorLockPath, payload, { encoding: "utf8", flag: "wx" });
      return true;
    }
  });
  if (!acquired) return null;

  const heartbeat = setInterval(() => {
    void fs.utimes(processorLockPath, new Date(), new Date()).catch(() => undefined);
  }, 15_000);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    const raw = await fs.readFile(processorLockPath, "utf8").catch(() => "");
    try {
      const owner = JSON.parse(raw) as { token?: string };
      if (owner.token === token) await fs.rm(processorLockPath, { force: true });
    } catch {
      // Never remove a lock that can no longer be proven to be ours.
    }
  };
}

async function recoverInterruptedJobs() {
  await withJobMutation(async () => {
    const jobs = await readJobsUnlocked();
    let changed = false;
    for (let index = 0; index < jobs.length; index += 1) {
      if (jobs[index].archivedAt || jobs[index].status !== "PROCESSING") continue;
      jobs[index] = {
        ...jobs[index],
        status: "QUEUED",
        stage: jobs[index].completedClips > 0
          ? `Recovered after processor restart · ${jobs[index].completedClips} completed clip${jobs[index].completedClips === 1 ? "" : "s"} will be reused`
          : "Recovered after processor restart · queued from the beginning",
        error: undefined,
        finishedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    }
    if (changed) await saveJobsUnlocked(jobs);
  });
}

async function claimOldestQueuedJob() {
  return withJobMutation(async () => {
    const jobs = await readJobsUnlocked();
    const queued = jobs
      .filter((item) => !item.archivedAt && item.status === "QUEUED")
      .sort((a, b) => Date.parse(a.queuedAt || a.createdAt) - Date.parse(b.queuedAt || b.createdAt) || a.id.localeCompare(b.id))[0];
    if (!queued) return null;
    const index = jobs.findIndex((item) => item.id === queued.id);
    const now = new Date().toISOString();
    jobs[index] = {
      ...queued,
      status: "PROCESSING",
      progress: Math.max(queued.progress, 2),
      stage: "Checking local processing dependencies",
      error: undefined,
      startedAt: now,
      finishedAt: undefined,
      attempts: (queued.attempts || 0) + 1,
      attemptStartedProgress: queued.progress,
      updatedAt: now,
    };
    await saveJobsUnlocked(jobs);
    return jobs[index];
  });
}

export type StockMusicSection = { start: number; end: number; gain: number; original: boolean };

/** Keep each quiet original above its bed without muting unrelated silent shots. */
export function stockReelMusicSections(intervals: Pick<StockInterval, "outputStart" | "outputEnd">[], states: AudioState[], preserveOriginal: boolean, silentOnly = false): StockMusicSection[] {
  if (!intervals.length || intervals.length !== states.length) throw new Error("Music mixing needs one measured audio state per selected interval.");
  let end = 0;
  return intervals.map((interval, index) => {
    if (!Number.isFinite(interval.outputStart) || !Number.isFinite(interval.outputEnd) || interval.outputEnd <= interval.outputStart || Math.abs(interval.outputStart - end) > .000001) throw new Error("Music mixing intervals must form one contiguous reel.");
    end = interval.outputEnd;
    const state = states[index], original = preserveOriginal && state.usable;
    if (original && !Number.isFinite(state.mean)) throw new Error("Original ambience needs a finite sound measurement before mixing.");
    return { start: interval.outputStart, end, gain: original ? silentOnly ? 0 : stockMusicMixGain([state.mean]) : 1, original };
  });
}

/** Volume is evaluated per audio frame. Ramps never rise over a quiet source. */
export function stockReelMusicVolume(sections: StockMusicSection[]) {
  if (!sections.length) throw new Error("Music volume needs a selected interval.");
  const fixed = (value: number) => value.toFixed(6);
  let next = fixed(sections[sections.length - 1].gain);
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index];
    if (!Number.isFinite(section.gain) || section.gain < 0 || section.gain > 1 || !Number.isFinite(section.start) || !Number.isFinite(section.end) || section.end <= section.start) throw new Error("Music volume has an invalid interval or gain.");
    const ramp = Math.min(.18, (section.end - section.start) / 4);
    const before = index ? Math.min(section.gain, sections[index - 1].gain) : section.gain;
    const after = index + 1 < sections.length ? Math.min(section.gain, sections[index + 1].gain) : section.gain;
    let level = fixed(section.gain);
    if (after !== section.gain) level = `if(gt(t,${fixed(section.end - ramp)}),${fixed(section.gain)}+(${fixed(after - section.gain)})*clip((t-${fixed(section.end - ramp)})/${fixed(ramp)},0,1),${level})`;
    if (before !== section.gain) level = `if(lt(t,${fixed(section.start + ramp)}),${fixed(before)}+(${fixed(section.gain - before)})*clip((t-${fixed(section.start)})/${fixed(ramp)},0,1),${level})`;
    next = `if(lt(t,${fixed(section.end)}),${level},${next})`;
  }
  return `volume='${next}':eval=frame`;
}

/** Only Phoenix's already encoded stock assembly may bypass a second encode. */
export function canRemuxStockAssembly(job: Pick<SourceJob, "stockSource">, cues: CaptionCue[], media: MediaInfo, duration: number) {
  return Boolean(job.stockSource?.shots?.length && !cues.length && Number.isFinite(duration) && duration > 0
    && Number.isFinite(media.duration) && Math.abs(media.duration - duration) <= Math.max(.1, 2 / STOCK_REEL_FPS)
    && media.width === 720 && media.height === 1280 && media.hasAudio
    && media.videoCodec === "h264" && media.pixelFormat === "yuv420p" && media.frameRate === STOCK_REEL_FPS
    && media.audioCodec === "aac" && media.audioSampleRate === 48000 && media.audioChannels === 2);
}

export function stockAssemblyRemuxArgs(source: string, destination: string) {
  return ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "+faststart", destination];
}

/** Automatic minimum-length windows leave genuine decoder context at picture EOF. */
export function stockSourcePictureInterval(
  shot: Pick<StockReelShot, "start" | "end" | "trimMode">,
  info: Pick<MediaInfo, "duration" | "videoDuration" | "frameRate">,
  minDuration?: number,
  number = 1,
) {
  const actualDuration = minDuration !== undefined ? info.videoDuration
    : shot.trimMode === "auto" ? info.videoDuration ?? info.duration : info.duration;
  if (!actualDuration) throw new Error(`Source shot ${number} has no verifiable picture duration. The minimum reel length cannot be guaranteed from an audio-padded container.`);
  const knownRate = info.frameRate !== undefined && Number.isFinite(info.frameRate) && info.frameRate > 0;
  const rate = knownRate ? info.frameRate! : STOCK_REEL_FPS;
  // A whole-frame 24 fps source can supply an exact EOF interval without
  // losing a frame. Do not reject five genuine 8-second CFR sources. Other
  // cadence/unknown-rate sources need lookahead before EOF when resampling.
  const aligned = knownRate && Math.abs(rate - STOCK_REEL_FPS) < 1e-6
    && Math.abs(actualDuration * STOCK_REEL_FPS - Math.round(actualDuration * STOCK_REEL_FPS)) < 24e-6;
  const context = minDuration !== undefined && shot.trimMode === "auto" && !aligned ? 2 * Math.max(1 / rate, 1 / STOCK_REEL_FPS) : 0;
  const end = shot.trimMode === "auto" ? Math.min(shot.end, actualDuration - context) : shot.end;
  if (context && end <= shot.start) throw new Error(`Source shot ${number} is too short for a complete native-speed interval. Choose more related footage; no ending will be frozen or padded.`);
  return { duration: actualDuration, start: shot.start, end, trimMode: shot.trimMode };
}

async function processStockReel(
  job: SourceJob,
  preflight: SourceProcessingPreflight,
  report: (progress: number, stage: string, change?: Partial<SourceJob>) => Promise<unknown>,
) {
  const stock = job.stockSource!, options = { ...DEFAULT_STOCK_REEL_OPTIONS, ...stock.options, pacing: stock.options?.pacing };
  let shots = [...stock.shots!]; // Render order must never rewrite saved source provenance.
  const editVersion = stock.editVersion === STOCK_REEL_EDIT_VERSION ? STOCK_REEL_EDIT_VERSION : 1;
  const directory = path.join(workRoot, `source-${job.id}`, `stock-assembly-v${editVersion}`);
  await fs.mkdir(directory, { recursive: true });
  let infos: MediaInfo[] = [];
  for (let index = 0; index < shots.length; index += 1) {
    await report(6 + index / shots.length * 5, `Checking source shot ${index + 1} of ${shots.length}`);
    const info = await probe(sourcePath(job.id, shots[index].sourceFile));
    if (!info.duration || !info.width || !info.height) throw new Error(`Source shot ${index + 1} has no readable picture.`);
    infos.push(info);
  }
  let pictureBounds = shots.map((shot, index) => {
    // Every explicitly automatic recipe uses the downloaded picture bounds,
    // including older jobs without the newer minimum-length policy. Catalog
    // durations are often rounded up; those are not user-selected trims.
    return stockSourcePictureInterval(shot, infos[index], options.shotCadence === "adaptive-v2" ? 12 : options.minDuration, index + 1);
  });
  let motionWindows: StockMotionWindow[][] = shots.map(() => []);
  const sustainedMovement = options.continuity === "visual-v1";
  const greeneryFocus = sustainedMovement && options.sceneFocus === "greenery";
  let greeneryCheck: string | undefined;
  if (options.shotCadence === "adaptive-v2") {
    for (let index = 0; index < shots.length; index++) {
      await report(7 + index / shots.length * 5, `Sampling movement · shot ${index + 1} of ${shots.length} · no AI model loaded`);
      const filename = sourcePath(job.id, shots[index].sourceFile), stat = await fs.stat(filename);
      const cacheFile = path.join(directory, `motion-${index + 1}.json`);
      const identity = crypto.createHash("sha256").update(JSON.stringify({ version: greeneryFocus ? 4 : sustainedMovement ? 3 : 2, filename: shots[index].sourceFile, bytes: stat.size, modified: stat.mtimeMs, bounds: pictureBounds[index] })).digest("hex");
      try {
        const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
        if (cached.identity === identity && Array.isArray(cached.windows) && cached.windows.length <= 3 && cached.windows.every((window: StockMotionWindow) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.start >= pictureBounds[index].start && window.end <= pictureBounds[index].end && window.end > window.start && Number.isFinite(window.motion) && window.motion >= 0 && window.motion <= 255 && (!greeneryFocus || (Number.isFinite(window.greenFraction) && window.greenFraction! >= 0 && window.greenFraction! <= 1)))) {
          motionWindows[index] = cached.windows;
          continue;
        }
      } catch { /* An incomplete cache never blocks a fresh bounded sample. */ }
      for (const window of stockMotionSamples(pictureBounds[index].start, pictureBounds[index].end)) {
        try {
          if (greeneryFocus) {
            let bytes = 0;
            const chunks: Buffer[] = [];
            await run(ffmpegPath, stockGreeneryArgs(filename, window), { onStdoutBinary(chunk) {
              bytes += chunk.length;
              if (bytes > STOCK_COLOUR_MAX_BYTES) throw new Error("Tiny colour sample exceeded its bounded frame budget.");
              chunks.push(chunk);
            } });
            const evidence = stockGreeneryEvidence(Buffer.concat(chunks, bytes));
            if (evidence) motionWindows[index].push({ ...window, ...evidence });
            continue;
          }
          const measurement = await run(ffmpegPath, stockMotionArgs(filename, window));
          const score = sustainedMovement ? stockSustainedMotionScore(measurement) : stockMotionScore(measurement);
          if (score !== undefined) motionWindows[index].push({ ...window, motion: score });
        } catch { /* Keep unknown movement at native speed; never invent analysis. */ }
      }
      // Empty sampling is deliberately not cached: a retry may repair a tool
      // failure. Successful measurements are stable across interrupted renders.
      if (motionWindows[index].length) await fs.writeFile(cacheFile, JSON.stringify({ identity, windows: motionWindows[index] }));
    }
  }
  if (greeneryFocus) {
    const selection = stockGreenerySelection(motionWindows);
    const excluded = shots.filter((_shot, index) => !selection.indices.includes(index));
    if (selection.indices.length < 4) throw new Error("Not enough related greenery remains after checking tiny colour samples. Phoenix will not insert grey/sky-only filler or slow footage to pad the reel. Choose another starting video.");
    shots = selection.indices.map(index => shots[index]); infos = selection.indices.map(index => infos[index]);
    pictureBounds = selection.indices.map(index => pictureBounds[index]); motionWindows = selection.windows;
    greeneryCheck = selection.threshold !== undefined
      ? `Grounded greenery cue: sampled green-colour windows retained; ${excluded.length} source(s) omitted (${excluded.map(shot => `${shot.provider}:${shot.mediaId}`).join(", ") || "none"}); unknown samples remain unverified. Colour does not recognize plants, action, season or location`
      : "Greenery sampling unavailable; source context remains catalogue-only, without invented colour validation";
  }
  const rhythm = options.continuity === "visual-v1" && options.audio === "music" && options.musicVersion === 2
    ? { bpm: stockMusicArrangement(options.mood, job.id).bpm } : undefined;
  const plan = () => planStockIntervals(pictureBounds.map((bounds, index) => ({ ...bounds, ...(options.shotCadence === "adaptive-v2" ? { motionWindows: motionWindows[index] } : {}) })), stock.maxDuration, options.pacing, options.minDuration, options.shotCadence, rhythm);
  let intervals = plan(), continuityCheck: string | undefined, reordered = false;
  if (options.continuity === "visual-v1" && options.shotCadence === "adaptive-v2") {
    const appearances: Array<StockAppearancePair | undefined> = [];
    for (let index = 0; index < shots.length; index++) {
      await report(12, `Matching shot light and colour · ${index + 1} of ${shots.length} · tiny samples, no model`);
      const filename = sourcePath(job.id, shots[index].sourceFile), stat = await fs.stat(filename);
      const interval = intervals[index], cacheFile = path.join(directory, `appearance-${index + 1}.json`);
      const identity = crypto.createHash("sha256").update(JSON.stringify({ version: 1, filename: shots[index].sourceFile, bytes: stat.size, modified: stat.mtimeMs, start: interval.start, end: interval.end })).digest("hex");
      let pair: StockAppearancePair | undefined;
      try {
        const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
        if (cached.identity === identity && validStockAppearance(cached.pair?.opening) && validStockAppearance(cached.pair?.ending)) pair = cached.pair;
      } catch { /* A corrupt/missing cache cannot invent visual evidence. */ }
      if (!pair) {
        try {
          const opening = stockAppearance(await run(ffmpegPath, stockAppearanceArgs(filename, interval.start)));
          const ending = stockAppearance(await run(ffmpegPath, stockAppearanceArgs(filename, Math.max(interval.start, interval.end - .15))));
          if (opening && ending) {
            pair = { opening, ending };
            await fs.writeFile(cacheFile, JSON.stringify({ identity, pair }));
          }
        } catch { /* Unknown appearance retains the original catalogue order. */ }
      }
      appearances.push(pair);
    }
    const order = stockVisualOrder(appearances);
    const complete = appearances.every(Boolean);
    reordered = order.some((index, position) => index !== position);
    shots = order.map(index => shots[index]); infos = order.map(index => infos[index]);
    pictureBounds = order.map(index => pictureBounds[index]); motionWindows = order.map(index => motionWindows[index]);
    // Preserve the exact source boundaries that supplied the appearance samples.
    // Replanning here could shift endpoints/speeds after measuring their colours.
    intervals = reorderStockIntervals(intervals, order);
    continuityCheck = complete
      ? `Selected opening retained; companions ordered by sampled boundary light/colour similarity (source order ${order.map(index => index + 1).join(", ")}); this does not recognize subjects or verify one location`
      : "Visual continuity samples incomplete; catalogue order retained without guessing";
  }
  const duration = intervals[intervals.length - 1].outputEnd;
  const renderedStock = { ...stock, renderedShots: shots.map(shot => ({ provider: shot.provider, mediaId: shot.mediaId })) };
  const minimumPictureDuration = options.shotCadence === "adaptive-v2" ? duration : options.minDuration;
  const planIdentity = crypto.createHash("sha256").update(JSON.stringify({ version: editVersion, shots, options, intervals, audioPolicy: "section-aware-v1" })).digest("hex").slice(0, 24);
  const completed = (await readReviewFiles()).find(file => file.processing?.jobId === job.id && file.status === "READY" && file.processing.status === "COMPLETED" && file.quality.checks.includes(`Stock plan identity ${planIdentity}`));
  if (completed) {
    const instagram = outputPath(completed.id, "instagram"), youtube = outputPath(completed.id, "youtube");
    let first = await validOutput(instagram, duration, minimumPictureDuration), second = await validOutput(youtube, duration, minimumPictureDuration);
    if (first && !second) { await copyFileAtomically(instagram, youtube); second = await validOutput(youtube, duration, minimumPictureDuration); }
    if (second && !first) { await copyFileAtomically(youtube, instagram); first = await validOutput(instagram, duration, minimumPictureDuration); }
    if (first && second) {
      if (!completed.quality.postingTextOrigin && !completed.quality.postingAnalysis && stock.caption.trim()) {
        completed.quality.postingTextOrigin = "owner";
        await saveReviewFile(completed);
      }
      const finished = await updateJob(job.id, { status: "COMPLETED", stockSource: renderedStock, progress: 100, stage: "Verified and reused the completed real footage reel", duration: first.duration, completedClips: 1, totalClips: 1, reviewIds: [completed.id], error: undefined, finishedAt: new Date().toISOString() });
      await cleanupStockTemporaries(job.id);
      return finished;
    }
  }
  await report(12, `${shots.length} related shots in the chosen order · ${duration.toFixed(1)} seconds · no repeated filler`, { duration, width: 720, height: 1280, totalClips: 1 });
  const states: AudioState[] = [], cues: CaptionCue[] = [], subtitleDecisions: Array<ReturnType<typeof automaticSubtitles>> = [], framingChecks: string[] = [];
  const preserveOriginal = options.audio !== "music";
  for (let index = 0; index < shots.length; index += 1) {
    const interval = intervals[index], source = sourcePath(job.id, shots[index].sourceFile), info = infos[index], length = interval.outputEnd - interval.outputStart;
    const speed = interval.speed ?? 1, playback = stockPlaybackFilters(speed);
    await report(14 + index / shots.length * 30, `Preparing shot ${index + 1} of ${shots.length} · ${length.toFixed(1)}s cut${speed > 1 ? ` · ${speed}× speed` : ""}`);
    const measured = await audioState(source, info.hasAudio, interval.start, interval.end);
    measured.usable = stockAudioUsable(info.hasAudio, measured.mean, measured.max);
    states.push(measured);
    const frame = stockFraming(info, options.framing, options.background === "soft-v1"), fades = stockShotFades(length, index, shots.length, options.transition);
    framingChecks.push(`Shot ${index + 1}: ${frame.description}; ${interval.start.toFixed(3)}s–${interval.end.toFixed(3)}s${interval.speed !== undefined ? `; ${speed}× playback; ${motionWindows[index].length ? "sampled frame-delta movement" : "movement unknown, native speed retained"}` : ""} from ${shots[index].sourcePage}`);
    const shotFile = path.join(directory, `shot-${index + 1}.mp4`);
    const args = ["-y", "-hide_banner", "-loglevel", "error", ...FFMPEG_FILTER_RESOURCE_ARGS, "-ss", interval.start.toFixed(6)];
    // fps needs the next genuine source frame to decide the final 24 fps frame.
    // An input -t cuts that lookahead off at fractional EOF (29.97 fps sources
    // lost one frame). New minimum-length windows reserve real source context;
    // output -t below still bounds the selected native-speed picture and sound.
    if (options.minDuration === undefined && options.shotCadence !== "adaptive-v2") args.push("-t", length.toFixed(6));
    args.push("-threads", "1", "-i", source);
    if (!measured.usable) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    // The frame-quantized -t plus fps filter bounds the picture. A second
    // -frames:v ceiling can terminate FFmpeg before it finishes the sound.
    const pictureFilter = options.shotCadence === "adaptive-v2" ? `${playback.video},fps=${STOCK_REEL_FPS}` : `fps=${STOCK_REEL_FPS},setpts=PTS-STARTPTS`;
    args.push("-vf", `${frame.filter},${pictureFilter}${fades.video}`, "-map", "0:v:0", "-map", measured.usable ? "0:a:0" : "1:a:0", "-af", `${playback.audio}aresample=48000,apad,atrim=duration=${length.toFixed(6)},asetpts=PTS-STARTPTS${fades.audio}`, "-t", length.toFixed(6), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", ...FFMPEG_ENCODER_RESOURCE_ARGS, "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", "-video_track_timescale", "24000", shotFile);
    await run(ffmpegPath, args);
    if (options.minDuration !== undefined || options.shotCadence === "adaptive-v2") {
      const picture = (await probe(shotFile)).videoDuration;
      if (!picture || picture + 1e-6 < length) throw new Error(`Source shot ${index + 1} did not provide all ${interval.frames} planned picture frames. The reel was stopped without padding or slowing footage; choose a different starting video or a broader topic.`);
    }
    let transcript: TranscriptSegment[] = [], analysisError: string | undefined;
    if (preserveOriginal && measured.usable) {
      if (!preflight.dependencies.fasterWhisper || !preflight.whisperModel.cached || os.freemem() < 900 * 1024 * 1024) {
        analysisError = "Speech check unavailable: the cached local speech model or safe RAM headroom was missing. Review source sound; no guessed subtitles were added.";
      } else {
        // Transcribe only the interval actually used, avoiding the old first-N-seconds mismatch.
        const sample = path.join(directory, `speech-${index + 1}.wav`);
        try {
          // The rendered shot already has the chosen trim and atempo applied.
          // Sampling original source at output length dropped speech at 1.25×
          // and drifted cue times. Transcribe the exact output-time sound instead.
          await run(ffmpegPath, stockSpeechSampleArgs(shotFile, sample, length));
          transcript = await transcribe(sample, `${job.id}-stock-${planIdentity}-shot-${index + 1}`, true, length, (_progress, stage) => report(15 + index / shots.length * 30, `Shot ${index + 1}: ${stage}`), true);
        } catch { analysisError = "Local speech check failed. No guessed subtitles were added; review the source sound."; }
      }
    }
    const decision = automaticSubtitles({ start: 0, end: length, boundary: "target" }, transcript, preserveOriginal && measured.usable, analysisError);
    subtitleDecisions.push(decision);
    cues.push(...decision.cues.map(cue => ({ ...cue, start: cue.start + interval.outputStart, end: cue.end + interval.outputStart })));
  }
  // AAC packet padding can overstate each container's duration. Use the actual
  // frame-budget interval so concat does not accumulate gaps or change cadence.
  await fs.writeFile(path.join(directory, "shots.txt"), shots.map((_shot, index) => `file 'shot-${index + 1}.mp4'\nduration ${(intervals[index].outputEnd - intervals[index].outputStart).toFixed(6)}`).join("\n") + "\n", "utf8");
  const originalAssembly = path.join(directory, "original-assembly.mp4");
  await report(46, "Joining the selected real shots with their original sound");
  await run(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "1", "-i", "shots.txt", "-c", "copy", "-movflags", "+faststart", "original-assembly.mp4"], { cwd: directory });
  const anyOriginal = preserveOriginal && states.some(state => state.usable);
  const useMusic = options.audio === "music" || options.audio === "ambience-music" || (options.audio === "auto" && states.some(state => !state.usable));
  const musicSections = stockReelMusicSections(intervals, states, preserveOriginal, options.audio === "auto");
  const master = path.join(directory, "editable-master.mp4"), music = path.join(directory, "instrumental.wav");
  if (useMusic) {
    await report(49, `Composing a ${options.mood} instrumental for this reel${anyOriginal ? options.audio === "auto" ? " · only filling silent shot intervals" : " · keeping the original sound above it" : ""}`);
    await fs.writeFile(music, stockMusicWav(duration, options.mood, job.id, options.musicVersion));
    const args = ["-y", "-hide_banner", "-loglevel", "error", ...FFMPEG_FILTER_RESOURCE_ARGS, "-i", originalAssembly, "-i", music];
    if (anyOriginal) args.push("-filter_complex", `[1:a]${stockReelMusicVolume(musicSections)}[bed];[0:a][bed]amix=inputs=2:duration=longest:dropout_transition=0,volume=2,alimiter=limit=0.97:level=false[a]`, "-map", "0:v:0", "-map", "[a]");
    else args.push("-map", "0:v:0", "-map", "1:a:0");
    args.push("-t", duration.toFixed(6), "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", "-movflags", "+faststart", master);
    await run(ffmpegPath, args);
  } else await copyFileAtomically(originalAssembly, master);
  const part: Cut = { start: 0, end: duration, boundary: "target", rank: 1, score: 0, metrics: { hookSignals: 0, transcriptWords: 0, transcriptConfidence: 0, silenceRatio: 0, audio: { usable: true, mean: 0, max: 0 } } };
  const format = { name: "9:16" as const, width: 720, height: 1280, filter: "scale=720:1280,setsar=1" };
  const subtitleDecision: ReviewFile["quality"]["subtitles"] = { decision: cues.length ? "speech" : subtitleDecisions.some(item => item.decision === "uncertain") ? "uncertain" : "none", reason: `${cues.length ? "Only confident speech from the actual selected intervals is subtitled." : "No confidently recognized speech was added as subtitles."}${subtitleDecisions.some(item => item.decision === "uncertain") ? " Some source sound could not be confidently checked; review it." : ""}` };
  const files = await readReviewFiles(), existing = findMatchingReview(files, job, part, format.name, new Set());
  const item = buildReviewItem(job, part, format, cues, existing, subtitleDecision);
  if (stock.managerGuidance) item.quality.managerGuidance = stock.managerGuidance;
  const signature = clipSignature(job, part, format.name, cues), reuse = reusableReview(existing, signature);
  const retainedPosting = reuse ? { copy: existing?.quality.postCopy, hashtags: existing?.quality.hashtags } : undefined;
  const credits = shots.map((shot, index) => `Shot ${index + 1}: ${shot.creator} / ${shot.provider} — ${shot.sourcePage}`);
  item.title = job.title;
  item.quality.audio = anyOriginal ? "natural-audio-preserved" : useMusic ? "local-music-replaced" : "no-audio";
  item.quality.checks = [
    `Real footage reel: ${shots.length} shots in the ${options.shotCadence === "adaptive-v2" ? "manager-selected" : "owner-selected"} order, ${duration.toFixed(3)} seconds at ${STOCK_REEL_FPS} fps; ${options.shotCadence === "adaptive-v2" ? "native speed or bounded 1.25× acceleration from measured movement" : "original playback speed"}, no slowdown, frozen endings or duration looping`,
    "Coherence is based on the selected subject and catalogue-described scene context; sampled movement is not semantic continuity verification",
    ...(greeneryCheck ? [greeneryCheck] : []),
    ...(continuityCheck ? [continuityCheck, ...(rhythm ? [reordered
      ? `Measured source cut boundaries retained after colour ordering; final cuts are not claimed beat-aligned to the ${rhythm.bpm} BPM instrumental`
      : `Nearby internal cuts aligned within four picture frames to the actual ${rhythm.bpm} BPM instrumental; total picture duration and source capacities retained`] : [])] : []),
    ...(sustainedMovement ? ["Movement-window ranking uses median sampled frame differences so isolated flashes/cuts do not dominate; not subject/action recognition"] : []),
    ...framingChecks, ...credits,
    ...states.map((state, index) => `Shot ${index + 1} sound: ${preserveOriginal && state.usable ? `original retained (${state.mean.toFixed(1)} dB mean)` : options.audio === "music" ? "continuous instrumental soundtrack" : "absent or effectively silent"}`),
    `${options.transition === "soft" ? "Brief fades through dark at shot boundaries" : "Direct cuts"}; ${options.shotCadence === "adaptive-v2" ? "adaptive cadence uses short varied cuts and the strongest sampled movement window per source; no fixed 45-second target or semantic best-moment claim" : options.shotCadence === "brisk-v1" ? "saved brisk cadence uses a short opening and varied native-speed cuts, with no hold beyond six seconds; not semantic best-moment selection" : options.pacing === "cinematic" ? "automatic windows receive bounded cinematic pacing heuristics, not semantic best-moment selection; manual intervals are retained" : options.pacing === "selected" ? "the selected source intervals are retained" : "legacy cap trimming keeps the selected source endings"}`,
    useMusic ? `Original locally composed ${options.mood} instrumental${anyOriginal ? options.audio === "auto" ? "; audible only in silent shot intervals, with no music over usable original ambience" : "; bed level follows each selected interval, below its quiet original ambience and audible in silent intervals" : "; one continuous bed across every shot"}; no licensed trending track copied` : anyOriginal ? "Original ambience retained without an added instrumental" : "No source sound was available; the explicit original-only choice produces a silent soundtrack",
    ...(useMusic && options.musicVersion === 2 ? [stockMusicArrangementDescription(options.mood, job.id)] : []),
    subtitleDecision.reason,
    `Stock plan identity ${planIdentity}`,
    `Pipeline signature ${signature}`,
  ];
  item.quality.postCopy = retainedPosting?.copy ?? stock.caption;
  item.quality.visualSources = shots.map(shot => ({ provider: shot.provider, providerMediaId: shot.mediaId, providerUrl: shot.sourcePage, creator: shot.creator, licence: shot.provider === "pexels" ? "Pexels License" : "Pixabay Content License" }));
  if (retainedPosting?.hashtags) item.quality.hashtags = retainedPosting.hashtags;
  else item.quality.hashtags = [...new Set(words(shots.map(shot => shot.title).join(" ")).slice(0, 6).map(word => `#${word[0].toUpperCase()}${word.slice(1)}`))];
  item.quality.warning = options.audio === "music" && states.some(state => state.usable) ? "This export uses a continuous instrumental soundtrack. Original audio is retained with each downloaded source." : subtitleDecisions.some(item => item.decision === "uncertain") ? "Some source sound could not be checked for speech. Review it before posting." : undefined;
  item.processing!.reason = options.shotCadence === "adaptive-v2" ? "Real footage with compact movement-informed cuts, bounded acceleration and automatic duration. Composition, continuity, sound and posting relevance still require final viewing." : "Real footage, owner-selected intervals and order. Composition, continuity, sound and posting relevance require final viewing.";
  item.monetizationReview!.rightsBasis = `All source pages retained: ${shots.map(shot => shot.sourcePage).join(" · ")}. A provider licence does not establish originality or monetization eligibility.`;
  const instagram = outputPath(item.id, "instagram"), youtube = outputPath(item.id, "youtube");
  let instagramInfo = reuse ? await validOutput(instagram, duration, minimumPictureDuration) : null, youtubeInfo = reuse ? await validOutput(youtube, duration, minimumPictureDuration) : null;
  if (instagramInfo && !youtubeInfo) { await copyFileAtomically(instagram, youtube); youtubeInfo = await validOutput(youtube, duration, minimumPictureDuration); }
  if (youtubeInfo && !instagramInfo) { await copyFileAtomically(youtube, instagram); instagramInfo = await validOutput(instagram, duration, minimumPictureDuration); }
  if (!instagramInfo || !youtubeInfo) {
    await saveReviewFile(item);
    const masterInfo = cues.length ? null : await validOutput(master, duration, minimumPictureDuration);
    if (masterInfo && canRemuxStockAssembly(job, cues, masterInfo, duration)) {
      await report(55, "Saving the verified real footage assembly without re-encoding its picture");
      const temporary = `${instagram}.partial-${crypto.randomUUID()}.mp4`;
      try {
        await run(ffmpegPath, stockAssemblyRemuxArgs(master, temporary));
        const remuxed = await validOutput(temporary, duration, minimumPictureDuration);
        if (!remuxed || !canRemuxStockAssembly(job, cues, remuxed, duration)) throw new Error("The stock assembly copy failed duration, picture or audio verification.");
        await replaceFile(temporary, instagram);
      } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
      await copyFileAtomically(instagram, youtube);
      instagramInfo = await validOutput(instagram, duration, minimumPictureDuration);
      youtubeInfo = await validOutput(youtube, duration, minimumPictureDuration);
      if (!instagramInfo || !youtubeInfo) throw new Error("The saved stock assembly failed final output verification.");
      item.quality.checks.push("Caption-free verified H.264/AAC stock master saved without a second picture encode");
    } else {
      const rendered = await renderClip(master, item, part, format, cues, directory, fraction => report(52 + fraction * 46, `Rendering the real footage reel · ${Math.round(fraction * 100)}%`), { mood: options.mood, seed: job.id });
      instagramInfo = rendered.instagramInfo; youtubeInfo = rendered.youtubeInfo;
    }
  }
  assertStockReelMinimum(instagramInfo.videoDuration, minimumPictureDuration);
  assertStockReelMinimum(youtubeInfo.videoDuration, minimumPictureDuration);
  item.artifacts = { version: 1, renderRevision: `stock-assembly-v${editVersion}`, finalVideo: artifactReference(instagram), editing: { video: artifactReference(master), offsetSeconds: 0, captionsBaked: false }, captions: cues.length ? artifactReference(path.join(directory, "captions.srt")) : undefined, original: artifactReference(originalAssembly), music: useMusic ? artifactReference(music) : undefined };
  item.outputs = { instagram: { filename: path.basename(instagram), ...instagramInfo }, youtube: { filename: path.basename(youtube), ...youtubeInfo } };
  item.status = "READY"; item.processing!.status = "COMPLETED"; item.updatedAt = new Date().toISOString();
  await saveReviewFile(item);
  const finished = await updateJob(job.id, { status: "COMPLETED", stockSource: renderedStock, progress: 100, stage: `Real footage reel ready · ${shots.length} shots · ${instagramInfo.duration.toFixed(1)} seconds`, duration: instagramInfo.duration, hasAudio: anyOriginal || useMusic, error: undefined, finishedAt: new Date().toISOString(), completedClips: 1, totalClips: 1, reviewIds: [item.id] });
  await cleanupStockTemporaries(job.id);
  return finished;
}

async function processClaimedSourceJob(job: SourceJob) {
  const report = (progress: number, stage: string, change: Partial<SourceJob> = {}) => updateJob(job.id, { ...change, progress, stage });
  try {
    const preflight = await sourceProcessingPreflight(true, !!job.stockSource);
    if (!(job.stockSource ? preflight.dependencies.ffmpeg && preflight.dependencies.ffprobe : preflight.ready)) {
      return updateJob(job.id, {
        status: "BLOCKED",
        stage: "Local dependency preflight failed",
        error: preflight.summary,
        finishedAt: new Date().toISOString(),
      });
    }
    if (job.stockSource?.shots?.length) return await processStockReel(job, preflight, report);
    await report(4, !job.stockSource && preflight.firstModelDownloadRequired
      ? "Dependencies ready · Whisper model will download once before transcription"
      : "Dependencies and cached Whisper model are ready");

    const source = sourcePath(job.id, job.sourceFile);
    await report(6, "Reading video stream metadata with FFprobe");
    const info = await probe(source);
    if (!info.duration || !info.width || !info.height) throw new Error("The uploaded file does not contain a readable video stream.");
    await report(9, `Video verified · ${info.width}×${info.height} · ${info.duration.toFixed(1)} seconds`, {
      duration: info.duration,
      width: info.width,
      height: info.height,
      hasAudio: info.hasAudio,
    });
    await report(11, info.hasAudio ? "Mapping silence for natural clip boundaries" : "No source audio · planning visual boundaries and local music");
    const quiet = job.stockSource ? [] : await silences(source, info.hasAudio, info.duration);
    await report(13, `Natural-boundary scan complete · ${quiet.length} silence interval${quiet.length === 1 ? "" : "s"}`);
    let transcript: TranscriptSegment[] = [];
    let subtitleAnalysisError: string | undefined;
    if (job.stockSource && info.hasAudio && (!preflight.dependencies.fasterWhisper || !preflight.whisperModel.cached || os.freemem() < 900 * 1024 * 1024)) {
      subtitleAnalysisError = "Automatic speech check unavailable: the cached local speech model or safe RAM headroom was missing. No stock title was burned in as subtitles. Review the audio.";
    } else {
      try { transcript = await transcribe(source, job.id, info.hasAudio, job.stockSource ? Math.min(info.duration, job.stockSource.maxDuration) : info.duration, (progress, stage) => report(progress, stage), !!job.stockSource); }
      catch (error) { if (!job.stockSource) throw error; subtitleAnalysisError = "Local speech analysis failed. No guessed subtitles were burned in; review the audio."; }
    }
    await report(32, job.stockSource ? "Keeping the original footage — no AI visuals or generated narration" : "Planning contiguous 2–3 minute coverage intervals");
    const base = planCoverageCuts(job.stockSource ? Math.min(info.duration, job.stockSource.maxDuration) : info.duration, quiet, transcript);
    if (!base.length) throw new Error("No usable video interval was found.");

    const audioByCut: AudioState[] = [];
    for (let index = 0; index < base.length; index += 1) {
      const part = base[index];
      await report(34 + (index / base.length) * 12, `Checking audio for candidate ${index + 1} of ${base.length}`);
      audioByCut.push(await audioState(source, info.hasAudio, part.start, part.end));
      if (job.stockSource) {
        const audio = audioByCut[audioByCut.length - 1];
        audio.usable = stockAudioUsable(info.hasAudio, audio.mean, audio.max);
      }
    }
    const scored = scoreCuts(base, quiet, transcript, audioByCut);
    if (job.stockSource) for (const part of scored) part.score = 0;
    const parts = chooseCuts(scored, job.mode, info.duration);
    await report(48, job.mode === "coverage"
      ? `Coverage plan ready · ${parts.length} contiguous clip${parts.length === 1 ? "" : "s"} · no tail dropped`
      : `Highlight ranking ready · selected ${parts.length} of ${scored.length} candidates`, { totalClips: parts.length });

    const format = job.stockSource ? stockFraming(info, job.stockSource.options?.framing) : formatFor(info);
    const reviewFiles = await readReviewFiles();
    const reviewIds: string[] = [];
    const usedReviewIds = new Set<string>();
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const subtitles = automaticSubtitles(part, transcript, part.metrics.audio.usable, subtitleAnalysisError);
      const cues = subtitles.cues;
      const existing = findMatchingReview(reviewFiles, job, part, format.name, usedReviewIds);
      const item = buildReviewItem(job, part, format, cues, existing, { decision: subtitles.decision, reason: subtitles.reason });
      usedReviewIds.add(item.id);
      const instagram = outputPath(item.id, "instagram");
      const youtube = outputPath(item.id, "youtube");
      const expectedDuration = part.end - part.start;
      const mayReuse = reusableReview(existing, clipSignature(job, part, format.name, cues));
      let instagramInfo = mayReuse ? await validOutput(instagram, expectedDuration) : null;
      let youtubeInfo = mayReuse ? await validOutput(youtube, expectedDuration) : null;
      if (!instagramInfo && youtubeInfo) {
        await report(49 + index / parts.length * 49, `Restoring the first copy of clip ${index + 1} of ${parts.length}`);
        await copyFileAtomically(youtube, instagram);
        instagramInfo = await validOutput(instagram, expectedDuration);
      }
      if (instagramInfo && !youtubeInfo) {
        await report(49 + index / parts.length * 49, `Restoring the second copy of clip ${index + 1} of ${parts.length}`);
        await copyFileAtomically(instagram, youtube);
        youtubeInfo = await validOutput(youtube, expectedDuration);
      }

      if (instagramInfo && youtubeInfo) {
        item.outputs = {
          instagram: { filename: path.basename(instagram), duration: instagramInfo.duration, width: instagramInfo.width, height: instagramInfo.height },
          youtube: { filename: path.basename(youtube), duration: youtubeInfo.duration, width: youtubeInfo.width, height: youtubeInfo.height },
        };
        item.status = "READY";
        item.processing = { ...item.processing!, status: "COMPLETED" };
        await saveReviewFile(item);
        reviewIds.push(item.id);
        await report(49 + (index + 1) / parts.length * 49, `Verified and reused clip ${index + 1} of ${parts.length}`, {
          completedClips: index + 1,
          reviewIds,
        });
        continue;
      }

      await saveReviewFile(item);
      const clipDirectory = path.join(workRoot, `source-${job.id}`, `clip-${item.id}`);
      await report(49 + index / parts.length * 49, `Rendering clip ${index + 1} of ${parts.length} · 0%`);
      const rendered = await renderClip(
        source,
        item,
        part,
        format,
        cues,
        clipDirectory,
        (fraction) => report(
          49 + ((index + fraction) / parts.length) * 49,
          `Rendering clip ${index + 1} of ${parts.length} · ${Math.round(fraction * 100)}%`,
        ),
        job.stockSource ? { mood: job.stockSource.options?.mood || "reflective", seed: job.id } : undefined,
      );
      instagramInfo = rendered.instagramInfo;
      youtubeInfo = rendered.youtubeInfo;
      item.outputs = {
        instagram: { filename: path.basename(rendered.destination), duration: instagramInfo.duration, width: instagramInfo.width, height: instagramInfo.height },
        youtube: { filename: path.basename(rendered.youtube), duration: youtubeInfo.duration, width: youtubeInfo.width, height: youtubeInfo.height },
      };
      item.status = "READY";
      item.processing = { ...item.processing!, status: "COMPLETED" };
      item.updatedAt = new Date().toISOString();
      await saveReviewFile(item);
      reviewIds.push(item.id);
      await report(49 + (index + 1) / parts.length * 49, `Rendered and validated clip ${index + 1} of ${parts.length}`, {
        completedClips: index + 1,
        reviewIds,
      });
    }
    return updateJob(job.id, {
      status: "COMPLETED",
      progress: 100,
      stage: `All ${parts.length} review clip${parts.length === 1 ? " is" : "s are"} ready`,
      error: undefined,
      finishedAt: new Date().toISOString(),
      completedClips: parts.length,
      reviewIds: job.mode === "highlights" ? [...reviewIds].reverse() : reviewIds,
    });
  } catch (error) {
    const failed = await updateJob(job.id, {
      status: "FAILED",
      stage: "Processing stopped safely · retry will reuse every validated clip",
      error: error instanceof Error ? error.message : "Unknown processing error",
      finishedAt: new Date().toISOString(),
    });
    if (job.stockSource?.shots?.length) await cleanupStockTemporaries(job.id);
    return failed;
  }
}

async function processNextSourceJobUnlocked() {
  const releaseProcessorLease = await acquireProcessorLease();
  if (!releaseProcessorLease) return null;
  try {
    await recoverInterruptedJobs();
    const job = await claimOldestQueuedJob();
    if (!job) return null;
    return await processClaimedSourceJob(job);
  } finally {
    await releaseProcessorLease();
  }
}

/** Concurrent timer ticks share this promise, so only one source job runs in-process. */
export function processNextSourceJob() {
  if (processorPromise) return processorPromise;
  processorPromise = (async () => {
    // An idle or memory-blocked source queue must not monopolize the worker's
    // workflow dispatcher. Interrupted work is recovered only under both leases.
    const jobs = await readSourceJobs();
    if (!jobs.some(job => ["QUEUED", "PROCESSING"].includes(job.status))) return null;
    const result = await tryWithLocalRenderSlot(processNextSourceJobUnlocked, "Source-video processing");
    return result.acquired ? result.value : null;
  })().finally(() => {
    processorPromise = null;
  });
  return processorPromise;
}
