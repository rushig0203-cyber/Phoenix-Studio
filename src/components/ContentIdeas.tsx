"use client";
import { useEffect, useState } from "react";
import type { ContentIdea } from "@/lib/contentIdeas";
export default function ContentIdeas({ onChoose }: { onChoose: (idea: ContentIdea) => void }) {
  const [data, setData] = useState<{ categories: string[]; ideas: ContentIdea[]; source: string } | null>(null);
  const [category, setCategory] = useState("all"), [rotation, setRotation] = useState(0), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/content-ideas?category=${encodeURIComponent(category)}&rotation=${rotation}`, { signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); setError(""); }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [category, rotation]);
  return <section className="rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5"><h2 className="text-xl font-semibold">Ideas for your next video</h2><p className="mt-2 text-sm text-[#657153]">Nature, business, learning, hobbies and original stories. Choose an idea to open it in Create.</p><div className="mt-4 flex flex-wrap gap-3"><label className="text-sm">Category<select className="ml-2 rounded-lg border p-2" value={category} onChange={event => { setCategory(event.target.value); setRotation(0); }}><option value="all">All topics</option>{data?.categories.map(value => <option key={value}>{value}</option>)}</select></label><button type="button" className="rounded-lg border px-3 text-sm" onClick={() => setRotation(value => value + 6)}>More ideas</button></div>{error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}<div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data?.ideas.slice(0, 6).map(idea => <button key={idea.id} type="button" onClick={() => onChoose(idea)} className="min-h-40 rounded-xl border bg-white p-5 text-left hover:bg-[#f1f5e8]"><span className="block text-xs text-[#657153]">{idea.category} · {idea.workflow === "stock-reel" ? "Stock footage" : idea.workflow === "children-story" ? "2D story" : "Narrated stock video"}</span><span className="mt-3 block font-semibold">{idea.title}</span><span className="mt-4 block text-xs font-medium text-[#526b3c]">Use this idea →</span></button>)}</div><p className="mt-4 text-xs text-[#657153]">{data?.source}</p></section>;
}
