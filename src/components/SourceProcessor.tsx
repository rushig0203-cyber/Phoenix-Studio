"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export default function SourceProcessor({ onClose, onStarted }: { onClose: () => void; onStarted?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"coverage" | "highlights">("coverage");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pollError, setPollError] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const processorMounted = useRef(true);
  const uploadInFlight = useRef(false);

  async function refresh() {
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      try {
        const response = await fetch("/api/source-processing", { cache: "no-store" });
        if (!response.ok) throw new Error(`Status request failed (${response.status}).`);
        const data = await response.json() as { preflight?: Preflight; jobs?: Job[] };
        if (!processorMounted.current) return;
        setPreflight(data.preflight || null);
        setJobs(data.jobs || []);
        setPollError("");
      } catch {
        if (processorMounted.current) setPollError("Could not refresh processor status. The displayed queue may be stale.");
      }
    })();
    refreshInFlight.current = request;
    try {
      await request;
    } finally {
      if (refreshInFlight.current === request) refreshInFlight.current = null;
    }
  }

  useEffect(() => {
    processorMounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      window.clearInterval(timer);
      processorMounted.current = false;
    };
  }, []);

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
    setNotice(`Uploading ${file.name}… 0%`);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/source-processing");
    request.setRequestHeader("Content-Type", file.type || "video/mp4");
    request.setRequestHeader("X-Phoenix-Filename", encodeURIComponent(file.name));
    request.setRequestHeader("X-Phoenix-Title", encodeURIComponent(file.name.replace(/\.[^.]+$/, "")));
    request.setRequestHeader("X-Phoenix-Mode", mode);
    request.upload.onprogress = (progress) => {
      if (progress.lengthComputable) setNotice(`Uploading ${file.name}… ${Math.round(progress.loaded / progress.total * 100)}%`);
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
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#75834f]">Source video processor</p>
        <h3 className="mt-1 text-xl font-semibold">Turn an episode into local review clips</h3>
      </div>
      <Button type="button" variant="outline" onClick={onClose}>Close</Button>
    </div>

    {!preflight && <div className="mt-4 flex gap-2 rounded-xl border border-[#d9dfc3] bg-[#f5f7ec] p-3 text-sm text-[#687657]">
      <Loader2 className="h-5 w-5 shrink-0 animate-spin" />Checking FFmpeg, FFprobe, Python, and faster-whisper…
    </div>}
    {preflight && !preflight.ready && <div className="mt-4 rounded-xl border border-[#f0c9a4] bg-[#fff5ea] p-3 text-sm text-[#85421f]">
      <div className="flex gap-2"><TriangleAlert className="h-5 w-5 shrink-0" /><span>{preflight.summary}</span></div>
      {missingDependencies.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-8 text-xs">
        {missingDependencies.map((name) => <li key={name}>{preflight.details[name as keyof Preflight["details"]]}</li>)}
      </ul>}
    </div>}
    {preflight?.ready && preflight.firstModelDownloadRequired && <div className="mt-4 rounded-xl border border-[#d8cf9b] bg-[#fffbea] p-3 text-sm text-[#735f24]">
      <strong>First transcription setup:</strong> {preflight.whisperModel.message}
    </div>}
    {preflight?.ready && <p className="mt-3 rounded-xl bg-[#f4f8e8] p-3 text-xs leading-5 text-[#647451]">
      Laptop-safe mode is on: Phoenix processes one heavy export at a time, limits FFmpeg to two CPU threads, and gives it below-normal Windows priority. Processing will be slower so the laptop stays usable.
    </p>}

    <form className="mt-5 space-y-4" onSubmit={submit}>
      <label htmlFor="episode-file" className="block text-sm font-semibold">
        1. Choose episode video
        <input
          id="episode-file"
          className="mt-2 block w-full rounded-xl border border-dashed border-[#aebc88] p-4 text-sm font-normal"
          type="file"
          accept="video/*,.mkv,.avi,.mov,.webm"
          onChange={(event) => selectFile(event.target.files?.[0] || null, event.currentTarget)}
        />
      </label>
      <fieldset>
        <legend className="text-sm font-semibold">2. Choose how to split it</legend>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className={`cursor-pointer rounded-xl border p-3 text-sm ${mode === "coverage" ? "border-[#667443] bg-[#edf1dc]" : "border-[#c8d19f]"}`}>
            <input className="mr-2" name="mode" type="radio" checked={mode === "coverage"} onChange={() => setMode("coverage")} />
            <strong>Full episode coverage</strong>
            <span className="mt-1 block text-xs text-[#687657]">Contiguous natural 2–3 minute clips with the final seconds included.</span>
          </label>
          <label className={`cursor-pointer rounded-xl border p-3 text-sm ${mode === "highlights" ? "border-[#667443] bg-[#edf1dc]" : "border-[#c8d19f]"}`}>
            <input className="mr-2" name="mode" type="radio" checked={mode === "highlights"} onChange={() => setMode("highlights")} />
            <strong>Best highlights</strong>
            <span className="mt-1 block text-xs text-[#687657]">Ranked from hooks, transcript density, silence, and each clip’s audio.</span>
          </label>
        </div>
      </fieldset>
      <Button type="submit" disabled={busy || preflight?.ready !== true} className="bg-[#394a2a] px-5 text-white">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        {busy ? "Streaming upload…" : "3. Process source video"}
      </Button>
      {notice && <p role="status" className="rounded-xl bg-[#f4f7ea] p-3 text-sm text-[#687657]">{notice}</p>}
      {pollError && <p role="alert" className="text-xs text-[#a75528]">{pollError}</p>}
    </form>

    {jobs.length > 0 && <div className="mt-5 space-y-2">
      {jobs.slice(0, 8).map((job) => {
        const canRetry = job.status === "FAILED" || job.status === "BLOCKED";
        return <div key={job.id} className="rounded-xl bg-[#f5f7ec] p-3">
          <div className="flex justify-between gap-3 text-sm font-semibold">
            <span className="truncate">{job.title}</span>
            <span>{job.status} · {Math.max(0, Math.min(100, job.progress))}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-[#d5ddb8]">
            <div
              className={`h-full transition-[width] ${job.status === "FAILED" || job.status === "BLOCKED" ? "bg-[#b55d3d]" : "bg-[#667b42]"}`}
              style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
            />
          </div>
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
          >{retrying === job.id ? "Queueing…" : "Retry processing"}</button>}
        </div>;
      })}
    </div>}
  </section>;
}
