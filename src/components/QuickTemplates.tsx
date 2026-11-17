"use client";

import { useEffect, useRef, useState } from "react";
import type { ContentIdea, SuggestionReason } from "@/lib/contentIdeas";
import { FOOTAGE_SUGGESTION_REFRESH_MS, nextStoredFootageSuggestions, recordStoredFootageSuggestions, stockTopicPool } from "@/lib/stockFootageSuggestions";
import type { QuickTemplateRequest } from "@/lib/quickTemplates";
import JobProgress from "./JobProgress";

type Template = ContentIdea & SuggestionReason;
type TemplateJob = { status: string; progress: number; stage?: string; error?: string };
const catalogue = new Map(stockTopicPool().map(idea => [idea.id, idea]));

export default function QuickTemplates({ request, job, onRequest, onStarted, onRetry, disabled = false }: {
  request: QuickTemplateRequest | null;
  job?: TemplateJob;
  onRequest: (value: QuickTemplateRequest | null) => void;
  onStarted: (message: string) => void;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true), [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(""), [canChange, setCanChange] = useState(false);
  const busy = useRef(false), mounted = useRef(true);
  const cursor = useRef(0), memory = useRef(new Map<string, string>());
  const storageWorking = useRef(true);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    mounted.current = true;
    let pending = false;
    const controller = new AbortController();
    const storage = {
      getItem(key: string) {
        if (storageWorking.current) try { const value = localStorage.getItem(key); if (value) memory.current.set(key, value); return value ?? memory.current.get(key) ?? null; } catch { storageWorking.current = false; }
        return memory.current.get(key) ?? null;
      },
      setItem(key: string, value: string) { memory.current.set(key, value); if (storageWorking.current) try { localStorage.setItem(key, value); } catch { storageWorking.current = false; } },
    };
    async function refresh() {
      if (pending || busy.current) return;
      pending = true; setLoading(true); setError("");
      const saved = nextStoredFootageSuggestions(storage, cursor.current);
      try {
        const query = new URLSearchParams({ workflow: "footage", cursor: String(saved.cursor), seen: saved.seen.join(",") });
        const response = await fetch(`/api/content-suggestions?${query}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Could not read your saved video preferences. Try refreshing templates.");
        const data = await response.json() as { ideas: Template[]; nextCursor: number };
        if (!Array.isArray(data.ideas) || data.ideas.length < 5 || data.ideas.length > 6 || new Set(data.ideas.map(idea => idea?.id)).size !== data.ideas.length
          || !Number.isSafeInteger(data.nextCursor) || data.nextCursor < 0 || data.nextCursor >= 1_000_000
          || data.ideas.some(idea => !idea || catalogue.get(idea.id)?.query !== idea.query || catalogue.get(idea.id)?.title !== idea.title
            || typeof idea.reason !== "string" || !idea.reason.trim() || idea.reason.length > 220 || /[\u0000-\u001f\u007f]/.test(idea.reason))) throw new Error("Could not read your saved templates. Try refreshing templates.");
        if (!mounted.current) return;
        cursor.current = data.nextCursor;
        recordStoredFootageSuggestions(storage, data.ideas, data.nextCursor);
        setTemplates(data.ideas);
      } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not refresh templates."); }
      finally { pending = false; if (mounted.current) setLoading(false); }
    }
    reload.current = refresh;
    void refresh();
    const timer = window.setInterval(() => void refresh(), FOOTAGE_SUGGESTION_REFRESH_MS);
    return () => { mounted.current = false; controller.abort(); window.clearInterval(timer); };
  }, []);

  async function create(template?: Template) {
    if (disabled || busy.current || request?.jobId || (!request && !template)) return;
    const selected = request || { requestId: crypto.randomUUID(), templateId: template!.id, title: template!.title, query: template!.query };
    busy.current = true; setPreparing(true); setError(""); setCanChange(false);
    onRequest(selected);
    try {
      const response = await fetch("/api/stock-reels", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automatic: true, query: selected.query, requestId: selected.requestId }), signal: AbortSignal.timeout(780_000) });
      const data = await response.json();
      if (!response.ok) {
        if (mounted.current) setCanChange([400, 409, 503].includes(response.status));
        throw new Error(typeof data?.error === "string" ? data.error : "Could not confirm your video. Retry checks the same request.");
      }
      if (typeof data?.job?.id !== "string" || !/^[a-z0-9_-]{1,180}$/i.test(data.job.id)) throw new Error("Could not confirm your video. Retry checks the same request.");
      if (mounted.current) {
        onRequest({ ...selected, jobId: data.job.id });
        onStarted(`“${selected.title}” is processing. Your finished video will open here for review.`);
      }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not confirm your video. Retry checks the same request."); }
    finally { busy.current = false; if (mounted.current) setPreparing(false); }
  }

  const failed = job && ["FAILED", "BLOCKED"].includes(job.status);
  if (request) return <section data-template-progress aria-label="Your template video" aria-busy={preparing}>
    <p className="text-xs font-semibold uppercase tracking-widest">Your video</p>
    <h2 className="mt-2 text-2xl font-semibold">{request.title}</h2>
    <p role="status" className="mt-3 text-sm">{preparing ? "Finding matching footage and preparing your video…" : !request.jobId ? "Confirm this saved request to continue preparing your video." : failed ? "Your video needs attention." : job?.status === "COMPLETED" ? "Finishing your video for review…" : job?.stage || "Waiting for processing status. Phoenix will open your video when it is ready."}</p>
    {job ? <div className="mt-3"><JobProgress status={job.status} progress={job.progress} failed={!!failed} label={`${request.title} progress`} /></div> : null}
    {error || job?.error ? <p role="alert" className="mt-3 text-sm">{error || job?.error}</p> : null}
    {!request.jobId && !preparing ? <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={disabled} onClick={() => void create()} className="rounded-full border px-4 py-2 text-sm font-semibold">Retry confirmation</button>{canChange ? <button type="button" onClick={() => { setError(""); setCanChange(false); onRequest(null); }} className="rounded-full border px-4 py-2 text-sm">Choose another template</button> : null}</div> : null}
    {failed ? <button type="button" disabled={disabled} onClick={onRetry} className="mt-4 rounded-full border px-4 py-2 text-sm font-semibold">Retry video</button> : null}
    {request.jobId ? <div className="mt-4"><button type="button" onClick={() => { setError(""); onRequest(null); }} className="rounded-full border px-4 py-2 text-sm">Back to templates</button><p className="mt-2 text-xs opacity-70">This keeps your saved job and videos. You can follow them in Jobs or Library.</p></div> : null}
    <p className="mt-4 text-xs opacity-70">Phoenix chooses the footage, pacing and music. Review the finished video before posting.</p>
  </section>;

  return <section data-quick-templates aria-label="Recommended video templates" aria-busy={loading}>
    <div data-template-heading className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-2xl font-semibold">Choose a template</h2><p className="mt-2 text-sm">Made for your page. One click prepares a complete video for review.</p></div>
      <button type="button" disabled={loading || disabled} onClick={() => void reload.current()} className="rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50">More templates</button>
    </div>
    {loading && !templates.length ? <p role="status" className="mt-5 text-sm">Finding templates from your saved videos…</p> : null}
    {error ? <p role="alert" className="mt-4 text-sm">{error}</p> : null}
    <div data-template-choices>{templates.map(template => <button key={template.id} data-quick-template type="button" disabled={disabled || preparing} onClick={() => void create(template)} aria-label={`Make video: ${template.title}`}>
      <span><span className="block text-lg font-semibold">{template.title}</span><span className="mt-2 block text-sm leading-6 opacity-70">{template.reason}</span></span>
      <span data-template-action>Make video <span aria-hidden="true">↗</span></span>
    </button>)}</div>
  </section>;
}
