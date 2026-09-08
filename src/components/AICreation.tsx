"use client";

import { useRef, useState } from "react";
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
  const [narration, setNarration] = useState("");
  const [visualBrief, setVisualBrief] = useState("");
  const [uploadingSong, setUploadingSong] = useState(false);
  const submitInFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const children = kind.startsWith("Children");

  function changeKind(value: Kind) {
    const isChildren = value.startsWith("Children");
    setKind(value);
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
          requestId: requestId.current,
          songAudioId: kind === "Children's song" ? songAudio?.id : undefined,
          script: kind === "Children's song" ? lyrics : !children && narration.trim() ? narration : undefined,
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
        ? "Ten story episodes were queued. Phoenix will render them one at a time and keep every result in Review Files."
        : "Your local video job was queued. Live stages appear below.");
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
          <h3 className="mt-1 text-xl font-semibold">Create an original video</h3>
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
              ? "Ages 3–6 by default. The installed renderer makes simple 2D cut-out animation, not anime or studio-quality 3D. Stories use local narration. Songs need your sung recording."
              : "Local Ollama writes the narration, or you supply it below. Pexels footage follows an ordered keyword brief. This is a stock edit, not generated visuals or verified shot-to-speech matching."}
            {" "}No paid AI provider or automatic posting is used.
            {" "}Laptop-safe rendering runs one Phoenix export at a time with at most two CPU threads.
          </p>
        </div>

        {kind === "Children's song" ? <section className="rounded-xl border border-[#bfcaa6] bg-[#f7faef] p-4"><h4 className="font-semibold">Song recording</h4><p className="mt-1 text-xs leading-5 text-[#647451]">Choose a recording that already contains singing and music. Phoenix preserves its pitch and animates it. Automatic singing is not installed on this laptop; the narration voice cannot sing.</p><label className="mt-3 block text-sm font-semibold">Sung audio file<input className="mt-2 block w-full text-sm" type="file" accept=".mp3,.wav,.m4a,.flac,.ogg,.aac" disabled={uploadingSong||busy} onChange={e=>void uploadSong(e.target.files?.[0])}/></label>{uploadingSong?<p role="status" className="mt-2 text-sm">Saving and checking song recording…</p>:songAudio?<p className="mt-2 text-sm">{songAudio.filename} · {Math.floor(songAudio.duration)} seconds</p>:null}<label className="mt-3 block text-sm font-semibold">Lyrics, one line at a time<textarea rows={6} className="mt-1 w-full rounded-xl border p-2 font-normal" value={lyrics} maxLength={20000} onChange={e=>setLyrics(e.target.value)} placeholder="Paste the words sung in your recording" required/></label><p className="mt-2 text-xs text-[#647451]">Caption timing starts as an estimate. Use Edit video to adjust it to the recording.</p></section>:null}

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
        <Button type="submit" disabled={busy || uploadingSong || (kind === "Children's song" && (!songAudio || !lyrics.trim()))} className="bg-[#26331f] px-5 text-white">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {busy
            ? "Checking and queuing locally…"
            : batchCount === 10
              ? "Create 10-part story series"
              : children
                ? "Create children's video"
                : "Create free stock video"}
        </Button>
      </form>
    </section>
  );
}
