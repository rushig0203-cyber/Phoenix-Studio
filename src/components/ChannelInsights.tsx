"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelStatus } from "@/lib/channelConnections";
import type { ReviewFile } from "@/lib/reviewFiles";
import InstagramPerformance from "./InstagramPerformance";
import PlatformIcon from "./PlatformIcon";
import StudioActivity from "./StudioActivity";

type Platform = "instagram" | "facebook" | "youtube" | "rumble" | "bilibili";
type MeasuredPlatform = "facebook" | "youtube";
type Results = {
  detail: string;
  account?: { name: string };
  lastSuccessfulSyncAt?: string;
  videos: Array<{ id: string; caption: string; timestamp: string; permalink?: string; metrics: { views: number | null; likes: number | null; comments: number | null; shares: number | null } }>;
};

const platforms = [
  { id: "instagram", name: "Instagram" }, { id: "facebook", name: "Facebook" }, { id: "youtube", name: "YouTube" },
  { id: "rumble", name: "Rumble" }, { id: "bilibili", name: "Bilibili" },
] as const;
const dashboards = {
  facebook: { name: "Facebook", href: "https://business.facebook.com/", link: "Open Meta Business Suite" },
  youtube: { name: "YouTube", href: "https://studio.youtube.com/", link: "Open YouTube Studio" },
  rumble: { name: "Rumble", href: "https://rumble.com/account/dashboard", link: "Open Rumble dashboard" },
  bilibili: { name: "Bilibili", href: "https://www.bilibili.tv/", link: "Open Bilibili" },
};
const button = "rounded-full border border-[#c3cdd1] px-3 py-2 text-sm font-medium disabled:opacity-50";
const metric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : "—";
const dateLabel = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not yet";
const measuredPlatform = (platform: Platform): platform is MeasuredPlatform => platform === "facebook" || platform === "youtube";

function videoLink(video: Results["videos"][number], platform: MeasuredPlatform) {
  if (platform === "youtube") return /^[A-Za-z0-9_-]{11}$/.test(video.id) ? "https://www.youtube.com/watch?v=" + video.id : undefined;
  if (!video.permalink) return;
  try {
    const url = new URL(video.permalink);
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "web.facebook.com"].includes(url.hostname) || url.username || url.password || url.port) return;
    if (/^\/(?:reel\/\d+|\d+(?:\/videos\/\d+)?)\/?$/.test(url.pathname)) return url.origin + url.pathname;
    const id = url.searchParams.get("v");
    if (/^\/watch\/?$/.test(url.pathname) && id && /^\d+$/.test(id)) return url.origin + url.pathname + "?v=" + id;
  } catch { /* Invalid links stay plain text. */ }
}

export default function ChannelInsights({ review, requestedReviewId }: { review?: ReviewFile; requestedReviewId?: string } = {}) {
  const publications = review?.publication?.status === "POSTED" ? review.publication.postedTo : [];
  const preferredPlatform = publications.find(item => item.platform === "instagram")?.platform || publications[0]?.platform || "instagram";
  const [platform, setPlatform] = useState<Platform>(preferredPlatform);
  const [channels, setChannels] = useState<ChannelStatus[] | null>(null);
  const [channelError, setChannelError] = useState(false);
  const [results, setResults] = useState<Partial<Record<MeasuredPlatform, Results>>>({});
  const [errors, setErrors] = useState<Partial<Record<MeasuredPlatform, string>>>({});
  const [busy, setBusy] = useState<Partial<Record<MeasuredPlatform, boolean>>>({});
  const [page, setPage] = useState(0);
  const mounted = useRef(false);
  const requests = useRef<Partial<Record<MeasuredPlatform, AbortController>>>({});

  useEffect(() => { if (requestedReviewId && review?.id === requestedReviewId) setPlatform(preferredPlatform); }, [requestedReviewId, review?.id, preferredPlatform]);
  useEffect(() => {
    mounted.current = true;
    const active = requests.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/channels", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data?.channels)) throw new Error("Invalid channel status");
        if (!controller.signal.aborted) setChannels(data.channels);
      } catch { if (!controller.signal.aborted) setChannelError(true); }
    })();
    return () => {
      mounted.current = false;
      controller.abort();
      for (const request of Object.values(active)) request.abort();
      requests.current = {};
    };
  }, []);

  const load = useCallback(async (target: MeasuredPlatform, refresh = false) => {
    if (!mounted.current || requests.current[target]) return;
    const controller = new AbortController();
    requests.current[target] = controller;
    setBusy(previous => ({ ...previous, [target]: true }));
    const timeout = setTimeout(() => controller.abort(), refresh ? 120_000 : 15_000);
    try {
      const reviewId = target === "youtube" ? requestedReviewId : undefined;
      const url = "/api/" + target + "-performance" + (reviewId ? "?reviewId=" + encodeURIComponent(reviewId) : "");
      const response = await fetch(url, { cache: "no-store", signal: controller.signal,
        ...(refresh ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Insights could not refresh. Saved results remain available.");
      if (!data || !Array.isArray(data.videos) || typeof data.detail !== "string") throw new Error("The results could not be read.");
      if (!mounted.current || controller.signal.aborted) return;
      setResults(previous => ({ ...previous, [target]: data }));
      setErrors(previous => ({ ...previous, [target]: "" }));
    } catch (cause) {
      if (mounted.current && requests.current[target] === controller) {
        const message = controller.signal.aborted ? "The request timed out. Try Refresh again." : cause instanceof Error ? cause.message : "Insights are unavailable.";
        setErrors(previous => ({ ...previous, [target]: message }));
      }
    } finally {
      clearTimeout(timeout);
      if (requests.current[target] === controller) {
        delete requests.current[target];
        if (mounted.current) setBusy(previous => ({ ...previous, [target]: false }));
      }
    }
  }, [requestedReviewId]);

  const focusedVideoId = publications.find(item => item.platform === platform)?.remoteId;
  const focusUnavailable = !!requestedReviewId && (!review || !focusedVideoId);
  useEffect(() => {
    if (!focusUnavailable && measuredPlatform(platform)) void load(platform);
  }, [platform, focusUnavailable, load]);

  const channel = channels?.find(item => item.platform === platform);
  const dashboard = platform !== "instagram" ? dashboards[platform] : null;
  const data = measuredPlatform(platform) ? results[platform] : undefined;
  const videos = (data?.videos || []).filter(video => !requestedReviewId || video.id === focusedVideoId)
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
  const pages = Math.ceil(videos.length / 5);
  const currentPage = Math.min(page, Math.max(0, pages - 1));
  const total = (name: "views" | "likes" | "comments") => {
    const values = videos.map(video => video.metrics[name]).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  return <section id="channel-insights" aria-label="Channel insights" className="space-y-5">
    {requestedReviewId && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c3cdd1] pb-3"><h2 className="font-semibold">{review?.title || "Selected video"}</h2><a href="#insights" className={button}>All videos</a></div>}
    <div role="group" aria-label="Insight platforms" className="flex flex-wrap gap-2">{platforms.map(item => <button key={item.id} type="button" aria-pressed={platform === item.id} onClick={() => { setPlatform(item.id); setPage(0); }} className={button + " inline-flex items-center gap-2 " + (platform === item.id ? "bg-[#31596c] text-white" : "bg-[#fffdf7] text-[#233e4b]")}><PlatformIcon platform={item.id} className="size-4" />{item.name}</button>)}</div>
    <div className="rounded-2xl border border-[#c3cdd1] bg-[#fffdf7] p-4 sm:p-6">
      {focusUnavailable && (platform === "instagram" || measuredPlatform(platform)) ? <div className="space-y-3 text-sm"><p>No confirmed {platform === "instagram" ? "Instagram" : dashboards[platform].name} post is linked to this saved video.</p><a href="#insights" className="inline-block font-medium underline">View all channel results</a></div>
      : platform === "instagram" ? <InstagramPerformance videoId={requestedReviewId ? focusedVideoId : undefined} />
      : measuredPlatform(platform) ? <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">{data?.account?.name || channel?.name || dashboards[platform].name}</h2>
            <p className="mt-1 text-xs text-[#465e69]">{data?.lastSuccessfulSyncAt ? "Last checked " + dateLabel(data.lastSuccessfulSyncAt) : platform === "youtube" && channels && !channel?.connected ? "Not connected to Phoenix" : "Video statistics"}</p>
          </div>
          <button type="button" className={button} disabled={busy[platform]} onClick={() => void load(platform, true)}>Refresh insights</button>
        </div>
        {busy[platform] && <StudioActivity label="Checking video statistics" />}
        {errors[platform] && <p role="alert" className="text-sm text-red-700">{errors[platform]}</p>}
        {data?.lastSuccessfulSyncAt && <dl aria-label={"Saved " + dashboards[platform].name + " sample"} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["Videos", videos.length], ["Views", total("views")], ["Likes", total("likes")], ["Comments", total("comments")]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-[#e6edef] p-3"><dt className="text-xs text-[#465e69]">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{metric(value)}</dd></div>)}
        </dl>}
        {data?.detail && <p role="status" className="text-xs text-[#465e69]">{data.detail}</p>}
        {!busy[platform] && !videos.length && requestedReviewId && <p className="text-sm">This post is not in the saved {dashboards[platform].name} sample yet. Use Refresh insights to check again.</p>}
        {videos.length > 0 && <div aria-label="Video results" className="divide-y divide-[#d4e0e3]">
          {videos.slice(currentPage * 5, (currentPage + 1) * 5).map(video => {
            const title = (video.caption || dashboards[platform].name + " video").slice(0, 100), link = videoLink(video, platform);
            return <details key={video.id} data-facebook-result={platform === "facebook" || undefined} data-youtube-result={platform === "youtube" || undefined} open={requestedReviewId ? true : undefined} className="py-3">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 font-medium"><span className="line-clamp-2">{title}</span><span className="mt-1 block text-xs font-normal text-[#465e69]">{dateLabel(video.timestamp)}</span></span>
                <span className="text-xs text-[#465e69]">{metric(video.metrics.views)} views · {metric(video.metrics.likes)} likes</span>
              </summary>
              <div className="mt-2 space-y-2 text-xs text-[#465e69]"><p>Comments: {metric(video.metrics.comments)}{platform === "facebook" && <> · Shares: {metric(video.metrics.shares)}</>}</p>{link && <a href={link} target="_blank" rel="noopener noreferrer" className="underline">Open {dashboards[platform].name} video</a>}</div>
            </details>;
          })}
        </div>}
        {pages > 1 && <nav aria-label={dashboards[platform].name + " results pages"} className="flex items-center justify-between gap-2 text-xs"><button type="button" className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pages}</span><button type="button" className={button} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <p className="text-[#465e69]">{channelError && !data ? "Channel status is unavailable." : "Counts are shown per platform. A dash means unavailable."}</p>
          <div className="flex flex-wrap gap-3">
            {platform === "youtube" && channels && !channel?.connected && <a href="#channels" className="font-medium underline">Set up YouTube</a>}
            <a href={dashboards[platform].href} target="_blank" rel="noopener noreferrer" className="font-medium underline">{dashboards[platform].link} ↗</a>
          </div>
        </div>
      </div> : dashboard && <div className="space-y-3">
        <h2 className="text-lg font-semibold">{dashboard.name}</h2>
        <p className="text-sm text-[#465e69]">Manual analytics. Phoenix has no verified {dashboard.name} statistics connection.</p>
        <a href={dashboard.href} target="_blank" rel="noopener noreferrer" className={button + " inline-block"}>{dashboard.link} ↗</a>
      </div>}
    </div>
    {!requestedReviewId && <p className="text-xs text-[#465e69]">Phoenix uses video feedback and comparable Instagram results to guide suggestions. Facebook and YouTube counts are for reporting.</p>}
  </section>;
}
