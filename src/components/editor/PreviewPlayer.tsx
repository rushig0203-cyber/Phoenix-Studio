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
import { useEditorStore, AudioClip } from "@/store/editorStore";
import { Button } from "@/components/ui/button";

export default function PreviewPlayer() {
  const {
    videoUrl,
    videoClips,
    audioClips,
    currentTime,
    isPlaying,
    setCurrentTime,
    setIsPlaying,
    captionFont,
    captionColor,
    captionSize,
    captionStroke,
    captionUppercase,
  } = useEditorStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [volume, setVolume] = useState(0.8);
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
        video.play().catch((err) => {
          console.warn("Autoplay block or playback interrupted:", err);
          setIsPlaying(false);
        });
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
  }, [isPlaying, videoUrl, activeClip, setIsPlaying]);

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
    }
  }, [volume, isMuted, activeClip]);

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
            video.muted = isMuted;
            const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1.0;
            video.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume * clipVolume));
            video.play().catch((err) => {
              console.warn("Spacebar play failed, trying muted:", err);
              video.muted = true;
              video.play().catch(console.error);
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

        // Sync playback pointer if drift exceeds 0.2s
        if (Math.abs(audio.currentTime - targetAudioTime) > 0.2) {
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
        // Force unmuted synchronously inside user gesture context
        video.muted = isMuted;
        const clipVolume = activeClip && typeof activeClip.volume === "number" ? activeClip.volume : 1.0;
        video.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume * clipVolume));
        
        video.play().catch((err) => {
          console.warn("AuraClip Editor: Playback blocked, fallback to muted:", err);
          video.muted = true;
          video.play().catch(console.error);
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
                // Explicitly unmute — browsers default to muted for programmatic play
                if (videoRef.current) {
                  videoRef.current.muted = isMuted;
                  videoRef.current.volume = isMuted ? 0 : volume;
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
            
            {/* Live styled captions overlay */}
            {isPlaying && activeClip?.transcript && (
              <div className="absolute bottom-10 left-4 right-4 text-center z-20 pointer-events-none select-none">
                <div className="bg-black/75 backdrop-blur-sm rounded-xl px-3.5 py-1.5 border border-white/10 shadow-xl inline-block max-w-full">
                  <div
                    style={{
                      fontFamily:
                        captionFont === "Impact"
                          ? "Impact, Charcoal, sans-serif"
                          : captionFont === "Montserrat"
                          ? "'Montserrat', sans-serif"
                          : captionFont === "Inter"
                          ? "'Inter', sans-serif"
                          : "Arial, sans-serif",
                      fontSize:
                        captionSize === "sm"
                          ? "0.75rem"
                          : captionSize === "md"
                          ? "0.9rem"
                          : captionSize === "lg"
                          ? "1.1rem"
                          : "1.35rem",
                      textShadow: captionStroke
                        ? "1.5px 1.5px 0 #000, -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 0 1.5px 0 #000, 1.5px 0 0 #000, 0 -1.5px 0 #000, -1.5px 0 0 #000"
                        : "none",
                    }}
                    className={`flex flex-wrap justify-center items-center gap-x-1 gap-y-0.5 font-extrabold tracking-wide leading-snug ${
                      captionUppercase ? "uppercase" : ""
                    }`}
                  >
                    ⚡{" "}
                    {(() => {
                      const words = activeClip.transcript.split(/\s+/);
                      const progress =
                        activeClip.duration > 0
                          ? Math.max(
                              0,
                              Math.min(
                                1,
                                (currentTime - activeClip.playStartTime) /
                                  activeClip.duration
                              )
                            )
                          : 0;
                      const currentWordIndex = Math.floor(progress * words.length);

                      const windowSize = 5;
                      const start = Math.max(
                        0,
                        Math.min(currentWordIndex - 2, words.length - windowSize)
                      );
                      const end = Math.min(start + windowSize, words.length);

                      return words.slice(start, end).map((word, idx) => {
                        const absoluteIdx = start + idx;
                        const isHighlighted = absoluteIdx === currentWordIndex;
                        return (
                          <span
                            key={idx}
                            style={{ color: isHighlighted ? captionColor : "#FFFFFF" }}
                            className={`transition-all duration-200 px-1 rounded ${
                              isHighlighted
                                ? "scale-110 bg-white/10"
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
