"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { NaturalStock } from "@/lib/naturalStock";
import type { ContentIdea } from "@/lib/contentIdeas";
import { nextStoredFootageSuggestions, stockFootageSuggestions } from "@/lib/stockFootageSuggestions";
import { FOOTAGE_CANDIDATE_PAGE_SIZE, FOOTAGE_SEARCH_DELAY_MS, MAX_FOOTAGE_CANDIDATES, mergeStockFootageCandidates, stockFootageCandidates } from "@/lib/stockFootageCandidates";
import { Button } from "./ui/button";

type Results = { query: string; version: number; videos: NaturalStock[]; cursor: string | null; limited: boolean };
type Selection = { video: NaturalStock; results: Results };
const emptyResults = (): Results => ({ query: "", version: 0, videos: [], cursor: null, limited: false });
const identity = (video: NaturalStock) => `${video.provider}:${video.id}`;

export default function StockReels({ initialQuery = "", onClose, onStarted }: { initialQuery?: string; onClose: () => void; onStarted: (message: string) => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Results>(emptyResults);
  const [visibleOffset, setVisibleOffset] = useState(0);
  const previousOffsets = useRef<number[]>([]);
  const [searching, setSearching] = useState(false), [creating, setCreating] = useState<string | null>(null);
  const [queued, setQueued] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [libraryWarning, setLibraryWarning] = useState(""), [searchFailed, setSearchFailed] = useState(false);
  const [failedSelection, setFailedSelection] = useState<Selection | null>(null);
  const mounted = useRef(true), latestQuery = useRef(initialQuery.trim()), currentResults = useRef<Results | null>(null);
  const sequence = useRef(0), creationBusy = useRef(false), submitted = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequest = useRef<{ query: string; controller: AbortController; version: number } | null>(null);
  const [suggestions, setSuggestions] = useState(() => stockFootageSuggestions());
  const [suggestionsRemembered, setSuggestionsRemembered] = useState(true);
  const suggestionCursor = useRef(0), suggestionsInitialized = useRef(false), suggestionStorageWorking = useRef(true);

  function moreSuggestions() {
    if (creationBusy.current) return;
    const next = nextStoredFootageSuggestions({ getItem: key => suggestionStorageWorking.current ? localStorage.getItem(key) : null, setItem: (key, value) => localStorage.setItem(key, value) }, suggestionCursor.current);
    suggestionStorageWorking.current = next.remembered; suggestionCursor.current = next.nextCursor;
    setSuggestions(next.ideas); setSuggestionsRemembered(next.remembered);
  }
  function cancelSearch() {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    sequence.current++; searchRequest.current?.controller.abort(); searchRequest.current = null;
  }
  function changeTopic(value: string) {
    if (creationBusy.current || !mounted.current) return;
    const bounded = value.slice(0, 100);
    // Selecting the same topic twice must not cancel its pending lookup, hide
    // an existing retry, or discard an idempotent submitted request.
    if (bounded.trim() === latestQuery.current) { setQuery(bounded); return; }
    cancelSearch(); latestQuery.current = bounded.trim(); currentResults.current = null;
    submitted.current = false; requestIds.current.clear(); setQueued(false);
    previousOffsets.current = [];
    setQuery(bounded); setResults(emptyResults()); setVisibleOffset(0); setSearching(false); setError(""); setNotice("");
    setLibraryWarning(""); setSearchFailed(false); setFailedSelection(null);
  }
  async function findVideos(wanted = latestQuery.current, append = false) {
    if (!mounted.current || creationBusy.current || submitted.current || wanted !== latestQuery.current) return;
    if (wanted.length < 2) return;
    if (searchRequest.current?.query === wanted) return;
    const previous = append ? currentResults.current : null;
    if (append && (!previous?.cursor || previous.query !== wanted || previous.videos.length >= MAX_FOOTAGE_CANDIDATES)) return;
    cancelSearch(); const controller = new AbortController(), version = sequence.current;
    searchRequest.current = { query: wanted, controller, version };
    if (!append) { currentResults.current = null; previousOffsets.current = []; setResults(emptyResults()); setVisibleOffset(0); }
    setSearching(true); setError(""); setSearchFailed(false); setLibraryWarning(""); setFailedSelection(null);
    setNotice(append ? "Finding more related starting videos…" : "Finding starting videos in your free stock libraries…");
    const current = () => mounted.current && !controller.signal.aborted && searchRequest.current?.version === version && latestQuery.current === wanted;
    try {
      const response = await fetch(`/api/stock-reels?q=${encodeURIComponent(wanted)}&provider=all&automatic=true&browse=true${previous?.cursor ? `&cursor=${encodeURIComponent(previous.cursor)}` : ""}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(40_000)]) });
      const data = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not find footage. Try again.");
      if (data?.configured?.pexels === false && data?.configured?.pixabay === false) throw new Error("Add a free Pexels or Pixabay key in Settings before finding footage.");
      const videos = previous ? mergeStockFootageCandidates(previous.videos, data?.videos) : stockFootageCandidates(data?.videos);
      const cursor = typeof data?.pagination?.cursor === "string" && data.pagination.cursor.length <= 160 ? data.pagination.cursor : null;
      const next = { query: wanted, version, videos, cursor: videos.length >= MAX_FOOTAGE_CANDIDATES ? null : cursor, limited: data?.pagination?.limited === true || videos.length >= MAX_FOOTAGE_CANDIDATES };
      currentResults.current = next; setResults(next);
      if (previous && next.videos.length > previous.videos.length) { previousOffsets.current.push(visibleOffset); setVisibleOffset(previous.videos.length); }
      const warnings = Array.isArray(data?.errors) ? data.errors.filter((value: unknown) => typeof value === "string").join(" ").slice(0, 600) : "";
      setLibraryWarning(warnings);
      const added = next.videos.length - (previous?.videos.length || 0);
      setNotice(next.videos.length ? previous && !added ? "No new matching videos on this page. Your existing choices are kept; use More videos if another page is available."
        : `${next.videos.length} distinct starting videos found. Choose one; Phoenix assembles the related shots.` : "No suitable starting videos found on this page. Try More videos or a broader topic; no unrelated footage was added.");
    } catch (failure) {
      if (current()) { setSearchFailed(true); setError(failure instanceof Error ? failure.message : "Could not reach the stock libraries."); setNotice(""); }
    } finally {
      if (current()) { searchRequest.current = null; setSearching(false); }
    }
  }
  function moreVideos() {
    if (creationBusy.current || submitted.current || searching) return;
    if (visibleOffset + FOOTAGE_CANDIDATE_PAGE_SIZE < results.videos.length) { previousOffsets.current.push(visibleOffset); setVisibleOffset(visibleOffset + FOOTAGE_CANDIDATE_PAGE_SIZE); }
    else void findVideos(latestQuery.current, true);
  }
  useEffect(() => {
    mounted.current = true;
    if (!suggestionsInitialized.current) { suggestionsInitialized.current = true; moreSuggestions(); }
    return () => { mounted.current = false; cancelSearch(); currentResults.current = null; };
  }, []);
  useEffect(() => {
    const wanted = query.trim(); latestQuery.current = wanted;
    if (wanted.length < 2 || submitted.current || creationBusy.current) return;
    timer.current = setTimeout(() => { timer.current = null; void findVideos(wanted); }, FOOTAGE_SEARCH_DELAY_MS);
    return () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  }, [query]);

  async function createReel(video: NaturalStock, listed: Results) {
    // A retained handler from an earlier topic must never dispatch an old card.
    if (!mounted.current || creationBusy.current || submitted.current || searchRequest.current || currentResults.current !== listed || latestQuery.current !== listed.query
      || !listed.videos.some(candidate => identity(candidate) === identity(video))) return;
    creationBusy.current = true; setCreating(identity(video)); setError(""); setFailedSelection(null);
    setNotice("Finding related shots, downloading them one at a time, then choosing the reel’s length and pacing…");
    const key = `${listed.query}:${identity(video)}`;
    let requestId = requestIds.current.get(key);
    if (!requestId) { requestId = crypto.randomUUID(); requestIds.current.set(key, requestId); }
    try {
      const response = await fetch("/api/stock-reels", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automatic: true, provider: video.provider, id: video.id, query: listed.query, requestId }), signal: AbortSignal.timeout(780_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not confirm the reel request. Retry checks the same saved request.");
      if (!data?.job?.id) throw new Error("Could not confirm the queued job. Retry checks the same saved request without duplicating it.");
      submitted.current = true;
      if (mounted.current) {
        setQueued(true); const message = typeof data.message === "string" ? data.message : "Automatic footage reel queued. Review the finished video in Jobs before posting.";
        setNotice(message); onStarted(message);
      }
    } catch (failure) {
      if (mounted.current) { setError(failure instanceof Error ? failure.message : "Could not confirm the reel request. Retry checks the same saved request."); setNotice(""); setFailedSelection({ video, results: listed }); }
    } finally { creationBusy.current = false; if (mounted.current) setCreating(null); }
  }
  function chooseIdea(idea: ContentIdea) { changeTopic(idea.query); }
  function close() { if (creationBusy.current) return; cancelSearch(); currentResults.current = null; onClose(); }
  const visibleVideos = results.videos.slice(visibleOffset, visibleOffset + FOOTAGE_CANDIDATE_PAGE_SIZE);
  const moreAvailable = visibleOffset + FOOTAGE_CANDIDATE_PAGE_SIZE < results.videos.length || !!results.cursor;

  return <section id="stock-reels" className="mt-5 rounded-2xl border border-[#bfcaa6] bg-white p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Make a reel from real footage</h2><Button type="button" variant="outline" disabled={!!creating} onClick={close}>Close footage</Button></div>
    <p className="mt-2 text-sm text-[#657153]">Choose a topic and a starting video. Phoenix chooses related clips, tighter cuts and a natural length—without stretching footage to fill time. It handles sound, framing and video-specific posting copy. Final review stays yours.</p>
    <form className="mt-4" onSubmit={event => { event.preventDefault(); void findVideos(); }}>
      <label className="block text-sm font-medium">Your reel topic<input value={query} disabled={!!creating} onChange={event => changeTopic(event.target.value)} minLength={2} maxLength={100} className="mt-2 block w-full rounded-xl border p-3" placeholder="Sun City videos, misty mountains, coastal roads…" aria-describedby="footage-topic-help" /></label>
      <p id="footage-topic-help" className="mt-2 text-xs text-[#657153]">Video suggestions appear automatically after you stop typing. No trimming, library selection or extra Create button.</p>
    </form>
    <details className="mt-3 rounded-xl bg-[#f1f5e8] p-3"><summary className="cursor-pointer text-sm font-medium">Topic suggestions</summary>
      <div className="mt-3 flex justify-between gap-3"><span className="text-xs text-[#657153]">Starting points, not live trends.</span><Button type="button" variant="outline" disabled={!!creating} onClick={moreSuggestions}>More ideas</Button></div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{suggestions.map(idea => <button key={idea.id} type="button" disabled={!!creating} onClick={() => chooseIdea(idea)} aria-label={`Use topic: ${idea.title}`} className="rounded-lg border bg-white p-3 text-left text-sm hover:bg-[#e7eed8] disabled:opacity-50"><span className="block text-xs text-[#657153]">{idea.category}</span><span className="mt-1 block font-medium">{idea.title}</span></button>)}</div>
      {!suggestionsRemembered ? <p className="mt-2 text-xs text-[#657153]">Browser storage is unavailable; ideas still rotate here but may repeat next visit.</p> : null}
    </details>
    {notice ? <p role="status" aria-live="polite" className="mt-4 text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
    {libraryWarning ? <p className="mt-3 text-xs text-amber-900">Some stock results are unavailable: {libraryWarning} Available choices below still work.</p> : null}
    {searchFailed && !results.videos.length ? <Button type="button" variant="outline" className="mt-3" disabled={!!creating || queued || searching} onClick={() => void findVideos()}>Retry suggestions</Button> : null}
    {searchFailed && results.videos.length ? <Button type="button" variant="outline" className="mt-3" disabled={!!creating || queued || searching} onClick={() => void findVideos(latestQuery.current, true)}>Retry more videos</Button> : null}
    {failedSelection ? <Button type="button" variant="outline" className="mt-3" disabled={!!creating || queued} onClick={() => void createReel(failedSelection.video, failedSelection.results)}>Retry reel</Button> : null}
    {results.videos.length ? <div className="mt-5"><h3 className="text-sm font-semibold">Choose the starting video · {visibleOffset + 1}–{Math.min(visibleOffset + FOOTAGE_CANDIDATE_PAGE_SIZE, results.videos.length)} of {results.videos.length} loaded</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{visibleVideos.map(video => <button key={identity(video)} type="button" disabled={!!creating || queued || searching} onClick={() => void createReel(video, results)} aria-label={`Make reel starting with: ${video.title}`} className="overflow-hidden rounded-xl border bg-[#fafbf6] text-left hover:border-[#58733c] disabled:opacity-50">
        {video.image ? <Image unoptimized loading="lazy" src={video.image} alt={video.title} width={240} height={320} className="h-40 w-full object-cover" /> : <span className="flex h-40 items-center justify-center bg-[#eef3df] p-3 text-sm">Real stock video</span>}
        <span className="block p-3"><span className="block text-sm font-medium">{video.title}</span><span className="mt-1 block text-xs text-[#657153]">{video.provider} · source {Math.round(video.duration)}s</span><span className="mt-2 block text-xs font-semibold">{creating === identity(video) ? "Preparing your reel…" : queued ? "Reel queued" : "Use this as the starting shot"}</span></span>
      </button>)}</div>
    </div> : null}
    {results.query ? <div className="mt-4 flex flex-wrap items-center gap-3">
      {visibleOffset > 0 ? <Button type="button" variant="outline" disabled={!!creating || queued || searching} onClick={() => setVisibleOffset(previousOffsets.current.pop() ?? 0)}>Previous videos</Button> : null}
      {moreAvailable ? <Button type="button" variant="outline" disabled={!!creating || queued || searching} onClick={moreVideos}>{searching ? "Finding more videos…" : "More videos"}</Button> : !searching ? <p className="text-xs text-[#657153]">{results.limited ? "This topic reached the laptop-safe browsing limit. Refine your topic for different shots." : "All matching pages are checked. Try a different place, subject or action for more choices."}</p> : null}
    </div> : null}
    <p className="mt-4 text-xs text-[#657153]">Length follows the usable footage, not a fixed timer. Movement is sampled locally; unknown movement stays at native speed. No slow motion, repeated filler or guessed subtitles. Posting captions and hashtags remain separate. Thumbnails only—no preview videos load here.</p>
    <p className="mt-2 text-xs text-[#657153]">Footage libraries: <a className="underline" href="https://www.pexels.com/" target="_blank" rel="noreferrer">Pexels</a> and <a className="underline" href="https://pixabay.com/" target="_blank" rel="noreferrer">Pixabay</a>.</p>
  </section>;
}
