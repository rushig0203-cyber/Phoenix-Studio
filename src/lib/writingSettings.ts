import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { withFileLock } from "./fileLock";

export const WRITING_GROQ_MODEL = "openai/gpt-oss-20b";
export const WRITING_CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export type WritingProvider = "ollama" | "groq" | "cloudflare";
export type WritingSettings = {
  provider: WritingProvider; model: string; apiKey?: string; accountId?: string; freePlanConfirmed: boolean;
  allowVideoFrames?: boolean; groqApiKey?: string; groqFreePlanConfirmed?: boolean;
};
export class WritingSettingsError extends Error { readonly code = "PHOENIX_WRITING_SETTINGS"; }
const filename = () => path.join(process.cwd(), "storage", "private", "writer-settings.json");
const groqKeyValid = (key: unknown): key is string => typeof key === "string" && /^gsk_[A-Za-z0-9_-]{16,250}$/.test(key);
const cloudflareKeyValid = (key: unknown): key is string => typeof key === "string" && !key.startsWith("gsk_") && /^[A-Za-z0-9_-]{20,250}$/.test(key);
const accountValid = (id: unknown): id is string => typeof id === "string" && /^[a-fA-F0-9]{32}$/.test(id);
const localModel = () => process.env.OLLAMA_MODEL || "qwen2.5:3b";

function readRaw(): Record<string, unknown> {
  try {
    if (fs.statSync(filename()).size > 8192) throw new Error();
    const value = JSON.parse(fs.readFileSync(filename(), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !["ollama", "groq", "cloudflare"].includes(String(value.provider))
      || (value.freePlanConfirmed !== undefined && typeof value.freePlanConfirmed !== "boolean")
      || (value.allowVideoFrames !== undefined && typeof value.allowVideoFrames !== "boolean")
      || (value.groqFreePlanConfirmed !== undefined && typeof value.groqFreePlanConfirmed !== "boolean")
      || (value.apiKey !== undefined && value.apiKey !== "" && !groqKeyValid(value.apiKey))
      || (value.groqApiKey !== undefined && value.groqApiKey !== "" && !groqKeyValid(value.groqApiKey))
      || (value.cloudflareApiKey !== undefined && value.cloudflareApiKey !== "" && !cloudflareKeyValid(value.cloudflareApiKey))
      || (value.cloudflareAccountId !== undefined && value.cloudflareAccountId !== "" && !accountValid(value.cloudflareAccountId))
      || (value.cloudflareFreePlanConfirmed !== undefined && typeof value.cloudflareFreePlanConfirmed !== "boolean")) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { provider: "ollama" };
    throw new WritingSettingsError("Private writing settings could not be read. Restore the settings file; no fallback provider was selected.");
  }
}

/** Server-only. Legacy apiKey is the Groq key; it is never reinterpreted as a Cloudflare token. */
export function readWritingSettings(): WritingSettings {
  const value = readRaw();
  const provider = value.provider as WritingProvider;
  const groqApiKey = typeof value.groqApiKey === "string" ? value.groqApiKey : typeof value.apiKey === "string" ? value.apiKey : undefined;
  const groqFreePlanConfirmed = value.groqFreePlanConfirmed === true || (value.provider === "groq" && value.freePlanConfirmed === true);
  if (provider === "groq") return { provider, model: WRITING_GROQ_MODEL, apiKey: groqApiKey, groqApiKey, groqFreePlanConfirmed, freePlanConfirmed: groqFreePlanConfirmed, allowVideoFrames: value.allowVideoFrames === true };
  if (provider === "cloudflare") return { provider, model: WRITING_CLOUDFLARE_MODEL,
    apiKey: typeof value.cloudflareApiKey === "string" ? value.cloudflareApiKey : undefined,
    accountId: typeof value.cloudflareAccountId === "string" ? value.cloudflareAccountId : undefined,
    freePlanConfirmed: value.cloudflareFreePlanConfirmed === true, groqApiKey, groqFreePlanConfirmed,
    allowVideoFrames: value.allowVideoFrames === true };
  return { provider, model: localModel(), groqApiKey, groqFreePlanConfirmed,
    freePlanConfirmed: false, allowVideoFrames: value.allowVideoFrames === true };
}

/** Video-frame analysis remains a separate Groq-only consent path, regardless of text writer selection. */
export function readVideoAnalysisSettings(): WritingSettings {
  const settings = readWritingSettings();
  return { provider: "groq", model: WRITING_GROQ_MODEL, apiKey: settings.groqApiKey,
    freePlanConfirmed: settings.groqFreePlanConfirmed === true, allowVideoFrames: settings.allowVideoFrames === true };
}

/** Server-only credential lookup for an explicit Cloudflare test; never serialize this result to the browser. */
export function readCloudflareWriterSettings(): WritingSettings {
  const value = readRaw();
  return { provider: "cloudflare", model: WRITING_CLOUDFLARE_MODEL,
    apiKey: typeof value.cloudflareApiKey === "string" ? value.cloudflareApiKey : undefined,
    accountId: typeof value.cloudflareAccountId === "string" ? value.cloudflareAccountId : undefined,
    freePlanConfirmed: value.cloudflareFreePlanConfirmed === true };
}

export function publicWritingSettings() {
  const raw = readRaw();
  const settings = readWritingSettings();
  const configured = settings.provider === "ollama" || (!!settings.apiKey && settings.freePlanConfirmed && (settings.provider !== "cloudflare" || !!settings.accountId));
  return { provider: settings.provider, model: settings.model, configured, hasKey: !!settings.apiKey,
    hasGroqVisionKey: !!settings.groqApiKey, hasCloudflareKey: typeof raw.cloudflareApiKey === "string",
    hasGroqKey: !!settings.groqApiKey, freePlanConfirmed: settings.freePlanConfirmed,
    allowVideoFrames: settings.allowVideoFrames === true, detail: settings.provider === "ollama"
      ? "Ollama writes on this PC and needs enough free RAM."
      : settings.provider === "groq" ? configured
        ? "Groq writing configured. Test key/model access below; Phoenix cannot verify your billing tier."
        : "Add a Groq Free-plan key and confirm the account tier. No fallback is used."
      : configured ? "Cloudflare Workers AI writing is configured with your Free-plan confirmation. Test account/model access below; Phoenix cannot verify billing tier or remaining daily quota."
        : "Add a Cloudflare Workers AI API token and Account ID, then confirm the Free plan. No fallback is used." };
}

export async function saveWritingSettings(input: { provider: WritingProvider; apiKey?: string; accountId?: string; freePlanConfirmed?: boolean; allowVideoFrames?: boolean }) {
  if (!["groq", "ollama", "cloudflare"].includes(input.provider)) throw new WritingSettingsError("Choose Groq, Cloudflare Workers AI, or local Ollama.");
  if (input.provider !== "ollama" && input.freePlanConfirmed !== true) throw new WritingSettingsError(`Confirm that the ${input.provider === "groq" ? "Groq" : "Cloudflare Workers AI"} account is on its Free plan. Phoenix cannot verify billing tier.`);
  const supplied = input.apiKey?.trim();
  if (supplied && !(input.provider === "cloudflare" ? cloudflareKeyValid(supplied) : input.provider === "groq" ? groqKeyValid(supplied) : false)) throw new WritingSettingsError(input.provider === "cloudflare" ? "Enter a valid Cloudflare API token." : "Enter a valid Groq API key. Never paste it in chat.");
  if (input.accountId?.trim() && !accountValid(input.accountId.trim())) throw new WritingSettingsError("Enter the 32-character Cloudflare Account ID.");
  await withFileLock(`${filename()}.lock`, async () => {
    const previous = readRaw();
    const groqApiKey = typeof previous.groqApiKey === "string" ? previous.groqApiKey : typeof previous.apiKey === "string" ? previous.apiKey : undefined;
    const cloudflareApiKey = typeof previous.cloudflareApiKey === "string" ? previous.cloudflareApiKey : undefined;
    const cloudflareAccountId = typeof previous.cloudflareAccountId === "string" ? previous.cloudflareAccountId : undefined;
    const nextGroqKey = input.provider === "groq" ? supplied || groqApiKey : groqApiKey;
    const nextCloudflareKey = input.provider === "cloudflare" ? supplied || cloudflareApiKey : cloudflareApiKey;
    const nextAccountId = input.provider === "cloudflare" ? input.accountId?.trim() || cloudflareAccountId : cloudflareAccountId;
    if (input.provider === "groq" && !nextGroqKey) throw new WritingSettingsError("Enter the Groq API key before selecting Groq.");
    if (input.provider === "cloudflare" && (!nextCloudflareKey || !nextAccountId)) throw new WritingSettingsError("Enter the Cloudflare API token and Account ID before selecting Cloudflare.");
    const document = { provider: input.provider, apiKey: nextGroqKey, groqApiKey: nextGroqKey,
      cloudflareApiKey: nextCloudflareKey, cloudflareAccountId: nextAccountId,
      freePlanConfirmed: input.provider === "groq" && input.freePlanConfirmed === true,
      groqFreePlanConfirmed: input.provider === "groq" ? input.freePlanConfirmed === true : previous.groqFreePlanConfirmed === true || (previous.provider === "groq" && previous.freePlanConfirmed === true),
      cloudflareFreePlanConfirmed: input.provider === "cloudflare" ? input.freePlanConfirmed === true : previous.cloudflareFreePlanConfirmed === true,
      allowVideoFrames: input.allowVideoFrames ?? previous.allowVideoFrames === true };
    const temporary = `${filename()}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fsp.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(document)); await handle.sync(); } finally { await handle.close(); }
      await fsp.rename(temporary, filename());
    } catch { throw new WritingSettingsError("Could not save private writing settings. Check folder access and retry; no key was printed."); }
    finally { await fsp.rm(temporary, { force: true }).catch(() => undefined); }
  });
  return publicWritingSettings();
}
