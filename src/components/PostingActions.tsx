"use client";
import { useEffect, useRef, useState } from "react";
import type { ReviewFile } from "@/lib/reviewFiles";
import { postingDownload, postingText } from "@/lib/posting";

function snapshotTime(value?: string) {
  const time = Date.parse(value || "");
  // All snapshots come from this laptop. Corrupt/far-future dates must not
  // permanently outrank later legitimate owner edits or analysis results.
  return Number.isFinite(time) && time > 0 && time <= Date.now() + 60_000 ? time : 0;
}

function mergePostingSnapshot(current: ReviewFile, incoming: ReviewFile) {
  if (current.id !== incoming.id) return current;
  const currentFileTime = snapshotTime(current.updatedAt), incomingFileTime = snapshotTime(incoming.updatedAt);
  const currentPostingTime = Math.max(currentFileTime, snapshotTime(current.quality.postingAnalysis?.updatedAt));
  const incomingPostingTime = Math.max(incomingFileTime, snapshotTime(incoming.quality.postingAnalysis?.updatedAt));
  const base = incomingFileTime > 0 && incomingFileTime >= currentFileTime ? incoming : current;
  // Analysis transitions do not always update file.updatedAt. Conversely, a
  // newer owner edit/reset is authoritative even when it removes analysis.
  const posting = incomingPostingTime > currentPostingTime ? incoming : current;
  if (base === posting) return base;
  return { ...base, quality: { ...base.quality, postCopy: posting.quality.postCopy, hashtags: posting.quality.hashtags, postingAnalysis: posting.quality.postingAnalysis } };
}

export function FinishedPostingActions({ id }: { id: string }) {
  const [file, setFile] = useState<ReviewFile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let live = true;
    void fetch(`/api/review-files/${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Output unavailable here. Open Library to check the saved copy.");
      const result = await response.json(); if (live) setFile(result);
    }).catch(() => { if (live) setError("Could not load posting details. Open Library to check the saved copy."); }).finally(() => clearTimeout(timeout));
    return () => { live = false; clearTimeout(timeout); controller.abort(); };
  }, [id]);
  return file ? <PostingActions file={file} /> : <p className="mt-2 text-xs">{error || "Loading finished output and posting details…"}</p>;
}

/** Manual handoff: never claims an external upload or publication succeeded. */
export default function PostingActions({ file: supplied }: { file: ReviewFile }) {
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState(supplied);
  const [busy, setBusy] = useState(false);
  const requesting = useRef(false);
  useEffect(() => { setFile(current => current.id === supplied.id ? mergePostingSnapshot(current, supplied) : supplied); }, [supplied]);
  const analysis = file.quality.postingAnalysis;
  useEffect(() => {
    if (!postingDownload(file) || !["QUEUED", "ANALYZING", "WAITING"].includes(analysis?.status || "")) return;
    const controller = new AbortController(); let pending = false;
    const interval = setInterval(() => {
      if (pending || document.hidden) return; pending = true;
      void fetch(`/api/review-files/${encodeURIComponent(file.id)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
        if (response.ok) {
          const incoming: ReviewFile = await response.json();
          if (!controller.signal.aborted) setFile(current => current.id === file.id ? mergePostingSnapshot(current, incoming) : current);
        }
      }).catch(() => undefined).finally(() => { pending = false; });
    }, 15000);
    return () => { clearInterval(interval); controller.abort(); };
  }, [file.id, file.status, analysis?.status]);
  if (!postingDownload(file)) return null;
  async function analyze() {
    if (requesting.current) return;
    requesting.current = true; setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/review-files/${encodeURIComponent(file.id)}/posting-analysis`, { method: "POST", signal: AbortSignal.timeout(15000) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not queue analysis.");
      setFile(current => current.id === file.id ? mergePostingSnapshot(current, value) : current); setNotice("Queued to analyze this video's frames. The finished video stays available.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not queue video analysis."); }
    finally { requesting.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(postingText(file)); setNotice("Caption and hashtags copied. Paste them into your platform's upload form."); }
    catch { setNotice("Clipboard unavailable. Select and copy the caption and hashtags displayed here."); }
  }
  const button = "inline-flex rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-xs font-semibold";
  return <section aria-label={`Posting tools for ${file.title}`} className="mt-3 space-y-3 rounded-xl border border-[#d5ddbe] bg-[#f7faef] p-3 text-sm">
    <h4 className="font-semibold">Caption & hashtags</h4>
    <p className="text-xs text-[#657153]">{analysis ? `${analysis.status === "COMPLETE" ? "Video-specific copy" : analysis.status}: ${analysis.detail}` : "Draft posting text—not yet verified against this video's frames."}{analysis?.nextAttemptAt ? ` Next check: ${new Date(analysis.nextAttemptAt).toLocaleString()}.` : ""}</p>
    <p className="whitespace-pre-wrap break-words select-text">{file.quality.postCopy?.trim() || file.title}</p>
    <p className="break-words text-[#526044] select-text">{file.quality.hashtags.join(" ") || "No hashtags saved for this video."}</p>
    <button type="button" onClick={() => void copy()} className={button}>Copy caption + hashtags</button>
    <button type="button" onClick={() => void analyze()} disabled={busy || ["QUEUED", "ANALYZING", "WAITING"].includes(analysis?.status || "")} className={`${button} ml-2 disabled:opacity-50`}>{busy ? "Queuing…" : analysis?.status === "COMPLETE" ? "Re-analyze this video" : "Analyze video for posting copy"}</button>
    <div className="flex flex-wrap gap-2">{(["instagram", "youtube"] as const).map(platform => {
      const download = postingDownload(file, platform)!;
      const label = platform === "instagram" ? "Instagram" : "YouTube";
      return <div key={platform} className="flex flex-wrap gap-2 rounded-lg border border-[#d5ddbe] p-2">
        <a href={download.url} download={`${file.title}-${download.target}.mp4`} className={button}>Download for {label}</a>
        <a href={platform === "youtube" ? "https://www.youtube.com/upload" : "https://www.instagram.com/"} target="_blank" rel="noopener noreferrer" className={button}>{platform === "youtube" ? "Open YouTube upload ↗" : "Open Instagram Create ↗"}</a>
      </div>;
    })}</div>
    <p className="text-xs text-[#657153]">Manual upload: download the MP4, copy the text, then open the platform and select the file. These buttons do not upload or publish automatically. If only one render exists, both downloads use that same video; check framing before posting.</p>
    {file.audience.startsWith("kids") ? <p className="text-xs text-[#657153]">Children’s content: set the appropriate made-for-kids audience on YouTube.</p> : null}
    {notice ? <p role="status" className="text-xs">{notice}</p> : null}
    {file.quality.subtitles ? <p className="text-xs">Subtitles: {file.quality.subtitles.reason}</p> : null}
    <details className="text-xs"><summary className="cursor-pointer">On-screen subtitles (separate from posting copy)</summary><p className="mt-2 whitespace-pre-wrap select-text">{file.quality.captions.join("\n") || "No on-screen subtitles."}</p></details>
  </section>;
}
