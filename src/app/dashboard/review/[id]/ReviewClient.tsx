"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, Pencil, Copy } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";

type Copy = { instagramCaption: string; instagramHashtags: string; youtubeTitle: string; youtubeDescription: string; youtubeHashtags: string };
type Review = { project: { id: string; title: string; workflowState: string }; previewUrl: string | null; socialCopy: Copy | null };

export default function ReviewClient({ projectId }: { projectId: string }) {
  const [review, setReview] = useState<Review | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`/api/projects/${projectId}/review`, { cache: "no-store" }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || "Unable to load review"); setReview(data); }).catch(e => setError(e instanceof Error ? e.message : "Unable to load review")); }, [projectId]);
  async function approve() { setBusy(true); try { const r = await fetch(`/api/projects/${projectId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error || "Approval failed"); setReview(current => current ? { ...current, project: { ...current.project, workflowState: "APPROVED" } } : current); } catch (e) { setError(e instanceof Error ? e.message : "Approval failed"); } finally { setBusy(false); } }
  async function copy(value: string) { await navigator.clipboard.writeText(value); }
  if (error) return <div className="min-h-screen bg-[#101114] p-8 text-rose-300">{error}</div>;
  if (!review) return <div className="grid min-h-screen place-items-center bg-[#101114]"><Loader2 className="animate-spin text-violet-400" /></div>;
  const approved = review.project.workflowState === "APPROVED";
  return <div className="min-h-screen bg-[#101114] text-[#f3f3f5]"><Navbar inStudio /><main className="mx-auto grid max-w-6xl gap-7 px-5 py-8 lg:grid-cols-[1.25fr_.75fr]"><section><Link href="/dashboard" className="text-sm text-violet-300">← Library</Link><h1 className="mt-4 text-3xl font-bold">Review local draft</h1><p className="mt-2 text-sm text-slate-400">Review the draft metadata locally. Nothing is posted automatically; export the file and post it manually.</p><div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black">{review.previewUrl ? <video src={review.previewUrl} controls className="w-full" /> : <div className="grid aspect-video place-items-center text-slate-500">Preview unavailable</div>}</div><div className="mt-4 flex gap-3"><Link href={`/dashboard/project/${projectId}/editor`}><Button variant="outline"><Pencil className="mr-2 h-4 w-4" />Open editor</Button></Link>{approved ? <Link href={`/dashboard/project/${projectId}/editor`}><Button><CheckCircle2 className="mr-2 h-4 w-4" />Approved — open editor</Button></Link> : <Button onClick={approve} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Approve for editing/export</Button>}</div></section><aside className="space-y-4"><h2 className="text-lg font-semibold">Suggested post copy</h2>{review.socialCopy ? <><CopyCard title="Instagram caption" value={`${review.socialCopy.instagramCaption}\n\n${review.socialCopy.instagramHashtags}`} onCopy={copy} /><CopyCard title="YouTube Shorts" value={`${review.socialCopy.youtubeTitle}\n\n${review.socialCopy.youtubeDescription}\n\n${review.socialCopy.youtubeHashtags}`} onCopy={copy} /></> : <div className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">Phoenix Studio is preparing captions and hashtags. Refresh in a moment.</div>}</aside></main></div>;
}

function CopyCard({ title, value, onCopy }: { title: string; value: string; onCopy: (value: string) => void }) { return <section className="rounded-2xl border border-white/10 bg-[#18191d] p-4"><div className="flex items-center justify-between"><h3 className="font-medium">{title}</h3><button onClick={() => void onCopy(value)} className="rounded p-1 text-violet-300" aria-label={`Copy ${title}`}><Copy className="h-4 w-4" /></button></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{value}</p></section>; }
