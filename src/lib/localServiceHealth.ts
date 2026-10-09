import { readWritingSettings } from "./writingSettings";
import { supportsNativeStockPlayback } from "./stockPlayback";

export type LocalServiceState = { state: "ready" | "offline" | "blocked" | "configured"; detail: string };
export type LocalServices = { checkedAt: string; writerProvider: "ollama" | "groq" | "cloudflare"; writer: LocalServiceState; ollama: LocalServiceState; renderer: LocalServiceState };

export async function probeLocalServices(): Promise<LocalServices> {
  const settings = readWritingSettings();
  const [ollama, renderer] = await Promise.all([
    (async (): Promise<LocalServiceState> => {
      if (settings.provider !== "ollama") return { state: "configured", detail: `Ollama is not required while ${settings.provider === "groq" ? "Groq" : "Cloudflare Workers AI"} writing is selected; existing Ollama processes are left alone.` };
      try {
        const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000), redirect: "error", cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data.models)) throw new Error();
        const requested = settings.model;
        const normalize = (name: string) => name.includes(":") ? name : `${name}:latest`;
        return data.models.some((item: { name?: string; model?: string }) => normalize(item.name || item.model || "") === normalize(requested))
          ? { state: "ready", detail: "Local writing server and configured model are available; the model loads only when needed." }
          : { state: "blocked", detail: "Ollama is running, but the configured writing model is missing. No model was downloaded automatically." };
      } catch { return { state: "offline", detail: "Ollama is unavailable. Open the Phoenix shortcut to start the local writing service." }; }
    })(),
    (async (): Promise<LocalServiceState> => {
      try {
        if (!process.env.MPT_BASE_URL) return { state: "blocked", detail: "Set the local MoneyPrinterTurbo URL in Phoenix's private configuration." };
        const base = new URL(process.env.MPT_BASE_URL);
        if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== "/") return { state: "blocked", detail: "Renderer configuration must point to this PC's loopback HTTP service." };
        const response = await fetch(new URL("/openapi.json", base), { headers: process.env.MPT_API_TOKEN ? { "x-api-key": process.env.MPT_API_TOKEN } : {}, signal: AbortSignal.timeout(3000), redirect: "error", cache: "no-store" });
        if (!response.ok) return { state: "blocked", detail: `MoneyPrinterTurbo returned HTTP ${response.status}; check its access settings and logs.` };
        const api = await response.json();
        const properties = api?.components?.schemas?.TaskVideoRequest?.properties;
        return properties?.phoenix_artifacts_version && properties?.phoenix_storyboard && supportsNativeStockPlayback(properties)
          ? { state: "ready", detail: "Compatible local renderer is responding." }
          : { state: "blocked", detail: "The renderer needs the current Phoenix integration patch and a restart." };
      } catch { return { state: "offline", detail: "MoneyPrinterTurbo is unavailable. Open the Phoenix shortcut to start it; saved jobs are retained." }; }
    })(),
  ]);
  // Dashboard polling never calls Groq or spends generation quota. Connection
  // checks are explicit; configuration alone must not claim a ready service.
  const writer: LocalServiceState = settings.provider === "ollama" ? ollama
    : !settings.apiKey || (settings.provider === "cloudflare" && !settings.accountId) ? { state: "blocked", detail: `Add your ${settings.provider === "groq" ? "Groq API key" : "Cloudflare API token and Account ID"} in Studio health writing settings. No fallback writer is used.` }
    : !settings.freePlanConfirmed ? { state: "blocked", detail: `Confirm that your ${settings.provider === "groq" ? "Groq" : "Cloudflare Workers AI"} account uses the Free plan before writing. Phoenix cannot verify billing tier.` }
    : { state: "configured", detail: `${settings.provider === "groq" ? "Groq" : "Cloudflare Workers AI"} writing is configured with your Free-plan confirmation. Use Check connection to verify key/model access; billing tier and remaining quota cannot be verified by Phoenix.` };
  return { checkedAt: new Date().toISOString(), writerProvider: settings.provider, writer, ollama, renderer };
}
let cached: LocalServices | undefined;
let running: Promise<LocalServices> | undefined;
let cachedSelection = "";
let runningSelection = "";
export function localServiceHealth(): Promise<LocalServices> {
  const settings = readWritingSettings();
  // Do not retain the API key in the cache identity or expose it in health JSON.
  const selection = JSON.stringify([settings.provider, settings.model, !!settings.apiKey, !!settings.accountId, settings.freePlanConfirmed]);
  if (cached && cachedSelection === selection && Date.now() - Date.parse(cached.checkedAt) < 15000) return Promise.resolve(cached);
  if (!running || runningSelection !== selection) {
    runningSelection = selection;
    const request = probeLocalServices().then(value => { cachedSelection = selection; return cached = value; }).finally(() => { if (running === request) running = undefined; });
    running = request;
  }
  return running;
}
