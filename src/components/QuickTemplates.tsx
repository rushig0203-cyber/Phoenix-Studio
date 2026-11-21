"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ContentIdea, SuggestionReason } from "@/lib/contentIdeas";
import { FOOTAGE_SUGGESTION_REFRESH_MS, installFootageSuggestionRefresh, nextStoredFootageSuggestions, recordStoredFootageSuggestions, stockTopicPool } from "@/lib/stockFootageSuggestions";
import { isQuickTemplateSource, type QuickTemplateOpening, type QuickTemplateRequest } from "@/lib/quickTemplates";
import JobProgress from "./JobProgress";
import StudioActivity from "./StudioActivity";

type Template = ContentIdea & SuggestionReason & { opening?: QuickTemplateOpening };
type TemplateJob = { status: string; progress: number; stage?: string; error?: string };
const catalogue = new Map(stockTopicPool().map(idea => [idea.id, idea]));
const batchKey = "phoenix-quick-template-batch-v1";

function validBatch(ideas: Template[]) {
  return Array.isArray(ideas) && ideas.length >= 5 && ideas.length <= 6 && new Set(ideas.map(idea => idea?.id)).size === ideas.length
    && ideas.every(idea => idea && catalogue.get(idea.id)?.query === idea.query && catalogue.get(idea.id)?.title === idea.title
      && typeof idea.reason === "string" && !!idea.reason.trim() && idea.reason.length <= 220 && !/[\u0000-\u001f\u007f]/.test(idea.reason)
      && (idea.opening === undefined || (isQuickTemplateSource(idea.opening) && typeof idea.opening.image === "string"
        && idea.opening.image.startsWith("https://") && idea.opening.image.length <= 2048)));
}

export default function QuickTemplates({ request, job, onRequest, onStarted, onRetry, disabled = false, customTopicAction }: {
  request: QuickTemplateRequest | null;
  job?: TemplateJob;
  onRequest: (value: QuickTemplateRequest | null) => void;
  onStarted: (message: string) => void;
  onRetry: () => void;
  disabled?: boolean;
  customTopicAction?: ReactNode;
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
      if (pending || busy.current || controller.signal.aborted) return false;
      pending = true; setLoading(true); setError("");
      const saved = nextStoredFootageSuggestions(storage, cursor.current);
      try {
        const query = new URLSearchParams({ workflow: "footage", cursor: String(saved.cursor), seen: saved.seen.join(","), opening: "1" });
        const response = await fetch(`/api/content-suggestions?${query}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
        if (!response.ok) throw new Error("Could not read your saved video preferences. Try refreshing templates.");
        const data = await response.json() as { ideas: Template[]; nextCursor: number };
        if (!validBatch(data.ideas) || !Number.isSafeInteger(data.nextCursor) || data.nextCursor < 0 || data.nextCursor >= 1_000_000) {
          throw new Error("Could not read your saved templates. Try refreshing templates.");
        }
        if (!mounted.current || controller.signal.aborted) return false;
        if (!data.ideas.some(idea => idea.opening)) throw new Error("No eligible opening shots were found. Try More templates or enter a topic.");
        cursor.current = data.nextCursor;
        recordStoredFootageSuggestions(storage, data.ideas, data.nextCursor);
        setTemplates(data.ideas);
        storage.setItem(batchKey, JSON.stringify({ savedAt: Date.now(), ideas: data.ideas }));
        return true;
      } catch (failure) {
        if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not refresh templates.");
        return false;
      } finally { pending = false; if (mounted.current && !controller.signal.aborted) setLoading(false); }
    }
    reload.current = async () => { await refresh(); };
    let initialDue = Date.now();
    try {
      const raw = storage.getItem(batchKey);
      const batch = raw && raw.length <= 24_000 ? JSON.parse(raw) : null;
      if (batch && validBatch(batch.ideas) && Number.isSafeInteger(batch.savedAt) && batch.savedAt <= Date.now()) {
        setTemplates(batch.ideas);
        setLoading(false);
        initialDue = batch.savedAt + FOOTAGE_SUGGESTION_REFRESH_MS;
      }
    } catch { /* Preferences and saved jobs are separate from this preview cache. */ }
    const stopRefresh = installFootageSuggestionRefresh({
      key: "quick-templates", initialDue, refresh, storage, now: Date.now,
      setTimeout: (listener, delay) => window.setTimeout(listener, delay),
      clearTimeout: timer => { if (typeof timer === "number") window.clearTimeout(timer); },
      subscribeResume(listener) {
        const onVisible = () => { if (document.visibilityState !== "hidden") listener(); };
        window.addEventListener("focus", listener);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
          window.removeEventListener("focus", listener);
          document.removeEventListener("visibilitychange", onVisible);
        };
      },
    });
    return () => { mounted.current = false; controller.abort(); stopRefresh(); };
  }, []);

  async function create(template?: Template) {
    if (disabled || busy.current || request?.jobId || (!request && !template?.opening)) return;
    const selected = request ?? {
      requestId: crypto.randomUUID(), templateId: template!.id, title: template!.title, query: template!.query,
      source: { provider: template!.opening!.provider, id: template!.opening!.id },
    };
    busy.current = true; setPreparing(true); setError(""); setCanChange(false);
    onRequest(selected);
    try {
      const response = await fetch("/api/stock-reels", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automatic: true, query: selected.query, requestId: selected.requestId, ...selected.source }), signal: AbortSignal.timeout(780_000) });
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
    {preparing ? <StudioActivity label="Preparing your video…" /> : !job && request.jobId ? <StudioActivity label="Checking your video…" /> : <p role="status" className="mt-3 text-sm">{!request.jobId ? "Confirm your saved request to continue." : failed ? "Your video needs attention." : job?.status === "COMPLETED" ? "Opening your video…" : job?.stage || "Waiting for processing status."}</p>}
    {job ? <div className="mt-3"><JobProgress status={job.status} progress={job.progress} failed={!!failed} label={`${request.title} progress`} /></div> : null}
    {error || job?.error ? <p role="alert" className="mt-3 text-sm">{error || job?.error}</p> : null}
    {!request.jobId && !preparing ? <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={disabled} onClick={() => void create()} className="rounded-full border px-4 py-2 text-sm font-semibold">Retry confirmation</button>{canChange ? <button type="button" onClick={() => { setError(""); setCanChange(false); onRequest(null); }} className="rounded-full border px-4 py-2 text-sm">Choose another template</button> : null}</div> : null}
    {failed ? <button type="button" disabled={disabled} onClick={onRetry} className="mt-4 rounded-full border px-4 py-2 text-sm font-semibold">Retry video</button> : null}
    {request.jobId ? <div className="mt-4"><button type="button" title="Your saved job continues in Jobs." onClick={() => { setError(""); onRequest(null); }} className="rounded-full border px-4 py-2 text-sm">Back to templates</button></div> : null}
    {customTopicAction}
  </section>;

  return <section data-quick-templates aria-label="Recommended video templates" aria-busy={loading}>
    <div data-template-heading className="flex flex-wrap items-start justify-between gap-4">
      <h2>Suggested reels</h2>
      <div data-template-tools>{customTopicAction}<button type="button" disabled={loading || disabled} onClick={() => void reload.current()} className="rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50">More templates</button></div>
    </div>
    {loading && !templates.length ? <StudioActivity label="Finding your next video…" /> : null}
    {error ? <p role="alert" className="mt-4 text-sm">{error}</p> : null}
    <div data-template-choices>{templates.map(template => <button key={template.id} data-quick-template type="button"
      disabled={disabled || preparing || !template.opening} onClick={() => void create(template)}
      aria-label={template.opening ? `Make video: ${template.title}` : `${template.title}: opening shot unavailable`}>
      <span data-template-image aria-hidden="true">
        {template.opening ? <img alt="" src={template.opening.image} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} /> : null}
      </span>
      <span data-template-copy><span data-template-title>{template.title}</span><span data-template-reason>{template.opening ? template.reason : "Opening shot unavailable"}</span></span>
      <span data-template-action aria-hidden="true">↗</span>
    </button>)}</div>
  </section>;
}
