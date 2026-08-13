"use client";

import React, { useEffect, useState } from "react";
import { HardDrive, AlertTriangle, Check, RefreshCw, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StorageAudit {
  dbKeysCount: number;
  s3KeysCount: number;
  orphanedKeys: string[];
  orphanedKeysCount: number;
}

export default function AdminStoragePage() {
  const [audit, setAudit] = useState<StorageAudit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runAudit = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/storage");
      const data = await res.json();
      if (data && typeof data.dbKeysCount === "number") {
        setAudit(data);
      }
    } catch (err) {
      console.error("Failed to execute storage audit:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    runAudit();
  }, []);

  const handleCleanup = async () => {
    if (!audit || audit.orphanedKeysCount === 0) return;
    setIsCleaning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: audit.orphanedKeys }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessage(`Storage Sweep: Successfully purged ${data.cleanedCount} orphaned files from S3.`);
        runAudit();
      } else {
        setMessage(`Purge failed: ${data.error || "Unknown S3 runtime error"}`);
      }
    } catch (err) {
      console.error("Failed to run storage cleanup:", err);
      setMessage("Failed to complete S3 storage cleanup.");
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-border/40 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Storage Management</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Audit S3 active buckets, track dangling upload logs, and purge orphaned media files.
          </p>
        </div>
        <Button
          onClick={runAudit}
          disabled={isLoading}
          variant="outline"
          className="h-9 text-xs rounded-full border-border/40 hover:bg-white/5 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Run Audit Scan
        </Button>
      </div>

      {/* Audit Stats Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900/60 border border-border/40 rounded-xl p-5 shadow-lg">
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">DB Referenced Keys</p>
          <h3 className="text-2xl font-mono font-bold text-white mt-1">
            {isLoading ? "..." : audit?.dbKeysCount || 0}
          </h3>
        </div>
        <div className="bg-slate-900/60 border border-border/40 rounded-xl p-5 shadow-lg">
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Total S3 Objects</p>
          <h3 className="text-2xl font-mono font-bold text-white mt-1">
            {isLoading ? "..." : audit?.s3KeysCount || 0}
          </h3>
        </div>
        <div className="bg-slate-900/60 border border-border/40 rounded-xl p-5 shadow-lg border-rose-500/20">
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Orphaned S3 Files</p>
          <h3 className={`text-2xl font-mono font-bold mt-1 ${audit && audit.orphanedKeysCount > 0 ? "text-rose-400 animate-pulse" : "text-white"}`}>
            {isLoading ? "..." : audit?.orphanedKeysCount || 0}
          </h3>
        </div>
      </div>

      {/* Purge Warning Panel */}
      {audit && audit.orphanedKeysCount > 0 && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 space-y-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4.5 w-4.5 animate-pulse text-rose-400" />
              Purge Orphaned Storage Assets
            </h4>
            <p className="text-[10px] text-muted-foreground leading-normal max-w-xl">
              There are {audit.orphanedKeysCount} file objects located in the S3 bucket that have no references in the database. Executing a purge will delete these files permanently to free up disk space.
            </p>
          </div>
          <Button
            onClick={handleCleanup}
            disabled={isCleaning}
            className="rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs gap-1.5 px-6 shrink-0"
          >
            <Trash className="h-3.5 w-3.5" />
            {isCleaning ? "Purging keys..." : "Execute Purge"}
          </Button>
        </div>
      )}

      {message && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 animate-pulse">
          <Check className="h-4.5 w-4.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Dangling Keys List */}
      <div className="bg-slate-900/40 border border-border/30 rounded-xl overflow-hidden shadow-lg space-y-4 p-6">
        <h4 className="text-xs font-bold uppercase tracking-wider text-white">Dangling Keys Registry</h4>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-xs font-semibold animate-pulse">
            Scanning storage files...
          </div>
        ) : audit && audit.orphanedKeys.length > 0 ? (
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {audit.orphanedKeys.map((key, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center bg-black/20 border border-border/10 rounded-lg p-2.5 font-mono text-[9px] text-slate-300"
              >
                <span className="truncate max-w-[80%]">{key}</span>
                <span className="text-rose-400/80 font-semibold uppercase tracking-wider">Unreferenced</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-xs">
            Zero orphaned S3 file keys detected. Storage registry is fully synchronized.
          </div>
        )}
      </div>
    </div>
  );
}
