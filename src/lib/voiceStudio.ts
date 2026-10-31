import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { HeavyWorkWaitError, lowerChildProcessPriority } from "./renderResources";

const REVISION = "724fb5abbf5502583fb520898d45929e62f02c0b";
type VoiceSettings = { enabled: true; licenseAccepted: true; python: string; modelDirectory: string };
export type VoiceStudioCue = { text: string; start: number; end: number; duration: number };

export function validateVoiceStudioSettings(value: unknown): VoiceSettings {
  const data = value as VoiceSettings;
  if (!data || data.enabled !== true || data.licenseAccepted !== true
    || typeof data.python !== "string" || !path.isAbsolute(data.python)
    || /^[\\/]{2}/.test(data.python)
    || !/^python(?:\.exe)?$/i.test(path.basename(data.python))
    || typeof data.modelDirectory !== "string" || !path.isAbsolute(data.modelDirectory)
    || /^[\\/]{2}/.test(data.modelDirectory)
    || path.basename(data.modelDirectory) !== REVISION) {
    throw new Error("VoiceStudio narration configuration is invalid. Repair its local installation; no replacement voice was selected.");
  }
  return data;
}

export function voiceStudioCues(value: unknown, captions: string[], sourceSeconds: number, targetSeconds = sourceSeconds): VoiceStudioCue[] {
  const data = value as { source?: string; cues?: VoiceStudioCue[] };
  if (!data || data.source !== "voicestudio-phrase-boundaries" || !Array.isArray(data.cues)
    || data.cues.length !== captions.length || !captions.length || captions.length > 250
    || !Number.isFinite(sourceSeconds) || sourceSeconds <= 0 || sourceSeconds > 300
    || !Number.isFinite(targetSeconds) || targetSeconds <= 0 || targetSeconds > 300) throw new Error("VoiceStudio returned invalid phrase timing.");
  let previousEnd = 0;
  const scale = targetSeconds / sourceSeconds;
  return data.cues.map((cue, index) => {
    if (!cue || cue.text !== captions[index] || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < previousEnd || cue.end <= cue.start || cue.end > sourceSeconds + .01) throw new Error("VoiceStudio phrase timing does not match this narration.");
    previousEnd = cue.end;
    return { text: cue.text, start: cue.start * scale, end: cue.end * scale, duration: (cue.end - cue.start) * scale };
  });
}

/** Runs only the installed CPU engine; no Electron window, API server or model download. */
export async function synthesizeVoiceStudio(captions: string[], output: string, language?: string) {
  let raw: string;
  try { raw = await fs.readFile(path.join(process.cwd(), "storage", "voicestudio.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (raw.length > 8192) throw new Error("VoiceStudio configuration is too large.");
  const settings = validateVoiceStudioSettings(JSON.parse(raw));
  await Promise.all([fs.access(settings.python), fs.access(settings.modelDirectory)]);
  // The measured short-speech peak was 514 MiB; retain extra OS headroom.
  if (os.freemem() < 800 * 1024 * 1024) throw new HeavyWorkWaitError("Waiting for memory before VoiceStudio narration; saved work will continue automatically.");
  const directory = path.dirname(output);
  const plan = path.join(directory, "voicestudio-plan.json");
  const timing = path.join(directory, "voicestudio-timing.json");
  const lang = /[\u0900-\u097f]/u.test(captions.join(" ")) || /^(?:hi|hindi)(?:-|$)/i.test(language || "") ? "hi" : "en";
  await fs.writeFile(plan, JSON.stringify({ version: 1, captions, language: lang }), "utf8");
  await fs.rm(timing, { force: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(settings.python, [path.join(process.cwd(), "scripts", "synthesize-voicestudio.py"),
      "--plan", plan, "--output", output, "--timing", timing, "--model", settings.modelDirectory, "--parent-pid", String(process.pid)], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1",
        SUPERTONIC_INTRA_OP_THREADS: "1", SUPERTONIC_INTER_OP_THREADS: "1", HF_HUB_OFFLINE: "1", PYTHONUTF8: "1" },
    });
    lowerChildProcessPriority(child.pid);
    let diagnostic = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      // The worker also watches its Windows venv launcher, preventing an orphan.
      timedOut = true;
      child.kill();
    }, 300_000);
    child.stdout.resume();
    child.stderr.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-2000); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("VoiceStudio narration timed out; the local voice process was stopped."));
      else if (code === 0) resolve();
      else reject(new Error(`VoiceStudio narration failed: ${diagnostic.trim() || `exit ${code}`}`));
    });
  });
  const saved = await fs.readFile(timing, "utf8");
  if (saved.length > 128 * 1024) throw new Error("VoiceStudio phrase timing is too large.");
  const result = JSON.parse(saved);
  const cues = voiceStudioCues(result, captions, result.seconds);
  return { cues, seconds: result.seconds as number, voice: "Supertonic-3 M1" };
}
