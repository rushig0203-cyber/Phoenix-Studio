"use client";
import { useRef, useState } from "react";
import type { CreationDraft } from "@/lib/creationDraftTypes";
import { Button } from "./ui/button";

export default function CreationDrafts({ drafts, onRefresh, onRequeued }: { drafts: CreationDraft[]; onRefresh: () => Promise<void>; onRequeued?: (draft: CreationDraft) => void }) {
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
  return <>
    {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
    {pending.map(draft => {
      const failed = draft.status === "FAILED";
      const active = ["PLANNING", "APPROVING"].includes(draft.status);
      const queued = ["QUEUED", "READY"].includes(draft.status);
      const dated = Number.isFinite(Date.parse(draft.createdAt));
      return <article key={draft.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2.5">
        <details className="min-w-0">
          <summary title="Show job details" className="cursor-pointer rounded-md text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#394a2a]"><span className="font-medium break-words">{draft.input.topic}</span><span className="sr-only"> — {failed ? "Failed" : active ? "Preparing" : "Queued"}; job details</span><time dateTime={dated ? draft.createdAt : undefined} className="mt-0.5 block pl-4 text-xs text-[#687657]">{dated ? new Date(draft.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable"}</time></summary>
          <div className="mt-2 space-y-1 rounded-lg bg-[#f1f4e9] p-3 text-xs text-[#657153]">
        <p>{failed ? "Failed" : draft.status === "APPROVING" ? "Starting render" : draft.status === "PLANNING" ? "Preparing" : "Queued"}</p>
        <p className="mt-1 text-xs text-[#657153]">{draft.input.duration}s · {draft.input.aspect}</p>
        <p role="status" className="mt-2 text-sm text-[#657153]">{draft.status === "READY" ? "Queued for automatic rendering" : draft.stage}</p>
        {draft.status === "QUEUED" && draft.nextAttemptAt && Number.isFinite(Date.parse(draft.nextAttemptAt)) ? <p className="mt-2 text-xs text-[#657153]">Next automatic check: <time dateTime={draft.nextAttemptAt}>{new Date(draft.nextAttemptAt).toLocaleString()}</time>. This is a retry time, not a guaranteed completion time. No need to click Generate again.</p> : null}
        {draft.status === "QUEUED" && /Groq|quota/.test(draft.stage) ? <p className="mt-2 text-xs text-[#657153]">While writing waits, <a className="underline" href="#create">Use stock footage</a> can still make a reel without an AI writer, subject to local rendering memory.</p> : null}
        {draft.error ? <details className="mt-2 text-sm text-red-800"><summary className="cursor-pointer">Why this job failed</summary><p className="mt-2 break-words">{draft.error.replace(/Edit this search or retry later\./g, "Retry to search again.")}</p></details> : null}
          </div>
        </details>
        <div className="flex items-center gap-1 pt-0.5">{failed ? <Button type="button" variant="ghost" size="sm" disabled={busy !== null} aria-label={`Recover failed job: ${draft.input.topic}`} title="Retry this failed job" onClick={() => void command(draft, "retry")}>{busy === draft.id ? "Updating…" : "Recover"}</Button> : null}<Button type="button" variant="ghost" size="sm" disabled={active || busy !== null} aria-label={`${queued ? "Cancel queued job and delete history" : "Delete job history"}: ${draft.input.topic}`} title={active ? "Available when preparation finishes" : queued ? "Cancel this queued job and remove its history; saved videos are kept" : "Remove history only; saved videos are kept"} onClick={() => void command(draft, "archive")}>{busy === draft.id ? "Updating…" : "Delete"}</Button></div>
      </article>;
    })}
  </>;
}
