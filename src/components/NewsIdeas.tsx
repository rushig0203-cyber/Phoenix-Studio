"use client";
import { useRef, useState } from "react";
import type { NewsIdea } from "@/lib/newsResearch";
export default function NewsIdeas({ onChoose }: { onChoose: (idea: NewsIdea) => void }) {
  const [items, setItems] = useState<NewsIdea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function load() {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/news-ideas", { signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "News unavailable.");
      setItems(data.items);
    } catch (e) { setError(e instanceof Error ? e.message : "News unavailable."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section aria-label="World news suggestions" className="mt-3 rounded-xl border p-4">
    <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">World news & international affairs</h4><button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border px-3 py-2 text-xs">{busy ? "Checking reports…" : items.length ? "Refresh reports" : "Find recent reports"}</button></div>
    <p className="mt-2 text-xs text-[#657153]">Recent reporting—not a controversy score. Phoenix reads the selected report before writing; news claims remain attributed. Article text is sent to your selected writer. No paid news API or publisher video is used.</p>
    {error ? <p role="alert" className="mt-2 text-sm text-red-800">{error}</p> : null}
    <div className="mt-3 grid gap-3 sm:grid-cols-2">{items.map(item => <article key={item.id} className="rounded-lg border p-3 text-sm"><h5 className="font-medium">{item.title}</h5><p className="mt-1 text-xs">{item.summary}</p><a className="mt-2 block text-xs underline" href={item.url} target="_blank" rel="noreferrer">BBC News · {new Date(item.publishedAt).toLocaleDateString()}</a><button type="button" onClick={() => onChoose(item)} className="mt-2 rounded-lg bg-[#394a2a] px-3 py-2 text-xs text-white">Use this report</button></article>)}</div>
  </section>;
}
