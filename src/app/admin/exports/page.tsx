"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, Play, AlertCircle, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportRecord {
  id: string;
  projectId: string;
  resolution: "P720" | "P1080" | "P4K";
  format: "MP4" | "MOV" | "WEBM";
  status: "PENDING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  downloadUrl: string | null;
  retryCount: number;
  error: string | null;
  createdAt: string;
  project: {
    title: string;
    user: {
      email: string;
    };
  };
}

export default function AdminExportsPage() {
  const [jobs, setJobs] = useState<ExportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchJobs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/exports");
      const data = await res.json();
      if (Array.isArray(data)) {
        setJobs(data);
      }
    } catch (err) {
      console.error("Failed to fetch exports:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    // Auto-refresh queue statuses every 6 seconds
    const interval = setInterval(() => {
      fetchJobs();
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  const handleRetry = async (exportId: string) => {
    setRetryingId(exportId);
    try {
      const res = await fetch("/api/admin/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportId }),
      });

      if (res.ok) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === exportId
              ? { ...j, status: "QUEUED", progress: 0, retryCount: 0, error: null }
              : j
          )
        );
      }
    } catch (err) {
      console.error("Failed to retry job:", err);
    } finally {
      setRetryingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3" />
            COMPLETED
          </span>
        );
      case "PROCESSING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" />
            RENDERING
          </span>
        );
      case "QUEUED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">
            <RefreshCw className="h-3 w-3 animate-spin" />
            QUEUED
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="h-3 w-3" />
            FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/10 text-slate-300 border border-border/20">
            PENDING
          </span>
        );
    }
  };

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-border/40 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Render Queue Monitor</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Monitor active background processing pipelines, audit compilation logs, and recover failed rendering runs.
          </p>
        </div>
        <Button
          onClick={fetchJobs}
          disabled={isLoading}
          variant="outline"
          className="h-9 text-xs rounded-full border-border/40 hover:bg-white/5 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Force Refresh
        </Button>
      </div>

      {/* Queue Board */}
      <div className="bg-slate-900/40 border border-border/30 rounded-xl overflow-hidden shadow-lg">
        {isLoading && jobs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs font-semibold animate-pulse">
            Retrieving rendering queue records...
          </div>
        ) : jobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/20 text-muted-foreground font-semibold bg-white/[0.02]">
                  <th className="p-4">Project / Creator</th>
                  <th className="p-4">Format Details</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Compile Progress</th>
                  <th className="p-4">Retries</th>
                  <th className="p-4">Error / Download Details</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/10">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-white max-w-[200px] truncate">{job.project?.title}</p>
                      <p className="text-muted-foreground text-[10px] mt-0.5">{job.project?.user?.email}</p>
                    </td>
                    <td className="p-4 font-mono">
                      <span className="text-violet-300 font-bold">{job.resolution.replace("P", "")}p</span>
                      <span className="text-muted-foreground mx-1">•</span>
                      <span className="text-slate-300">{job.format}</span>
                    </td>
                    <td className="p-4">{getStatusBadge(job.status)}</td>
                    <td className="p-4">
                      <div className="space-y-1.5 max-w-[120px]">
                        <div className="flex justify-between items-center text-[10px] font-mono text-white">
                          <span>{job.progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              job.status === "FAILED"
                                ? "bg-rose-500"
                                : job.status === "COMPLETED"
                                ? "bg-emerald-500"
                                : "bg-violet-500 animate-pulse"
                            }`}
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-4 font-mono font-semibold text-slate-300">{job.retryCount} / 3</td>
                    <td className="p-4">
                      {job.status === "FAILED" && job.error ? (
                        <p className="text-rose-400 text-[10px] max-w-[220px] truncate leading-normal" title={job.error}>
                          {job.error}
                        </p>
                      ) : job.status === "COMPLETED" && job.downloadUrl ? (
                        <a
                          href={job.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-violet-400 hover:text-violet-300 hover:underline font-semibold flex items-center gap-1"
                        >
                          Download Output
                          <ArrowRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {job.status === "FAILED" ? (
                        <Button
                          size="sm"
                          onClick={() => handleRetry(job.id)}
                          disabled={retryingId === job.id}
                          className="h-8 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs gap-1"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          {retryingId === job.id ? "Queuing..." : "Retry Render"}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground/40 text-[10px]">Active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground text-xs leading-relaxed">
            No rendering jobs have been submitted yet.
          </div>
        )}
      </div>
    </div>
  );
}
