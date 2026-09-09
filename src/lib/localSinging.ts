import os from "node:os";
import { stageSongAudio } from "./songAudio";

/** A conservative Phoenix guard, not the engine's advertised minimum. */
export function singingMemoryBlocker(total = os.totalmem(), free = os.freemem()) {
  if (total < 12 * 1024 ** 3) return "This PC has less than 12 GB usable RAM. Phoenix blocks heavy automatic singing here to protect laptop responsiveness. A sung recording can still be used for free.";
  if (free < 4 * 1024 ** 3) return "Less than 4 GB RAM is currently free. Close memory-heavy apps before generating a local song.";
  return undefined;
}

export function singingBase() {
  const url = new URL(process.env.PHOENIX_ACE_URL || "http://127.0.0.1:8001");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Free singing only accepts a local ACE-Step server; hosted or paid URLs are blocked.");
  return url;
}
function headers() {
  return { "Content-Type": "application/json", ...(process.env.PHOENIX_ACE_TOKEN ? { Authorization: `Bearer ${process.env.PHOENIX_ACE_TOKEN}` } : {}) };
}
async function api(route: string, body?: unknown) {
  const response = await fetch(new URL(route, singingBase()), { method: body ? "POST" : "GET", headers: headers(), body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Local singing engine returned ${response.status}. No paid fallback was attempted.`);
  const payload = await response.json();
  if (payload.error || (payload.code && payload.code !== 200)) throw new Error(`Local singing failed: ${String(payload.error || payload.code).slice(0, 350)}`);
  return payload.data;
}

export async function localSingingStatus() {
  const memory = singingMemoryBlocker();
  try {
    singingBase();
    if (memory) return { available: false, reason: memory, engine: "ACE-Step 1.5", localOnly: true };
    const health = await api("/health");
    if (health?.service !== "ACE-Step API" || health?.status !== "ok") throw new Error("ACE-Step is not ready.");
    const models = await api("/v1/models");
    if (!Array.isArray(models?.models) || !models.models.some((model: { name?: string; is_loaded?: boolean }) => model.name && model.is_loaded !== false)) throw new Error("Start ACE-Step with a loaded model before generating songs.");
    return { available: true, reason: "Local singing engine is ready. Listen to the result before approving any video.", engine: "ACE-Step 1.5", localOnly: true };
  } catch (error) { return { available: false, reason: error instanceof Error ? error.message : "Local ACE-Step singing engine is not running.", engine: "ACE-Step 1.5", localOnly: true }; }
}

export function songPayload(lyrics: string, duration: number, style: string) {
  return { prompt: `Original children's song for ages 3–6. Clear melodic singing with audible acoustic accompaniment, warm adult singer, complete musical ending. ${style}`,
    lyrics, audio_duration: duration, vocal_language: "en", audio_format: "mp3", task_type: "text2music", batch_size: 1,
    inference_steps: 8, thinking: false, use_format: false, sample_mode: false, use_cot_caption: false, use_cot_language: false,
    bpm: 108, key_scale: "C Major", time_signature: "4", use_random_seed: true,
  };
}

export function localSongDownload(value: string) {
  const base = singingBase(), url = new URL(value, base);
  if (url.origin !== base.origin || url.pathname !== "/v1/audio" || !url.searchParams.has("path") || url.username || url.password) throw new Error("The singing engine returned an unsafe audio download; only its local audio endpoint is allowed.");
  return url;
}

export async function prepareLocalSong(input: { lyrics: string; duration: number; style?: string; taskId?: string; submissionStarted?: boolean }, save: (change: { songTaskId?: string; songSubmissionStarted?: boolean; stage?: string }) => Promise<unknown>) {
  const health = await localSingingStatus();
  if (!health.available) throw new Error(health.reason);
  let taskId = input.taskId;
  if (!taskId) {
    if (input.submissionStarted) throw new Error("The previous song submission could not be confirmed. Check ACE-Step before starting another draft; Phoenix will not silently submit a duplicate song.");
    await save({ songSubmissionStarted: true, stage: "Submitting lyrics to the local singing engine" });
    const result = await api("/release_task", songPayload(input.lyrics, input.duration, input.style || "Acoustic guitar, glockenspiel, handclaps and a catchy singable chorus."));
    if (typeof result?.task_id !== "string" || !/^[\w-]{1,100}$/.test(result.task_id)) throw new Error("Local singing submission did not return a valid task ID.");
    taskId = result.task_id;
    await save({ songTaskId: taskId });
  }
  const deadline = Date.now() + 30 * 60_000;
  let failures = 0;
  while (Date.now() < deadline) {
    let result;
    try { result = await api("/query_result", { task_id_list: [taskId] }); failures = 0; }
    catch (error) {
      if (++failures >= 3) throw error;
      await save({ stage: `Singing status unavailable; reconnecting ${failures}/3 to the same song` });
      await new Promise(resolve => setTimeout(resolve, failures * 5000)); continue;
    }
    const task = Array.isArray(result) ? result.find(item => item.task_id === taskId) : undefined;
    if (!task) throw new Error("The local singing task is missing. Check the ACE-Step server; no replacement was submitted.");
    if (task.status === 2) throw new Error(`Local singing failed: ${String(task.error || task.result || "Engine could not produce audio.").slice(0, 500)}`);
    if (task.status === 1) {
      const outputs = typeof task.result === "string" ? JSON.parse(task.result) : task.result;
      if (!Array.isArray(outputs) || typeof outputs[0]?.file !== "string") throw new Error("The singing engine finished without audio.");
      const response = await fetch(localSongDownload(outputs[0].file), { headers: headers(), redirect: "error", signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) throw new Error("Could not download the completed local song.");
      await save({ stage: "Saving the actual sung audio for your listening approval" });
      return stageSongAudio(response.body, "Original local ACE-Step song.mp3", "local-ace");
    }
    await save({ stage: "Local singing is running — exact progress/ETA is not supplied by the engine" });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error("Local singing exceeded 30 minutes. Its task ID was kept; retry reconnects to the same song.");
}
