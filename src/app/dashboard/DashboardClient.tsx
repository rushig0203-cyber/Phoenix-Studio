"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileVideo, RefreshCw, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import SourceProcessor from "@/components/SourceProcessor";
import AICreation from "@/components/AICreation";
import { Button } from "@/components/ui/button";
import type { ReviewFile } from "@/lib/reviewFiles";
import { socialHandle } from "@/lib/socialAccounts";
import Link from "next/link";
import ChannelConnections from "@/components/ChannelConnections";
import ReviewLibrary from "@/components/ReviewLibrary";
import CreationDrafts from "@/components/CreationDrafts";
import type { ReviewEditJob } from "@/lib/reviewEditTypes";


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
  const [sourceOpen, setSourceOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [sourceJobs, setSourceJobs] = useState<SourceJob[]>([]);
  const [aiJobs, setAiJobs] = useState<AiJob[]>([]);
  const [editJobs, setEditJobs] = useState<ReviewEditJob[]>([]);
  const [removingJob, setRemovingJob] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const [loading, setLoading] = useState(false);
  const [jobFilter, setJobFilter] = useState("all");
  const [retrying, setRetrying] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const monitorMounted = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (refreshInFlight.current) {
      try {
        await refreshInFlight.current;
      } finally {
        if (!silent && monitorMounted.current) setLoading(false);
      }
      return;
    }

    const request = (async () => {
    try {
      // A failed edit-queue poll must not blank the independent video library.
      const results = await Promise.allSettled(["/api/review-files", "/api/source-processing", "/api/generations", "/api/review-edits"].map(async endpoint => {
        const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
        return response.json();
      }));
      if (!monitorMounted.current) return;
      const [review, source, ai, edits] = results;
      if (review.status === "fulfilled") setFiles(Array.isArray(review.value) ? review.value.filter((file: ReviewFile) => file.status === "READY") : []);
      if (source.status === "fulfilled") setSourceJobs(source.value.jobs || []);
      if (ai.status === "fulfilled") setAiJobs(Array.isArray(ai.value) ? ai.value : []);
      if (edits.status === "fulfilled") setEditJobs(Array.isArray(edits.value) ? edits.value : []);
      setMonitorError(results.flatMap(result => result.status === "rejected" ? [String(result.reason?.message || "Local request timed out")] : []).join("; "));
    } catch (error) {
      if (monitorMounted.current) {
        setMonitorError(error instanceof Error ? error.message : "Could not refresh Workflow Manager.");
      }
    }
    })();
    refreshInFlight.current = request;
    try {
      await request;
    } finally {
      if (refreshInFlight.current === request) refreshInFlight.current = null;
      if (!silent && monitorMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    monitorMounted.current = true;
    void load();
    const timer = window.setInterval(() => void load(true), 3000);
    return () => {
      window.clearInterval(timer);
      monitorMounted.current = false;
    };
  }, [load]);

  async function retry(job: DisplayJob, regenerate = false) {
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
    ...editJobs.map(job => ({ id:job.id,kind:"edit" as const,title:job.title,status:job.status,progress:job.progress,detail:`Manual edit · ${job.stage}`,error:job.error,createdAt:job.createdAt,elapsedSeconds:job.elapsedSeconds,estimatedRemainingSeconds:job.estimatedRemainingSeconds ?? undefined })),
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

  return (
    <div className="min-h-screen bg-[#f4f0e7] text-[#1e2719]">
      <Navbar inStudio />
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <header className="rounded-2xl bg-[#26331f] px-6 py-6 text-[#f8f5ea]">
          <p className="text-xs font-bold uppercase tracking-[.22em] text-[#cbd796]">Phoenix Studio · free local mode</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-.05em]">Your local video workspace.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d9dfc8]">Create, review, edit, and export. Your files stay on this PC; posting is always your choice.</p>
          <p className="mt-2 text-xs font-semibold text-[#cbd796]">Instagram destination: {socialHandle("instagram")} · <a href="#channels" className="underline">Channel connections</a> · <Link href="/dashboard/manager" className="underline">Content quality manager</Link></p>
        </header>

        <nav aria-label="Studio sections" className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
          <a href="#create" className="rounded-lg border border-[#bfcaa6] bg-white px-4 py-2">Create</a>
          <a href="#library" className="rounded-lg border border-[#bfcaa6] bg-white px-4 py-2">Review library · {files.length}</a>
          <a href="#jobs" className="rounded-lg border border-[#bfcaa6] bg-white px-4 py-2">Live jobs · {jobs.filter(job => ["QUEUED", "RUNNING", "PROCESSING"].includes(job.status)).length} active</a>
          <Link href="/dashboard/manager" className="rounded-lg border border-[#bfcaa6] bg-white px-4 py-2">Quality manager</Link>
        </nav>
        <section id="create" className="mt-5 grid scroll-mt-5 gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5">
            <FileVideo className="h-7 w-7 text-[#536b35]" />
            <h2 className="mt-4 text-2xl font-semibold">Process an episode</h2>
            <p className="mt-2 text-sm leading-6 text-[#687657]">Choose a local video, select full coverage or best highlights, then create real clips.</p>
            <Button type="button" onClick={() => setSourceOpen((open) => !open)} className="mt-5 bg-[#394a2a] text-white">
              {sourceOpen ? "Close processor" : "Choose a video"}
            </Button>
          </article>
          <article className="rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5">
            <Sparkles className="h-7 w-7 text-[#536b35]" />
            <h2 className="mt-4 text-2xl font-semibold">Create a new video</h2>
            <p className="mt-2 text-sm leading-6 text-[#687657]">Business and general videos from stock footage, or simple 2D children’s animation.</p>
            <Button type="button" onClick={() => setAiOpen((open) => !open)} className="mt-5 bg-[#394a2a] text-white">
              {aiOpen ? "Close AI Creation" : "Create a video"}
            </Button>
          </article>
        </section>

        {sourceOpen ? <SourceProcessor onClose={() => setSourceOpen(false)} /> : null}
        {aiOpen ? <AICreation onClose={() => setAiOpen(false)} onStarted={(message) => { setNotice(message || "AI job queued. Live stages appear below."); void load(); }} /> : null}
        <CreationDrafts refreshKey={notice} onApproved={() => void load()} />

        {monitorError ? <p role="alert" className="mt-4 rounded-xl bg-[#ffe1d3] p-3 text-sm text-[#914527]">Some live data could not refresh: {monitorError}. Available videos remain usable; retrying automatically.</p> : null}
        <ReviewLibrary files={files} loading={loading} onRefresh={load} />

        <section id="jobs" className="mt-8 scroll-mt-5 rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-[#75834f]">Workflow Manager</p>
              <h2 className="mt-1 text-2xl font-semibold">Live jobs & history</h2>
            </div>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
          <p className="mt-2 text-sm text-[#687657]">Updates every three seconds. Completed and failed jobs remain in chronological order; new work appears below older work.</p>
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
                    {failed && job.kind !== "edit" ? (
                      <Button type="button" variant="outline" size="sm" disabled={retrying !== null} onClick={() => void retry(job)} className="mt-3">
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />{retrying === retryKey ? "Queueing…" : "Retry"}
                      </Button>
                    ) : null}
                    {job.kind === "edit" && failed ? <Link href="/dashboard" className="mt-3 inline-block text-xs">Open the original video’s editor to export again.</Link> : null}
                    {job.kind === "ai" && job.status === "COMPLETED" ? (
                      <Button type="button" variant="outline" size="sm" disabled={retrying !== null} onClick={() => void retry(job, true)} className="mt-3">
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />{retrying === retryKey ? "Queueing…" : "Regenerate"}
                      </Button>
                    ) : null}
                    {!["RUNNING", "PROCESSING"].includes(job.status) ? (
                      <Button type="button" variant="outline" size="sm" disabled={removingJob !== null} onClick={() => void removeJob(job)} className="ml-2 mt-3" aria-label={`${job.status === "QUEUED" ? "Cancel queued job" : "Remove job from history"}: ${job.title}`}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />{removingJob === retryKey ? "Removing…" : job.status === "QUEUED" ? "Cancel queued job" : "Remove from history"}
                      </Button>
                    ) : <p className="mt-2 text-xs text-[#687657]">History removal is available when this active render finishes.</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="mt-9"><ChannelConnections /></div>
      </main>
    </div>
  );
}
