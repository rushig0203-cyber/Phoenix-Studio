"use strict";
"use client";

import React, { useRef, useEffect, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  SkipBack,
  SkipForward,
  Maximize,
  AlertCircle,
} from "lucide-react";
import { useEditorStore, AudioClip, ElementOverlay } from "@/store/editorStore";
import { Button } from "@/components/ui/button";

export default function PreviewPlayer() {
  const {
    videoUrl,
    videoClips,
    audioClips,
    elementOverlays,
    selectedElementId,
    currentTime,
    isPlaying,
    setCurrentTime,
    setIsPlaying,
    setSelectedElementId,
    updateElementOverlay,
    captionFont,
    captionColor,
    captionSize,
    captionStroke,
    captionUppercase,
    captionPreset,
  } = useEditorStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastPlayClickTimeRef = useRef<number>(0);

  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Find which clip covers the current playhead position
  const activeClipIndex = videoClips.findIndex(
    (clip) =>
      currentTime >= clip.playStartTime &&
      currentTime <= clip.playStartTime + clip.duration
  );
  const activeClip = activeClipIndex !== -1 ? videoClips[activeClipIndex] : null;

  // Sync video source playback location with timeline currentTime
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (activeClip) {
      const clipProgress = currentTime - activeClip.playStartTime;
      const targetSourceTime = activeClip.startTime + clipProgress;

      // Only seek if video is out of sync (prevents thrashing/mute loops during active playback)
      const diff = Math.abs(video.currentTime - targetSourceTime);
      const threshold = isPlaying ? 1.0 : 0.15;
      if (diff > threshold) {
        video.currentTime = targetSourceTime;
      }
    } else {
      // If no clip covers this playhead, pause
      if (!video.paused) {
        video.pause();
      }
    }
  }, [currentTime, activeClipIndex, videoUrl, activeClip, isPlaying]);

  // Sync play/pause states
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || !activeClip) return;

    if (isPlaying) {
      if (video.paused) {
        // Skip redundant play() calls that bypass user gesture validation
        if (Date.now() - lastPlayClickTimeRef.current < 450) {
          return;
        }

        // Sync volume and muted state before playing to ensure up-to-date audio settings
        video.muted = isMuted;
        const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1.0;
        video.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume * clipVolume));

        video.play().catch((err) => {
          console.warn("Autoplay check or playback interrupted:", err);
          if (err.name === "NotAllowedError") setIsPlaying(false);
        });
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
  }, [isPlaying, videoUrl, activeClip, setIsPlaying, isMuted, volume]);

  // Sync speed changes
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Sync volume and mute states including segment-level volume multiplier
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1.0;
      video.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume * clipVolume));
      video.muted = isMuted; // Keep muted property perfectly synchronized
    }
  }, [volume, isMuted, activeClip, videoUrl]);

  // Synchronous Spacebar toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (videoUrl && videoRef.current) {
          const nextPlaying = !isPlaying;
          setIsPlaying(nextPlaying);
          const video = videoRef.current;
          if (nextPlaying) {
            lastPlayClickTimeRef.current = Date.now();
            video.muted = isMuted;
            const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1.0;
            video.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume * clipVolume));
            video.play().catch((err) => {
              console.warn("Spacebar play failed:", err);
              if (err.name === "NotAllowedError") setIsPlaying(false);
            });
            playActiveAudios(currentTime);
          } else {
            video.pause();
            pauseAllAudios();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, videoUrl, activeClip, isMuted, volume, setIsPlaying, audioClips, currentTime]);

  // Sync background audio elements and volume levels
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const calculateFadeVolume = (clip: AudioClip, playheadTime: number) => {
    const clipProgress = playheadTime - clip.playStartTime;
    if (clipProgress < 0 || clipProgress > clip.duration) return 0;

    let volumeMultiplier = 1;

    // Fade In
    if (clip.fadeIn > 0 && clipProgress < clip.fadeIn) {
      volumeMultiplier = clipProgress / clip.fadeIn;
    }
    // Fade Out
    else if (clip.fadeOut > 0 && clipProgress > clip.duration - clip.fadeOut) {
      const fadeOutProgress = clip.duration - clipProgress;
      volumeMultiplier = fadeOutProgress / clip.fadeOut;
    }

    return clip.volume * volumeMultiplier;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentElements = audioElementsRef.current;

    // Cleanup elements for deleted clips
    for (const [id, audio] of currentElements.entries()) {
      if (!audioClips.some((c) => c.id === id)) {
        audio.pause();
        currentElements.delete(id);
      }
    }

    // Add and update active audio elements
    audioClips.forEach((clip) => {
      let audio = currentElements.get(clip.id);
      if (!audio) {
        audio = new Audio(clip.audioUrl);
        audio.loop = false;
        currentElements.set(clip.id, audio);
      }

      // Update volume and mute configurations
      const fadeVol = calculateFadeVolume(clip, currentTime);
      const targetVolume = clip.isMuted || isMuted ? 0 : fadeVol * volume;
      audio.volume = Math.max(0, Math.min(1, targetVolume));
    });
  }, [audioClips, isMuted, volume, currentTime]);

  // Sync audio playback state and seek timeline pointers
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentElements = audioElementsRef.current;

    if (!isPlaying) {
      // Pause all elements if main video timeline is paused
      for (const audio of currentElements.values()) {
        if (!audio.paused) audio.pause();
      }
      return;
    }

    audioClips.forEach((clip) => {
      const audio = currentElements.get(clip.id);
      if (!audio) return;

      const isWithinBounds =
        currentTime >= clip.playStartTime &&
        currentTime <= clip.playStartTime + clip.duration;

      if (isWithinBounds) {
        const clipProgress = currentTime - clip.playStartTime;
        const targetAudioTime = clip.startTime + clipProgress;

        // Sync playback pointer if drift is substantial (e.g. > 1.0s during play, > 0.2s when paused/seeking)
        const drift = Math.abs(audio.currentTime - targetAudioTime);
        const threshold = isPlaying ? 1.0 : 0.2;
        if (drift > threshold) {
          audio.currentTime = targetAudioTime;
        }

        // Trigger playback if not already active
        if (audio.paused) {
          audio.play().catch((e) => {
            console.warn("AuraClip: Background music autoplay block:", e);
          });
        }
      } else {
        // Pause if timeline playhead goes out of bounds
        if (!audio.paused) {
          audio.pause();
        }
      }
    });
  }, [isPlaying, currentTime, audioClips]);

  // Clean up all audio elements on unmount
  useEffect(() => {
    const currentElements = audioElementsRef.current;
    return () => {
      for (const audio of currentElements.values()) {
        audio.pause();
      }
      currentElements.clear();
    };
  }, []);

  // Playback timer update callback
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !activeClip || !isPlaying) return;

    const currentClipProgress = video.currentTime - activeClip.startTime;
    
    // Check if we hit the end of the current clip
    if (video.currentTime >= activeClip.endTime || currentClipProgress >= activeClip.duration) {
      // Check if there is a next clip in the sequence
      const nextIndex = activeClipIndex + 1;
      if (nextIndex < videoClips.length) {
        const nextClip = videoClips[nextIndex];
        // Move playhead to the start of the next clip
        setCurrentTime(nextClip.playStartTime);
        video.currentTime = nextClip.startTime;
      } else {
        // End of timeline - pause and loop back to start
        setIsPlaying(false);
        setCurrentTime(0);
        video.currentTime = videoClips[0]?.startTime || 0;
      }
    } else {
      // Normal tick update
      const newTimelineTime = activeClip.playStartTime + currentClipProgress;
      setCurrentTime(newTimelineTime);
    }
  };

  function playActiveAudios(time: number = currentTime) {
    audioClips.forEach((clip) => {
      const audio = audioElementsRef.current.get(clip.id);
      if (!audio) return;

      const isWithinBounds =
        time >= clip.playStartTime &&
        time <= clip.playStartTime + clip.duration;

      if (isWithinBounds) {
        const clipProgress = time - clip.playStartTime;
        const targetAudioTime = clip.startTime + clipProgress;
        audio.currentTime = targetAudioTime;
        audio.play().catch((err) => {
          console.warn("AuraClip: Synchronous audio play failed:", err);
        });
      } else {
        // Play and immediately pause to satisfy browser user-gesture requirements for this element
        audio.play().then(() => {
          audio.pause();
        }).catch(() => {});
      }
    });
  }

  function pauseAllAudios() {
    for (const audio of audioElementsRef.current.values()) {
      if (!audio.paused) audio.pause();
    }
  }

  const togglePlay = () => {
    if (videoClips.length === 0) return;
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);

    const video = videoRef.current;
    if (video) {
      if (nextPlaying) {
        lastPlayClickTimeRef.current = Date.now();
        // Force unmuted synchronously inside user gesture context
        video.muted = isMuted;
        const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1.0;
        video.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume * clipVolume));
        
        video.play().catch((err) => {
          console.warn("AuraClip Editor: Playback failed:", err);
          if (err.name === "NotAllowedError") setIsPlaying(false);
        });
        playActiveAudios();
      } else {
        video.pause();
        pauseAllAudios();
      }
    }
  };

  // Seek timeline directly via click/drag on seek slider
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
  };

  // Step forward/backward 1 frame (approx 25 fps = 0.04s)
  const stepFrame = (forward: boolean) => {
    const step = 0.04;
    setCurrentTime(currentTime + (forward ? step : -step));
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    const video = videoRef.current;
    if (video) {
      video.muted = next;
      const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1.0;
      video.volume = next ? 0 : Math.max(0, Math.min(1, volume * clipVolume));
    }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.error);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  // Monitor browser-level escape out of fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const totalDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${min}:${sec < 10 ? "0" : ""}${sec}.${ms < 10 ? "0" : ""}${ms}`;
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-slate-950/60 border border-border/40 rounded-xl overflow-hidden shadow-2xl relative"
    >
      {/* Video Canvas Preview Window */}
      <div className="relative aspect-video w-full bg-black flex items-center justify-center group/player">
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              onTimeUpdate={handleTimeUpdate}
              onClick={togglePlay}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  videoRef.current.muted = isMuted;
                  const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1;
                  videoRef.current.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume * clipVolume));
                }
              }}
              onError={(e) => {
                console.error("AuraClip Editor: Video element error event fired:", e);
                setVideoError("unsupported");
              }}
              playsInline
              style={{
                transform: `scale(${activeClip?.scale || 100}%)`,
                transition: "transform 0.15s ease-out",
              }}
              className={`max-h-full max-w-full cursor-pointer ${
                activeClip?.fitMode === "contain"
                  ? "object-contain"
                  : "object-cover"
              }`}
            />
            {/* Elements Overlay Layer */}
            <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden select-none">
              <div className="relative w-full h-full">
                {elementOverlays
                  .filter((overlay) => currentTime >= overlay.playStartTime && currentTime <= overlay.playStartTime + overlay.duration)
                  .map((overlay) => (
                    <ElementOverlayComponent
                      key={overlay.id}
                      overlay={overlay}
                      isSelected={selectedElementId === overlay.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElementId(overlay.id);
                      }}
                      onUpdate={(updates) => updateElementOverlay(overlay.id, updates)}
                    />
                  ))
                }
              </div>
            </div>
            {videoError && (
              <div className="flex flex-col items-center justify-center p-6 text-center bg-slate-950 absolute inset-0 z-30">
                <AlertCircle className="h-10 w-10 text-rose-500 mb-3 animate-pulse" />
                <p className="text-xs font-bold text-white mb-2">Video playback failed</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed max-w-[280px]">
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
            
            {/* ─── Premium Caption Overlay ─────────────────────────────── */}
            {activeClip?.transcript && (
              (() => {
                const words = activeClip.transcript.split(/\s+/).filter(Boolean);
                const progress =
                  activeClip.duration > 0
                    ? Math.max(0, Math.min(1, (currentTime - activeClip.playStartTime) / activeClip.duration))
                    : 0;
                const currentWordIndex = Math.floor(progress * words.length);

                // Font mapping
                const fontMap: Record<string, string> = {
                  Impact: "Impact, Charcoal, sans-serif",
                  Montserrat: "'Montserrat', 'Segoe UI', sans-serif",
                  Inter: "'Inter', 'Segoe UI', sans-serif",
                  Arial: "Arial, Helvetica, sans-serif",
                };
                const fontFamily = fontMap[captionFont] || fontMap.Inter;

                // Font size
                const sizeMap: Record<string, string> = {
                  sm: "0.85rem",
                  md: "1.05rem",
                  lg: "1.3rem",
                  xl: "1.65rem",
                };
                const fontSize = sizeMap[captionSize] || sizeMap.md;

                // Stroke / shadow for legibility
                const heavyShadow = "2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 0 #000, 2px 0 0 #000, 0 -2px 0 #000, -2px 0 0 #000, 0 4px 12px rgba(0,0,0,0.9)";
                const softShadow = "0 2px 8px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,1)";
                const textShadow = captionStroke ? heavyShadow : softShadow;

                // Preset determines render mode
                // tiktok → one highlighted word at a time (large, pop)
                // minimalist → sentence block, no bg
                // classic → rolling 5-word window with highlight
                // karaoke → words fill color left-to-right

                if (captionPreset === "tiktok") {
                  // ── Mode: TikTok — one BIG word at a time ───────────────
                  const word = words[Math.min(currentWordIndex, words.length - 1)] || "";
                  return (
                    <div className="absolute bottom-12 left-0 right-0 flex justify-center z-20 pointer-events-none select-none px-6">
                      <div
                        style={{
                          fontFamily,
                          fontSize: sizeMap[captionSize === "sm" ? "md" : captionSize === "md" ? "lg" : captionSize === "lg" ? "xl" : "xl"] || "1.65rem",
                          color: captionColor,
                          textShadow: heavyShadow,
                          textTransform: captionUppercase ? "uppercase" : "none",
                          fontWeight: 900,
                          letterSpacing: "0.03em",
                          lineHeight: 1.1,
                          animation: "word-pop 0.12s ease-out",
                        }}
                        key={currentWordIndex}
                      >
                        {word}
                      </div>
                    </div>
                  );
                }

                if (captionPreset === "minimalist") {
                  // ── Mode: Minimalist — full sentence, clean, no background ─
                  const windowSize = 7;
                  const start = Math.max(0, Math.min(currentWordIndex - 3, words.length - windowSize));
                  const end = Math.min(start + windowSize, words.length);
                  const visibleWords = words.slice(start, end);

                  return (
                    <div className="absolute bottom-10 left-0 right-0 flex justify-center z-20 pointer-events-none select-none px-8">
                      <p
                        style={{
                          fontFamily,
                          fontSize,
                          textShadow: softShadow,
                          textTransform: captionUppercase ? "uppercase" : "none",
                          fontWeight: 700,
                          lineHeight: 1.4,
                          textAlign: "center",
                          letterSpacing: "0.01em",
                        }}
                        className="text-white"
                      >
                        {visibleWords.map((w, i) => {
                          const absIdx = start + i;
                          return (
                            <span
                              key={`${absIdx}-${w}`}
                              style={{
                                color: absIdx === currentWordIndex ? captionColor : "rgba(255,255,255,0.92)",
                                transition: "color 0.15s ease",
                              }}
                            >
                              {w}{" "}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                  );
                }

                if (captionPreset === "karaoke") {
                  // ── Mode: Karaoke — entire sentence, words fill with color ─
                  const LINE_SIZE = 8;
                  const lineStart = Math.floor(currentWordIndex / LINE_SIZE) * LINE_SIZE;
                  const lineWords = words.slice(lineStart, lineStart + LINE_SIZE);

                  return (
                    <div className="absolute bottom-10 left-0 right-0 flex justify-center z-20 pointer-events-none select-none px-6">
                      <div
                        style={{
                          background: "rgba(0,0,0,0.72)",
                          backdropFilter: "blur(8px)",
                          borderRadius: "12px",
                          padding: "10px 18px",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        <p
                          style={{
                            fontFamily,
                            fontSize,
                            fontWeight: 800,
                            textTransform: captionUppercase ? "uppercase" : "none",
                            letterSpacing: "0.02em",
                            lineHeight: 1.35,
                            textAlign: "center",
                            margin: 0,
                          }}
                        >
                          {lineWords.map((w, i) => {
                            const absIdx = lineStart + i;
                            const isPast = absIdx < currentWordIndex;
                            const isCurrent = absIdx === currentWordIndex;
                            return (
                              <span
                                key={`${absIdx}-${w}`}
                                style={{
                                  color: isPast || isCurrent ? captionColor : "rgba(255,255,255,0.5)",
                                  textShadow: isCurrent ? heavyShadow : softShadow,
                                  fontWeight: isCurrent ? 900 : 700,
                                  transform: isCurrent ? "scale(1.08)" : "scale(1)",
                                  display: "inline-block",
                                  transition: "all 0.15s ease",
                                  marginRight: "0.35em",
                                }}
                              >
                                {w}
                              </span>
                            );
                          })}
                        </p>
                      </div>
                    </div>
                  );
                }

                // ── Mode: Classic (default) — rolling pill-word window ───────
                const windowSize = 5;
                const start = Math.max(0, Math.min(currentWordIndex - 2, words.length - windowSize));
                const end = Math.min(start + windowSize, words.length);
                const visibleWords = words.slice(start, end);

                return (
                  <div className="absolute bottom-10 left-0 right-0 flex justify-center z-20 pointer-events-none select-none px-6">
                    <div className="flex flex-wrap justify-center items-center gap-x-1 gap-y-1.5">
                      {visibleWords.map((word, i) => {
                        const absIdx = start + i;
                        const isActive = absIdx === currentWordIndex;
                        return (
                          <span
                            key={`${absIdx}-${word}`}
                            style={{
                              fontFamily,
                              fontSize,
                              fontWeight: isActive ? 900 : 700,
                              textTransform: captionUppercase ? "uppercase" : "none",
                              color: isActive ? captionColor : "#FFFFFF",
                              textShadow: isActive ? heavyShadow : softShadow,
                              background: isActive ? `${captionColor}22` : "transparent",
                              border: isActive ? `1.5px solid ${captionColor}55` : "1.5px solid transparent",
                              borderRadius: "6px",
                              padding: "1px 6px",
                              transform: isActive ? "scale(1.12)" : "scale(1)",
                              display: "inline-block",
                              transition: "all 0.15s ease",
                              lineHeight: 1.3,
                            }}
                          >
                            {word}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            )}
            {/* ─────────────────────────────────────────────────────────── */}
          </>
        ) : (
          <div className="text-center text-muted-foreground p-8 flex flex-col items-center">
            <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <RotateCcw className="h-5 w-5 text-slate-500 animate-spin" />
            </div>
            <p className="text-xs font-semibold text-slate-400">Import a video to activate preview</p>
          </div>
        )}

        {/* Hover quick overlay bar */}
        {videoUrl && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 opacity-0 group-hover/player:opacity-100 transition-opacity duration-300 pointer-events-auto flex justify-between items-center text-xs">
            <span className="text-white font-mono select-none">
              Active Segment: {activeClip ? activeClip.title : "None"}
            </span>
            <span className="text-[10px] text-violet-400 bg-violet-950/60 px-2 py-0.5 rounded border border-violet-900/30 font-bold select-none">
              Source seek: {activeClip ? (activeClip.startTime + (currentTime - activeClip.playStartTime)).toFixed(2) : "0.00"}s
            </span>
          </div>
        )}
      </div>

      {/* Control console */}
      <div className="bg-black/90 p-4 border-t border-border/40 space-y-4">
        
        {/* Timeline Scrub Track */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-muted-foreground select-none">
            {formatTime(currentTime)}
          </span>
          
          <input
            type="range"
            min="0"
            max={totalDuration || 100}
            step="0.01"
            value={currentTime}
            onChange={handleSeek}
            disabled={videoClips.length === 0}
            className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-violet-600 outline-none focus:accent-violet-500 disabled:opacity-50"
          />

          <span className="text-[10px] font-mono text-slate-300 select-none">
            {formatTime(totalDuration)}
          </span>
        </div>

        {/* Playback Controls Row */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
          
          {/* Play, Pause, Frame adjustments */}
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => stepFrame(false)}
              disabled={videoClips.length === 0}
              className="h-8 w-8 rounded-lg hover:bg-white/5 hover:text-white"
              title="Previous frame (Left Arrow)"
            >
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button
              onClick={togglePlay}
              disabled={videoClips.length === 0}
              className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 shadow-md ${
                isPlaying ? "bg-amber-600 hover:bg-amber-500" : "bg-violet-600 hover:bg-violet-500"
              } text-white`}
              title="Play / Pause (Space)"
            >
              {isPlaying ? <Pause className="h-4.5 w-4.5 fill-current" /> : <Play className="h-4.5 w-4.5 fill-current ml-0.5" />}
            </Button>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => stepFrame(true)}
              disabled={videoClips.length === 0}
              className="h-8 w-8 rounded-lg hover:bg-white/5 hover:text-white"
              title="Next frame (Right Arrow)"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Volume, Speed, Fullscreen widgets */}
          <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
            {/* Speed Adjustment */}
            <div className="flex items-center gap-1.5 border border-border/30 rounded-lg px-2 py-1 bg-white/5">
              <span className="text-[10px] text-muted-foreground select-none">Speed:</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                className="bg-transparent text-xs text-slate-300 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="0.25" className="bg-slate-900 text-white">0.25x</option>
                <option value="0.5" className="bg-slate-900 text-white">0.5x</option>
                <option value="1" className="bg-slate-900 text-white">1x</option>
                <option value="1.5" className="bg-slate-900 text-white">1.5x</option>
                <option value="2" className="bg-slate-900 text-white">2x</option>
              </select>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleMute}
                className="h-8 w-8 rounded-lg hover:bg-white/5 hover:text-white"
              >
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  setIsMuted(false);
                }}
                className="w-16 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-slate-300"
              />
            </div>

            {/* Fullscreen */}
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleFullscreen}
              className={`h-8 w-8 rounded-lg hover:bg-white/5 hover:text-white ${
                isFullscreen ? "text-violet-400" : ""
              }`}
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>

        </div>

      </div>
    </div>
  );
}

interface ElementOverlayComponentProps {
  overlay: ElementOverlay;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onUpdate: (updates: Partial<ElementOverlay>) => void;
}

function ElementOverlayComponent({
  overlay,
  isSelected,
  onClick,
  onUpdate,
}: ElementOverlayComponentProps) {
  const elementRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick(e);

    // Only start drag if clicking on the element itself and not on a resize handle
    const target = e.target as HTMLElement;
    if (target.closest(".resize-handle")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = overlay.x;
    const initialY = overlay.y;

    const parent = elementRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const parentWidth = rect.width;
    const parentHeight = rect.height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const pctDeltaX = (deltaX / parentWidth) * 100;
      const pctDeltaY = (deltaY / parentHeight) * 100;

      const newX = Math.max(0, Math.min(100 - overlay.width, initialX + pctDeltaX));
      const newY = Math.max(0, Math.min(100 - overlay.height, initialY + pctDeltaY));

      onUpdate({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent, corner: "top-left" | "top-right" | "bottom-left" | "bottom-right") => {
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    
    const initialX = overlay.x;
    const initialY = overlay.y;
    const initialWidth = overlay.width;
    const initialHeight = overlay.height;

    const parent = elementRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const parentWidth = rect.width;
    const parentHeight = rect.height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const pctDeltaX = (deltaX / parentWidth) * 100;
      const pctDeltaY = (deltaY / parentHeight) * 100;

      let newX = overlay.x;
      let newY = overlay.y;
      let newWidth = overlay.width;
      let newHeight = overlay.height;

      if (corner === "bottom-right") {
        newWidth = Math.max(5, Math.min(100 - initialX, initialWidth + pctDeltaX));
        newHeight = Math.max(5, Math.min(100 - initialY, initialHeight + pctDeltaY));
      } else if (corner === "bottom-left") {
        const potentialX = initialX + pctDeltaX;
        newX = Math.max(0, Math.min(initialX + initialWidth - 5, potentialX));
        newWidth = initialWidth - (newX - initialX);
        newHeight = Math.max(5, Math.min(100 - initialY, initialHeight + pctDeltaY));
      } else if (corner === "top-right") {
        const potentialY = initialY + pctDeltaY;
        newY = Math.max(0, Math.min(initialY + initialHeight - 5, potentialY));
        newHeight = initialHeight - (newY - initialY);
        newWidth = Math.max(5, Math.min(100 - initialX, initialWidth + pctDeltaX));
      } else if (corner === "top-left") {
        const potentialX = initialX + pctDeltaX;
        newX = Math.max(0, Math.min(initialX + initialWidth - 5, potentialX));
        newWidth = initialWidth - (newX - initialX);

        const potentialY = initialY + pctDeltaY;
        newY = Math.max(0, Math.min(initialY + initialHeight - 5, potentialY));
        newHeight = initialHeight - (newY - initialY);
      }

      onUpdate({ x: newX, y: newY, width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const renderContent = () => {
    if (overlay.type === "text") {
      const textStyle: React.CSSProperties = {
        fontFamily: overlay.fontFamily === "Impact" ? "Impact, Charcoal, sans-serif" :
                    overlay.fontFamily === "Montserrat" ? "'Montserrat', sans-serif" :
                    overlay.fontFamily === "Inter" ? "'Inter', sans-serif" : "Arial, sans-serif",
        color: overlay.color || "#FFFFFF",
        fontSize: `${overlay.fontSize || 16}px`,
        fontWeight: "bold",
        textAlign: "center",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        wordBreak: "break-word",
        backgroundColor: overlay.backgroundColor || "transparent",
        opacity: overlay.opacity,
      };

      if (overlay.color === "#FF00FF") {
        textStyle.textShadow = "0 0 5px #fff, 0 0 10px #FF00FF, 0 0 20px #FF00FF, 0 0 40px #FF00FF";
      } else if (overlay.color === "#FFCC00") {
        textStyle.textShadow = "2px 2px 0px #990000";
      }

      return (
        <div style={textStyle}>
          {overlay.text || "Double click to type"}
        </div>
      );
    }

    if (overlay.type === "shape") {
      const fill = overlay.color || "#8B5CF6";
      const opacity = overlay.opacity;

      if (overlay.shapeType === "circle") {
        return (
          <div
            style={{
              backgroundColor: fill,
              opacity: opacity,
              borderRadius: "50%",
              width: "100%",
              height: "100%",
            }}
          />
        );
      }

      if (overlay.shapeType === "arrow") {
        return (
          <svg
            viewBox="0 0 100 100"
            style={{
              fill: fill,
              opacity: opacity,
              width: "100%",
              height: "100%",
            }}
            preserveAspectRatio="none"
          >
            <path d="M10,40 L60,40 L60,20 L90,50 L60,80 L60,60 L10,60 Z" />
          </svg>
        );
      }

      if (overlay.shapeType === "star") {
        return (
          <svg
            viewBox="0 0 100 100"
            style={{
              fill: fill,
              opacity: opacity,
              width: "100%",
              height: "100%",
            }}
            preserveAspectRatio="none"
          >
            <path d="M50,5 L63,38 L98,38 L70,58 L81,91 L50,70 L19,91 L30,58 L2,38 L37,38 Z" />
          </svg>
        );
      }

      return (
        <div
          style={{
            backgroundColor: fill,
            opacity: opacity,
            width: "100%",
            height: "100%",
            borderRadius: "4px",
          }}
        />
      );
    }

    if (overlay.type === "image") {
      return (
        <img
          src={overlay.imageUrl}
          alt="Overlay Asset"
          style={{
            opacity: overlay.opacity,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
          draggable={false}
        />
      );
    }

    return null;
  };

  return (
    <div
      ref={elementRef}
      onMouseDown={handleMouseDown}
      style={{
        position: "absolute",
        left: `${overlay.x}%`,
        top: `${overlay.y}%`,
        width: `${overlay.width}%`,
        height: `${overlay.height}%`,
        zIndex: overlay.zIndex,
      }}
      className={`pointer-events-auto cursor-move select-none flex items-center justify-center ${
        isSelected ? "border-2 border-dashed border-violet-500" : "hover:border border-white/30"
      }`}
    >
      {renderContent()}

      {isSelected && (
        <>
          <div
            onMouseDown={(e) => handleResizeMouseDown(e, "top-left")}
            className="resize-handle absolute -top-1.5 -left-1.5 h-3 w-3 bg-white border border-violet-500 rounded-full cursor-nwse-resize z-50 shadow-md"
          />
          <div
            onMouseDown={(e) => handleResizeMouseDown(e, "top-right")}
            className="resize-handle absolute -top-1.5 -right-1.5 h-3 w-3 bg-white border border-violet-500 rounded-full cursor-nesw-resize z-50 shadow-md"
          />
          <div
            onMouseDown={(e) => handleResizeMouseDown(e, "bottom-left")}
            className="resize-handle absolute -bottom-1.5 -left-1.5 h-3 w-3 bg-white border border-violet-500 rounded-full cursor-nesw-resize z-50 shadow-md"
          />
          <div
            onMouseDown={(e) => handleResizeMouseDown(e, "bottom-right")}
            className="resize-handle absolute -bottom-1.5 -right-1.5 h-3 w-3 bg-white border border-violet-500 rounded-full cursor-nwse-resize z-50 shadow-md"
          />
        </>
      )}
    </div>
  );
}
