"use strict";
"use client";

import React, { useState, useRef, useEffect } from "react";
import { Download, Edit3, Sparkles, Check, Link, Loader2, Send, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editorStore";

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const YoutubeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17z" />
    <polygon points="10 15 15 12 10 9" />
  </svg>
);

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
  projectId?: string;
}

export default function ClipCard({
  clip,
  isActive = false,
  isBestPick = false,
  onSelect,
  onEdit,
  index = 1,
  projectId,
}: ClipCardProps) {
  const {
    captionFont,
    captionColor,
    captionSize,
    captionStroke,
    captionUppercase,
    captionPreset,
  } = useEditorStore();

  const [copied, setCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Inline publish popover state
  const [showPublish, setShowPublish] = useState(false);
  const [pubCaption, setPubCaption] = useState("");
  const [pubPlatform, setPubPlatform] = useState<"Instagram" | "YouTube" | "Both">("Instagram");
  const [isPublishing, setIsPublishing] = useState(false);
  const [pubResult, setPubResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showPublish) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPublish(false);
        setPubResult(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPublish]);

  const openPublish = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPubCaption(clip.hookText || clip.title || "");
    setPubResult(null);
    setShowPublish((v) => !v);
  };

  const handleQuickPublish = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectId) {
      setPubResult({ ok: false, msg: "Project ID missing — open via project editor." });
      return;
    }
    setIsPublishing(true);
    setPubResult(null);

    const platforms = pubPlatform === "Both" ? ["Instagram", "YouTube"] : [pubPlatform];

    try {
      let lastOk = false;
      let lastMsg = "";
      for (const platform of platforms) {
        const res = await fetch(`/api/projects/${projectId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clipId: clip.id,
            clipTitle: clip.title,
            platform,
            caption: pubCaption,
            hashtags: clip.keywords?.map((k) => `#${k}`).join(" ") || "",
            youtubeTitle: clip.title,
            youtubeDesc: pubCaption,
          }),
        });
        const data = await res.json();
        lastOk = data.success;
        lastMsg = data.record?.postUrl
          ? `Published! → ${data.record.postUrl}`
          : data.record?.error || data.error || "Published";
      }
      setPubResult({ ok: lastOk, msg: lastMsg });
    } catch (err: any) {
      setPubResult({ ok: false, msg: err.message || "Publish failed" });
    } finally {
      setIsPublishing(false);
    }
  };

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
        index,
        {
          burnCaptions: true,
          transcript: clip.transcript,
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
      <div className="mt-4 pt-3 border-t border-border/30 space-y-3">
        <div className="flex items-center justify-between gap-2">
          {/* Left: Edit */}
          <Button
            size="sm"
            onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
            className="h-8 rounded-lg border border-border/40 bg-white/5 text-xs font-medium text-white hover:bg-violet-600 hover:text-white"
          >
            <Edit3 className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>

          {/* Right: Copy + Download + Publish */}
          <div className="flex items-center gap-1.5">
            <Button
              size="icon"
              variant="ghost"
              onClick={handleShare}
              className="h-8 w-8 rounded-lg hover:bg-white/5 hover:text-white shrink-0"
              title={clip.hookText ? "Copy hook text" : "Copy link"}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Link className="h-4 w-4" />}
            </Button>

            <Button
              size="sm"
              onClick={handleDownload}
              disabled={isExporting}
              className="h-8 rounded-lg bg-slate-800 hover:bg-slate-700 border border-border/40 text-xs font-semibold text-white shrink-0 active:scale-95 disabled:opacity-50"
            >
              {isExporting ? (
                <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Exporting...</>
              ) : (
                <><Download className="mr-1 h-3.5 w-3.5" />Download</>
              )}
            </Button>

            {/* Publish button */}
            <Button
              size="sm"
              onClick={openPublish}
              className="h-8 rounded-lg bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-xs font-bold text-white shrink-0 active:scale-95 shadow-md shadow-pink-900/20 flex items-center gap-1"
            >
              <Send className="h-3 w-3" />
              Publish
              <ChevronDown className={`h-3 w-3 transition-transform ${showPublish ? "rotate-180" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Inline Publish Popover */}
        {showPublish && (
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl border border-pink-500/25 bg-slate-950/95 backdrop-blur-md p-4 space-y-3 shadow-2xl shadow-pink-900/20 animate-in slide-in-from-top-2 fade-in duration-150"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-white flex items-center gap-1.5">
                <Send className="h-3 w-3 text-pink-400" />
                Publish Clip
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); setShowPublish(false); setPubResult(null); }}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Platform picker */}
            <div className="flex gap-1.5">
              {(["Instagram", "YouTube", "Both"] as const).map((p) => (
                <button
                  key={p}
                  onClick={(e) => { e.stopPropagation(); setPubPlatform(p); }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                    pubPlatform === p
                      ? p === "Instagram"
                        ? "bg-pink-600/20 border-pink-500/50 text-pink-300"
                        : p === "YouTube"
                        ? "bg-red-600/20 border-red-500/50 text-red-300"
                        : "bg-violet-600/20 border-violet-500/50 text-violet-300"
                      : "bg-white/5 border-border/20 text-slate-400 hover:text-white"
                  }`}
                >
                  {p === "Instagram" && <InstagramIcon />}
                  {p === "YouTube" && <YoutubeIcon />}
                  {p === "Both" && <><InstagramIcon /><span className="text-[8px]">+</span><YoutubeIcon /></>}
                  {p}
                </button>
              ))}
            </div>

            {/* Caption input */}
            <textarea
              rows={2}
              value={pubCaption}
              onChange={(e) => { e.stopPropagation(); setPubCaption(e.target.value); }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Caption / hook text..."
              className="w-full rounded-lg border border-border/30 bg-slate-900/60 px-3 py-2 text-[11px] text-white placeholder-slate-600 focus:border-pink-500 focus:outline-none resize-none"
            />

            {/* Result feedback */}
            {pubResult && (
              <div className={`text-[10px] font-medium rounded-lg px-3 py-2 border ${
                pubResult.ok
                  ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
                  : "bg-rose-500/5 border-rose-500/20 text-rose-400"
              }`}>
                {pubResult.ok ? "✓ " : "✗ "}{pubResult.msg}
              </div>
            )}

            {/* Publish Now button */}
            <button
              onClick={handleQuickPublish}
              disabled={isPublishing}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all active:scale-95"
            >
              {isPublishing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Publishing...</>
              ) : (
                <><Send className="h-3.5 w-3.5" />Publish Now →</>
              )}
            </button>

            <p className="text-[9px] text-slate-600 text-center">
              Make sure Instagram / YouTube is connected in{" "}
              <a href="/dashboard/settings" className="text-pink-500 hover:underline" onClick={(e) => e.stopPropagation()}>Settings</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
