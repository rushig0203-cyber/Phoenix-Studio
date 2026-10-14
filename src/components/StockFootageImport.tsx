"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";

const MAX_IMPORT_BYTES = 500 * 1024 * 1024;
type ImportProvider = "mixkit" | "dareful";

export default function StockFootageImport({ disabled, acquire, release, onStarted }: {
  disabled: boolean; acquire: () => boolean; release: () => void; onStarted: (message: string) => void;
}) {
  const [provider, setProvider] = useState<ImportProvider>("mixkit");
  const [file, setFile] = useState<File | null>(null);
  const [sourcePage, setSourcePage] = useState(""), [creator, setCreator] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [queued, setQueued] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const mounted = useRef(true), inFlight = useRef(false), accepted = useRef(false);
  const savedRequest = useRef<{ file: File; provider: ImportProvider; page: string; creator: string; id: string } | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function resetRequest() {
    setError(""); setNotice("");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!mounted.current || disabled || inFlight.current || accepted.current) return;
    setError("");
    if (!file || !file.size || file.size > MAX_IMPORT_BYTES || file.name.length > 255 || !/\.(mp4|mov|webm|mkv)$/i.test(file.name)) {
      setError("Choose an MP4, MOV, WebM or MKV clip of up to 500 MB."); return;
    }
    let page: URL;
    try { page = new URL(sourcePage.trim()); } catch { setError("Add the original clip page URL, not its download link."); return; }
    const domain = provider === "mixkit" ? "mixkit.co" : "dareful.com";
    const clipPage = provider === "mixkit" ? /^\/free-stock-video\/[^/]+\/?$/.test(page.pathname)
      : /^\/[^/]+\/?$/.test(page.pathname) && !/^\/(?:about|sitemap|category|tag|privacy|terms)(?:[.\-/]|$)/i.test(page.pathname);
    if (page.protocol !== "https:" || ![domain, `www.${domain}`].includes(page.hostname) || page.username || page.password || page.port || !clipPage) {
      setError(`Use the original clip page on ${domain}.`); return;
    }
    if (creator.trim().length > 120) { setError("Keep the creator credit within 120 characters."); return; }
    if (!confirmed || (provider === "dareful" && !creator.trim())) {
      setError(provider === "dareful" ? "Enter the credited creator and confirm the CC BY 4.0 licence." : "Confirm this clip has Mixkit’s Free licence, not its Restricted licence."); return;
    }
    if (!acquire()) return;
    inFlight.current = true; setBusy(true); setNotice(`Uploading ${file.name}… 0%`);
    // Keep the same request ID after an ambiguous response, until the input changes.
    if (!savedRequest.current || savedRequest.current.file !== file || savedRequest.current.provider !== provider
      || savedRequest.current.page !== page.href || savedRequest.current.creator !== creator.trim()) {
      savedRequest.current = { file, provider, page: page.href, creator: creator.trim(), id: crypto.randomUUID() };
    }
    const request = new XMLHttpRequest();
    const finish = (failure?: string) => {
      if (!inFlight.current) return;
      inFlight.current = false; release();
      if (mounted.current) { setBusy(false); if (failure) { setError(failure); setNotice(""); } }
    };
    try {
      request.open("POST", "/api/stock/manual-import");
      request.timeout = 780_000;
      request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      request.setRequestHeader("X-Phoenix-Filename", encodeURIComponent(file.name));
      request.setRequestHeader("X-Phoenix-Title", encodeURIComponent(file.name.replace(/\.[^.]+$/, "").slice(0, 160)));
      request.setRequestHeader("X-Phoenix-Stock-Provider", provider);
      request.setRequestHeader("X-Phoenix-Source-Page", encodeURIComponent(page.href));
      request.setRequestHeader("X-Phoenix-Creator", encodeURIComponent(creator.trim()));
      request.setRequestHeader("X-Phoenix-Request-Id", savedRequest.current.id);
      request.setRequestHeader("X-Phoenix-Licence-Confirmed", "true");
      request.upload.onprogress = progress => {
        if (mounted.current && inFlight.current && progress.lengthComputable) setNotice(progress.loaded >= progress.total
          ? "Upload received. Checking the clip and saving your reel job…" : `Uploading ${file.name}… ${Math.round(progress.loaded / progress.total * 100)}%`);
      };
      request.onerror = () => finish("Could not confirm the import. Retry uses the same saved request, without duplicating a job.");
      request.onabort = request.ontimeout = () => finish("The import connection stopped. Retry checks the same saved request.");
      request.onload = () => {
        let data: { job?: { id?: string }; message?: string; error?: string } | null = null;
        try { data = JSON.parse(request.responseText); } catch { /* Use the explicit HTTP fallback. */ }
        if (request.status < 200 || request.status >= 300) { finish(data?.error || `Import failed (${request.status}). Retry uses the same request.`); return; }
        if (!data?.job?.id) { finish("Could not confirm a saved reel job. Retry checks the same request without duplicating it."); return; }
        accepted.current = true;
        const message = typeof data.message === "string" ? data.message : "Imported footage reel queued. Review the finished video before posting.";
        if (mounted.current) { setQueued(true); setNotice(message); }
        finish();
        if (mounted.current) onStarted(message);
      };
      // Send the File directly: the browser streams it without an in-memory copy.
      request.send(file);
    } catch {
      finish("Could not start the import. Retry uses the same request.");
    }
  }

  const locked = disabled || busy || queued;
  return <details className="mt-4 rounded-xl border border-[#d9dfc3] p-3">
    <summary className="cursor-pointer text-sm font-medium">Import Mixkit / Dareful</summary>
    <p className="mt-3 text-xs text-[#657153]">Download a free clip from <a href="https://mixkit.co/free-stock-video/" target="_blank" rel="noreferrer" className="underline">Mixkit</a> or <a href="https://dareful.com/" target="_blank" rel="noreferrer" className="underline">Dareful</a>, then import it here. Phoenix processes this one downloaded clip as a reel source; these websites are not searched automatically.</p>
    <form className="mt-3 space-y-3" onSubmit={submit}>
      <fieldset disabled={locked} className="space-y-3">
        <label className="block text-sm">Footage source<select className="mt-1 block w-full rounded-lg border p-2" value={provider} onChange={event => { setProvider(event.target.value as ImportProvider); setConfirmed(false); resetRequest(); }}><option value="mixkit">Mixkit · Free licence only</option><option value="dareful">Dareful · CC BY 4.0</option></select></label>
        <label className="block text-sm">Downloaded clip<input type="file" accept=".mp4,.mov,.webm,.mkv" className="mt-1 block w-full rounded-lg border p-2" onChange={event => { setFile(event.target.files?.[0] || null); setConfirmed(false); resetRequest(); }} /></label>
        <label className="block text-sm">Original clip page<input type="url" required maxLength={1000} value={sourcePage} placeholder={provider === "mixkit" ? "https://mixkit.co/free-stock-video/…" : "https://dareful.com/clip-name/"} className="mt-1 block w-full rounded-lg border p-2" onChange={event => { setSourcePage(event.target.value); setConfirmed(false); resetRequest(); }} /></label>
        <label className="block text-sm">Creator {provider === "dareful" ? "(required for credit)" : "(optional)"}<input value={creator} required={provider === "dareful"} maxLength={120} className="mt-1 block w-full rounded-lg border p-2" onChange={event => { setCreator(event.target.value); resetRequest(); }} /></label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={confirmed} onChange={event => { setConfirmed(event.target.checked); resetRequest(); }} className="mt-0.5" /><span>{provider === "mixkit" ? "I checked that this clip has Mixkit’s Free licence (not Restricted), and I may use it commercially." : "I checked that this Dareful clip has a CC BY 4.0 licence. Phoenix must preserve its creator/source credit, licence link and edit notice when posting."}</span></label>
        <p className="text-xs text-[#657153]">The licence is your confirmation, not a provider-verified API result. Up to 500 MB; no card or new model is needed.</p>
        {provider === "dareful" ? <p className="text-xs text-[#657153]">Reel uploads retain credits; captionless Stories require visible credits first.</p> : null}
      </fieldset>
      <Button type="submit" variant="outline" disabled={locked}>{busy ? "Importing clip…" : queued ? "Reel queued" : error ? "Retry import" : "Import and make reel"}</Button>
      {notice ? <p role="status" aria-live="polite" className="text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
    </form>
  </details>;
}
