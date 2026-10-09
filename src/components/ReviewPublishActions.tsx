"use client";

import { useEffect, useRef, useState } from "react";
import type { ChannelPlatform, ChannelStatus } from "@/lib/channelConnections";
import type { ReviewFile } from "@/lib/reviewFiles";
import type { ReviewPublishJob, InstagramStoryCapability } from "@/lib/reviewPublishing";
import { postingDownload, postingText } from "@/lib/posting";
import { captionHashtags, INSTAGRAM_HASHTAG_LIMIT } from "@/lib/postingCopyPolicy";
import { instagramStoryIdeas } from "@/lib/instagramStoryIdeas";
import { instagramLocationSuggestions } from "@/lib/instagramLocationSuggestions";
import { instagramAudioId, instagramAudioPreviewUrl, type InstagramAudioTrack } from "@/lib/instagramAudio";
import type { RecommendedInstagramAudio, ReelMusicRecommendation } from "@/lib/reelMusic";
import { instagramUserTags, INSTAGRAM_USER_TAG_LIMIT } from "@/lib/instagramTags";

const button = "inline-flex rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50";
const input = "mt-1 block w-full rounded-lg border border-[#bdc7a5] bg-white px-3 py-2 text-sm";
const active = (job: ReviewPublishJob): boolean => ["QUEUED", "UPLOADING", "PROCESSING"].includes(job.status) || Boolean(job.companionStory && active(job.companionStory));
const footageMusic = (file: ReviewFile): boolean => (file.source.kind === "pexels" || file.source.kind === "pixabay" || Boolean(file.quality.visualSources?.length))
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
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [jobs, setJobs] = useState<ReviewPublishJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setupChecked, setSetupChecked] = useState(false);
  const [title, setTitle] = useState(file.title.slice(0, 100));
  const [caption, setCaption] = useState(postingText(file));
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [madeForKids, setMadeForKids] = useState(file.audience.startsWith("kids"));
  const [confirmed, setConfirmed] = useState(false);
  const [tagText, setTagText] = useState("");
  const tagEpoch = useRef(0);
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
  const [audioQuery, setAudioQuery] = useState("");
  const [audioMode, setAudioMode] = useState<"instagram" | "saved">("saved");
  const [audioTracks, setAudioTracks] = useState<RecommendedInstagramAudio[]>([]);
  const [audioRecommendation, setAudioRecommendation] = useState<ReelMusicRecommendation | null>(null);
  const [selectedAudio, setSelectedAudio] = useState<InstagramAudioTrack | null>(null);
  const [audioVolume, setAudioVolume] = useState("100");
  const [videoVolume, setVideoVolume] = useState("1");
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

  async function open(next: ChannelPlatform) {
    if (busy) return;
    const version = ++epoch.current;
    controller.current?.abort();
    changeLocationQuery(""); changeAudioQuery(""); setAudioVolume("100"); setVideoVolume("1");
    const preferInstagramMusic = next === "instagram" && footageMusic(file);
    setAudioMode(preferInstagramMusic ? "instagram" : "saved");
    const abort = new AbortController(); controller.current = abort;
    setPlatform(next); setConfirmed(false); changeTagText(""); setPostingDefaultsBusy(false); setLoading(true); setError(""); setNotice(""); setSetupChecked(false);
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
      if (epoch.current === version && !abort.signal.aborted) { setChannels(results[0].channels); setJobs(results[1].jobs); setSetupChecked(true); setLoading(false); }
      const destination = (results[0].channels as ChannelStatus[]).find(item => item.platform === "instagram");
      if (epoch.current !== version || abort.signal.aborted) return;
      const newInstagramPost = next === "instagram" && destination?.publishReady && destination.connectionRevision && !(results[1].jobs as ReviewPublishJob[]).some(item => item.platform === "instagram");
      if (newInstagramPost && destination) {
        // Independent read-only checks start together. Music still needs a
        // track choice, and saved posting defaults still need final approval.
        await Promise.all([
          loadPostingDefaults(destination, version, abort),
          preferInstagramMusic ? loadAudio("", destination, version) : Promise.resolve(),
          loadStoryCapability(destination, version, abort),
        ]);
      }
    } catch (cause) { if (epoch.current === version && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not check uploading setup."); }
    finally { if (epoch.current === version) setLoading(false); }
  }
  function close() {
    epoch.current++; controller.current?.abort(); setChooserOpen(false); setPlatform(null); setLoading(false); setConfirmed(false); setSetupChecked(false);
    changeLocationQuery("");
    changeAudioQuery("");
    changeTagText(""); setPostingDefaultsBusy(false);
  }
  function changeTagText(text: string) {
    tagEpoch.current++; setTagText(text); setConfirmed(false);
  }
  async function loadStoryCapability(destination: ChannelStatus, version: number, abort: AbortController) {
    try {
      const response = await fetch(`${endpoint}?check=story&connectionRevision=${encodeURIComponent(destination.connectionRevision!)}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error("Story capability could not be checked.");
      if (epoch.current === version && !abort.signal.aborted) { setStoryCapability(data.story); setIncludeStory(data.story?.ready === true); setConfirmed(false); }
    } catch { if (epoch.current === version && !abort.signal.aborted) setStoryCapability({ ready: false, reason: "Story capability could not be verified. You can post this Reel normally and add a Story manually." }); }
  }
  async function loadPostingDefaults(destination: ChannelStatus, version: number, abort: AbortController) {
    const locationSerial = locationEpoch.current, tagSerial = tagEpoch.current;
    setPostingDefaultsBusy(true);
    try {
      const response = await fetch(`${endpoint}?check=posting-defaults&connectionRevision=${encodeURIComponent(destination.connectionRevision!)}`, {
        cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]),
      });
      const payload: unknown = await response.json();
      const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      if (!response.ok) throw new Error(musicText(data.error, 600) ? data.error : "Saved posting choices could not be checked. You can choose location and tags below.");
      if (epoch.current !== version || abort.signal.aborted || !data.defaults || typeof data.defaults !== "object" || Array.isArray(data.defaults)) return;
      const defaults = data.defaults as { userTags?: unknown; location?: unknown; locationQuery?: unknown; locationReason?: unknown };
      if (tagEpoch.current === tagSerial) {
        const tags = instagramUserTags(defaults.userTags);
        if (tags) { setTagText(tags.join(", ")); setConfirmed(false); }
      }
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
      if (epoch.current === version && !abort.signal.aborted && locationEpoch.current === locationSerial) setPostingDefaultsReason(cause instanceof Error ? cause.message : "Saved posting choices could not be checked. Choose location and tags below.");
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
  function changeAudioQuery(query: string) {
    audioEpoch.current++; audioRequest.current?.abort();
    setAudioQuery(query); setAudioTracks([]); setAudioRecommendation(null); setSelectedAudio(null); setAudioError(""); setAudioBusy(false); setConfirmed(false);
  }
  async function searchAudio() {
    const destination = channels.find(item => item.platform === "instagram"), query = audioQuery.trim();
    if (platform !== "instagram" || audioMode !== "instagram" || busy || audioBusy || !setupChecked || !destination?.publishReady || !destination.connectionRevision) return;
    await loadAudio(query, destination, epoch.current);
  }
  async function loadAudio(query: string, destination: ChannelStatus, version: number) {
    if (!destination.publishReady || !destination.connectionRevision || epoch.current !== version) return;
    if (query.length > 100) { setAudioError("Keep the audio search within 100 characters."); return; }
    const serial = ++audioEpoch.current;
    audioRequest.current?.abort();
    const abort = new AbortController(); audioRequest.current = abort;
    const contextual = !query;
    setAudioBusy(true); setAudioTracks([]); setAudioRecommendation(null); setSelectedAudio(null); setAudioError(""); setConfirmed(false);
    try {
      const check = contextual ? "audio-recommendations" : `audio&q=${encodeURIComponent(query)}`;
      const response = await fetch(`${endpoint}?check=${check}&connectionRevision=${encodeURIComponent(destination.connectionRevision)}`, {
        cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(contextual ? 45000 : 25000)]),
      });
      const payload: unknown = await response.json();
      const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      if (!response.ok) throw new Error(musicText(data.error) ? data.error : "Instagram audio is unavailable for this account.");
      if (epoch.current === version && audioEpoch.current === serial && !abort.signal.aborted) {
        const summary = contextual ? publicMusicRecommendation(data.recommendation) : null;
        const seen = new Set<string>();
        const tracks = (Array.isArray(data.audio) ? data.audio.slice(0, 6) : []).flatMap((value: unknown) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const track = value as { audio_id?: unknown; title?: unknown; display_artist?: unknown; preview_url?: unknown; recommendation?: unknown };
          if (!instagramAudioId(track?.audio_id) || typeof track.title !== "string" || !track.title.trim() || track.title.length > 200
              || typeof track.display_artist !== "string" || track.display_artist.length > 200 || /[\u0000-\u001f\u007f]/.test(`${track.title}${track.display_artist}`)) return [];
          const recommendation = contextual ? publicTrackRecommendation(track.recommendation) : undefined;
          if ((contextual && (!summary || !recommendation)) || seen.has(track.audio_id)) return [];
          seen.add(track.audio_id);
          const preview = instagramAudioPreviewUrl(track.preview_url);
          return [{ audio_id: track.audio_id, title: track.title.trim(), display_artist: track.display_artist.trim(), ...(preview ? { preview_url: preview } : {}), ...(recommendation ? { recommendation } : {}) }];
        });
        setAudioTracks(tracks);
        setAudioRecommendation(summary);
        setAudioError(musicText(data.reason) ? data.reason : !tracks.length ? contextual ? "No matching recommendation is available. Search for a track or artist, or keep the saved video's audio." : "No available Instagram audio was found. Try another search or keep the saved video's audio." : "");
      }
    } catch (cause) {
      if (epoch.current === version && audioEpoch.current === serial && !abort.signal.aborted) setAudioError(cause instanceof Error ? cause.message : "Could not check Instagram audio. No track is selected.");
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
  async function submit(job?: ReviewPublishJob) {
    if (!platform || inFlight.current || !confirmed || !setupChecked || (platform === "instagram" && (locationBusy || audioBusy || (!job && (postingDefaultsBusy || !instagramAudioReady))))) return;
    const channel = channels.find(item => item.platform === platform);
    if (!job && (!channel?.publishReady || !postingDownload(file, platform))) {
      setError("Connect this account with uploading permission before submitting."); return;
    }
    if (!job && platform === "instagram" && captionHashtags(caption).length > INSTAGRAM_HASHTAG_LIMIT) {
      setError("Instagram allows at most five hashtags per Reel. Remove extra hashtags before posting; your caption has not been changed."); return;
    }
    if (!job && platform === "instagram" && requestedUserTags === null) {
      setError(`Enter up to ${INSTAGRAM_USER_TAG_LIMIT} Instagram usernames, separated by commas or spaces. Do not enter profile URLs or Facebook Page IDs.`); return;
    }
    inFlight.current = true; setBusy(true); setError("");
    const version = epoch.current;
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify(job ? { action: job.kind === "story" ? "continue-story" : "continue", jobId: job.id, confirm: true } : {
          action: "create", platform, title, caption, privacy: platform === "instagram" ? "public" : privacy, madeForKids,
          connectionRevision: channel?.connectionRevision, confirm: true,
          ...(platform === "instagram" ? { companionStory: includeStory && storyCapability?.ready === true, ...(selectedLocation ? { location: { id: selectedLocation.id } } : {}),
            ...(requestedUserTags?.length ? { userTags: requestedUserTags } : {}),
            ...(selectedAudio ? { audio: { audio_id: selectedAudio.audio_id, audio_volume: Number(audioVolume), video_volume: Number(videoVolume) } } : {}) } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not submit the upload.");
      if (epoch.current === version) {
        setJobs(current => data.job.kind === "story" ? current.map(item => item.platform === "instagram" && !item.kind ? { ...item, companionStory: data.job } : item) : [...current.filter(item => item.id !== data.job.id), data.job]); setConfirmed(false);
      }
    } catch (cause) {
      if (epoch.current === version) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Submission response was interrupted. Check status before trying again; the saved request may already exist.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function rememberPostingChoices() {
    if (platform !== "instagram" || inFlight.current || postingDefaultsBusy || locationBusy || !publishReady || !channel?.connectionRevision || requestedUserTags === null || existing) return;
    inFlight.current = true; setBusy(true); setSavingPostingDefaults(true); setError(""); setNotice(""); setConfirmed(false);
    const version = epoch.current;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ action: "save-posting-defaults", confirm: true, connectionRevision: channel.connectionRevision,
          userTags: requestedUserTags, location: selectedLocation || null }) });
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
      if (epoch.current === version) { setStoryCapability(data.story); setIncludeStory(data.story?.ready === true); }
    } catch (cause) { if (epoch.current === version) setError(cause instanceof Error ? cause.message : "Story setup could not be confirmed. Reel posting is still available."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const channel = channels.find(item => item.platform === platform);
  const platformJobs = jobs.filter(item => item.platform === platform);
  const existing = platformJobs.length > 0;
  const name = platform === "youtube" ? "YouTube" : "Instagram";
  const output = platform ? postingDownload(file, platform) : null;
  const metadata = output ? file.outputs[output.target] : null;
  const instagramTags = platform === "instagram" ? captionHashtags(caption).length : 0;
  const publishReady = setupChecked && channel?.publishReady;
  const chooserId = `review-publish-${encodeURIComponent(file.id)}`;
  const locationSuggestions = instagramLocationSuggestions(file);
  const audioVolumesValid = [audioVolume, videoVolume].every(value => /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100);
  const instagramAudioReady = audioMode === "saved" || Boolean(selectedAudio && audioVolumesValid);
  const requestedUserTags = instagramUserTags(tagText.trim() ? tagText.trim().split(/[\s,]+/) : []);
  return <>
    <button type="button" className={button} disabled={busy} aria-expanded={chooserOpen} aria-controls={chooserId} onClick={() => setChooserOpen(true)}>Post / export</button>
    {chooserOpen && <section id={chooserId} aria-label="Post or export this video" className="w-full space-y-3 rounded-lg border border-[#bdc7a5] bg-white p-3">
      <div className="flex items-center justify-between gap-2"><h5 className="font-semibold">Post / export</h5><button type="button" className={button} onClick={close} disabled={busy}>Close</button></div>
      <div className="flex flex-wrap gap-2" aria-label="Choose a platform">
        <button type="button" className={button} disabled={busy} aria-pressed={platform === "youtube"} onClick={() => void open("youtube")}>Upload to YouTube</button>
        <button type="button" className={button} disabled={busy} aria-pressed={platform === "instagram"} onClick={() => void open("instagram")}>Post to Instagram</button>
      </div>
      {!platform && <p className="text-xs">Choose a platform to review posting choices or export the saved video. Opening this panel does not upload anything.</p>}
      {platform && <section aria-label={`${name} upload confirmation`} className="space-y-3">
      <h6 className="font-semibold">{name} · final posting review</h6>
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
          {job.userTags?.length ? <p>Approved Reel tags: {job.userTags.map(username => `@${username}`).join(", ")}</p> : null}
          {job.remoteUrl && <a className="underline" href={job.remoteUrl} target="_blank" rel="noopener noreferrer">View uploaded video ↗</a>}
          {job.canContinue && <><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !setupChecked}/><span>Continue this saved upload to {job.accountName}, using its saved posting choices.</span></label><button type="button" className={button} disabled={busy || !confirmed || !setupChecked} onClick={() => void submit(job)}>Continue saved upload</button></>}
          {job.companionStoryApproved && <div className="space-y-2 border-t border-[#bdc7a5] pt-2" aria-label="Matching Story status">
            {job.companionStory ? <><p className="font-semibold">Matching Story · {job.companionStory.status.replaceAll("_", " ")} · {Math.round(job.companionStory.percent)}%</p><p role="status">{job.companionStory.detail}</p>
              {job.companionStory.remoteId && <p>Published Story ID: {job.companionStory.remoteId}. Instagram Stories normally expire after 24 hours.</p>}
              {job.companionStory.canContinue && <><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !setupChecked}/><span>Continue only the matching Story. The completed Reel will not be published again.</span></label><button type="button" className={button} disabled={busy || !confirmed || !setupChecked} onClick={() => void submit(job.companionStory)}>Continue matching Story</button></>}
            </> : <p>Matching Story status is unavailable. Check the upload history; do not repost the completed Reel.</p>}
          </div>}
        </article>)}
        {existing ? <p className="text-xs">This output already has a saved {name} upload request. Check or continue that request instead of creating a duplicate.</p> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
          {platform === "youtube" && <label className="block text-xs">YouTube title<input className={input} maxLength={100} required value={title} onChange={event => { setTitle(event.target.value); setConfirmed(false); }} disabled={busy}/></label>}
          <label className="block text-xs">{platform === "youtube" ? "Description and hashtags" : "Caption and hashtags"}<textarea className={`${input} min-h-24`} maxLength={platform === "youtube" ? 5000 : 2200} value={caption} onChange={event => { setCaption(event.target.value); setConfirmed(false); }} disabled={busy}/></label>
          {platform === "instagram" && <p className={`text-xs ${instagramTags > INSTAGRAM_HASHTAG_LIMIT ? "text-red-800" : ""}`}>{instagramTags}/{INSTAGRAM_HASHTAG_LIMIT} Instagram hashtags. The candidate bank stays saved; remove extra hashtags here before publishing.</p>}
          {platform === "instagram" && <div aria-label="Instagram posting choices" className="space-y-1 text-xs">
            <p>Posting location · {selectedLocation?.name || locationQuery || "None selected"}{!selectedLocation && locationQuery && " · pending Meta verification; no location tag attached"}{(selectedLocation || locationQuery) && " · your posting choice, not verified filming evidence"}</p>
            <p>Reel tags · {requestedUserTags === null ? "Check usernames below" : requestedUserTags.length ? requestedUserTags.map(username => `@${username}`).join(", ") : "None selected"}</p>
            {postingDefaultsBusy && <p role="status">Checking saved posting choices…</p>}
            {postingDefaultsReason && <p role="status">{postingDefaultsReason}</p>}
          </div>}
          {platform === "instagram" && <details className="space-y-2 text-xs"><summary className="cursor-pointer">Tag people / pages · optional</summary>
            <label className="block">Instagram usernames<input className={input} maxLength={700} value={tagText} placeholder="@person, @brand" autoComplete="off" disabled={busy} onChange={event => changeTagText(event.target.value)}/></label>
            <p>Public Instagram accounts only, including brand/profile pages. Use usernames, not Facebook Page IDs or URLs. Meta checks whether each account permits tagging. These are Reel tags, not collaboration invitations; matching Stories are not tagged.</p>
            {requestedUserTags === null ? <p role="alert" className="text-red-800">Use up to {INSTAGRAM_USER_TAG_LIMIT} valid usernames separated by commas or spaces.</p> : requestedUserTags.length ? <p>Reel tags: {requestedUserTags.map(username => `@${username}`).join(", ")}</p> : <p>No accounts tagged. You can also type @mentions directly in the caption.</p>}
            <p>Remember the selected location tag and these usernames for this Instagram account. With no eligible tag selected, saving clears the remembered location. Saving these choices does not upload or publish a video.</p>
            <button type="button" className={button} disabled={busy || postingDefaultsBusy || locationBusy || !publishReady || requestedUserTags === null} onClick={() => void rememberPostingChoices()}>{savingPostingDefaults ? "Remembering posting choices…" : "Remember these posting choices"}</button>
          </details>}
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
          </details>}
          {platform === "instagram" && <section aria-label="Reel music" className="space-y-2 rounded-lg border border-[#bdc7a5] p-3 text-xs">
            <p className="font-semibold">Reel music</p>
            <label className="flex items-center gap-2"><input type="radio" name={`${chooserId}-music`} checked={audioMode === "instagram"} disabled={busy || audioBusy} onChange={() => { setAudioMode("instagram"); setConfirmed(false); }}/><span>Use Instagram music</span></label>
            <label className="flex items-center gap-2"><input type="radio" name={`${chooserId}-music`} checked={audioMode === "saved"} disabled={busy} onChange={() => { changeAudioQuery(""); setAudioMode("saved"); }}/><span>Keep saved video audio</span></label>
            {audioMode === "instagram" ? <>
            <p className="mt-2">Preference: English songs + instrumentals. Leave the search blank for recommendations, or enter a track or artist to choose your own music. Meta&apos;s API catalog differs from the Instagram app; some songs are unavailable.</p>
            <p>Recommendations use sampled visual evidence to suggest a mood fit. Audio listening, BPM measurement and whole-video analysis are not performed. The local MP4 stays unchanged.</p>
            <label className="block">Track or artist<input type="search" className={input} value={audioQuery} maxLength={100} disabled={busy} onChange={event => changeAudioQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchAudio(); } }}/></label>
            <button type="button" className={button} disabled={busy || audioBusy || !publishReady} onClick={() => void searchAudio()}>{audioBusy ? "Checking Instagram audio…" : "Find Instagram audio"}</button>
            {audioRecommendation && <p role="status">Visual mood: {audioRecommendation.mood} · energy: {audioRecommendation.energy}. {audioRecommendation.basis === "sampled-frames" ? "Based on sampled frames." : "Based on saved observations of sampled frames."} {audioRecommendation.reason}</p>}
            {audioError && <p role="status">{audioError}</p>}
            {audioTracks.map(track => <div key={track.audio_id} className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={busy || audioBusy} aria-pressed={selectedAudio?.audio_id === track.audio_id} onClick={() => { setSelectedAudio(track); setConfirmed(false); }}>{track.title}{track.display_artist ? ` · ${track.display_artist}` : ""}</button>{track.recommendation && <span>#{track.recommendation.rank} · {track.recommendation.kind === "english-vocal" ? "English vocals" : "Instrumental"} · {track.recommendation.reason}</span>}{track.preview_url && <a className="underline" href={track.preview_url} target="_blank" rel="noopener noreferrer">Preview on Instagram</a>}</div>)}
            {selectedAudio ? <><p>Selected: {selectedAudio.title}{selectedAudio.display_artist ? ` · ${selectedAudio.display_artist}` : ""}</p><div className="grid gap-2 sm:grid-cols-2">
              <label>Instagram track volume (%)<input className={input} type="number" min={1} max={100} step={1} value={audioVolume} disabled={busy || audioBusy} onChange={event => { setAudioVolume(event.target.value); setConfirmed(false); }}/></label>
              <label>Saved video volume (%)<input className={input} type="number" min={1} max={100} step={1} value={videoVolume} disabled={busy || audioBusy} onChange={event => { setVideoVolume(event.target.value); setConfirmed(false); }}/></label>
            </div>{!audioVolumesValid && <p role="status">Both volumes must be whole numbers from 1 to 100.</p>}<p>Meta cannot preview the combined Reel before publishing. This track applies to the Reel; a matching Story keeps the saved MP4&apos;s audio.</p></> : <p role="status">Choose an Instagram track before publishing, or explicitly keep the saved video audio above. Nothing is selected automatically.</p>}
            </> : <p>The saved MP4 audio will be posted. No Instagram track will be added.</p>}
          </section>}
          {platform === "instagram" && <div className="space-y-1 text-xs"><label className="flex items-start gap-2"><input type="checkbox" checked={includeStory} disabled={busy || storyCapability?.ready !== true} onChange={event => { setIncludeStory(event.target.checked); setConfirmed(false); }}/><span>Also publish one matching Story after this Reel succeeds.</span></label><p>{storyCapability?.reason || "Automatic Stories need a confirmed Business account, publishing access and a saved video within Story limits. Meta makes the final eligibility check. Otherwise add it manually; Reel posting is unaffected."}</p></div>}
          {platform === "instagram" && storyCapability?.requiresBusinessConfirmation && <details className="text-xs"><summary className="cursor-pointer">Confirm Business account for Stories</summary><p className="mt-2">Check Instagram → Settings → Business tools and controls. Creator accounts need a type switch first. This only records your confirmation; it does not change Instagram or post anything.</p><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={businessConfirmed} disabled={busy} onChange={event => setBusinessConfirmed(event.target.checked)}/><span>I checked: {channel?.name} is a Business account.</span></label><button type="button" className={`${button} mt-2`} disabled={busy || !businessConfirmed || !publishReady} onClick={() => void enableStories()}>Enable matching Stories</button></details>}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !publishReady}/><span>I have reviewed this video, hold the required rights, and approve {platform === "instagram" ? includeStory ? "publishing this Reel publicly and then its matching Story" : "publishing this Reel publicly" : `uploading this video as ${privacy}`} to {channel?.name || name}.</span></label>
          <button type="submit" className={button} disabled={busy || !confirmed || !publishReady || !output || instagramTags > INSTAGRAM_HASHTAG_LIMIT || (platform === "instagram" && (requestedUserTags === null || postingDefaultsBusy || locationBusy || audioBusy || !instagramAudioReady)) || (platform === "youtube" && !title.trim())}>{busy ? savingPostingDefaults ? "Remembering posting choices…" : "Saving upload request…" : platform === "instagram" ? includeStory ? "Confirm Reel + Story" : "Confirm and publish Reel" : "Confirm upload"}</button>
        </form>}
        <button type="button" className={button} disabled={busy} onClick={() => void open(platform)}>Check status</button>
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
