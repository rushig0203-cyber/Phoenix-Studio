"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { FeedbackDecision, FeedbackDimension, QualityAssessment, QualityManagerState } from "@/lib/managerTypes";
import { FEEDBACK_REQUESTS, FEEDBACK_REQUEST_LABELS, type FeedbackRequest } from "@/lib/managerTypes";

const field = "mt-1 w-full rounded-lg border border-[#bfcaa6] bg-white p-2 text-sm";
const button = "rounded-lg bg-[#394a2a] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-[#bfcaa6] px-3 py-2 text-sm disabled:opacity-50";
const labels: Record<QualityAssessment["decision"], string> = { BLOCKED: "Needs a fix", REVISE: "Revise before posting", AWAITING_REVIEW: "Not reviewed yet", OWNER_APPROVED: "Approved by you" };
const pageSize = 6;
const dateLabel = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "";

export default function QualityManager({ initialReviewId }: { initialReviewId?: string }) {
  const [data, setData] = useState<QualityManagerState | null>(null), [selected, setSelected] = useState(initialReviewId || ""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [page, setPage] = useState(0);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/manager/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Manager unavailable.");
      setData(value); setPage(current => Math.min(current, Math.max(0, Math.ceil(value.assessments.length / pageSize) - 1))); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Manager unavailable."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const assessment = data?.assessments.find(item => item.reviewId === selected) || data?.assessments[0];
  return <main className="min-h-screen bg-[#f4f0e7] px-5 py-6 text-[#1e2719]"><div className="mx-auto max-w-3xl">
    <Link href="/dashboard" className="text-sm font-semibold underline">← Back to studio</Link>
    <div className="mt-5 flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Quality manager</h1><button className={secondary} disabled={busy} onClick={() => void load()}>{busy ? "Checking…" : "Refresh"}</button></div>
    <p className="mt-2 text-sm text-[#687657]">Review a finished video. Saved choices guide new matching work; they do not retrain a model or change an existing export.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {data && <>
      <p className="mt-3 text-xs text-[#687657]">{data.guidance.feedbackCount} reviewed · {data.queued} queued · {data.running} running · {data.failed} failed</p>
      <section className="mt-4 rounded-xl border border-[#d5ddb8] bg-[#fffdf7] p-4">
        <h2 className="text-sm font-semibold">Videos · newest first</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{data.assessments.slice(page * pageSize, (page + 1) * pageSize).map(item => <button key={item.reviewId} type="button" aria-pressed={assessment?.reviewId === item.reviewId} className={`rounded-lg border p-2 text-left text-sm ${assessment?.reviewId === item.reviewId ? "border-[#394a2a] bg-[#edf1e5]" : "border-[#d5ddb8]"}`} onClick={() => setSelected(item.reviewId)}><span className="block truncate font-medium">{item.title}</span><span className="mt-1 block text-xs text-[#687657]">{dateLabel(item.createdAt)} · {labels[item.decision]}</span></button>)}</div>
        {data.assessments.length > pageSize && <nav aria-label="Review pages" className="mt-3 flex items-center justify-between gap-2 text-xs"><button className={secondary} disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}>Previous</button><span>Page {page + 1} of {Math.ceil(data.assessments.length / pageSize)}</span><button className={secondary} disabled={(page + 1) * pageSize >= data.assessments.length} onClick={() => setPage(current => current + 1)}>Next</button></nav>}
      </section>
      {assessment ? <section className="mt-4 rounded-xl border border-[#d5ddb8] bg-[#fffdf7] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-semibold">{assessment.title}</h2><span className="text-xs text-[#687657]">{labels[assessment.decision]}</span></div>
        {assessment.blockers.map(message => <p key={message} role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{message}</p>)}
        <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold"><Link className="underline" href={`/dashboard/edit/${assessment.reviewId}`}>Watch / edit</Link><a className="underline" href={`/api/review-files/${assessment.reviewId}/media`} target="_blank" rel="noreferrer">Open MP4</a></div>
        <FeedbackForm key={assessment.reviewId} assessment={assessment} onSaved={load} />
        <details className="mt-4 border-t border-[#d5ddb8] pt-3 text-xs"><summary className="cursor-pointer font-medium">Quality checks</summary><ul className="mt-2 list-disc space-y-1 pl-4">{assessment.checks.map(check => <li key={check}>{check}</li>)}</ul></details>
      </section> : <p className="mt-4 text-sm">Create a video first. Finished files will appear here.</p>}
      <details className="mt-4 rounded-xl border border-[#d5ddb8] bg-[#fffdf7] p-4 text-xs"><summary className="cursor-pointer font-medium">Saved guidance &amp; production limits</summary>
        <p className="mt-2 leading-5">{data.capabilities.learning}</p>
        {data.guidance.rules.length ? <ul className="mt-2 list-disc space-y-1 pl-4">{data.guidance.rules.map(rule => <li key={rule}>{rule}</li>)}</ul> : <p className="mt-2">No improvement priorities saved yet.</p>}
        <p className="mt-2">Caption ratings guide posting copy for new matching work and shorter subtitle groups for 2D exports. Narrated stock subtitle grouping is unchanged. Notes are saved for reference, never used as commands.</p>
        <p className="mt-2">Automatic singing is not installed: song videos need your sung recording and lyrics. {data.capabilities.animation}. Watch and listen; these checks do not prove professional animation, good singing or future views.</p>
        <p className="mt-2 text-[#687657]">Guidance revision: {data.guidance.revision}. No paid service or automatic posting.</p>
      </details>
    </>}
  </div></main>;
}

function FeedbackForm({ assessment, onSaved }: { assessment: QualityAssessment; onSaved: () => Promise<void> }) {
  const [ratings, setRatings] = useState(assessment.feedback?.ratings || { story: 3, visuals: 3, audio: 3, captions: 3 }), [decision, setDecision] = useState<FeedbackDecision>(assessment.feedback?.decision || "revise"), [note, setNote] = useState(assessment.feedback?.note || ""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [requests, setRequests] = useState<FeedbackRequest[]>(assessment.feedback?.requests || []);
  const choices = assessment.creationType === "source" ? FEEDBACK_REQUESTS.filter(request => request === "less-repetition" || request === "matching-visuals") : FEEDBACK_REQUESTS;
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/manager/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: assessment.reviewId, ratings, decision, note, requests }), signal: AbortSignal.timeout(10_000) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not save feedback.");
      setNotice("Saved. New matching work uses these choices; existing videos stay unchanged."); await onSaved();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not save feedback."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="mt-4 border-t border-[#d5ddb8] pt-3">
    <h3 className="text-sm font-semibold">Improve the next video</h3>
    <div className="mt-2 flex flex-wrap gap-2">{choices.map(request => <button key={request} type="button" disabled={busy} aria-pressed={requests.includes(request)} className={`${secondary} ${requests.includes(request) ? "bg-[#edf1e5]" : ""}`} onClick={() => setRequests(current => current.includes(request) ? current.filter(value => value !== request) : [...current, request])}>{FEEDBACK_REQUEST_LABELS[request]}</button>)}</div>
    <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Ratings &amp; optional note</summary><p className="mt-2">1–2 requests improvement · 3 acceptable draft · 5 strong. Re-rating replaces this video's earlier review.</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">{(["story", "visuals", "audio", "captions"] as FeedbackDimension[]).map(dimension => <label key={dimension} className="capitalize">{dimension === "captions" ? "Captions / copy" : dimension === "story" && assessment.creationType === "source" ? "Flow" : dimension}<select className={field} disabled={busy} value={ratings[dimension]} onChange={event => setRatings({ ...ratings, [dimension]: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
      <label className="mt-3 block">Note for your reference<textarea className={field} rows={2} disabled={busy} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="Optional; not an automatic instruction." /></label>
    </details>
    <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" className={secondary} disabled={busy} aria-pressed={decision === "revise"} onClick={() => setDecision("revise")}>Needs revision</button><button type="button" className={secondary} disabled={busy} aria-pressed={decision === "keep"} onClick={() => setDecision("keep")}>Keep — reviewed</button><button className={button} disabled={busy}>{busy ? "Saving…" : "Save feedback"}</button></div>
    {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
  </form>;
}
