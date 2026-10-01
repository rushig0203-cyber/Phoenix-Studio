"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileVideo, RefreshCw, RotateCcw, Sparkles, Trash2, Plus, ListVideo, FolderOpen, Settings, Film, ShieldCheck } from "lucide-react";
import SourceProcessor from "@/components/SourceProcessor";
import AICreation from "@/components/AICreation";
import { Button } from "@/components/ui/button";
import type { ReviewFile } from "@/lib/reviewFiles";
import { socialHandle } from "@/lib/socialAccounts";
import Link from "next/link";
import ChannelConnections from "@/components/ChannelConnections";
import ReviewLibrary from "@/components/ReviewLibrary";
import CreationDrafts from "@/components/CreationDrafts";
import StockReels from "@/components/StockReels";
import { CONTENT_IDEAS, type ContentIdea } from "@/lib/contentIdeas";
import type { ReviewEditJob } from "@/lib/reviewEditTypes";
import type { CreationDraft } from "@/lib/creationDraftTypes";
import { studioSection, type StudioSection } from "@/lib/studioNavigation";
import StudioHealth, { type StudioHealthState } from "@/components/StudioHealth";
import ReviewPlayer from "@/components/ReviewPlayer";
import { completedTransitions } from "@/lib/creationIntent";
import PostingActions from "@/components/PostingActions";
import { dashboardMonitorReport, fetchDashboardSnapshot, startDashboardPolling } from "@/lib/dashboardMonitor";


type SourceJob = {
  id: string;
  title: string;
  status: string;
  progress: number;
  stage: string;
  completedClips?: number;
  totalClips?: number;
  attempts?: number;
  error?: string;
  createdAt: string;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
};
type AiJob = {
  id: string;
  status: string;
  progress: number;
  stage?: string;
  error?: string;
  retryCount: number;
  manualRetryCount?: number;
  createdAt: string;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
  project: { title: string };
};
type DisplayJob = {
  id: string;
  reviewId?: string;
  outputId?: string;
  kind: "source" | "ai" | "edit";
  title: string;
  status: string;
  progress: number;
  detail: string;
  error?: string;
  createdAt: string;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
};

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function timing(job: DisplayJob) {
  if (job.status === "QUEUED") return "Waiting for the local worker";
  if (!job.elapsedSeconds) return "";
  const elapsed = `${formatTime(job.elapsedSeconds)} elapsed`;
  if (["RUNNING", "PROCESSING"].includes(job.status) && job.estimatedRemainingSeconds) {
    return `${elapsed} · about ${formatTime(job.estimatedRemainingSeconds)} remaining`;
  }
  return elapsed;
}

export default function DashboardClient() {
  const [section, setSection] = useState<StudioSection>("create");
  const [drafts, setDrafts] = useState<CreationDraft[]>([]);
  const navigate = useCallback((value: StudioSection) => { setSection(value); window.location.hash = value; }, []);
  useEffect(() => {
    const sync = () => { setSection(studioSection(window.location.hash)); window.scrollTo(0, 0); };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState("forest waterfall");
  const [idea, setIdea] = useState<ContentIdea | null>(null);
  useEffect(() => {
    const value = CONTENT_IDEAS.find(item => item.id === new URLSearchParams(window.location.search).get("ideaId"));
    if (value?.workflow === "stock-reel") { setStockQuery(value.query); setStockOpen(true); setSection("create"); }
    else if (value) { setIdea(value); setAiOpen(true); setSection("create"); }
  }, []);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [preview, setPreview] = useState<ReviewFile | null>(null);
  const previousJobs = useRef(new Map<string, string>());
  const [sourceJobs, setSourceJobs] = useState<SourceJob[]>([]);
  const [aiJobs, setAiJobs] = useState<AiJob[]>([]);
  const [editJobs, setEditJobs] = useState<ReviewEditJob[]>([]);
  const [removingJob, setRemovingJob] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(false);
  const monitorRequest = useRef<AbortController | null>(null);
  const [health, setHealth] = useState<StudioHealthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobFilter, setJobFilter] = useState("all");
  const [retrying, setRetrying] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const monitorMounted = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (silent && document.hidden) return;
    if (!silent) setLoading(true);
    if (refreshInFlight.current) {
      try {
        await refreshInFlight.current;
      } finally {
        if (!silent && monitorMounted.current) setLoading(false);
      }
      return;
    }

    const controller = new AbortController(); monitorRequest.current = controller;
    const request = (async () => {
    try {
      // A failed edit-queue poll must not blank the independent video library.
      const results = await fetchDashboardSnapshot(controller.signal);
      if (!monitorMounted.current || controller.signal.aborted) return;
      const [review, source, ai, edits, preparation, studio] = results;
      if (review.status === "fulfilled") setFiles(Array.isArray(review.value) ? review.value.filter((file: ReviewFile) => file.status === "READY") : []);
      if (source.status === "fulfilled") setSourceJobs(source.value.jobs || []);
      if (ai.status === "fulfilled") setAiJobs(Array.isArray(ai.value) ? ai.value : []);
      if (edits.status === "fulfilled") setEditJobs(Array.isArray(edits.value) ? edits.value : []);
      if (preparation.status === "fulfilled") setDrafts(Array.isArray(preparation.value) ? preparation.value : []);
      setHealth(studio.status === "fulfilled" ? studio.value : null);
      const report = dashboardMonitorReport(results);
      offlineRef.current = report.offline; setOffline(report.offline); setMonitorError(report.message);
    } catch (error) {
      if (monitorMounted.current && !controller.signal.aborted) {
        setMonitorError(error instanceof Error ? error.message : "Could not refresh Workflow Manager.");
      }
    }
    })();
    refreshInFlight.current = request;
    try {
      await request;
    } finally {
      if (monitorRequest.current === controller) monitorRequest.current = null;
      if (refreshInFlight.current === request) refreshInFlight.current = null;
      if (!silent && monitorMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    monitorMounted.current = true;
    let firstPoll = true;
    const polling = startDashboardPolling({ refresh: () => { const silent = !firstPoll; firstPoll = false; return load(silent); }, offline: () => offlineRef.current, visible: () => !document.hidden });
    const resume = () => { if (!document.hidden) void polling.retry(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      polling.stop();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      monitorMounted.current = false;
      monitorRequest.current?.abort();
    };
  }, [load]);

  async function retry(job: DisplayJob, regenerate = false) {
    if (offlineRef.current) { setNotice("Reconnect Phoenix before retrying a job."); return; }
    if (retrying) return;
    setRetrying(`${job.kind}-${job.id}`);
    try {
      const response = job.kind === "source"
        ? await fetch("/api/source-processing/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: job.id }),
          })
        : await fetch("/api/generations", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: job.id, regenerate }),
          });
      const data = await response.json().catch(() => null);
      setNotice(response.ok
        ? data?.message || (regenerate ? "New copy queued. Your original video is retained." : "Failed job queued again.")
        : data?.error || "Could not queue the job.");
      await load();
    } catch {
      setNotice("Could not reach the local retry queue.");
    } finally {
      setRetrying(null);
    }
  }

  async function removeJob(job: DisplayJob) {
    if (offlineRef.current) { setNotice("Reconnect Phoenix before changing job history."); return; }
    if (removingJob) return;
    setRemovingJob(`${job.kind}-${job.id}`);
    try {
      const endpoint = job.kind === "ai" ? "/api/generations" : job.kind === "source" ? "/api/source-processing" : "/api/review-edits";
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(job.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove job.");
      setNotice(job.status === "QUEUED" ? "Queued job cancelled and removed." : "Job removed from history. Finished review files are still available.");
      await load();
    } catch(error) { setNotice(error instanceof Error ? error.message : "Could not reach the queue."); }
    finally { setRemovingJob(null); }
  }
  const jobs = useMemo<DisplayJob[]>(() => [
    ...editJobs.map(job => ({ id:job.id,reviewId:job.reviewId,outputId:job.outputId,kind:"edit" as const,title:job.title,status:job.status,progress:job.progress,detail:`Manual edit · ${job.stage}`,error:job.error,createdAt:job.createdAt,elapsedSeconds:job.elapsedSeconds,estimatedRemainingSeconds:job.estimatedRemainingSeconds ?? undefined })),
    ...sourceJobs.map((job) => ({
      id: job.id,
      kind: "source" as const,
      title: job.title,
      status: job.status,
      progress: job.progress,
      detail: `Source video · ${job.stage}${job.totalClips ? ` · ${job.completedClips || 0}/${job.totalClips} clips` : ""}${job.attempts ? ` · attempt ${job.attempts}` : ""}`,
      error: job.error,
      createdAt: job.createdAt,
      elapsedSeconds: job.elapsedSeconds,
      estimatedRemainingSeconds: job.estimatedRemainingSeconds,
    })),
    ...aiJobs.map((job) => ({
      id: job.id,
      kind: "ai" as const,
      title: job.project.title,
      status: job.status,
      progress: job.progress,
      detail: `AI Creation · ${job.stage?.trim() || (job.status === "COMPLETED" ? "Completed · legacy stage details unavailable" : job.status === "FAILED" ? "Failed" : "Queued")}${job.retryCount ? ` · automatic retry ${job.retryCount}/3` : ""}${job.manualRetryCount ? ` · manual retry ${job.manualRetryCount}` : ""}`,
      error: job.error,
      createdAt: job.createdAt,
      elapsedSeconds: job.elapsedSeconds,
      estimatedRemainingSeconds: job.estimatedRemainingSeconds,
    })),
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()), [sourceJobs, aiJobs, editJobs]);

  useEffect(() => {
    const finished = completedTransitions(previousJobs.current, jobs);
    previousJobs.current = new Map(jobs.map(job => [`${job.kind}:${job.id}`, job.status]));
    if (!finished.length) return; // Opening the app must not redirect for old videos.
    setNotice(`${finished.length === 1 ? finished[0].title : `${finished.length} videos`} finished. Choose Watch video below to review the result.`);
    setJobFilter("completed");
    navigate("jobs");
  }, [jobs, navigate]);

  const activeCount = jobs.filter(job => ["QUEUED", "RUNNING", "PROCESSING"].includes(job.status)).length + drafts.filter(draft => ["QUEUED", "PLANNING", "APPROVING", "READY"].includes(draft.status)).length;
  const failedCount = jobs.filter(job => ["FAILED", "BLOCKED"].includes(job.status)).length + drafts.filter(draft => draft.status === "FAILED").length;
  const sections = [
    { id: "create" as const, label: "Create", icon: Plus },
    { id: "jobs" as const, label: "Jobs", icon: ListVideo },
    { id: "library" as const, label: "Library", icon: FolderOpen },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];
  const pageCopy = { create: ["What will you make today?", "Choose one way to create. Phoenix handles preparation and rendering."], ideas: ["Find your next idea", "Browse inspiration, pick a topic, then make it your own."], jobs: ["Your production queue", "Follow progress here. You only approve the finished video."], library: ["Your video library", "Watch the final result, make edits if you want, then download and post."], settings: ["Your studio settings", "Manage channel connections and local studio preferences."] };
  return (
    <div className="min-h-screen bg-[#f4f0e7] text-[#1e2719]">
      <aside className="border-b border-[#dadfce] bg-[#fffdf7] p-4 md:fixed md:inset-y-0 md:left-0 md:w-56 md:border-b-0 md:border-r md:p-6">
        <a href="#create" className="flex items-center gap-3 text-lg font-semibold tracking-tight"><span className="rounded-xl bg-[#32432a] p-2 text-white"><Film className="h-5 w-5" /></span>Phoenix Studio</a>
        <p className="mt-2 hidden text-xs text-[#738063] md:block">Your local creative space</p>
        <nav aria-label="Studio sections" className="mt-5 flex gap-1 overflow-x-auto md:mt-10 md:flex-col md:gap-2">{sections.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={section === id ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${section === id ? "bg-[#34462b] text-white" : "text-[#637155] hover:bg-[#edf1e5]"}`}><Icon className="h-4 w-4" />{label}{id === "jobs" && activeCount + failedCount > 0 ? <span className="ml-auto rounded-full bg-[#e4eace] px-2 text-xs text-[#33422b]" aria-label={`${activeCount} active, ${failedCount} failed`}>{activeCount || failedCount}</span> : null}{id === "library" ? <span className="ml-auto hidden text-xs opacity-70 md:block">{files.length}</span> : null}</a>)}</nav>
        <div className="absolute bottom-6 left-6 right-6 hidden rounded-xl bg-[#edf1e5] p-3 text-xs leading-5 text-[#5b6c4b] md:block"><ShieldCheck className="mb-2 h-4 w-4" />Free local mode<br />Files stay on this laptop.</div>
      </aside>
      <main className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8 md:ml-56 lg:px-12">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-[#dce1d2] pb-6">
          <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-[#7a856a]">Studio / {sections.find(item => item.id === section)?.label}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">{pageCopy[section][0]}</h1><p className="mt-2 text-sm leading-6 text-[#687657]">{pageCopy[section][1]}</p></div>
          <a href="#jobs" className="flex items-center gap-2 rounded-full border border-[#d4dcc6] bg-[#fffdf7] px-4 py-2 text-xs font-medium"><span className={`h-2 w-2 rounded-full ${activeCount ? "animate-pulse bg-[#708a43]" : "bg-[#a8b395]"}`} />{activeCount ? `${activeCount} in progress` : failedCount ? `${failedCount} need attention` : "Queue is clear"}</a>
        </header>
        {monitorError ? <div role="alert" className="mb-4 rounded-xl bg-[#ffe1d3] p-3 text-sm text-[#914527]">
          <p className="font-semibold">{offline ? "Phoenix is disconnected" : "Studio data needs a refresh"}</p>
          <p className="mt-1">{offline ? "The local server is not responding. Open the Phoenix Studio shortcut on your Desktop, then retry the connection. Displayed lists are last received snapshots; previews, downloads and jobs need the server. Phoenix checks again every 15 seconds." : monitorError}</p>
          <Button type="button" variant="outline" className="mt-2" disabled={loading} onClick={() => void load()}>{loading ? "Checking connection…" : "Retry connection"}</Button>
        </div> : null}
        {!offline ? <StudioHealth health={health} detailed={section === "settings"} /> : null}
        <fieldset disabled={offline} hidden={section !== "create"} data-studio-screen="create" className="min-w-0 border-0 p-0">
        <section aria-label="Creation workflows" className="grid gap-4 xl:grid-cols-3">
          <article className="rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5">
            <FileVideo className="h-7 w-7 text-[#536b35]" />
            <h2 className="mt-4 text-2xl font-semibold">Process an episode</h2>
            <p className="mt-2 text-sm leading-6 text-[#687657]">Choose a local video, select full coverage or best highlights, then create real clips.</p>
            <Button type="button" onClick={() => { setSourceOpen(open => !open); setAiOpen(false); setStockOpen(false); }} className="mt-5 bg-[#394a2a] text-white">
              {sourceOpen ? "Close processor" : "Choose a video"}
            </Button>
          </article>
          <article className="rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5">
            <Sparkles className="h-7 w-7 text-[#536b35]" />
            <h2 className="mt-4 text-2xl font-semibold">Create a new video</h2>
            <p className="mt-2 text-sm leading-6 text-[#687657]">Business and general videos from stock footage, or simple 2D children’s animation.</p>
            <Button type="button" onClick={() => { setAiOpen(open => !open); setSourceOpen(false); setStockOpen(false); }} className="mt-5 bg-[#394a2a] text-white">
              {aiOpen ? "Close creation" : "Create a video"}
            </Button>
          </article>
          <article className="rounded-2xl border border-[#bfcaa6] bg-[#eef3df] p-5"><Film className="h-7 w-7 text-[#536b35]" /><h2 className="mt-4 text-2xl font-semibold">Use stock footage</h2><p className="mt-2 text-sm leading-6 text-[#657153]">Find a video on Pexels or Pixabay and turn it into a captioned reel. No generated visuals.</p><Button className="mt-5 bg-[#394a2a] text-white" onClick={() => { setStockOpen(value => !value); setSourceOpen(false); setAiOpen(false); }}>{stockOpen ? "Close stock search" : "Find footage"}</Button></article>
        </section>
        {sourceOpen ? <SourceProcessor onClose={() => setSourceOpen(false)} onStarted={() => { navigate("jobs"); void load(); }} /> : null}
        {stockOpen ? <StockReels initialQuery={stockQuery} onClose={() => setStockOpen(false)} onStarted={message => { setNotice(message); navigate("jobs"); void load(); }} /> : null}
        {aiOpen ? <AICreation key={idea?.id || "custom"} initialKind={idea?.workflow === "business" ? "Business video" : idea?.workflow === "children-story" ? "Children's short story" : "General video"} initialTopic={idea?.title} onClose={() => setAiOpen(false)} onStarted={(message) => { setNotice(message || "Video queued. Preparation and rendering run automatically."); navigate("jobs"); void load(); }} /> : null}
        {!sourceOpen && !aiOpen && !stockOpen ? <p className="mt-6 text-sm text-[#657153]">Choose Create a video to see fresh recommendations for your selected video type.</p> : null}
        </fieldset>
        {section === "library" ? <ReviewLibrary files={files} loading={loading} onRefresh={load} /> : null}
        {section === "jobs" ? <>
        <fieldset disabled={offline} className="min-w-0 border-0 p-0" aria-label="Video preparation controls"><CreationDrafts drafts={drafts} onRefresh={load} /></fieldset>

        <section className="mt-5 rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Rendering & history</h2>
            </div>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
          <p className="mt-2 text-sm text-[#687657]">{offline ? "Connection unavailable; displaying the last received job status." : "Updates every three seconds while this window is visible."} Completed and failed jobs remain in chronological order; new work appears below older work.</p>
          {notice ? <p role="status" className="mt-3 rounded-xl bg-[#eef3df] p-3 text-sm text-[#4f5c31]">{notice}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            {[["all", "All"], ["active", "Active"], ["failed", "Failed"], ["completed", "Completed"]].map(([value, label]) => <button type="button" key={value} aria-pressed={jobFilter === value} onClick={() => setJobFilter(value)} className={`rounded-lg border px-3 py-2 ${jobFilter === value ? "bg-[#394a2a] text-white" : "bg-white"}`}>{label} · {jobs.filter(job => value === "all" || (value === "active" ? ["QUEUED", "RUNNING", "PROCESSING"].includes(job.status) : value === "failed" ? ["FAILED", "BLOCKED"].includes(job.status) : job.status === "COMPLETED")).length}</button>)}
          </div>
          {jobs.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-[#bfcaa6] p-5 text-center text-sm text-[#778269]">{loading ? "Loading job history…" : "No jobs yet. Choose a workflow above."}</p>
          ) : (
            <div className="mt-5 max-h-[560px] space-y-3 overflow-y-auto">
              {jobs.filter(job => jobFilter === "all" || (jobFilter === "active" ? ["QUEUED", "RUNNING", "PROCESSING"].includes(job.status) : jobFilter === "failed" ? ["FAILED", "BLOCKED"].includes(job.status) : job.status === "COMPLETED")).map((job) => {
                const failed = job.status === "FAILED" || job.status === "BLOCKED";
                const retryKey = `${job.kind}-${job.id}`;
                return (
                  <article key={retryKey} className="rounded-xl border border-[#d5ddb8] bg-[#f7f9ef] p-4 [content-visibility:auto]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">{job.title}</h3>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${failed ? "bg-[#ffe1d3] text-[#914527]" : "bg-[#e5ebcf] text-[#4f5c31]"}`}>{job.status} · {job.progress}%</span>
                    </div>
                    <p className="mt-1 text-xs text-[#687657]">{job.detail}</p>
                    {timing(job) ? <p className="mt-1 text-xs font-medium text-[#53633e]">{timing(job)}</p> : null}
                    <div className="mt-3 h-2 overflow-hidden rounded bg-[#d5ddb8]">
                      <div className={`h-full transition-[width] duration-500 ${failed ? "bg-[#b55d3d]" : "bg-[#667b42]"}`} style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
                    </div>
                    {job.error ? <p className="mt-2 text-sm break-words text-[#a75528]">{job.error}</p> : null}
                    {job.status === "COMPLETED" ? <div className="mt-3 space-y-3">{files.filter(file => job.kind === "edit" ? file.id === job.outputId : file.id === job.id || file.processing?.jobId === job.id).map((file, index) => <div key={file.id}><Button type="button" variant="outline" size="sm" onClick={() => setPreview(file)}>Watch video{job.kind === "source" ? ` ${index + 1}` : ""}</Button><PostingActions file={file} /></div>)}</div> : null}
                    {failed && job.kind !== "edit" ? (
                      <Button type="button" variant="outline" size="sm" disabled={offline || retrying !== null} onClick={() => void retry(job)} className="mt-3">
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />{retrying === retryKey ? "Queueing…" : "Retry"}
                      </Button>
                    ) : null}
                    {job.kind === "edit" && failed ? <Link href={job.reviewId ? `/dashboard/edit/${job.reviewId}` : "/dashboard#library"} className="mt-3 inline-block text-xs">Open the original video’s editor to export again.</Link> : null}
                    {job.kind === "ai" && job.status === "COMPLETED" ? (
                      <Button type="button" variant="outline" size="sm" disabled={offline || retrying !== null} onClick={() => void retry(job, true)} className="mt-3">
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />{retrying === retryKey ? "Queueing…" : "Regenerate"}
                      </Button>
                    ) : null}
                    {!["RUNNING", "PROCESSING"].includes(job.status) ? (
                      <Button type="button" variant="outline" size="sm" disabled={offline || removingJob !== null} onClick={() => void removeJob(job)} className="ml-2 mt-3" aria-label={`${job.status === "QUEUED" ? "Cancel queued job" : "Remove job from history"}: ${job.title}`}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />{removingJob === retryKey ? "Removing…" : job.status === "QUEUED" ? "Cancel queued job" : "Remove from history"}
                      </Button>
                    ) : <p className="mt-2 text-xs text-[#687657]">History removal is available when this active render finishes.</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        </> : null}
        {section === "settings" ? <div className="space-y-6"><div className="rounded-2xl border border-[#d3dbc5] bg-[#fffdf7] p-5"><h2 className="text-lg font-semibold">Studio preferences</h2><p className="mt-2 text-sm text-[#687657]">Instagram destination: {socialHandle("instagram")} · Free local processing</p><div className="mt-4 flex flex-wrap gap-3"><Link href="/dashboard/manager" className="rounded-lg border px-4 py-2 text-sm font-semibold">Content quality manager</Link><Link href="/dashboard/settings" className="rounded-lg border px-4 py-2 text-sm font-semibold">Publishing settings</Link></div></div><ChannelConnections /></div> : null}
      </main>
      {preview ? <ReviewPlayer file={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
