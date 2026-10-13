"use client";

import { useEffect, useState } from "react";
import type { ContentIdea } from "@/lib/contentIdeas";
import type { CreationRecommendation } from "@/lib/creationRecommendations";
import type { InstagramPerformanceResponse } from "@/lib/instagramPerformanceTypes";
import { instagramTopicSuggestions } from "@/lib/instagramTopicSuggestions";

type Props = { disabled?: boolean } & (
  | { mode: "stock"; onChoose: (idea: ContentIdea) => void }
  | { mode: "creation"; onChoose: (idea: CreationRecommendation) => void }
);

export default function InstagramTopicSuggestions(props: Props) {
  const [data, setData] = useState<InstagramPerformanceResponse | null>(null);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    void fetch("/api/instagram-performance", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (live && !controller.signal.aborted) setData(value); })
      .catch(() => undefined).finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, []);
  const suggestions = instagramTopicSuggestions(data, props.mode);
  if (!suggestions.length) return null;
  return <section aria-label="Ideas from your Instagram results" className="mt-3 border-t border-[#d5ddb8] pt-3">
    <h4 className="text-xs font-semibold">From your Instagram results</h4>
    <p className="mt-1 text-xs text-[#657153]">A small experiment beside your fresh ideas—not a promise of more views.</p>
    <div className="mt-2 flex flex-wrap gap-2">{suggestions.map(suggestion => <button type="button" key={suggestion.idea.id} disabled={props.disabled} aria-label={`Use idea from Instagram results: ${suggestion.idea.title}`} onClick={() => {
      if (props.mode === "stock" && suggestion.target === "stock") props.onChoose(suggestion.idea);
      else if (props.mode === "creation" && suggestion.target === "creation") props.onChoose(suggestion.idea);
    }} className="rounded-lg border bg-white px-3 py-2 text-left text-xs hover:bg-[#e7eed8] disabled:opacity-50"><span className="block font-medium">{suggestion.idea.title}</span><span className="mt-1 block text-[#657153]">{suggestion.evidenceCount} matched videos with stronger observed response</span></button>)}</div>
  </section>;
}
