"use client";

import { useEffect, useRef, useState } from "react";
import type { ChannelPlatform, ChannelStatus } from "@/lib/channelConnections";
import type { ReviewFile } from "@/lib/reviewFiles";
import type { ReviewPublishJob, InstagramStoryCapability } from "@/lib/reviewPublishing";
import { postingDownload, postingText } from "@/lib/posting";
import { captionHashtags, INSTAGRAM_HASHTAG_LIMIT, youtubePostingTextIssue, YOUTUBE_DESCRIPTION_BYTE_LIMIT } from "@/lib/postingCopyPolicy";
import { instagramStoryIdeas } from "@/lib/instagramStoryIdeas";
import { instagramLocationSuggestions } from "@/lib/instagramLocationSuggestions";
import { instagramAudioId, instagramAudioPreviewUrl } from "@/lib/instagramAudio";
import type { RecommendedInstagramAudio, ReelMusicRecommendation } from "@/lib/reelMusic";
import { automaticInstagramUserTags } from "@/lib/instagramTags";

const button = "inline-flex rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50";
const input = "mt-1 block w-full rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-sm";
const active = (job: ReviewPublishJob): boolean => ["QUEUED", "UPLOADING", "PROCESSING"].includes(job.status) || Boolean(job.companionStory && active(job.companionStory));
const footageMusic = (file: ReviewFile): boolean => ((file.source?.kind && file.source.kind !== "upload") || Boolean(file.quality.visualSources?.length))
  && ["natural-audio-preserved", "local-music-replaced", "no-audio", "needs-review"].includes(file.quality.audio);
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
  return { rank: recommendation.rank, kind: recommendation.kind, reason: recommendation.reason.trim() };
}

/** Opening/checking this panel never uploads. Only its final confirmation does. */
export default function ReviewPublishActions({ file }: { file: ReviewFile }) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [platform, setPlatform] = useState<ChannelPlatform | null>(null);
  const [instagramMode, setInstagramMode] = useState<"reel" | "story">("reel");
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [jobs, setJobs] = useState<ReviewPublishJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setupChecked, setSetupChecked] = useState(false);
  const [viewEpoch, setViewEpoch] = useState(0);
  const [title, setTitle] = useState(file.title.slice(0, 100));
  const [caption, setCaption] = useState(postingText(file));
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");
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
  useEffect(() => {
    if (!platform || !jobs.some(active)) return;
    const abort = new AbortController(); let pending = false;
    const interval = setInterval(() => {
      if (pending || document.hidden) return;
      pending = true;
      void fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) })
        .then(async response => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Upload progress is unavailable.");
          if (!abort.signal.aborted) { setJobs(data.jobs); setError(""); }
        }).catch(() => { if (!abort.signal.aborted) setError("Could not refresh upload progress. Checking again; no new upload is being submitted."); })
        .finally(() => { pending = false; });
    }, 5000);
    return () => { clearInterval(interval); abort.abort(); };
  }, [endpoint, platform, jobs]);

  async function open(next: ChannelPlatform, mode: "reel" | "story" = "reel") {
    if (busy) return;
    const version = ++epoch.current;
    setViewEpoch(version);
    controller.current?.abort();
    changeLocationQuery(""); resetAudio();
    const preferInstagramMusic = next === "instagram" && mode === "reel" && footageMusic(file);
    const abort = new AbortController(); controller.current = abort;
    setPlatform(next); setInstagramMode(next === "instagram" ? mode : "reel"); setConfirmed(false); setPostingDefaultsBusy(false); setLoading(true); setError(""); setNotice(""); setSetupChecked(false);
    setTitle(file.title.slice(0, 100)); setCaption(postingText(file, next));
    setPrivacy("private"); setMadeForKids(file.audience.startsWith("kids"));
    setStoryCapability(null); setIncludeStory(false); setBusinessConfirmed(false);
    try {
      const results = await Promise.all(["/api/channels", endpoint].map(async url => {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not check uploading setup.");
        return data;
      }));
      if (epoch.current === version && !abort.signal.aborted) {
        setChannels(results[0].channels); setJobs(results[1].jobs); setSetupChecked(true); setLoading(false);
        const rejected = next === "instagram" && mode === "reel" && (results[1].jobs as ReviewPublishJob[]).find(job => job.platform === "instagram" && job.canRevise === true && typeof job.caption === "string");
        if (rejected) { setCaption(rejected.caption!); setConfirmed(false); }
      }
      const destination = (results[0].channels as ChannelStatus[]).find(item => item.platform === "instagram");
      if (epoch.current !== version || abort.signal.aborted) return;
      const savedJobs = results[1].jobs as ReviewPublishJob[];
      const existingStory = savedJobs.some(item => item.platform === "instagram" && (item.kind === "story" || item.companionStory));
      const newInstagramPost = next === "instagram" && mode === "reel" && destination?.publishReady && destination.connectionRevision && !savedJobs.some(item => item.platform === "instagram" && !item.kind);
      if (next === "instagram" && mode === "story" && destination?.publishReady && destination.connectionRevision) {
        await loadStoryCapability(destination, version, abort, false);
      }
      if (newInstagramPost && destination) {
        // Independent read-only checks start together. Eligible video-based
        // music and saved posting defaults still need final posting approval.
        await Promise.all([
          loadPostingDefaults(destination, version, abort),
          preferInstagramMusic ? loadAudio(destination, version) : Promise.resolve(),
          loadStoryCapability(destination, version, abort, !existingStory),
        ]);
      }
    } catch (cause) { if (epoch.current === version && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not check uploading setup."); }
    finally { if (epoch.current === version) setLoading(false); }
  }
  function close() {
    epoch.current++; controller.current?.abort(); setChooserOpen(false); setPlatform(null); setLoading(false); setConfirmed(false); setSetupChecked(false);
    changeLocationQuery("");
    resetAudio();
    setPostingDefaultsBusy(false);
  }
  async function loadStoryCapability(destination: ChannelStatus, version: number, abort: AbortController, allowCompanion = true) {
    try {
      const response = await fetch(`${endpoint}?check=story&connectionRevision=${encodeURIComponent(destination.connectionRevision!)}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error("Story capability could not be checked.");
      if (epoch.current === version && !abort.signal.aborted) { setStoryCapability(data.story); setIncludeStory(allowCompanion && data.story?.ready === true); setConfirmed(false); }
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
    try { await navigator.clipboard.writeText(caption); setNotice(`${platform === "youtube" ? "YouTube" : "Instagram"} text copied. Review it before posting.`); }
    catch { setNotice("Clipboard unavailable. Select and copy the posting text in this panel."); }
  }
  async function submit(job?: ReviewPublishJob, revise = false, makeStandalone = false) {
    const createStory = platform === "instagram" && instagramMode === "story" && (!job || makeStandalone);
    const directReelPost = platform === "instagram" && !createStory && (!job || revise);
    if (!platform || inFlight.current || (!directReelPost && !confirmed) || epoch.current !== viewEpoch || latestVideoRevision.current !== videoRevision || !setupChecked || (!createStory && platform === "instagram" && (locationBusy || audioBusy || (!job && (postingDefaultsBusy || !instagramAudioReady))))) return;
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
    if (!job && youtubeTextIssue) { setError(youtubeTextIssue); return; }
    inFlight.current = true; setBusy(true); setError("");
    const version = epoch.current;
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify(createStory ? { action: "create-story", confirm: true, connectionRevision: channel?.connectionRevision, ...(makeStandalone ? { jobId: job!.id } : {}) } : revise ? { action: "revise", jobId: job!.id, confirm: true, caption, automaticTags: true } : job ? { action: job.kind === "story" ? "continue-story" : "continue", jobId: job.id, confirm: true } : {
          action: "create", platform, title, caption, privacy: platform === "instagram" ? "public" : privacy, madeForKids,
          connectionRevision: channel?.connectionRevision, confirm: true,
          ...(platform === "instagram" ? { companionStory: includeStory && storyCapability?.ready === true, ...(selectedLocation ? { location: { id: selectedLocation.id } } : {}),
            automaticTags: true,
            ...(selectedAudio ? { audio: { audio_id: selectedAudio.audio_id, audio_volume: 100, video_volume: 1 } } : {}) } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not submit the upload.");
      if (epoch.current === version) {
        setJobs(current => data.job.kind === "story" && !data.job.standaloneStory ? current.map(item => item.platform === "instagram" && !item.kind ? { ...item, companionStory: data.job } : item) : [...current.filter(item => item.id !== data.job.id).map(item => data.job.standaloneStory && item.companionStory?.id === data.job.id ? { ...item, companionStory: undefined, companionStoryApproved: undefined, companionStoryDetached: true } : item), data.job]); setConfirmed(false);
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
      if (epoch.current === version) { setStoryCapability(data.story); setIncludeStory(instagramMode === "reel" && !savedStory && data.story?.ready === true); }
    } catch (cause) { if (epoch.current === version) setError(cause instanceof Error ? cause.message : "Story setup could not be confirmed. Reel posting is still available."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const channel = channels.find(item => item.platform === platform);
  const savedStory = jobs.find(item => item.platform === "instagram" && item.kind === "story") || jobs.find(item => item.platform === "instagram" && item.companionStory)?.companionStory;
  const storyOnly = platform === "instagram" && instagramMode === "story";
  const platformJobs = storyOnly ? savedStory ? [savedStory] : [] : jobs.filter(item => item.platform === platform && !item.kind);
  const existing = platformJobs.length > 0;
  const name = platform === "youtube" ? "YouTube" : "Instagram";
  const output = platform ? postingDownload(file, platform) : null;
  const metadata = output ? file.outputs[output.target] : null;
  const instagramTags = platform === "instagram" ? captionHashtags(caption).length : 0;
  const youtubeTextIssue = platform === "youtube" ? youtubePostingTextIssue(title.trim(), caption.trim()) : undefined;
  const publishReady = setupChecked && channel?.publishReady;
  const chooserId = `review-publish-${encodeURIComponent(file.id)}`;
  const locationSuggestions = instagramLocationSuggestions(file);
  const savedAudioAvailable = ["natural-audio-preserved", "local-music-replaced"].includes(file.quality.audio);
  const instagramAudioReady = !footageMusic(file) || (audioCheckedRevision === videoRevision && Boolean(selectedAudio || savedAudioAvailable));
  const automaticTags = automaticInstagramUserTags(file, channel?.name);
  const revisableJob = platformJobs.find(job => job.canRevise === true && job.platform === "instagram" && typeof job.caption === "string");
  const revisableCaption = revisableJob?.caption;
  useEffect(() => {
    if (revisableCaption === undefined) return;
    setCaption(revisableCaption); setConfirmedRevision("");
  }, [revisableJob?.id, revisableJob?.updatedAt, revisableCaption]);
  return <>
    <button type="button" className={button} disabled={busy} aria-expanded={chooserOpen} aria-controls={chooserId} onClick={() => setChooserOpen(true)}>Post / export</button>
    {chooserOpen && <section id={chooserId} aria-label="Post or export this video" className="w-full space-y-3 rounded-lg border border-[#bdc7a5] bg-white p-3">
      <div className="flex items-center justify-between gap-2"><h5 className="font-semibold">Post / export</h5><button type="button" className={button} onClick={close} disabled={busy}>Close</button></div>
      <div className="flex flex-wrap gap-2" aria-label="Choose a platform">
        <button type="button" className={button} disabled={busy} aria-pressed={platform === "youtube"} onClick={() => void open("youtube")}>Upload to YouTube</button>
        <button type="button" className={button} disabled={busy} aria-pressed={platform === "instagram" && !storyOnly} onClick={() => void open("instagram")}>Post to Instagram</button>
        <button type="button" className={button} disabled={busy} aria-pressed={storyOnly} onClick={() => void open("instagram", "story")}>Post Story only</button>
      </div>
      {!platform && <p className="text-xs">Choose a platform to review posting choices or export the saved video. Opening this panel does not upload anything.</p>}
      {platform && <section aria-label={`${name} upload confirmation`} className="space-y-3">
      <h6 className="font-semibold">{name}{storyOnly ? " Story only" : ""} · final posting review</h6>
      {loading ? <p role="status" className="text-xs">Checking saved account and previous uploads…</p> : <>
        <p className="text-xs">Destination: {channel?.name || "No connected account"}. {publishReady ? "Upload permission verified." : !setupChecked ? "Uploading setup could not be verified. Check status before confirming an upload." : channel?.publishReason || "Connect this account and grant uploading access in Settings."}</p>
        {!publishReady && <a className={`${button} underline`} href="/dashboard#settings">Open channel setup</a>}
        {metadata && <p className="text-xs">Using the {output?.target} render · {metadata.width} × {metadata.height} · {Math.round(metadata.duration)} seconds. No video is re-rendered for uploading.</p>}
        {output?.target !== platform && <p className="text-xs">This video only has another platform’s render. Check its framing in the preview before posting.</p>}
        {platformJobs.map(job => <article key={job.id} className="space-y-2 rounded-lg bg-[#f7faef] p-3 text-xs">
          <p className="font-semibold">{job.accountName} · {job.status.replaceAll("_", " ")} · {Math.round(job.percent)}%</p>
          <p role="status">{job.detail}</p>
          {job.privacy && <p>Requested visibility: {job.privacy}</p>}
          {job.actualPrivacy && <p>Platform-confirmed visibility: {job.actualPrivacy}</p>}
          {job.location && <p>Approved location tag: {job.location.name}. This is a posting location, not proof of where filming happened.</p>}
          {job.audio && <p>Approved Instagram audio: {job.audio.title}{job.audio.display_artist ? ` · ${job.audio.display_artist}` : ""} · track volume {job.audio.audio_volume}% · saved video volume {job.audio.video_volume}%</p>}
          {job.userTags?.length && !job.canRevise ? <p>Reel tags: {job.userTags.map(username => `@${username}`).join(", ")}</p> : null}
          {job.omittedUserTags?.length ? <p>Meta rejected the optional tags; this request continued without them.</p> : null}
          {job.remoteUrl && <a className="underline" href={job.remoteUrl} target="_blank" rel="noopener noreferrer">View uploaded video ↗</a>}
          {job.kind === "story" && job.remoteId && <p>Published Story ID: {job.remoteId}. Instagram Stories normally expire after 24 hours.</p>}
          {job.companionStoryDetached && <p>The matching Story was separately approved as Story only. This Reel will not create or repeat it.</p>}
          {storyOnly && job.canMakeStandalone ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void submit(job, false, true); }}>
            <p>This matching Story has not been sent, and its Reel failed before being accepted. Approve the same saved video as a Story only; the old request will be retained in private history.</p>
            <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy || !publishReady || storyCapability?.ready !== true} onChange={event => setConfirmed(event.target.checked)}/><span>I have reviewed this video, hold the required rights, and approve publishing this Story publicly to {job.accountName}, independently of the failed Reel.</span></label>
            <button type="submit" className={button} disabled={busy || !confirmed || !publishReady || !output || storyCapability?.ready !== true}>{busy ? "Saving Story request…" : "Confirm Story only"}</button>
          </form> : job.canRevise && typeof job.caption === "string" ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void submit(job, true); }}>
              <p>The previous request failed before any video transfer. Posting again keeps its saved location, audio, visibility and matching Story choice; the failed request stays in private history.</p>
              <details><summary className="cursor-pointer">Edit caption and hashtags · optional</summary><label className="block">Corrected caption and hashtags<textarea className={`${input} min-h-24`} maxLength={2200} value={caption} disabled={busy} onChange={event => { setCaption(event.target.value); setConfirmed(false); }}/></label></details>
              <p className={instagramTags > INSTAGRAM_HASHTAG_LIMIT ? "text-red-800" : ""}>{instagramTags}/{INSTAGRAM_HASHTAG_LIMIT} Instagram hashtags.</p>
              <p>Automatic Reel tags · {automaticTags.length ? automaticTags.map(username => `@${username}`).join(", ") : "No matching profiles"}. If Meta rejects optional tags, publish without them.</p>
              <p>Clicking Post approves publishing this Reel publicly{job.companionStoryApproved ? " and then its matching Story" : ""} to {job.accountName}, with the required rights.</p>
              <button type="submit" className={button} disabled={busy || !publishReady || !output || locationBusy || audioBusy || instagramTags > INSTAGRAM_HASHTAG_LIMIT}>{busy ? "Saving upload request…" : "Post to Instagram"}</button>
            </form> : job.canContinue && <><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !setupChecked}/><span>Continue this saved {job.kind === "story" ? "Story" : "upload"} to {job.accountName}, using its saved posting choices.</span></label><button type="button" className={button} disabled={busy || !confirmed || !setupChecked} onClick={() => void submit(job)}>{job.kind === "story" ? job.standaloneStory ? "Continue Story only" : "Continue matching Story" : "Continue saved upload"}</button></>}
          {job.companionStoryApproved && <div className="space-y-2 border-t border-[#bdc7a5] pt-2" aria-label="Matching Story status">
            {job.companionStory ? <><p className="font-semibold">Matching Story · {job.companionStory.status.replaceAll("_", " ")} · {Math.round(job.companionStory.percent)}%</p><p role="status">{job.companionStory.detail}</p>
              {job.companionStory.remoteId && <p>Published Story ID: {job.companionStory.remoteId}. Instagram Stories normally expire after 24 hours.</p>}
              {job.companionStory.canContinue && <><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !setupChecked}/><span>Continue only the matching Story. The completed Reel will not be published again.</span></label><button type="button" className={button} disabled={busy || !confirmed || !setupChecked} onClick={() => void submit(job.companionStory)}>Continue matching Story</button></>}
            </> : <p>{savedStory?.standaloneStory ? "The Story now has a separate Story-only request. Check it with Post Story only; this Reel will not create another Story." : "Matching Story status is unavailable. Check the upload history; do not repost the completed Reel."}</p>}
          </div>}
        </article>)}
        {platform === "instagram" && storyCapability?.requiresBusinessConfirmation && <details className="text-xs"><summary className="cursor-pointer">Confirm Business account for Stories</summary><p className="mt-2">Check Instagram → Settings → Business tools and controls. Creator accounts need a type switch first. This only records your confirmation; it does not change Instagram or post anything.</p><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={businessConfirmed} disabled={busy} onChange={event => setBusinessConfirmed(event.target.checked)}/><span>I checked: {channel?.name} is a Business account.</span></label><button type="button" className={`${button} mt-2`} disabled={busy || !businessConfirmed || !publishReady} onClick={() => void enableStories()}>Enable matching Stories</button></details>}
        {existing ? <p className="text-xs">This output already has a saved {name}{storyOnly ? " Story" : ""} upload request. Check or continue that request instead of creating a duplicate.</p> : storyOnly ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <p>Publish this saved video as one Story only. Its saved soundtrack will be used. No Reel, Reel caption, people tags, location tag or Instagram music configuration will be sent.</p>
          <p>{storyCapability?.reason || "Checking Story eligibility. Stories require a confirmed Business account and a ready portrait video within Story limits."}</p>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !publishReady || storyCapability?.ready !== true}/><span>I have reviewed this video, hold the required rights, and approve publishing this Story publicly to {channel?.name || name}.</span></label>
          <button type="submit" className={button} disabled={busy || !confirmed || !publishReady || !output || storyCapability?.ready !== true}>{busy ? "Saving Story request…" : "Confirm Story only"}</button>
        </form> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
          {platform === "youtube" && <label className="block text-xs">YouTube title<input className={input} maxLength={100} required value={title} onChange={event => { setTitle(event.target.value); setConfirmed(false); }} disabled={busy}/></label>}
          {platform === "youtube" ? <label className="block text-xs">Description and hashtags<textarea className={`${input} min-h-24`} maxLength={YOUTUBE_DESCRIPTION_BYTE_LIMIT} value={caption} onChange={event => { setCaption(event.target.value); setConfirmed(false); }} disabled={busy}/></label> : <details className="text-xs"><summary className="cursor-pointer">Edit caption and hashtags · optional</summary><label className="block">Caption and hashtags<textarea className={`${input} min-h-24`} maxLength={2200} value={caption} onChange={event => { setCaption(event.target.value); setConfirmed(false); }} disabled={busy}/></label></details>}
          {youtubeTextIssue && <p role="alert" className="text-xs text-red-800">{youtubeTextIssue}</p>}
          {platform === "instagram" && <p className={`text-xs ${instagramTags > INSTAGRAM_HASHTAG_LIMIT ? "text-red-800" : ""}`}>{instagramTags}/{INSTAGRAM_HASHTAG_LIMIT} Instagram hashtags. The candidate bank stays saved; remove extra hashtags here before publishing.</p>}
          {platform === "instagram" && <div aria-label="Instagram posting choices" className="space-y-1 text-xs">
            <p>Posting location · {selectedLocation?.name || locationQuery || "None selected"}{!selectedLocation && locationQuery && " · pending Meta verification; no location tag attached"}{(selectedLocation || locationQuery) && " · your posting choice, not verified filming evidence"}</p>
            <p>Automatic Reel tags · {automaticTags.length ? automaticTags.map(username => `@${username}`).join(", ") : "No matching profiles"}. If Meta rejects optional tags, publish without them.</p>
            {postingDefaultsBusy && <p role="status">Checking saved posting choices…</p>}
            {postingDefaultsReason && <p role="status">{postingDefaultsReason}</p>}
          </div>}
          {platform === "youtube" && <><label className="block text-xs">Privacy<select className={input} value={privacy} onChange={event => { setPrivacy(event.target.value as typeof privacy); setConfirmed(false); }} disabled={busy}><option value="private">Private (recommended first upload)</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={madeForKids} onChange={event => { setMadeForKids(event.target.checked); setConfirmed(false); }} disabled={busy}/>This video is made for kids</label><p className="text-xs">YouTube may apply your channel&apos;s visibility settings. Phoenix reports the visibility returned by YouTube.</p></>}
          {platform === "instagram" && <p className="text-xs">Instagram will publish this Reel publicly when processing finishes. Local-file upload requires a Page-linked professional account with Facebook Login publishing permissions.</p>}
          {platform === "instagram" && <details className="space-y-2 text-xs">
            <summary className="cursor-pointer">Instagram location · {selectedLocation?.name || "None selected"}</summary>
            <p>No verified filming location is saved with this video. Choose a posting location below; a country suggestion is not filming evidence or a guarantee of wider reach.</p>
            {locationSuggestions.hints.length > 0 && <div><p className="mb-1 font-semibold">Mentioned in the video description · unverified</p><div className="flex flex-wrap gap-2">{locationSuggestions.hints.map(place => <button key={place} type="button" className={button} disabled={busy} onClick={() => changeLocationQuery(place)}>{place}</button>)}</div></div>}
            <div><p className="mb-1 font-semibold">Other places you can choose</p><div className="flex flex-wrap gap-2">{locationSuggestions.places.map(place => <button key={place} type="button" className={button} disabled={busy} onClick={() => changeLocationQuery(place)}>{place}</button>)}</div></div>
            <label className="block">Place name or Facebook location Page ID<input type="search" className={input} maxLength={100} value={locationQuery} disabled={busy} onChange={event => changeLocationQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchLocations(); } }}/></label>
            <button type="button" className={button} disabled={busy || locationBusy || !publishReady || !locationQuery.trim()} onClick={() => void searchLocations()}>{locationBusy ? "Checking Meta locations…" : "Find location"}</button>
            <p>Meta needs an eligible location Page with coordinates. Suggestions only fill the search; select a returned place to attach a real tag. This tags the Reel, not its matching Story.</p>
            {locations.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Eligible Meta locations">{locations.map(place => <button key={place.id} type="button" className={button} disabled={busy || locationBusy} aria-pressed={selectedLocation?.id === place.id} onClick={() => { locationEpoch.current++; setSelectedLocation(place); setConfirmed(false); }}>{place.name}</button>)}</div>}
            {selectedLocation ? <p>Selected: {selectedLocation.name} <button type="button" className="underline" disabled={busy} onClick={() => changeLocationQuery("")}>Remove location</button></p> : <p>No location selected. This Reel will post without a tag unless you select an eligible result; you can also add the location manually in Instagram.</p>}
            {locationError && <p role="status" className="text-amber-900">{locationError}</p>}
            <p>Remember this posting location for your Instagram account. Saving does not upload or publish a video.</p>
            <button type="button" className={button} disabled={busy || postingDefaultsBusy || locationBusy || !publishReady} onClick={() => void rememberPostingChoices()}>{savingPostingDefaults ? "Remembering posting choices…" : "Remember posting location"}</button>
          </details>}
          {platform === "instagram" && <section aria-label="Automatic Reel music" className="space-y-1 rounded-lg bg-[#f7faef] px-3 py-2 text-xs" aria-live="polite">
            {footageMusic(file) ? audioBusy ? <p role="status">Choosing Instagram music for this video…</p>
              : selectedAudio ? <>
                <p><span className="font-semibold">Instagram music:</span> {selectedAudio.title}{selectedAudio.display_artist ? ` · ${selectedAudio.display_artist}` : ""}</p>
                <details><summary className="cursor-pointer">Music choice details</summary>
                  <p>{selectedAudio.recommendation?.reason || audioRecommendation?.reason}</p>
                  <p>Based on sampled visual evidence, not listening or beat analysis. Instagram adds this track when the Reel is published; the local preview/download and matching Story keep the saved MP4 audio.</p>
                </details>
              </> : audioCheckedRevision === videoRevision ? <>
                <p>{audioError}</p>
                {savedAudioAvailable ? <p>Keeping the saved video audio; no Instagram track will be added.</p>
                  : <p role="alert">This video has no verified usable saved audio. Publishing is paused until suitable Instagram music is available. Check status to check availability again.</p>}
              </> : <p role="status">Instagram music has not been checked for this version. Check status before approving.</p>
              : <p>Keeping the finished video&apos;s narration or song; no replacement Instagram track is needed.</p>}
          </section>}
          {platform === "instagram" && <div className="space-y-1 text-xs"><label className="flex items-start gap-2"><input type="checkbox" checked={includeStory} disabled={busy || Boolean(savedStory) || storyCapability?.ready !== true} onChange={event => { setIncludeStory(event.target.checked); setConfirmed(false); }}/><span>Also publish one matching Story after this Reel succeeds.</span></label><p>{savedStory ? "This output already has a saved Story request; a second Story will not be created." : storyCapability?.reason || "Automatic Stories need a confirmed Business account, publishing access and a saved video within Story limits. Meta makes the final eligibility check. Otherwise add it manually; Reel posting is unaffected."}</p></div>}
          {platform === "youtube" ? <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !publishReady}/><span>I have reviewed this video, hold the required rights, and approve uploading this video as {privacy} to {channel?.name || name}.</span></label> : <p className="text-xs">Clicking Post approves publishing this Reel publicly{includeStory ? " and then its matching Story" : ""} to {channel?.name || name}, with the required rights.</p>}
          <button type="submit" className={button} disabled={busy || (platform === "youtube" && !confirmed) || !publishReady || !output || instagramTags > INSTAGRAM_HASHTAG_LIMIT || (platform === "instagram" && (postingDefaultsBusy || locationBusy || audioBusy || !instagramAudioReady)) || (platform === "youtube" && (!title.trim() || Boolean(youtubeTextIssue)))}>{busy ? savingPostingDefaults ? "Remembering posting choices…" : "Saving upload request…" : platform === "instagram" ? "Post to Instagram" : "Confirm upload"}</button>
        </form>}
        <button type="button" className={button} disabled={busy} onClick={() => void open(platform, instagramMode)}>Check status</button>
      </>}
      {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
      <details className="space-y-2 text-xs">
        <summary className="cursor-pointer">Manual export options</summary>
        <p>Download the saved MP4 and copy the {name} text, then select the file on the platform. These actions do not upload or publish automatically.</p>
        <div className="flex flex-wrap gap-2">
          {output && <a href={output.url} download={`${file.title}-${output.target}.mp4`} className={button}>Download for {name}</a>}
          <button type="button" className={button} onClick={() => void copyPlatformText()}>Copy {name} text</button>
          <a href={platform === "youtube" ? "https://www.youtube.com/upload" : "https://www.instagram.com/"} target="_blank" rel="noopener noreferrer" className={button}>{platform === "youtube" ? "Open YouTube upload ↗" : "Open Instagram Create ↗"}</a>
        </div>
        {!output && <p>No saved video is available to export. Check the output in Library.</p>}
      </details>
      {notice && <p role="status" className="text-xs">{notice}</p>}
      {platform === "instagram" && <details className="space-y-2 text-xs"><summary className="cursor-pointer">Everyday Story ideas</summary><p>Optional prompts based on this saved video. Add your own text or poll in Instagram; these ideas are not automatically uploaded and do not guarantee reach.</p><ul className="list-disc space-y-1 pl-4">{instagramStoryIdeas(file).map(idea => <li key={idea}>{idea}</li>)}</ul></details>}
      <p className="text-xs">Closing this panel does not cancel an accepted upload.</p>
      </section>}
    </section>}
  </>;
}
