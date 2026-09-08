import { HardDrive, ShieldCheck } from "lucide-react";

export default function AdminStoragePage() {
  return (
    <div className="p-8 space-y-8">
      <div className="border-b border-border/40 pb-6">
        <h2 className="text-2xl font-bold text-white tracking-tight">
          Local Storage
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Phoenix Studio stores review media on this computer. S3 and other cloud
          storage providers are disabled.
        </p>
      </div>

      <div className="max-w-2xl rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              Free local mode
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Use Phoenix Studio Review Files for imports and exports. Manage
              those files with the normal tools on this computer; no cloud audit
              or purge action will run from this screen.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
