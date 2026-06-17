"use strict";
"use client";

import React, { useState } from "react";
import { Download, Edit3, Sparkles, Check, Link, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface Clip {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  videoUrl?: string;
  viralScore: number; // 0-100
  reason?: string;
  transcript?: string;
  hookText?: string;
  keywords?: string[];
}

interface ClipCardProps {
  clip: Clip;
  isActive?: boolean;
  isBestPick?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  index?: number;
}

export default function ClipCard({
  clip,
  isActive = false,
  isBestPick = false,
  onSelect,
  onEdit,
  index = 1,
}: ClipCardProps) {
  const [copied, setCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Copy the hook text if available, otherwise URL
    const textToCopy = clip.hookText || window.location.href;
    setCopied(true);
    navigator.clipboard.writeText(textToCopy);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();

    setIsExporting(true);
    try {
      // Dynamically import to avoid loading FFmpeg.wasm until needed
      const { downloadClip } = await import("@/lib/clipExporter");
      const { getVideoFile } = await import("@/lib/videoStorage");

      // Try to get the project ID from the URL
      const pathParts = window.location.pathname.split("/");
      const projectIdx = pathParts.indexOf("project");
      const projectId = projectIdx >= 0 ? pathParts[projectIdx + 1] : null;

      if (!projectId) {
        alert("Could not determine project ID for export.");
        return;
      }

      const videoFile = await getVideoFile(projectId);
      if (!videoFile) {
        alert(
          "Original video file not found in local storage. Please re-upload the video."
        );
        return;
      }

      await downloadClip(
        videoFile,
        clip.startTime,
        clip.endTime,
        clip.title,
        (percent, message) => {
          console.log(`AuraClip Export: ${percent}% — ${message}`);
        },
        projectId,
        index
      );
    } catch (err) {
      console.error("AuraClip: Clip export failed:", err);
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  // Color mappings for viral score
  const getScoreColor = (score: number) => {
    if (score >= 90) return "from-fuchsia-500 to-rose-500 shadow-rose-500/20";
    if (score >= 80)
      return "from-violet-600 to-fuchsia-500 shadow-violet-500/20";
    if (score >= 70)
      return "from-indigo-600 to-violet-500 shadow-indigo-500/20";
    return "from-slate-600 to-slate-500 shadow-slate-500/20";
  };

  // Highlight keywords in transcript
  const renderHighlightedTranscript = (text?: string) => {
    if (!text) return null;
    const words = text.split(" ");
    const keywordsSet = new Set(clip.keywords?.map((k) => k.toLowerCase()) || []);

    return words.map((word, idx) => {
      const cleanWord = word.toLowerCase().replace(/[^a-z]/g, "");
      const isKeyword = keywordsSet.has(cleanWord);

      if (isKeyword) {
        return (
          <span
            key={idx}
            className="text-violet-400 font-bold bg-violet-500/10 px-1 py-0.5 rounded mr-1"
          >
            {word}
          </span>
        );
      }
      return (
        <span key={idx} className="mr-1">
          {word}
        </span>
      );
    });
  };

  const scoreLabel =
    clip.viralScore >= 90
      ? "Viral Gold"
      : clip.viralScore >= 80
      ? "Highly Viral"
      : clip.viralScore >= 70
      ? "Strong Potential"
      : "Good Potential";

  return (
    <div
      onClick={onSelect}
      className={`group flex flex-col rounded-xl border p-4 cursor-pointer transition-all duration-300 ${
        isActive
          ? "border-violet-500 bg-violet-500/5 shadow-md shadow-violet-500/5"
          : "border-border/40 bg-card/30 hover:border-violet-500/30 hover:bg-card/50"
      }`}
    >
      {/* Top row: Viral Score Badge and Time Stamps */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1 rounded-full bg-gradient-to-r ${getScoreColor(
              clip.viralScore
            )} px-3 py-1 text-xs font-bold text-white shadow-lg`}
          >
            <Sparkles className="h-3 w-3 fill-current text-white shrink-0 animate-pulse" />
            <span>Score: {clip.viralScore}</span>
          </div>
          {isBestPick ? (
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-900 bg-amber-400 border border-amber-300 rounded-full px-2.5 py-0.5 animate-pulse shadow-sm">
              🔥 AI Best Pick
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground bg-white/5 rounded-full px-2 py-0.5 border border-border/10">
              {scoreLabel}
            </span>
          )}
        </div>
        <div className="text-xs font-semibold text-white/80 bg-slate-950/40 px-2.5 py-0.8 rounded-md border border-border/10">
          {formatTime(clip.startTime)} - {formatTime(clip.endTime)} (
          {Math.round(clip.duration)}s)
        </div>
      </div>

      {/* Clip Title */}
      <h5 className="mt-3.5 font-bold text-sm text-white group-hover:text-violet-300 transition-colors line-clamp-1">
        {clip.title}
      </h5>

      {/* Hook Text (social media caption) */}
      {clip.hookText && (
        <p className="mt-1.5 text-[11px] text-amber-300/80 font-medium line-clamp-1">
          {clip.hookText}
        </p>
      )}

      {/* AI Reasoning box */}
      {clip.reason && (
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-2 italic border-l-2 border-violet-500/40 pl-2">
          {clip.reason}
        </p>
      )}

      {/* Transcript snippet */}
      {clip.transcript && (
        <div className="mt-3.5 text-xs text-slate-300 leading-relaxed line-clamp-3 bg-black/20 rounded-lg p-2.5 border border-border/5 font-mono">
          &ldquo;{renderHighlightedTranscript(clip.transcript)}&rdquo;
        </div>
      )}

      {/* Keywords */}
      {clip.keywords && clip.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {clip.keywords.slice(0, 4).map((kw, i) => (
            <span
              key={i}
              className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/15 text-violet-300"
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Action footer */}
      <div className="mt-4 flex items-center justify-between gap-4 pt-3 border-t border-border/30">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.();
            }}
            className="h-8 rounded-lg border border-border/40 bg-white/5 text-xs font-medium text-white hover:bg-violet-600 hover:text-white"
          >
            <Edit3 className="mr-1.5 h-3.5 w-3.5" />
            Edit layout
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleShare}
            className="h-8 w-8 rounded-lg hover:bg-white/5 hover:text-white shrink-0"
            title={clip.hookText ? "Copy hook text" : "Copy link"}
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Link className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={isExporting}
            className="h-8 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white shrink-0 active:scale-95 disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
