"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FolderOpen, Info, Play, RotateCcw, Search, Trash2 } from "lucide-react";
import type { ReviewFile } from "@/lib/reviewFiles";
import ReviewPlayer, { reviewTarget } from "./ReviewPlayer";
import PostingActions from "./PostingActions";
import ReviewStorageSummary from "./ReviewStorageSummary";

const pageSize = 6;
const stockSource = (file: ReviewFile) => file.source.kind === "pexels" || file.source.kind === "pixabay" || file.source.filename.startsWith("stock-");
const footageReview = (file: ReviewFile) => stockSource(file) && !file.delivery?.creationType?.startsWith("children") && !file.audience.startsWith("kids");
const category = (file: ReviewFile) => file.editedFrom ? "edited" : file.delivery?.creationType?.startsWith("children") || file.audience.startsWith("kids") ? "children" : file.source.kind === "pexels" || file.source.kind === "pixabay" || file.source.filename.startsWith("stock-") ? "stock" : "source";
const categoryNames: Record<string, string> = { children: "Children’s animation", stock: "Stock video", source: "Source clip", edited: "Edited copy" };
const seconds = (value?: number) => {
  if (value === undefined || !Number.isFinite(value)) return "";
  const rounded = Math.max(0, Math.round(value));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

function Poster({ file, onPlay }: { file: ReviewFile; onPlay: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const identity = `${file.id}:${reviewTarget(file)}:${file.updatedAt}`;
  useEffect(() => { setFailed(false); setAttempt(0); }, [identity]);
  useEffect(() => {
    if (!failed || attempt >= 3) return;
    // A deferred decoder is not a permanently broken video. Bound retries and
    // clean the timer on navigation; never mount a hidden video as a fallback.
    let retried = false;
    const retry = () => {
      if (retried || document.hidden) return;
      retried = true;
      setAttempt(value => value + 1); setFailed(false);
    };
    const timer = window.setTimeout(retry, [10_000, 30_000, 60_000][attempt]);
    document.addEventListener("visibilitychange", retry);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", retry); };
  }, [failed, attempt, identity]);
  return <button type="button" onClick={onPlay} aria-label={`Preview ${file.title}`} className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-[#26331f] text-white">
    {!failed ? <Image unoptimized src={`/api/review-files/${file.id}/poster?target=${reviewTarget(file)}&v=${encodeURIComponent(file.updatedAt)}&attempt=${attempt}`} alt="" fill sizes="384px" className="object-contain" loading="lazy" onError={() => setFailed(true)} /> : null}
    <span className="relative flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-xs font-semibold transition group-hover:bg-black/85"><Play className="h-4 w-4" />{failed ? "Open video preview" : "Play preview"}</span>
  </button>;
}

export default function ReviewLibrary({ files, loading, onRefresh }: { files: ReviewFile[]; loading: boolean; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [publicationView, setPublicationView] = useState<"generated" | "posted">("generated");
  const [page, setPage] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<ReviewFile[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [locallyTrashed, setLocallyTrashed] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(false);

  async function loadTrash() {
    setTrashLoading(true);
    try {
      const response = await fetch("/api/review-files?trash=1", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load Trash. Try opening it again.");
      setTrash(await response.json());
    } catch (error) { setError(error instanceof Error ? error.message : "Could not reach Trash."); }
    finally { setTrashLoading(false); }
  }

  async function move(file: ReviewFile, restore = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(file.id); setError("");
    try {
      // Only this click handler confirms. The API never opens another prompt.
      if (!restore && !window.confirm(`Move “${file.title}” to Trash? You can restore it later.`)) return;
      const response = await fetch(`/api/review-files/${file.id}`, restore
        ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) }
        : { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the review file.");
      if (restore) { setLocallyTrashed(ids => { const next = new Set(ids); next.delete(file.id); return next; }); setTrash(items => items.filter(item => item.id !== file.id)); setUndoId(null); }
      else { setLocallyTrashed(ids => new Set(ids).add(file.id)); setPreviewId(current => current === file.id ? null : current); setUndoId(file.id); setTrash(items => [file, ...items.filter(item => item.id !== file.id)]); }
      setNotice(restore ? `Restored “${file.title}”.` : `Moved “${file.title}” to Trash. The MP4 and editing files are retained on disk.`);
      await onRefresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not reach the local server."); }
    finally { inFlight.current = false; setBusy(null); }
  }

  async function shortcut() {
    try {
      const response = await fetch("/api/review-files/shortcut", { method: "POST" });
      if (!response.ok) throw new Error("Could not create the Desktop shortcut.");
      setNotice("Review Files shortcut created on your Desktop.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not reach the local server."); }
  }

  // An older in-flight poll must not briefly bring a just-deleted card back.
  const available = files.filter(file => !locallyTrashed.has(file.id));
  const posted = available.filter(file => file.publication?.status === "POSTED" && file.publication.postedTo.length > 0);
  const generated = available.filter(file => !(file.publication?.status === "POSTED" && file.publication.postedTo.length > 0));
  const search = query.trim().toLowerCase();
  const filtered = search !== "" || filter !== "all";
  const visible = (trashOpen ? trash : publicationView === "posted" ? posted : generated).filter(file => (filter === "all" || category(file) === filter) && `${file.title} ${file.quality.hashtags.join(" ")} ${file.quality.postCopy || ""}`.toLowerCase().includes(search));
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const displayed = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const preview = !trashOpen && files.find(file => file.id === previewId);
  const undoFile = trash.find(file => file.id === undoId);

  return <section id="library" aria-label="Review library" className="mt-8 scroll-mt-5 rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative flex items-center gap-2"><h2 className="text-2xl font-semibold">{trashOpen ? "Recoverable Trash" : "Your videos"} <span className="text-base font-normal text-[#687657]">· {trashOpen ? trash.length : available.length}</span></h2>
        <details className="text-[#687657]">
          <summary aria-label="About your video library" title="About your video library" className="flex cursor-pointer list-none rounded-full p-1 hover:bg-[#edf1e5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#394a2a] [&::-webkit-details-marker]:hidden"><Info aria-hidden="true" className="h-4 w-4" /></summary>
          <div className="absolute left-0 top-8 z-10 w-64 max-w-[calc(100vw-3rem)] space-y-2 rounded-xl border border-[#bdc7a5] bg-[#fffdf7] p-3 text-xs leading-5 shadow-lg">
            <p>Preview, edit, then post. Completed rendering still needs your visual and listening review.</p>
            <p>{publicationView === "posted" ? "Confirmed Instagram Reel or YouTube uploads made through Phoenix. Queued, failed and Story-only uploads are not counted." : "Videos without a confirmed Phoenix post. Downloading or posting outside Phoenix does not move a video to Posted automatically."}</p>
            <p>Only this page’s previews load; paging keeps every saved video available.</p>
          </div>
        </details>
      </div>
      <div className="flex flex-wrap gap-4 text-sm font-semibold"><button type="button" onClick={() => void shortcut()} className="inline-flex items-center gap-1"><FolderOpen className="h-4 w-4" />Desktop shortcut</button><button type="button" aria-pressed={trashOpen} onClick={() => { if (!trashOpen) void loadTrash(); setTrashOpen(value => !value); setPage(1); setPreviewId(null); }} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 ${trashOpen ? "bg-[#e8edd7]" : ""}`}><Trash2 className="h-4 w-4" />{trashOpen ? "Back to videos" : "Trash"}</button></div>
    </div>
    {!trashOpen ? <>
      <nav aria-label="Library posting views" className="mt-4 flex flex-wrap gap-2">
        {(["generated", "posted"] as const).map(view => <button key={view} type="button" aria-pressed={publicationView === view} onClick={() => { setPublicationView(view); setPage(1); setPreviewId(null); }} className={`rounded-full border border-[#bdc7a5] px-4 py-2 text-sm font-semibold ${publicationView === view ? "bg-[#394a2a] text-white" : "bg-white text-[#394a2a]"}`}>{view === "generated" ? "Generated" : "Posted"} · {view === "generated" ? generated.length : posted.length}</button>)}
      </nav>
    </> : null}
    <ReviewStorageSummary />
    {trashOpen ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Trash is recoverable. These files still use disk space; nothing here is permanently erased.</p> : null}
    <div className="mt-4 flex flex-wrap gap-3">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#bdc7a5] bg-white px-3"><Search className="h-4 w-4 shrink-0" /><input aria-label="Search videos" type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search titles or hashtags" className="w-full min-w-0 bg-transparent py-2.5 text-sm outline-none" /></label>
      <select aria-label="Video category" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} className="rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-sm"><option value="all">All video types</option>{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      {filtered ? <button type="button" onClick={() => { setQuery(""); setFilter("all"); setPage(1); }} className="rounded-lg border border-[#bdc7a5] px-3 py-2 text-sm">Clear filters</button> : null}
    </div>
    {visible.length ? <p className="mt-3 text-xs text-[#687657]">Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} of {visible.length}{filtered ? " matching videos" : " videos"}.</p> : null}
    {notice ? <div role="status" className="mt-3 rounded-lg bg-[#edf3de] p-3 text-sm">{notice} {undoFile ? <button type="button" disabled={busy !== null} onClick={() => void move(undoFile, true)} className="ml-2 font-bold underline">Undo</button> : null}</div> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {!displayed.length ? <p className="mt-5 rounded-xl border border-dashed p-7 text-center text-sm text-[#687657]">{loading || trashLoading ? "Loading videos…" : filtered ? "No videos match these filters. Clear filters to see videos in this view." : trashOpen ? "Trash is empty." : publicationView === "posted" ? "No confirmed Reel or YouTube posts yet. Story history is in Post / export." : posted.length ? "All current videos have a confirmed post. Open Posted to find them." : "No finished videos yet. Use Create to start a video."}</p> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {displayed.map(file => {
        const output = file.outputs[reviewTarget(file)];
        return <article key={file.id} className="flex min-w-0 flex-col rounded-xl border border-[#d5ddbe] bg-[#fafbf3] p-3">
          {!trashOpen ? <Poster file={file} onPlay={() => setPreviewId(file.id)} /> : null}
          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-[#687657]"><span>{categoryNames[category(file)]}</span><span>{seconds(output?.duration)} · {file.delivery?.aspect || file.processing?.format || "Original"}</span></div>
          <h3 className="mt-2 text-base font-semibold leading-snug">{file.title}</h3>
          {file.publication?.status === "POSTED" && file.publication.postedTo.length ? <p className="mt-2 text-xs font-semibold text-[#394a2a]">Posted to {file.publication.postedTo.map((post, index) => <span key={post.platform}>{index ? " · " : ""}{post.remoteUrl ? <a href={post.remoteUrl} target="_blank" rel="noreferrer" className="underline">{post.platform === "instagram" ? "Instagram" : "YouTube"} ↗</a> : post.platform === "instagram" ? "Instagram" : "YouTube"}</span>)}</p> : file.publication?.previouslyPostedTo?.length ? <p className="mt-2 text-xs text-amber-800">An earlier version was posted; this output is new or changed.</p> : null}
          {file.publication?.inspectionIssue ? <p className="mt-2 text-xs text-amber-800">Posting history could not be confirmed. Check the channel before posting again.</p> : null}
          {file.series ? <p className="mt-1 text-xs text-[#687657]">Part {file.series.episodeNumber} of {file.series.episodeCount}</p> : null}
          <p className="mt-2 text-xs text-[#a06b29]">{file.monetizationReview?.status === "NEEDS_CHANGES" ? "Needs changes" : file.monetizationReview?.status === "CHECKED" ? "Manual checklist checked" : "Needs your review"}{file.audience.startsWith("kids") ? " · Made for kids" : ""}</p>
          {!trashOpen ? <>
            <div className="mt-3 text-xs font-bold"><Link href={`/dashboard/edit/${file.id}`} className="rounded-lg bg-[#394a2a] px-3 py-2 text-white">Edit video</Link></div>
            <PostingActions file={file} />
            <details className="mt-3 border-t border-[#dbe1cc] pt-3 text-xs text-[#526044]"><summary className="cursor-pointer font-semibold">Posting details & quality notes</summary><div className="mt-3 space-y-3 leading-5">
              <p>{file.quality.captions[0] || "No caption text recorded."}</p>
              {file.quality.storyboard?.length ? <div><p className="font-semibold">Narration-timed footage plan</p><ol className="mt-2 space-y-3">{file.quality.storyboard.map((shot, index) => <li key={index}><p className="font-medium">{shot.start.toFixed(1)}–{shot.end.toFixed(1)}s · {shot.query}</p><p>{shot.narration}</p>{shot.timing === "within-caption-estimate" ? <p className="text-amber-800">Timing estimated within a caption line.</p> : null}{shot.sourcePage ? <a href={shot.sourcePage} target="_blank" rel="noreferrer" className="underline">Original stock footage ↗</a> : null}</li>)}</ol></div> : file.quality.visualBrief?.length ? <div><p className="font-semibold">Legacy visual search brief · not timed to narration</p><ol className="list-inside list-decimal">{file.quality.visualBrief.map((term, index) => <li key={`${index}-${term}`}>{term}</li>)}</ol></div> : null}
              {file.processing && !footageReview(file) ? <p>{file.processing.scoreKind === "script-checks" || file.source.filename.startsWith("local-cartoon-") ? "Text checks only—not animation or singing quality." : "Manager recommendation—not a prediction of views."} {file.processing.reason}</p> : null}
              {file.quality.visualSources?.map(source => <a key={`${source.provider}:${source.providerMediaId}`} className="mr-2 inline-block underline" href={source.providerUrl} target="_blank" rel="noreferrer">{source.provider === "pexels" ? "Pexels" : "Pixabay"} #{source.providerMediaId}</a>)}
              {file.quality.warning ? <p className="text-amber-800">{file.quality.warning}</p> : null}
              {file.delivery?.creationType === "children-song" && file.quality.audio === "local-narration-music" ? <p className="text-amber-800">Older speech-only song: narration is not singing. Use a sung recording for a new version.</p> : null}
              <p>{file.monetizationReview?.warning || "Review the full video and rights before posting. Earnings are not guaranteed."}</p>
              {!footageReview(file) ? <Link href={`/dashboard/manager?review=${file.id}`} className="block font-bold underline">Rate this video / guide the manager</Link> : null}
            </div></details>
          </> : null}
          <div className="mt-auto flex justify-end pt-3"><button type="button" disabled={busy !== null} aria-label={`${trashOpen ? "Restore" : "Move to Trash"}: ${file.title}`} onClick={() => void move(file, trashOpen)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8b4a32] disabled:opacity-50">{trashOpen ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}{busy === file.id ? "Saving…" : trashOpen ? "Restore video" : "Move to Trash"}</button></div>
        </article>;
      })}
    </div>}
    {pages > 1 ? <nav aria-label="Video pages" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button><span>Page {currentPage} of {pages}</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button></nav> : null}
    {preview ? <ReviewPlayer key={preview.id} file={preview} onClose={() => setPreviewId(null)} /> : null}
  </section>;
}
