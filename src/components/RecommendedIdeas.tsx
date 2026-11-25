"use client";
import { useEffect, useRef, useState } from "react";
import StudioActivity from "./StudioActivity";
import {
  parsePersonalizedRecommendationMemory, PERSONALIZED_RECOMMENDATION_STORAGE_KEY, recommendationPool, RECOMMENDATION_REFRESH_MS,
  resolveCreationRecommendation, type CreationKind, type CreationRecommendation, type PersonalizedCreationRecommendation, type PersonalizedRecommendationMemory,
} from "@/lib/creationRecommendations";

export default function RecommendedIdeas({ onChoose, kind, creationActivityAt, active = true }: { onChoose: (idea: CreationRecommendation) => void; kind?: CreationKind; creationActivityAt?: number; active?: boolean }) {
  const [ideas, setIdeas] = useState<PersonalizedCreationRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remembered, setRemembered] = useState(true);
  const [loadedKind, setLoadedKind] = useState<CreationKind | undefined>();
  const [otherCategories, setOtherCategories] = useState(false);
  const requestKind = kind === "General video" && otherCategories ? undefined : kind;
  const currentSelection = useRef({ kind, ready: false, allowOther: false });
  useEffect(() => { currentSelection.current = { kind, ready: active && !loading && loadedKind === kind, allowOther: kind === "General video" && otherCategories }; }, [active, kind, otherCategories, loading, loadedKind]);
  const memory = useRef<PersonalizedRecommendationMemory>({ shown: [], cursor: 0 });
  const storageWorking = useRef(true);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setIdeas([]);
    if (!active) { setLoading(true); reload.current = async () => {}; return; }
    let live = true, pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending || !live) return;
      pending = true; setLoading(true); setError("");
      if (storageWorking.current) {
        try {
          const saved = parsePersonalizedRecommendationMemory(localStorage.getItem(PERSONALIZED_RECOMMENDATION_STORAGE_KEY));
          memory.current = parsePersonalizedRecommendationMemory(JSON.stringify({ shown: [...memory.current.shown, ...saved.shown], cursor: saved.shown.length ? saved.cursor : memory.current.cursor }));
        } catch { storageWorking.current = false; setRemembered(false); }
      }
      try {
        const query = new URLSearchParams({ workflow: "creation", cursor: String(memory.current.cursor), seen: memory.current.shown.join(",") });
        if (requestKind) query.set("kind", requestKind);
        const response = await fetch(`/api/content-suggestions?${query}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Suggestions unavailable");
        const result = await response.json() as { ideas: PersonalizedCreationRecommendation[]; nextCursor: number };
        const registered = recommendationPool();
        const limit = requestKind === "General video" ? 5 : 6;
        if (!Array.isArray(result.ideas) || result.ideas.length > limit || new Set(result.ideas.map(idea => idea?.id)).size !== result.ideas.length || !Number.isSafeInteger(result.nextCursor) || result.nextCursor < 0
          || result.ideas.some(idea => {
            const known = idea && registered.find(item => item.id === idea.id), resolved = idea && resolveCreationRecommendation(idea.id);
            return !idea || requestKind && idea.kind !== requestKind || !known || !resolved || idea.kind !== resolved.kind
            || idea.title !== resolved.title || (resolved.visualSubject ? idea.premise !== resolved.premise || idea.visualSubject !== resolved.visualSubject
              : idea.title !== resolved.legacyTitle)
            || typeof idea.title !== "string" || !idea.title.trim() || idea.title.length > 400 || /[\u0000-\u001f\u007f]/.test(idea.title)
            || typeof idea.reason !== "string" || !idea.reason.trim() || idea.reason.length > 220 || /[\u0000-\u001f\u007f]/.test(idea.reason)
            || !["recent-content", "owner-feedback", "observed-response", "explore"].includes(idea.basis);
          })) throw new Error("Invalid suggestions");
        if (!live) return;
        memory.current = parsePersonalizedRecommendationMemory(JSON.stringify({ shown: [...memory.current.shown, ...result.ideas.map(idea => idea.id)], cursor: result.nextCursor }));
        try { localStorage.setItem(PERSONALIZED_RECOMMENDATION_STORAGE_KEY, JSON.stringify(memory.current)); }
        catch { storageWorking.current = false; setRemembered(false); }
        setIdeas(result.ideas);
        setLoadedKind(kind);
      } catch {
        if (live) setError("Could not refresh ideas. Try More ideas again.");
      } finally { pending = false; if (live) setLoading(false); }
    }
    reload.current = refresh;
    void refresh();
    let timer: number;
    const schedule = () => { timer = window.setTimeout(() => { void refresh(); schedule(); }, RECOMMENDATION_REFRESH_MS); };
    schedule();
    return () => { live = false; controller.abort(); window.clearTimeout(timer); };
  }, [active, kind, requestKind, creationActivityAt]);

  const currentIdeas = loadedKind === kind ? ideas : [];
  const selectionReady = active && !loading && loadedKind === kind;
  const showingActivity = loading || !error && loadedKind !== kind;

  return <section aria-label="Recommended ideas" aria-busy={showingActivity} data-creation-ideas className="pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">Ideas for your next video</h4>
      <div className="flex gap-2">
        {kind === "General video" ? <button type="button" onClick={() => setOtherCategories(value => !value)} disabled={!active || loading} className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold disabled:opacity-50">{otherCategories ? "Nature mini-docs" : "Other categories"}</button> : null}
        <button type="button" onClick={() => void reload.current()} disabled={!active || loading} className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold disabled:opacity-50">More ideas</button>
      </div>
    </div>
    {showingActivity && !currentIdeas.length ? <StudioActivity label="Finding ideas from your saved videos…" /> : null}
    {error ? <p role="status" className="mt-2 text-xs text-muted-foreground">{error}</p> : null}
    {!loading && !error && !currentIdeas.length ? <p className="mt-2 text-xs text-muted-foreground">No matching ideas are available. You can describe your own video.</p> : null}
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{currentIdeas.map(idea => {
      const divider = idea.title.indexOf(" — ");
      const miniDoc = !!idea.visualSubject;
      return <article key={idea.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-background">
        <button type="button" aria-label={`Use idea: ${idea.title}`} title={`${idea.category} · ${idea.audience}`} disabled={!selectionReady} onClick={() => { const current = currentSelection.current; if (current.ready && (current.allowOther || !current.kind || idea.kind === current.kind)) onChoose(idea); }} className="w-full flex-1 rounded-xl p-3 text-left text-sm leading-5 hover:bg-accent disabled:opacity-50">
          <span className="block font-medium">{miniDoc || divider < 0 ? idea.title : idea.title.slice(0, divider)}</span>
          <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{miniDoc ? idea.premise : idea.reason}</span>
        </button>
        {!miniDoc && divider >= 0 ? <details className="px-3 pb-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Video premise</summary><p className="mt-1 leading-5">{idea.title.slice(divider + 3)}</p></details> : null}
        {idea.kind === "Children's song" ? <span className="block px-3 pb-3 text-xs text-muted-foreground">Sung audio needed</span> : null}
      </article>;
    })}</div>
    <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">About these ideas</summary>
      <p className="mt-2">Your saved videos and feedback guide these ideas. Ideas refresh when you open this area, daily while it is open, and after you finish a video. Select an idea, then click Create video.</p>
      <p className="mt-1">{remembered ? "Recently shown subjects are remembered for your next visit." : "Browser history storage is unavailable; subjects may repeat on your next visit."}</p>
    </details>
  </section>;
}
