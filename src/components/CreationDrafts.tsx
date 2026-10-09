"use client";
import { useRef, useState } from "react";
import type { CreationDraft } from "@/lib/creationDraftTypes";
import { Button } from "./ui/button";

export default function CreationDrafts({ drafts, onRefresh, onRequeued, failedOnly = false }: { drafts: CreationDraft[]; onRefresh: () => Promise<void>; onRequeued?: (draft: CreationDraft) => void; failedOnly?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function command(draft: CreationDraft, action: "retry" | "archive") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(draft.id); setError("");
    try {
      const response = await fetch("/api/creation-drafts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id, version: draft.version, action }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update job.");
      if (action === "retry") onRequeued?.(draft);
      await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Job update failed."); }
    finally { inFlight.current = false; setBusy(null); }
  }
  const pending = drafts.filter(draft => !["APPROVED", "ARCHIVED"].includes(draft.status));
  if (!pending.length) return null;
  return <section aria-label="Preparing videos" className="mt-5 rounded-2xl border border-[#d6dccb] bg-white p-5">
    <h2 className="text-lg font-semibold">{failedOnly ? "Preparation needs attention" : "Preparing videos"} <span className="text-sm font-normal text-[#657153]">· {pending.length}</span></h2>
    <p className="mt-1 text-sm text-[#657153]">{failedOnly ? "These saved jobs are stopped, not processing. Retry only when you want Phoenix to attempt them again." : "Phoenix prepares the story and footage, then renders automatically. No plan approval needed."}</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
    <div className="mt-4 space-y-3">{pending.map(draft => {
      const failed = draft.status === "FAILED";
      const active = ["PLANNING", "APPROVING"].includes(draft.status);
      return <article key={draft.id} className="rounded-xl border border-[#e2e5da] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{draft.input.topic}</h3><span className={`rounded-full px-3 py-1 text-xs font-semibold ${failed ? "bg-orange-50 text-red-800" : "bg-[#edf2e3] text-[#435432]"}`}>{failed ? "Failed" : draft.status === "APPROVING" ? "Starting render" : draft.status === "PLANNING" ? "Preparing" : "Queued"}</span></div>
        <p className="mt-1 text-xs text-[#657153]">{draft.input.duration}s · {draft.input.aspect}</p>
        <p role="status" className="mt-2 text-sm text-[#657153]">{draft.status === "READY" ? "Queued for automatic rendering" : draft.stage}</p>
        {draft.status === "QUEUED" && draft.nextAttemptAt && Number.isFinite(Date.parse(draft.nextAttemptAt)) ? <p className="mt-2 text-xs text-[#657153]">Next automatic check: <time dateTime={draft.nextAttemptAt}>{new Date(draft.nextAttemptAt).toLocaleString()}</time>. This is a retry time, not a guaranteed completion time. No need to click Generate again.</p> : null}
        {draft.status === "QUEUED" && /Groq|quota/.test(draft.stage) ? <p className="mt-2 text-xs text-[#657153]">While writing waits, <a className="underline" href="#create">Use stock footage</a> can still make a reel without an AI writer, subject to local rendering memory.</p> : null}
        {draft.error ? <details className="mt-2 text-sm text-red-800"><summary className="cursor-pointer">Why this job failed</summary><p className="mt-2 break-words">{draft.error.replace(/Edit this search or retry later\./g, "Retry to search again.")}</p></details> : null}
        {!active ? <div className="mt-3 flex gap-2">{failed ? <Button disabled={busy !== null} onClick={() => void command(draft, "retry")}>{busy === draft.id ? "Updating…" : "Retry job"}</Button> : null}<Button variant="outline" disabled={busy !== null} onClick={() => void command(draft, "archive")}>{draft.status === "QUEUED" || draft.status === "READY" ? "Cancel job" : "Remove from history"}</Button></div> : null}
      </article>;
    })}</div>
  </section>;
}
