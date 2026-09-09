"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { CreationDraft, DraftScene, FootageChoice } from "@/lib/creationDraftTypes";
import { Button } from "./ui/button";

export default function CreationDrafts({ refreshKey, onApproved }: { refreshKey: string; onApproved: () => void }) {
  const [drafts, setDrafts] = useState<CreationDraft[]>([]);
  const [editing, setEditing] = useState<CreationDraft | null>(null);
  const [scenes, setScenes] = useState<DraftScene[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState<{ index: number; choices: FootageChoice[] } | null>(null);
  const [preview, setPreview] = useState<FootageChoice | null>(null);
  const inFlight = useRef(false);
  const stock = editing && !["children-story", "children-song"].includes(editing.input.creationType || "");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/creation-drafts", { signal: signal || AbortSignal.timeout(10_000), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Drafts could not be loaded.");
    setDrafts(data);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    const tick = async () => {
      if (fetching) return;
      fetching = true;
      try { await refresh(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Draft monitor disconnected."); }
      finally { fetching = false; }
    };
    void tick();
    const timer = setInterval(() => void tick(), 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh, refreshKey]);

  function open(draft: CreationDraft) {
    setEditing(draft); setScenes(draft.scenes.map(scene => ({ ...scene }))); setDirty(false); setConfirmed(false); setSearch(null); setPreview(null); setError(""); setNotice("");
  }
  async function command(draft: CreationDraft, action: string, extra: object = {}) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/creation-drafts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id, version: draft.version, action, ...extra }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update draft.");
      if (["save", "choose"].includes(action)) { setEditing(result); setScenes(result.scenes); setDirty(false); setConfirmed(false); setNotice("Draft saved. Rendering has not started."); }
      else { setEditing(null); setPreview(null); setSearch(null); }
      if (action === "approve") { setNotice("Approved draft queued. Its live render progress appears in Live jobs."); onApproved(); }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Draft update failed."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function findFootage(index: number) {
    if (!editing || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setPreview(null);
    try {
      const params = new URLSearchParams({ q: scenes[index].query, aspect: editing.input.aspect });
      const response = await fetch(`/api/creation-drafts/footage?${params}`, { signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed.");
      setSearch({ index, choices: data.choices });
    } catch (e) { setError(e instanceof Error ? e.message : "Search failed."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function edit(index: number, field: "narration" | "query", value: string) {
    setScenes(previous => previous.map((scene, i) => i === index ? { ...scene, [field]: value } : scene)); setDirty(true); setConfirmed(false); setSearch(null);
  }
  const pending = drafts.filter(draft => draft.status !== "APPROVED");
  return <section id="storyboards" className="mt-7 scroll-mt-5 rounded-2xl border border-[#bfcaa6] bg-[#fffdf7] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-[#75834f]">Before rendering</p><h2 className="mt-1 text-2xl font-semibold">Storyboard approval · {pending.length}</h2></div><Button variant="outline" disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>Refresh drafts</Button></div>
    <p className="mt-2 text-sm text-[#657153]">Check the story, the actual footage or character poses, and song audio. Planning never starts a video render. Drafts stay saved when you close the website.</p>
    {error ? <p role="alert" className="mt-3 rounded-lg bg-orange-50 p-3 text-sm text-red-800">{error}</p> : null}
    {notice ? <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm">{notice}</p> : null}
    {!editing ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {!pending.length ? <p className="text-sm text-[#657153]">No drafts waiting. Choose Create video → Plan video for approval to begin.</p> : null}
      {pending.map(draft => <article key={draft.id} className="rounded-xl border bg-white p-4"><h3 className="font-semibold">{draft.input.topic}</h3><p className="mt-1 text-xs">{draft.status} · {draft.input.duration}s · {draft.input.aspect}</p><p role="status" className="mt-2 text-sm text-[#657153]">{draft.stage}</p>{draft.error ? <p className="mt-2 text-sm text-red-800">{draft.error}</p> : null}<div className="mt-3 flex flex-wrap gap-2">
        {draft.status === "READY" ? <Button disabled={busy} onClick={() => open(draft)}>Review draft</Button> : null}
        {draft.status === "FAILED" ? <Button variant="outline" disabled={busy} onClick={() => void command(draft, "retry")}>Retry planning</Button> : null}
        {!["PLANNING", "APPROVING"].includes(draft.status) ? <Button variant="outline" disabled={busy} onClick={() => void command(draft, "archive")}>Remove draft</Button> : null}
      </div></article>)}
    </div> : <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{editing.input.topic}</h3><Button variant="outline" disabled={busy || dirty} onClick={() => { setEditing(null); setPreview(null); }}>Close editor</Button></div>
      {dirty ? <p className="text-sm text-amber-800">Unsaved changes. Save them before searching footage, closing, or approving.</p> : null}
      {!stock ? <p className="text-xs text-[#657153]">Pose previews use the same character renderer as export; they are not promises of anime-quality animation. Save narration changes to refresh the poses.</p> : null}
      {editing.input.songAudioId ? <div className="rounded-xl bg-[#f1f5e8] p-3"><p className="mb-2 text-sm font-semibold">Listen to the entire song before approving</p><audio key={editing.input.songAudioId} controls preload="none" src={`/api/creation-drafts/${editing.id}/audio`} className="w-full" /></div> : null}
      {scenes.map((scene, index) => <article key={index} className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-[200px_1fr]">
        <div>{stock ? scene.footage ? <><button type="button" className="block w-full" onClick={() => setPreview(scene.footage!)} aria-label={`Preview selected footage for section ${index + 1}`}><Image unoptimized width={240} height={160} src={scene.footage.image} alt={`Selected footage, section ${index + 1}`} className="h-36 w-full rounded-lg object-cover" /></button><p className="mt-2 text-xs">Selected #{scene.footage.id} · {scene.footage.duration}s</p><a className="text-xs underline" href={scene.footage.sourcePage} target="_blank" rel="noreferrer">{scene.footage.creator} / Pexels</a></> : <div className="flex h-36 items-center justify-center rounded-lg bg-[#f1f2e9] p-3 text-center text-sm">Choose actual footage for this section</div> : <Image unoptimized width={200} height={160} src={`/api/creation-drafts/${editing.id}/preview?scene=${index}&frame=6&v=${editing.version}`} alt={`Character pose for section ${index + 1}`} className="h-48 w-full rounded-lg object-contain" />}</div>
        <div><label className="block text-sm font-semibold">Section {index + 1} · {editing.input.creationType === "children-song" ? "lyrics" : "narration"}<textarea rows={3} value={scene.narration} readOnly={!!editing.input.songAudioId} onChange={event => edit(index, "narration", event.target.value)} maxLength={4000} className="mt-2 w-full rounded-lg border p-2 font-normal" /></label>
          {stock ? <><label className="mt-2 block text-sm font-semibold">Visible subject and action<input value={scene.query} onChange={event => edit(index, "query", event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border p-2 font-normal" /></label><Button className="mt-2" variant="outline" disabled={busy || dirty} onClick={() => void findFootage(index)}>Find footage for section {index + 1}</Button></> : null}
        </div>
      </article>)}
      {search ? <section className="rounded-xl border bg-[#f1f5e8] p-4"><h4 className="font-semibold">Footage choices · section {search.index + 1}</h4><p className="mt-1 text-xs">Preview before choosing. Search by <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="underline">Pexels</a>. Pick a clip long enough for this narration.</p>{!search.choices.length ? <p className="mt-3 text-sm">No usable footage matched. Change the visual search, save, and try again.</p> : null}<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{search.choices.map(choice => <div key={choice.id} className="rounded-lg bg-white p-2"><button type="button" onClick={() => setPreview(choice)} aria-label={`Preview Pexels clip ${choice.id}`}><Image unoptimized src={choice.image} width={240} height={150} alt={`Pexels footage ${choice.id}`} className="h-28 w-full rounded object-cover" /></button><p className="my-2 text-xs">{choice.duration}s · {choice.width}×{choice.height}<br /><a href={choice.sourcePage} target="_blank" rel="noreferrer" className="underline">{choice.creator}</a></p><Button disabled={busy || dirty} variant="outline" onClick={() => void command(editing, "choose", { index: search.index, assetId: choice.id })}>Use this footage</Button></div>)}</div></section> : null}
      {preview ? <div className="rounded-xl bg-[#192217] p-4 text-white"><div className="mb-2 flex items-center justify-between"><p>Footage preview #{preview.id}</p><Button variant="outline" className="text-black" onClick={() => setPreview(null)}>Close preview</Button></div><video key={preview.id} controls playsInline preload="metadata" src={preview.previewUrl} className="max-h-96 w-full" /><p className="mt-2 text-xs">Original source preview; the selected output aspect ratio may crop edges. Check the finished export before posting.</p></div> : null}
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy || !dirty} onClick={() => void command(editing, "save", { scenes: scenes.map(({ narration, query }) => ({ narration, query })) })}>Save draft changes</Button>{dirty ? <Button variant="outline" disabled={busy} onClick={() => open(editing)}>Discard unsaved changes</Button> : null}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={dirty || busy} onChange={event => setConfirmed(event.target.checked)} />I reviewed the story, visuals{editing.input.songAudioId ? " and full song audio" : ""}.</label><Button disabled={busy || dirty || !confirmed || (stock ? scenes.some(scene => !scene.footage) : false)} onClick={() => void command(editing, "approve", { reviewConfirmed: true })}>{busy ? "Saving…" : "Approve & render"}</Button></div>
    </div>}
  </section>;
}
