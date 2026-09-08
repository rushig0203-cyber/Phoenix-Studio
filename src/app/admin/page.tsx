import React from "react";
import { db } from "@/lib/db";
import { Users, Video, RefreshCw, HardDrive, BarChart3, Clock } from "lucide-react";
import { connection } from "next/server";

export default async function AdminDashboardPage() {
  await connection();
  // 1. Fetch real-time system counts
  const userCount = await db.user.count();
  const projectCount = await db.project.count();
  const exportCount = await db.export.count({
    where: { status: "COMPLETED" },
  });

  const activeExports = await db.export.count({
    where: { status: "PROCESSING" },
  });

  const queuedExports = await db.export.count({
    where: { status: "QUEUED" },
  });

  const failedExports = await db.export.count({
    where: { status: "FAILED" },
  });

  // 2. Compute average rendering durations
  const completedExports = await db.export.findMany({
    where: { status: "COMPLETED" },
    select: { duration: true, createdAt: true, updatedAt: true },
  });

  let avgRenderTimeMs = 0;
  if (completedExports.length > 0) {
    const totalMs = completedExports.reduce((sum, e) => {
      const renderMs = e.updatedAt.getTime() - e.createdAt.getTime();
      return sum + renderMs;
    }, 0);
    avgRenderTimeMs = totalMs / completedExports.length;
  }

  // 3. Estimate the footprint recorded for local video assets.
  const videoAssets = await db.video.findMany({ select: { size: true } });
  let totalSizeMb = 0;
  videoAssets.forEach((v) => {
    if (v.size) {
      const numeric = parseFloat(v.size.replace(/[^\d.]/g, ""));
      if (!isNaN(numeric)) {
        totalSizeMb += numeric;
      }
    }
  });

  // 4. Retrieve recent activity audit logs
  const logs = await db.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { user: true },
  });

  return (
    <div className="p-8 space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Local Studio Diagnostics</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Review local project records and browser-render history. Hosted workers and cloud storage are disabled.
        </p>
      </div>

      {/* KPIs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Registered Users */}
        <div className="bg-slate-900/60 border border-border/40 rounded-xl p-5 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Registered Creators</p>
            <h3 className="text-2xl font-bold text-white">{userCount}</h3>
            <p className="text-[9px] text-violet-400 font-medium">Local accounts on this installation</p>
          </div>
          <div className="h-12 w-12 rounded-lg bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <Users className="h-5 w-5" />
          </div>
        </div>

        {/* Active Projects */}
        <div className="bg-slate-900/60 border border-border/40 rounded-xl p-5 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Active Projects</p>
            <h3 className="text-2xl font-bold text-white">{projectCount}</h3>
            <p className="text-[9px] text-emerald-400 font-medium">Stitched timeline block layers</p>
          </div>
          <div className="h-12 w-12 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Video className="h-5 w-5" />
          </div>
        </div>

        {/* Exports */}
        <div className="bg-slate-900/60 border border-border/40 rounded-xl p-5 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Render Tasks Completed</p>
            <h3 className="text-2xl font-bold text-white">{exportCount}</h3>
            <p className="text-[9px] text-amber-400 font-medium">
              Legacy active: {activeExports} | queued: {queuedExports}
            </p>
          </div>
          <div className="h-12 w-12 rounded-lg bg-amber-600/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <RefreshCw className="h-5 w-5" />
          </div>
        </div>

        {/* Storage Footprint */}
        <div className="bg-slate-900/60 border border-border/40 rounded-xl p-5 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Estimated Storage</p>
            <h3 className="text-2xl font-bold text-white">
              {totalSizeMb >= 1024 ? `${(totalSizeMb / 1024).toFixed(2)} GB` : `${totalSizeMb.toFixed(1)} MB`}
            </h3>
            <p className="text-[9px] text-rose-400 font-medium">Legacy failed records: {failedExports}</p>
          </div>
          <div className="h-12 w-12 rounded-lg bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <HardDrive className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Row 2: Queue KPIs & Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Side: Rendering performance ratios */}
        <div className="lg:col-span-5 bg-slate-900/40 border border-border/30 rounded-xl p-6 space-y-6 shadow-lg flex flex-col justify-between">
          <div className="flex items-center gap-2 border-b border-border/20 pb-3">
            <BarChart3 className="h-4.5 w-4.5 text-violet-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Queue Metrics</h4>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="border border-border/10 rounded-lg p-3 bg-black/20 text-center">
              <span className="text-[10px] text-muted-foreground block">Avg Render Speed</span>
              <span className="text-lg font-mono font-bold text-white mt-1 block">
                {avgRenderTimeMs > 0 ? `${(avgRenderTimeMs / 1000).toFixed(1)}s` : "N/A"}
              </span>
            </div>
            <div className="border border-border/10 rounded-lg p-3 bg-black/20 text-center">
              <span className="text-[10px] text-muted-foreground block">WASM Core Threads</span>
              <span className="text-lg font-mono font-bold text-emerald-400 mt-1 block">Parallel</span>
            </div>
            <div className="border border-border/10 rounded-lg p-3 bg-black/20 text-center">
              <span className="text-[10px] text-muted-foreground block">Cloud Workers</span>
              <span className="text-lg font-mono font-bold text-white mt-1 block">DISABLED</span>
            </div>
            <div className="border border-border/10 rounded-lg p-3 bg-black/20 text-center">
              <span className="text-[10px] text-muted-foreground block">Cloud Storage</span>
              <span className="text-lg font-mono font-bold text-emerald-400 mt-1 block">DISABLED</span>
            </div>
          </div>

          <div className="bg-slate-950/60 rounded-lg border border-border/20 p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-violet-400/30 shrink-0" />
            <p className="text-[10px] text-muted-foreground leading-normal font-medium">
              Historical render durations come from local database timestamps. New editor exports stay on this computer.
            </p>
          </div>
        </div>

        {/* Right Side: Security Audit Log list */}
        <div className="lg:col-span-7 bg-slate-900/40 border border-border/30 rounded-xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-2 border-b border-border/20 pb-3">
            <Clock className="h-4.5 w-4.5 text-violet-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Recent Activity & Security Logs</h4>
          </div>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {logs.length > 0 ? (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex justify-between items-start gap-4 text-[10px] border-b border-border/10 pb-2 last:border-0"
                >
                  <div className="space-y-1">
                    <p className="text-white font-semibold">{log.action}</p>
                    <p className="text-muted-foreground">{log.details}</p>
                    <p className="text-[9px] text-slate-500 font-medium">
                      User: {log.user?.email || "System/New Account"} | IP: {log.ipAddress || "127.0.0.1"}
                    </p>
                  </div>
                  <span className="font-mono text-muted-foreground/60 shrink-0">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-center text-muted-foreground py-8">No audit events recorded.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
