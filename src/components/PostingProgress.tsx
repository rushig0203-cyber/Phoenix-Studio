"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ReviewFile } from "@/lib/reviewFiles";
import type { ReviewPublishJob } from "@/lib/reviewPublishing";
import { mergePostingJob, postingActive, postingDestinations, postingOverview, sampleTransfers, transferPercent, transferTime, type TransferSample } from "@/lib/postingProgress";
import PlatformIcon from "./PlatformIcon";
import { PostingContext } from "./PostingProgressContext";

const ReviewPlayer = dynamic(() => import("./ReviewPlayer"), { ssr: false });
const noticesKey = "phoenix-posting-notices-dismissed";
const statusLabel = { QUEUED: "Queued", UPLOADING: "Uploading", PROCESSING: "Processing", COMPLETE: "Posted", FAILED: "Failed", NEEDS_CHECK: "Needs check" } as const;
const button = "rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50";

function ProgressCircle({ percent, label }: { percent?: number; label: string }) {
  return <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    aria-valuetext={percent === undefined ? "Progress not measured" : `${percent}% of video bytes sent`}
    className="grid size-9 shrink-0 place-items-center rounded-full border border-border"
    style={percent === undefined ? undefined : { background: `conic-gradient(var(--primary) ${percent}%, var(--border) 0)` }}>
    <span className="grid size-7 place-items-center rounded-full bg-card text-[0.65rem] font-semibold">{percent === undefined ? "···" : `${percent}%`}</span>
  </span>;
}

/** Lives above dashboard routes; closing any preview only collapses the UI. */
export default function PostingProgress({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ReviewPublishJob[]>([]);
  const jobsRef = useRef(jobs);
  const [samples, setSamples] = useState(new Map<string, TransferSample>());
  const samplesRef = useRef(samples);
  const [observedAt, setObservedAt] = useState(0);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [preview, setPreview] = useState<ReviewFile | null>(null);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const openRequest = useRef<AbortController | null>(null);
  const dockButton = useRef<HTMLButtonElement>(null);
  const version = useRef(0);

  const update = useCallback((next: ReviewPublishJob[]) => {
    jobsRef.current = next;
    const at = Date.now();
    samplesRef.current = sampleTransfers(next, samplesRef.current, at);
    setObservedAt(at);
    setJobs(next); setSamples(samplesRef.current);
    if (postingDestinations(next).every(job => job.status === "COMPLETE")) setExpanded(false);
  }, []);
  const observe = useCallback((file: ReviewFile, saved: ReviewPublishJob[]) => {
    version.current++;
    let next = jobsRef.current;
    for (const fresh of saved) {
      const current = next.find(job => job.reviewId === fresh.reviewId && job.platform === fresh.platform && job.kind === fresh.kind);
      if (current && Date.parse(current.updatedAt) > Date.parse(fresh.updatedAt)) continue;
      const companion = current?.companionStory;
      const retainCompanion = companion && current?.id === fresh.id && !fresh.companionStoryDetached
        && (!fresh.companionStory || (fresh.companionStory.id === companion.id && Date.parse(companion.updatedAt) > Date.parse(fresh.companionStory.updatedAt)));
      next = mergePostingJob(next, retainCompanion ? { ...fresh, companionStory: companion } : fresh);
    }
    update(next);
    setTitles(current => ({ ...current, [file.id]: file.title }));
  }, [update]);
  const accepted = useCallback((file: ReviewFile, job: ReviewPublishJob) => {
    version.current++;
    update(mergePostingJob(jobsRef.current, job));
    setTitles(current => ({ ...current, [file.id]: file.title }));
    setDismissed(current => {
      const next = current.filter(id => id !== job.id && id !== job.companionStory?.id);
      try { localStorage.setItem(noticesKey, JSON.stringify(next)); } catch { /* Progress remains in memory if browser storage is unavailable. */ }
      return next;
    });
  }, [update]);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(noticesKey) || "[]");
      if (Array.isArray(saved)) setDismissed(saved.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)).slice(-200));
    } catch { /* Saved records still restore progress when browser storage is unavailable. */ }
    return () => openRequest.current?.abort();
  }, []);

  useEffect(() => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, pending = false;
    async function read() {
      if (pending || abort.signal.aborted) return;
      clearTimeout(timer);
      if (document.hidden) return;
      pending = true;
      const started = version.current;
      try {
        const response = await fetch("/api/review-publications", { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.jobs)) throw new Error("Could not refresh posting status. Checking again…");
        if (!abort.signal.aborted && started === version.current) {
          const partial = data.limited || data.inspectionIssue;
          const next = partial ? [...jobsRef.current.filter(job => !data.jobs.some((fresh: ReviewPublishJob) => fresh.reviewId === job.reviewId)), ...data.jobs] : data.jobs;
          update(next);
          setTitles(current => ({ ...current, ...data.titles }));
          setError(partial ? "Some saved upload records could not be checked. Open the video's posting tools to inspect them." : "");
        }
      } catch {
        if (!abort.signal.aborted) setError("Could not refresh posting status. Checking again…");
      } finally {
        pending = false;
        if (!abort.signal.aborted) timer = setTimeout(() => void read(), postingDestinations(jobsRef.current).some(postingActive) ? 5000 : 15000);
      }
    }
    const visible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", visible);
    void read();
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [update]);

  async function openVideo(reviewId: string) {
    openRequest.current?.abort();
    const abort = new AbortController(); openRequest.current = abort;
    setOpening(reviewId); setOpenError("");
    try {
      const response = await fetch(`/api/review-files/${encodeURIComponent(reviewId)}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
      const file = await response.json();
      if (!response.ok || file.id !== reviewId || file.status !== "READY" || file.trashedAt || !file.outputs) throw new Error("This saved video is unavailable. The upload status is retained; check Library and the destination account.");
      if (!abort.signal.aborted) { setPreview(file); setExpanded(false); }
    } catch (cause) {
      if (!abort.signal.aborted) setOpenError(cause instanceof Error ? cause.message : "Could not open the saved video. Check Library.");
    } finally { if (!abort.signal.aborted) setOpening(""); }
  }

  const allDestinations = postingDestinations(jobs);
  const notices = allDestinations.filter(job => job.status !== "COMPLETE" && !postingActive(job) && !dismissed.includes(job.id)
    && observedAt - Date.parse(job.updatedAt) < 60 * 60_000)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
  const destinations = [...allDestinations.filter(postingActive), ...notices];
  const { active: activeDestinations, remaining, attention, percent } = postingOverview(destinations);
  const groups = [...new Set(destinations.map(job => job.reviewId))];
  const summary = remaining ? `${remaining} destination${remaining === 1 ? "" : "s"} remaining`
    : attention ? `${attention} destination${attention === 1 ? " needs" : "s need"} attention` : "Posting status";
  const transfers = activeDestinations.filter(job => job.status === "UPLOADING");
  const timing = transfers.length === 1 ? transferTime(transfers[0], samples.get(transfers[0].id), observedAt) : "";
  const phase = error ? "Status unavailable" : remaining && attention ? `${attention} need${attention === 1 ? "s" : ""} attention`
    : activeDestinations.some(job => job.status === "PROCESSING") ? "Processing on platform"
    : percent === 100 ? "Waiting for platform"
    : transfers.length ? timing.startsWith("About") ? timing : "Uploading"
    : remaining ? "Waiting to upload" : "";

  function dismissNotices() {
    const next = [...new Set([...dismissed, ...destinations.filter(job => !postingActive(job)).map(job => job.id)])].slice(-200);
    setDismissed(next);
    try { localStorage.setItem(noticesKey, JSON.stringify(next)); } catch { /* Hiding a notice never changes its saved upload. */ }
    if (!destinations.some(postingActive)) setExpanded(false);
  }

  return <PostingContext.Provider value={{ jobs, error, observe, accepted }}>
    {children}
    {(destinations.length > 0 || error) && <aside data-posting-dock aria-label="Posting progress" className={`fixed bottom-3 right-3 z-40 rounded-xl border border-border bg-card text-foreground shadow-2xl sm:bottom-5 sm:right-5 ${expanded ? "w-[min(23rem,calc(100vw-1.5rem))]" : "w-max max-w-[calc(100vw-1.5rem)]"}`}>
      <button ref={dockButton} type="button" aria-expanded={expanded} aria-controls="posting-progress-details" onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
        {remaining > 0 && <ProgressCircle percent={error || percent === 100 ? undefined : percent} label="Combined video transfer" />}
        <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{summary}</span>{phase && <span className="block text-xs text-muted-foreground">{phase}</span>}</span>
        <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">{expanded ? "▾" : "▴"}</span>
      </button>
      {expanded && <div id="posting-progress-details" className="max-h-[min(70dvh,36rem)] space-y-3 overflow-y-auto border-t border-border p-3">
        {error && <p role="status" className="text-xs text-amber-300">{error}</p>}
        {groups.map(reviewId => <section key={reviewId} aria-label={titles[reviewId] || "Saved video"} className="space-y-2 rounded-xl border border-border p-2">
          <div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words text-xs font-semibold">{titles[reviewId] || "Saved video"}</h2>
            <button type="button" className={`${button} shrink-0`} disabled={!!opening} onClick={() => void openVideo(reviewId)}>{opening === reviewId ? "Opening…" : "Open video"}</button></div>
          {destinations.filter(job => job.reviewId === reviewId).sort((a, b) => a.platform.localeCompare(b.platform) || Number(Boolean(a.kind)) - Number(Boolean(b.kind))).map(job => {
            const sent = transferPercent(job);
            const name = job.platform === "instagram" ? job.kind === "story" ? "Instagram Story" : "Instagram Reel" : job.platform === "facebook" ? "Facebook Page" : "YouTube";
            return <div key={job.id} data-posting-dock-job={job.id} className="flex items-start gap-2 rounded-lg bg-muted/40 p-2">
              <PlatformIcon platform={job.platform} className="mt-1 size-4 shrink-0" />
              <div className="min-w-0 flex-1 text-xs"><p className="font-semibold">{name} · {statusLabel[job.status]}</p><p className="break-words text-muted-foreground">{job.accountName}</p>
                {postingActive(job) && <p>{error ? "Waiting for current status" : transferTime(job, samples.get(job.id), observedAt)}</p>}
                {(job.status === "FAILED" || job.status === "NEEDS_CHECK") && <p className="mt-1 break-words">{job.detail}</p>}
                {job.remoteUrl && <a href={job.remoteUrl} target="_blank" rel="noopener noreferrer" className="underline">View post ↗</a>}
              </div>
              {!error && job.status === "UPLOADING" && sent !== undefined && sent < 100 && <ProgressCircle percent={sent} label={`${name} transfer`} />}
            </div>;
          })}
        </section>)}
        {openError && <p role="alert" className="text-xs">{openError}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => { setExpanded(false); dockButton.current?.focus(); }}>Collapse progress</button>
          {attention > 0 && <button type="button" className={button} onClick={dismissNotices}>Dismiss notices</button>}
        </div>
      </div>}
    </aside>}
    {preview && <ReviewPlayer key={preview.id} file={preview} onClose={() => { setPreview(null); dockButton.current?.focus(); }} />}
  </PostingContext.Provider>;
}
