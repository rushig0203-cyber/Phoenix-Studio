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
  const storageWorking = useRef(true);
  function more() {
    // Re-read on a real click so two open creation screens do not both advance
    // a stale history. A blocked browser store still permits in-session rotation.
    // Access to the localStorage property itself can throw in restricted tabs.
    const storage = { getItem: (key: string) => storageWorking.current ? localStorage.getItem(key) : null, setItem: (key: string, value: string) => localStorage.setItem(key, value) };
    const next = nextStoredRecommendations(storage, memory.current);
    storageWorking.current = next.remembered;
    memory.current = next.memory;
    setIdeas(next.ideas);
    setRemembered(next.remembered);
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    more();
  }, []);

  return <section aria-label="Recommended ideas" className="rounded-xl bg-[#f1f5e8] p-3">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">Fresh starting points</h4>
      <button type="button" onClick={more} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">More ideas</button>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{ideas.map(idea => {
      const divider = idea.title.indexOf(" — ");
      return <button type="button" key={idea.id} aria-label={`Use idea: ${idea.title}`} title={`${idea.category} · ${idea.audience}`} onClick={() => onChoose(idea)} className="rounded-lg border bg-white p-2 text-left text-sm hover:bg-[#e7eed8]">
        <span className="block font-medium">{divider < 0 ? idea.title : idea.title.slice(0, divider)}</span>
        {divider < 0 ? null : <span className="mt-1 block text-xs leading-5 text-[#657153]"> — {idea.title.slice(divider + 3)}</span>}
        {idea.kind === "Children's song" ? <span className="mt-1 block text-xs text-[#657153]">Sung audio needed</span> : null}
      </button>;
    })}</div>
    <details className="mt-2 text-xs text-[#59634d]"><summary className="cursor-pointer">About these ideas</summary>
      <p className="mt-2">Starting points, not live trends; nothing starts until you click Create video.</p>
      <p className="mt-1">{remembered ? "Recently shown topics are remembered and rotate after the catalogue is explored." : "Browser history storage is unavailable; topics may repeat on your next visit."}</p>
    </details>
  </section>;
}
