"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { NaturalStock } from "@/lib/naturalStock";
import { DEFAULT_STOCK_REEL_OPTIONS, MAX_STOCK_SHOTS, planStockIntervals, type StockReelOptions } from "@/lib/stockReel";
import { Button } from "./ui/button";

type SelectedShot = { video: NaturalStock; start: number; end: number };
const identity = (video: NaturalStock) => `${video.provider}:${video.id}`;

export default function StockReels({ initialQuery = "forest waterfall", onClose, onStarted }: { initialQuery?: string; onClose: () => void; onStarted: (message: string) => void }) {
  const [query, setQuery] = useState(initialQuery), [provider, setProvider] = useState("all"), [videos, setVideos] = useState<NaturalStock[]>([]);
  const [configured, setConfigured] = useState<{ pexels: boolean; pixabay: boolean } | null>(null);
  const [selected, setSelected] = useState<NaturalStock | null>(null), [caption, setCaption] = useState(""), [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [shots, setShots] = useState<SelectedShot[]>([]), [trimStart, setTrimStart] = useState(0), [trimEnd, setTrimEnd] = useState(0);
  const [theme, setTheme] = useState(initialQuery), [options, setOptions] = useState<StockReelOptions>(DEFAULT_STOCK_REEL_OPTIONS);
  const inFlight = useRef(false), requestId = useRef(crypto.randomUUID()), preview = useRef<HTMLVideoElement>(null);
  useEffect(() => { setQuery(initialQuery); setTheme(initialQuery); setVideos([]); setSelected(null); setShots([]); requestId.current = crypto.randomUUID(); }, [initialQuery]);
  const changed = () => { requestId.current = crypto.randomUUID(); };
  const activeShots = shots.length ? shots : selected ? [{ video: selected, start: trimStart, end: trimEnd || selected.duration }] : [];
  let plan: ReturnType<typeof planStockIntervals> = [], planError = "";
  if (activeShots.length) {
    try { plan = planStockIntervals(activeShots.map(shot => ({ duration: shot.video.duration, start: shot.start, end: shot.end })), duration); }
    catch (error) { planError = error instanceof Error ? error.message : "Choose a readable footage interval."; }
  }
  const actualDuration = plan.length ? plan[plan.length - 1].outputEnd : 0;
  function choose(video: NaturalStock) { const prior = shots.find(shot => identity(shot.video) === identity(video)); setSelected(video); setTrimStart(prior?.start ?? 0); setTrimEnd(prior?.end ?? video.duration); changed(); }
  function option<Key extends keyof StockReelOptions>(key: Key, value: StockReelOptions[Key]) { setOptions(previous => ({ ...previous, [key]: value })); changed(); }
  function addShot() {
    if (!selected || (shots.length >= MAX_STOCK_SHOTS && !shots.some(shot => identity(shot.video) === identity(selected)))) return;
    try {
      planStockIntervals([{ duration: selected.duration, start: trimStart, end: trimEnd || selected.duration }], 105);
      setShots(previous => previous.some(shot => identity(shot.video) === identity(selected)) ? previous.map(shot => identity(shot.video) === identity(selected) ? { video: selected, start: trimStart, end: trimEnd || selected.duration } : shot) : [...previous, { video: selected, start: trimStart, end: trimEnd || selected.duration }]); changed();
    } catch (error) { setError(error instanceof Error ? error.message : "Choose an interval first."); }
  }
  function moveShot(index: number, direction: -1 | 1) {
    setShots(previous => { const next = [...previous], other = index + direction; [next[index], next[other]] = [next[other], next[index]]; return next; }); changed();
  }
  async function search(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("Searching the configured free stock libraries…"); setSelected(null);
    if (!shots.length) setTheme(query);
    try {
      const response = await fetch(`/api/stock-reels?q=${encodeURIComponent(query)}&provider=${provider}`, { signal: AbortSignal.timeout(25_000) }), data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setVideos(data.videos); setConfigured(data.configured); setError(data.errors.join(" "));
      setNotice(`${data.videos.length} real videos found, with portrait footage first. Preview the subject and sound before choosing.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Search failed."); setNotice(""); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function create() {
    if (!activeShots.length || planError || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice(`Downloading ${activeShots.length} selected source${activeShots.length === 1 ? "" : "s"} one at a time, then queuing one reel…`);
    try {
      const response = await fetch("/api/stock-reels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: requestId.current, caption, duration, theme, options, shots: activeShots.map(shot => ({ provider: shot.video.provider, id: shot.video.id, start: shot.start, end: shot.end })) }), signal: AbortSignal.timeout(780_000) }), data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setNotice("Real footage reel queued. Follow Live jobs; the finished video will appear in Review Files.");
      onStarted("Real footage queued with the selected moments, order and sound. No generated voice or AI video.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not queue reel."); setNotice(""); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const duplicate = selected && shots.some(shot => identity(shot.video) === identity(selected));
  return <section id="stock-reels" className="mt-5 rounded-2xl border border-[#bfcaa6] bg-white p-5">
    <div className="flex justify-between gap-3"><h2 className="text-xl font-semibold">Real footage → local reel → final review</h2><Button variant="outline" disabled={busy} onClick={onClose}>Close stock search</Button></div>
    <p className="mt-2 text-sm text-[#657153]">Use one strong moment or build a sequence of up to six related shots. Portrait footage is preferred; other frames keep their full picture. Quiet natural sound is valuable. Choose the subject, useful interval and flow by watching the previews.</p>
    <form onSubmit={event => void search(event)} className="mt-4 flex flex-wrap gap-3">
      <label className="grow text-sm">Search footage<input value={query} onChange={event => setQuery(event.target.value)} minLength={2} maxLength={100} required className="mt-1 block w-full rounded-lg border p-2" placeholder="A forest stream, coastal walk, mountain mist…" /></label>
      <label className="text-sm">Library<select value={provider} onChange={event => setProvider(event.target.value)} className="mt-1 block rounded-lg border p-2"><option value="all">Both free libraries</option><option value="pexels">Pexels</option><option value="pixabay">Pixabay</option></select></label>
      <Button type="submit" disabled={busy} className="self-end">Search real videos</Button>
    </form>
    {configured ? <p className="mt-2 text-xs">Pexels: {configured.pexels ? "configured" : "free key missing"} · Pixabay: {configured.pixabay ? "configured" : "free key missing"}. Free quotas still apply.</p> : null}
    {notice ? <p role="status" className="mt-3 text-sm">{notice}</p> : null}{error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{videos.map(video => <button key={identity(video)} type="button" disabled={busy} onClick={() => choose(video)} aria-pressed={selected ? identity(selected) === identity(video) : false} className={`rounded-xl border p-3 text-left ${selected && identity(selected) === identity(video) ? "border-[#58733c] bg-[#f7faef]" : ""}`}>
      {video.image ? <Image unoptimized src={video.image} alt={video.title} width={240} height={140} className="h-32 w-full rounded-lg object-cover" /> : <span className="block h-20 bg-[#f1f5e8] p-4">Video preview available</span>}
      <span className="mt-2 block text-sm font-semibold">{video.title}</span><span className="block text-xs">{video.provider} · {video.duration}s · {video.height > video.width ? "Portrait" : "Full frame retained"} · {video.width}×{video.height}</span>
    </button>)}</div>
    {selected ? <div className="mt-5 rounded-xl border bg-[#f7faef] p-4">
      <h3 className="font-semibold">Choose the useful moment: {selected.title}</h3>
      <video ref={preview} key={identity(selected)} controls playsInline preload="metadata" src={selected.previewUrl} className="mt-3 max-h-72 w-full" />
      <a href={selected.sourcePage} target="_blank" rel="noreferrer" className="mt-2 block text-xs underline">{selected.creator} · original {selected.provider} source</a>
      <div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-sm">Start (seconds)<input type="number" min={0} max={selected.duration} step={.1} value={trimStart} disabled={busy} onChange={event => { setTrimStart(Number(event.target.value)); changed(); }} className="mt-1 block w-28 rounded-lg border p-2" /></label><label className="text-sm">End (seconds)<input type="number" min={.1} max={selected.duration} step={.1} value={trimEnd || selected.duration} disabled={busy} onChange={event => { setTrimEnd(Number(event.target.value)); changed(); }} className="mt-1 block w-28 rounded-lg border p-2" /></label>
        <Button variant="outline" disabled={busy} onClick={() => { setTrimStart(Math.round((preview.current?.currentTime || 0) * 10) / 10); changed(); }}>Use current frame as start</Button>
        <Button variant="outline" disabled={busy} onClick={() => { setTrimEnd(Math.round((preview.current?.currentTime || selected.duration) * 10) / 10); changed(); }}>Use current frame as end</Button>
        <Button variant="outline" disabled={busy || (!duplicate && shots.length >= MAX_STOCK_SHOTS)} onClick={addShot}>{duplicate ? "Update this moment in sequence" : "Add this moment to sequence"}</Button>
      </div>
      <p className="mt-2 text-xs">Keep the setup and a satisfying ending. One well chosen continuous shot can work better than several unrelated clips.</p>
    </div> : null}
    {shots.length ? <div className="mt-4 rounded-xl border p-4"><h3 className="font-semibold">Your sequence · {shots.length} of {MAX_STOCK_SHOTS} shots</h3><p className="mt-1 text-xs">Keep one subject, place or intentional journey. Search results do not prove that different clips show the same location.</p><ol className="mt-3 space-y-2">{shots.map((shot, index) => <li key={identity(shot.video)} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#f7faef] p-2"><span className="grow text-sm">{index + 1}. {shot.video.title} · {plan[index] ? `${plan[index].start.toFixed(1)}–${plan[index].end.toFixed(1)}s` : `${shot.start}–${shot.end}s`}</span><Button variant="outline" disabled={busy || index === 0} onClick={() => moveShot(index, -1)} aria-label={`Move shot ${index + 1} earlier`}>↑</Button><Button variant="outline" disabled={busy || index === shots.length - 1} onClick={() => moveShot(index, 1)} aria-label={`Move shot ${index + 1} later`}>↓</Button><Button variant="outline" disabled={busy} onClick={() => { setShots(previous => previous.filter((_item, at) => at !== index)); changed(); }}>Remove</Button></li>)}</ol></div> : null}
    {activeShots.length ? <div className="mt-4 rounded-xl border bg-[#f7faef] p-4">
      <label className="block text-sm">Shared subject or place<input value={theme} disabled={busy} minLength={2} maxLength={100} onChange={event => { setTheme(event.target.value); changed(); }} className="mt-1 block w-full rounded-lg border p-2" /></label>
      <label className="mt-3 block text-sm">Optional posting description (not subtitles)<textarea value={caption} disabled={busy} onChange={event => { setCaption(event.target.value); changed(); }} maxLength={150} className="mt-1 block w-full rounded-lg border p-2" /></label>
      <p className="mt-1 text-xs">This is draft posting text only, never an on-screen title. Only confident speech from the used footage receives subtitles. Enabled sampled-frame analysis writes video-specific posting copy after rendering.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Maximum length<select value={duration} disabled={busy} onChange={event => { setDuration(Number(event.target.value)); changed(); }} className="mt-1 block w-full rounded-lg border p-2">{[45, 60, 75, 90, 105].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
        <label className="text-sm">Sound<select value={options.audio} disabled={busy} onChange={event => option("audio", event.target.value as StockReelOptions["audio"])} className="mt-1 block w-full rounded-lg border p-2"><option value="auto">Original sound; music if all shots are silent</option><option value="original">Original sound only</option><option value="ambience-music">Original sound + quiet instrumental</option><option value="music">Instrumental only (replace original sound)</option></select></label>
        <label className="text-sm">Instrumental mood<select value={options.mood} disabled={busy || options.audio === "original"} onChange={event => option("mood", event.target.value as StockReelOptions["mood"])} className="mt-1 block w-full rounded-lg border p-2"><option value="reflective">Reflective · slow minor chords</option><option value="warm">Warm · gentle major chords</option><option value="journey">Journey · brighter movement</option></select></label>
        <label className="text-sm">Between shots<select value={options.transition} disabled={busy} onChange={event => option("transition", event.target.value as StockReelOptions["transition"])} className="mt-1 block w-full rounded-lg border p-2"><option value="cut">Direct cuts</option><option value="soft">Brief soft fades through dark</option></select></label>
        <label className="text-sm">Framing<select value={options.framing} disabled={busy} onChange={event => option("framing", event.target.value as StockReelOptions["framing"])} className="mt-1 block w-full rounded-lg border p-2"><option value="auto">Fill near-native portrait; retain other full frames</option><option value="fit">Keep every full frame</option></select></label>
      </div>
      <p className="mt-3 text-xs">Output: about {actualDuration.toFixed(1)} seconds. Short footage stays short; no loops or filler. If your intervals exceed the cap, Phoenix shortens them proportionally while keeping their selected endings; the sequence above shows the actual intervals. All source credits are retained. Music is composed locally for this reel, with no copied trending track.</p>
      {planError ? <p role="alert" className="mt-2 text-sm text-red-800">{planError}</p> : null}
      <Button disabled={busy || !!planError || (activeShots.length > 1 && theme.trim().length < 2)} onClick={() => void create()} className="mt-3">{busy ? "Working…" : shots.length > 1 ? "Create reel from this sequence" : "Create reel from this footage"}</Button>
    </div> : null}
  </section>;
}
