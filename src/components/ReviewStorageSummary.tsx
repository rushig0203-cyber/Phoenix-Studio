"use client";

import { useRef, useState } from "react";
import type { ReviewStorageUsage } from "@/lib/reviewStorage";

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export default function ReviewStorageSummary() {
  const [usage, setUsage] = useState<ReviewStorageUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  async function load() {
    const age = usage ? Date.now() - Date.parse(usage.measuredAt) : Infinity;
    if (busy.current || (age >= 0 && age < 60_000)) return;
    busy.current = true; setLoading(true); setError("");
    try {
      const response = await fetch("/api/storage/usage", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const value = await response.json();
      if (!response.ok || !Number.isFinite(value?.bytes) || !Array.isArray(value?.categories)) throw new Error("Storage information is unavailable. Close and reopen these details to try again.");
      setUsage(value);
    } catch { setError("Storage information is unavailable. Close and reopen these details to try again; your videos are unchanged."); }
    finally { busy.current = false; setLoading(false); }
  }
  return <details className="mt-3 rounded-xl bg-[#f1f5e8] px-3 py-2 text-sm" onToggle={event => { if (event.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer font-medium">Local storage{usage ? ` · ${size(usage.bytes)}` : ""}</summary>
    <p className="mt-2 text-xs text-[#657153]">Saved videos use disk space, not RAM. Only the current preview loads; the whole library is not kept in memory.</p>
    {loading ? <p role="status" className="mt-2 text-xs">Reading saved file sizes…</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-amber-900">{error}</p> : null}
    {usage ? <><p className="mt-2 text-xs text-[#657153]">{Number.isFinite(Date.parse(usage.measuredAt)) ? <>Measured <time dateTime={usage.measuredAt}>{new Date(usage.measuredAt).toLocaleString()}</time>. Reopen these details to refresh an estimate older than one minute.</> : "Measurement time is unavailable. Reopen these details to refresh the estimate."}</p><dl className="mt-2 grid gap-1 text-xs">{usage.categories.filter(item => item.objects > 0).map(item => <div key={item.key} className="flex justify-between gap-4"><dt>{item.label}</dt><dd>{size(item.bytes)}</dd></div>)}</dl>
      <p className="mt-2 text-xs text-[#657153]">Sources and editing files are retained for edits and safe retries. Moving a video to Trash hides it but does not free disk space. Nothing is deleted automatically.</p>
      {usage.partial || usage.skippedLinks ? <p className="mt-2 text-xs text-amber-900">This estimate excludes unreadable files or linked folders.</p> : null}</> : null}
  </details>;
}
