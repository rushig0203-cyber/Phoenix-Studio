"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileVideo, RefreshCw, RotateCcw, Sparkles, Trash2, Plus, ListVideo, FolderOpen, Settings, Film, Info } from "lucide-react";
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
import { refreshInstalledRelease } from "@/lib/releaseRefresh";
import { JOB_PAGE_SIZE, jobQueuePage, type JobFilter } from "@/lib/dashboardJobs";


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
  const [stockQuery, setStockQuery] = useState("");
  const [idea, setIdea] = useState<ContentIdea | null>(null);
  useEffect(() => {
    const value = CONTENT_IDEAS.find(item => item.id === new URLSearchParams(window.location.search).get("ideaId"));
    if (value?.workflow === "stock-reel") { setStockQuery(value.query); setStockOpen(true); setSection("create"); }
    else if (value) { setIdea(value); setAiOpen(true); setSection("create"); }
  }, []);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [preview, setPreview] = useState<ReviewFile | null>(null);
  const previewFile = preview ? files.find(file => file.id === preview.id) ?? preview : null;
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
  const [jobFilter, setJobFilter] = useState<JobFilter | null>(null);
  const [jobPage, setJobPage] = useState(1);
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

  useEffect(() => {
    // Settings/library can contain unsaved nested editors. Do not replace them
    // or a playing preview; a fresh tab always gets the installed server build.
    const defer = !["create", "jobs"].includes(section) || sourceOpen || aiOpen || stockOpen || !!preview || document.hidden;
    if (!health?.build || defer) return;
    try {
      refreshInstalledRelease({ loaded: process.env.NEXT_PUBLIC_PHOENIX_RELEASE, serving: health.build, defer,
        storage: window.sessionStorage, reload: () => window.location.reload() });
    } catch { /* A disabled session store must never trigger a reload loop. */ }
  }, [health?.build, section, sourceOpen, aiOpen, stockOpen, preview]);

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
      if (response.ok) { setJobFilter("active"); setJobPage(1); }
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
    // Keep the owner in Create with the finished result directly below its
    // controls. A playing preview or Library activity must not be interrupted.
    if (section === "library" || preview) return;
    setJobFilter("completed");
    setJobPage(1);
    if (section !== "create") navigate("jobs");
  }, [jobs, navigate, section, preview]);

  function started(message: string, workflow: "source" | "stock" | "creation") {
    setNotice(message); setJobFilter("active"); setJobPage(1);
    if (workflow === "source") setSourceOpen(false);
    else if (workflow === "stock") setStockOpen(false);
    else setAiOpen(false);
    // Successful acceptance is enough to close this form; the saved queue is
    // read below. Failed submissions stay in their own form for correction.
    void load();
  }

  const queue = useMemo(() => jobQueuePage([
    ...jobs.map(job => ({ ...job, phase: "render" as const, job })),
    ...drafts.map(draft => ({ id: draft.id, status: draft.status, createdAt: draft.createdAt, phase: "preparation" as const, draft })),
  ], jobFilter, jobPage), [jobs, drafts, jobFilter, jobPage]);
  const displayedDrafts = queue.displayed.flatMap(entry => "draft" in entry ? [entry.draft] : []);
  const displayedJobs = queue.displayed.flatMap(entry => "job" in entry ? [entry.job] : []);
  const activeCount = queue.counts.active;
  const failedCount = queue.counts.failed;
  const sections = [
    { id: "create" as const, label: "Create", icon: Plus },
    { id: "jobs" as const, label: "Jobs", icon: ListVideo },
    { id: "library" as const, label: "Library", icon: FolderOpen },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];
  const pageCopy = { create: ["What will you make today?", ""], ideas: ["Find your next idea", "Browse inspiration, pick a topic, then make it your own."], jobs: ["Your production queue", "Follow progress here. You only approve the finished video."], library: ["Your video library", ""], settings: ["Your studio settings", "Manage channel connections and local studio preferences."] };
  return (
    <div className="min-h-screen bg-[#f4f0e7] text-[#1e2719]">
      <aside className="border-b border-[#dadfce] bg-[#fffdf7] p-4 md:fixed md:inset-y-0 md:left-0 md:w-56 md:border-b-0 md:border-r md:p-6">
        <a href="#create" className="flex items-center gap-3 text-lg font-semibold tracking-tight"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#bfcaa6] text-base font-semibold">P</span>Phoenix Studio</a>
        <nav aria-label="Studio sections" className="mt-5 flex gap-1 overflow-x-auto md:mt-10 md:flex-col md:gap-2">{sections.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={section === id ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${section === id ? "bg-[#34462b] text-white" : "text-[#637155] hover:bg-[#edf1e5]"}`}><Icon className="h-4 w-4" />{label}{id === "jobs" && activeCount + failedCount > 0 ? <span className="ml-auto rounded-full bg-[#e4eace] px-2 text-xs text-[#33422b]" aria-label={`${activeCount} active, ${failedCount} failed`}>{activeCount || failedCount}</span> : null}{id === "library" ? <span className="ml-auto hidden text-xs opacity-70 md:block">{files.length}</span> : null}</a>)}</nav>
      </aside>
      <main className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8 md:ml-56 lg:px-12">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-[#dce1d2] pb-6">
          <div><h1 className="text-3xl font-semibold tracking-tight">{pageCopy[section][0]}</h1>{pageCopy[section][1] ? <p className="mt-2 text-sm leading-6 text-[#687657]">{pageCopy[section][1]}</p> : null}</div>
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
          <article className="rounded-2xl border border-[#bfcaa6] bg-[#eef3df] p-5"><Film className="h-7 w-7 text-[#536b35]" /><h2 className="mt-4 text-2xl font-semibold">Make a footage reel</h2><p className="mt-2 text-sm leading-6 text-[#657153]">Type a topic, choose a starting video, and Phoenix edits related stock clips into a 40–45 second reel at their original speed. No generated visuals.</p><Button className="mt-5 bg-[#394a2a] text-white" onClick={() => { setStockOpen(value => !value); setSourceOpen(false); setAiOpen(false); }}>{stockOpen ? "Close footage" : "Find footage"}</Button></article>
        </section>
        {sourceOpen ? <SourceProcessor onClose={() => setSourceOpen(false)} onStarted={() => started("Source video queued. Follow preparation and rendering below.", "source")} /> : null}
        {stockOpen ? <StockReels initialQuery={stockQuery} onClose={() => setStockOpen(false)} onStarted={message => started(message, "stock")} /> : null}
        {aiOpen ? <AICreation key={idea?.id || "custom"} initialKind={idea?.workflow === "business" ? "Business video" : idea?.workflow === "children-story" ? "Children's short story" : "General video"} initialTopic={idea?.title} onClose={() => setAiOpen(false)} onStarted={message => started(message || "Video queued. Preparation and rendering run automatically.", "creation")} /> : null}
        {!sourceOpen && !aiOpen && !stockOpen ? <p className="mt-6 text-sm text-[#657153]">Choose Create a video to see fresh recommendations for your selected video type.</p> : null}
        </fieldset>
        {section === "library" ? <ReviewLibrary files={files} loading={loading} onRefresh={load} /> : null}
        {section === "create" || section === "jobs" ? <>
        <section aria-label="Jobs and progress" data-studio-screen="jobs" className="mt-5 rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex items-center gap-2">
              <h2 className="text-xl font-semibold">{section === "create" ? "Jobs & progress" : "Jobs & history"}</h2>
              <details className="text-[#687657]">
                <summary aria-label="About job progress and filters" title="About job progress and filters" className="flex cursor-pointer list-none rounded-full p-1 hover:bg-[#edf1e5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#394a2a] [&::-webkit-details-marker]:hidden"><Info aria-hidden="true" className="h-4 w-4" /></summary>
                <div className="absolute left-0 top-8 z-10 w-64 max-w-[calc(100vw-3rem)] space-y-2 rounded-xl border border-[#bdc7a5] bg-[#fffdf7] p-3 text-xs leading-5 shadow-lg">
                  <p>{offline ? "Connection unavailable; displaying the last received job status." : "Updates every three seconds while this window is visible."}</p>
                  <p>Active includes preparation and rendering. Needs attention shows saved failures; Completed shows finished jobs. Preparation and rendering are grouped separately, newest history first within each group.</p>
                  <p>Paging keeps every saved job and video available.</p>
                </div>
              </details>
            </div>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
          {notice ? <p role="status" className="mt-3 rounded-xl bg-[#eef3df] p-3 text-sm text-[#4f5c31]">{notice}</p> : null}
          <label className="mt-4 inline-flex items-center gap-2 text-xs font-semibold"><span>Show</span><select aria-label="Job status filter" value={queue.filter} onChange={event => { setJobFilter(event.target.value as JobFilter); setJobPage(1); }} className="rounded-lg border border-[#bdc7a5] bg-white px-3 py-2">
            {([["active", "Active"], ["failed", "Needs attention"], ["completed", "Completed"], ["all", "All jobs"]] as const).map(([value, label]) => <option key={value} value={value}>{label} · {queue.counts[value]}</option>)}
          </select></label>
          {queue.total > 0 ? <p className="mt-3 text-xs text-[#687657]">Showing {(queue.page - 1) * JOB_PAGE_SIZE + 1}–{Math.min(queue.page * JOB_PAGE_SIZE, queue.total)} of {queue.total} {queue.filter === "active" ? "active jobs" : "saved jobs"}.</p> : null}
          <fieldset disabled={offline} className="min-w-0 border-0 p-0" aria-label="Video preparation controls"><CreationDrafts drafts={displayedDrafts} onRefresh={load} failedOnly={queue.filter === "failed"} onRequeued={draft => { setJobFilter("active"); setJobPage(1); setNotice(`“${draft.input.topic}” queued again. Follow its progress in Active.`); }} /></fieldset>
          {queue.total === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-[#bfcaa6] p-5 text-center text-sm text-[#778269]">{loading ? "Loading jobs…" : queue.filter === "active" ? "Nothing is processing or waiting right now. Finished videos are in Completed and Library." : queue.filter === "failed" ? "No jobs need attention." : queue.filter === "completed" ? "No finished jobs yet. Use Create to start a video." : "No saved jobs yet. Use Create to start a video."}</p>
          ) : (
            <div className="mt-5 space-y-3">
              {displayedJobs.map((job) => {
                const failed = job.status === "FAILED" || job.status === "BLOCKED";
                const retryKey = `${job.kind}-${job.id}`;
                const outputFiles = job.status === "COMPLETED" ? files.filter(file => job.kind === "edit" ? file.id === job.outputId : file.id === job.id || file.processing?.jobId === job.id) : [];
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
                    {job.status === "COMPLETED" ? <div className="mt-3 space-y-3">{outputFiles.slice(0, 3).map((file, index) => <div key={file.id}><Button type="button" variant="outline" size="sm" onClick={() => setPreview(file)}>Watch video{job.kind === "source" ? ` ${index + 1}` : ""}</Button><PostingActions file={file} /></div>)}{outputFiles.length > 3 ? <a href="#library" className="inline-block text-xs font-semibold underline">All {outputFiles.length} clips are in Library</a> : !outputFiles.length ? <p className="text-xs text-[#687657]">The finished file is not in this Library snapshot. It may be in Trash; history remains saved.</p> : null}</div> : null}
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
          {queue.pages > 1 ? <nav aria-label="Job pages" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" disabled={queue.page <= 1} onClick={() => setJobPage(queue.page - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button><span>Page {queue.page} of {queue.pages}</span><button type="button" disabled={queue.page >= queue.pages} onClick={() => setJobPage(queue.page + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button></nav> : null}
        </section>

        </> : null}
        {section === "settings" ? <div className="space-y-6"><div className="rounded-2xl border border-[#d3dbc5] bg-[#fffdf7] p-5"><h2 className="text-lg font-semibold">Studio preferences</h2><p className="mt-2 text-sm text-[#687657]">Instagram destination: {socialHandle("instagram")} · Free local processing</p><div className="mt-4 flex flex-wrap gap-3"><Link href="/dashboard/manager" className="rounded-lg border px-4 py-2 text-sm font-semibold">Content quality manager</Link><Link href="/dashboard/settings" className="rounded-lg border px-4 py-2 text-sm font-semibold">Publishing settings</Link></div></div><ChannelConnections /></div> : null}
      </main>
      {previewFile ? <ReviewPlayer key={previewFile.id} file={previewFile} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
