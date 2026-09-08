"use client";

import { CloudOff, MonitorUp } from "lucide-react";

export default function AdminExportsContent() {
  return (
    <div className="p-8 space-y-8">
      <div className="border-b border-border/40 pb-6">
        <h2 className="text-2xl font-bold text-white tracking-tight">
          Local Exports
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Background cloud render workers and retry queues are disabled.
        </p>
      </div>

      <div className="max-w-2xl rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <MonitorUp className="h-5 w-5" />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              Compile on this computer
              <CloudOff className="h-4 w-4 text-emerald-400" />
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Open a project in the editor, compile it with the local renderer,
              then download the MP4. Phoenix Studio does not enqueue a hosted
              worker or upload the result.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
