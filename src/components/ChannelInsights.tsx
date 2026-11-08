"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelStatus } from "@/lib/channelConnections";
import type { ReviewFile } from "@/lib/reviewFiles";
import InstagramPerformance from "./InstagramPerformance";

type Platform = "instagram" | "facebook" | "youtube" | "rumble" | "bilibili";
type FacebookResults = {
  status: "not_connected" | "permission_required" | "ready" | "limited" | "error" | "rate_limited" | "syncing";
  detail: string;
  account?: { name: string };
  lastSuccessfulSyncAt?: string;
  videos: Array<{ id: string; caption: string; timestamp: string; permalink?: string; metrics: { views: number | null; likes: number | null; comments: number | null; shares: number | null } }>;
};
const platforms = [
  { id: "instagram", name: "Instagram" }, { id: "facebook", name: "Facebook" }, { id: "youtube", name: "YouTube" },
  { id: "rumble", name: "Rumble" }, { id: "bilibili", name: "Bilibili" },
] as const;
const external = {
  youtube: { name: "YouTube", href: "https://studio.youtube.com/", link: "Open YouTube Studio", detail: "YouTube analytics are not collected in Phoenix yet. Use your channel's Studio for its measured results." },
  rumble: { name: "Rumble", href: "https://rumble.com/", link: "Open Rumble", detail: "Manual analytics · Phoenix has no verified Rumble statistics connection. Check your creator dashboard on Rumble." },
  bilibili: { name: "Bilibili", href: "https://www.bilibili.tv/", link: "Open Bilibili", detail: "Manual analytics · Phoenix has no verified Bilibili statistics connection. Check your Creator Center on Bilibili." },
};
const button = "rounded-lg border border-[#bfcaa6] px-3 py-2 text-xs font-medium disabled:opacity-50";
const metric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : "—";
const dateLabel = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not yet";
function facebookLink(value?: string) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "web.facebook.com"].includes(url.hostname) || url.username || url.password) return;
    if (/^\/(?:reel\/\d+|\d+(?:\/videos\/\d+)?)\/?$/.test(url.pathname)) return `${url.origin}${url.pathname}`;
    const video = url.searchParams.get("v");
    if (/^\/watch\/?$/.test(url.pathname) && video && /^\d+$/.test(video)) return `${url.origin}${url.pathname}?v=${video}`;
  } catch { /* Untrusted links stay plain text. */ }
}

export default function ChannelInsights({ review, requestedReviewId }: { review?: ReviewFile; requestedReviewId?: string } = {}) {
  const publications = review?.publication?.status === "POSTED" ? review.publication.postedTo : [];
  const preferredPlatform = publications.find(item => item.platform === "instagram")?.platform || publications[0]?.platform || "instagram";
  const [platform, setPlatform] = useState<Platform>(preferredPlatform);
  const [channels, setChannels] = useState<ChannelStatus[] | null>(null);
  const [channelError, setChannelError] = useState("");
  const [facebook, setFacebook] = useState<FacebookResults | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { if (requestedReviewId && review?.id === requestedReviewId) setPlatform(preferredPlatform); }, [requestedReviewId, review?.id, preferredPlatform]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/channels", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data?.channels)) throw new Error("Channel status could not load. Check Your channels below.");
        if (!controller.signal.aborted) setChannels(data.channels);
      } catch { if (!controller.signal.aborted) setChannelError("Channel status could not load. Check Your channels below."); }
    })();
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); request.current = null; };
  }, []);
  const loadFacebook = useCallback(async (refresh = false) => {
    if (!mounted.current || request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const timeout = setTimeout(() => controller.abort(), refresh ? 120_000 : 15_000);
    try {
      const response = await fetch("/api/facebook-performance", { cache: "no-store", signal: controller.signal,
        ...(refresh ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Facebook insights could not refresh. Saved results remain available.");
      if (!data || !Array.isArray(data.videos) || typeof data.detail !== "string") throw new Error("Facebook returned unreadable results. Saved results remain available.");
      if (!mounted.current || controller.signal.aborted) return;
      setFacebook(data); setError(""); setPage(current => Math.min(current, Math.max(0, Math.ceil(data.videos.length / 5) - 1)));
    } catch (cause) { if (mounted.current && request.current === controller) setError(controller.signal.aborted ? "The insights request timed out. Saved results remain available; try again." : cause instanceof Error ? cause.message : "Facebook insights are unavailable."); }
    finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; if (mounted.current) setBusy(false); } }
  }, []);
  useEffect(() => { if (platform === "facebook") void loadFacebook(); }, [platform, loadFacebook]);
  const channel = channels?.find(item => item.platform === platform);
  const manual = platform === "youtube" || platform === "rumble" || platform === "bilibili" ? external[platform] : null;
  const focusedVideoId = publications.find(item => item.platform === platform)?.remoteId;
  const focusUnavailable = !!requestedReviewId && (!review || !focusedVideoId);
  const videos = facebook ? [...facebook.videos].filter(video => !requestedReviewId || video.id === focusedVideoId).sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)) : [];
  const total = (name: "views" | "likes") => {
    const values = videos.map(video => video.metrics[name]).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  return <section id="channel-insights" aria-label="Channel insights" className="space-y-5">
    {requestedReviewId && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#c4cfb5] bg-[#fffdf7] p-4"><div><p className="text-xs text-[#687657]">Selected video</p><h2 className="mt-1 font-semibold">{review?.title || "Video unavailable in the current Library"}</h2></div><a href="#insights" className={button}>All videos</a></div>}
    <div role="group" aria-label="Insight platforms" className="flex flex-wrap gap-2">{platforms.map(item => <button key={item.id} type="button" aria-pressed={platform === item.id} onClick={() => { setPlatform(item.id); setPage(0); }} className={`${button} ${platform === item.id ? "bg-[#394a2a] text-white" : "text-[#687657]"}`}>{item.name}</button>)}</div>
    <div className="rounded-2xl border border-[#c4cfb5] bg-[#fffdf7] p-4 sm:p-6">
      {focusUnavailable && (platform === "instagram" || platform === "facebook") ? <div className="space-y-3 text-sm"><p>No confirmed {platform === "instagram" ? "Instagram" : "Facebook"} post is linked to this saved video. Other videos&apos; results are not substituted.</p><a href="#insights" className="inline-block font-medium underline">View all channel results</a></div> : platform === "instagram" ? <InstagramPerformance videoId={requestedReviewId ? focusedVideoId : undefined} /> : platform === "facebook" ? <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{facebook?.account?.name || channel?.name || "Facebook Page"}</p><p className="mt-1 text-xs text-[#687657]">Basic video statistics · Last measured batch: {dateLabel(facebook?.lastSuccessfulSyncAt)}</p></div><button type="button" className={button} disabled={busy} onClick={() => void loadFacebook(true)}>{busy ? "Checking…" : "Refresh insights"}</button></div>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        {facebook ? <>
          {facebook.lastSuccessfulSyncAt && <dl aria-label="Saved Facebook sample" className="grid grid-cols-3 gap-3">{([["Videos", videos.length], ["Views", total("views")], ["Likes", total("likes")]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-[#edf1e5] p-4"><dt className="text-xs text-[#687657]">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{metric(value)}</dd></div>)}</dl>}
          <p role="status" className="text-xs text-[#687657]">{facebook.detail}</p>
          {requestedReviewId && !videos.length && <p className="text-sm">This post is not in the saved Facebook sample yet. Refresh to check the latest available Page Reels; no count is assumed.</p>}
          <div className="divide-y divide-[#45594d]">{videos.slice(page * 5, (page + 1) * 5).map(video => { const title = (video.caption || "Facebook video").slice(0, 100), link = facebookLink(video.permalink); return <details key={video.id} data-facebook-result open={requestedReviewId ? true : undefined} className="py-2"><summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-xs"><span className="min-w-0 flex-1 font-medium"><span className="line-clamp-2">{title}</span><span className="mt-1 block font-normal text-[#687657]">{dateLabel(video.timestamp)}</span></span><span className="shrink-0 text-[#687657]">{metric(video.metrics.views)} views · {metric(video.metrics.likes)} likes</span></summary><div className="mt-2 space-y-2 text-xs text-[#687657]"><p>Comments: {metric(video.metrics.comments)} · Shares: {metric(video.metrics.shares)}</p>{link && <a href={link} target="_blank" rel="noopener noreferrer" className="underline">Open Facebook video</a>}</div></details>; })}</div>
          {videos.length > 5 && <nav aria-label="Facebook results pages" className="flex items-center justify-between gap-2 text-xs"><button type="button" className={button} disabled={!page} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(videos.length / 5)}</span><button type="button" className={button} disabled={(page + 1) * 5 >= videos.length} onClick={() => setPage(value => value + 1)}>Next</button></nav>}
          <p className="text-xs text-[#687657]">Saved sample only. Missing metrics are unavailable, not zero. Reach and watch time are not collected here.</p>
        </> : !error && <p className="text-xs text-[#687657]">{busy ? "Loading saved Facebook results…" : "No saved Facebook results available."}</p>}
        <a href="https://business.facebook.com/" target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-medium underline">Open Meta Business Suite ↗</a>
      </div> : manual && <div className="space-y-3 text-xs">
        <p className="text-sm font-medium">{channel?.name || manual.name}</p>
        {platform === "youtube" && <p className="text-[#687657]">{channels ? channel?.publishReady ? "Connected for publishing" : channel?.connected ? "Account connected; upload permission still needed" : "Not connected to Phoenix" : channelError || "Checking connection…"}</p>}
        <p className="text-[#687657]">{manual.detail}</p>
        {platform === "youtube" && !channel?.connected && <a href="#channels" className="mr-4 inline-block font-medium underline">Set up YouTube</a>}
        <a href={manual.href} target="_blank" rel="noopener noreferrer" className="inline-block font-medium underline">{manual.link} ↗</a>
      </div>}
    </div>
  </section>;
}
