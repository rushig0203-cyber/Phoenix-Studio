"use strict";
"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getVideoFile } from "@/lib/videoStorage";
import { getProcessingResults, getTranscript } from "@/lib/processingPipeline";
import type { AnalyzedClip } from "@/lib/clipAnalyzer";
import {
  ArrowLeft,
  Video,
  Play,
  Pause,
  Download,
  Settings,
  Sparkles,
  ChevronRight,
  Clock,
  Calendar,
  FileText,
  Maximize2,
  Volume2,
  VolumeX,
  Loader2,
  AlertCircle,
  Zap,
  TrendingUp,
  Target,
  Award,
  Type,
  Scissors,
  Music,
} from "lucide-react";
import ClipCard from "@/components/ClipCard";
import { Button } from "@/components/ui/button";
import PublishConsole from "@/components/PublishConsole";

// Reusable Clip type matching ClipCard expectations
interface Clip {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  viralScore: number;
  reason?: string;
  transcript?: string;
  hookText?: string;
  keywords?: string[];
  scale?: number;
  fitMode?: "cover" | "contain";
}

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [projectTitle, setProjectTitle] = useState("Loading Project...");
  const [projectDuration, setProjectDuration] = useState(120);
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeClipId, setActiveClipId] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab] = useState<"clips" | "transcript" | "publish">("clips");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoadingClips, setIsLoadingClips] = useState(true);
  const [fullTranscript, setFullTranscript] = useState<string>("");
  const [analysisMetrics, setAnalysisMetrics] = useState({
    avgScore: 0,
    hookStrength: "–",
    topKeywords: [] as string[],
    clipCount: 0,
  });

  const [videoError, setVideoError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVerticalCrop, setIsVerticalCrop] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [enabledCaptionsClips, setEnabledCaptionsClips] = useState<Record<string, boolean>>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const handleSaveEditedClip = (updatedClip: Clip) => {
    // 1. Update React state
    const updatedClips = clips.map((c) => (c.id === updatedClip.id ? updatedClip : c));
    setClips(updatedClips);
    
    // 2. Persist to localStorage results
    const resultsKey = "auraclip_results_" + projectId;
    const existingRaw = localStorage.getItem(resultsKey);
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        parsed.clips = updatedClips;
        localStorage.setItem(resultsKey, JSON.stringify(parsed));
      } catch (e) {
        console.error("AuraClip: Failed to save updated clip results", e);
      }
    }

    // 3. Reset active clip details if current clip was edited
    if (activeClipId === updatedClip.id) {
      if (videoRef.current) {
        videoRef.current.currentTime = updatedClip.startTime;
      }
      setCurrentTime(updatedClip.startTime);
    }

    setIsEditModalOpen(false);
    setEditingClip(null);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = isMuted;
      video.volume = isMuted ? 0 : 1;
    }
  }, [isMuted]);

  const toggleFullscreen = () => {
    const container = playerContainerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  };

  // Load project details from localStorage on client mount
  useEffect(() => {
    const saved = localStorage.getItem("auraclip_projects");
    let foundTitle = "";
    let foundDuration = 120;

    if (saved) {
      try {
        const projects = JSON.parse(saved) as Array<{ id: string; title: string; duration: number }>;
        const currentProject = projects.find((p) => p.id === projectId);
        if (currentProject) {
          foundTitle = currentProject.title;
          foundDuration = currentProject.duration;
        }
      } catch (e) {
        console.error("Failed to parse projects from localStorage", e);
      }
    }

    if (!foundTitle) {
      const fallbackTitles: Record<string, string> = {
        "proj-1": "Startup Pitch & Business Advice",
        "proj-2": "Growth Hack Podcast Episode 45",
        "proj-3": "Vlog 12: Creative Studio Tour",
      };
      const fallbackDurations: Record<string, number> = {
        "proj-1": 184,
        "proj-2": 295,
        "proj-3": 620,
      };
      foundTitle = fallbackTitles[projectId] || "Custom Video Clip Project";
      foundDuration = fallbackDurations[projectId] || 120;
    }

    queueMicrotask(() => {
      setProjectTitle(foundTitle);
      setProjectDuration(foundDuration);
    });
  }, [projectId]);

  // Load real clips from processing results
  useEffect(() => {
    queueMicrotask(() => setIsLoadingClips(true));

    const results = getProcessingResults(projectId);
    const transcript = getTranscript(projectId);

    if (results && results.clips.length > 0) {
      // Real clips from the processing pipeline
      const loadedClips: Clip[] = results.clips.map((c) => ({
        id: c.id,
        title: c.title,
        startTime: c.startTime,
        endTime: c.endTime,
        duration: c.duration,
        viralScore: c.viralScore,
        reason: c.reason,
        transcript: c.transcript,
        hookText: c.hookText,
        keywords: c.keywords,
      }));

      // Compute real metrics
      const avgScore = results.averageScore;
      const maxScore = Math.max(...loadedClips.map((c) => c.viralScore));
      const hookStrength =
        maxScore >= 90
          ? "Exceptional"
          : maxScore >= 80
          ? "Strong"
          : maxScore >= 70
          ? "Good"
          : "Moderate";

      queueMicrotask(() => {
        setClips(loadedClips);
        setActiveClipId(loadedClips[0]?.id || "");
        setCurrentTime(loadedClips[0]?.startTime || 0);
        setAnalysisMetrics({
          avgScore,
          hookStrength,
          topKeywords: results.topKeywords?.slice(0, 5) || [],
          clipCount: loadedClips.length,
        });
        setIsLoadingClips(false);
      });
    } else {
      queueMicrotask(() => {
        setClips([]);
        setIsLoadingClips(false);
      });
    }

    if (transcript) {
      queueMicrotask(() => setFullTranscript(transcript.fullText));
    }
  }, [projectId]);

  // Load video from IndexedDB
  useEffect(() => {
    let localUrl = "";
    const loadVideo = async () => {
      try {
        const file = await getVideoFile(projectId);
        if (file) {
          localUrl = URL.createObjectURL(file);
          setVideoUrl(localUrl);
        } else {
          setVideoUrl("/placeholder.mp4");
        }
      } catch (e) {
        console.error("AuraClip: Failed to load video from IndexedDB:", e);
        setVideoUrl("/placeholder.mp4");
      }
    };
    loadVideo();

    return () => {
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [projectId]);

  const activeClip = clips.find((c) => c.id === activeClipId) || clips[0];
  const bestClipId = clips.length > 0 ? [...clips].sort((a, b) => b.viralScore - a.viralScore)[0].id : "";

  const handleDownloadActiveClip = async () => {
    if (!activeClip) return;
    setIsExporting(true);
    try {
      const { downloadClip } = await import("@/lib/clipExporter");
      const { getVideoFile } = await import("@/lib/videoStorage");
      const file = await getVideoFile(projectId);
      if (!file) {
        alert("Original video file not found in local storage. Please re-upload the video.");
        return;
      }
      await downloadClip(
        file,
        activeClip.startTime,
        activeClip.endTime,
        activeClip.title,
        (percent, message) => {
          console.log(`AuraClip Export: ${percent}% — ${message}`);
        },
        projectId
      );
    } catch (err) {
      console.error("AuraClip: Clip export failed:", err);
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  };

  const handleClipSelect = (clip: Clip) => {
    setActiveClipId(clip.id);
    setCurrentTime(clip.startTime);
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.currentTime = clip.startTime;
    }
  };

  const togglePlay = () => {
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    const video = videoRef.current;
    if (video) {
      if (nextPlaying) {
        video.muted = isMuted;
        video.volume = isMuted ? 0 : 1;
        video.play().catch((err) => {
          console.warn("AuraClip: Playback failed, trying muted:", err);
          video.muted = true;
          video.play().catch(console.error);
        });
      } else {
        video.pause();
      }
    }
  };

  const toggleMuteVideo = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = next;
      videoRef.current.volume = next ? 0 : 1;
    }
  };

  // Sync play/pause with video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      if (video.paused) {
        video.play().catch((err) => {
          console.warn("Playback block or play interrupted:", err);
          setIsPlaying(false);
        });
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
  }, [isPlaying]);

  // Sync seek position when active clip shifts
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    video.currentTime = activeClip.startTime;
    setCurrentTime(activeClip.startTime);
  }, [activeClipId, activeClip]);

  // Video time tracker and loop boundaries checks
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !activeClip) return;

    const time = video.currentTime;
    if (time >= activeClip.endTime || time < activeClip.startTime - 0.5) {
      video.currentTime = activeClip.startTime;
      setCurrentTime(activeClip.startTime);
    } else {
      setCurrentTime(time);
    }
  };

  const progressPercentage =
    activeClip && activeClip.duration > 0
      ? ((currentTime - activeClip.startTime) / activeClip.duration) * 100
      : 0;

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeClip || activeClip.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = activeClip.startTime + percentage * activeClip.duration;
    setCurrentTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  // Empty state: no clips processed yet
  if (!isLoadingClips && clips.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-background min-h-screen">
        <header className="border-b border-border/40 bg-card/10 backdrop-blur-md px-6 py-4 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg p-2 text-muted-foreground border border-border/30 hover:bg-white/5 hover:text-white transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-base font-bold text-white">{projectTitle}</h2>
            <p className="text-xs text-muted-foreground">
              No clips generated yet
            </p>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto space-y-6">
          <div className="h-16 w-16 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20 shadow-inner">
            <AlertCircle className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white">
              Clips Not Yet Available
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This project hasn&apos;t been processed yet, or the video is still
              being analyzed. Go back to the dashboard and upload a video to
              generate AI-analyzed clips.
            </p>
          </div>
          <Button
            onClick={() => router.push("/dashboard")}
            className="rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs px-6"
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background min-h-screen">
      {/* Detail Header / Navigation */}
      <header className="border-b border-border/40 bg-card/10 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg p-2 text-muted-foreground border border-border/30 hover:bg-white/5 hover:text-white transition-all shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white tracking-tight truncate max-w-[250px] sm:max-w-md">
              {projectTitle}
            </h2>
          </div>
        </div>
      </header>

      {/* Main detail page content */}
      <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl w-full mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* LEFT COLUMN: Main video preview workspace */}
        <div className="lg:col-span-7 space-y-6 flex flex-col">
          {/* Main Video Player Board */}
          <div
            ref={playerContainerRef}
            className="relative aspect-[9/16] max-h-[580px] w-full max-w-[320px] mx-auto rounded-2xl border border-border/40 bg-slate-950 overflow-hidden flex flex-col justify-between shadow-2xl group/player"
          >
            {/* Top gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80 pointer-events-none z-10" />

            {/* Real HTML5 Vertical Video element */}
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onClick={togglePlay}
                    onLoadedMetadata={() => {
                      // Explicitly unmute and set volume — browsers default to muted
                      // for programmatic playback; this forces audio on
                      if (videoRef.current) {
                        videoRef.current.muted = false;
                        videoRef.current.volume = isMuted ? 0 : 1;
                      }
                    }}
                    onError={(e) => {
                      console.error("AuraClip: Video element error event fired:", e);
                      setVideoError("unsupported");
                    }}
                    playsInline
                    style={{
                      transform: `scale(${activeClip?.scale || 100}%)`,
                      transition: "transform 0.15s ease-out",
                    }}
                    className={`w-full h-full cursor-pointer ${
                      activeClip?.fitMode === "contain"
                        ? "object-contain"
                        : isVerticalCrop
                        ? "object-cover"
                        : "object-contain"
                    }`}
                  />
                  {videoError && (
                    <div className="flex flex-col items-center justify-center p-6 text-center bg-slate-950 absolute inset-0 z-30">
                      <AlertCircle className="h-10 w-10 text-rose-500 mb-3 animate-pulse" />
                      <p className="text-xs font-bold text-white mb-2">Video playback failed</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed max-w-[240px]">
                        The browser could not load or play this video track. If your file is encoded in HEVC/H.265, your browser may require hardware decoding or a standard H.264 transcoding.
                      </p>
                      <Button
                        onClick={() => {
                          setVideoError(null);
                          if (videoRef.current) {
                            videoRef.current.load();
                          }
                        }}
                        className="mt-4 text-[10px] h-7 px-4 bg-violet-600 hover:bg-violet-500 text-white rounded-full font-medium"
                      >
                        Retry Loading
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center p-4">
                  <Loader2 className="h-8 w-8 text-violet-500 animate-spin mb-2" />
                  <span className="text-xs text-muted-foreground">
                    Loading video...
                  </span>
                </div>
              )}
            </div>

            {/* Dynamic caption subtitle overlays */}
            {isPlaying && activeClip?.transcript && enabledCaptionsClips[activeClip.id] && (
              <div className="absolute bottom-20 left-4 right-4 text-center z-20 pointer-events-none">
                <div className="bg-black/80 backdrop-blur-md rounded-xl px-4 py-3 border border-white/10 shadow-xl inline-block max-w-full">
                  <div className="flex flex-wrap justify-center items-center gap-x-1.5 gap-y-1 text-xs font-bold tracking-wide">
                    ⚡{" "}
                    {(() => {
                      const words = activeClip.transcript!.split(" ");
                      const progress =
                        activeClip.duration > 0
                          ? Math.max(
                              0,
                              Math.min(
                                1,
                                (currentTime - activeClip.startTime) /
                                  activeClip.duration
                              )
                            )
                          : 0;
                      const currentWordIndex = Math.floor(
                        progress * words.length
                      );

                      const windowSize = 5;
                      const start = Math.max(
                        0,
                        Math.min(
                          currentWordIndex - 2,
                          words.length - windowSize
                        )
                      );
                      const end = Math.min(start + windowSize, words.length);

                      return words.slice(start, end).map((word, idx) => {
                        const absoluteIdx = start + idx;
                        const isHighlighted =
                          absoluteIdx === currentWordIndex;
                        return (
                          <span
                            key={idx}
                            className={`transition-all duration-200 uppercase px-1 rounded ${
                              isHighlighted
                                ? "text-yellow-400 scale-110 bg-yellow-500/10 border border-yellow-500/20"
                                : "text-white/80"
                            }`}
                          >
                            {word}
                          </span>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Custom Interactive Player Bar overlay */}
            <div className="bg-black/90 border-t border-border/40 p-4 space-y-3 z-20 backdrop-blur-md">
              {/* Timeline duration track */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-muted-foreground w-8">
                  {formatTime(currentTime)}
                </span>
                <div
                  onClick={handleTimelineClick}
                  className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden relative cursor-pointer hover:h-2 transition-all"
                >
                  <div
                    className="h-full bg-violet-600 rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, progressPercentage))}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono text-slate-300 w-8 text-right">
                  {formatTime(activeClip?.endTime || 0)}
                </span>
              </div>

              {/* Action Buttons row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    onClick={togglePlay}
                    className="rounded-full p-2 text-white hover:bg-white/10 active:scale-95 transition-all"
                  >
                    {isPlaying ? (
                      <Pause className="h-4.5 w-4.5 fill-current" />
                    ) : (
                      <Play className="h-4.5 w-4.5 fill-current ml-0.5" />
                    )}
                  </button>
                  <button
                    onClick={toggleMuteVideo}
                    className="rounded-full p-2 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                  >
                    {isMuted ? (
                      <VolumeX className="h-4.5 w-4.5 text-rose-400" />
                    ) : (
                      <Volume2 className="h-4.5 w-4.5" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setIsVerticalCrop(!isVerticalCrop)}
                    className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all ${
                      isVerticalCrop
                        ? "text-violet-400 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20"
                        : "text-slate-300 bg-white/5 border border-border/30 hover:bg-white/10"
                    }`}
                  >
                    {isVerticalCrop ? "9:16 Crop" : "Original"}
                  </button>
                  <button
                    onClick={toggleFullscreen}
                    className="rounded-full p-2 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Maximize2 className="h-4.5 w-4.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Active Clip Action Console */}
          {activeClip && (
            <div className="relative overflow-hidden rounded-2xl border border-violet-500/25 bg-slate-900/60 backdrop-blur-md p-5 shadow-2xl flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-3 duration-300">
              <div className="absolute top-0 right-0 h-32 w-32 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                      Active Clip
                    </span>
                    {activeClip.id === bestClipId && (
                      <span className="text-[10px] uppercase font-extrabold tracking-wider text-amber-900 bg-amber-400 px-2.5 py-0.5 rounded border border-amber-300 flex items-center gap-0.5 animate-pulse shadow-md">
                        🔥 AI Best Pick
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-extrabold text-white tracking-tight">
                    {activeClip.title}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-950/40 rounded-lg px-3 py-1 border border-border/10 font-mono text-xs text-slate-300 shrink-0">
                  <Clock className="h-3.5 w-3.5 text-violet-400" />
                  <span>{formatTime(activeClip.startTime)} - {formatTime(activeClip.endTime)} ({Math.round(activeClip.duration)}s)</span>
                </div>
              </div>
              
              {activeClip.reason && (
                <div className="text-xs text-slate-300 italic border-l-2 border-violet-500/40 pl-3 leading-relaxed">
                  &ldquo;{activeClip.reason}&rdquo;
                </div>
              )}
              
              {/* Action Buttons Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-1.5">
                {enabledCaptionsClips[activeClip.id] ? (
                  <Button
                    onClick={() => {
                      setEnabledCaptionsClips((prev) => ({ ...prev, [activeClip.id]: false }));
                    }}
                    className="h-9.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-lg shadow-rose-900/20 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer animate-in fade-in duration-200"
                  >
                    <Type className="h-3.5 w-3.5" />
                    Remove Caption
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setEnabledCaptionsClips((prev) => ({ ...prev, [activeClip.id]: true }));
                      router.push(`/dashboard/project/${projectId}/editor?tab=captions`);
                    }}
                    className="h-9.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-lg shadow-violet-900/20 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer animate-in fade-in duration-200"
                  >
                    <Type className="h-3.5 w-3.5" />
                    Add Caption
                  </Button>
                )}
                
                <Button
                  onClick={() => router.push(`/dashboard/project/${projectId}/editor?tab=audio`)}
                  className="h-9.5 rounded-xl bg-slate-850 hover:bg-slate-750 text-xs font-bold text-white flex items-center justify-center gap-1.5 border border-border/20 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                >
                  <Music className="h-3.5 w-3.5" />
                  Add Music
                </Button>
                
                <Button
                  onClick={() => {
                    setEditingClip({ ...activeClip });
                    setIsEditModalOpen(true);
                  }}
                  className="h-9.5 rounded-xl bg-slate-850 hover:bg-slate-750 text-xs font-bold text-white flex items-center justify-center gap-1.5 border border-border/20 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  Edit Clip
                </Button>
                
                <Button
                  onClick={() => router.push(`/dashboard/project/${projectId}/editor?tab=scenes`)}
                  className="h-9.5 rounded-xl bg-slate-850 hover:bg-slate-750 text-xs font-bold text-white flex items-center justify-center gap-1.5 border border-border/20 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Edit layout
                </Button>
                
                <Button
                  onClick={handleDownloadActiveClip}
                  disabled={isExporting}
                  className="h-9.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-xs font-extrabold text-slate-950 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-900/20 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-950" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5 text-slate-950 fill-current" />
                      Make a Reel
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Video Metadata / Real AI Diagnostics */}
          <div className="border border-border/40 bg-card/20 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              AI Analysis Diagnostics
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="bg-slate-950/40 rounded-lg p-3 border border-border/10">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Zap className="h-3 w-3 text-amber-400" />
                  <p className="text-[10px] text-muted-foreground">
                    Hook Strength
                  </p>
                </div>
                <p className="text-base font-extrabold text-white">
                  {analysisMetrics.hookStrength}
                </p>
              </div>
              <div className="bg-slate-950/40 rounded-lg p-3 border border-border/10">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <TrendingUp className="h-3 w-3 text-emerald-400" />
                  <p className="text-[10px] text-muted-foreground">
                    Avg Score
                  </p>
                </div>
                <p className="text-base font-extrabold text-white">
                  {analysisMetrics.avgScore}%
                </p>
              </div>
              <div className="bg-slate-950/40 rounded-lg p-3 border border-border/10">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Target className="h-3 w-3 text-violet-400" />
                  <p className="text-[10px] text-muted-foreground">
                    Clips Found
                  </p>
                </div>
                <p className="text-base font-extrabold text-white">
                  {analysisMetrics.clipCount}
                </p>
              </div>
              <div className="bg-slate-950/40 rounded-lg p-3 border border-border/10">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Award className="h-3 w-3 text-fuchsia-400" />
                  <p className="text-[10px] text-muted-foreground">
                    Top Topic
                  </p>
                </div>
                <p className="text-base font-extrabold text-white truncate">
                  {analysisMetrics.topKeywords[0]
                    ? analysisMetrics.topKeywords[0].charAt(0).toUpperCase() +
                      analysisMetrics.topKeywords[0].slice(1)
                    : "N/A"}
                </p>
              </div>
            </div>

            {/* Top Keywords */}
            {analysisMetrics.topKeywords.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">
                  Keywords:
                </span>
                {analysisMetrics.topKeywords.map((kw, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 font-medium"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Extracted Clips List */}
        <div className="lg:col-span-5 flex flex-col space-y-6">
          {/* Tab selector for clips vs transcription */}
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab("clips")}
                className={`text-xs font-bold pb-2 border-b-2 transition-all ${
                  activeTab === "clips"
                    ? "border-violet-500 text-white"
                    : "border-transparent text-muted-foreground hover:text-white"
                }`}
              >
                Extracted Clips ({clips.length})
              </button>
              <button
                onClick={() => setActiveTab("transcript")}
                className={`text-xs font-bold pb-2 border-b-2 transition-all ${
                  activeTab === "transcript"
                    ? "border-violet-500 text-white"
                    : "border-transparent text-muted-foreground hover:text-white"
                }`}
              >
                Full Transcript
              </button>
              <button
                onClick={() => setActiveTab("publish")}
                className={`text-xs font-bold pb-2 border-b-2 transition-all ${
                  activeTab === "publish"
                    ? "border-violet-500 text-white"
                    : "border-transparent text-muted-foreground hover:text-white"
                }`}
              >
                Publishing Console
              </button>
            </div>

            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              AI Analysis Complete
            </span>
          </div>

          {/* Tab Content rendering */}
          {activeTab === "clips" ? (
            <div className="space-y-4 max-h-[750px] overflow-y-auto pr-2 custom-scrollbar">
              {isLoadingClips ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 text-violet-400 animate-spin mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Loading clips...
                  </p>
                </div>
              ) : (
                clips.map((clip, idx) => {
                  const hasCaptions = enabledCaptionsClips[clip.id];
                  const clipToRender = hasCaptions 
                    ? clip 
                    : { ...clip, transcript: undefined, hookText: undefined };
                  return (
                    <ClipCard
                      key={clip.id}
                      clip={clipToRender}
                      isActive={clip.id === activeClipId}
                      isBestPick={clip.id === bestClipId}
                      onSelect={() => handleClipSelect(clip)}
                      onEdit={() =>
                        router.push(
                          `/dashboard/project/${projectId}/editor?tab=scenes`
                        )
                      }
                      index={idx + 1}
                    />
                  );
                })
              )}
            </div>
          ) : activeTab === "publish" ? (
            <PublishConsole projectId={projectId} activeClip={activeClip} />
          ) : (
            // Full transcript preview panel
            <div className="border border-border/40 bg-card/20 rounded-xl p-5 space-y-4 max-h-[700px] overflow-y-auto pr-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/10 pb-3">
                <span className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  Full Transcript
                </span>
                <span className="cursor-pointer hover:text-white transition-colors">
                  Export SRT
                </span>
              </div>

              {fullTranscript ? (
                <div className="space-y-4">
                  {/* Full transcript text */}
                  <div className="text-xs leading-relaxed font-mono text-slate-300 whitespace-pre-wrap">
                    {fullTranscript}
                  </div>

                  {/* Clip markers in transcript */}
                  <div className="border-t border-border/10 pt-4 space-y-3">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-violet-400">
                      Clip Segments
                    </h4>
                    {clips.map((c, idx) => (
                      <div
                        key={c.id}
                        onClick={() => handleClipSelect(c)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer ${
                          c.id === activeClipId
                            ? "border-violet-500/40 bg-violet-500/5 text-white"
                            : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-slate-200"
                        }`}
                      >
                        <div className="flex justify-between items-center text-[10px] font-bold text-violet-400 mb-1.5">
                          <span>
                            Clip {idx + 1}: {c.title}
                          </span>
                          <span className="bg-slate-900 border border-border/10 px-2 py-0.5 rounded text-white">
                            {formatTime(c.startTime)} -{" "}
                            {formatTime(c.endTime)}
                          </span>
                        </div>
                        {c.transcript && (
                          <p className="text-xs text-slate-400 line-clamp-2">
                            &ldquo;{c.transcript}&rdquo;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">
                    No transcript available for this project.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editingClip && (
        <ClipEditorModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingClip(null);
          }}
          clip={editingClip}
          projectDuration={projectDuration}
          onSave={handleSaveEditedClip}
        />
      )}
    </div>
  );
}

// standalone interactive Clip Editor Modal component
interface ClipEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  clip: Clip;
  projectDuration: number;
  onSave: (updatedClip: Clip) => void;
}

function ClipEditorModal({ isOpen, onClose, clip, projectDuration, onSave }: ClipEditorModalProps) {
  const [title, setTitle] = useState(clip.title);
  const [startTime, setStartTime] = useState(clip.startTime);
  const [endTime, setEndTime] = useState(clip.endTime);
  const [scale, setScale] = useState(clip.scale || 100);
  const [fitMode, setFitMode] = useState<"cover" | "contain">(clip.fitMode || "cover");

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
      ...clip,
      title,
      startTime: Number(startTime),
      endTime: Number(endTime),
      duration: Math.max(0.5, Number(endTime) - Number(startTime)),
      scale: Number(scale),
      fitMode,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-border/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-6">
        <div>
          <h3 className="text-lg font-bold text-white">Edit Clip Settings</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Adjust clip start/end times and video zoom size in the vertical viewport.
          </p>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Clip Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
            />
          </div>

          {/* Start and End Times */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Start Time (sec)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max={endTime}
                value={startTime}
                onChange={(e) => setStartTime(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">End Time (sec)</label>
              <input
                type="number"
                step="0.1"
                min={startTime}
                max={projectDuration}
                value={endTime}
                onChange={(e) => setEndTime(Math.min(projectDuration, Number(e.target.value)))}
                className="w-full rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Timeline Range Slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Start: {startTime.toFixed(1)}s</span>
              <span>End: {endTime.toFixed(1)}s</span>
            </div>
            <div className="space-y-1">
              <input
                type="range"
                min="0"
                max={projectDuration}
                step="0.1"
                value={startTime}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val < endTime) setStartTime(val);
                }}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
              <input
                type="range"
                min="0"
                max={projectDuration}
                step="0.1"
                value={endTime}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val > startTime) setEndTime(val);
                }}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
            </div>
          </div>

          {/* Scaling (Zoom Level) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-slate-300">Video Zoom (Scale)</label>
              <span className="text-[11px] font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded">
                {scale}%
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="200"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-violet-500"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>50% (Smaller)</span>
              <span>100% (Default)</span>
              <span>200% (Larger)</span>
            </div>
          </div>

          {/* Fit Mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Viewport Fitting</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFitMode("cover")}
                className={`py-1.5 rounded-lg text-xs font-bold transition-all border ${
                  fitMode === "cover"
                    ? "text-violet-400 bg-violet-500/10 border-violet-500"
                    : "text-slate-400 bg-white/5 border-border/20 hover:bg-white/10"
                }`}
              >
                Cover (9:16 Crop)
              </button>
              <button
                type="button"
                onClick={() => setFitMode("contain")}
                className={`py-1.5 rounded-lg text-xs font-bold transition-all border ${
                  fitMode === "contain"
                    ? "text-violet-400 bg-violet-500/10 border-violet-500"
                    : "text-slate-400 bg-white/5 border-border/20 hover:bg-white/10"
                }`}
              >
                Contain (Letterbox)
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-4 border-t border-border/20">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-xs hover:bg-white/5 rounded-full px-5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-full px-6"
          >
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
