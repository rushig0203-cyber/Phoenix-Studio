"use client";

import { useState } from "react";
import Link from "next/link";
import ChannelConnections from "@/components/ChannelConnections";
import WritingProviderSettings from "@/components/WritingProviderSettings";

export default function SettingsPage() {
  const [writingOpen, setWritingOpen] = useState(false);
  return <main className="min-h-screen bg-[#f4f0e7] px-5 py-8 text-[#1e2719]"><div className="mx-auto max-w-4xl space-y-5">
    <Link href="/dashboard#settings" className="text-sm font-semibold underline">← Back to studio</Link>
    <header><h1 className="text-2xl font-semibold">Publishing settings</h1><p className="mt-2 text-sm text-[#59634d]">Accounts and the writer used by Phoenix.</p></header>
    <ChannelConnections />
    <details className="rounded-xl border border-[#c4cfb5] bg-[#fffdf7] p-4" onToggle={event => setWritingOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-semibold">Writer connection</summary>
      {writingOpen ? <div className="mt-4"><WritingProviderSettings /></div> : null}
    </details>
    <section className="rounded-xl border border-[#c4cfb5] bg-[#fffdf7] p-4">
      <h2 className="text-sm font-semibold">Automatic captions and content quality</h2>
      <p className="mt-2 text-sm text-[#59634d]">Posting copy uses each video&apos;s evidence. Speech subtitles are separate; silent footage does not need invented dialogue.</p>
      <p className="mt-2 text-sm text-[#59634d]">Saved reviews guide new matching videos. Existing exports are unchanged; use Edit video for a specific finished file.</p>
      <Link href="/dashboard/manager" className="mt-3 inline-block text-sm font-semibold underline">Review the latest video</Link>
    </section>
  </div></main>;
}
