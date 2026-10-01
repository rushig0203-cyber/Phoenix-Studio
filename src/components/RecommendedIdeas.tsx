"use client";
import { useEffect, useRef, useState } from "react";
import {
  creationRecommendations, emptyRecommendationMemory, nextStoredRecommendations, type CreationRecommendation,
} from "@/lib/creationRecommendations";

export default function RecommendedIdeas({ onChoose }: { onChoose: (idea: CreationRecommendation) => void }) {
  const [ideas, setIdeas] = useState(() => creationRecommendations().ideas);
  const [remembered, setRemembered] = useState(true);
  const memory = useRef(emptyRecommendationMemory());
  const initialized = useRef(false);
  function more() {
    // Re-read on a real click so two open creation screens do not both advance
    // a stale history. A blocked browser store still permits in-session rotation.
    // Access to the localStorage property itself can throw in restricted tabs.
    const storage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) };
    const next = nextStoredRecommendations(storage, memory.current);
    memory.current = next.memory;
    setIdeas(next.ideas);
    setRemembered(next.remembered);
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    more();
  }, []);

  return <section aria-label="Recommended ideas" className="rounded-xl bg-[#f1f5e8] p-4">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">Try a different direction</h4>
      <button type="button" onClick={more} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">More ideas</button>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{ideas.map(idea => <button type="button" key={idea.id} onClick={() => onChoose(idea)} className="rounded-lg border bg-white p-3 text-left text-sm hover:bg-[#e7eed8]">
      <span className="mb-1 block text-xs font-semibold text-[#657153]">{idea.category}</span>
      <span className="block font-medium">{idea.title}</span>
      <span className="mt-2 block text-xs text-[#657153]">{idea.kind} · {idea.audience}{idea.kind === "Children's song" ? " · sung audio needed" : ""}</span>
    </button>)}</div>
    <p className="mt-2 text-xs text-[#657153]">Mixed starting points—not live trends. Choosing one sets its creation type; nothing starts until you click Create video. Edit it or write your own.</p>
    <p className="mt-1 text-xs text-[#657153]">{remembered ? "Recently shown topics are remembered in this browser. Topics rotate again after the catalogue is explored." : "Browser history storage is unavailable. Ideas can rotate here, but may repeat on your next visit."}</p>
  </section>;
}
