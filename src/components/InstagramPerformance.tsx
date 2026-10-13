"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstagramPerformanceAssessment, InstagramPerformanceResponse } from "@/lib/instagramPerformanceTypes";

const pageSize = 8;
const secondary = "rounded-lg border border-[#bfcaa6] px-3 py-2 text-xs font-medium disabled:opacity-50";
const labels: Record<InstagramPerformanceAssessment["label"], string> = {
  stronger: "Stronger response", weaker: "Weaker response", typical: "Typical response",
  too_early: "Too early to compare", insufficient_data: "Limited evidence", unavailable: "Not compared",
};
const statusLabels: Record<InstagramPerformanceResponse["status"], string> = {
  not_connected: "Not connected", permission_required: "Insights permission needed", syncing: "Collecting results",
  ready: "Results saved", limited: "Some metrics unavailable", error: "Sync needs attention", rate_limited: "Waiting for Meta quota",
};
const metric = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : "—";
const dateLabel = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not yet";
const watchLabel = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${(value / 1000).toFixed(1)}s` : "—";

function instagramLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) || url.username || url.password || !/^\/(?:reel|p|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return undefined;
    return `${url.origin}${url.pathname}`;
  } catch { return undefined; }
}

export default function InstagramPerformance() {
  const [data, setData] = useState<InstagramPerformanceResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const lastRead = useRef(0);

  const load = useCallback(async (refresh = false) => {
    if (!mounted.current || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    lastRead.current = Date.now();
    setBusy(true);
    const timeout = setTimeout(() => controller.abort(), refresh ? 120_000 : 15_000);
    try {
      const response = await fetch("/api/instagram-performance", {
        cache: "no-store", signal: controller.signal,
        ...(refresh ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) } : {}),
      });
      const value = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "Instagram results could not refresh. Saved results remain available.");
      if (!value || !Array.isArray(value.videos) || !Array.isArray(value.summary?.assessments) || !Array.isArray(value.summary?.rules)) throw new Error("Instagram returned unreadable results. Saved results remain available.");
      if (!mounted.current || controller.signal.aborted) return;
      setData(value);
      setPage(current => Math.min(current, Math.max(0, Math.ceil(value.videos.length / pageSize) - 1)));
      setError("");
    } catch (cause) {
      if (mounted.current && request.current === controller) setError(controller.signal.aborted ? refresh
        ? "The refresh is taking longer. Collection can continue in the manager; saved results remain available. Check again without reposting a video."
        : "The results request timed out. Saved results remain available; try again." : cause instanceof Error ? cause.message : "Instagram results are unavailable. Try again.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const poll = () => { if (!document.hidden && Date.now() - lastRead.current >= 60_000) void load(); };
    const timer = setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  const videos = data ? [...data.videos].sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)) : [];
  const assessments = new Map(data?.summary.assessments.map(item => [item.videoId, item]));
  return <details className="rounded-xl border border-[#d5ddb8] bg-[#fffdf7] p-4 text-[#1e2719]">
    <summary className="cursor-pointer text-sm font-semibold">Instagram results{data ? ` · ${data.videos.length} videos` : ""}<span className="ml-2 text-xs font-normal text-[#687657]">{data ? statusLabels[data.status] : busy ? "Loading…" : "Unavailable"}</span></summary>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-[#687657]">{data?.account?.name || "Your connected Instagram account"} · Last successful sync: {dateLabel(data?.lastSuccessfulSyncAt)}</p>
      <button type="button" className={secondary} disabled={busy} onClick={() => void load(true)}>{busy ? "Checking…" : "Refresh insights"}</button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    {data && <>
      <p role="status" className={`mt-2 text-xs ${["error", "permission_required"].includes(data.status) ? "text-red-700" : "text-[#687657]"}`}>{data.detail}</p>
      {data.status === "permission_required" && <p className="mt-2 text-xs"><a href="/dashboard#settings" className="font-medium underline">Reconnect Instagram in Settings</a> with <code>instagram_manage_insights</code> while keeping your existing publishing permissions.</p>}
      {data.status === "not_connected" && <a href="/dashboard#settings" className="mt-2 inline-block text-xs font-medium underline">Connect Instagram in Settings</a>}
      {data.nextSyncAt && <p className="mt-2 text-xs text-[#687657]">Next automatic check: {dateLabel(data.nextSyncAt)}. Phoenix checks when its manager is running.</p>}
      <p className="mt-2 text-xs text-[#687657]">{data.historyComplete ? "Available account video history scanned." : data.status === "syncing" ? `${data.scannedVideos} videos scanned; older available history is still being collected.` : `${data.scannedVideos} videos saved; available history is not fully collected yet.`} Missing metrics mean unavailable, not zero.</p>
      {videos.length ? <>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
          <caption className="sr-only">Posted Instagram video results, newest first</caption>
          <thead><tr className="border-b border-[#d5ddb8] text-[#687657]"><th scope="col" className="min-w-48 py-2 pr-3">Video</th><th scope="col" className="px-2 py-2">Views</th><th scope="col" className="px-2 py-2">Likes</th><th scope="col" className="px-2 py-2">Response</th></tr></thead>
          <tbody>{videos.slice(page * pageSize, (page + 1) * pageSize).map(video => {
            const assessment = assessments.get(video.id), link = instagramLink(video.permalink);
            const title = (video.topic || video.caption || "Untitled Instagram video").slice(0, 100);
            return <tr key={video.id} className="border-b border-[#e5e8d8] align-top">
              <th scope="row" className="py-3 pr-3 font-normal"><span className="block font-medium">{link ? <a href={link} target="_blank" rel="noreferrer" className="underline">{title}</a> : title}</span><span className="mt-1 block text-[#687657]">{dateLabel(video.timestamp)}</span></th>
              <td className="px-2 py-3 tabular-nums">{metric(video.metrics.views)}</td><td className="px-2 py-3 tabular-nums">{metric(video.metrics.likes)}</td>
              <td className="min-w-48 px-2 py-3"><span className="font-medium">{assessment ? labels[assessment.label] : "Not compared"}</span>
                <details className="mt-1 text-[#687657]"><summary className="cursor-pointer">Evidence</summary>
                  <p className="mt-1">{assessment?.reason || "This video is outside the current comparison set. Its available saved counts are shown separately."}</p>
                  <p className="mt-1">Comments: {metric(video.metrics.comments)} · Saves: {metric(video.metrics.saves)} · Shares: {metric(video.metrics.shares)} · Reach: {metric(video.metrics.reach)}</p>
                  <p className="mt-1">Average watch time: {watchLabel(video.metrics.averageWatchTimeMs)} · Metrics checked: {dateLabel(video.metricsUpdatedAt)}</p>
                  {video.metricIssues?.map(issue => <p key={issue} className="mt-1">{issue}</p>)}
                </details>
              </td>
            </tr>;
          })}</tbody>
        </table></div>
        {videos.length > pageSize && <nav aria-label="Instagram results pages" className="mt-3 flex items-center justify-between gap-2 text-xs"><button type="button" className={secondary} disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}>Previous</button><span>Page {page + 1} of {Math.ceil(videos.length / pageSize)}</span><button type="button" className={secondary} disabled={(page + 1) * pageSize >= videos.length} onClick={() => setPage(current => current + 1)}>Next</button></nav>}
      </> : <p className="mt-3 text-sm">No posted video results collected yet.</p>}
      <details className="mt-3 border-t border-[#d5ddb8] pt-3 text-xs"><summary className="cursor-pointer font-medium">What the manager learned</summary>
        <p className="mt-2">Guides new suggestions and plans, not existing videos. Comparisons use your account&apos;s available evidence; they do not prove why a video worked or guarantee growth.</p>
        {data.summary.rules.length ? <ul className="mt-2 list-disc space-y-1 pl-4">{data.summary.rules.map(rule => <li key={rule}>{rule}</li>)}</ul> : <p className="mt-2">Not enough comparable results for a reliable content preference yet.</p>}
        <p className="mt-2 text-[#687657]">{data.summary.eligibleCount} videos eligible for comparison. No model runs on this laptop, and this feature does not publish anything.</p>
      </details>
    </>}
  </details>;
}
