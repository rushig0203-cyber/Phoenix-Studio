"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstagramPerformanceAssessment, InstagramPerformanceResponse } from "@/lib/instagramPerformanceTypes";

const pageSize = 5;
const secondary = "rounded-lg border border-border px-3 py-2 text-xs font-medium disabled:opacity-50";
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
const ratioLabel = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${Math.round(value * 100)}%` : "—";

function instagramLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) || url.username || url.password || !/^\/(?:reel|p|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return undefined;
    return `${url.origin}${url.pathname}`;
  } catch { return undefined; }
}

export default function InstagramPerformance({ videoId }: { videoId?: string } = {}) {
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

  const videos = data ? [...data.videos].filter(video => !videoId || video.id === videoId).sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)) : [];
  const assessments = new Map(data?.summary.assessments.map(item => [item.videoId, item]));
  const measuredTotal = (name: "views" | "likes" | "comments" | "saves" | "shares") => {
    const available = videos.map(video => video.metrics[name]).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    return available.length ? available.reduce((total, value) => total + value, 0) : null;
  };
  const measuredCount = (name: "views" | "likes") => videos.filter(video => typeof video.metrics[name] === "number" && Number.isFinite(video.metrics[name]) && video.metrics[name]! >= 0).length;
  const attention = data?.summary.attentionDiagnostic;
  const cohorts = Array.isArray(data?.summary.attentionCohorts) ? data.summary.attentionCohorts.slice(0, 16) : [];
  return <section aria-label="Instagram insights" className="space-y-4 text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-semibold">{data?.account?.name || "Instagram"}</h2><p role="status" className="mt-1 text-sm font-medium">{busy ? "Checking results…" : data ? statusLabels[data.status] : "No results loaded"}</p><p className="mt-1 text-xs text-muted-foreground">Last measured batch: {dateLabel(data?.lastSuccessfulBatchAt || data?.lastSuccessfulSyncAt)}</p></div>
      <button type="button" className={secondary} disabled={busy} onClick={() => void load(true)}>{busy ? "Checking…" : "Refresh insights"}</button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {data && <>
      {(data.lastSuccessfulBatchAt || data.lastSuccessfulSyncAt || videos.length > 0) && <dl aria-label="Saved Instagram sample" className="grid grid-cols-3 gap-3">
        {([["Videos", videos.length, undefined], ["Views", measuredTotal("views"), "views"], ["Likes", measuredTotal("likes"), "likes"]] as const).map(([label, value, key]) => <div key={label} className="rounded-xl bg-muted p-4"><dt className="text-xs text-muted-foreground">{label}<span className="mt-1 block text-[0.65rem]">{key ? `${measuredCount(key)} of ${videos.length} measured` : "Saved video sample"}</span></dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{metric(value)}</dd></div>)}
      </dl>}
      <p className="text-xs text-muted-foreground">Totals include measured counts only. A dash means unavailable; 0 is a measured zero.</p>
      <p className="text-xs text-muted-foreground">Comments: {metric(measuredTotal("comments"))} · Saves: {metric(measuredTotal("saves"))} · Shares: {metric(measuredTotal("shares"))}</p>
      <p className={`text-sm ${["error", "permission_required"].includes(data.status) ? "text-destructive" : "text-muted-foreground"}`}>{data.detail}</p>
      {data.status === "permission_required" && <p className="text-xs"><a href="/dashboard#settings" className="font-medium underline">Reconnect Instagram in Settings</a> with <code>instagram_manage_insights</code> while keeping your existing publishing permissions.</p>}
      {data.status === "not_connected" && <a href="/dashboard#settings" className="inline-block text-xs font-medium underline">Connect Instagram in Settings</a>}
      {!videoId && <details aria-label="Watch-time insights" className="space-y-2 rounded-xl bg-muted p-3 text-xs">
        <summary className="cursor-pointer font-medium">Watch diagnosis</summary>
        {attention ? <p>{metric(attention.belowHalfCount)} of {metric(attention.measuredCount)} measured, locally matched Reels averaged below half their runtime. Median average watch: {watchLabel(attention.medianWatchSeconds * 1000)} · Runtime: {watchLabel(attention.medianRuntimeSeconds * 1000)} · Watch/runtime ratio: {ratioLabel(attention.medianWatchRatio)}.</p>
          : <p>Fresh, mature matched Reels with comparable exposure, measured watch time and known runtime are needed for this diagnosis.</p>}
        <p className="text-muted-foreground">Average watch/runtime is not a completion rate or a measured drop-off curve.</p>
        <p>New footage reels choose their pacing from the available shots and sampled movement.</p>
        {cohorts.length ? <div className="space-y-2 border-t border-border pt-2">{cohorts.map(cohort => <div key={`${cohort.recipe}/${cohort.ageBand}/${cohort.exposureMeasure}`}>
          <p>{cohort.recipe === "focus-four-v1" ? "Focused version" : "Montage control"} · {metric(cohort.videoCount)} Reels · {cohort.ageBand} · {cohort.exposureMeasure === "reach" ? "reached accounts" : "views"}{cohort.comparable ? " · Both recipes have at least 3 in this band" : " · Waiting for at least 3 of each recipe in this band"}</p>
          <p className="text-muted-foreground">Median watch: {watchLabel(cohort.attention ? cohort.attention.medianWatchSeconds * 1000 : undefined)} · Runtime: {watchLabel(cohort.attention ? cohort.attention.medianRuntimeSeconds * 1000 : undefined)} · Ratio: {ratioLabel(cohort.attention?.medianWatchRatio)} ({metric(cohort.attention?.measuredCount)} measured). Comments / saves / shares per 100: {(["comments", "saves", "shares"] as const).map(name => `${metric(cohort.rates[name].medianPer100)} (${metric(cohort.rates[name].measuredCount)} measured)`).join(" / ")}.</p>
        </div>)}<p className="text-muted-foreground">Past recipe comparisons need at least three of each version at similar ages with the same reach or view measure.</p></div> : null}
      </details>}
      {videos.length ? <div className="divide-y divide-border">
        {videos.slice(page * pageSize, (page + 1) * pageSize).map(video => {
          const assessment = assessments.get(video.id), link = instagramLink(video.permalink);
          const title = (video.topic || video.caption || "Untitled Instagram video").slice(0, 100);
          return <details key={video.id} data-instagram-result open={videoId ? true : undefined} className="py-2">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 font-medium"><span className="line-clamp-2">{title}</span><span className="mt-1 block font-normal text-muted-foreground">{dateLabel(video.timestamp)}</span></span>
              <span className="shrink-0 text-muted-foreground"><span className="tabular-nums">{metric(video.metrics.views)}</span> views · <span className="tabular-nums">{metric(video.metrics.likes)}</span> likes</span>
            </summary>
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p className="font-medium">{assessment ? labels[assessment.label] : "Not compared"}</p>
              <p>{assessment?.reason || "This video is outside the current comparison set. Its available saved counts are shown separately."}</p>
              <p>Comments: {metric(video.metrics.comments)} · Saves: {metric(video.metrics.saves)} · Shares: {metric(video.metrics.shares)} · Reach: {metric(video.metrics.reach)}</p>
              <p>Average watch time: {watchLabel(video.metrics.averageWatchTimeMs)} · Metrics checked: {dateLabel(video.metricsUpdatedAt)}</p>
              {video.metricIssues?.map(issue => <p key={issue}>{issue}</p>)}
              {link && <a href={link} target="_blank" rel="noreferrer" className="inline-block font-medium underline">{title}</a>}
            </div>
          </details>;
        })}
      </div> : <p className="text-sm">{videoId ? "This post has no saved Instagram results yet. Refresh to collect its available counts; other videos are not substituted." : "No posted video results collected yet."}</p>}
      {videos.length > pageSize && <nav aria-label="Instagram results pages" className="flex items-center justify-between gap-2 text-xs"><button type="button" className={secondary} disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}>Previous</button><span>Page {page + 1} of {Math.ceil(videos.length / pageSize)}</span><button type="button" className={secondary} disabled={(page + 1) * pageSize >= videos.length} onClick={() => setPage(current => current + 1)}>Next</button></nav>}
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
        <details className="min-w-0 text-xs"><summary className="cursor-pointer font-medium">What the manager learned</summary>
          <p className="mt-2">Guides new suggestions and plans, not existing videos. Comparisons use your account&apos;s available evidence; they do not prove why a video worked or guarantee growth.</p>
          {data.summary.rules.length ? <ul className="mt-2 list-disc space-y-1 pl-4">{data.summary.rules.map(rule => <li key={rule}>{rule}</li>)}</ul> : <p className="mt-2">Not enough comparable results for a reliable content preference yet.</p>}
          <p className="mt-2 text-muted-foreground">{data.summary.eligibleCount} videos eligible for comparison.</p>
        </details>
        <details className="min-w-0 text-xs text-muted-foreground"><summary className="cursor-pointer">Collection details</summary>
          <p className="mt-2">Totals cover saved videos with available counts. Missing metrics mean unavailable, not zero.</p>
          <p className="mt-1">{data.historyComplete ? "Available account video history scanned." : data.status === "syncing" ? `${data.scannedVideos} videos scanned; older available history is still being collected.` : `${data.scannedVideos} videos saved; available history is not fully collected yet.`}</p>
          {!data.historyComplete && data.lastSuccessfulBatchAt && <p className="mt-1">Guidance uses the current comparable sample. Older history is still incomplete; this is not a ranking of the whole account.</p>}
          {data.nextSyncAt && <p className="mt-1">Next automatic check: {dateLabel(data.nextSyncAt)}. Phoenix checks when its manager is running.</p>}
        </details>
      </div>
    </>}
  </section>;
}
