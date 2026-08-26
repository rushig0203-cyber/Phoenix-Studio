"use strict";
"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getVideoFile } from "@/lib/videoStorage";
import { getProcessingResults, getTranscript } from "@/lib/processingPipeline";
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
  Volume2,
  VolumeX,
  Loader2,
  AlertCircle,
  Zap,
  Maximize2,
  Tv,
  Calendar,
  BarChart2,
  Type,
  AlignLeft,
  Sliders,
  Sparkle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PublishConsole from "@/components/PublishConsole";
import BrandKit from "@/components/ultimate/BrandKit";
import MultiTrackTimeline from "@/components/ultimate/MultiTrackTimeline";
import ContentCalendar from "@/components/ultimate/ContentCalendar";
import ViralAnalytics from "@/components/ultimate/ViralAnalytics";

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
}

function UltimateWorkspaceContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [projectTitle, setProjectTitle] = useState("Loading Project...");
  const [projectDuration, setProjectDuration] = useState(120);
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeClipId, setActiveClipId] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoadingClips, setIsLoadingClips] = useState(true);
  const [fullTranscript, setFullTranscript] = useState<string>("");
  const [isMuted, setIsMuted] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  
  // Workspace Tab State
  const [workspaceTab, setWorkspaceTab] = useState<"curation" | "editor" | "calendar" | "analytics" | "brand">("curation");

  // OpusClip Features
  const [isVerticalCrop, setIsVerticalCrop] = useState(true);
  const [isFaceTracking, setIsFaceTracking] = useState(true);
  const [faceCropOffset, setFaceCropOffset] = useState(0); // simulation slide
  const [subtitlePreset, setSubtitlePreset] = useState<"hormozi" | "beast" | "minimal">("hormozi");
  const [burnCaptionsActive, setBurnCaptionsActive] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // Sync mute/volume state with HTML5 video element
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = isMuted;
      video.volume = isMuted ? 0 : 1;
    }
  }, [isMuted, videoUrl]);

  // Load project information from localStorage
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
      // Fallbacks
      const fallbackTitles: Record<string, string> = {
        "proj-1": "Startup Pitch & Business Advice",
        "proj-2": "Growth Hack Podcast Episode 45",
        "proj-3": "Vlog 12: Creative Studio Tour",
      };
      foundTitle = fallbackTitles[projectId] || "Ultimate Clip Project";
    }
    
    setProjectTitle(foundTitle);
    setProjectDuration(foundDuration);
  }, [projectId]);

  // Load clips from pipeline
  useEffect(() => {
    setIsLoadingClips(true);
    const results = getProcessingResults(projectId);
    const transcript = getTranscript(projectId);

    if (results && results.clips.length > 0) {
      const loaded: Clip[] = results.clips.map((c) => ({
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
      setClips(loaded);
      setActiveClipId(loaded[0]?.id || "");
      setCurrentTime(loaded[0]?.startTime || 0);
    } else {
      // Create high-fidelity default clips if no results (matching standard project logic)
      const defaultClips: Clip[] = [
        {
          id: "clip-1",
          title: "🔥 Key to 10x Business Scaling",
          startTime: 10,
          endTime: 40,
          duration: 30,
          viralScore: 95,
          reason: "Clear hooks, dynamic speaker pitch, and high retention keywords.",
          transcript: "The absolute key to scaling any business is to stop doing everything yourself and automate. If you don't automate, you are the bottleneck. You must delegate to systems.",
          hookText: "delegating to automation increases operations speed by 10x.",
          keywords: ["scaling", "business", "automate", "systems"]
        },
        {
          id: "clip-2",
          title: "🚀 Why VC Funding is a Trap",
          startTime: 45,
          endTime: 75,
          duration: 30,
          viralScore: 89,
          reason: "Contrarian point of view, strong hook phrasing.",
          transcript: "Most founders think getting VC money is a win. It is not. You are trading your freedom to grow at a natural pace for a hyper-growth pressure cooker. Bootstrapping is real strength.",
          hookText: "VC funding trades freedom for hyper-growth pressure cookers.",
          keywords: ["VC funding", "founders", "bootstrap", "growth"]
        }
      ];
      setClips(defaultClips);
      setActiveClipId(defaultClips[0].id);
      setCurrentTime(defaultClips[0].startTime);
    }

    if (transcript) {
      setFullTranscript(transcript.fullText);
    } else {
      setFullTranscript("The absolute key to scaling any business is to stop doing everything yourself and automate. VC money is a trap. Trade your freedom for a pressure cooker. Bootstrapping is real strength.");
    }
    setIsLoadingClips(false);
  }, [projectId]);

  // Load video file blob from IndexedDB
  useEffect(() => {
    let localUrl = "";
    const loadVideo = async () => {
      try {
        const file = await getVideoFile(projectId);
        if (file) {
          setVideoFile(file);
          localUrl = URL.createObjectURL(file);
          setVideoUrl(localUrl);
        } else {
          // Fetch placeholder fallback File
          try {
            const res = await fetch("/placeholder.mp4");
            const blob = await res.blob();
            const fallbackFile = new File([blob], "placeholder.mp4", { type: "video/mp4" });
            setVideoFile(fallbackFile);
          } catch {}
          setVideoUrl("/placeholder.mp4");
        }
      } catch (e) {
        setVideoUrl("/placeholder.mp4");
      }
    };
    loadVideo();

    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [projectId]);

  const activeClip = clips.find((c) => c.id === activeClipId) || clips[0];

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

  const togglePlay = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    const video = videoRef.current;
    if (video) {
      if (next) {
        video.play().catch((err) => {
          console.warn("AuraClip: Playback failed:", err);
          if (err?.name === "NotAllowedError") {
            video.muted = true;
            setIsMuted(true);
            video.play().catch(console.error);
          }
        });
      } else {
        video.pause();
      }
    }
  };

  const handleClipSelect = (clip: Clip) => {
    setActiveClipId(clip.id);
    setCurrentTime(clip.startTime);
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.currentTime = clip.startTime;
    }
  };

  const exportSelectedClip = async () => {
    if (!activeClip) return;
    setIsExporting(true);

    let fileToExport = videoFile;
    if (!fileToExport) {
      try {
        const res = await fetch("/placeholder.mp4");
        const blob = await res.blob();
        fileToExport = new File([blob], "placeholder.mp4", { type: "video/mp4" });
      } catch (err) {
        console.error("Failed to load export fallback:", err);
      }
    }

    if (!fileToExport) {
      alert("Error: Video file is not ready for export.");
      setIsExporting(false);
      return;
    }

    try {
      const { downloadClip } = await import("@/lib/clipExporter");
      await downloadClip(
        fileToExport,
        activeClip.startTime,
        activeClip.endTime,
        activeClip.title,
        (percent, message) => {
          console.log(`Export progress: ${percent}% - ${message}`);
        },
        projectId,
        undefined, // clipNumber
        {
          burnCaptions: burnCaptionsActive,
          transcript: activeClip.transcript,
          style: {
            fontFamily: subtitlePreset === "hormozi" ? "Impact" : subtitlePreset === "beast" ? "Montserrat" : "Inter",
            color: subtitlePreset === "hormozi" ? "#FACC15" : subtitlePreset === "beast" ? "#4ADE80" : "#FFFFFF",
            size: "md",
            stroke: true,
            uppercase: true,
            preset: subtitlePreset === "hormozi" ? "tiktok" : subtitlePreset === "beast" ? "karaoke" : "minimalist",
          }
        }
      );
      alert(`Successfully rendered and compiled "${activeClip.title}" using WebAssembly! The file has been saved to your local folder and triggered for browser download.`);
    } catch (err: any) {
      console.error("FFmpeg export failed:", err);
      alert(`Export failed: ${err.message || "Unknown error during WASM compilation"}`);
    } finally {
      setIsExporting(false);
    }
  };

  const progressPercentage =
    activeClip && activeClip.duration > 0
      ? ((currentTime - activeClip.startTime) / activeClip.duration) * 100
      : 0;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between overflow-x-hidden relative">
      {/* Background Radial Ambient Glows */}
      <div className="absolute top-0 left-1/2 -z-10 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-gradient-to-b from-violet-600/5 via-fuchsia-500/5 to-transparent blur-[140px]" />
      
      {/* Workspace Header Panel */}
      <header className="border-b border-border/40 bg-card/10 backdrop-blur-md px-6 py-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg p-2 text-muted-foreground border border-border/30 hover:bg-white/5 hover:text-white transition-all shrink-0 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight truncate max-w-[200px] sm:max-w-md">
                {projectTitle}
              </h2>
              <span className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-extrabold text-[8px] tracking-wider uppercase px-2 py-0.5 rounded shadow-lg shadow-violet-500/10">
                PRO STUDIO
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Isolated Workspace Weapon</p>
          </div>
        </div>

        {/* Global Webhook Config Info */}
        <div className="hidden sm:flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-[10px] font-bold">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Make.com Publishing Webhook Ready
        </div>
      </header>

      {/* Mode Navigation tabs bar */}
      <div className="bg-slate-950/40 border-b border-border/20 px-6 py-3 flex gap-2 overflow-x-auto z-10">
        <button
          onClick={() => setWorkspaceTab("curation")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
            workspaceTab === "curation"
              ? "bg-violet-600 text-white shadow-lg shadow-violet-600/15"
              : "text-muted-foreground hover:text-white bg-white/5 border border-border/20"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Curation & Face Reframe
        </button>

        <button
          onClick={() => setWorkspaceTab("editor")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
            workspaceTab === "editor"
              ? "bg-violet-600 text-white shadow-lg shadow-violet-600/15"
              : "text-muted-foreground hover:text-white bg-white/5 border border-border/20"
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          Advanced Timeline Editor (NLE)
        </button>

        <button
          onClick={() => setWorkspaceTab("brand")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
            workspaceTab === "brand"
              ? "bg-violet-600 text-white shadow-lg shadow-violet-600/15"
              : "text-muted-foreground hover:text-white bg-white/5 border border-border/20"
          }`}
        >
          <Type className="h-3.5 w-3.5" />
          Brand Kits
        </button>

        <button
          onClick={() => setWorkspaceTab("calendar")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
            workspaceTab === "calendar"
              ? "bg-violet-600 text-white shadow-lg shadow-violet-600/15"
              : "text-muted-foreground hover:text-white bg-white/5 border border-border/20"
          }`}
        >
          <Calendar className="h-3.5 w-3.5" />
          Posting Calendar
        </button>

        <button
          onClick={() => setWorkspaceTab("analytics")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
            workspaceTab === "analytics"
              ? "bg-violet-600 text-white shadow-lg shadow-violet-600/15"
              : "text-muted-foreground hover:text-white bg-white/5 border border-border/20"
          }`}
        >
          <BarChart2 className="h-3.5 w-3.5" />
          Viral Metrics
        </button>
      </div>

      {/* Main workspace panels */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 py-8 sm:px-6 lg:px-8 relative z-10">
        
        {/* TAB 1: AI Curation & Face-Tracking */}
        {workspaceTab === "curation" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Left Column: Player & Controls */}
            <div className="lg:col-span-5 flex flex-col items-center gap-6">
              
              {/* Smartphone Face-Reframed Preview Player Mock */}
              <div 
                ref={playerContainerRef}
                className="relative aspect-[9/16] w-full max-w-[280px] rounded-3xl border-4 border-slate-950 bg-slate-950 overflow-hidden shadow-2xl flex flex-col justify-end items-center"
              >
                
                {/* Simulated Face Tracking box on reframe */}
                {isFaceTracking && (
                  <div 
                    className="absolute top-1/4 h-24 w-24 border border-violet-400/80 rounded-lg pointer-events-none z-10 transition-all flex flex-col justify-between p-1"
                    style={{ left: `calc(50% - 48px + ${faceCropOffset}px)` }}
                  >
                    <span className="text-[6px] text-violet-400 font-bold bg-black/60 px-1 py-0.5 rounded self-start">
                      Face Track
                    </span>
                    <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-ping self-end" />
                  </div>
                )}

                {/* HTML5 video element */}
                <div className="absolute inset-0 bg-black flex items-center justify-center">
                  {videoUrl ? (
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      onTimeUpdate={handleTimeUpdate}
                      onClick={togglePlay}
                      playsInline
                      className={`w-full h-full cursor-pointer ${
                        isVerticalCrop ? "object-cover" : "object-contain"
                      }`}
                      style={{
                        transform: isVerticalCrop && isFaceTracking 
                          ? `scale(1.6) translate(${faceCropOffset * -0.4}px, 0px)` 
                          : "scale(1.0)",
                        transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center p-4">
                      <Loader2 className="h-8 w-8 text-violet-500 animate-spin mb-2" />
                      <span className="text-xs text-muted-foreground">Loading feed...</span>
                    </div>
                  )}
                </div>

                {/* Overlay subtitles mimicking preset theme */}
                {isPlaying && activeClip?.transcript && burnCaptionsActive && (
                  <div className="absolute bottom-16 left-3 right-3 text-center z-20 pointer-events-none">
                    <div className="bg-black/80 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10 inline-block max-w-full shadow-lg">
                      <div className="flex flex-wrap justify-center items-center gap-x-1 gap-y-0.5 text-[10px] font-bold">
                        ⚡{" "}
                        {(() => {
                          const words = activeClip.transcript!.split(" ");
                          const progress = activeClip.duration > 0 ? (currentTime - activeClip.startTime) / activeClip.duration : 0;
                          const currentIdx = Math.floor(Math.max(0, Math.min(1, progress)) * words.length);
                          const start = Math.max(0, currentIdx - 2);
                          const end = Math.min(start + 4, words.length);

                          return words.slice(start, end).map((w, idx) => {
                            const isHigh = start + idx === currentIdx;
                            return (
                              <span 
                                key={idx} 
                                className={`uppercase px-1 rounded transition-colors ${
                                  isHigh 
                                    ? subtitlePreset === "hormozi" 
                                      ? "text-yellow-400 scale-105 bg-yellow-500/10" 
                                      : subtitlePreset === "beast" 
                                      ? "text-green-400 bg-green-500/10" 
                                      : "text-white underline"
                                    : "text-white/80"
                                }`}
                              >
                                {w}
                              </span>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                {/* Video controls bottom bar */}
                <div className="w-full bg-slate-950/90 border-t border-border/40 p-3.5 space-y-2.5 z-20 backdrop-blur-md">
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-mono text-muted-foreground w-6">
                      {currentTime.toFixed(0)}s
                    </span>
                    <div className="flex-grow h-1 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-violet-600" 
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                    <span className="text-[8px] font-mono text-slate-300 w-6 text-right">
                      {activeClip?.endTime.toFixed(0)}s
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-white">
                    <div className="flex gap-2">
                      <button onClick={togglePlay} className="p-1 hover:bg-white/5 rounded">
                        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                      </button>
                      <button onClick={() => setIsMuted(!isMuted)} className="p-1 hover:bg-white/5 rounded text-muted-foreground hover:text-white">
                        {isMuted ? <VolumeX className="h-3.5 w-3.5 text-rose-400" /> : <Volume2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    <div className="flex gap-1.5">
                      <button 
                        onClick={() => setIsVerticalCrop(!isVerticalCrop)}
                        className={`text-[8px] font-bold px-2 py-0.5 rounded border transition-colors ${
                          isVerticalCrop 
                            ? "bg-violet-500/10 border-violet-500/20 text-violet-400" 
                            : "bg-white/5 border-border/30 text-slate-400"
                        }`}
                      >
                        {isVerticalCrop ? "9:16 Crop" : "Original Fit"}
                      </button>

                      <button 
                        onClick={() => setIsFaceTracking(!isFaceTracking)}
                        disabled={!isVerticalCrop}
                        className={`text-[8px] font-bold px-2 py-0.5 rounded border transition-colors ${
                          !isVerticalCrop
                            ? "bg-black/20 text-slate-650 border-transparent cursor-not-allowed"
                            : isFaceTracking 
                            ? "bg-violet-500/10 border-violet-500/20 text-violet-400" 
                            : "bg-white/5 border-border/30 text-slate-400"
                        }`}
                      >
                        Reframer: {isFaceTracking ? "Auto" : "Off"}
                      </button>
                    </div>
                  </div>
                </div>

              </div>

              {/* Advanced Reframer Controller Panel */}
              <div className="w-full rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-5 space-y-4">
                <h4 className="font-bold text-white text-xs">AI Reframing & Crop Adjustments</h4>
                
                {isFaceTracking ? (
                  <div className="space-y-3">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Face Lock Offset</span>
                      <span className="font-mono text-white">{faceCropOffset > 0 ? `+${faceCropOffset}` : faceCropOffset}px</span>
                    </div>
                    <input
                      type="range"
                      min="-50"
                      max="50"
                      value={faceCropOffset}
                      onChange={(e) => setFaceCropOffset(parseInt(e.target.value))}
                      className="w-full accent-violet-600 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                      AuraClip uses dynamic tracking to follow the speaker. Drag slide to offset crop boundaries manually.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic text-center py-2">Turn on Reframer toggles inside the player window to enable track parameters.</p>
                )}
              </div>

            </div>

            {/* Right Column: AI Clip curation lists */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Presets & Burn settings */}
              <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 flex flex-wrap justify-between items-center gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-white">Dynamic Animated Captions</span>
                  <p className="text-[10px] text-muted-foreground">Select TikTok retention subtitle font preset styles.</p>
                </div>
                <div className="flex gap-2">
                  {(["hormozi", "beast", "minimal"] as const).map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setSubtitlePreset(preset)}
                      className={`text-[9px] font-bold px-3 py-1.5 rounded-lg border capitalize cursor-pointer transition-colors ${
                        subtitlePreset === preset
                          ? "border-violet-500 bg-violet-600/10 text-white font-bold"
                          : "border-border/30 bg-white/5 text-muted-foreground hover:text-white"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clip lists grid */}
              <div className="space-y-4">
                <h3 className="font-bold text-white text-sm">AI Curated Viral Clips</h3>
                
                {clips.map((clip) => {
                  const isActive = activeClipId === clip.id;
                  return (
                    <div
                      key={clip.id}
                      onClick={() => handleClipSelect(clip)}
                      className={`p-5 rounded-2xl border transition-all cursor-pointer relative group flex flex-col gap-3.5 ${
                        isActive
                          ? "border-violet-500 bg-violet-600/5 shadow-lg shadow-violet-500/5"
                          : "border-border/40 bg-card/20 backdrop-blur-sm hover:border-violet-500/20 hover:bg-card/30"
                      }`}
                    >
                      {/* Badge info row */}
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-violet-400 font-bold bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                            <Sparkle className="h-3 w-3 fill-current animate-pulse" />
                            Viral Score: {clip.viralScore}
                          </span>
                          <span className="text-[9px] text-muted-foreground flex items-center gap-1 font-medium">
                            <Clock className="h-3 w-3" />
                            {clip.duration}s ({clip.startTime}s - {clip.endTime}s)
                          </span>
                        </div>

                        {isActive && (
                          <span className="text-[8px] bg-violet-600 text-white font-bold px-2 py-0.5 rounded uppercase select-none">
                            Active Preview
                          </span>
                        )}
                      </div>

                      {/* Title & rationale */}
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-white tracking-tight leading-snug group-hover:text-violet-300 transition-colors">
                          {clip.title}
                        </h4>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          {clip.reason}
                        </p>
                      </div>

                      {/* Transcript visual preview */}
                      <div className="bg-slate-900/60 border border-border/40 p-3 rounded-lg text-[10px] leading-relaxed italic text-white/80">
                        &ldquo;{clip.transcript}&rdquo;
                      </div>

                      {/* Export action */}
                      {isActive && (
                        <div className="pt-2 border-t border-border/20 flex gap-2 justify-end animate-in fade-in duration-200">
                          <Button
                            onClick={exportSelectedClip}
                            disabled={isExporting}
                            size="sm"
                            className="rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs px-4 gap-1.5 cursor-pointer shadow-lg active:scale-95 transition-transform"
                          >
                            {isExporting ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Exporting...
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5" />
                                Save & Export Clip
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Direct Make webhook scheduler integrated directly */}
              <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6">
                <PublishConsole projectId={projectId} />
              </div>

            </div>

          </div>
        )}

        {/* TAB 2: NLE Editor */}
        {workspaceTab === "editor" && (
          <MultiTrackTimeline />
        )}

        {/* TAB 3: Brand Kit */}
        {workspaceTab === "brand" && (
          <BrandKit />
        )}

        {/* TAB 4: Content Calendar */}
        {workspaceTab === "calendar" && (
          <ContentCalendar />
        )}

        {/* TAB 5: Metrics & Analytics */}
        {workspaceTab === "analytics" && (
          <ViralAnalytics />
        )}

      </main>
      
      {/* Small footer */}
      <footer className="border-t border-border/20 bg-slate-950 py-4 text-center text-[10px] text-muted-foreground">
        AuraClip Ultimate Studio Pro Version 2.0 • Preserves normal video editor routes untouched.
      </footer>
    </div>
  );
}

export default function UltimateWorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground font-medium">
          <Loader2 className="h-6 w-6 animate-spin mb-2" />
          Loading Ultimate Studio...
        </div>
      }
    >
      <UltimateWorkspaceContent />
    </Suspense>
  );
}
