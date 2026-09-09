"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PUBLISHING_PROFILES,
  publishingProfile,
  type PublishingFormat,
} from "@/lib/publishingFormats";

const suggestions = {
  "Children's short story": [
    "A puppy and kitten build a rainbow kite",
    "A shy little moon learns to glow",
    "Two forest friends rescue a lost star",
  ],
  "Children's song": [
    "A jumping-and-clapping kindness song",
    "A silly animal clean-up song",
    "A gentle bedtime song about fireflies",
  ],
  "Business video": [
    "Three ways to improve customer service",
    "A simple weekly planning habit",
  ],
  "General video": [
    "A small habit that makes mornings calmer",
    "How to learn one useful skill",
  ],
} as const;

type Kind = keyof typeof suggestions;

function defaultFormat(kind: Kind): PublishingFormat {
  return kind === "Children's song" ? "youtube-full" : "youtube-short";
}

export default function AICreation({ onClose, onStarted }: { onClose: () => void; onStarted: (message?: string) => void }) {
  const [kind, setKind] = useState<Kind>("Children's short story");
  const [topic, setTopic] = useState<string>(suggestions["Children's short story"][0]);
  const [autoIdea, setAutoIdea] = useState(true);
  const [publishingFormat, setPublishingFormat] = useState<PublishingFormat>("youtube-short");
  const [duration, setDuration] = useState<number>(publishingProfile("youtube-short").defaultDuration);
  const [batchCount, setBatchCount] = useState<1 | 10>(10);
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
  const submitInFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const children = kind.startsWith("Children");
  useEffect(() => {
    if (kind !== "Children's song") return;
    const controller = new AbortController();
    void fetch("/api/singing/status", { signal: controller.signal }).then(r => r.json()).then(setSinging).catch(() => undefined);
    return () => controller.abort();
  }, [kind]);

  function changeKind(value: Kind) {
    const isChildren = value.startsWith("Children");
    setKind(value);
    setNarration("");
    setVisualBrief("");
    setTopic(suggestions[value][0]);
    setAutoIdea(isChildren && value !== "Children's song");
    const format = defaultFormat(value);
    setPublishingFormat(format);
    setDuration(publishingProfile(format).defaultDuration);
    setBatchCount(value === "Children's short story" ? 10 : 1);
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
          planOnly: true,
          songMode,
          songStyle,
          requestId: requestId.current,
          songAudioId: kind === "Children's song" && songMode === "recording" ? songAudio?.id : undefined,
          script: kind === "Children's song" ? lyrics : (batchCount === 1 && narration.trim()) ? narration : undefined,
          visualTerms: !children && visualBrief.trim() ? visualBrief.split("\n").map(term => term.trim()).filter(Boolean) : undefined,
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
        ? "Ten story drafts were queued for planning. Review each one in Storyboard approval; no video renders until you approve it."
        : "Your draft was queued for planning. Open Storyboard approval below to review it before rendering.");
      onClose();
    } catch {
      setError("Phoenix could not reach its free local services. Keep Phoenix Studio, Ollama, and the local stock service running.");
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
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[#75834f]">AI creation</p>
          <h3 className="mt-1 text-xl font-semibold">Plan → review → render</h3>
        </div>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
      </div>

      <form onSubmit={(event) => void create(event)} className="mt-5 space-y-4">
        <label className="block text-sm font-semibold">
          Creation type
          <select
            value={kind}
            onChange={(event) => changeKind(event.target.value as Kind)}
            className="mt-1 w-full rounded-xl border p-2 font-normal"
          >
            {Object.keys(suggestions).map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>

        <div className="rounded-xl border border-[#cad7a4] bg-[#f4f8e8] p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-[#3d5428]">
            <ShieldCheck className="h-4 w-4" />
            100% free {children ? "children mode" : "local + free-stock mode"}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#647451]">
            {children
              ? "Ages 3–6 by default. Preview the original 2D characters and story before rendering. This is illustrated animation, not studio-quality 3D or anime. Songs use a sung recording or an available local singing engine."
              : "Local Ollama writes the narration, or you supply it below. Review the story, search actual Pexels footage, and approve the exact clips before a video renders. No random replacement footage."}
            {" "}No paid AI provider or automatic posting is used.
            {" "}Laptop-safe rendering runs one Phoenix export at a time with at most two CPU threads.
          </p>
        </div>

        {kind === "Children's song" ? <section className="space-y-3 rounded-xl border border-[#bfcaa6] bg-[#f7faef] p-4">
          <h4 className="font-semibold">Real singing + music</h4>
          <label className="block text-sm font-semibold">Song source<select value={songMode} onChange={event => setSongMode(event.target.value as typeof songMode)} className="mt-1 w-full rounded-lg border bg-white p-2">
            <option value="recording">Use my sung recording · free</option>
            <option value="local-ace" disabled={!singing?.available}>Generate with local ACE-Step · {singing?.available ? "ready" : "unavailable on this PC"}</option>
          </select></label>
          <p className="text-xs leading-5 text-[#647451]">{singing?.reason || "Checking the free local singing engine…"} Phoenix never substitutes spoken narration for singing. <a className="underline" href="https://github.com/ace-step/ACE-Step-1.5" target="_blank" rel="noreferrer">Free engine documentation</a></p>
          {songMode === "recording" ? <><label className="block text-sm font-semibold">Sung audio with accompaniment<input className="mt-2 block w-full text-sm" type="file" accept=".mp3,.wav,.m4a,.flac,.ogg,.aac" disabled={uploadingSong||busy} onChange={e=>void uploadSong(e.target.files?.[0])}/></label>{uploadingSong?<p role="status" className="text-sm">Saving and checking song recording…</p>:songAudio?<p className="text-sm">{songAudio.filename} · {Math.floor(songAudio.duration)} seconds</p>:null}</> : <label className="block text-sm font-semibold">Musical direction<textarea rows={3} value={songStyle} onChange={event => setSongStyle(event.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border p-2" /></label>}
          <label className="block text-sm font-semibold">Lyrics, one line at a time<textarea rows={6} className="mt-1 w-full rounded-xl border p-2 font-normal" value={lyrics} maxLength={20000} onChange={e=>setLyrics(e.target.value)} placeholder={songMode === "recording" ? "Paste the exact words sung in your recording" : "Write original lyrics, or leave blank for the local composer"} required={songMode === "recording"}/></label>
          <p className="text-xs text-[#647451]">Listen to the complete song in the draft before approving. Caption timing is an estimate; check it in Edit video before posting. Use only audio and lyrics you have permission to publish.</p>
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
            <div className="flex flex-wrap gap-2">
              {suggestions[kind].map((idea) => (
                <button
                  type="button"
                  key={idea}
                  onClick={() => setTopic(idea)}
                  className="rounded-full border border-[#bfcaa6] px-3 py-1 text-xs hover:bg-[#eef3df]"
                >
                  {idea}
                </button>
              ))}
            </div>
            <label className="block text-sm font-semibold">
              Your idea
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="mt-1 w-full rounded-xl border p-2 font-normal"
                maxLength={500}
                required
              />
            </label>
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

        {!children ? <section className="space-y-3 rounded-xl border border-[#bfcaa6] bg-[#f7faef] p-4">
          <h4 className="font-semibold">Editorial brief</h4>
          <label className="block text-sm font-semibold">Your narration (optional)<textarea rows={5} maxLength={20000} value={narration} onChange={event => setNarration(event.target.value)} placeholder="Leave blank for local Ollama, or write the exact narration you want." className="mt-1 w-full rounded-lg border bg-white p-2 font-normal" /></label>
          <p className="text-xs text-[#647451]">For {duration} seconds, use {Math.max(100, Math.round(duration * 2.35))}–{Math.min(650, Math.max(120, Math.round(duration * 3.1)))} words. Your supplied narration will not be silently replaced with a generic script.</p>
          <label className="block text-sm font-semibold">Visual search brief (optional, one scene per line)<textarea rows={4} maxLength={650} value={visualBrief} onChange={event => setVisualBrief(event.target.value)} placeholder={kind === "Business video" ? "customer speaking to shop assistant\nshop assistant listening\ncustomer collecting purchase" : "person opening bedroom curtains\npouring water into glass\nwriting a morning plan"} className="mt-1 w-full rounded-lg border bg-white p-2 font-normal" /></label>
          <p className="text-xs text-[#647451]">Up to 8 short, concrete searches in story order. Use a consistent setting and subject. Leave blank to derive keywords from the narration; stock results still need your review.</p>
        </section> : null}
        {kind === "Children's short story" && batchCount === 1 ? <label className="block text-sm font-semibold">Your story (optional)<textarea rows={5} maxLength={20000} value={narration} onChange={event => setNarration(event.target.value)} className="mt-1 w-full rounded-lg border p-2 font-normal" placeholder="Write your own story, or leave blank for local planning. You can edit it before rendering." /></label> : null}

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
            ? "Queuing the draft…"
            : batchCount === 10
              ? "Plan 10 story drafts"
              : "Plan video for approval"}
        </Button>
      </form>
    </section>
  );
}
