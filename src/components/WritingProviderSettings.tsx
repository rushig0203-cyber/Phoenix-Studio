"use client";
import { useEffect, useRef, useState } from "react";
type Settings = { provider: "ollama" | "groq"; model: string; configured: boolean; hasKey: boolean; freePlanConfirmed: boolean; allowVideoFrames?: boolean; detail: string };
export default function WritingProviderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<"groq" | "ollama">("groq");
  const [key, setKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [framesAllowed, setFramesAllowed] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/writing-provider", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Writing settings could not be loaded.");
      const value: Settings = await response.json(); setSettings(value); setProvider(value.provider); setConfirmed(value.freePlanConfirmed); setFramesAllowed(value.allowVideoFrames === true);
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, []);
  async function command(action: "save" | "test") {
    if (locked.current) return; locked.current = true; setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/writing-provider", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "test" ? { action } : { action, provider, apiKey: key || undefined, freePlanConfirmed: confirmed, allowVideoFrames: framesAllowed }), signal: AbortSignal.timeout(20_000) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Writing setup failed.");
      if (action === "save") { setSettings(value); setKey(""); setNotice(provider === "groq" ? "Key and model access checked; saved on this PC. Queued writing will resume automatically. Billing tier remains your confirmation, not API-verified." : "Local writer selected. Queued work reads the setting automatically."); }
      else setNotice(value.detail);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Connection could not be checked."); }
    finally { locked.current = false; setBusy(false); }
  }
  return <details id="writing-settings" className="mt-3 border-t pt-3 text-sm">
    <summary className="cursor-pointer font-semibold">Writing settings · use Groq to avoid local-model RAM</summary>
    <div className="mt-3 max-w-2xl space-y-3">
      <p>{settings?.detail || "Loading writing settings…"}</p>
      <label className="block">Writer<select className="ml-2 rounded border bg-white p-2" value={provider} disabled={busy} onChange={e => { setProvider(e.target.value as "groq" | "ollama"); setNotice(""); }}><option value="groq">Groq · your Free-plan account</option><option value="ollama">Ollama · local RAM required</option></select></label>
      {provider === "groq" ? <>
        <p>Get a key from <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="underline">Groq API keys</a>. Don’t add billing or upgrade. Text prompts, scripts and improvement guidance go to Groq. Full video/audio files and rendering stay on this PC; sampled images are sent only with the permission below.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={framesAllowed} disabled={busy} onChange={event => setFramesAllowed(event.target.checked)} className="mt-1" /><span>Allow up to three small video frames per analysis to be sent to Groq for video-specific posting captions and hashtags. No local vision model is loaded. Free quotas apply; sampled frames are not a full-video review. Uncheck and save to stop future requests.</span></label>
        <label className="block">Groq API key<input type="password" autoComplete="off" spellCheck={false} maxLength={260} value={key} disabled={busy} onChange={e => setKey(e.target.value)} placeholder={settings?.hasKey ? "Key saved — leave blank to keep it" : "Paste your key here, not in chat"} className="mt-1 block w-full rounded border bg-white p-2" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} className="mt-1" /><span>My Groq account is on the Free plan with no paid upgrade. I understand Phoenix cannot verify billing tier. Free quotas may pause writing; there is no automatic provider fallback.</span></label>
        <p className="text-xs">The key is stored in a private, Git-ignored local settings file, not encrypted by Phoenix. It is never returned to the browser after saving. Keep this Windows account and its backups private.</p>
      </> : <p>Uses the installed local writer. Its memory safety checks stay enabled. Switching back does not start or stop other apps.</p>}
      <div className="flex gap-3"><button className="rounded-lg border bg-[#435432] px-3 py-2 text-white disabled:opacity-50" disabled={busy || !settings || (provider === "groq" && (!confirmed || (!key.trim() && !settings.hasKey)))} onClick={() => void command("save")}>{busy ? "Working…" : "Save writer"}</button><button className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={busy || settings?.provider !== "groq" || !settings.configured || key.length > 0 || provider !== settings.provider} onClick={() => void command("test")}>Test connection</button></div>
      {notice ? <p role="status" className="rounded bg-[#f0f4e9] p-2">{notice}</p> : null}
    </div>
  </details>;
}
