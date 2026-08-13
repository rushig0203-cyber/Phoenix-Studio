"use strict";
"use client";

import React, { useRef, useEffect, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Scissors,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Music,
  Video as VideoIcon,
  Layers,
} from "lucide-react";
import { useEditorStore, VideoClip, AudioClip, ElementOverlay } from "@/store/editorStore";
import { Button } from "@/components/ui/button";

export default function Timeline() {
  const {
    videoClips,
    audioClips,
    currentTime,
    zoom,
    selectedClipId,
    selectedTrackType,
    setCurrentTime,
    setZoom,
    splitVideoClip,
    deleteVideoClip,
    reorderVideoClips,
    updateVideoClip,
    updateAudioClip,
    deleteAudioClip,
    setSelectedClip,
    thumbnails,
    elementOverlays,
    selectedElementId,
    setSelectedElementId,
    updateElementOverlay,
    deleteElementOverlay,
  } = useEditorStore();

  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);

  // Compute total timeline duration
  const totalVideoDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);
  const maxTimelineDuration = Math.max(totalVideoDuration + 10, 60); // Padding of 10s or min 60s

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  };

  // 1. Playhead scrubbing mouse events
  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    setIsScrubbing(true);
    const rect = rulerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollContainerRef.current?.scrollLeft || 0);
    const time = x / zoom;
    setCurrentTime(time);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isScrubbing && rulerRef.current) {
        const rect = rulerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + (scrollContainerRef.current?.scrollLeft || 0);
        const time = x / zoom;
        setCurrentTime(time);
      }
    };

    const handleMouseUp = () => {
      if (isScrubbing) {
        setIsScrubbing(false);
      }
    };

    if (isScrubbing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isScrubbing, zoom, setCurrentTime]);

  // 2. Video Clip Trim Handle dragging mouse events
  const handleTrimStart = (
    e: React.MouseEvent,
    clip: VideoClip,
    type: "left" | "right"
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startStartTime = clip.startTime;
    const startEndTime = clip.endTime;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSec = deltaX / zoom;

      if (type === "left") {
        // Trimming the start (left handle): increase startTime, decreases duration
        // Clamp startTime so it doesn't cross endTime (min 0.5s duration)
        const maxStartTime = startEndTime - 0.5;
        const newStartTime = Math.max(0, Math.min(startStartTime + deltaSec, maxStartTime));
        updateVideoClip(clip.id, { startTime: newStartTime });
      } else {
        // Trimming the end (right handle): decrease endTime
        // Clamp endTime so it doesn't cross startTime (min 0.5s duration)
        const minEndTime = startStartTime + 0.5;
        const newEndTime = Math.max(minEndTime, startEndTime + deltaSec);
        updateVideoClip(clip.id, { endTime: newEndTime });
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 3. Audio Clip placement drag mouse events
  const handleAudioDragStart = (e: React.MouseEvent, clip: AudioClip) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startPlayStartTime = clip.playStartTime;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSec = deltaX / zoom;
      const newPlayStartTime = Math.max(0, startPlayStartTime + deltaSec);
      updateAudioClip(clip.id, { playStartTime: newPlayStartTime });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };
  
  // Element Clip placement drag mouse events
  const handleElementDragStart = (e: React.MouseEvent, overlay: ElementOverlay) => {
    const target = e.target as HTMLElement;
    if (target.closest(".cursor-ew-resize")) return;

    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startPlayStartTime = overlay.playStartTime;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSec = deltaX / zoom;
      const newPlayStartTime = Math.max(0, startPlayStartTime + deltaSec);
      updateElementOverlay(overlay.id, { playStartTime: newPlayStartTime });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Element Clip Trim Handle dragging mouse events
  const handleElementTrimStart = (
    e: React.MouseEvent,
    overlay: ElementOverlay,
    type: "left" | "right"
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startPlayStartTime = overlay.playStartTime;
    const startDuration = overlay.duration;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSec = deltaX / zoom;

      if (type === "left") {
        const maxPlayStartTime = startPlayStartTime + startDuration - 0.2;
        const newPlayStartTime = Math.max(0, Math.min(startPlayStartTime + deltaSec, maxPlayStartTime));
        const newDuration = startDuration - (newPlayStartTime - startPlayStartTime);
        updateElementOverlay(overlay.id, { playStartTime: newPlayStartTime, duration: Math.max(0.2, newDuration) });
      } else {
        const newDuration = Math.max(0.2, startDuration + deltaSec);
        updateElementOverlay(overlay.id, { duration: newDuration });
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 4. Video Clips Reordering (Reorder in gapless list index)
  const moveVideoClip = (index: number, direction: "left" | "right") => {
    const nextIndex = direction === "left" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= videoClips.length) return;

    const reordered = [...videoClips];
    const temp = reordered[index];
    reordered[index] = reordered[nextIndex];
    reordered[nextIndex] = temp;
    reorderVideoClips(reordered);
  };

  // Timeline split action
  const handleSplit = () => {
    if (selectedTrackType === "video" && selectedClipId) {
      splitVideoClip(selectedClipId, currentTime);
    }
  };

  // Timeline delete action
  const handleDelete = () => {
    if (selectedClipId) {
      if (selectedTrackType === "video") {
        deleteVideoClip(selectedClipId);
      } else if (selectedTrackType === "audio") {
        deleteAudioClip(selectedClipId);
      } else if (selectedTrackType === "element") {
        deleteElementOverlay(selectedClipId);
      }
    }
  };


  return (
    <div className="bg-slate-950/60 border border-border/40 rounded-xl p-4 flex flex-col gap-4 shadow-2xl">
      {/* Timeline Quick Actions Menu */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSplit}
            disabled={!selectedClipId || selectedTrackType !== "video"}
            className="h-8 rounded-lg bg-white/5 border border-border/30 hover:bg-violet-600 hover:text-white text-xs font-semibold gap-1.5"
            title="Split selected video clip at playhead (S)"
          >
            <Scissors className="h-3.5 w-3.5" />
            Split Clip
          </Button>

          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            disabled={!selectedClipId}
            className="h-8 rounded-lg text-xs font-semibold gap-1.5"
            title="Delete selected clip (Backspace)"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>

        {/* Zoom Slider */}
        <div className="flex items-center gap-3">
          <ZoomOut className="h-4 w-4 text-muted-foreground" />
          <input
            type="range"
            min="2"
            max="60"
            step="1"
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value))}
            className="w-32 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-violet-600 outline-none"
            title="Timeline zoom scale"
          />
          <ZoomIn className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground font-mono bg-white/5 px-2 py-0.5 rounded border border-border/10">
            {zoom} px/s
          </span>
        </div>
      </div>

      {/* Main Track Viewports */}
      <div
        ref={scrollContainerRef}
        className="w-full overflow-x-auto overflow-y-hidden border border-border/30 rounded-lg relative bg-black/40 min-h-[220px]"
      >
        {/* Timeline Tracks Box wrapper */}
        <div
          style={{ width: `${maxTimelineDuration * zoom}px` }}
          className="relative min-h-full pb-4"
        >
          {/* Vertical Playhead Cursor line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none"
            style={{ left: `${currentTime * zoom}px` }}
          >
            <div className="absolute top-0 -left-1.5 h-3 w-3.5 bg-rose-500 rounded-b-md shadow-md border-x border-b border-black" />
          </div>

          {/* Time Ruler panel */}
          <div
            ref={rulerRef}
            onMouseDown={handleRulerMouseDown}
            className="h-8 border-b border-border/30 bg-slate-900/60 relative cursor-col-resize select-none"
          >
            {/* Ticks rendering */}
            {Array.from({ length: Math.ceil(maxTimelineDuration / 5) }).map((_, idx) => {
              const tickTime = idx * 5;
              return (
                <div
                  key={idx}
                  className="absolute bottom-0 flex flex-col items-center"
                  style={{ left: `${tickTime * zoom}px` }}
                >
                  <span className="text-[9px] font-mono text-muted-foreground pb-1 transform -translate-x-1/2">
                    {formatTime(tickTime)}
                  </span>
                  <div className="h-2 w-px bg-muted-foreground/30" />
                </div>
              );
            })}
          </div>

          {/* Video track */}
          <div className="flex items-center gap-0.5 border-b border-border/20 py-4 px-2 min-h-[72px] relative bg-white/[0.01]">
            <div className="absolute left-3 top-2 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-violet-400 select-none z-10 bg-slate-950/40 rounded px-1.5 py-0.5">
              <VideoIcon className="h-3 w-3" />
              <span>Video track</span>
            </div>

            {/* Thumbnails track background */}
            {thumbnails && thumbnails.length > 0 && (
              <div className="absolute inset-x-0 bottom-4 top-7 flex overflow-hidden opacity-15 pointer-events-none select-none px-2 z-0">
                {thumbnails.map((thumb, idx) => (
                  <div
                    key={idx}
                    className="h-full flex-grow bg-cover bg-center border-r border-black/10"
                    style={{ backgroundImage: `url(${thumb})` }}
                  />
                ))}
              </div>
            )}

            {/* Gapless sequential clips */}
            <div className="flex items-center h-12 mt-3 select-none z-10">
              {videoClips.map((clip, idx) => {
                const isSelected = selectedClipId === clip.id && selectedTrackType === "video";
                const width = clip.duration * zoom;

                return (
                  <div
                    key={clip.id}
                    onClick={() => setSelectedClip(clip.id, "video")}
                    style={{ width: `${width}px` }}
                    className={`relative h-full rounded-lg border group flex flex-col justify-between p-2 cursor-pointer transition-all ${
                      isSelected
                        ? "border-violet-500 bg-violet-600/10 shadow-inner z-20"
                        : "border-border/40 bg-card hover:border-violet-500/50 hover:bg-card/80"
                    }`}
                  >
                    {/* Clip Title & Index buttons */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-white truncate max-w-[80%]">
                        {clip.title}
                      </span>
                      {isSelected && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); moveVideoClip(idx, "left"); }}
                            disabled={idx === 0}
                            className="p-0.5 rounded hover:bg-white/10 text-slate-300 disabled:opacity-30"
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveVideoClip(idx, "right"); }}
                            disabled={idx === videoClips.length - 1}
                            className="p-0.5 rounded hover:bg-white/10 text-slate-300 disabled:opacity-30"
                          >
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Clip Duration badge */}
                    <span className="text-[8px] font-mono text-muted-foreground mt-auto">
                      {clip.duration.toFixed(1)}s
                    </span>

                    {/* Trim Handles */}
                    {isSelected && (
                      <>
                        {/* Left Trim Handle */}
                        <div
                          onMouseDown={(e) => handleTrimStart(e, clip, "left")}
                          className="absolute left-0 top-0 bottom-0 w-2.5 bg-violet-500 cursor-ew-resize rounded-l-lg flex items-center justify-center border-r border-black/30"
                          title="Trim clip start"
                        >
                          <div className="w-0.5 h-3 bg-white/60" />
                        </div>
                        {/* Right Trim Handle */}
                        <div
                          onMouseDown={(e) => handleTrimStart(e, clip, "right")}
                          className="absolute right-0 top-0 bottom-0 w-2.5 bg-violet-500 cursor-ew-resize rounded-r-lg flex items-center justify-center border-l border-black/30"
                          title="Trim clip end"
                        >
                          <div className="w-0.5 h-3 bg-white/60" />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Audio track */}
          <div className="flex flex-col gap-2 border-b border-border/20 py-4 px-2 min-h-[72px] relative bg-white/[0.01]">
            <div className="absolute left-3 top-2 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 select-none z-10 bg-slate-950/40 rounded px-1.5 py-0.5">
              <Music className="h-3 w-3" />
              <span>Audio track</span>
            </div>

            {/* Freeform placed audio clips */}
            <div className="h-12 w-full mt-3 relative select-none">
              {audioClips.map((clip) => {
                const isSelected = selectedClipId === clip.id && selectedTrackType === "audio";
                const leftOffset = clip.playStartTime * zoom;
                const width = clip.duration * zoom;

                return (
                  <div
                    key={clip.id}
                    onClick={() => setSelectedClip(clip.id, "audio")}
                    onMouseDown={(e) => handleAudioDragStart(e, clip)}
                    style={{
                      left: `${leftOffset}px`,
                      width: `${width}px`,
                    }}
                    className={`absolute h-full rounded-lg border flex flex-col justify-between p-2 cursor-grab active:cursor-grabbing transition-all ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-600/10 shadow-inner z-20"
                        : "border-border/40 bg-slate-900/60 hover:border-emerald-500/30 hover:bg-slate-900/80"
                    }`}
                  >
                    <span className="text-[10px] font-semibold text-emerald-300 truncate max-w-[90%]">
                      {clip.title}
                    </span>
                    <div className="flex justify-between items-center text-[8px] font-mono text-muted-foreground mt-auto">
                      <span>{clip.duration.toFixed(1)}s</span>
                      {clip.fadeIn > 0 && <span>In: {clip.fadeIn}s</span>}
                      {clip.fadeOut > 0 && <span>Out: {clip.fadeOut}s</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Element Overlays / Stickers track */}
          <div className="flex flex-col gap-2 py-4 px-2 min-h-[72px] relative bg-white/[0.01]">
            <div className="absolute left-3 top-2 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-fuchsia-400 select-none z-10 bg-slate-950/40 rounded px-1.5 py-0.5">
              <Layers className="h-3 w-3" />
              <span>Overlays & Stickers</span>
            </div>

            {/* Freeform placed elements */}
            <div className="h-12 w-full mt-3 relative select-none">
              {elementOverlays.map((overlay) => {
                const isSelected = selectedElementId === overlay.id;
                const leftOffset = overlay.playStartTime * zoom;
                const width = overlay.duration * zoom;

                return (
                  <div
                    key={overlay.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedElementId(overlay.id);
                    }}
                    onMouseDown={(e) => handleElementDragStart(e, overlay)}
                    style={{
                      left: `${leftOffset}px`,
                      width: `${width}px`,
                    }}
                    className={`absolute h-full rounded-lg border flex flex-col justify-between p-2 cursor-grab active:cursor-grabbing transition-all ${
                      isSelected
                        ? "border-fuchsia-500 bg-fuchsia-600/10 shadow-inner z-20"
                        : "border-border/40 bg-slate-900/60 hover:border-fuchsia-500/30 hover:bg-slate-900/80"
                    }`}
                  >
                    <span className="text-[10px] font-semibold text-fuchsia-300 truncate max-w-[90%]">
                      {overlay.type === "text"
                        ? `Text: ${overlay.text || "Heading"}`
                        : overlay.type === "shape"
                        ? `Shape: ${overlay.shapeType}`
                        : "Image Overlay"}
                    </span>
                    <div className="flex justify-between items-center text-[8px] font-mono text-muted-foreground mt-auto">
                      <span>{overlay.duration.toFixed(1)}s</span>
                    </div>

                    {/* Trim Handles for Element Blocks */}
                    {isSelected && (
                      <>
                        <div
                          onMouseDown={(e) => handleElementTrimStart(e, overlay, "left")}
                          className="absolute left-0 top-0 bottom-0 w-2.5 bg-fuchsia-500 cursor-ew-resize rounded-l-lg flex items-center justify-center border-r border-black/30"
                          title="Trim element start"
                        >
                          <div className="w-0.5 h-3 bg-white/60" />
                        </div>
                        <div
                          onMouseDown={(e) => handleElementTrimStart(e, overlay, "right")}
                          className="absolute right-0 top-0 bottom-0 w-2.5 bg-fuchsia-500 cursor-ew-resize rounded-r-lg flex items-center justify-center border-l border-black/30"
                          title="Trim element end"
                        >
                          <div className="w-0.5 h-3 bg-white/60" />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
      
      {/* Keyboard Shortcut Hints Info Footer */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 border-t border-border/30 pt-2 select-none">
        <span className="font-semibold text-violet-400/80">Pro tips:</span>
        <span>Space to Play/Pause • S to Split video clip • Backspace to Delete selected clip • Drag trim handles to slide timestamps.</span>
      </div>
    </div>
  );
}
