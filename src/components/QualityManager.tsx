"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { FeedbackDecision, FeedbackDimension, QualityAssessment, QualityManagerState } from "@/lib/managerTypes";
import { FEEDBACK_REQUESTS, FEEDBACK_REQUEST_LABELS, type FeedbackRequest } from "@/lib/managerTypes";

const field="mt-1 w-full rounded-lg border border-[#bfcaa6] bg-white p-2 text-sm";
const button="rounded-lg bg-[#394a2a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const labels:Record<QualityAssessment['decision'],string>={BLOCKED:"Needs a fix",REVISE:"Revise before posting",AWAITING_REVIEW:"Waiting for your review",OWNER_APPROVED:"Approved by you"};
export default function QualityManager({initialReviewId}:{initialReviewId?:string}) {
  const [data,setData]=useState<QualityManagerState|null>(null),[selected,setSelected]=useState(initialReviewId||""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{setBusy(true);try{const response=await fetch('/api/manager/status',{cache:'no-store'});const value=await response.json();if(!response.ok)throw new Error(value.error);setData(value);setError("");}catch(e){setError(e instanceof Error?e.message:"Manager unavailable.");}finally{setBusy(false);}},[]);
  useEffect(()=>{void load();},[load]);
  const assessment=data?.assessments.find(item=>item.reviewId===selected)||data?.assessments[0];
  return <main className="min-h-screen bg-[#f4f0e7] px-5 py-8 text-[#1e2719]"><div className="mx-auto max-w-5xl">
    <Link href="/dashboard" className="text-sm font-semibold underline">← Back to studio</Link>
    <h1 className="mt-6 text-3xl font-semibold">Content quality manager</h1>
    <p className="mt-3 max-w-3xl text-sm leading-6">Choose real-footage reels, narrated business/general videos, or original 2D stories. Watch and listen to the finished video; your structured feedback guides later narration and story planning. No paid service or automatic posting.</p>
    <button className={`${button} mt-4`} disabled={busy} onClick={()=>void load()}>{busy?'Checking…':'Refresh quality checks'}</button>
    {error&&<p role="alert" className="mt-4 text-red-700">{error}</p>}
    {data&&<>
      <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5"><h2 className="font-semibold">Current limits—not hidden behind a score</h2><p className="mt-2 text-sm">Automatic singing is not installed. Song videos require your sung recording plus lyrics. Uploaded audio is not automatically proof of good singing.</p><p className="mt-2 text-sm">{data.capabilities.animation}. This is simple character animation, not Baby Shark-level production. Higher resolution alone will not fix acting or art quality.</p></section>
      <section className="mt-5 rounded-xl bg-[#fffdf7] p-5"><h2 className="font-semibold">Your saved production guidance</h2><p className="mt-2 text-sm">{data.guidance.feedbackCount} reviewed files · {data.queued} queued · {data.running} running · {data.failed} failed jobs</p><p className="mt-2 text-xs leading-5 text-[#687657]">{data.capabilities.learning} Ratings and specific improvement choices change these rules; free-text notes remain your review record. Guidance applies to matching content types when planning or checking model-written work, not to existing exports or your own scripts. Caption grouping feedback currently affects 2D exports.</p>{data.guidance.rules.length?<ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{data.guidance.rules.map(rule=><li key={rule}>{rule}</li>)}</ul>:<p className="mt-3 text-sm">No weak areas recorded yet. Rate a video below—Phoenix must not invent feedback on your behalf.</p>}<p className="mt-3 text-xs text-[#687657]">Rule revision: {data.guidance.revision}. Newly planned narrated and 2D exports record the guidance used. This is saved preference handling, not model retraining.</p></section>
      <section className="mt-5 rounded-xl bg-[#fffdf7] p-5"><label className="text-sm font-semibold">Video to review<select className={field} value={assessment?.reviewId||""} onChange={event=>setSelected(event.target.value)}>{data.assessments.map(item=><option key={item.reviewId} value={item.reviewId}>{item.title}</option>)}</select></label>
      {assessment?<div className="mt-5"><h2 className="text-xl font-semibold">{labels[assessment.decision]}</h2>{assessment.blockers.map(message=><p key={message} className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>)}<ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{assessment.checks.map(check=><li key={check}>{check}</li>)}</ul>
        <div className="mt-4 flex gap-4 text-sm font-semibold"><Link className="underline" href={`/dashboard/edit/${assessment.reviewId}`}>Watch and edit video</Link><a className="underline" href={`/api/review-files/${assessment.reviewId}/media`} target="_blank" rel="noreferrer">Open finished MP4</a></div>
        <FeedbackForm key={assessment.reviewId} assessment={assessment} onSaved={load}/>
      </div>:<p className="mt-4 text-sm">Create a video first. Your review files will appear here.</p>}</section>
    </>}
  </div></main>;
}
function FeedbackForm({assessment,onSaved}:{assessment:QualityAssessment;onSaved:()=>Promise<void>}) {
  const [ratings,setRatings]=useState(assessment.feedback?.ratings||{story:3,visuals:3,audio:3,captions:3}),[decision,setDecision]=useState<FeedbackDecision>(assessment.feedback?.decision||'revise'),[note,setNote]=useState(assessment.feedback?.note||''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [requests,setRequests]=useState<FeedbackRequest[]>(assessment.feedback?.requests||[]);
  async function save(event:React.FormEvent){event.preventDefault();setBusy(true);setNotice('');try{const response=await fetch('/api/manager/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewId:assessment.reviewId,ratings,decision,note,requests})});const data=await response.json();if(!response.ok)throw new Error(data.error);setNotice('Feedback saved locally. Matching model-written content will use the selected guidance; existing exports are unchanged.');await onSaved();}catch(e){setNotice(e instanceof Error?e.message:'Could not save feedback.');}finally{setBusy(false);}}
  return <form onSubmit={save} className="mt-6 border-t border-[#d5ddb8] pt-5">
    <h3 className="font-semibold">Guide the next video</h3>
    <p className="mt-1 text-xs">1 = poor · 3 = acceptable draft · 5 = strong. Ratings of 1–2 create an improvement priority. Re-rating replaces this file’s previous feedback, without counting it twice.</p>
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{(['story','visuals','audio','captions'] as FeedbackDimension[]).map(dimension=><label key={dimension} className="text-sm capitalize">{dimension}<select className={field} value={ratings[dimension]} onChange={event=>setRatings({...ratings,[dimension]:Number(event.target.value)})}>{[1,2,3,4,5].map(value=><option key={value} value={value}>{value}</option>)}</select></label>)}</div>
    <fieldset className="mt-4 space-y-2"><legend className="mb-2 text-sm font-semibold">Specific improvements for future scripts (optional)</legend>{FEEDBACK_REQUESTS.map(request=><label key={request} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={requests.includes(request)} onChange={event=>setRequests(current=>event.target.checked?[...current,request]:current.filter(value=>value!==request))}/>{FEEDBACK_REQUEST_LABELS[request]}</label>)}</fieldset>
    <label className="mt-4 block text-sm">Decision<select className={field} value={decision} onChange={event=>setDecision(event.target.value as FeedbackDecision)}><option value="revise">Revise before posting</option><option value="keep">Keep—personally reviewed</option></select></label>
    <label className="mt-4 block text-sm">Review notes (saved for your reference, not automatic instructions)<textarea className={field} rows={3} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)} placeholder="Describe the moment that needs attention; select an improvement above to guide future scripts."/></label>
    <button className={`${button} mt-4`} disabled={busy}>{busy?'Saving…':'Save review and update manager'}</button>{notice&&<p role="status" className="mt-3 text-sm">{notice}</p>}
  </form>;
}
