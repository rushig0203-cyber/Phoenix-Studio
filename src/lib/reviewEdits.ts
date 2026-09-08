import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { getReviewFile, outputPath, reviewRoot, safeReviewId, saveReviewFile, sourcePath, type ReviewFile } from "./reviewFiles";
import { FFMPEG_ENCODER_RESOURCE_ARGS, FFMPEG_FILTER_RESOURCE_ARGS, lowerChildProcessPriority, withLocalRenderSlot } from "./renderResources";
import type { EditCue, ReviewEditDraft, ReviewEditJob, ReviewEditState } from "./reviewEditTypes";

const store = () => path.join(reviewRoot(), "review-edit-jobs.json");
const draftPath = (id: string) => path.join(reviewRoot(), "work", `edit-draft-${id}.json`);
const ffmpeg = process.env.PHOENIX_FFMPEG_PATH?.trim() || path.join(process.cwd(), "node_modules", "@ffmpeg-installer", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobe = process.env.PHOENIX_FFPROBE_PATH?.trim() || path.join(process.cwd(), "node_modules", "@ffprobe-installer", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const cueSchema = z.object({ start: z.number().finite().min(0), end: z.number().finite().positive(), text: z.string().max(300) });
const draftSchema = z.object({
  title: z.string().trim().min(1).max(180), postCopy: z.string().max(5000),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).max(30),
  trimStart: z.number().finite().min(0), trimEnd: z.number().finite().positive(),
  format: z.enum(["original", "9:16", "16:9", "1:1"]), framing: z.enum(["fit", "crop"]),
  cropPosition: z.number().finite().min(0).max(1), volume: z.number().finite().min(0).max(2),
  captionsEnabled: z.boolean(), captionPosition: z.enum(["top", "bottom"]),
  captionSize: z.number().finite().min(18).max(64), captionColor: z.string().regex(/^#[a-f\d]{6}$/i),
  cues: z.array(cueSchema).max(1000),
});

async function exists(filename: string) { return fs.stat(filename).then(s => s.isFile()).catch(() => false); }
async function json<T>(filename: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(filename, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}
async function atomicJson(filename: string, value: unknown) {
  await writeAtomicJson(filename, value);
}
async function mutate<T>(fn: (jobs: ReviewEditJob[]) => T | Promise<T>): Promise<T> {
  return withFileLock(`${store()}.lock`, async () => {
    const jobs = await json<ReviewEditJob[]>(store(), []);
    const before = JSON.stringify(jobs);
    const result = await fn(jobs);
    if (JSON.stringify(jobs) !== before) await atomicJson(store(), jobs);
    return result;
  });
}
function timed(job: ReviewEditJob): ReviewEditJob {
  const elapsedSeconds = job.startedAt ? Math.max(0, Math.round((Date.parse(job.finishedAt || new Date().toISOString()) - Date.parse(job.startedAt)) / 1000)) : 0;
  return { ...job, elapsedSeconds, estimatedRemainingSeconds: job.status === "PROCESSING" && job.progress > 5 ? Math.max(1, Math.round(elapsedSeconds * (100 - job.progress) / job.progress)) : null };
}
export async function listReviewEdits(reviewId?: string) {
  return (await json<ReviewEditJob[]>(store(), [])).filter(j => !j.archivedAt && (!reviewId || j.reviewId === reviewId)).map(timed);
}

export function parseSrt(text: string): EditCue[] {
  const time = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  return text.replace(/\r/g, "").split(/\n\s*\n/).flatMap(block => {
    const match = block.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)\n([\s\S]*)/);
    return match ? [{ start: time(...match.slice(1, 5) as [string,string,string,string]), end: time(...match.slice(5, 9) as [string,string,string,string]), text: match[9].replace(/\n/g, " ").trim() }] : [];
  });
}

async function sourceFor(file: ReviewFile) {
  const target = file.delivery?.platform || (file.outputs.youtube ? "youtube" : "instagram");
  const output = file.outputs[target];
  if (!output) throw new Error("This review file has no finished video to edit.");
  const base = { path: outputPath(file.id, target), offset: 0, duration: output.duration, width: output.width, height: output.height, clean: false, captions: [] as EditCue[], music: undefined as string | undefined };
  if (file.editedFrom) {
    const clean = path.join(reviewRoot(), "work", `edit-${file.id}`, "clean.mp4");
    if (await exists(clean)) return { ...base, path: clean, clean: file.editableMaster === true, captions: file.captionCues || [] };
  }
  const jobId = file.processing?.jobId;
  if (jobId && safeReviewId(jobId)) {
    if (file.source.filename.startsWith("local-cartoon-")) {
      const directory = path.join(reviewRoot(), "work", `kids-${jobId}`);
      const clean = path.join(directory, "clean.mp4");
      const captions = await fs.readFile(path.join(directory, "captions.srt"), "utf8").then(parseSrt).catch(() => []);
      if (await exists(clean)) return { ...base, path: clean, clean: true, captions };
      return { ...base, captions };
    }
    const jobs = await json<Array<{id:string;sourceFile:string;reviewIds:string[]}>>(path.join(reviewRoot(), "source-processing-jobs.json"), []);
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      const original = sourcePath(job.id, job.sourceFile);
      const clipIndex = job.reviewIds.indexOf(file.id);
      const directory = path.join(reviewRoot(), "work", `source-${job.id}`, `clip-${clipIndex + 1}`);
      const captions = await fs.readFile(path.join(directory, "captions.srt"), "utf8").then(parseSrt).catch(() => []);
      if (await exists(original)) {
        const music = path.join(directory, "music.wav");
        return { ...base, path: original, offset: file.processing!.start, clean: true, captions, music: file.quality.audio === "local-music-replaced" && await exists(music) ? music : undefined };
      }
    }
  }
  return base;
}

export async function getReviewEditState(id: string): Promise<ReviewEditState> {
  if (!safeReviewId(id)) throw new Error("Review file not found.");
  const file = await getReviewFile(id); if (!file) throw new Error("Review file not found.");
  const source = await sourceFor(file);
  const initial: ReviewEditDraft = {
    title: file.title, postCopy: file.quality.postCopy || "", hashtags: file.quality.hashtags,
    trimStart: 0, trimEnd: source.duration, format: "original", framing: "fit", cropPosition: .5, volume: 1,
    captionsEnabled: source.clean && source.captions.length > 0, captionPosition: file.audience === "kids-3-6" ? "top" : "bottom", captionSize: 32,
    captionColor: "#FFFFFF", cues: source.captions,
  };
  const draft = await json<ReviewEditDraft>(draftPath(id), initial);
  return { draft, duration: source.duration, width: source.width, height: source.height, canReplaceCaptions: source.clean,
    previewIsClean: source.clean && !needsFinishedPreview(file, source),
    captionNote: source.clean ? undefined : "This older export has captions baked into its picture. Trim, framing, audio and posting text can be edited. Regenerate the original job to create an editable caption master.",
    mediaUrl: `/api/review-files/${id}/media?editSource=1`, jobs: await listReviewEdits(id) };
}
export async function getEditorMedia(id: string) {
  if (!safeReviewId(id)) return null;
  const file = await getReviewFile(id); if (!file) return null;
  const source = await sourceFor(file);
  // Full episodes should be previewed as their existing clip, never loaded at
  // the wrong offset. The editor explicitly shows this as a source preview.
  if (needsFinishedPreview(file, source)) return null;
  return source.path;
}
function needsFinishedPreview(file: ReviewFile, source: {offset:number;music?:string}) {
  return source.offset !== 0 || !!source.music || (file.source.kind === "upload" && !file.source.filename.startsWith("local-cartoon-") && !file.editedFrom);
}
export function validateEdit(value: unknown, duration: number): ReviewEditDraft {
  const draft = draftSchema.parse(value);
  if (draft.trimEnd > duration + .1 || draft.trimEnd - draft.trimStart < 1) throw new Error("Choose a trim of at least one second within the video.");
  let previousEnd = 0;
  for (const cue of draft.cues) {
    if (cue.end <= cue.start || cue.end > duration + .15 || cue.start < previousEnd - .01) throw new Error("Caption times must be ordered, non-overlapping, and within the video.");
    previousEnd = cue.end;
  }
  return draft;
}
export async function saveReviewEditDraft(id: string, value: unknown) {
  const state = await getReviewEditState(id); const draft = validateEdit(value, state.duration);
  if (!state.canReplaceCaptions && draft.captionsEnabled) throw new Error("Regenerate this older video before replacing its baked-in captions.");
  await atomicJson(draftPath(id), draft); return draft;
}
export async function queueReviewEdit(id: string, value: unknown) {
  await run(ffmpeg, ["-version"]); await run(ffprobe, ["-version"]);
  const draft = await saveReviewEditDraft(id, value);
  return mutate(jobs => {
    const existing = jobs.find(j => j.reviewId === id && !j.archivedAt && ["QUEUED","PROCESSING"].includes(j.status));
    if (existing) return timed(existing);
    const job: ReviewEditJob = { id: crypto.randomUUID(), reviewId: id, outputId: crypto.randomUUID(), title: draft.title, draft, status: "QUEUED", progress: 0, stage: "Queued for edited copy", createdAt: new Date().toISOString() };
    jobs.push(job); return job;
  });
}
export async function removeReviewEdit(id: string) {
  return mutate(jobs => {
    const job = jobs.find(j => j.id === id && !j.archivedAt); if (!job) return null;
    if (job.status === "PROCESSING") throw new Error("This edit is rendering. Remove it after it finishes.");
    if (job.status === "QUEUED") job.status = "CANCELLED";
    job.archivedAt = new Date().toISOString(); return { deleted: true, filesRetained: true };
  });
}
async function patchJob(id: string, patch: Partial<ReviewEditJob>) {
  return mutate(jobs => { const job = jobs.find(j => j.id === id); if (job && !job.archivedAt) Object.assign(job, patch); });
}
function run(command: string, args: string[], cwd?: string, progress?: (seconds: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true }); lowerChildProcessPriority(child.pid);
    let log = "", stdout = "", buffer = "";
    const timeout = setTimeout(() => child.kill(), 15 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk).slice(-200000); buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
      for (const line of lines) { const m = line.match(/^out_time=(\d+):(\d+):([\d.]+)$/); if (m) progress?.(Number(m[1])*3600+Number(m[2])*60+Number(m[3])); }
    });
    child.stderr.on("data", (chunk: Buffer) => { log = (log + chunk).slice(-4000); });
    child.on("error", error => { clearTimeout(timeout); reject(new Error(`Local renderer unavailable: ${error.message}`)); });
    child.on("close", code => { clearTimeout(timeout); if (code === 0) resolve(stdout); else reject(new Error(`Local edit renderer failed (${code}): ${log.slice(-1800)}`)); });
  });
}
const stamp = (seconds: number) => { const n = Math.round(seconds*100); return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,"0")}:${String(Math.floor(n/100)%60).padStart(2,"0")}.${String(n%100).padStart(2,"0")}`; };
export function trimmedCues(draft: ReviewEditDraft) {
  return draft.cues.filter(c => c.text.trim() && c.end > draft.trimStart && c.start < draft.trimEnd).map(c => ({ start: Math.max(0,c.start-draft.trimStart), end: Math.min(draft.trimEnd,c.end)-draft.trimStart, text:c.text }));
}
function assFile(draft: ReviewEditDraft, width: number, height: number) {
  const color = draft.captionColor.slice(1); const bgr = `${color.slice(4)}${color.slice(2,4)}${color.slice(0,2)}`;
  const font = Math.round(draft.captionSize * height / 720);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${font},&H00${bgr},&H00${bgr},&H00202020,&H88000000,-1,0,0,0,100,100,0,0,1,2,1,${draft.captionPosition === "top" ? 8 : 2},45,45,${Math.round(height*.07)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + trimmedCues(draft).map(c => `Dialogue: 0,${stamp(c.start)},${stamp(c.end)},Default,,0,0,0,,${c.text.replace(/\\/g,"/").replace(/[{}]/g,"").replace(/[\r\n]+/g,"\\N")}`).join("\n");
}
let inFlight: Promise<void> | null = null;
export function processNextReviewEdit(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = withLocalRenderSlot(async () => {
    const job = await mutate(jobs => {
      for (const pending of jobs.filter(j => j.status === "PROCESSING" && !j.archivedAt)) {
        let alive = false; try { if(pending.workerPid) { process.kill(pending.workerPid,0); alive=true; } } catch {}
        if (!alive) Object.assign(pending,{status:"QUEUED",progress:0,stage:"Resuming interrupted edit"});
      }
      if (jobs.some(j => j.status === "PROCESSING" && !j.archivedAt)) return null;
      const next = jobs.find(j => j.status === "QUEUED" && !j.archivedAt);
      if (next) Object.assign(next,{status:"PROCESSING",progress:1,stage:"Opening source footage",startedAt:new Date().toISOString(),workerPid:process.pid});
      return next ? structuredClone(next) : null;
    });
    if (!job) return;
    const directory = path.join(reviewRoot(), "work", `edit-${job.outputId}`);
    try {
      const original = await getReviewFile(job.reviewId); if (!original) throw new Error("The original review file was removed.");
      const source = await sourceFor(original); const draft = validateEdit(job.draft,source.duration);
      await fs.mkdir(directory,{recursive:true});
      const duration = draft.trimEnd-draft.trimStart;
      const dims = draft.format === "9:16" ? [720,1280] : draft.format === "16:9" ? [1280,720] : draft.format === "1:1" ? [720,720] : [Math.round(source.width*Math.min(1,1280/Math.max(source.width,source.height))/2)*2,Math.round(source.height*Math.min(1,1280/Math.max(source.width,source.height))/2)*2];
      const [width,height] = dims;
      const picture = draft.framing === "crop" ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='(in_w-out_w)*${draft.cropPosition}':y='(in_h-out_h)/2',setsar=1` : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
      const args = ["-y","-hide_banner","-loglevel","error",...FFMPEG_FILTER_RESOURCE_ARGS,"-threads","1","-ss",String(source.offset+draft.trimStart),"-i",source.path];
      if (source.music) args.push("-ss",String(draft.trimStart),"-i",source.music);
      args.push("-t",String(duration),"-map","0:v:0","-map",source.music?"1:a:0":"0:a:0?","-vf",picture,"-af",`volume=${draft.volume},alimiter=limit=0.95`,"-c:v","libx264","-preset","ultrafast","-crf","22",...FFMPEG_ENCODER_RESOURCE_ARGS,"-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart","-progress","pipe:1","-nostats","clean.mp4");
      let last = 0; let writes = Promise.resolve();
      const progress = (start:number,span:number,stage:string) => (seconds:number) => { const pct = Math.min(start+span,Math.floor(start+seconds/duration*span)); if(pct>last+2){last=pct;writes=writes.then(()=>patchJob(job.id,{progress:pct,stage:`${stage} · ${Math.min(duration,seconds).toFixed(1)}s / ${duration.toFixed(1)}s`}));} };
      await run(ffmpeg,args,directory,progress(3,55,"Rendering edits")); await writes;
      const cues = source.clean && draft.captionsEnabled ? trimmedCues(draft) : [];
      const final = path.join(directory,"final.mp4");
      if (cues.length) {
        await fs.writeFile(path.join(directory,"captions.ass"),assFile(draft,width,height),"utf8");
        await run(ffmpeg,["-y","-hide_banner","-loglevel","error",...FFMPEG_FILTER_RESOURCE_ARGS,"-threads","1","-i","clean.mp4","-vf","subtitles=captions.ass","-c:v","libx264","-preset","ultrafast","-crf","22",...FFMPEG_ENCODER_RESOURCE_ARGS,"-c:a","copy","-movflags","+faststart","-progress","pipe:1","-nostats","final.mp4"],directory,progress(60,35,"Burning corrected captions")); await writes;
      } else await fs.copyFile(path.join(directory,"clean.mp4"),final);
      const probe = JSON.parse(await run(ffprobe,["-v","error","-show_streams","-show_format","-of","json",final])) as {format:{duration:string};streams:Array<{codec_type:string;width:number;height:number}>};
      const video = probe.streams.find(s=>s.codec_type==="video");
      if(!video || Math.abs(Number(probe.format.duration)-duration)>.25) throw new Error("Edited export failed duration or picture verification.");
      const target = original.delivery?.platform || (original.outputs.youtube?"youtube":"instagram");
      const destination = outputPath(job.outputId,target);
      await fs.copyFile(final,`${destination}.partial`); await fs.rename(`${destination}.partial`,destination);
      const now = new Date().toISOString();
      const file: ReviewFile = { ...original,id:job.outputId,title:draft.title,createdAt:now,updatedAt:now,status:"READY",targets:[target],
        outputs:{[target]:{filename:path.basename(destination),duration:Number(probe.format.duration),width:video.width,height:video.height}},
        editedFrom:original.id,editableMaster:source.clean,captionCues:source.clean?trimmedCues(draft):[],
        quality:{...original.quality,captions:source.clean?cues.map(c=>c.text):original.quality.captions,postCopy:draft.postCopy,hashtags:draft.hashtags,checks:[...original.quality.checks,"Manually edited copy: trim, framing, audio and caption settings applied"]},
        delivery:original.delivery?{...original.delivery,aspect:height>width?"9:16":"16:9",actualDuration:duration,requestedDuration:duration}:undefined,
        processing:undefined,monetizationReview:original.monetizationReview?{...original.monetizationReview,status:"NOT_REVIEWED"}:undefined };
      await saveReviewFile(file);
      await patchJob(job.id,{status:"COMPLETED",progress:100,stage:"Edited copy ready for review",finishedAt:now});
    } catch(error) { await patchJob(job.id,{status:"FAILED",stage:"Edited export failed",error:error instanceof Error?error.message:String(error),finishedAt:new Date().toISOString()}); }
  }).finally(()=>{inFlight=null;});
  return inFlight;
}
