"use client";
import { useEffect, useRef, useState } from "react";
import StudioActivity from "./StudioActivity";
import {
  parsePersonalizedRecommendationMemory, PERSONALIZED_RECOMMENDATION_STORAGE_KEY, recommendationPool, RECOMMENDATION_REFRESH_MS,
  type CreationKind, type CreationRecommendation, type PersonalizedCreationRecommendation, type PersonalizedRecommendationMemory,
} from "@/lib/creationRecommendations";

export default function RecommendedIdeas({ onChoose, kind }: { onChoose: (idea: CreationRecommendation) => void; kind?: CreationKind }) {
  const [ideas, setIdeas] = useState<PersonalizedCreationRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remembered, setRemembered] = useState(true);
  const [loadedKind, setLoadedKind] = useState<CreationKind | undefined>();
  const currentSelection = useRef({ kind, ready: false });
  useEffect(() => { currentSelection.current = { kind, ready: !loading && loadedKind === kind }; }, [kind, loading, loadedKind]);
  const memory = useRef<PersonalizedRecommendationMemory>({ shown: [], cursor: 0 });
  const storageWorking = useRef(true);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setIdeas([]);
    let active = true, pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending) return;
      pending = true; setLoading(true); setError("");
      if (storageWorking.current) {
        try {
          const saved = parsePersonalizedRecommendationMemory(localStorage.getItem(PERSONALIZED_RECOMMENDATION_STORAGE_KEY));
          memory.current = parsePersonalizedRecommendationMemory(JSON.stringify({ shown: [...memory.current.shown, ...saved.shown], cursor: saved.shown.length ? saved.cursor : memory.current.cursor }));
        } catch { storageWorking.current = false; setRemembered(false); }
      }
      try {
        const query = new URLSearchParams({ workflow: "creation", cursor: String(memory.current.cursor), seen: memory.current.shown.join(",") });
        if (kind) query.set("kind", kind);
        const response = await fetch(`/api/content-suggestions?${query}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Suggestions unavailable");
        const result = await response.json() as { ideas: PersonalizedCreationRecommendation[]; nextCursor: number };
        const registered = recommendationPool();
        if (!Array.isArray(result.ideas) || result.ideas.length > 6 || new Set(result.ideas.map(idea => idea?.id)).size !== result.ideas.length || !Number.isSafeInteger(result.nextCursor) || result.nextCursor < 0
          || result.ideas.some(idea => !idea || kind && idea.kind !== kind || !registered.some(known => known.id === idea.id && known.kind === idea.kind)
            || typeof idea.title !== "string" || !idea.title.trim() || idea.title.length > 400 || /[\u0000-\u001f\u007f]/.test(idea.title)
            || typeof idea.reason !== "string" || !idea.reason.trim() || idea.reason.length > 220 || /[\u0000-\u001f\u007f]/.test(idea.reason)
            || !["recent-content", "owner-feedback", "observed-response", "explore"].includes(idea.basis))) throw new Error("Invalid suggestions");
        if (!active) return;
        memory.current = parsePersonalizedRecommendationMemory(JSON.stringify({ shown: [...memory.current.shown, ...result.ideas.map(idea => idea.id)], cursor: result.nextCursor }));
        try { localStorage.setItem(PERSONALIZED_RECOMMENDATION_STORAGE_KEY, JSON.stringify(memory.current)); }
        catch { storageWorking.current = false; setRemembered(false); }
        setIdeas(result.ideas);
        setLoadedKind(kind);
      } catch {
        if (active) setError("Could not refresh ideas. Try More ideas again.");
      } finally { pending = false; if (active) setLoading(false); }
    }
    reload.current = refresh;
    void refresh();
    let timer: number;
    const schedule = () => { timer = window.setTimeout(() => { void refresh(); schedule(); }, RECOMMENDATION_REFRESH_MS); };
    schedule();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [kind]);

  const currentIdeas = loadedKind === kind ? ideas : [];
  const selectionReady = !loading && loadedKind === kind;
  const showingActivity = loading || !error && loadedKind !== kind;

  return <section aria-label="Recommended ideas" aria-busy={showingActivity} className="rounded-xl bg-[#f1f5e8] p-3">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">Ideas for your next video</h4>
      <button type="button" onClick={() => void reload.current()} disabled={loading} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">More ideas</button>
    </div>
    {showingActivity && !currentIdeas.length ? <StudioActivity label="Finding ideas from your saved videos…" /> : null}
    {error ? <p role="status" className="mt-2 text-xs text-[#59634d]">{error}</p> : null}
    {!loading && !error && !currentIdeas.length ? <p className="mt-2 text-xs text-[#59634d]">No matching ideas are available. You can describe your own video.</p> : null}
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{currentIdeas.map(idea => {
      const divider = idea.title.indexOf(" — ");
      return <article key={idea.id} className="rounded-lg border bg-white p-2">
        <button type="button" aria-label={`Use idea: ${idea.title}`} title={`${idea.category} · ${idea.audience}`} disabled={!selectionReady} onClick={() => { const current = currentSelection.current; if (current.ready && (!current.kind || idea.kind === current.kind)) onChoose(idea); }} className="w-full rounded text-left text-sm hover:bg-[#e7eed8] disabled:opacity-50">
          <span className="block font-medium">{divider < 0 ? idea.title : idea.title.slice(0, divider)}</span>
          <span className="mt-1 block text-xs leading-5 text-[#59634d]">{idea.reason}</span>
        </button>
        {divider < 0 ? null : <details className="mt-1 text-xs text-[#59634d]"><summary className="cursor-pointer">Video premise</summary><p className="mt-1 leading-5">{idea.title.slice(divider + 3)}</p></details>}
        {idea.kind === "Children's song" ? <span className="mt-1 block text-xs text-[#59634d]">Sung audio needed</span> : null}
      </article>;
    })}</div>
    <details className="mt-2 text-xs text-[#59634d]"><summary className="cursor-pointer">About these ideas</summary>
      <p className="mt-2">Ideas use your saved videos, story reviews and available results, not live trends; nothing starts until you click Create video. They refresh every 15 days and when reopened; More ideas checks your latest work now. Once matching subjects have all been shown, older ideas return in rotation.</p>
      <p className="mt-1">{remembered ? "Recently shown subjects are remembered for your next visit." : "Browser history storage is unavailable; subjects may repeat on your next visit."}</p>
    </details>
  </section>;
}
