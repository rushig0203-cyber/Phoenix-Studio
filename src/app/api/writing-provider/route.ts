import { assertLocalRequest } from "@/lib/localRequest";
import { publicWritingSettings, readWritingSettings, readVideoAnalysisSettings, readCloudflareWriterSettings, readCloudflareVideoAnalysisSettings, saveCloudflareCaptionFallback, saveWritingSettings, WritingSettingsError, WRITING_GROQ_MODEL, WRITING_CLOUDFLARE_MODEL, VISION_CLOUDFLARE_MODEL } from "@/lib/writingSettings";
import { probeCloudflareVision } from "@/lib/cloudflareVision";
import { probeGroqWriter } from "@/lib/groqWriter";
import { probeCloudflareWriter } from "@/lib/cloudflareWriter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  try { assertLocalRequest(request); return json(publicWritingSettings()); }
  catch { return json({ error: "Writing settings unavailable. Open Phoenix on localhost and check private configuration." }, 400); }
}
async function boundedInput(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 8192) throw new Error(); chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as Record<string, unknown>;
  } catch { await reader.cancel().catch(() => undefined); throw new Error(); }
  finally { reader.releaseLock(); }
}
export async function POST(request: Request) {
  try { assertLocalRequest(request, true); }
  catch { return json({ error: "Open Writing settings directly in Phoenix on localhost." }, 403); }
  let input: Record<string, unknown>;
  try { input = await boundedInput(request); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(); }
  catch { return json({ error: "Invalid settings request. Keep it under 8 KiB." }, 400); }
  try {
    if (input.action === "test-caption-fallback") return json(await probeCloudflareVision(readCloudflareVideoAnalysisSettings()));
    if (input.action === "save-caption-fallback") {
      if (typeof input.allowCloudflareVideoFrames !== "boolean" || input.apiKey !== undefined && typeof input.apiKey !== "string"
        || input.accountId !== undefined && typeof input.accountId !== "string" || input.freePlanConfirmed !== undefined && typeof input.freePlanConfirmed !== "boolean") return json({ error: "Choose valid Cloudflare caption settings." }, 400);
      if (input.allowCloudflareVideoFrames) {
        const previous = readCloudflareVideoAnalysisSettings();
        const check = await probeCloudflareVision({ provider: "cloudflare", model: VISION_CLOUDFLARE_MODEL,
          apiKey: (input.apiKey as string | undefined)?.trim() || previous.apiKey, accountId: (input.accountId as string | undefined)?.trim() || previous.accountId,
          freePlanConfirmed: input.freePlanConfirmed === true, allowVideoFrames: true });
        if (check.state !== "ready") return json({ error: check.detail }, 400);
      }
      return json(await saveCloudflareCaptionFallback({ apiKey: input.apiKey as string | undefined, accountId: input.accountId as string | undefined,
        freePlanConfirmed: input.freePlanConfirmed === true, allowCloudflareVideoFrames: input.allowCloudflareVideoFrames }));
    }
    if (input.action === "test") {
      const settings = readWritingSettings();
      if (settings.provider === "groq") return json(await probeGroqWriter(settings));
      if (settings.provider === "cloudflare") return json(await probeCloudflareWriter(settings));
      return json({ error: "Save Groq or Cloudflare settings before testing the connection." }, 400);
    }
    if (input.action !== "save" || !["groq", "ollama", "cloudflare"].includes(String(input.provider)) || (input.apiKey !== undefined && typeof input.apiKey !== "string") || (input.accountId !== undefined && typeof input.accountId !== "string")) return json({ error: "Choose a valid writing provider." }, 400);
    if (input.provider === "groq") {
      const previous = readVideoAnalysisSettings();
      const check = await probeGroqWriter({ provider: "groq", model: WRITING_GROQ_MODEL, apiKey: (input.apiKey as string | undefined)?.trim() || previous.apiKey, freePlanConfirmed: input.freePlanConfirmed === true });
      if (check.state !== "ready") return json({ error: check.detail }, 400);
    }
    if (input.provider === "cloudflare") {
      const previous = readCloudflareWriterSettings();
      const check = await probeCloudflareWriter({ provider: "cloudflare", model: WRITING_CLOUDFLARE_MODEL,
        apiKey: (input.apiKey as string | undefined)?.trim() || previous.apiKey,
        accountId: (input.accountId as string | undefined)?.trim() || previous.accountId,
        freePlanConfirmed: input.freePlanConfirmed === true });
      if (check.state !== "ready") return json({ error: check.detail }, 400);
    }
    if (input.allowVideoFrames !== undefined && typeof input.allowVideoFrames !== "boolean") return json({ error: "Choose whether sampled video frames may be sent." }, 400);
    return json(await saveWritingSettings({ provider: input.provider as "groq" | "ollama" | "cloudflare", apiKey: input.apiKey as string | undefined, accountId: input.accountId as string | undefined, freePlanConfirmed: input.freePlanConfirmed === true, allowVideoFrames: input.allowVideoFrames as boolean | undefined }));
  } catch (error) { return json({ error: error instanceof WritingSettingsError ? error.message : "Writing settings could not be updated. No secret was logged; retry the action." }, 400); }
}
