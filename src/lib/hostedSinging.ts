import { createHash } from "node:crypto";
import { songPayload } from "./localSinging";
import { stageSongAudio } from "./songAudio";

// Official public Gradio Space; no credentials, paid fallback or uploaded media.
export const HOSTED_SINGING_ORIGIN = "https://ace-step-ace-step.hf.space";
const endpoint = "/gradio_api/call/__call__";
const maximumResponse = 2 * 1024 * 1024;
const eventId = /^[a-f0-9]{32}$/;
export type HostedSongOutput = { path: string; url: string; is_stream: false };
type SongInput = { lyrics: string; duration: number; style?: string; language?: string; consent?: boolean; taskId?: string; submissionStarted?: boolean; output?: HostedSongOutput; requestFingerprint?: string };
type SongUpdate = { songTaskId?: string; songSubmissionStarted?: boolean; songOutput?: HostedSongOutput; songRequestFingerprint?: string; songTaskFailed?: boolean; stage?: string };
type Save = (change: SongUpdate) => Promise<unknown>;

export class HostedSingingWaitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs = 24 * 60 * 60_000) {
    super("The hosted singing service's free quota is unavailable. Saved lyrics will wait and retry after the free allowance resets; no paid or local-model fallback is used.");
    this.retryAfterMs = Math.max(60_000, Math.min(24 * 60 * 60_000, retryAfterMs));
  }
}

async function boundedText(response: Response) {
  if (Number(response.headers.get("content-length")) > maximumResponse) {
    await response.body?.cancel(); throw new Error("The hosted singing response is too large.");
  }
  if (!response.body) throw new Error("The hosted singing service returned no response.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maximumResponse) { await reader.cancel(); throw new Error("The hosted singing response is too large."); }
      text += decoder.decode(item.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

const parameterNames = ["audio_duration", "prompt", "lyrics", "infer_step", "guidance_scale", "scheduler_type", "cfg_type", "omega_scale", "manual_seeds", "guidance_interval", "guidance_interval_decay", "min_guidance_scale", "use_erg_tag", "use_erg_lyric", "use_erg_diffusion", "oss_steps", "guidance_scale_text", "guidance_scale_lyric", "audio2audio_enable", "ref_audio_strength", "ref_audio_input", "lora_name_or_path"];
export function assertHostedSongSchema(value: unknown) {
  const schema = value as { named_endpoints?: Record<string, { parameters?: { parameter_name?: string; label?: string }[]; returns?: { label?: string }[]; api_visibility?: string }> };
  const generation = schema?.named_endpoints?.["/__call__"];
  const parameters = generation?.parameters;
  const labels: Record<number, string> = { 0: "Audio Duration", 1: "Tags", 2: "Lyrics", 18: "Enable Audio2Audio", 20: "Reference Audio (for Audio2Audio)" };
  if ((generation?.api_visibility && generation.api_visibility !== "public") || !Array.isArray(parameters) || parameters.length !== parameterNames.length
    || parameters.some((parameter, index) => parameter.parameter_name !== parameterNames[index])
    || Object.entries(labels).some(([index, label]) => parameters[Number(index)]?.label !== label)
    || generation?.returns?.[0]?.label !== "Text2Music Generated Audio 1") {
    throw new Error("The official hosted singing API changed. No song was submitted; update this integration before trying again.");
  }
}

export function hostedSongPayload(input: SongInput) {
  if (input.consent !== true) throw new Error("Allow sending this song's description and lyrics to the free hosted ACE-Step service before generating singing. Video files stay local.");
  if (!input.lyrics.trim() || input.lyrics.length > 20_000 || !Number.isFinite(input.duration) || input.duration < 10 || input.duration > 210 || (input.style?.length || 0) > 500) throw new Error("Use original lyrics and a song duration between 10 and 210 seconds.");
  const song = songPayload(input.lyrics, input.duration, input.style || "Acoustic guitar, glockenspiel, handclaps and a cheerful singable chorus.", input.language);
  return { data: [song.audio_duration, `${song.vocal_language === "hi" ? "Hindi" : "English"} vocals. ${song.prompt}`, song.lyrics,
    60, 15, "euler", "apg", 10, "", 0.5, 0, 3, true, false, true, "", 0, 0, false, 0.5, null, "none"] };
}

export function hostedSongFingerprint(input: SongInput) {
  return createHash("sha256").update(JSON.stringify(hostedSongPayload(input))).digest("hex");
}

export function hostedSongDownload(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("The hosted singer finished without a playable audio file.");
  const file = value as { url?: unknown; path?: unknown; is_stream?: unknown };
  if (typeof file.url !== "string" || typeof file.path !== "string" || file.is_stream === true) throw new Error("The hosted singer returned invalid audio metadata.");
  const url = new URL(file.url, HOSTED_SINGING_ORIGIN);
  const prefix = url.pathname.startsWith("/gradio_api/file=") ? "/gradio_api/file=" : url.pathname.startsWith("/file=") ? "/file=" : "";
  let returnedPath: string;
  try { returnedPath = decodeURIComponent(url.pathname.slice(prefix.length)); }
  catch { throw new Error("The hosted singer returned an unsafe audio download."); }
  if (url.origin !== HOSTED_SINGING_ORIGIN || !prefix || url.username || url.password || url.search || url.hash
    || returnedPath !== file.path || !/^\/tmp\/gradio\/[a-f0-9]{20,128}\/[\w .-]+\.(?:mp3|flac)$/i.test(returnedPath)) throw new Error("The hosted singer returned an unsafe audio download.");
  return url;
}

function quotaError(text: string) {
  return /(?:exceeded|exhausted|insufficient|not enough|daily).{0,80}(?:GPU\s*)?quota|quota.{0,80}(?:exceeded|exhausted|insufficient)|too many requests|rate.?limit/i.test(text);
}
async function remoteFetch(route: string, init: RequestInit = {}, timeout = 20_000) {
  return fetch(new URL(route, HOSTED_SINGING_ORIGIN), { ...init, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(timeout) });
}
async function waitForSong(taskId: string, lyrics: string, save: Save): Promise<HostedSongOutput> {
  const response = await remoteFetch(`${endpoint}/${taskId}`, {}, 15 * 60_000);
  if (!response.ok) {
    if (response.status === 429) throw new HostedSingingWaitError();
    throw new Error(`Hosted singing status returned HTTP ${response.status}. Its saved task is retained; no replacement was submitted.`);
  }
  if (!response.body) throw new Error("The hosted singer returned no task status. Its task is retained.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) throw new Error("Hosted singing status ended before completion. Retry reconnects to this saved task.");
      bytes += item.value.byteLength;
      if (bytes > maximumResponse) throw new Error("The hosted singing status exceeded its safe response limit. Its task was retained.");
      buffer = (buffer + decoder.decode(item.value, { stream: true })).replace(/\r\n/g, "\n");
      for (let boundary; (boundary = buffer.indexOf("\n\n")) >= 0;) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const kind = /^event:\s*(\S+)/m.exec(block)?.[1];
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!kind || kind === "heartbeat") continue;
        if (kind === "error") {
          if (quotaError(data)) { await save({ songTaskId: undefined, songSubmissionStarted: false, songRequestFingerprint: undefined }); throw new HostedSingingWaitError(); }
          await save({ songTaskFailed: true });
          throw new Error("The hosted singer could not generate this song. Its task is retained; no speech or replacement song was substituted.");
        }
        if (kind === "complete") {
          const result: unknown = JSON.parse(data);
          if (!Array.isArray(result)) { await save({ songTaskFailed: true }); throw new Error("The hosted singer returned invalid output evidence."); }
          const metadata = result[1];
          if (result.length !== 2 || !result[0] || !metadata || metadata.task !== "text2music" || metadata.lyrics !== lyrics || metadata.audio2audio_enable !== false || metadata.ref_audio_input !== null) { await save({ songTaskFailed: true }); throw new Error("The hosted singer did not return a song matching the submitted lyrics and original-generation mode. No narration was substituted."); }
          const url = hostedSongDownload(result[0]);
          const file = result[0] as HostedSongOutput;
          const output: HostedSongOutput = { path: file.path, url: url.href, is_stream: false };
          await save({ songOutput: output, stage: "Generated song confirmed — saving the same audio file" });
          return output;
        }
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Only descriptions/lyrics leave this PC. Known tasks reconnect; uncertain submissions never repeat. */
export async function prepareHostedSong(input: SongInput, save: Save) {
  const payload = hostedSongPayload(input);
  const requestFingerprint = hostedSongFingerprint(input);
  if ((input.taskId || input.output || input.submissionStarted || input.requestFingerprint) && input.requestFingerprint !== requestFingerprint) throw new Error("The saved song request does not match these lyrics, language, style or duration. Start a new song request; the earlier task was retained and not duplicated.");
  let taskId = input.taskId;
  if (taskId && !eventId.test(taskId)) throw new Error("The saved hosted singing task is invalid. No replacement was submitted.");
  if (input.output && !taskId) throw new Error("The saved song output has no matching hosted task. No download was started.");
  if (!taskId) {
    if (input.submissionStarted) throw new Error("The previous hosted song submission is uncertain. Its request was retained; Phoenix will not submit a duplicate song automatically.");
    const schema = await remoteFetch("/gradio_api/info");
    if (!schema.ok) {
      if (schema.status === 429) throw new HostedSingingWaitError();
      throw new Error("The official hosted singing API is unavailable. No song was submitted.");
    }
    assertHostedSongSchema(JSON.parse(await boundedText(schema)));
    await save({ songSubmissionStarted: true, songRequestFingerprint: requestFingerprint, stage: "Submitting original lyrics to free hosted ACE-Step" });
    const response = await remoteFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) {
      if (response.status === 429) { await save({ songSubmissionStarted: false, songRequestFingerprint: undefined }); throw new HostedSingingWaitError(); }
      throw new Error(`The hosted singer returned HTTP ${response.status}. Submission may be uncertain; Phoenix will not automatically send a duplicate.`);
    }
    const accepted = JSON.parse(await boundedText(response));
    const acceptedTaskId = accepted.event_id;
    if (typeof acceptedTaskId !== "string" || !eventId.test(acceptedTaskId)) throw new Error("The hosted singer did not confirm a valid task ID. Phoenix will not repeat this uncertain submission.");
    taskId = acceptedTaskId;
    await save({ songTaskId: taskId, stage: "Hosted singing queued — shared free GPU; exact ETA is not supplied" });
  }
  let output: HostedSongOutput | undefined = input.output;
  for (let attempt = 0; !output && attempt < 3; attempt++) {
    try { output = await waitForSong(taskId, input.lyrics, save); break; }
    catch (error) {
      if (error instanceof HostedSingingWaitError || attempt === 2 || !(error instanceof TypeError || (error instanceof Error && /timeout|aborted|ended before completion/i.test(error.message)))) throw error;
      await save({ stage: `Reconnecting ${attempt + 1}/3 to the same hosted song; no new generation request` });
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }
  const audio = await fetch(hostedSongDownload(output), { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!audio.ok || !audio.body) throw new Error("Could not download the completed hosted song. Its task ID was kept for retry.");
  if (Number(audio.headers.get("content-length")) > 100 * 1024 * 1024) { await audio.body.cancel(); throw new Error("The hosted song exceeds the 100 MB audio limit."); }
  await save({ stage: "Saving the generated singing and accompaniment; listen before posting" });
  return stageSongAudio(audio.body, "Original hosted ACE-Step song.mp3", "hosted-ace");
}
