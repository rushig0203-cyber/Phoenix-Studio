"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FolderOpen, Play, RotateCcw, Search, Trash2 } from "lucide-react";
import type { ReviewFile } from "@/lib/reviewFiles";
import ReviewPlayer, { reviewTarget } from "./ReviewPlayer";

const pageSize = 6;
const category = (file: ReviewFile) => file.editedFrom ? "edited" : file.delivery?.creationType?.startsWith("children") || file.audience.startsWith("kids") ? "children" : file.source.filename.startsWith("stock-") ? "stock" : "source";
const categoryNames: Record<string, string> = { children: "Children’s animation", stock: "Stock video", source: "Source clip", edited: "Edited copy" };
const seconds = (value?: number) => value === undefined ? "" : `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`;

function Poster({ file, onPlay }: { file: ReviewFile; onPlay: () => void }) {
  const [failed, setFailed] = useState(false);
  return <button type="button" onClick={onPlay} aria-label={`Preview ${file.title}`} className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-[#26331f] text-white">
    {!failed ? <Image unoptimized src={`/api/review-files/${file.id}/poster?target=${reviewTarget(file)}&v=${encodeURIComponent(file.updatedAt)}`} alt="" fill sizes="384px" className="object-contain" loading="lazy" onError={() => setFailed(true)} /> : null}
    <span className="relative flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-xs font-semibold transition group-hover:bg-black/85"><Play className="h-4 w-4" />{failed ? "Open video preview" : "Play preview"}</span>
  </button>;
}

export default function ReviewLibrary({ files, loading, onRefresh }: { files: ReviewFile[]; loading: boolean; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
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

  async function copyPost(file: ReviewFile) {
    try { await navigator.clipboard.writeText(`${file.title}\n\n${file.quality.postCopy || ""}\n\n${file.quality.hashtags.join(" ")}`); setNotice("Title, post copy and hashtags copied."); }
    catch { setError("Clipboard unavailable. Expand Posting details below to select and copy the text."); }
  }

  async function shortcut() {
    try {
      const response = await fetch("/api/review-files/shortcut", { method: "POST" });
      if (!response.ok) throw new Error("Could not create the Desktop shortcut.");
      setNotice("Review Files shortcut created on your Desktop.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not reach the local server."); }
  }

  // An older in-flight poll must not briefly bring a just-deleted card back.
  const visible = (trashOpen ? trash : files).filter(file => (trashOpen || !locallyTrashed.has(file.id)) && (filter === "all" || category(file) === filter) && `${file.title} ${file.quality.hashtags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const displayed = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const preview = !trashOpen && files.find(file => file.id === previewId);
  const undoFile = trash.find(file => file.id === undoId);

  return <section id="library" aria-label="Review library" className="mt-8 scroll-mt-5 rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#75834f]">Review library</p><h2 className="mt-1 text-2xl font-semibold">Your videos <span className="text-base font-normal text-[#687657]">· {files.length}</span></h2></div>
      <div className="flex flex-wrap gap-4 text-sm font-semibold"><button type="button" onClick={() => void shortcut()} className="inline-flex items-center gap-1"><FolderOpen className="h-4 w-4" />Desktop shortcut</button><button type="button" aria-pressed={trashOpen} onClick={() => { if (!trashOpen) void loadTrash(); setTrashOpen(value => !value); setPage(1); setPreviewId(null); }} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 ${trashOpen ? "bg-[#e8edd7]" : ""}`}><Trash2 className="h-4 w-4" />{trashOpen ? "Back to videos" : "Trash"}</button></div>
    </div>
    <p className="mt-2 text-sm text-[#687657]">Preview, edit, then post. Completed rendering still needs your visual and listening review.</p>
    {trashOpen ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Trash is recoverable. These files still use disk space; nothing here is permanently erased.</p> : null}
    <div className="mt-4 flex flex-wrap gap-3">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#bdc7a5] bg-white px-3"><Search className="h-4 w-4 shrink-0" /><input aria-label="Search videos" type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search titles or hashtags" className="w-full min-w-0 bg-transparent py-2.5 text-sm outline-none" /></label>
      <select aria-label="Video category" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} className="rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-sm"><option value="all">All video types</option>{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </div>
    {notice ? <div role="status" className="mt-3 rounded-lg bg-[#edf3de] p-3 text-sm">{notice} {undoFile ? <button type="button" disabled={busy !== null} onClick={() => void move(undoFile, true)} className="ml-2 font-bold underline">Undo</button> : null}</div> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {!displayed.length ? <p className="mt-5 rounded-xl border border-dashed p-7 text-center text-sm text-[#687657]">{loading || trashLoading ? "Loading videos…" : query || filter !== "all" ? "No videos match these filters." : trashOpen ? "Trash is empty." : "No finished videos yet. Start a workflow above."}</p> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {displayed.map(file => {
        const output = file.outputs[reviewTarget(file)];
        const url = `/api/review-files/${file.id}/media?target=${reviewTarget(file)}`;
        return <article key={file.id} className="flex min-w-0 flex-col rounded-xl border border-[#d5ddbe] bg-[#fafbf3] p-3">
          {!trashOpen ? <Poster file={file} onPlay={() => setPreviewId(file.id)} /> : null}
          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-[#687657]"><span>{categoryNames[category(file)]}</span><span>{seconds(output?.duration)} · {file.delivery?.aspect || file.processing?.format || "Original"}</span></div>
          <h3 className="mt-2 text-base font-semibold leading-snug">{file.title}</h3>
          {file.series ? <p className="mt-1 text-xs text-[#687657]">Part {file.series.episodeNumber} of {file.series.episodeCount}</p> : null}
          <p className="mt-2 text-xs text-[#a06b29]">{file.monetizationReview?.status === "NEEDS_CHANGES" ? "Needs changes" : file.monetizationReview?.status === "CHECKED" ? "Manual checklist checked" : "Needs your review"}{file.audience.startsWith("kids") ? " · Made for kids" : ""}</p>
          {!trashOpen ? <>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-bold"><Link href={`/dashboard/edit/${file.id}`} className="rounded-lg bg-[#394a2a] px-3 py-2 text-white">Edit video</Link><a href={url} download={`${file.title}.mp4`} className="underline">Download</a><button type="button" onClick={() => void copyPost(file)} className="underline">Copy post + tags</button></div>
            <details className="mt-3 border-t border-[#dbe1cc] pt-3 text-xs text-[#526044]"><summary className="cursor-pointer font-semibold">Posting details & quality notes</summary><div className="mt-3 space-y-3 leading-5">
              <p className="whitespace-pre-wrap">{file.quality.postCopy || file.title}</p><p className="break-words">{file.quality.hashtags.join(" ")}</p>
              <p>{file.quality.captions[0] || "No caption text recorded."}</p>
              {file.quality.storyboard?.length ? <div><p className="font-semibold">Narration-timed footage plan</p><ol className="mt-2 space-y-3">{file.quality.storyboard.map((shot, index) => <li key={index}><p className="font-medium">{shot.start.toFixed(1)}–{shot.end.toFixed(1)}s · {shot.query}</p><p>{shot.narration}</p>{shot.timing === "within-caption-estimate" ? <p className="text-amber-800">Timing estimated within a caption line.</p> : null}{shot.sourcePage ? <a href={shot.sourcePage} target="_blank" rel="noreferrer" className="underline">Original stock footage ↗</a> : null}</li>)}</ol></div> : file.quality.visualBrief?.length ? <div><p className="font-semibold">Legacy visual search brief · not timed to narration</p><ol className="list-inside list-decimal">{file.quality.visualBrief.map((term, index) => <li key={`${index}-${term}`}>{term}</li>)}</ol></div> : null}
              {file.processing ? <p>{file.processing.scoreKind === "script-checks" || file.source.filename.startsWith("local-cartoon-") ? "Text checks only—not animation or singing quality." : "Manager recommendation—not a prediction of views."} {file.processing.reason}</p> : null}
              {file.quality.visualSources?.map(source => <a key={source.providerMediaId} className="mr-2 inline-block underline" href={source.providerUrl} target="_blank" rel="noreferrer">Pixabay #{source.providerMediaId}</a>)}
              {file.quality.warning ? <p className="text-amber-800">{file.quality.warning}</p> : null}
              {file.delivery?.creationType === "children-song" && file.quality.audio === "local-narration-music" ? <p className="text-amber-800">Older speech-only song: narration is not singing. Use a sung recording for a new version.</p> : null}
              <p>{file.monetizationReview?.warning || "Review the full video and rights before posting. Earnings are not guaranteed."}</p>
              <Link href={`/dashboard/manager?review=${file.id}`} className="block font-bold underline">Rate this video / guide the manager</Link>
              <div className="flex flex-wrap gap-3"><a href="https://www.youtube.com/upload" target="_blank" rel="noreferrer" className="underline">YouTube upload ↗</a><a href="https://www.instagram.com/" target="_blank" rel="noreferrer" className="underline">Instagram ↗</a></div>
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
