"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelPlatform, ChannelStatus } from "@/lib/channelConnections";
import type { ReviewFile } from "@/lib/reviewFiles";
import type { ReviewPublishJob, InstagramStoryCapability } from "@/lib/reviewPublishing";
import { postingDownload, postingText } from "@/lib/posting";
import { captionHashtags, INSTAGRAM_HASHTAG_LIMIT, youtubePostingTextIssue, YOUTUBE_DESCRIPTION_BYTE_LIMIT } from "@/lib/postingCopyPolicy";
import { instagramStoryIdeas } from "@/lib/instagramStoryIdeas";
import { instagramLocationSuggestions } from "@/lib/instagramLocationSuggestions";
import { instagramAudioId, instagramAudioPreviewUrl, publicInstagramAudioDiscovery } from "@/lib/instagramAudio";
import type { RecommendedInstagramAudio, ReelMusicRecommendation } from "@/lib/reelMusic";
import { automaticInstagramUserTags } from "@/lib/instagramTags";
import { openRumbleUpload, rumbleDashboardLink } from "@/lib/rumbleWindow";
import StudioActivity from "./StudioActivity";
import PlatformIcon from "./PlatformIcon";

const button = "inline-flex rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50";

const input = "mt-1 block w-full rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-sm";
const reviewPostingText = (file: ReviewFile, platform?: ChannelPlatform) => postingText(file.quality.postCopy?.trim() ? file : { ...file, title: "" }, platform);
const active = (job: ReviewPublishJob): boolean => ["QUEUED", "UPLOADING", "PROCESSING"].includes(job.status) || Boolean(job.companionStory && active(job.companionStory));
const matchedSoundtrack = (file: ReviewFile): boolean => file.quality.audio === "local-music-replaced" && Boolean(file.quality.musicRecording
  && (file.quality.musicRecording.timing === "onset-v1" || file.quality.musicRecording.style === "quiet-instrumental" || file.editedFrom));
const footageMusic = (file: ReviewFile): boolean => ((file.source?.kind && file.source.kind !== "upload") || Boolean(file.quality.visualSources?.length))
  && ["natural-audio-preserved", "local-music-replaced", "no-audio", "needs-review"].includes(file.quality.audio) && !matchedSoundtrack(file);
const musicText = (value: unknown, limit = 200): value is string => typeof value === "string" && value.length <= limit
  && Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
function publicMusicRecommendation(value: unknown): ReelMusicRecommendation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = value as Partial<ReelMusicRecommendation>;
  if (summary.preference !== "english-and-instrumental" || !["sampled-frames", "saved-observations"].includes(summary.basis || "")
      || !["calm", "warm", "reflective", "uplifting", "energetic", "playful", "uncertain"].includes(summary.mood || "")
      || !["low", "medium", "high", "unknown"].includes(summary.energy || "") || !musicText(summary.reason)) return null;
  return { preference: summary.preference, basis: summary.basis!, mood: summary.mood!, energy: summary.energy!, reason: summary.reason.trim() };
}
function publicTrackRecommendation(value: unknown): RecommendedInstagramAudio["recommendation"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const recommendation = value as NonNullable<RecommendedInstagramAudio["recommendation"]>;
  if (!Number.isInteger(recommendation.rank) || recommendation.rank < 1 || recommendation.rank > 6
      || !["english-vocal", "instrumental"].includes(recommendation.kind) || !musicText(recommendation.reason)) return undefined;
  const discovery = publicInstagramAudioDiscovery(recommendation.discovery);
  return { rank: recommendation.rank, kind: recommendation.kind, reason: recommendation.reason.trim(), ...(discovery ? { discovery } : {}) };
}

type PublishPanelRequest = { platform: ChannelPlatform; mode: "reel" | "story" };
type Destination = ChannelPlatform | "story" | "rumble";
const statusLabel = { QUEUED: "Queued", UPLOADING: "Uploading", PROCESSING: "Processing", COMPLETE: "Done", FAILED: "Failed", NEEDS_CHECK: "Needs check" } as const;

function PlatformProgress({ destination, label, job, selected, busy, locked, onClick }: {
  destination: Destination; label: string; job?: ReviewPublishJob; selected: boolean; busy?: boolean; locked?: boolean; onClick: () => void;
}) {
  const measured = job?.status === "UPLOADING" && Number.isFinite(job.totalBytes) && job.totalBytes > 0 && Number.isFinite(job.bytesUploaded);
  const percent = measured ? Math.floor(Math.min(100, Math.max(0, 100 * job.bytesUploaded / job.totalBytes))) : undefined;
  const ring = job?.status === "COMPLETE" ? 100 : percent;
  const state = busy ? "Saving…" : job ? statusLabel[job.status] : undefined;
  const status = state && percent !== undefined ? `${state} · ${percent}%` : state;
  const shortStatus = percent !== undefined ? `${percent}%`
    : state === "Processing" ? "Working" : state === "Needs check" ? "Check" : state;
  return <button type="button" data-posting-platform={destination} aria-label={label} aria-description={status} aria-pressed={selected} disabled={busy || locked} onClick={onClick}
    className="posting-platform inline-flex min-h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-full border py-1 text-xs sm:w-auto sm:flex-row sm:gap-2 sm:px-2 sm:text-left">
    <span aria-hidden="true" className="posting-ring grid size-8 shrink-0 place-items-center rounded-full"
      style={ring === undefined ? undefined : { background: `conic-gradient(var(--posting-color) ${ring}%, var(--border) 0)` }}>
      <span className="grid size-6 place-items-center rounded-full bg-card"><PlatformIcon platform={destination === "story" ? "instagram" : destination} className="size-4" /></span>
    </span>
    <span>
      <span className={destination === "story" && !status ? "block text-[0.6rem] font-semibold sm:text-xs" : "hidden font-semibold sm:block"}>{label}</span>
      {status && <span className="block text-center text-[0.6rem] leading-tight sm:text-left sm:text-[0.7rem]" aria-live="polite">
        {percent !== undefined ? <><span className="hidden sm:inline">{state} · </span>{percent}%</>
          : shortStatus !== state ? <><span className="sm:hidden">{shortStatus}</span><span className="hidden sm:inline">{state}</span></>
          : state}
      </span>}
    </span>
  </button>;
}

function instagramStoryJob(jobs: ReviewPublishJob[]) {
  return jobs.find(job => job.platform === "instagram" && job.kind === "story")
    || jobs.find(job => job.platform === "instagram" && job.companionStory)?.companionStory;
}

/** Opening/checking these panels never uploads. The final Post action does. */
export default function ReviewPublishActions({ file, finalReview = false }: { file: ReviewFile; finalReview?: boolean }) {
  const [chooserOpen, setChooserOpen] = useState(finalReview);
  const postButton = useRef<HTMLButtonElement>(null);
  const [youtube, setYoutube] = useState<PublishPanelRequest | null>(null);
  const [instagram, setInstagram] = useState<PublishPanelRequest | null>(null);
  const [facebook, setFacebook] = useState<PublishPanelRequest | null>(null);
  const [selected, setSelected] = useState<Destination | null>(null);
  const [jobs, setJobs] = useState<ReviewPublishJob[]>([]);
  const [progressError, setProgressError] = useState("");
  const jobRead = useRef(0);
  const committedRead = useRef(0);
  const endpoint = `/api/review-files/${encodeURIComponent(file.id)}/publish`;
  const readJobs = useCallback(async (abort: AbortSignal) => {
    const version = ++jobRead.current;
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([abort, AbortSignal.timeout(15000)]) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.jobs)) throw new Error(data.error || "Could not check upload status.");
    if (!abort.aborted && version > committedRead.current) {
      committedRead.current = version;
      setJobs(data.jobs);
      setProgressError("");
    }
    return data.jobs as ReviewPublishJob[];
  }, [endpoint]);
  const polling = chooserOpen && jobs.some(active);
  useEffect(() => {
    if (!polling) return;
    const abort = new AbortController();
    let pending = false;
    const interval = setInterval(() => {
      if (pending || document.hidden) return;
      pending = true;
      void readJobs(abort.signal)
        .catch(() => { if (!abort.signal.aborted) setProgressError("Could not refresh posting status. Checking again…"); })
        .finally(() => { pending = false; });
    }, 5000);
    return () => { clearInterval(interval); abort.abort(); };
  }, [polling, readJobs]);

  function accepted(job: ReviewPublishJob) {
    // A read started before this approval must not erase the accepted request.
    committedRead.current = ++jobRead.current;
    setJobs(current => job.kind === "story" && !job.standaloneStory
      ? current.map(item => item.platform === "instagram" && !item.kind ? { ...item, companionStory: job } : item)
      : [...current.filter(item => item.id !== job.id && !(item.platform === job.platform && item.kind === job.kind))
        .map(item => job.standaloneStory && item.companionStory?.id === job.id
          ? { ...item, companionStory: undefined, companionStoryApproved: undefined, companionStoryDetached: true } : item), job]);
  }
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const [instagramBusy, setInstagramBusy] = useState(false);
  const [facebookBusy, setFacebookBusy] = useState(false);
  const postingBusy = youtubeBusy || instagramBusy || facebookBusy;
  const [rumbleOpen, setRumbleOpen] = useState(false);
  const [rumbleNotice, setRumbleNotice] = useState("");
  const rumbleEpoch = useRef(0);
  const rumblePreparing = useRef(false);
  const [rumbleBusy, setRumbleBusy] = useState(false);
  const [choosingDestination, setChoosingDestination] = useState(finalReview);
  const destinationChosen = useRef(false);
  useEffect(() => {
    if (!finalReview) return;
    const abort = new AbortController();
    const preferred = file.delivery?.platform === "youtube" || file.delivery?.platform === "instagram"
      ? file.delivery.platform : file.outputs.instagram ? "instagram" : "youtube";
    setChoosingDestination(true);
    void fetch("/api/channels", { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error("Could not check saved destinations.");
        const ready = (data.channels as ChannelStatus[]).filter(item => item.publishReady && postingDownload(file, item.platform));
        return ready.find(item => item.platform === preferred)?.platform
          || ready.find(item => item.platform === "instagram")?.platform
          || ready.find(item => item.platform === "youtube")?.platform
          || ready.find(item => item.platform === "facebook")?.platform || preferred;
      }).catch(() => preferred).then(destination => {
        if (abort.signal.aborted || destinationChosen.current) return;
        if (destination === "facebook") setFacebook({ platform: destination, mode: "reel" });
        else if (destination === "youtube") setYoutube({ platform: destination, mode: "reel" });
        else setInstagram({ platform: destination, mode: "reel" });
        setSelected(destination);
      }).finally(() => { if (!abort.signal.aborted) setChoosingDestination(false); });
    return () => abort.abort();
  }, [file.id, finalReview]);
  const videoRevision = JSON.stringify([file.id, file.status, file.trashedAt, file.updatedAt, file.outputs]);
  const latestVideoRevision = useRef(videoRevision);
  useEffect(() => {
    rumbleEpoch.current++; setRumbleNotice(""); rumblePreparing.current = false; setRumbleBusy(false);
    latestVideoRevision.current = videoRevision;
  }, [videoRevision]);
  useEffect(() => () => { rumbleEpoch.current++; }, [file.id]);
  const chooserId = `review-publish-${encodeURIComponent(file.id)}`;
  const rumbleOutput = rumbleOpen ? postingDownload(file) : null;
  function open(platform: ChannelPlatform, mode: "reel" | "story" = "reel") {
    destinationChosen.current = true;
    setSelected(mode === "story" ? "story" : platform);
    const update = (current: PublishPanelRequest | null) => current?.platform === platform && current.mode === mode ? current : { platform, mode };
    if (platform === "facebook") setFacebook(update);
    else if (platform === "youtube") setYoutube(update);
    else setInstagram(update);
  }
  function close() {
    postButton.current?.focus();
    rumbleEpoch.current++; rumblePreparing.current = false; setRumbleBusy(false);
    committedRead.current = ++jobRead.current;
    setChooserOpen(false); setRumbleOpen(false); setYoutube(null); setInstagram(null); setFacebook(null);
    setSelected(null); setJobs([]); setProgressError("");
  }
  async function copyRumbleText(value: string, label: string) {
    const version = rumbleEpoch.current, revision = videoRevision;
    try {
      await navigator.clipboard.writeText(value);
      if (rumbleEpoch.current === version && latestVideoRevision.current === revision) setRumbleNotice(`${label} copied. Paste it on Rumble; nothing has been uploaded.`);
      return true;
    } catch {
      if (rumbleEpoch.current === version && latestVideoRevision.current === revision) setRumbleNotice("Clipboard unavailable. Select and copy the Rumble text below.");
      return false;
    }
  }
  async function prepareRumble() {
    if (rumblePreparing.current) return;
    const saved = postingDownload(file);
    if (!saved) { setRumbleNotice("No finished video is available. Check Library before uploading."); return; }
    rumblePreparing.current = true; setRumbleBusy(true);
    const version = rumbleEpoch.current, revision = videoRevision;
    // shortcut: Rumble publishing access is unverified; hand off to its normal
    // upload page until a supported free API or written permission is available.
    // Start clipboard access while Phoenix still has focus. Opening a new tab
    // first can make the browser reject an otherwise permitted clipboard write.
    const copying = copyRumbleText(postingText(file), "Rumble description and hashtags");
    if (!openRumbleUpload()) {
      rumbleEpoch.current++;
      rumblePreparing.current = false; setRumbleBusy(false);
      setRumbleNotice("The browser blocked the Rumble window. Allow popups for Phoenix or open Rumble below. No video was uploaded.");
      return;
    }
    try {
      const response = await fetch(`/api/review-files/${encodeURIComponent(file.id)}/reveal?target=${saved.target}`, { method: "POST", signal: AbortSignal.timeout(15000) });
      const value = await response.json(), copied = await copying;
      if (!response.ok || value.revealed !== true) throw new Error(value.error || "The saved video could not be shown. Use Download MP4 below.");
      if (rumbleEpoch.current === version && latestVideoRevision.current === revision) setRumbleNotice(`Saved video opened in File Explorer. Drag it onto Rumble, then confirm there. ${copied ? "Description and hashtags copied; paste them on Rumble." : "Clipboard unavailable; copy the text below."} No duplicate download or upload was created.`);
    } catch (cause) {
      await copying;
      if (rumbleEpoch.current === version && latestVideoRevision.current === revision) setRumbleNotice(cause instanceof Error ? cause.message : "The saved video could not be shown. Use Download MP4 below.");
    } finally {
      if (rumbleEpoch.current === version && latestVideoRevision.current === revision) { rumblePreparing.current = false; setRumbleBusy(false); }
    }
  }
  return <>
    {!finalReview && <button ref={postButton} type="button" className={button} disabled={postingBusy} aria-expanded={chooserOpen} aria-controls={chooserId} onClick={() => chooserOpen ? close() : setChooserOpen(true)}>Post / export</button>}
    <section id={chooserId} data-posting-panel aria-label="Post or export this video" hidden={!chooserOpen} className="min-w-0 basis-full space-y-3 rounded-xl border border-[#bdc7a5] bg-[#fffdf7] p-3 text-[#26331f]">
      {chooserOpen && <>
      <div className="flex items-center justify-between gap-2"><h5 className="font-semibold">Post video</h5>{!finalReview && <button type="button" className={button} onClick={close} disabled={postingBusy}>Close</button>}</div>
      <div role="group" data-posting-status-strip className="sticky top-0 z-10 flex flex-wrap gap-1.5 bg-card py-2 sm:gap-2" aria-label="Choose a platform">
        <PlatformProgress destination="youtube" label={finalReview ? "YouTube" : "Upload to YouTube"} selected={selected === "youtube"} busy={youtubeBusy} job={jobs.find(job => job.platform === "youtube")} onClick={() => open("youtube")} />
        <PlatformProgress destination="instagram" label={finalReview ? "Instagram" : "Post to Instagram"} selected={selected === "instagram"} busy={instagramBusy && instagram?.mode === "reel"} locked={instagramBusy} job={jobs.find(job => job.platform === "instagram" && !job.kind)} onClick={() => open("instagram")} />
        <PlatformProgress destination="facebook" label={finalReview ? "Facebook Page" : "Post to Facebook Page"} selected={selected === "facebook"} busy={facebookBusy} job={jobs.find(job => job.platform === "facebook")} onClick={() => open("facebook")} />
        <PlatformProgress destination="story" label={finalReview ? "Story only" : "Post Story only"} selected={selected === "story"} busy={instagramBusy && instagram?.mode === "story"} locked={instagramBusy} job={instagramStoryJob(jobs)} onClick={() => open("instagram", "story")} />
        <PlatformProgress destination="rumble" label={finalReview ? "Rumble · assisted" : "Rumble upload"} selected={rumbleOpen} onClick={() => { setRumbleOpen(true); setRumbleNotice(""); }} />
      </div>
      {progressError && <p role="status" className="text-xs">{progressError}</p>}
      {choosingDestination && !youtube && !instagram && !facebook && <StudioActivity label="Checking destination…" />}
      {!choosingDestination && !youtube && !instagram && !facebook && !rumbleOpen && <p className="text-xs">Choose a destination.</p>}
      <div data-posting-destinations>
      {instagram && <ReviewPublishPlatformPanel key="instagram" file={file} request={instagram} visible={selected === "instagram" || selected === "story"} jobs={jobs} readJobs={readJobs} onAccepted={accepted} onBusyChange={setInstagramBusy} />}
      {facebook && <ReviewPublishPlatformPanel key="facebook" file={file} request={facebook} visible={selected === "facebook"} jobs={jobs} readJobs={readJobs} onAccepted={accepted} onBusyChange={setFacebookBusy} />}
      {youtube && <ReviewPublishPlatformPanel key="youtube" file={file} request={youtube} visible={selected === "youtube"} jobs={jobs} readJobs={readJobs} onAccepted={accepted} onBusyChange={setYoutubeBusy} />}
      {rumbleOpen && <section data-posting-destination aria-label="Rumble assisted upload" className="space-y-3 border-t border-[#bdc7a5] py-3 text-xs">
        <h6 className="font-semibold">Rumble · assisted upload</h6>
        <p>Drag the saved MP4 onto Rumble, paste the text and confirm there. Automatic publishing is not connected.</p>
        <div className="flex flex-wrap gap-2">
          {rumbleOutput ? <button type="button" className={button} disabled={rumbleBusy} onClick={() => void prepareRumble()}>{rumbleBusy ? <StudioActivity label="Opening saved video…" /> : "Open Rumble & show saved video ↗"}</button> : <p role="alert">No finished video is available. Check the saved output in Library.</p>}
          <a {...rumbleDashboardLink} className={button}>Open Rumble dashboard ↗</a>
        </div>
        {!file.quality.postCopy?.trim() && <p role="status">No analyzed posting caption is saved yet. The text below is a draft; review it before posting.</p>}
        <label className="block">Rumble title<input className={input} readOnly value={file.title.slice(0, 100)} /></label>
        <button type="button" className={button} onClick={() => void copyRumbleText(file.title.slice(0, 100), "Rumble title")}>Copy title</button>
        <details><summary className="cursor-pointer">Description, hashtags & download options</summary>
          <p>Reuses the Rumble tab opened by Phoenix without resetting an unfinished upload. Separately opened browser tabs cannot be detected.</p>
          <p>Uses the saved video and audio; Instagram catalogue music is not included. Confirm your destination account on Rumble.</p>
          <label className="mt-2 block">Rumble description and hashtags<textarea className={`${input} min-h-24`} readOnly value={postingText(file)} /></label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => void copyRumbleText(postingText(file), "Rumble description and hashtags")}>Copy Rumble text</button>
            {rumbleOutput && <a href={rumbleOutput.url} download={`${file.title}-${rumbleOutput.target}.mp4`} className={button}>Download MP4</a>}
            <button type="button" className={button} onClick={() => { if (!openRumbleUpload()) setRumbleNotice("The browser blocked the Rumble window. Allow popups for Phoenix or open Rumble manually."); }}>Open Rumble ↗</button>
          </div>
        </details>
        {rumbleNotice && <p role="status">{rumbleNotice}</p>}
      </section>}
      </div>
      </>}
    </section>
  </>;
}

function ReviewPublishPlatformPanel({ file, request, visible, jobs, readJobs, onAccepted, onBusyChange }: {
  file: ReviewFile; request: PublishPanelRequest; visible: boolean; jobs: ReviewPublishJob[];
  readJobs: (signal: AbortSignal) => Promise<ReviewPublishJob[]>; onAccepted: (job: ReviewPublishJob) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [platform, setPlatform] = useState<ChannelPlatform | null>(null);
  const [instagramMode, setInstagramMode] = useState<"reel" | "story">("reel");
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusyState] = useState(false);
  function setBusy(value: boolean) { setBusyState(value); onBusyChange(value); }
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setupChecked, setSetupChecked] = useState(false);
  const [viewEpoch, setViewEpoch] = useState(0);
  const [title, setTitle] = useState(file.title.slice(0, 100));
  const [caption, setCaption] = useState(reviewPostingText(file));
  const [captionEdited, setCaptionEdited] = useState(false);
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("public");
  const [madeForKids, setMadeForKids] = useState(file.audience.startsWith("kids"));
  const videoRevision = JSON.stringify([file.id, file.status, file.trashedAt, file.updatedAt, file.outputs]);
  const latestVideoRevision = useRef(videoRevision);
  const [confirmedRevision, setConfirmedRevision] = useState("");
  useEffect(() => {
    latestVideoRevision.current = videoRevision; setConfirmedRevision("");
    audioEpoch.current++; audioRequest.current?.abort();
    setAudioBusy(false); setSelectedAudio(null); setAudioCheckedRevision("");
  }, [videoRevision]);
  const confirmed = confirmedRevision === videoRevision;
  function setConfirmed(value: boolean) { setConfirmedRevision(value ? videoRevision : ""); }
  const [postingDefaultsBusy, setPostingDefaultsBusy] = useState(false);
  const [savingPostingDefaults, setSavingPostingDefaults] = useState(false);
  const [postingDefaultsReason, setPostingDefaultsReason] = useState("");
  const [storyCapability, setStoryCapability] = useState<InstagramStoryCapability | null>(null);
  const [includeStory, setIncludeStory] = useState(false);
  const [businessConfirmed, setBusinessConfirmed] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedLocation, setSelectedLocation] = useState<{ id: string; name: string } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState("");
  const locationRequest = useRef<AbortController | null>(null);
  const locationEpoch = useRef(0);
  const [audioRecommendation, setAudioRecommendation] = useState<ReelMusicRecommendation | null>(null);
  const [selectedAudio, setSelectedAudio] = useState<RecommendedInstagramAudio | null>(null);
  const [audioCheckedRevision, setAudioCheckedRevision] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState("");
  const audioRequest = useRef<AbortController | null>(null);
  const audioEpoch = useRef(0);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const endpoint = `/api/review-files/${encodeURIComponent(file.id)}/publish`;

  useEffect(() => () => { epoch.current++; controller.current?.abort(); locationEpoch.current++; locationRequest.current?.abort(); audioEpoch.current++; audioRequest.current?.abort(); }, [file.id]);

  useEffect(() => { void open(request.platform, request.mode); }, [request]);

  async function open(next: ChannelPlatform, mode: "reel" | "story" = "reel") {
    if (busy) return;
    const version = ++epoch.current;
    setViewEpoch(version);
    controller.current?.abort();
    changeLocationQuery(""); resetAudio();
    const preferInstagramMusic = next === "instagram" && mode === "reel" && footageMusic(file);
    const abort = new AbortController(); controller.current = abort;
    setPlatform(next); setInstagramMode(next === "instagram" ? mode : "reel"); setConfirmed(false); setPostingDefaultsBusy(false); setLoading(true); setError(""); setNotice(""); setSetupChecked(false);
    setCaptionEdited(false);
    setTitle(file.title.slice(0, 100)); setCaption(reviewPostingText(file, next));
    setMadeForKids(file.audience.startsWith("kids"));
    setStoryCapability(null); setBusinessConfirmed(false);
    try {
      const [currentChannels, savedJobs] = await Promise.all([
        fetch("/api/channels", { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) })
          .then(async response => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not check uploading setup.");
            return data.channels as ChannelStatus[];
          }),
        readJobs(abort.signal),
      ]);
      if (epoch.current !== version || abort.signal.aborted) return;
      setChannels(currentChannels); setSetupChecked(true); setLoading(false);
      const rejected = next === "instagram" && mode === "reel" && savedJobs.find(job => job.platform === "instagram" && job.canRevise === true && typeof job.caption === "string");
      if (rejected) { setCaption(rejected.caption!); setConfirmed(false); }
      const destination = currentChannels.find(item => item.platform === "instagram");
      const newInstagramPost = next === "instagram" && mode === "reel" && destination?.publishReady && destination.connectionRevision && !savedJobs.some(item => item.platform === "instagram" && !item.kind);
      if (next === "instagram" && mode === "story" && destination?.publishReady && destination.connectionRevision) {
        await loadStoryCapability(destination, version, abort);
      }
      if (newInstagramPost && destination) {
        // Independent read-only checks start together. Eligible video-based
        // music and saved posting defaults still need final posting approval.
        await Promise.all([
          loadPostingDefaults(destination, version, abort),
          preferInstagramMusic ? loadAudio(destination, version) : Promise.resolve(),
          loadStoryCapability(destination, version, abort),
        ]);
      }
    } catch (cause) { if (epoch.current === version && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not check uploading setup."); }
    finally { if (epoch.current === version) setLoading(false); }
  }
  async function loadStoryCapability(destination: ChannelStatus, version: number, abort: AbortController) {
    try {
      const response = await fetch(`${endpoint}?check=story&connectionRevision=${encodeURIComponent(destination.connectionRevision!)}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error("Story capability could not be checked.");
      if (epoch.current === version && !abort.signal.aborted) { setStoryCapability(data.story); setConfirmed(false); }
    } catch { if (epoch.current === version && !abort.signal.aborted) setStoryCapability({ ready: false, reason: "Story capability could not be verified. You can post this Reel normally and add a Story manually." }); }
  }
  async function loadPostingDefaults(destination: ChannelStatus, version: number, abort: AbortController) {
    const locationSerial = locationEpoch.current;
    setPostingDefaultsBusy(true);
    try {
      const response = await fetch(`${endpoint}?check=posting-defaults&connectionRevision=${encodeURIComponent(destination.connectionRevision!)}`, {
        cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]),
      });
      const payload: unknown = await response.json();
      const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      if (!response.ok) throw new Error(musicText(data.error, 600) ? data.error : "Saved posting location could not be checked. You can choose a location below.");
      if (epoch.current !== version || abort.signal.aborted || !data.defaults || typeof data.defaults !== "object" || Array.isArray(data.defaults)) return;
      const defaults = data.defaults as { location?: unknown; locationQuery?: unknown; locationReason?: unknown };
      if (locationEpoch.current === locationSerial) {
        const location = defaults.location && typeof defaults.location === "object" && !Array.isArray(defaults.location)
          ? defaults.location as { id?: unknown; name?: unknown } : null;
        const validLocation = location && typeof location.id === "string" && location.id.length > 0 && location.id.length <= 40 && !/[^0-9]/.test(location.id) && musicText(location.name)
          ? { id: location.id, name: location.name.trim() } : null;
        const query = musicText(defaults.locationQuery) && defaults.locationQuery.length <= 100 ? defaults.locationQuery.trim() : "";
        setSelectedLocation(validLocation); setLocationQuery(query || validLocation?.name || "");
        setPostingDefaultsReason(musicText(defaults.locationReason, 600) ? defaults.locationReason.trim() : "");
        setConfirmed(false);
      }
    } catch (cause) {
      if (epoch.current === version && !abort.signal.aborted && locationEpoch.current === locationSerial) setPostingDefaultsReason(cause instanceof Error ? cause.message : "Saved posting location could not be checked. Choose a location below.");
    } finally { if (epoch.current === version && !abort.signal.aborted) setPostingDefaultsBusy(false); }
  }
  function changeLocationQuery(query: string) {
    locationEpoch.current++; locationRequest.current?.abort();
    setLocationQuery(query); setLocations([]); setSelectedLocation(null); setLocationError(""); setPostingDefaultsReason(""); setLocationBusy(false); setConfirmed(false);
  }
  async function searchLocations() {
    const destination = channels.find(item => item.platform === "instagram");
    const query = locationQuery.trim();
    if (platform !== "instagram" || busy || locationBusy || !setupChecked || !destination?.publishReady || !destination.connectionRevision) return;
    if (!query || query.length > 100 || (query.length < 2 && !/^\d+$/.test(query))) {
      setLocationError("Enter a place name or an eligible Facebook location Page ID."); return;
    }
    const version = epoch.current, serial = ++locationEpoch.current;
    locationRequest.current?.abort();
    const abort = new AbortController(); locationRequest.current = abort;
    setLocationBusy(true); setLocations([]); setSelectedLocation(null); setLocationError(""); setPostingDefaultsReason(""); setConfirmed(false);
    try {
      const response = await fetch(`${endpoint}?check=location&q=${encodeURIComponent(query)}&connectionRevision=${encodeURIComponent(destination.connectionRevision)}`, {
        cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Meta location lookup is unavailable. You can add a location manually in Instagram.");
      if (epoch.current === version && locationEpoch.current === serial && !abort.signal.aborted) {
        const results = Array.isArray(data.locations) ? data.locations.slice(0, 6).filter((place: { id?: unknown; name?: unknown }) =>
          typeof place?.id === "string" && /^\d{1,40}$/.test(place.id) && typeof place.name === "string" && place.name.trim() && place.name.length <= 200) : [];
        setLocations(results);
        setLocationError(typeof data.reason === "string" ? data.reason : !results.length ? "No eligible Meta location was found. Try a more specific place, or add it manually in Instagram." : "");
      }
    } catch (cause) {
      if (epoch.current === version && locationEpoch.current === serial && !abort.signal.aborted) setLocationError(cause instanceof Error ? cause.message : "Could not check Meta locations. No location has been selected.");
    } finally { if (epoch.current === version && locationEpoch.current === serial) setLocationBusy(false); }
  }
  function resetAudio() {
    audioEpoch.current++; audioRequest.current?.abort();
    setAudioRecommendation(null); setSelectedAudio(null); setAudioCheckedRevision(""); setAudioError(""); setAudioBusy(false); setConfirmed(false);
  }
  async function loadAudio(destination: ChannelStatus, version: number) {
    if (!destination.publishReady || !destination.connectionRevision || epoch.current !== version) return;
    const serial = ++audioEpoch.current;
    const checkedRevision = videoRevision;
    audioRequest.current?.abort();
    const abort = new AbortController(); audioRequest.current = abort;
    setAudioBusy(true); setAudioCheckedRevision(""); setAudioRecommendation(null); setSelectedAudio(null); setAudioError(""); setConfirmed(false);
    try {
      const response = await fetch(`${endpoint}?check=audio-recommendations&connectionRevision=${encodeURIComponent(destination.connectionRevision)}`, {
        cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]),
      });
      const payload: unknown = await response.json();
      const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      if (!response.ok) throw new Error(musicText(data.error) ? data.error : "Instagram audio is unavailable for this account.");
      if (epoch.current === version && audioEpoch.current === serial && latestVideoRevision.current === checkedRevision && !abort.signal.aborted) {
        const summary = publicMusicRecommendation(data.recommendation);
        const seen = new Set<string>();
        const tracks = (Array.isArray(data.audio) ? data.audio.slice(0, 6) : []).flatMap((value: unknown) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const track = value as { audio_id?: unknown; title?: unknown; display_artist?: unknown; preview_url?: unknown; recommendation?: unknown };
          if (!instagramAudioId(track?.audio_id) || typeof track.title !== "string" || !track.title.trim() || track.title.length > 200
              || typeof track.display_artist !== "string" || track.display_artist.length > 200 || /[\u0000-\u001f\u007f]/.test(`${track.title}${track.display_artist}`)) return [];
          const recommendation = publicTrackRecommendation(track.recommendation);
          if (!summary || !recommendation || seen.has(track.audio_id)) return [];
          seen.add(track.audio_id);
          const preview = instagramAudioPreviewUrl(track.preview_url);
          return [{ audio_id: track.audio_id, title: track.title.trim(), display_artist: track.display_artist.trim(), ...(preview ? { preview_url: preview } : {}), ...(recommendation ? { recommendation } : {}) }];
        });
        setAudioRecommendation(summary);
        const reason = musicText(data.reason) ? data.reason : "No eligible Instagram music matched this video's evidence and your English/instrumental preference.";
        const recommended = [...tracks].sort((left, right) => (left.recommendation?.rank || 99) - (right.recommendation?.rank || 99))[0];
        setSelectedAudio(recommended || null); setAudioCheckedRevision(checkedRevision); setConfirmed(false);
        setAudioError(recommended ? "" : reason);
      }
    } catch (cause) {
      if (epoch.current === version && audioEpoch.current === serial && latestVideoRevision.current === checkedRevision && !abort.signal.aborted) {
        const reason = cause instanceof Error ? cause.message : "Could not check Instagram audio. No track is selected.";
        setSelectedAudio(null); setAudioCheckedRevision(checkedRevision); setAudioError(reason); setConfirmed(false);
      }
    } finally { if (epoch.current === version && audioEpoch.current === serial) setAudioBusy(false); }
  }
  async function copyPlatformText() {
    if (!platform) return;
    if (platform === "instagram" && captionHashtags(caption).length > INSTAGRAM_HASHTAG_LIMIT) {
      setNotice("The caption contains more than five hashtags. Edit its posting text first; nothing was copied or silently removed."); return;
    }
    try { await navigator.clipboard.writeText(caption); setNotice(`${platform === "youtube" ? "YouTube" : platform === "facebook" ? "Facebook Page" : "Instagram"} text copied. Review it before posting.`); }
    catch { setNotice("Clipboard unavailable. Select and copy the posting text in this panel."); }
  }
  async function submit(job?: ReviewPublishJob, revise = false, makeStandalone = false) {
    const createStory = platform === "instagram" && instagramMode === "story" && (!job || makeStandalone);
    const finalPost = !job || revise;
    if (!platform || inFlight.current || (!finalPost && !confirmed) || epoch.current !== viewEpoch || latestVideoRevision.current !== videoRevision || !setupChecked || (!createStory && platform === "instagram" && (locationBusy || audioBusy || (!job && (postingDefaultsBusy || !instagramAudioReady))))) return;
    if (createStory && storyCapability?.ready !== true) return;
    if (makeStandalone && (!createStory || !job?.canMakeStandalone)) return;
    const channel = channels.find(item => item.platform === platform);
    if ((!job || revise || makeStandalone) && (!channel?.publishReady || !postingDownload(file, platform))) {
      setError("Connect this account with uploading permission before submitting."); return;
    }
    if (revise && (!job?.canRevise || job.platform !== "instagram" || platform !== "instagram" || typeof job.caption !== "string")) return;
    if ((!job || revise) && !createStory && platform === "instagram" && captionHashtags(caption).length > INSTAGRAM_HASHTAG_LIMIT) {
      setError("Instagram allows at most five hashtags per Reel. Remove extra hashtags before posting; your caption has not been changed."); return;
    }
    if (!job && platform === "youtube" && (!title.trim() || youtubeTextIssue)) { setError(youtubeTextIssue || "Enter a YouTube title in Posting details before uploading."); return; }
    inFlight.current = true; setBusy(true); setError("");
    const version = epoch.current;
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify(createStory ? { action: "create-story", confirm: true, connectionRevision: channel?.connectionRevision, ...(makeStandalone ? { jobId: job!.id } : {}) } : revise ? { action: "revise", jobId: job!.id, confirm: true, caption, automaticTags: true } : job ? { action: job.kind === "story" ? "continue-story" : "continue", jobId: job.id, confirm: true } : {
          action: "create", platform, title, caption, privacy: platform === "youtube" ? privacy : "public", madeForKids,
          connectionRevision: channel?.connectionRevision, confirm: true,
          ...(platform === "instagram" ? { companionStory: addStory, ...(selectedLocation ? { location: { id: selectedLocation.id } } : {}),
            automaticTags: true,
            ...(selectedAudio ? { audio: { audio_id: selectedAudio.audio_id, audio_volume: 100, video_volume: 1 } } : {}) } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not submit the upload.");
      if (epoch.current === version) {
        onAccepted(data.job); setConfirmed(false);
      }
    } catch (cause) {
      if (epoch.current === version) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Submission response was interrupted. Check status before trying again; the saved request may already exist.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function rememberPostingChoices() {
    if (platform !== "instagram" || inFlight.current || postingDefaultsBusy || locationBusy || !publishReady || !channel?.connectionRevision || existing) return;
    inFlight.current = true; setBusy(true); setSavingPostingDefaults(true); setError(""); setNotice(""); setConfirmed(false);
    const version = epoch.current;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ action: "save-posting-defaults", confirm: true, connectionRevision: channel.connectionRevision,
          userTags: automaticTags, location: selectedLocation || null, locationQuery: selectedLocation ? selectedLocation.name : locationQuery.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(musicText(data.error) ? data.error : "Posting choices could not be remembered.");
      if (epoch.current === version) setNotice("Posting choices remembered for this Instagram account. No video was uploaded; review and approve this Reel before publishing.");
    } catch (cause) { if (epoch.current === version) setError(cause instanceof Error ? cause.message : "Posting choices could not be remembered."); }
    finally { inFlight.current = false; setBusy(false); setSavingPostingDefaults(false); }
  }

  async function enableStories() {
    const destination = channels.find(item => item.platform === "instagram");
    if (!businessConfirmed || !destination?.publishReady || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setConfirmed(false);
    const version = epoch.current;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ action: "confirm-story-business", connectionRevision: destination.connectionRevision, businessAccountConfirmed: true, confirm: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Business confirmation could not be saved.");
      if (epoch.current === version) setStoryCapability(data.story);
    } catch (cause) { if (epoch.current === version) setError(cause instanceof Error ? cause.message : "Story setup could not be confirmed. Reel posting is still available."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const channel = channels.find(item => item.platform === platform);
  const savedStory = instagramStoryJob(jobs);
  const addStory = includeStory && !savedStory && storyCapability?.ready === true;
  const storyOnly = platform === "instagram" && instagramMode === "story";
  const platformJobs = storyOnly ? savedStory ? [savedStory] : [] : jobs.filter(item => item.platform === platform && !item.kind);
  const existing = platformJobs.length > 0;
  const name = platform === "youtube" ? "YouTube" : platform === "facebook" ? "Facebook Page" : "Instagram";
  const output = platform ? postingDownload(file, platform) : null;
  const metadata = output ? file.outputs[output.target] : null;
  const instagramTags = platform === "instagram" ? captionHashtags(caption).length : 0;
  const youtubeTextIssue = platform === "youtube" ? youtubePostingTextIssue(title.trim(), caption.trim()) : undefined;
  const publishReady = setupChecked && channel?.publishReady;
  const locationSuggestions = instagramLocationSuggestions(file);
  const savedAudioAvailable = ["natural-audio-preserved", "local-music-replaced"].includes(file.quality.audio);
  const instagramAudioReady = !footageMusic(file) || (audioCheckedRevision === videoRevision && Boolean(selectedAudio || savedAudioAvailable));
  const automaticTags = automaticInstagramUserTags(file, channel?.name);
  const savedPostingText = platform ? reviewPostingText(file, platform) : "";
  useEffect(() => {
    if (platform && !existing && !captionEdited) setCaption(savedPostingText);
  }, [platform, savedPostingText, existing, captionEdited]);
  const revisableJob = platformJobs.find(job => job.canRevise === true && job.platform === "instagram" && typeof job.caption === "string");
  const revisableCaption = revisableJob?.caption;
  useEffect(() => {
    if (revisableCaption === undefined) return;
    setCaption(revisableCaption); setConfirmedRevision("");
  }, [revisableJob?.id, revisableJob?.updatedAt, revisableCaption]);
  return platform ? <section data-posting-destination hidden={!visible} aria-label={`${name} upload confirmation`} className="space-y-3 border-t border-[#bdc7a5] py-3">
      <h6 className="font-semibold">{name}{storyOnly ? " · Story only" : ""}</h6>
      {loading ? <StudioActivity label="Checking account and saved video…" /> : <>
        {(!existing || !publishReady) && <p className="text-xs">Destination: {channel?.name || "No connected account"}.{publishReady ? !channel?.connected && ` ${channel?.publishReason}` : ` ${!setupChecked ? "Uploading setup could not be verified. Check status before posting." : channel?.publishReason || "Connect this account in Settings."}`}</p>}
        {!publishReady && <a className={`${button} underline`} href="/dashboard#settings">Open channel setup</a>}
        {!existing && metadata && <p className="text-xs">{metadata.width} × {metadata.height} · {Math.round(metadata.duration)} seconds</p>}
        {output && output.target !== (platform === "facebook" ? "instagram" : platform) && <p className="text-xs">This video only has another platform’s render. Check its framing in the preview before posting.</p>}
        {platformJobs.map(job => <article key={job.id} className="space-y-2 py-2 text-xs">
          {(job.status === "FAILED" || job.status === "NEEDS_CHECK") && <p role="status">{job.detail}</p>}
          {job.remoteUrl && <a className="underline" href={job.remoteUrl} target="_blank" rel="noopener noreferrer">View uploaded video ↗</a>}
          <details className="space-y-1">
            <summary className="cursor-pointer font-semibold">Upload details</summary>
          <p className="font-semibold">{job.accountName} · {job.status.replaceAll("_", " ")}</p>
          {job.status !== "FAILED" && job.status !== "NEEDS_CHECK" && <p>{job.detail}</p>}
          {job.privacy && <p>Requested visibility: {job.privacy}</p>}
          {job.actualPrivacy && <p>Platform-confirmed visibility: {job.actualPrivacy}</p>}
          {job.platform === "instagram" && job.location && <p>Approved location tag: {job.location.name}. This is a posting location, not proof of where filming happened.</p>}
          {job.platform === "instagram" && job.audio && <p>Approved Instagram audio: {job.audio.title}{job.audio.display_artist ? ` · ${job.audio.display_artist}` : ""} · track volume {job.audio.audio_volume}% · saved video volume {job.audio.video_volume}%</p>}
          {job.platform === "instagram" && job.userTags?.length && !job.canRevise ? <p>{job.status === "COMPLETE" ? "Tags sent to Instagram" : "Requested Reel tags"}: {job.userTags.map(username => `@${username}`).join(", ")}</p> : null}
          {job.platform === "instagram" && job.omittedUserTags?.length ? <p>Meta rejected the optional tags; this request continued without them.</p> : null}
          {job.kind === "story" && job.remoteId && <p>Published Story ID: {job.remoteId}. Instagram Stories normally expire after 24 hours.</p>}
          {job.platform === "instagram" && job.companionStoryDetached && <p>The matching Story was separately approved as Story only. This Reel will not create or repeat it.</p>}
          </details>
          {storyOnly && job.canMakeStandalone ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void submit(job, false, true); }}>
            <p>This matching Story has not been sent, and its Reel failed before being accepted. Approve the same saved video as a Story only; the old request will be retained in private history.</p>
            <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy || !publishReady || storyCapability?.ready !== true} onChange={event => setConfirmed(event.target.checked)}/><span>I have reviewed this video, hold the required rights, and approve publishing this Story publicly to {job.accountName}, independently of the failed Reel.</span></label>
            <button type="submit" className={button} disabled={busy || !confirmed || !publishReady || !output || storyCapability?.ready !== true}>{busy ? <StudioActivity label="Saving Story request…" /> : "Confirm Story only"}</button>
          </form> : platform === "instagram" && job.canRevise && typeof job.caption === "string" ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void submit(job, true); }}>
              <p>The previous request failed before any video transfer. Posting again keeps its saved location, audio, visibility and matching Story choice; the failed request stays in private history.</p>
              <details><summary className="cursor-pointer">Edit caption and hashtags · optional</summary><label className="block">Corrected caption and hashtags<textarea className={`${input} min-h-24`} maxLength={2200} value={caption} disabled={busy} onChange={event => { setCaptionEdited(true); setCaption(event.target.value); setConfirmed(false); }}/></label></details>
              <p className={instagramTags > INSTAGRAM_HASHTAG_LIMIT ? "text-red-800" : ""}>{instagramTags}/{INSTAGRAM_HASHTAG_LIMIT} Instagram hashtags.</p>
              <p>Automatic Reel tags · {automaticTags.length ? automaticTags.map(username => `@${username}`).join(", ") : "No matching profiles"}. If Meta rejects optional tags, publish without them.</p>
              <p>Clicking Post approves publishing this Reel publicly{job.companionStoryApproved ? " and then its matching Story" : ""} to {job.accountName}, with the required rights.</p>
              <button type="submit" className={button} disabled={busy || !publishReady || !output || locationBusy || audioBusy || instagramTags > INSTAGRAM_HASHTAG_LIMIT}>{busy ? <StudioActivity label="Saving upload request…" /> : "Post to Instagram"}</button>
            </form> : job.canContinue && <><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !setupChecked}/><span>Continue this saved {job.kind === "story" ? "Story" : "upload"} to {job.accountName}, using its saved posting choices.</span></label><button type="button" className={button} disabled={busy || !confirmed || !setupChecked} onClick={() => void submit(job)}>{job.kind === "story" ? job.standaloneStory ? "Continue Story only" : "Continue matching Story" : "Continue saved upload"}</button></>}
          {job.platform === "instagram" && job.companionStoryApproved && <details className="space-y-2" aria-label="Matching Story status">
            <summary className="cursor-pointer font-semibold">Matching Story details</summary>
            {job.companionStory ? <><p className="font-semibold">Matching Story · {job.companionStory.status.replaceAll("_", " ")}</p><p>{job.companionStory.detail}</p>
              {job.companionStory.remoteId && <p>Published Story ID: {job.companionStory.remoteId}. Instagram Stories normally expire after 24 hours.</p>}
              {job.companionStory.canContinue && <><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !setupChecked}/><span>Continue only the matching Story. The completed Reel will not be published again.</span></label><button type="button" className={button} disabled={busy || !confirmed || !setupChecked} onClick={() => void submit(job.companionStory)}>Continue matching Story</button></>}
            </> : <p>{savedStory?.standaloneStory ? "The Story now has a separate Story-only request. Check it with Post Story only; this Reel will not create another Story." : "Matching Story status is unavailable. Check the upload history; do not repost the completed Reel."}</p>}
          </details>}
        </article>)}
        {platform === "instagram" && storyCapability?.requiresBusinessConfirmation && <details className="text-xs"><summary className="cursor-pointer">Confirm Business account for Stories</summary><p className="mt-2">Check Instagram → Settings → Business tools and controls. Creator accounts need a type switch first. This only records your confirmation; it does not change Instagram or post anything.</p><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={businessConfirmed} disabled={busy} onChange={event => setBusinessConfirmed(event.target.checked)}/><span>I checked: {channel?.name} is a Business account.</span></label><button type="button" className={`${button} mt-2`} disabled={busy || !businessConfirmed || !publishReady} onClick={() => void enableStories()}>Enable matching Stories</button></details>}
        {existing ? null : storyOnly ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <p>Public Story only · saved soundtrack</p>
          {storyCapability?.ready !== true && (storyCapability ? <p>{storyCapability.reason}</p> : <StudioActivity label="Checking Story eligibility…" />)}
          <p className="text-xs">Post approves this reviewed video and the required rights.</p>
          <button type="submit" className={button} disabled={busy || !publishReady || !output || storyCapability?.ready !== true}>{busy ? <StudioActivity label="Saving Story request…" /> : "Post Story only"}</button>
        </form> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <div data-posting-summary className="space-y-1 text-xs" aria-live="polite">
            {platform === "youtube" && <p className="font-semibold">{title} · {privacy} · {madeForKids ? "made for kids" : "general audience"}</p>}
            <p className="line-clamp-3 whitespace-pre-wrap break-words">{caption || "No caption saved. Add one in Posting details if needed."}</p>
            {!file.quality.postCopy?.trim() && !captionEdited && <p role="status">No analyzed caption is saved yet. Add your own text in Posting details if needed.</p>}
            {platform === "instagram" && <>
              <p>Public · Location: {selectedLocation?.name || "none"} · Tags: {automaticTags.length ? automaticTags.map(username => `@${username}`).join(", ") : "none"} · {addStory ? "Reel + matching Story" : "Reel only"}</p>
              {audioBusy ? <StudioActivity label="Choosing music…" /> : <p>{selectedAudio ? `Music: ${selectedAudio.title}${selectedAudio.display_artist ? ` · ${selectedAudio.display_artist}` : ""}` : "Audio: saved video soundtrack"}</p>}
              {postingDefaultsBusy && <StudioActivity label="Checking saved posting choices…" />}
              {postingDefaultsReason && <p role="status">{postingDefaultsReason}</p>}
              {!audioBusy && !instagramAudioReady && <p role="alert">Music is not ready for this video. Open Posting details or check status.</p>}
            </>}
            {platform === "facebook" && <p>Public Reel · saved video soundtrack</p>}
          </div>
          {youtubeTextIssue && <p role="alert" className="text-xs text-red-800">{youtubeTextIssue} Open Posting details to correct it.</p>}
          {instagramTags > INSTAGRAM_HASHTAG_LIMIT && <p role="alert" className="text-xs text-red-800">{instagramTags}/{INSTAGRAM_HASHTAG_LIMIT} Instagram hashtags. Remove extra hashtags in Posting details.</p>}
          {platform === "instagram" && <div className="space-y-1 text-xs">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={addStory} disabled={busy || Boolean(savedStory) || storyCapability?.ready !== true} onChange={event => { setIncludeStory(event.target.checked); setConfirmed(false); }} />
              <span>Also publish one matching Story <span className="font-normal">(optional)</span></span>
            </label>
            {!addStory && (savedStory ? <p>A Story is already saved for this video.</p> : storyCapability?.ready === false ? <p>{storyCapability.reason}</p> : !storyCapability ? <p>Checking Story eligibility…</p> : null)}
          </div>}
          <p className="text-xs">Post approves this video, posting text and required rights.</p>
          <button type="submit" className={button} disabled={busy || !publishReady || !output || instagramTags > INSTAGRAM_HASHTAG_LIMIT || (platform === "instagram" && (postingDefaultsBusy || locationBusy || audioBusy || !instagramAudioReady)) || (platform === "youtube" && (!title.trim() || Boolean(youtubeTextIssue)))}>{busy ? <StudioActivity label={savingPostingDefaults ? "Remembering posting choices…" : "Saving upload request…"} /> : platform === "instagram" ? "Post to Instagram" : platform === "facebook" ? "Post to Facebook Page" : "Post to YouTube"}</button>
          <details data-posting-details className="space-y-3 text-xs">
            <summary className="cursor-pointer">Posting details · optional</summary>
          {metadata && <p>{platform === "facebook" ? "Saved video" : `Using the ${output?.target} render`}. No video is re-rendered for uploading.</p>}
          {platform === "facebook" && <p>Saved MP4{metadata?.filename ? `: ${metadata.filename}` : ""}. Facebook Page Reels use a vertical 9:16 MP4, 3–90 seconds, at least 540 × 960 and 24–60 fps. Phoenix checks the saved file before queuing; it will not trim, stretch or re-render it. The saved MP4 audio is used.</p>}
          {platform === "youtube" && <label className="block text-xs">YouTube title<input className={input} maxLength={100} required value={title} onChange={event => { setTitle(event.target.value); setConfirmed(false); }} disabled={busy}/></label>}
          <label className="block text-xs">{platform === "youtube" ? "Description and hashtags" : "Caption and hashtags"}<textarea aria-label={platform === "youtube" ? "Description and hashtags" : "Caption and hashtags"} className={`${input} min-h-24`} maxLength={platform === "youtube" ? YOUTUBE_DESCRIPTION_BYTE_LIMIT : 2200} value={caption} onChange={event => { setCaptionEdited(true); setCaption(event.target.value); setConfirmed(false); }} disabled={busy}/></label>
          {youtubeTextIssue && <p role="alert" className="text-xs text-red-800">{youtubeTextIssue}</p>}
          {platform === "instagram" && <p className={`text-xs ${instagramTags > INSTAGRAM_HASHTAG_LIMIT ? "text-red-800" : ""}`}>{instagramTags}/{INSTAGRAM_HASHTAG_LIMIT} Instagram hashtags. The candidate bank stays saved; remove extra hashtags here before publishing.</p>}
          {platform === "instagram" && <div aria-label="Instagram posting choices" className="space-y-1 text-xs">
            <p>Posting location · {selectedLocation?.name || locationQuery || "None selected"}{!selectedLocation && locationQuery && " · pending Meta verification; no location tag attached"}{(selectedLocation || locationQuery) && " · your posting choice, not verified filming evidence"}</p>
            <p>Automatic Reel tags · {automaticTags.length ? automaticTags.map(username => `@${username}`).join(", ") : "No matching profiles"}. If Meta rejects optional tags, publish without them.</p>
            {postingDefaultsReason && <p role="status">{postingDefaultsReason}</p>}
          </div>}
          {platform === "youtube" && <><label className="block text-xs">Privacy<select className={input} value={privacy} onChange={event => { setPrivacy(event.target.value as typeof privacy); setConfirmed(false); }} disabled={busy}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={madeForKids} onChange={event => { setMadeForKids(event.target.checked); setConfirmed(false); }} disabled={busy}/>This video is made for kids</label><p className="text-xs">YouTube may apply your channel&apos;s visibility settings. Phoenix reports the visibility returned by YouTube.</p></>}
          {platform === "instagram" && <p className="text-xs">Instagram will publish this Reel publicly when processing finishes. Local-file upload requires a Page-linked professional account with Facebook Login publishing permissions.</p>}
          {platform === "facebook" && <p className="text-xs">This Reel will be published publicly to the verified Facebook Page linked to your Instagram account. Only this Page receives the post.</p>}
          {platform === "instagram" && <details className="space-y-2 text-xs">
            <summary className="cursor-pointer">Instagram location · {selectedLocation?.name || "None selected"}</summary>
            <p>No verified filming location is saved with this video. Choose a posting location below; a country suggestion is not filming evidence or a guarantee of wider reach.</p>
            {locationSuggestions.hints.length > 0 && <div><p className="mb-1 font-semibold">Mentioned in the video description · unverified</p><div className="flex flex-wrap gap-2">{locationSuggestions.hints.map(place => <button key={place} type="button" className={button} disabled={busy} onClick={() => changeLocationQuery(place)}>{place}</button>)}</div></div>}
            <div><p className="mb-1 font-semibold">Other places you can choose</p><div className="flex flex-wrap gap-2">{locationSuggestions.places.map(place => <button key={place} type="button" className={button} disabled={busy} onClick={() => changeLocationQuery(place)}>{place}</button>)}</div></div>
            <label className="block">Place name or Facebook location Page ID<input type="search" className={input} maxLength={100} value={locationQuery} disabled={busy} onChange={event => changeLocationQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchLocations(); } }}/></label>
            <button type="button" className={button} disabled={busy || locationBusy || !publishReady || !locationQuery.trim()} onClick={() => void searchLocations()}>{locationBusy ? <StudioActivity label="Checking Meta locations…" /> : "Find location"}</button>
            <p>Meta needs an eligible location Page with coordinates. Suggestions only fill the search; select a returned place to attach a real tag. This tags the Reel, not its matching Story.</p>
            {locations.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Eligible Meta locations">{locations.map(place => <button key={place.id} type="button" className={button} disabled={busy || locationBusy} aria-pressed={selectedLocation?.id === place.id} onClick={() => { locationEpoch.current++; setSelectedLocation(place); setConfirmed(false); }}>{place.name}</button>)}</div>}
            {selectedLocation ? <p>Selected: {selectedLocation.name} <button type="button" className="underline" disabled={busy} onClick={() => changeLocationQuery("")}>Remove location</button></p> : <p>No location selected. This Reel will post without a tag unless you select an eligible result; you can also add the location manually in Instagram.</p>}
            {locationError && <p role="status" className="text-amber-900">{locationError}</p>}
            <p>Remember this posting location for your Instagram account. Saving does not upload or publish a video.</p>
            <button type="button" className={button} disabled={busy || postingDefaultsBusy || locationBusy || !publishReady} onClick={() => void rememberPostingChoices()}>{savingPostingDefaults ? <StudioActivity label="Remembering posting choices…" /> : "Remember posting location"}</button>
          </details>}
          {platform === "instagram" && <section aria-label="Automatic Reel music" className="space-y-1 rounded-lg bg-[#f7faef] px-3 py-2 text-xs" aria-live="polite">
            {footageMusic(file) ? audioBusy ? <p role="status">Choosing Instagram music for this video…</p>
              : selectedAudio ? <>
                <p><span className="font-semibold">Instagram music:</span> {selectedAudio.title}{selectedAudio.display_artist ? ` · ${selectedAudio.display_artist}` : ""}</p>
                <details><summary className="cursor-pointer">Music choice details</summary>
                  <p>{selectedAudio.recommendation?.reason || audioRecommendation?.reason}</p>
                  <p>{selectedAudio.recommendation?.discovery?.source === "meta-trending"
                    ? <>Returned by Meta&apos;s trending music lookup <time dateTime={selectedAudio.recommendation.discovery.fetchedAt}>{new Date(selectedAudio.recommendation.discovery.fetchedAt).toLocaleString()}</time>. Mood fit is editorial.</>
                    : "Mood recommendation; current trending status is not verified."}</p>
                  <p>Based on sampled visual evidence, not listening or beat analysis. Instagram adds this track when the Reel is published; the local preview/download and matching Story keep the saved MP4 audio.</p>
                </details>
              </> : audioCheckedRevision === videoRevision ? <>
                <p>{audioError}</p>
                {savedAudioAvailable ? <p>Keeping the saved video audio; no Instagram track will be added.</p>
                  : <p role="alert">This video has no verified usable saved audio. Publishing is paused until suitable Instagram music is available. Check status to check availability again.</p>}
              </> : <p role="status">Instagram music has not been checked for this version. Check status before approving.</p>
              : matchedSoundtrack(file) ? <p>Using the finished reel&apos;s {file.quality.musicRecording?.style === "quiet-instrumental" ? "quiet instrumental" : file.quality.musicRecording?.timing === "onset-v1" ? "matched instrumental" : "edited instrumental"}{file.quality.musicRecording?.title ? ` · ${file.quality.musicRecording.title}` : ""}. The preview, Instagram Reel and matching Story keep this same soundtrack.</p>
                : <p>Keeping the finished video&apos;s narration or song; no replacement Instagram track is needed.</p>}
          </section>}
          </details>
        </form>}
        <button type="button" className={button} disabled={busy} onClick={() => void open(platform, instagramMode)}>Check status</button>
      </>}
      {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
      <details className="space-y-2 text-xs">
        <summary className="cursor-pointer">Manual export options</summary>
        {storyOnly && <p>Publish this saved video as one Story only. Its saved soundtrack will be used. No Reel, Reel caption, people tags, location tag or Instagram music configuration will be sent.</p>}
        <p>Download the saved MP4 and copy the {name} text, then select the file on the platform. These actions do not upload or publish automatically.</p>
        <div className="flex flex-wrap gap-2">
          {output && <a href={output.url} download={`${file.title}-${output.target}.mp4`} className={button}>Download for {name}</a>}
          <button type="button" className={button} onClick={() => void copyPlatformText()}>Copy {name} text</button>
          <a href={platform === "youtube" ? "https://www.youtube.com/upload" : platform === "facebook" ? "https://business.facebook.com/" : "https://www.instagram.com/"} target="_blank" rel="noopener noreferrer" className={button}>{platform === "youtube" ? "Open YouTube upload ↗" : platform === "facebook" ? "Open Meta Business Suite ↗" : "Open Instagram Create ↗"}</a>
        </div>
        {!output && <p>No saved video is available to export. Check the output in Library.</p>}
        <p>Closing this panel does not cancel an accepted upload.</p>
      </details>
      {notice && <p role="status" className="text-xs">{notice}</p>}
      {platform === "instagram" && <details className="space-y-2 text-xs"><summary className="cursor-pointer">Everyday Story ideas</summary><p>Optional prompts based on this saved video. Add your own text or poll in Instagram; these ideas are not automatically uploaded and do not guarantee reach.</p><ul className="list-disc space-y-1 pl-4">{instagramStoryIdeas(file).map(idea => <li key={idea}>{idea}</li>)}</ul></details>}
  </section> : null;
}
