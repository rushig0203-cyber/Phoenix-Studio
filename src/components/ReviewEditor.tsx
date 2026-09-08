"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Scissors, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewEditDraft, ReviewEditJob, ReviewEditState } from "@/lib/reviewEditTypes";

const field = "mt-1 w-full rounded-lg border border-[#bfcaa6] bg-white px-3 py-2 text-sm";
export default function ReviewEditor({ id }: { id: string }) {
  const [state,setState]=useState<ReviewEditState|null>(null);
  const [draft,setDraft]=useState<ReviewEditDraft|null>(null);
  const [hashtagText,setHashtagText]=useState("");
  const [jobs,setJobs]=useState<ReviewEditJob[]>([]);
  const [busy,setBusy]=useState(false); const [notice,setNotice]=useState(""); const [error,setError]=useState("");
  const [current,setCurrent]=useState(0); const video=useRef<HTMLVideoElement>(null);
  const endpoint=`/api/review-files/${id}/edit`;
  useEffect(()=>{let live=true; fetch(endpoint,{cache:"no-store"}).then(async r=>{const data=await r.json(); if(!r.ok)throw new Error(data.error);if(live){setState(data);setDraft(data.draft);setHashtagText(data.draft.hashtags.join(' '));setJobs(data.jobs);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[endpoint]);
  const poll=useCallback(async()=>{try{const r=await fetch('/api/review-edits',{cache:"no-store"});if(r.ok){const data:ReviewEditJob[]=await r.json();setJobs(data.filter(j=>j.reviewId===id));}}catch{}},[id]);
  useEffect(()=>{const timer=setInterval(()=>void poll(),3000);return()=>clearInterval(timer);},[poll]);
  const change=<K extends keyof ReviewEditDraft>(key:K,value:ReviewEditDraft[K])=>setDraft(d=>d?{...d,[key]:value}:d);
  async function save(render:boolean){if(!draft||busy)return;setBusy(true);setError("");setNotice("");try{const r=await fetch(endpoint,{method:render?"POST":"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,hashtags:hashtagText.split(/\s+/).filter(Boolean)})});const data=await r.json();if(!r.ok)throw new Error(data.error||"Could not save edits.");setNotice(render?"Edited copy queued. Progress appears below and in Workflow Manager.":"Draft saved on this PC.");if(render)void poll();}catch(e){setError(e instanceof Error?e.message:"Could not reach the editor.");}finally{setBusy(false);}}
  function seek(t:number){if(video.current)video.current.currentTime=t;setCurrent(t);}
  const active=jobs.some(j=>["QUEUED","PROCESSING"].includes(j.status));
  const cue=draft?.cues.find(c=>current>=c.start&&current<c.end);
  return <main className="min-h-screen bg-[#f4f0e7] p-5 text-[#1e2719] sm:p-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold"><ArrowLeft size={16}/>Back to studio</Link>
    <h1 className="mt-5 text-3xl font-semibold">Edit video</h1><p className="mt-2 text-sm text-[#687657]">Save a draft, then export an edited copy. Your original stays in Review Files.</p>
    {error&&<p role="alert" className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-800">{error}</p>}{notice&&<p role="status" className="mt-4 rounded-xl bg-green-100 p-3 text-sm">{notice}</p>}
    {!draft||!state?<p className="mt-8">{error?"The editor could not open this file.":"Opening video and caption timings…"}</p>:<>
    <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={video} controls preload="metadata" src={state.mediaUrl} className="max-h-[520px] w-full" onTimeUpdate={e=>{const t=e.currentTarget.currentTime;setCurrent(t);if(t>=draft.trimEnd&&!e.currentTarget.paused)e.currentTarget.pause();}} onPlay={()=>{if(video.current&& (video.current.currentTime<draft.trimStart||video.current.currentTime>=draft.trimEnd))seek(draft.trimStart);}}/>
        {state.previewIsClean&&draft.captionsEnabled&&cue&&<div className={`pointer-events-none absolute left-[6%] right-[6%] text-center font-bold ${draft.captionPosition==="top"?"top-[7%]":"bottom-[16%]"}`} style={{fontSize:`${draft.captionSize*.65}px`,color:draft.captionColor,textShadow:"1px 1px 3px #000, -1px -1px 2px #000"}}>{cue.text}</div>}
      </div>
      <p className="text-xs text-[#687657]">{state.previewIsClean ? "Source preview with edited caption text." : "Existing clip preview; corrected captions appear in the exported copy."} Export applies the selected crop and volume. Time: {current.toFixed(2)}s / {state.duration.toFixed(2)}s.</p>
      {state.captionNote&&<p className="rounded-xl bg-amber-100 p-3 text-sm">{state.captionNote}</p>}
      <section className="rounded-2xl bg-[#fffdf7] p-5"><h2 className="font-semibold">Trim and frame</h2>
        <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm">Start (seconds)<input aria-label="Trim start" className={field} type="number" min="0" step=".1" max={state.duration} value={draft.trimStart} onChange={e=>change('trimStart',Number(e.target.value))}/><button className="mt-1 text-xs underline" onClick={()=>change('trimStart',Number(current.toFixed(2)))}>Use playhead</button></label>
        <label className="text-sm">End (seconds)<input aria-label="Trim end" className={field} type="number" min="1" step=".1" max={state.duration} value={draft.trimEnd} onChange={e=>change('trimEnd',Number(e.target.value))}/><button className="mt-1 text-xs underline" onClick={()=>change('trimEnd',Number(current.toFixed(2)))}>Use playhead</button></label></div>
        <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm">Output shape<select className={field} value={draft.format} onChange={e=>change('format',e.target.value as ReviewEditDraft['format'])}><option value="original">Original</option><option value="9:16">Vertical · 9:16</option><option value="16:9">Landscape · 16:9</option><option value="1:1">Square · 1:1</option></select></label>
        <label className="text-sm">Framing<select className={field} value={draft.framing} onChange={e=>change('framing',e.target.value as 'fit'|'crop')}><option value="fit">Fit full picture</option><option value="crop">Crop to fill</option></select></label></div>
        {draft.framing==='crop'&&<label className="mt-3 block text-sm">Crop focus: left → right<input aria-label="Crop focus" className="mt-2 w-full" type="range" min="0" max="1" step=".01" value={draft.cropPosition} onChange={e=>change('cropPosition',Number(e.target.value))}/></label>}
        <label className="mt-4 block text-sm">Audio volume · {Math.round(draft.volume*100)}%<input aria-label="Audio volume" className="mt-2 w-full" type="range" min="0" max="2" step=".05" value={draft.volume} onChange={e=>{const value=Number(e.target.value);change('volume',value);if(video.current)video.current.volume=Math.min(1,value);}}/></label>
      </section>
      <section className="rounded-2xl bg-[#fffdf7] p-5"><h2 className="font-semibold">Posting details</h2><label className="mt-3 block text-sm">Title<input className={field} value={draft.title} maxLength={180} onChange={e=>change('title',e.target.value)}/></label>
      <label className="mt-3 block text-sm">Post copy<textarea className={field} rows={4} value={draft.postCopy} onChange={e=>change('postCopy',e.target.value)}/></label>
      <label className="mt-3 block text-sm">Hashtags (separated by spaces)<textarea className={field} rows={2} value={hashtagText} onChange={e=>setHashtagText(e.target.value)}/></label></section>
    </section><section className="rounded-2xl bg-[#fffdf7] p-5">
      <h2 className="text-xl font-semibold">Captions</h2><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.captionsEnabled} disabled={!state.canReplaceCaptions} onChange={e=>change('captionsEnabled',e.target.checked)}/>Burn captions into edited copy</label>
      <div className="mt-3 grid grid-cols-3 gap-3"><label className="text-sm">Position<select className={field} disabled={!state.canReplaceCaptions} value={draft.captionPosition} onChange={e=>change('captionPosition',e.target.value as 'top'|'bottom')}><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
      <label className="text-sm">Text size<input className={field} type="number" min="18" max="64" disabled={!state.canReplaceCaptions} value={draft.captionSize} onChange={e=>change('captionSize',Number(e.target.value))}/></label><label className="text-sm">Color<input className={`${field} h-10`} type="color" disabled={!state.canReplaceCaptions} value={draft.captionColor} onChange={e=>change('captionColor',e.target.value)}/></label></div>
      <p className="mt-3 text-xs text-[#687657]">Times refer to the original clip. Trimming automatically shifts captions in the export. Edited words change subtitles; narration stays unchanged.</p>
      <div className="mt-4 max-h-[750px] space-y-3 overflow-y-auto pr-1">{draft.cues.map((c,i)=><div key={i} className="rounded-xl border border-[#d5ddb8] p-3"><div className="flex items-center gap-2"><button aria-label={`Seek to caption ${i+1}`} className="text-xs font-bold underline" onClick={()=>seek(c.start)}>#{i+1}</button><input aria-label={`Caption ${i+1} start`} className="w-24 rounded border p-1 text-xs" type="number" step=".1" min="0" disabled={!state.canReplaceCaptions} value={c.start} onChange={e=>change('cues',draft.cues.map((v,n)=>n===i?{...v,start:Number(e.target.value)}:v))}/><span>→</span><input aria-label={`Caption ${i+1} end`} className="w-24 rounded border p-1 text-xs" type="number" step=".1" disabled={!state.canReplaceCaptions} value={c.end} onChange={e=>change('cues',draft.cues.map((v,n)=>n===i?{...v,end:Number(e.target.value)}:v))}/><button aria-label={`Delete caption ${i+1}`} disabled={!state.canReplaceCaptions} onClick={()=>change('cues',draft.cues.filter((_,n)=>n!==i))}><Trash2 size={14}/></button></div><textarea aria-label={`Caption ${i+1} text`} className={field} rows={2} maxLength={300} disabled={!state.canReplaceCaptions} value={c.text} onChange={e=>change('cues',draft.cues.map((v,n)=>n===i?{...v,text:e.target.value}:v))}/></div>)}</div>
      <Button className="mt-3" variant="outline" disabled={!state.canReplaceCaptions} onClick={()=>{const start=draft.cues.at(-1)?.end||draft.trimStart;change('cues',[...draft.cues,{start,end:Math.min(state.duration,start+2),text:"New caption"}]);}}><Plus size={16}/>Add caption</Button>
    </section></div>
    <div className="sticky bottom-3 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#bfcaa6] bg-[#fffdf7] p-4 shadow-lg"><Button variant="outline" disabled={busy} onClick={()=>void save(false)}><Save size={16}/>Save draft</Button><Button className="bg-[#394a2a] text-white" disabled={busy||active} onClick={()=>void save(true)}><Scissors size={16}/>{busy?'Saving…':active?'Export already queued':'Export edited copy'}</Button><span className="text-sm">Selected length: {Math.max(0,draft.trimEnd-draft.trimStart).toFixed(1)} seconds</span></div>
    <section className="mt-6 space-y-3">{jobs.map(job=><article key={job.id} className="rounded-xl bg-[#fffdf7] p-4"><p className="font-semibold">{job.status} · {job.progress}% · {job.stage}</p>{job.estimatedRemainingSeconds!=null&&<p className="text-sm">About {job.estimatedRemainingSeconds}s remaining</p>}{job.error&&<p className="mt-2 text-sm text-red-700">{job.error}</p>}{job.status==='COMPLETED'&&<Link className="mt-2 inline-block text-sm font-bold underline" href="/dashboard">Edited copy is in Review Files →</Link>}</article>)}</section>
    </>}
  </div></main>;
}
