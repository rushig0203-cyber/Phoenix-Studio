"use client";
import { useEffect, useRef, useState } from "react";
import type { ReviewFile } from "@/lib/reviewFiles";
import { postingCaption, postingDownload, postingHashtags, postingText } from "@/lib/posting";
import { INSTAGRAM_HASHTAG_LIMIT } from "@/lib/postingCopyPolicy";
import ReviewPublishActions from "./ReviewPublishActions";

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

/** Keep offline handoff alongside explicitly confirmed connected uploads. */
export default function PostingActions({ file: supplied }: { file: ReviewFile }) {
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState(supplied);
  const [busy, setBusy] = useState(false);
  const requesting = useRef(false);
  const copyDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setFile(current => current.id === supplied.id ? mergePostingSnapshot(current, supplied) : supplied); }, [supplied]);
  const analysis = file.quality.postingAnalysis;
  const automaticCopy = file.quality.postingTextOrigin !== "owner" && (!file.editedFrom || file.quality.postingTextOrigin === "automatic" || !!analysis);
  useEffect(() => {
    if (!postingDownload(file) || !automaticCopy || (analysis && !["QUEUED", "ANALYZING", "WAITING"].includes(analysis.status))) return;
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
  }, [file.id, file.status, analysis?.status, automaticCopy]);
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
    try { await navigator.clipboard.writeText(postingText(file)); setNotice("Caption and hashtag bank copied. Choose a platform in Post / export for its posting text."); }
    catch { if (copyDetails.current) copyDetails.current.open = true; setNotice("Clipboard unavailable. Select and copy the caption and hashtags displayed here."); }
  }
  const button = "inline-flex rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-xs font-semibold";
  const hashtags = postingHashtags(file.quality.hashtags);
  return <section aria-label={`Posting tools for ${file.title}`} className="mt-3 space-y-3 rounded-xl border border-[#d5ddbe] bg-[#f7faef] p-3 text-sm">
    {automaticCopy && (!analysis || ["QUEUED", "ANALYZING", "WAITING"].includes(analysis.status)) ? <p role="status" className="text-xs text-[#657153]">{analysis?.status === "WAITING" ? `Video finished · caption waiting. ${analysis.detail}${analysis.nextAttemptAt ? ` Next automatic check: ${new Date(analysis.nextAttemptAt).toLocaleString()}.` : ""}` : analysis?.status === "ANALYZING" ? "Video finished · checking frames for its own caption…" : "Video finished · caption queued automatically. No re-analysis click is needed."}</p> : null}
    {analysis?.status === "FAILED" ? <p role="status" className="text-xs text-red-700">Video finished · caption analysis failed. {analysis.detail}</p> : null}
    <details ref={copyDetails} className="space-y-3">
      <summary className="cursor-pointer font-semibold">Caption & hashtags</summary>
      <div className="space-y-3 pt-2">
        <p className="whitespace-pre-wrap break-words select-text">{!file.quality.postCopy?.trim() && automaticCopy && analysis?.status !== "COMPLETE" ? "No analyzed caption yet. The video title is not a finished posting caption." : postingCaption(file)}</p>
        <p className="text-xs text-[#657153]">Hashtag candidate bank · {hashtags.length} saved. New analysis aims for 15–20 relevant choices; it does not add unrelated filler to meet a count.</p>
        <p className="break-words text-[#526044] select-text">{hashtags.join(" ") || "No hashtags saved for this video."}</p>
        <p className="text-xs text-[#657153]">Instagram allows up to {INSTAGRAM_HASHTAG_LIMIT} hashtags per Reel; its copy and posting form use the strongest saved choices. YouTube can use the larger bank. More hashtags do not guarantee more views.</p>
        {file.audience.startsWith("kids") ? <p className="text-xs text-[#657153]">Children’s content: set the appropriate made-for-kids audience on YouTube.</p> : null}
        <details className="space-y-2 text-xs">
          <summary className="cursor-pointer">More options</summary>
          <p className="text-[#657153]">{!automaticCopy ? "Owner-edited posting text is retained. Analysis runs only if you request it." : analysis ? `${analysis.status === "COMPLETE" ? "Video-specific copy" : analysis.status}: ${analysis.detail}` : "Draft posting text—not yet verified against this video's frames."}{analysis?.nextAttemptAt ? ` Next check: ${new Date(analysis.nextAttemptAt).toLocaleString()}.` : ""}</p>
          <button type="button" onClick={() => void analyze()} disabled={busy || ["QUEUED", "ANALYZING", "WAITING"].includes(analysis?.status || "")} className={`${button} disabled:opacity-50`}>{busy ? "Queuing…" : analysis?.status === "COMPLETE" ? "Re-analyze this video" : "Analyze video for posting copy"}</button>
          {analysis?.hashtagActivity ? <details className="text-[#657153]"><summary className="cursor-pointer">Hashtag activity · {analysis.hashtagActivity.status === "CHECKED" ? "limited recent sample" : "not fully verified"}</summary><p className="mt-2">{analysis.hashtagActivity.detail} Checked: {new Date(analysis.hashtagActivity.checkedAt).toLocaleString()}.</p>{analysis.hashtagActivity.samples.map(sample => <p key={sample.tag}>{sample.tag}: {sample.recentSample} recent sampled posts, {sample.videos} video posts.</p>)}</details> : <p className="text-[#657153]">Hashtags are topic suggestions, not verified current trends. Video-specific copy is checked automatically when frame analysis is enabled.</p>}
          {file.quality.subtitles ? <p>Subtitles: {file.quality.subtitles.reason}</p> : null}
          <details><summary className="cursor-pointer">On-screen subtitles (separate from posting copy)</summary><p className="mt-2 whitespace-pre-wrap select-text">{file.quality.captions.join("\n") || "No on-screen subtitles."}</p></details>
        </details>
      </div>
    </details>
    <div className="flex flex-wrap items-start gap-2">
      <button type="button" onClick={() => void copy()} className={button}>Copy caption + hashtags</button>
      <ReviewPublishActions key={file.id} file={file}/>
    </div>
    {notice ? <p role="status" className="text-xs">{notice}</p> : null}
  </section>;
}
