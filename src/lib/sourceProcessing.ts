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
import {
  FFMPEG_ENCODER_RESOURCE_ARGS,
  FFMPEG_FILTER_RESOURCE_ARGS,
  lowerChildProcessPriority,
  withLocalRenderSlot,
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
export type SourceJob = {
  stockSource?: { provider: "pexels" | "pixabay"; mediaId: string; sourcePage: string; creator: string; requestId: string; caption: string; maxDuration: number };
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

type MediaInfo = { duration: number; width: number; height: number; hasAudio: boolean };
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

  constructor() {
    super("Files larger than 5 GB are not supported.");
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
      callback(new SourceUploadTooLargeError());
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
      finishedAt: job.finishedAt || now,
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
      const text = value.toString();
      output += text;
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

export async function sourceProcessingPreflight(force = false): Promise<SourceProcessingPreflight> {
  if (!force && preflightCache && preflightCache.expiresAt > Date.now()) return preflightCache.value;

  const [ffmpegCheck, ffprobeCheck, python] = await Promise.all([
    binaryCheck(ffmpegPath, "FFmpeg"),
    binaryCheck(ffprobePath, "FFprobe"),
    locatePython(),
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
  preflightCache = { expiresAt: Date.now() + 20_000, value };
  return value;
}

export async function ffmpegAvailable() {
  const preflight = await sourceProcessingPreflight();
  return preflight.dependencies.ffmpeg && preflight.dependencies.ffprobe;
}

async function probe(file: string): Promise<MediaInfo> {
  const raw = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json",
    file,
  ]);
  const data = JSON.parse(raw) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  return {
    duration: Number(data.format?.duration || 0),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    hasAudio: Boolean(data.streams?.some((stream) => stream.codec_type === "audio")),
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
    version: 5,
    jobId: job.id,
    start: part.start.toFixed(3),
    end: part.end.toFixed(3),
    format,
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

async function validOutput(file: string, expectedDuration: number) {
  try {
    const stat = await fs.stat(file);
    if (stat.size < 1024) return null;
    const info = await probe(file);
    if (!info.width || !info.height || !info.hasAudio || Math.abs(info.duration - expectedDuration) > 2) return null;
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

async function renderClip(
  source: string,
  item: ReviewFile,
  part: Cut,
  format: ReturnType<typeof formatFor>,
  cues: CaptionCue[],
  clipDirectory: string,
  jobTitle: string,
  onProgress: (fraction: number) => Promise<unknown>,
) {
  await fs.mkdir(clipDirectory, { recursive: true });
  const duration = part.end - part.start;
  const subtitlePath = path.join(clipDirectory, "captions.srt");
  if (cues.length) await fs.writeFile(subtitlePath, clipSrt(cues), "utf8");
  if (cues.length) await fs.writeFile(path.join(clipDirectory, "captions.ass"), sourceCaptionAss(cues, format.width, format.height), "utf8");
  const musicPath = path.join(clipDirectory, "music.wav");
  if (!part.metrics.audio.usable) await fs.writeFile(musicPath, localMusicWav(duration, false));

  const subtitleFilter = cues.length
    ? ",ass=captions.ass"
    : `,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${jobTitle.replace(/[':%\\]/g, " ").slice(0, 55)}':fontcolor=white:fontsize=38:box=1:boxcolor=black@0.6:boxborderw=14:x=(w-text_w)/2:y=h-(text_h*3)`;
  const destination = outputPath(item.id, "instagram");
  const temporary = `${destination}.partial-${crypto.randomUUID()}.mp4`;
  const args = ["-y", ...FFMPEG_FILTER_RESOURCE_ARGS, "-ss", part.start.toFixed(3), "-t", duration.toFixed(3), "-threads", "1", "-i", source];
  if (!part.metrics.audio.usable) args.push("-i", musicPath);
  args.push("-vf", `${format.filter}${subtitleFilter}`, "-map", "0:v:0", "-map", part.metrics.audio.usable ? "0:a:0" : "1:a:0");
  if (part.metrics.audio.usable) args.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
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
      hashtags: ["#Shorts", "#PhoenixStudio", ...keywords.map((word) => `#${word[0].toUpperCase()}${word.slice(1)}`)].slice(0, 8),
      postCopy: job.stockSource ? `${job.stockSource.caption}\nFootage: ${job.stockSource.creator} / ${job.stockSource.provider}.` : `${summary(clipTitle, copyText)} Prepared for ${socialHandle("instagram")} and YouTube Shorts.`,
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

async function processClaimedSourceJob(job: SourceJob) {
  const report = (progress: number, stage: string, change: Partial<SourceJob> = {}) => updateJob(job.id, { ...change, progress, stage });
  try {
    const preflight = await sourceProcessingPreflight(true);
    if (!(job.stockSource ? preflight.dependencies.ffmpeg && preflight.dependencies.ffprobe : preflight.ready)) {
      return updateJob(job.id, {
        status: "BLOCKED",
        stage: "Local dependency preflight failed",
        error: preflight.summary,
        finishedAt: new Date().toISOString(),
      });
    }
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
    }
    const scored = scoreCuts(base, quiet, transcript, audioByCut);
    if (job.stockSource) for (const part of scored) part.score = 0;
    const parts = chooseCuts(scored, job.mode, info.duration);
    await report(48, job.mode === "coverage"
      ? `Coverage plan ready · ${parts.length} contiguous clip${parts.length === 1 ? "" : "s"} · no tail dropped`
      : `Highlight ranking ready · selected ${parts.length} of ${scored.length} candidates`, { totalClips: parts.length });

    const format = job.stockSource ? { name: "9:16" as const, width: 720, height: 1280, filter: "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=#101710" } : formatFor(info);
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
        job.title,
        (fraction) => report(
          49 + ((index + fraction) / parts.length) * 49,
          `Rendering clip ${index + 1} of ${parts.length} · ${Math.round(fraction * 100)}%`,
        ),
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
    return updateJob(job.id, {
      status: "FAILED",
      stage: "Processing stopped safely · retry will reuse every validated clip",
      error: error instanceof Error ? error.message : "Unknown processing error",
      finishedAt: new Date().toISOString(),
    });
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
  processorPromise = withLocalRenderSlot(processNextSourceJobUnlocked, "Source-video processing").finally(() => {
    processorPromise = null;
  });
  return processorPromise;
}
