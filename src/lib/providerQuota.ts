import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeAtomicJson } from "./atomicJson";
import type { WritingSettings } from "./writingSettings";

type QuotaFile = "groq-cooldown.json" | "cloudflare-writer-cooldown.json" | "cloudflare-account-quota.json";
const filename = (name: QuotaFile) => path.join(process.cwd(), "storage", "private", name);
export async function providerQuotaDelay(name: QuotaFile, identity: string) {
  try {
    if ((await fs.stat(filename(name))).size > 4096) throw new Error();
    const state: unknown = JSON.parse(await fs.readFile(filename(name), "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state)
      || !("identity" in state) || typeof state.identity !== "string" || !/^[a-f0-9]{64}$/.test(state.identity)
      || !("until" in state) || typeof state.until !== "number" || !Number.isSafeInteger(state.until) || state.until <= 0) throw new Error();
    return state.identity === identity ? Math.max(0, Math.min(86_400_000, (state.until as number) - Date.now())) : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw new Error("Provider quota state could not be read. Saved work is retained; no request was sent.");
  }
}
const accountIdentity = (settings: WritingSettings) => createHash("sha256").update(`${settings.accountId}:${settings.apiKey}`).digest("hex");
export const cloudflareDailyQuotaDelay = (settings: WritingSettings) => providerQuotaDelay("cloudflare-account-quota.json", accountIdentity(settings));
export async function saveCloudflareDailyQuota(settings: WritingSettings, until: number) {
  // The free daily allocation is shared by text and image analysis, not per model.
  await writeAtomicJson(filename("cloudflare-account-quota.json"), { identity: accountIdentity(settings), until });
}
