"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import RecommendedIdeas from "@/components/RecommendedIdeas";
import NewsIdeas from "@/components/NewsIdeas";
import type { NewsIdea } from "@/lib/newsResearch";
import { applyRecommendationToForm, type CreationKind, type CreationRecommendation } from "@/lib/creationRecommendations";
import { creationIntent } from "@/lib/creationIntent";
import {
  PUBLISHING_PROFILES,
  publishingProfile,
  type PublishingFormat,
} from "@/lib/publishingFormats";

type Kind = CreationKind;

function defaultFormat(kind: Kind): PublishingFormat {
  return kind === "Children's song" ? "youtube-full" : "youtube-short";
}

export default function AICreation({ onClose, onStarted, initialKind = "General video", initialTopic }: { onClose: () => void; onStarted: (message?: string) => void; initialKind?: Kind; initialTopic?: string }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [topic, setTopic] = useState<string>(initialTopic || "");
  const [autoIdea, setAutoIdea] = useState(false);
  const [publishingFormat, setPublishingFormat] = useState<PublishingFormat>(defaultFormat(initialKind));
  const [duration, setDuration] = useState<number>(publishingProfile(defaultFormat(initialKind)).defaultDuration);
  const [batchCount, setBatchCount] = useState<1 | 10>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [songAudio, setSongAudio] = useState<{id:string;filename:string;duration:number}|null>(null);
  const [lyrics, setLyrics] = useState("");
  const [songMode, setSongMode] = useState<"recording" | "local-ace">("recording");
  const [singing, setSinging] = useState<{ available: boolean; reason: string } | null>(null);
  const [songStyle, setSongStyle] = useState("Acoustic guitar, glockenspiel, handclaps, a cheerful melody and a memorable chorus.");
  const [narration, setNarration] = useState("");
  const [visualBrief, setVisualBrief] = useState("");
  const [uploadingSong, setUploadingSong] = useState(false);
  const [recommendationNotice, setRecommendationNotice] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedNews, setSelectedNews] = useState<NewsIdea | null>(null);
  const submitInFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const children = kind.startsWith("Children");
  useEffect(() => {
    if (kind !== "Children's song") return;
    const controller = new AbortController();
    void fetch("/api/singing/status", { signal: controller.signal }).then(r => r.json()).then(setSinging).catch(() => undefined);
    return () => controller.abort();
  }, [kind]);

  function changeTopic(value: string) {
    setSelectedNews(null);
    setTopic(value);
    const nextKind = creationIntent(value);
    if (nextKind !== kind) {
      setKind(nextKind);
      setBatchCount(1);
      setAutoIdea(false);
      if (nextKind === "Children's song" || publishingFormat === "youtube-full") {
        const format = defaultFormat(nextKind);
        setPublishingFormat(format);
        setDuration(publishingProfile(format).defaultDuration);
      }
    }
    setRecommendationNotice("");
  }

  function chooseRecommendation(idea: CreationRecommendation) {
    setSelectedNews(null);
    const next = applyRecommendationToForm({ kind, topic, autoIdea, publishingFormat, duration, batchCount, narration, visualBrief, lyrics, songMode, songAudio }, idea);
    setKind(next.kind);
    setTopic(next.topic);
    setAutoIdea(next.autoIdea);
    setPublishingFormat(next.publishingFormat);
    setDuration(next.duration);
    setBatchCount(next.batchCount);
    setSuggestionsOpen(false);
    // Choosing inspiration must not discard owner writing or switch a saved
    // recording to a generator. These fields remain under the owner's control.
    setRecommendationNotice(`${next.kind} selected. Nothing has been queued.${narration.trim() || visualBrief.trim() || lyrics.trim() || songAudio ? " Your writing and any song recording are kept; check that they match this idea before creating." : ""}`);
  }

  function chooseNews(idea: NewsIdea) {
    setSelectedNews(idea); setTopic(idea.title); setKind("General video");
    setAutoIdea(false); setBatchCount(1); setPublishingFormat("youtube-short"); setDuration(60);
    setSuggestionsOpen(false);
    setRecommendationNotice("News report selected. Phoenix will read the report and attribute its claims; footage is illustrative. Review the final video and verify developments before posting.");
  }

  function changePublishingFormat(value: PublishingFormat) {
    setPublishingFormat(value);
    setDuration(publishingProfile(value).defaultDuration);
    if (value === "youtube-full") setBatchCount(1);
    else if (kind === "Children's short story") setBatchCount(10);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const creationType = kind === "Children's short story"
        ? "children-story"
        : kind === "Children's song"
          ? "children-song"
          : kind === "Business video"
            ? "business"
            : "general";
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsId: selectedNews?.id,
          planOnly: false,
          songMode,
          songStyle,
          requestId: requestId.current,
          songAudioId: kind === "Children's song" && songMode === "recording" ? songAudio?.id : undefined,
          script: selectedNews ? undefined : kind === "Children's song" ? lyrics : (batchCount === 1 && narration.trim()) ? narration : undefined,
          visualTerms: !selectedNews && !children && visualBrief.trim() ? visualBrief.split("\n").map(term => term.trim()).filter(Boolean) : undefined,
          topic,
          autoIdea: children && autoIdea,
          duration,
          publishingFormat,
          batchCount,
          visualSource: children ? "local-ai" : "stock",
          creationType,
          language: "English",
          voice: "local-windows-voice",
          subtitleStyle: "clear-bold",
          audienceAge: children ? "3-6" : undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "Creation could not be queued.");
        return;
      }
      requestId.current = crypto.randomUUID();
      onStarted(data?.count === 10
        ? "Ten videos queued. Phoenix will plan and render them one at a time. Review only the finished videos in Review Files."
        : "Video queued. Phoenix will plan and render it automatically. Watch Creation preparation and Live jobs; review the finished video in Review Files.");
      onClose();
    } catch {
      setError("Phoenix could not reach a required service. Check Studio health for the selected writer and local renderer; your saved jobs are retained.");
    } finally {
      submitInFlight.current = false;
      setBusy(false);
    }
  }

  async function uploadSong(file:File|undefined){
    if(!file)return;setUploadingSong(true);setError("");setSongAudio(null);
    try{const response=await fetch('/api/song-audio',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-phoenix-filename':encodeURIComponent(file.name)},body:file});const data=await response.json();if(!response.ok)throw new Error(data.error);setSongAudio(data);}
    catch(e){setError(e instanceof Error?e.message:'Could not upload song.');}finally{setUploadingSong(false);}
  }

  return (
    <section className="mt-5 rounded-[1.5rem] border border-[#bfcaa6] bg-white p-5">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[#75834f]">Create a video</p>
          <h3 className="mt-1 text-xl font-semibold">What is your idea?</h3>
        </div>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
      </div>

      <form onSubmit={(event) => void create(event)} className="mt-5 space-y-4">
        <details className="rounded-xl border border-[#cad7a4] bg-[#f4f8e8] p-3">
          <summary className="cursor-pointer text-sm font-semibold">How Phoenix will make this</summary>
          <p className="flex items-center gap-2 text-sm font-bold text-[#3d5428]">
            <ShieldCheck className="h-4 w-4" />
            {children ? "Original illustrated animation" : "Real stock footage with narration"}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#647451]">
            {children
              ? "Ages 3–6 by default. Phoenix plans the story and renders original 2D characters automatically. This is illustrated animation, not studio-quality 3D or anime. Songs use a sung recording or an available local singing engine."
              : "Your selected writer plans the narration, or you supply it below. Phoenix selects real Pexels footage by the shot brief, duration and format, then renders locally. You review only the finished video. Groq writing sends text only; video files stay on this PC."}
            {" "}No paid AI provider or automatic posting is used.
            {" "}Laptop-safe rendering runs one Phoenix export at a time with at most two CPU threads.
          </p>
        </details>

        {kind === "Children's song" ? <section className="space-y-3 rounded-xl border border-[#bfcaa6] bg-[#f7faef] p-4">
          <h4 className="font-semibold">Real singing + music</h4>
          <label className="block text-sm font-semibold">Song source<select value={songMode} onChange={event => setSongMode(event.target.value as typeof songMode)} className="mt-1 w-full rounded-lg border bg-white p-2">
            <option value="recording">Use my sung recording · free</option>
            <option value="local-ace" disabled={!singing?.available}>Generate with local ACE-Step · {singing?.available ? "ready" : "unavailable on this PC"}</option>
          </select></label>
          <p className="text-xs leading-5 text-[#647451]">{singing?.reason || "Checking the free local singing engine…"} Phoenix never substitutes spoken narration for singing. <a className="underline" href="https://github.com/ace-step/ACE-Step-1.5" target="_blank" rel="noreferrer">Free engine documentation</a></p>
          {songMode === "recording" ? <><label className="block text-sm font-semibold">Sung audio with accompaniment<input className="mt-2 block w-full text-sm" type="file" accept=".mp3,.wav,.m4a,.flac,.ogg,.aac" disabled={uploadingSong||busy} onChange={e=>void uploadSong(e.target.files?.[0])}/></label>{uploadingSong?<p role="status" className="text-sm">Saving and checking song recording…</p>:songAudio?<p className="text-sm">{songAudio.filename} · {Math.floor(songAudio.duration)} seconds</p>:null}</> : <label className="block text-sm font-semibold">Musical direction<textarea rows={3} value={songStyle} onChange={event => setSongStyle(event.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border p-2" /></label>}
          <label className="block text-sm font-semibold">Lyrics, one line at a time<textarea rows={6} className="mt-1 w-full rounded-xl border p-2 font-normal" value={lyrics} maxLength={20000} onChange={e=>setLyrics(e.target.value)} placeholder={songMode === "recording" ? "Paste the exact words sung in your recording" : "Write original lyrics, or leave blank for the local composer"} required={songMode === "recording"}/></label>
          <p className="text-xs text-[#647451]">Listen to the complete finished video before posting. Caption timing is an estimate; adjust it in Edit video if needed. Use only audio and lyrics you have permission to publish.</p>
        </section> : null}

        {children && kind !== "Children's song" ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="checkbox"
              checked={autoIdea}
              onChange={(event) => setAutoIdea(event.target.checked)}
              className="mt-1"
            />
            <span>
              <strong className="flex items-center gap-1"><WandSparkles className="h-4 w-4" />Let Phoenix invent everything</strong>
              <span className="mt-1 block text-xs text-[#687657]">Phoenix chooses a fresh idea, characters, setting, and positive lesson.</span>
            </span>
          </label>
        ) : null}

        {!children || !autoIdea ? (
          <>
            <details open={suggestionsOpen} onToggle={event => setSuggestionsOpen(event.currentTarget.open)} className="rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-semibold">Explore suggestions</summary>
              {suggestionsOpen ? <><RecommendedIdeas onChoose={chooseRecommendation} /><NewsIdeas onChoose={chooseNews} /></> : null}
            </details>
            {recommendationNotice ? <p role="status" className="text-xs text-[#657153]">{recommendationNotice}</p> : null}
            {selectedNews ? <p className="text-xs"><a href={selectedNews.url} target="_blank" rel="noreferrer" className="underline">Source: BBC News · {new Date(selectedNews.publishedAt).toLocaleDateString()}</a> · Single-source report, not independently verified.</p> : null}
            <label className="block text-sm font-semibold">
              Describe the video you want
              <textarea
                value={topic}
                onChange={(event) => changeTopic(event.target.value)}
                rows={3}
                placeholder="Explain an interesting topic, show a craft, or tell an animated bedtime story for children…"
                className="mt-1 w-full rounded-xl border p-2 font-normal"
                maxLength={500}
                required
              />
            </label>
            <p className="text-xs text-[#657153]">No category to choose. Describe the subject and audience; Phoenix picks the workflow. For children's animation or songs, say so in your idea.</p>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-[#bfcaa6] p-3 text-sm text-[#687657]">
            You do not need to type a prompt. Phoenix will create a new concept by itself.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Publishing format
            <select
              value={publishingFormat}
              onChange={(event) => changePublishingFormat(event.target.value as PublishingFormat)}
              className="mt-1 w-full rounded-xl border p-2 font-normal"
            >
              {Object.entries(PUBLISHING_PROFILES)
                .filter(([value]) => kind === "Children's song" || value !== "youtube-full")
                .map(([value, profile]) => (
                <option key={value} value={value}>{profile.label} · {profile.aspect}</option>
                ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Length per video
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-1 w-full rounded-xl border p-2 font-normal">
              {publishingProfile(publishingFormat).durationOptions.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : `${seconds} seconds`}</option>
              ))}
            </select>
          </label>
        </div>

        {selectedNews ? <p className="text-xs text-[#657153]">Report mode uses source-based narration and illustrative footage. Your custom narration and visual brief are kept for other ideas, but are not used for this report. Edit the idea above to leave report mode.</p> : !children ? <details className="space-y-3 rounded-xl border border-[#bfcaa6] bg-[#f7faef] p-4">
          <summary className="cursor-pointer font-semibold">Narration & visual brief (optional)</summary>
          <label className="block text-sm font-semibold">Your narration (optional)<textarea rows={5} maxLength={20000} value={narration} onChange={event => setNarration(event.target.value)} placeholder="Leave blank for your selected writer, or write the exact narration you want." className="mt-1 w-full rounded-lg border bg-white p-2 font-normal" /></label>
          <p className="text-xs text-[#647451]">For {duration} seconds, use {Math.max(100, Math.round(duration * 2.35))}–{Math.min(650, Math.max(120, Math.round(duration * 3.1)))} words. Your supplied narration will not be silently replaced with a generic script.</p>
          <label className="block text-sm font-semibold">Visual search brief (optional, one scene per line)<textarea rows={4} maxLength={650} value={visualBrief} onChange={event => setVisualBrief(event.target.value)} placeholder={kind === "Business video" ? "customer speaking to shop assistant\nshop assistant listening\ncustomer collecting purchase" : "person opening bedroom curtains\npouring water into glass\nwriting a morning plan"} className="mt-1 w-full rounded-lg border bg-white p-2 font-normal" /></label>
          <p className="text-xs text-[#647451]">Up to 8 short, concrete searches in story order. Use a consistent setting and subject. Leave blank for automatic shot planning. Selection checks catalog metadata, not the actual frames; judge visual relevance in the final review.</p>
        </details> : null}
        {kind === "Children's short story" && batchCount === 1 ? <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">Your story (optional)</summary><label className="block text-sm font-semibold">Story text<textarea rows={5} maxLength={20000} value={narration} onChange={event => setNarration(event.target.value)} className="mt-1 w-full rounded-lg border p-2 font-normal" placeholder="Write your own story, or leave blank for automatic local planning." /></label></details> : null}

        {kind === "Children's short story" && publishingFormat !== "youtube-full" ? (
          <label className="block rounded-xl border border-[#cad7a4] bg-[#f7faef] p-4 text-sm font-semibold">
            Output quantity
            <select
              value={batchCount}
              onChange={(event) => setBatchCount(Number(event.target.value) as 1 | 10)}
              className="mt-2 w-full rounded-xl border bg-white p-2 font-normal"
            >
              <option value={10}>10-part story series · 10 distinct videos</option>
              <option value={1}>One standalone video</option>
            </select>
            {batchCount === 10 ? (
              <span className="mt-2 block text-xs font-normal leading-5 text-[#647451]">
                Phoenix keeps the same original characters and world, gives every part its own hook and ending, and renders the ten files one at a time for laptop stability.
              </span>
            ) : null}
          </label>
        ) : null}

        <div className="rounded-xl bg-[#f3f0e5] p-3 text-xs leading-5 text-[#5f654d]">
          {publishingProfile(publishingFormat).shortLabel} uses {publishingProfile(publishingFormat).aspect}. Content is checked for originality and prepared for manual review; attention or earnings are never guaranteed.
        </div>

        {error ? <p role="alert" className="rounded-xl bg-[#fff1e8] p-3 text-sm text-[#a74c2c]">{error}</p> : null}
        <Button type="submit" disabled={busy || uploadingSong || (kind === "Children's song" && (songMode === "recording" ? !songAudio || !lyrics.trim() : !singing?.available))} className="bg-[#26331f] px-5 text-white">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {busy
            ? "Queuing your video…"
            : batchCount === 10
              ? "Create 10 story videos"
              : "Create video"}
        </Button>
      </form>
    </section>
  );
}
