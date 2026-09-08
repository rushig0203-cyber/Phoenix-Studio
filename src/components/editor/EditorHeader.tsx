"use strict";
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Undo2, Redo2, Download, CheckCircle2, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "@/components/ui/button";
import { exportTimeline } from "@/lib/clipExporter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface EditorHeaderProps {
  projectId: string;
}

export default function EditorHeader({ projectId }: EditorHeaderProps) {
  const {
    videoFile,
    videoMetadata,
    videoClips,
    audioClips,
    elementOverlays,
    history,
    future,
    undo,
    redo,
    captionFont,
    captionColor,
    captionSize,
    captionStroke,
    captionUppercase,
    captionPreset,
  } = useEditorStore();

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isExportComplete, setIsExportComplete] = useState(false);
  const [compiledBlob, setCompiledBlob] = useState<Blob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  // Compute total timeline duration
  const totalDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  };

  const handleExport = async () => {
    if (!videoFile) return;
    setIsExporting(true);
    setExportProgress(0);
    setIsExportComplete(false);
    setErrorMessage(null);
    setCompiledBlob(null);

    try {
      const blob = await exportTimeline(
        videoFile,
        videoClips,
        audioClips,
        elementOverlays,
        (percent, message) => {
          setExportProgress(percent);
          console.log(`AuraClip Timeline Export: ${percent}% — ${message}`);
        },
        {
          burnCaptions: true,
          style: {
            fontFamily: captionFont,
            color: captionColor,
            size: captionSize,
            stroke: captionStroke,
            uppercase: captionUppercase,
            preset: captionPreset,
          }
        }
      );
      setCompiledBlob(blob);
      setIsExportComplete(true);
    } catch (err: any) {
      console.error("AuraClip: Timeline export failed:", err);
      setErrorMessage(err?.message || "Render failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadCompiled = () => {
    if (!compiledBlob) return;
    const url = URL.createObjectURL(compiledBlob);
    const filename = `auraclip_compiled_${Date.now()}.mp4`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setIsExportComplete(false);

  };

  return (
    <>
      <header className="w-full border-b border-border/40 bg-card/20 backdrop-blur-md px-6 py-3 flex items-center justify-between">
        {/* Left section: Nav Back & Title */}
        <div className="flex items-center gap-4">
          <Link
            href={`/dashboard/project/${projectId}`}
            className="rounded-lg p-2 text-muted-foreground border border-border/30 hover:bg-white/5 hover:text-white transition-all shrink-0"
            title="Back to project diagnostics"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2.5 py-0.5 rounded-full select-none">
                Editor
              </span>
              <span className="text-[10px] text-muted-foreground bg-white/5 px-2 py-0.5 rounded border border-border/10">
                {formatTime(totalDuration)} timeline
              </span>
            </div>
            <h1 className="text-sm font-semibold text-white tracking-tight mt-1 truncate max-w-[200px] sm:max-w-sm">
              {videoMetadata ? "Editing: Curation Workspace" : "Workspace: Offline Sandbox"}
            </h1>
          </div>
        </div>

        {/* Center section: Undo/Redo & Autosave Indicator */}
        <div className="flex items-center gap-4">
          {/* Undo/Redo */}
          <div className="flex items-center border border-border/30 rounded-lg overflow-hidden bg-black/20">
            <button
              onClick={undo}
              disabled={!canUndo}
              className={`p-2 transition-colors border-r border-border/30 ${
                canUndo
                  ? "text-slate-200 hover:bg-white/5 hover:text-white cursor-pointer"
                  : "text-muted-foreground/30 cursor-not-allowed"
              }`}
              title="Undo last change (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className={`p-2 transition-colors ${
                canRedo
                  ? "text-slate-200 hover:bg-white/5 hover:text-white cursor-pointer"
                  : "text-muted-foreground/30 cursor-not-allowed"
              }`}
              title="Redo change (Ctrl+Y)"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>

          {/* Auto-save */}
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Auto-saved locally</span>
          </div>
        </div>

        {/* Right section: Export Trigger */}
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/project/${projectId}/ultimate`}>
            <Button
              variant="outline"
              className="rounded-full border-violet-500/30 hover:border-violet-500 bg-violet-600/10 hover:bg-violet-600/20 text-violet-300 font-semibold text-xs gap-1.5 px-6 shadow-lg active:scale-95 transition-transform cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-yellow-300 animate-pulse" />
              Ultimate Studio
            </Button>
          </Link>
          <Button
            onClick={handleExport}
            className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs gap-1.5 px-6 shadow-lg active:scale-95 transition-transform"
          >
            <Download className="h-3.5 w-3.5" />
            Compile & Export
          </Button>
        </div>
      </header>

      {/* Export Process Overlay Dialog */}
      <Dialog open={isExporting} onOpenChange={() => {}}>
        <DialogContent className="border-border/40 bg-card/95 backdrop-blur-md max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <Loader2 className="h-4.5 w-4.5 animate-spin text-violet-400" />
              Compiling Edited Timeline
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              FFmpeg.wasm is cutting, stitching, and blending audio frames in your browser. This takes just a moment...
            </DialogDescription>
          </DialogHeader>

          {/* Progress loader */}
          <div className="py-6 space-y-3">
            <div className="flex justify-between items-center text-xs font-semibold text-white">
              <span>Rendering Frame Buffer...</span>
              <span className="text-violet-400">{exportProgress}%</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-600 to-fuchsia-500 transition-all duration-200"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Thread Allocation: Multi-threaded SharedArrayBuffer (Fast)
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Export Complete Dialog */}
      <Dialog open={isExportComplete} onOpenChange={setIsExportComplete}>
        <DialogContent className="border-border/40 bg-card/95 backdrop-blur-md max-w-sm">
          <DialogHeader className="text-center flex flex-col items-center">
            <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 border border-emerald-500/20">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <DialogTitle className="text-white text-base">Timeline Render Complete!</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground text-center mt-1">
              Your video has been edited, stitched, and compiled locally. The high-quality MP4 file is ready for download.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 mt-4 sm:justify-center">
            <Button
              variant="outline"
              onClick={() => setIsExportComplete(false)}
              className="text-xs border-border/40 hover:bg-white/5"
            >
              Done
            </Button>
            <Button
              onClick={handleDownloadCompiled}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-6"
            >
              Download MP4
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Error Dialog */}
      <Dialog open={!!errorMessage} onOpenChange={() => setErrorMessage(null)}>
        <DialogContent className="border-border/40 bg-card/95 backdrop-blur-md max-w-sm">
          <DialogHeader className="text-center flex flex-col items-center">
            <div className="h-12 w-12 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mb-4 border border-rose-500/20">
              <AlertCircle className="h-6 w-6" />
            </div>
            <DialogTitle className="text-white text-base">Export Failed</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground text-center mt-1">
              {errorMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center mt-4">
            <Button
              onClick={() => setErrorMessage(null)}
              className="bg-violet-600 hover:bg-violet-500 text-white text-xs px-6"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
