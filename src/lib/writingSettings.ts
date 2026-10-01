import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { withFileLock } from "./fileLock";

export const WRITING_GROQ_MODEL = "openai/gpt-oss-20b";
export type WritingSettings = { provider: "ollama" | "groq"; model: string; apiKey?: string; freePlanConfirmed: boolean; allowVideoFrames?: boolean };
export class WritingSettingsError extends Error { readonly code = "PHOENIX_WRITING_SETTINGS"; }
const filename = () => path.join(process.cwd(), "storage", "private", "writer-settings.json");
const keyValid = (key: unknown): key is string => typeof key === "string" && /^gsk_[A-Za-z0-9_-]{16,250}$/.test(key);

/** Server-only. Missing settings preserve local behavior; damaged settings fail closed. */
export function readWritingSettings(): WritingSettings {
  let value: Record<string, unknown>;
  try {
    if (fs.statSync(filename()).size > 8192) throw new Error();
    value = JSON.parse(fs.readFileSync(filename(), "utf8"));
    if (!value || !["ollama", "groq"].includes(String(value.provider)) || typeof value.freePlanConfirmed !== "boolean"
      || (value.apiKey !== undefined && value.apiKey !== "" && !keyValid(value.apiKey))) throw new Error();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { provider: "ollama", model: process.env.OLLAMA_MODEL || "qwen2.5:3b", freePlanConfirmed: false };
    throw new WritingSettingsError("Private writing settings could not be read. Restore the settings file; no fallback provider was selected.");
  }
  return { provider: value.provider as WritingSettings["provider"], model: value.provider === "groq" ? WRITING_GROQ_MODEL : process.env.OLLAMA_MODEL || "qwen2.5:3b",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined, freePlanConfirmed: value.freePlanConfirmed as boolean, allowVideoFrames: value.allowVideoFrames === true };
}

export function publicWritingSettings() {
  const settings = readWritingSettings();
  const configured = settings.provider === "ollama" || (!!settings.apiKey && settings.freePlanConfirmed);
  return { provider: settings.provider, model: settings.model, configured, hasKey: !!settings.apiKey, freePlanConfirmed: settings.freePlanConfirmed, allowVideoFrames: settings.allowVideoFrames === true,
    detail: settings.provider === "ollama" ? "Ollama writes on this PC and needs enough free RAM."
      : configured ? "Groq writing configured. Test key/model access below; Phoenix cannot verify your billing tier."
        : "Add a Groq Free-plan key and confirm the account tier. No fallback is used." };
}

export async function saveWritingSettings(input: { provider: "ollama" | "groq"; apiKey?: string; freePlanConfirmed?: boolean; allowVideoFrames?: boolean }) {
  if (!["groq", "ollama"].includes(input.provider)) throw new WritingSettingsError("Choose Groq or local Ollama.");
  if (input.provider === "groq" && input.freePlanConfirmed !== true) throw new WritingSettingsError("Confirm that the Groq account is on Free with no paid upgrade. Phoenix cannot verify billing tier.");
  const supplied = input.apiKey?.trim();
  if (supplied && !keyValid(supplied)) throw new WritingSettingsError("Enter a valid Groq API key. Never paste it in chat.");
  await withFileLock(`${filename()}.lock`, async () => {
    const previous = readWritingSettings();
    const apiKey = supplied || previous.apiKey;
    if (input.provider === "groq" && !apiKey) throw new WritingSettingsError("Enter the Groq API key before selecting Groq.");
    const temporary = `${filename()}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fsp.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ provider: input.provider, apiKey, freePlanConfirmed: input.provider === "groq" && input.freePlanConfirmed === true, allowVideoFrames: input.allowVideoFrames ?? previous.allowVideoFrames ?? false })); await handle.sync(); }
      finally { await handle.close(); }
      await fsp.rename(temporary, filename());
    } catch { throw new WritingSettingsError("Could not save private writing settings. Check folder access and retry; no key was printed."); }
    finally { await fsp.rm(temporary, { force: true }).catch(() => undefined); }
  });
  return publicWritingSettings();
}
