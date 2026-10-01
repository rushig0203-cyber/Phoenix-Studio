"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import type { ReviewFile } from "@/lib/reviewFiles";
import PostingActions from "./PostingActions";

export function reviewTarget(file: ReviewFile) {
  if (file.delivery?.platform && file.outputs[file.delivery.platform]) return file.delivery.platform;
  return file.outputs.instagram ? "instagram" : "youtube";
}

export default function ReviewPlayer({ file, onClose }: { file: ReviewFile; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const url = `/api/review-files/${file.id}/media?target=${reviewTarget(file)}`;

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  useEffect(() => {
    const player = video.current;
    return () => {
      if (!player) return;
      player.pause();
      player.removeAttribute("src");
      player.load();
    };
  }, [attempt]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setPhase("slow"), 12_000);
    return () => window.clearTimeout(timer);
  }, [phase, attempt]);

  function failed() {
    const code = video.current?.error?.code;
    setPhase("error");
    setError(code === 3 || code === 4
      ? "This browser could not decode the video, or the saved file is unavailable. Try again, or download the MP4 and open it in your local player."
      : "The video connection was interrupted. Check that Phoenix is running, then try again.");
  }

  function retry() { setError(""); setPhase("loading"); setAttempt(value => value + 1); }

  return <dialog ref={dialog} aria-label={`Preview: ${file.title}`} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto w-[min(940px,94vw)] max-h-[94dvh] overflow-y-auto rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-0 text-[#26331f] shadow-2xl backdrop:bg-black/70">
    <div className="flex items-center justify-between gap-4 border-b border-[#dbe1cc] px-5 py-4">
      <h2 className="text-base font-semibold">{file.title}</h2>
      <button type="button" autoFocus onClick={onClose} aria-label="Close video preview" className="rounded-lg border p-2"><X className="h-5 w-5" /></button>
    </div>
    <div className="bg-[#182015]">
      <video key={attempt} ref={video} aria-label={`Video preview: ${file.title}`} controls autoPlay playsInline preload="metadata" src={`${url}&preview=${attempt}`} className="mx-auto h-[min(62dvh,620px)] w-full object-contain"
        onLoadedData={() => setPhase("ready")} onPlaying={() => setPhase("playing")} onWaiting={() => setPhase("loading")} onCanPlay={() => setPhase("ready")} onError={failed} />
    </div>
    <div className="space-y-3 p-5">
      {phase === "loading" ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading video…</p> : null}
      {phase === "slow" ? <p role="status" className="text-sm text-amber-800">Taking longer than expected. Try reloading the preview, or download the video below.</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
        <button type="button" onClick={retry} className="inline-flex items-center gap-1"><RefreshCw className="h-4 w-4" />Retry preview</button>
        <a href={url} download={`${file.title}.mp4`} className="underline">Download MP4</a>
        <Link href={`/dashboard/edit/${file.id}`} className="rounded-lg bg-[#394a2a] px-3 py-2 text-white">Edit video</Link>
      </div>
      <p className="text-xs text-[#687657]">One player at a time keeps your laptop responsive. If autoplay is blocked, press Play in the video controls.</p>
      <PostingActions file={file} />
    </div>
  </dialog>;
}
