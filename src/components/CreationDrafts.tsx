"use client";
import { useRef, useState } from "react";
import type { CreationDraft } from "@/lib/creationDraftTypes";
import { Button } from "./ui/button";
import JobProgress from "./JobProgress";

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
    {error ? <p role="alert" className="p-3 text-sm text-destructive">{error}</p> : null}
    {pending.map(draft => {
      const failed = draft.status === "FAILED";
      const active = ["PLANNING", "APPROVING"].includes(draft.status);
      const queued = ["QUEUED", "READY"].includes(draft.status);
      const dated = Number.isFinite(Date.parse(draft.createdAt));
      const illustrations = draft.scenes?.filter(scene => scene.illustration) || [];
      const references = draft.scenes?.filter(scene => scene.still).length || 0;
      return <article key={draft.id} data-job-row>
        <details className="min-w-0">
          <summary title="Show job details" data-job-summary>
            <span className="min-w-0">
              <span data-job-title>{draft.input.topic}</span>
              <span data-job-meta><time dateTime={dated ? draft.createdAt : undefined}>{dated ? new Date(draft.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable"}</time>
                {failed ? <span data-job-attention>Needs attention</span> : null}
              </span>
              {!failed ? <JobProgress label={`${draft.input.topic} progress`} status={draft.status} /> : null}
            </span>
          </summary>
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            <p>{draft.input.duration}s · {draft.input.aspect}</p>
            {illustrations.length ? <p>Original editorial illustration · {[...new Set(illustrations.map(scene => scene.illustration!.subject))].join(", ")}. Each illustration is labelled in the finished video.</p> : null}
            {references ? <p>{references} reference photo{references === 1 ? "" : "s"} · labelled in the finished video.</p> : null}
            <p role="status" className="text-sm">{draft.status === "READY" ? "Queued for automatic rendering" : draft.stage}</p>
            {draft.status === "QUEUED" && draft.nextAttemptAt && Number.isFinite(Date.parse(draft.nextAttemptAt)) ? <p>Next automatic check: <time dateTime={draft.nextAttemptAt}>{new Date(draft.nextAttemptAt).toLocaleString()}</time>.</p> : null}
            {draft.status === "QUEUED" && /Groq|quota/.test(draft.stage) ? <p>While writing waits, you can <a className="underline" href="#create">make a reel with stock footage</a>.</p> : null}
            {draft.error ? <div className="text-sm text-destructive"><p className="font-medium">Why this job failed</p><p className="mt-1 break-words">{draft.error.replace(/Edit this search or retry later\./g, "Retry to search again.")}</p></div> : null}
          </div>
        </details>
        <div data-job-actions>{failed ? <Button type="button" variant="ghost" size="sm" disabled={busy !== null} aria-label={`Retry failed job: ${draft.input.topic}`} title="Retry this failed job" onClick={() => void command(draft, "retry")}>{busy === draft.id ? "Updating…" : "Retry"}</Button> : null}<Button type="button" variant="ghost" size="sm" disabled={active || busy !== null} aria-label={`${queued ? "Cancel queued job and delete history" : "Delete job history"}: ${draft.input.topic}`} title={active ? "Available when preparation finishes" : queued ? "Cancel this queued job and remove its history; saved videos are kept" : "Remove history only; saved videos are kept"} onClick={() => void command(draft, "archive")}>{busy === draft.id ? "Updating…" : "Delete"}</Button></div>
      </article>;
    })}
  </>;
}
