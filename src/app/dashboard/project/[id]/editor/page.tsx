"use strict";
"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Film, Upload, AlertCircle, Loader2, Info, Type, Music, Scissors, Trash2, Layers } from "lucide-react";
import { useEditorStore, VideoClip, AudioClip, ElementOverlay } from "@/store/editorStore";
import { getVideoDuration, generateThumbnailsCanvas } from "@/lib/ffmpeg";
import EditorHeader from "@/components/editor/EditorHeader";
import PreviewPlayer from "@/components/editor/PreviewPlayer";
import Timeline from "@/components/editor/Timeline";
import AudioControls from "@/components/editor/AudioControls";
import CaptionsControls from "@/components/editor/CaptionsControls";
import ElementsControls from "@/components/editor/ElementsControls";
import { Button } from "@/components/ui/button";

import { getVideoFile } from "@/lib/videoStorage";
import { getProcessingResults } from "@/lib/processingPipeline";

export default function VideoEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground font-medium">
          <Loader2 className="h-6 w-6 animate-spin mb-2" />
          Loading Video Editor...
        </div>
      }
    >
      <VideoEditorContent />
    </Suspense>
  );
}

function VideoEditorContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.id as string;

  const [activeTab, setActiveTab] = useState<"audio" | "captions" | "scenes" | "elements">("elements");

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "audio" || tabParam === "captions" || tabParam === "scenes" || tabParam === "elements") {
      queueMicrotask(() => setActiveTab(tabParam));
    }
  }, [searchParams]);

  const {
    videoFile,
    videoClips,
    audioClips,
    elementOverlays,
    currentTime,
    isPlaying,
    selectedClipId,
    selectedTrackType,
    setVideoFile,
    clearVideoFile,
    setIsPlaying,
    splitVideoClip,
    deleteVideoClip,
    deleteAudioClip,
    undo,
    redo,
  } = useEditorStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Local Auto-Save Logic (Local Storage hook)
  useEffect(() => {
    if (!videoFile) return;

    // Trigger local autosave on clips mutations
    const saveTimer = setTimeout(() => {
      const data = {
        videoClips,
        audioClips,
        elementOverlays,
      };
      localStorage.setItem(`auraclip_autosave_${projectId}`, JSON.stringify(data));
      console.log("AuraClip: Timeline configuration auto-saved locally.");
    }, 1000);

    return () => clearTimeout(saveTimer);
  }, [videoClips, audioClips, elementOverlays, projectId, videoFile]);

  // Load previous autosaved session configuration if available
  useEffect(() => {
    return () => {
      // Clear store on unmount
      clearVideoFile();
    };
  }, [clearVideoFile]);

  // Auto-load stored video file from IndexedDB
  useEffect(() => {
    const autoLoad = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const file = await getVideoFile(projectId);
        if (file) {
          // Read duration and size
          const duration = await getVideoDuration(file);
          const sizeInMb = (file.size / (1024 * 1024)).toFixed(1) + " MB";

          // Load thumbnails
          const thumbs = await generateThumbnailsCanvas(file, 8);

          // 1. Check if there is an autosave for this project's editor session
          let initialClips: VideoClip[] | undefined = undefined;
          let initialAudioClips: AudioClip[] | undefined = undefined;
          let initialElementOverlays: ElementOverlay[] | undefined = undefined;
          
          const autosavedData = localStorage.getItem(`auraclip_autosave_${projectId}`);
          if (autosavedData) {
            try {
              const parsed = JSON.parse(autosavedData);
              if (parsed.videoClips && Array.isArray(parsed.videoClips)) {
                initialClips = parsed.videoClips as VideoClip[];
                console.log("AuraClip: Found autosaved video clips.");
              }
              if (parsed.audioClips && Array.isArray(parsed.audioClips)) {
                initialAudioClips = parsed.audioClips as AudioClip[];
                console.log("AuraClip: Found autosaved audio clips.");
              }
              if (parsed.elementOverlays && Array.isArray(parsed.elementOverlays)) {
                initialElementOverlays = parsed.elementOverlays as ElementOverlay[];
                console.log("AuraClip: Found autosaved elements overlays.");
              }
            } catch (e) {
              console.warn("AuraClip: Failed to parse autosaved editor data", e);
            }
          }

          // 2. If no autosave, load the AI-generated clips from the processing results
          if (!initialClips) {
            const results = getProcessingResults(projectId);
            if (results && results.clips.length > 0) {
              initialClips = results.clips.map((c) => ({
                id: c.id,
                title: c.title,
                startTime: c.startTime,
                endTime: c.endTime,
                duration: c.duration,
                volume: 1.0,
                playStartTime: 0,
                transcript: c.transcript,
                hookText: c.hookText,
                keywords: c.keywords,
              })) as VideoClip[];
              console.log("AuraClip: Loaded AI-generated clips into editor.");
            }
          }

          // Set video in Zustand store
          setVideoFile(file, duration, sizeInMb, thumbs, initialClips, initialAudioClips, initialElementOverlays);
          console.log("AuraClip: Auto-loaded video file from IndexedDB.");
        }
      } catch (err) {
        console.warn("AuraClip: Failed to auto-load video file from IndexedDB:", err);
      } finally {
        setIsLoading(false);
      }
    };
    autoLoad();
  }, [projectId, setVideoFile]);

  // 2. Keyboard Shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      // Spacebar is handled synchronously in PreviewPlayer.tsx to prevent browser audio blocking

      if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedTrackType === "video" && selectedClipId) {
          splitVideoClip(selectedClipId, currentTime);
        }
      }

      if (e.code === "Backspace" || e.code === "Delete") {
        if (selectedClipId) {
          e.preventDefault();
          if (selectedTrackType === "video") {
            deleteVideoClip(selectedClipId);
          } else {
            deleteAudioClip(selectedClipId);
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        undo();
      }

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoFile, isPlaying, selectedClipId, selectedTrackType, currentTime, setIsPlaying, splitVideoClip, deleteVideoClip, deleteAudioClip, undo, redo]);

  // 3. Handle File Selection in Editor Onboarding
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsLoading(true);

    try {
      if (!file.name.match(/\.(mp4|mov|avi|webm)$/i)) {
        throw new Error("Unsupported format. Please select MP4, MOV, AVI, or WebM.");
      }

      const duration = await getVideoDuration(file);
      const sizeInMb = (file.size / (1024 * 1024)).toFixed(1) + " MB";
      const thumbs = await generateThumbnailsCanvas(file, 8);

      setVideoFile(file, duration, sizeInMb, thumbs);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Failed to parse video details.";
      setError(errMsg);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground overflow-hidden">
      {/* Editor top header */}
      <EditorHeader projectId={projectId} />

      <div className="flex-1 flex overflow-hidden relative">
        {videoFile ? (
          /* WORKSPACE VIEWPORT LAYOUT */
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            
            {/* Left Vertical Canva-style Toolbar */}
            <div className="w-16 md:w-20 bg-slate-950/80 border-r border-border/40 flex flex-col items-center py-6 gap-6 shrink-0 z-20">
              <button
                type="button"
                onClick={() => setActiveTab("elements")}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl text-center w-14 md:w-16 transition-all cursor-pointer group ${
                  activeTab === "elements"
                    ? "text-violet-400 bg-violet-500/10 border border-violet-500/20"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <Layers className="h-5 w-5 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-bold tracking-tight">Elements</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("captions")}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl text-center w-14 md:w-16 transition-all cursor-pointer group ${
                  activeTab === "captions"
                    ? "text-pink-400 bg-pink-500/10 border border-pink-500/20"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <Type className="h-5 w-5 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-bold tracking-tight">Subtitles</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("audio")}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl text-center w-14 md:w-16 transition-all cursor-pointer group ${
                  activeTab === "audio"
                    ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <Music className="h-5 w-5 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-bold tracking-tight">Audio</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("scenes")}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl text-center w-14 md:w-16 transition-all cursor-pointer group ${
                  activeTab === "scenes"
                    ? "text-amber-400 bg-amber-500/10 border border-amber-500/20"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <Film className="h-5 w-5 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-bold tracking-tight">Scenes</span>
              </button>
            </div>

            {/* Sliding Panel Drawer */}
            <div className="w-80 md:w-96 bg-slate-900/60 border-r border-border/40 h-full flex flex-col z-10 shrink-0">
              <div className="flex-1 min-h-0">
                {activeTab === "elements" && <ElementsControls />}
                {activeTab === "captions" && <CaptionsControls />}
                {activeTab === "audio" && <AudioControls />}
                {activeTab === "scenes" && <ScenesManager />}
              </div>
            </div>

            {/* Right Main Editor Canvas & Timeline */}
            <div className="flex-1 flex flex-col overflow-hidden p-6 gap-6 justify-between">
              {/* Preview Player in the center */}
              <div className="flex-1 flex items-center justify-center min-h-[300px]">
                <div className="w-full max-w-4xl">
                  <PreviewPlayer />
                </div>
              </div>

              {/* Timeline at the bottom */}
              <div className="shrink-0 w-full">
                <Timeline />
              </div>
            </div>

          </div>
        ) : (
          /* EMPTY ONBOARDING IMPORT WORKSPACE */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto space-y-6">
            <div className="h-16 w-16 rounded-full bg-violet-600/10 text-violet-400 flex items-center justify-center border border-violet-500/20 shadow-inner">
              <Film className="h-8 w-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Load Curation Editor</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                AuraClip compiles edits locally in your browser. Select a video file to activate the split/trim timelines, audio fade curves, and in-browser WASM rendering.
              </p>
            </div>

            <div className="w-full relative border border-dashed border-border/40 hover:border-violet-500/50 bg-white/5 hover:bg-white/10 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all duration-300">
              <input
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                disabled={isLoading}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              
              {isLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
                  <p className="text-xs font-semibold text-white">Parsing metadata & frames...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-6 w-6 text-violet-400 mb-1" />
                  <span className="text-xs font-semibold text-white">Choose video file to start</span>
                  <span className="text-[10px] text-muted-foreground">MP4, MOV, WebM up to 5GB</span>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 w-full justify-center">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-start gap-2 text-left bg-slate-900/40 border border-border/10 rounded-xl p-3.5 text-[10px] text-muted-foreground leading-normal">
              <Info className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
              <span>
                <strong>Privacy note:</strong> Your video files never leave your computer. All rendering and processing occur 100% locally in your browser sandbox using WebAssembly.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Canva-style Scenes List Sidebar Component
function ScenesManager() {
  const {
    videoClips,
    selectedClipId,
    setSelectedClip,
    setCurrentTime,
    deleteVideoClip,
    currentTime,
    splitVideoClip,
    updateVideoClip,
  } = useEditorStore();

  const selectedClip = videoClips.find((c) => c.id === selectedClipId);

  const handleSplitScene = (clip: VideoClip) => {
    splitVideoClip(clip.id, currentTime);
  };

  // Click a scene: select it AND seek the video to its start
  const handleSceneClick = (clip: VideoClip) => {
    setSelectedClip(clip.id, "video");
    setCurrentTime(clip.playStartTime);
  };

  return (
    <div className="bg-slate-950/60 border border-border/40 rounded-xl p-5 flex flex-col gap-5 shadow-2xl h-full justify-between overflow-y-auto max-h-[600px] custom-scrollbar">
      <div className="space-y-5">
        <div className="flex items-center gap-2 border-b border-border/40 pb-3">
          <Film className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white tracking-tight">Scenes Manager</h3>
        </div>

        <div className="space-y-3">
          {videoClips.map((clip, idx) => {
            const isSelected = selectedClipId === clip.id;
            const isPlayheadInside =
              currentTime >= clip.playStartTime &&
              currentTime <= clip.playStartTime + clip.duration;

            return (
              <div
                key={clip.id}
                onClick={() => handleSceneClick(clip)}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all relative group flex flex-col gap-2 ${
                  isSelected
                    ? "border-amber-500 bg-amber-500/5 text-white"
                    : "border-border/40 bg-white/5 text-slate-300 hover:border-amber-500/30 hover:bg-white/10"
                }`}
              >
                <div className="flex justify-between items-center text-[10px] font-bold text-amber-400">
                  <span className="flex items-center gap-1.5">
                    <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded text-[8px]">
                      SCENE {idx + 1}
                    </span>
                    {isPlayheadInside && (
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                    )}
                  </span>
                  <span className="text-muted-foreground font-mono">
                    {clip.duration.toFixed(1)}s
                  </span>
                </div>
                <h4 className="text-xs font-bold text-white truncate max-w-[85%]">
                  {clip.title}
                </h4>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isSelected && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSplitScene(clip);
                      }}
                      className="h-6 w-6 rounded hover:bg-white/10 hover:text-white shrink-0 cursor-pointer"
                      title="Split scene at playhead (S)"
                    >
                      <Scissors className="h-3 w-3" />
                    </Button>
                  )}
                  {videoClips.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteVideoClip(clip.id);
                      }}
                      className="h-6 w-6 rounded hover:bg-rose-500/20 text-rose-400 shrink-0 cursor-pointer"
                      title="Delete scene"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {selectedClip && (
          <div className="bg-slate-900 border border-border/40 rounded-xl p-4 space-y-4 shrink-0 mt-4">
            <div className="flex items-center gap-1.5 border-b border-border/40 pb-2">
              <Scissors className="h-4 w-4 text-violet-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Edit Selected Scene</h4>
            </div>

            <div className="space-y-3">
              {/* Title */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400">Title</label>
                <input
                  type="text"
                  value={selectedClip.title}
                  onChange={(e) => updateVideoClip(selectedClip.id, { title: e.target.value })}
                  className="w-full rounded border border-border/40 bg-white/5 px-2.5 py-1 text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Start / End Trim */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400">Start Time (s)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={selectedClip.startTime.toFixed(1)}
                    onChange={(e) => updateVideoClip(selectedClip.id, { startTime: Math.max(0, Number(e.target.value)) })}
                    className="w-full rounded border border-border/40 bg-white/5 px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400">End Time (s)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={selectedClip.endTime.toFixed(1)}
                    onChange={(e) => updateVideoClip(selectedClip.id, { endTime: Number(e.target.value) })}
                    className="w-full rounded border border-border/40 bg-white/5 px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Video Zoom */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px] text-slate-400">
                  <span>Video Zoom (Scale)</span>
                  <span className="text-violet-400 font-bold">{selectedClip.scale || 100}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={selectedClip.scale || 100}
                  onChange={(e) => updateVideoClip(selectedClip.id, { scale: Number(e.target.value) })}
                  className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-violet-500"
                />
              </div>

              {/* Fitting Mode */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400">Fitting Mode</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateVideoClip(selectedClip.id, { fitMode: "cover" })}
                    className={`py-1 rounded text-[10px] font-bold border ${
                      selectedClip.fitMode !== "contain"
                        ? "text-violet-400 bg-violet-500/10 border-violet-500"
                        : "text-slate-400 bg-white/5 border-border/20 hover:bg-white/10"
                    }`}
                  >
                    Cover (9:16 Crop)
                  </button>
                  <button
                    type="button"
                    onClick={() => updateVideoClip(selectedClip.id, { fitMode: "contain" })}
                    className={`py-1 rounded text-[10px] font-bold border ${
                      selectedClip.fitMode === "contain"
                        ? "text-violet-400 bg-violet-500/10 border-violet-500"
                        : "text-slate-400 bg-white/5 border-border/20 hover:bg-white/10"
                    }`}
                  >
                    Contain (Letterbox)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-900/40 rounded-xl border border-border/10 p-3.5 text-[10px] text-muted-foreground leading-normal shrink-0">
        <p className="font-semibold text-white mb-1">How to edit clips:</p>
        Select a clip block to edit its zoom level, viewport fitting, name, and trim bounds directly in the panel above.
      </div>
    </div>
  );
}
