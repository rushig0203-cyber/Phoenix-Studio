"use client";
import { useEffect, useRef, useState } from "react";
type Provider = "groq" | "ollama" | "cloudflare";
type Settings = { provider: Provider; model: string; configured: boolean; hasKey: boolean; hasGroqKey: boolean; hasGroqVisionKey: boolean; hasCloudflareKey: boolean; freePlanConfirmed: boolean; allowVideoFrames?: boolean; allowCloudflareVideoFrames?: boolean; captionFallbackConfigured?: boolean; cloudflareCaptionFreePlanConfirmed?: boolean; detail: string };
export default function WritingProviderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<Provider>("groq");
  const [key, setKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [framesAllowed, setFramesAllowed] = useState(false);
  const [fallbackKey, setFallbackKey] = useState("");
  const [fallbackAccount, setFallbackAccount] = useState("");
  const [fallbackAllowed, setFallbackAllowed] = useState(false);
  const [fallbackConfirmed, setFallbackConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/writing-provider", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Writing settings could not be loaded.");
      const value: Settings = await response.json(); setSettings(value); setProvider(value.provider); setConfirmed(value.freePlanConfirmed); setFramesAllowed(value.allowVideoFrames === true);
      setFallbackAllowed(value.allowCloudflareVideoFrames === true); setFallbackConfirmed(value.cloudflareCaptionFreePlanConfirmed === true);
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, []);
  async function command(action: "save" | "test" | "save-caption-fallback" | "test-caption-fallback") {
    if (locked.current) return; locked.current = true; setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/writing-provider", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "test" || action === "test-caption-fallback" ? { action } : action === "save-caption-fallback"
          ? { action, apiKey: fallbackKey || undefined, accountId: fallbackAccount || undefined, freePlanConfirmed: fallbackConfirmed, allowCloudflareVideoFrames: fallbackAllowed }
          : { action, provider, apiKey: key || undefined, accountId: accountId || undefined, freePlanConfirmed: confirmed, allowVideoFrames: framesAllowed }), signal: AbortSignal.timeout(20_000) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Writing setup failed.");
      if (action === "save") { setSettings(value); setKey(""); setAccountId(""); setNotice(provider === "groq" ? "Key and model access checked; saved on this PC. Queued writing will resume automatically. Billing tier remains your confirmation, not API-verified." : provider === "cloudflare" ? "Token, Account ID and model access checked; saved on this PC. Queued writing will resume automatically. Free tier and remaining quota are not API-verified." : "Local writer selected. Queued work reads the setting automatically."); }
      else if (action === "save-caption-fallback") { setSettings(value); setFallbackKey(""); setFallbackAccount(""); setNotice(fallbackAllowed ? "Free caption fallback saved. Quota-waiting captions can resume automatically; your text writer is unchanged. Stopped failures are not silently retried." : "Cloudflare frame permission disabled. Future caption requests will not send frames there."); }
      else setNotice(value.detail);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Connection could not be checked."); }
    finally { locked.current = false; setBusy(false); }
  }
  const providerHasKey = provider === "groq" ? settings?.hasGroqKey : provider === "cloudflare" ? settings?.hasCloudflareKey : true;
  const providerNeedsConfirmation = provider !== "ollama";
  return <details id="writing-settings" className="mt-3 border-t pt-3 text-sm">
    <summary className="cursor-pointer font-semibold">Writing settings · choose the writer for new text</summary>
    <div className="mt-3 max-w-2xl space-y-3">
      <p>{settings?.detail || "Loading writing settings…"}</p>
      <label className="block">Writer<select className="ml-2 rounded border bg-white p-2" value={provider} disabled={busy} onChange={e => { const next = e.target.value as Provider; setProvider(next); setKey(""); setAccountId(""); setConfirmed(false); setNotice(""); }}><option value="groq">Groq · your Free-plan account</option><option value="cloudflare">Cloudflare Workers AI · Free daily allocation</option><option value="ollama">Ollama · local RAM required</option></select></label>
      {provider === "groq" ? <>
        <p>Get a key from <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="underline">Groq API keys</a>. Don’t add billing or upgrade. Text prompts, scripts and improvement guidance go to Groq. Full video/audio files and rendering stay on this PC; sampled images are sent only with the permission below.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={framesAllowed} disabled={busy || !settings?.hasGroqVisionKey} onChange={event => setFramesAllowed(event.target.checked)} className="mt-1" /><span>Allow up to three small video frames per analysis to be sent to Groq only for video-specific posting captions and hashtags. No local vision model is loaded. Free quotas apply; sampled frames are not a full-video review. {settings?.hasGroqVisionKey ? "Uncheck and save to stop future requests." : "Add/save a Groq key before enabling this permission."}</span></label>
        <label className="block">Groq API key<input type="password" autoComplete="off" spellCheck={false} maxLength={260} value={key} disabled={busy} onChange={e => setKey(e.target.value)} placeholder={settings?.hasGroqKey ? "Groq key saved — leave blank to keep it" : "Paste your key here, not in chat"} className="mt-1 block w-full rounded border bg-white p-2" /></label>
        <p className="text-xs">Groq vision consent is independent of the selected text writer. Cloudflare frames require the separate caption permission below.</p>
      </> : provider === "cloudflare" ? <>
        <p>Cloudflare Workers AI offers 10,000 Neurons per day on Workers Free; limits reset at 00:00 UTC. This is a daily cap, not unlimited inference. Going beyond it fails on Free; Phoenix will wait for reset and never upgrade or fall back. The selected model may have capacity limits.</p>
        <p>Set up a token in <a href="https://dash.cloudflare.com/?to=/:account/workers/ai" target="_blank" rel="noreferrer" className="underline">Cloudflare Workers AI</a> or follow the <a href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/" target="_blank" rel="noreferrer" className="underline">official REST setup guide</a>. You need your Account ID and a token with Workers AI Read and Edit permissions. Phoenix tests model availability without generating text.</p>
        <label className="block">Cloudflare Account ID<input type="text" autoComplete="off" spellCheck={false} maxLength={32} value={accountId} disabled={busy} onChange={e => setAccountId(e.target.value)} placeholder={settings?.hasCloudflareKey ? "Saved — leave blank to keep it" : "32-character Account ID"} className="mt-1 block w-full rounded border bg-white p-2" /></label>
        <label className="block">Cloudflare API token<input type="password" autoComplete="off" spellCheck={false} maxLength={250} value={key} disabled={busy} onChange={e => setKey(e.target.value)} placeholder={settings?.hasCloudflareKey ? "Token saved — leave blank to keep it" : "Paste your token here, not in chat"} className="mt-1 block w-full rounded border bg-white p-2" /></label>
        <p>This writer sends only text. Sampled frames go to Cloudflare only if you enable the separate caption fallback below; full video and audio stay on this PC.</p>
      </> : <p>Uses the installed local writer. Its memory safety checks stay enabled. Switching back does not start or stop other apps.</p>}
      {providerNeedsConfirmation ? <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} className="mt-1" /><span>For the selected provider, I confirm this account is on the Free plan and understand Phoenix cannot verify its billing tier. Free quotas may pause writing; there is no automatic provider fallback.</span></label> : null}
      {provider !== "ollama" ? <p className="text-xs">Keys are stored in a private, Git-ignored local settings file, not encrypted by Phoenix. They are never returned to the browser after saving. Keep this Windows account and its backups private.</p> : null}
      <div className="flex gap-3"><button className="rounded-lg border bg-[#435432] px-3 py-2 text-white disabled:opacity-50" disabled={busy || !settings || (providerNeedsConfirmation && (!confirmed || !key.trim() && !providerHasKey || provider === "cloudflare" && !accountId.trim() && !settings.hasCloudflareKey))} onClick={() => void command("save")}>{busy ? "Working…" : "Save writer"}</button><button className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={busy || settings?.provider !== provider || !settings.configured || key.length > 0 || accountId.length > 0} onClick={() => void command("test")}>Test connection</button></div>
      <details className="border-t pt-3">
        <summary className="cursor-pointer font-semibold">Caption backup · Cloudflare Free {settings?.captionFallbackConfigured ? "· enabled" : "· setup needed"}</summary>
        <div className="mt-3 space-y-3">
          <p>When Groq is quota-limited, this backup analyzes the same three small frames and writes this video’s caption and hashtag choices. No model is loaded on your laptop. This does not change your text writer.</p>
          <p>Use <a href="https://dash.cloudflare.com/?to=/:account/workers/ai" target="_blank" rel="noreferrer" className="underline">Workers AI on Workers Free</a> and the <a href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/" target="_blank" rel="noreferrer" className="underline">official token setup</a>. Save the Account ID and a Workers AI Read/Edit token here, never in chat. The daily 10,000 Neurons allowance is shared with Cloudflare text writing; on Free, exhaustion blocks requests until reset. Don’t add payment details or upgrade. Phoenix cannot verify billing tier.</p>
          <label className="block">Cloudflare Account ID<input type="text" autoComplete="off" spellCheck={false} maxLength={32} value={fallbackAccount} disabled={busy} onChange={event => setFallbackAccount(event.target.value)} placeholder={settings?.hasCloudflareKey ? "Saved — leave blank to keep it" : "32-character Account ID"} className="mt-1 block w-full rounded border bg-white p-2" /></label>
          <label className="block">Cloudflare API token<input type="password" autoComplete="off" spellCheck={false} maxLength={250} value={fallbackKey} disabled={busy} onChange={event => setFallbackKey(event.target.value)} placeholder={settings?.hasCloudflareKey ? "Saved — leave blank to keep it" : "Paste the token here, not in chat"} className="mt-1 block w-full rounded border bg-white p-2" /></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={fallbackConfirmed} disabled={busy} onChange={event => setFallbackConfirmed(event.target.checked)} className="mt-1" /><span>I confirm this Cloudflare account is on Workers Free, not a paid plan.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={fallbackAllowed} disabled={busy} onChange={event => setFallbackAllowed(event.target.checked)} className="mt-1" /><span>Allow up to three small video frames per analysis to go to Cloudflare when Groq is quota-limited or Groq frame analysis is disabled. Full videos and audio stay local. Uncheck and save to stop future requests.</span></label>
          <div className="flex gap-3"><button type="button" disabled={busy || !settings || fallbackAllowed && (!fallbackConfirmed || !fallbackKey.trim() && !settings.hasCloudflareKey || !fallbackAccount.trim() && !settings.hasCloudflareKey)} className="rounded-lg border bg-[#435432] px-3 py-2 text-white disabled:opacity-50" onClick={() => void command("save-caption-fallback")}>Save caption backup</button><button type="button" disabled={busy || !settings?.captionFallbackConfigured || fallbackKey.length > 0 || fallbackAccount.length > 0} className="rounded-lg border px-3 py-2 disabled:opacity-50" onClick={() => void command("test-caption-fallback")}>Test caption backup</button></div>
          <p className="text-xs">Keys stay in Git-ignored private local settings, not encrypted by Phoenix. The test checks model access without sending frames or using inference quota. If both providers reach their free limits, saved captions wait for the earliest reset; no paid service or local vision model starts.</p>
        </div>
      </details>
      {notice ? <p role="status" className="rounded bg-[#f0f4e9] p-2">{notice}</p> : null}
    </div>
  </details>;
}
