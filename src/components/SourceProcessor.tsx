"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startDashboardPolling } from "@/lib/dashboardMonitor";
import StudioActivity from "./StudioActivity";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024;

type Job = {
  id: string;
  title: string;
  mode: "coverage" | "highlights";
  status: string;
  progress: number;
  stage: string;
  error?: string;
  completedClips: number;
  totalClips: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
};

type Preflight = {
  ready: boolean;
  summary: string;
  dependencies: Record<"ffmpeg" | "ffprobe" | "python" | "fasterWhisper", boolean>;
  details: Record<"ffmpeg" | "ffprobe" | "python" | "fasterWhisper", string>;
  firstModelDownloadRequired: boolean;
  whisperModel: { message: string };
};

function shortDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export default function SourceProcessor({ onClose, onStarted, active = true }: { onClose: () => void; onStarted?: () => void; active?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"coverage" | "highlights">("coverage");
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | undefined>();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pollError, setPollError] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const processorMounted = useRef(true);
  const uploadInFlight = useRef(false);
  const statusRequest = useRef<AbortController | null>(null);
  const pendingWork = useRef(true);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const controller = new AbortController();
    statusRequest.current = controller;
    const request = (async () => {
      try {
        const response = await fetch("/api/source-processing", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error(`Status request failed (${response.status}).`);
        const data = await response.json() as { preflight?: Preflight; jobs?: Job[] };
        if (!processorMounted.current || controller.signal.aborted) return;
        pendingWork.current = (data.jobs || []).some(job => ["QUEUED", "PROCESSING", "RUNNING"].includes(job.status));
        setPreflight(data.preflight || null);
        setJobs(data.jobs || []);
        setPollError("");
      } catch {
        if (processorMounted.current && !controller.signal.aborted) {
          pendingWork.current = true;
          setPollError("Could not refresh processor status. The displayed queue may be stale.");
        }
      }
    })();
    refreshInFlight.current = request;
    try {
      await request;
    } finally {
      if (refreshInFlight.current === request) refreshInFlight.current = null;
      if (statusRequest.current === controller) statusRequest.current = null;
    }
  }, []);

  useEffect(() => {
    processorMounted.current = true;
    return () => {
      processorMounted.current = false;
      statusRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const polling = startDashboardPolling({ refresh, offline: () => false, visible: () => !document.hidden, active: () => pendingWork.current });
    const visibility = () => {
      if (document.hidden) {
        statusRequest.current?.abort();
        refreshInFlight.current = null;
      }
      void polling.retry();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      polling.stop();
      document.removeEventListener("visibilitychange", visibility);
      statusRequest.current?.abort();
      refreshInFlight.current = null;
    };
  }, [active, refresh]);

  function selectFile(selected: File | null, input: HTMLInputElement) {
    if (selected && selected.size > MAX_SOURCE_BYTES) {
      input.value = "";
      setFile(null);
      setNotice("Files larger than 5 GB are not supported.");
      return;
    }
    setFile(selected);
    setNotice(selected ? `Ready: ${selected.name} (${(selected.size / 1024 / 1024).toFixed(1)} MB)` : "");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (uploadInFlight.current) return;
    if (!file) {
      setNotice("Choose a video file first.");
      return;
    }
    if (!preflight?.ready) {
      setNotice("Local processing tools are not ready yet.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setNotice("Files larger than 5 GB are not supported.");
      return;
    }

    uploadInFlight.current = true;
    setBusy(true);
    setUploadPercent(0);
    setNotice("");
    const request = new XMLHttpRequest();
    request.open("POST", "/api/source-processing");
    request.setRequestHeader("Content-Type", file.type || "video/mp4");
    request.setRequestHeader("X-Phoenix-Filename", encodeURIComponent(file.name));
    request.setRequestHeader("X-Phoenix-Title", encodeURIComponent(file.name.replace(/\.[^.]+$/, "")));
    request.setRequestHeader("X-Phoenix-Mode", mode);
    request.upload.onprogress = (progress) => {
      if (progress.lengthComputable) setUploadPercent(Math.round(progress.loaded / progress.total * 100));
    };
    request.onerror = () => {
      uploadInFlight.current = false;
      setBusy(false);
      setNotice("Upload failed. Phoenix kept no partial job; try again.");
    };
    request.onabort = () => {
      uploadInFlight.current = false;
      setBusy(false);
      setNotice("Upload stopped. Phoenix kept no partial job; try again.");
    };
    request.onload = () => {
      uploadInFlight.current = false;
      setBusy(false);
      let data: { message?: string; error?: string } | null = null;
      try {
        data = JSON.parse(request.responseText) as { message?: string; error?: string };
      } catch {
        // Use the HTTP fallback message below.
      }
      setNotice(request.status >= 200 && request.status < 300
        ? data?.message || "Queued for processing."
        : data?.error || `Upload failed (${request.status}).`);
      if (request.status >= 200 && request.status < 300) onStarted?.();
      void refresh();
    };
    request.send(file);
  }

  async function retry(id: string) {
    if (retrying) return;
    setRetrying(id);
    try {
      const response = await fetch("/api/source-processing/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      setNotice(response.ok ? data?.message || "Source job queued again." : data?.error || "Could not retry this job.");
      await refresh();
    } catch {
      setNotice("Could not reach the local queue. Try again.");
    } finally {
      setRetrying(null);
    }
  }

  const missingDependencies = preflight
    ? Object.entries(preflight.dependencies).filter(([, available]) => !available).map(([name]) => name)
    : [];

  return <section className="mt-5 rounded-[1.5rem] border border-[#bfcaa6] bg-white p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-xl font-semibold">Clip your video</h3>
      </div>
      <Button type="button" variant="outline" onClick={onClose}>Close</Button>
    </div>

    {!preflight && <div className="mt-4"><StudioActivity label="Checking video tools…" /></div>}
    {preflight && !preflight.ready && <div className="mt-4 rounded-xl border border-[#f0c9a4] bg-[#fff5ea] p-3 text-sm text-[#85421f]">
      <div className="flex gap-2"><TriangleAlert className="h-5 w-5 shrink-0" /><span>{preflight.summary}</span></div>
      {missingDependencies.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-8 text-xs">
        {missingDependencies.map((name) => <li key={name}>{preflight.details[name as keyof Preflight["details"]]}</li>)}
      </ul>}
    </div>}
    {preflight?.ready && preflight.firstModelDownloadRequired && <div className="mt-4 rounded-xl border border-[#d8cf9b] bg-[#fffbea] p-3 text-sm text-[#735f24]">
      <strong>First transcription setup:</strong> {preflight.whisperModel.message}
    </div>}
    <form className="mt-5 space-y-4" onSubmit={submit}>
      <label htmlFor="episode-file" className="block text-sm font-semibold">
        Choose a video
        <input
          id="episode-file"
          className="mt-2 block w-full rounded-xl border border-dashed border-[#aebc88] p-4 text-sm font-normal"
          type="file"
          accept="video/*,.mkv,.avi,.mov,.webm"
          onChange={(event) => selectFile(event.target.files?.[0] || null, event.currentTarget)}
        />
      </label>
      <fieldset>
        <legend className="text-sm font-semibold">Suggested clip styles</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm ${mode === "coverage" ? "border-[#667443] bg-[#edf1dc]" : "border-[#c8d19f]"}`}>
            <input aria-label="Full coverage" className="mr-2" name="mode" type="radio" checked={mode === "coverage"} onChange={() => setMode("coverage")} />
            <span><span className="block font-semibold">Full coverage</span><span className="mt-1 block text-xs text-muted-foreground">Keep the complete episode in natural clips.</span></span>
          </label>
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm ${mode === "highlights" ? "border-[#667443] bg-[#edf1dc]" : "border-[#c8d19f]"}`}>
            <input aria-label="Best highlights" className="mr-2" name="mode" type="radio" checked={mode === "highlights"} onChange={() => setMode("highlights")} />
            <span><span className="block font-semibold">Best highlights</span><span className="mt-1 block text-xs text-muted-foreground">Find standout moments after you upload.</span></span>
          </label>
        </div>
      </fieldset>
      <details className="text-xs leading-5 text-[#647451]">
        <summary className="cursor-pointer font-semibold">Clip details</summary>
        <p className="mt-2">Full coverage produces contiguous natural 2–3 minute clips, including the final seconds. Best highlights ranks clips from hooks, transcript density, silence and audio after you upload the video.</p>
        <p className="mt-2">Phoenix processes one heavy export at a time, limits FFmpeg to two CPU threads and uses below-normal Windows priority so the laptop stays usable.</p>
      </details>
      <Button type="submit" disabled={busy || preflight?.ready !== true} className="bg-[#394a2a] px-5 text-white">
        <Upload className="mr-2 h-4 w-4" />Process video
      </Button>
      {busy && <StudioActivity label="Uploading video…" percent={uploadPercent} />}
      {notice && <p role="status" className="rounded-xl bg-[#f4f7ea] p-3 text-sm text-[#687657]">{notice}</p>}
      {pollError && <p role="alert" className="text-xs text-[#a75528]">{pollError}</p>}
    </form>

    {jobs.length > 0 && <div className="mt-5 space-y-2">
      {jobs.slice(0, 8).map((job) => {
        const canRetry = job.status === "FAILED" || job.status === "BLOCKED";
        const processing = ["QUEUED", "PROCESSING", "RUNNING"].includes(job.status);
        return <div key={job.id} className="rounded-xl bg-[#f5f7ec] p-3">
          <div className="flex justify-between gap-3 text-sm font-semibold">
            <span className="truncate">{job.title}</span>
            <span>{job.status}</span>
          </div>
          {processing ? <StudioActivity label={job.stage || "Processing clips…"} percent={job.progress} /> : <div className="mt-2 h-2 overflow-hidden rounded bg-[#d5ddb8]">
            <div
              className={`h-full transition-[width] ${job.status === "FAILED" || job.status === "BLOCKED" ? "bg-[#b55d3d]" : "bg-[#667b42]"}`}
              style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
            />
          </div>}
          <p className="mt-1 text-xs text-[#687657]">
            {job.stage}{job.totalClips ? ` · ${job.completedClips}/${job.totalClips} clips` : ""}
            {job.status === "PROCESSING" ? ` · ${shortDuration(job.elapsedSeconds)} elapsed${job.estimatedRemainingSeconds === null ? " · estimating time remaining" : ` · about ${shortDuration(job.estimatedRemainingSeconds)} remaining`}` : ""}
            {job.status === "COMPLETED" && job.elapsedSeconds > 0 ? ` · completed in ${shortDuration(job.elapsedSeconds)}` : ""}
          </p>
          {job.error && <p className="mt-1 text-xs text-[#a75528]">{job.error}</p>}
          {canRetry && <button
            type="button"
            disabled={retrying !== null}
            className="mt-1 text-xs font-bold text-[#4f5c31] disabled:opacity-50"
            onClick={() => void retry(job.id)}
          >Retry processing</button>}
          {retrying === job.id && <StudioActivity label="Queueing clips…" />}
        </div>;
      })}
    </div>}
  </section>;
}
