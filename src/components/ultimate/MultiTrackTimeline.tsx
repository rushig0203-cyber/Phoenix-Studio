"use strict";
"use client";

import React, { useState, useRef } from "react";
import { 
  Scissors, 
  Trash2, 
  Plus, 
  Volume2, 
  Sparkles, 
  Type, 
  Music, 
  Image as ImageIcon,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Tv,
  ArrowRight,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TrackItem {
  id: string;
  type: "video" | "audio" | "text" | "broll";
  title: string;
  start: number; // in seconds
  duration: number; // in seconds
  color: string;
}

export default function MultiTrackTimeline() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(2.5); // seconds
  const [selectedItem, setSelectedItem] = useState<string | null>("vid-1");
  const [transitionType, setTransitionType] = useState<string>("crossfade");
  const [isRendering, setIsRendering] = useState(false);
  
  const timelineRef = useRef<HTMLDivElement>(null);

  // High fidelity dummy data matching actual editing tracks
  const [tracks, setTracks] = useState<TrackItem[]>([
    // Text overlays track
    { id: "text-1", type: "text", title: "⚡ IMPOSSIBLE IS NOTHING", start: 0, duration: 4.2, color: "bg-amber-500/20 border-amber-500 text-amber-300" },
    { id: "text-2", type: "text", title: "🔥 START TODAY!", start: 4.5, duration: 3.5, color: "bg-amber-500/20 border-amber-500 text-amber-300" },
    { id: "text-3", type: "text", title: "📈 Auto Caption: 10x Growth", start: 8.2, duration: 5.0, color: "bg-amber-500/20 border-amber-500 text-amber-300" },

    // B-Roll / Overlays track
    { id: "broll-1", type: "broll", title: "🎬 B-ROLL: Office Hustle (Close-up)", start: 3.0, duration: 3.5, color: "bg-emerald-500/20 border-emerald-500 text-emerald-300" },
    { id: "broll-2", type: "broll", title: "💥 MEME: Drake nodding", start: 9.0, duration: 2.2, color: "bg-emerald-500/20 border-emerald-500 text-emerald-300" },

    // Core Video clips track
    { id: "vid-1", type: "video", title: "🗣️ Main Speaker: Hook Hook hook", start: 0, duration: 5.5, color: "bg-violet-500/20 border-violet-500 text-violet-300" },
    { id: "vid-2", type: "video", title: "🗣️ Main Speaker: Retention story", start: 5.5, duration: 6.5, color: "bg-violet-500/20 border-violet-500 text-violet-300" },
    { id: "vid-3", type: "video", title: "🗣️ Main Speaker: Outro Call-To-Action", start: 12.0, duration: 6.0, color: "bg-violet-500/20 border-violet-500 text-violet-300" },

    // Background Audio tracks
    { id: "aud-1", type: "audio", title: "🎵 BG Beat: Lofi HipHop Instrumental", start: 0, duration: 18.0, color: "bg-blue-500/20 border-blue-500 text-blue-300" },
  ]);

  const totalDuration = 18.0; // 18 seconds max shown in zoom view

  const handleTimelineScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    setPlayhead(Math.round(percentage * totalDuration * 10) / 10);
  };

  const splitSelectedClip = () => {
    if (!selectedItem) return;
    const item = tracks.find(t => t.id === selectedItem);
    if (!item) return;

    // split only video/audio
    if (playhead > item.start && playhead < item.start + item.duration) {
      const leftDuration = playhead - item.start;
      const rightDuration = item.duration - leftDuration;

      const rightItem: TrackItem = {
        id: `split-${Math.random().toString(36).substr(2, 5)}`,
        type: item.type,
        title: `${item.title} (Part 2)`,
        start: playhead,
        duration: rightDuration,
        color: item.color,
      };

      setTracks(prev => {
        const updated = prev.map(t => {
          if (t.id === item.id) {
            return { ...t, duration: leftDuration, title: `${t.title} (Part 1)` };
          }
          return t;
        });
        return [...updated, rightItem].sort((a, b) => a.start - b.start);
      });
    }
  };

  const deleteSelectedClip = () => {
    if (!selectedItem) return;
    setTracks(prev => prev.filter(t => t.id !== selectedItem));
    setSelectedItem(null);
  };

  const addOverlayAsset = (type: "broll" | "text" | "audio") => {
    const newAsset: TrackItem = {
      id: `${type}-${Math.random().toString(36).substr(2, 5)}`,
      type,
      title: type === "broll" ? "🎬 B-ROLL: New Overlay" : type === "text" ? "✍️ Text Overlay" : "🎵 SFX Synth Wave",
      start: playhead,
      duration: 3.0,
      color: type === "broll" 
        ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
        : type === "text"
        ? "bg-amber-500/20 border-amber-500 text-amber-300"
        : "bg-blue-500/20 border-blue-500 text-blue-300"
    };
    setTracks(prev => [...prev, newAsset].sort((a, b) => a.start - b.start));
  };

  const renderVideo = () => {
    setIsRendering(true);
    setTimeout(() => {
      setIsRendering(false);
      alert("Pro HD video compiled and exported successfully to watch folder!");
    }, 3000);
  };

  return (
    <div className="space-y-6">
      
      {/* Editor Main Tools Strip */}
      <div className="flex flex-wrap justify-between items-center bg-slate-900/60 border border-border/40 p-4 rounded-2xl gap-4">
        <div className="flex items-center gap-2">
          {/* Timeline Playback Controls */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="h-9 w-9 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
          </button>
          
          <button
            onClick={() => setPlayhead(0)}
            className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white flex items-center justify-center transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <span className="text-xs font-mono text-white/95 px-3 py-1 bg-black/60 rounded border border-white/5 ml-2">
            Playhead: <span className="text-violet-400 font-bold">{playhead.toFixed(1)}s</span> / {totalDuration}s
          </span>
        </div>

        {/* NLE Edit Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={splitSelectedClip}
            disabled={!selectedItem}
            className="rounded-lg border-border/40 hover:bg-white/5 text-white gap-1 text-xs px-3"
          >
            <Scissors className="h-3.5 w-3.5 text-violet-400" />
            Split Clip
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={deleteSelectedClip}
            disabled={!selectedItem}
            className="rounded-lg border-border/40 hover:bg-rose-500/10 text-rose-400 gap-1 text-xs px-3 focus:text-rose-400 hover:border-rose-500/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>

          <div className="h-6 w-[1px] bg-border/20 mx-1" />

          <Button
            size="sm"
            variant="outline"
            onClick={() => addOverlayAsset("text")}
            className="rounded-lg border-border/40 hover:bg-white/5 text-white gap-1 text-xs px-3"
          >
            <Plus className="h-3.5 w-3.5 text-amber-400" />
            Text Track
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => addOverlayAsset("broll")}
            className="rounded-lg border-border/40 hover:bg-white/5 text-white gap-1 text-xs px-3"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            B-Roll
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => addOverlayAsset("audio")}
            className="rounded-lg border-border/40 hover:bg-white/5 text-white gap-1 text-xs px-3"
          >
            <Plus className="h-3.5 w-3.5 text-blue-400" />
            SFX
          </Button>
        </div>
      </div>

      {/* Stacked Multi-Track Timeline Canvas */}
      <div className="rounded-2xl border border-border/40 bg-slate-950 p-6 shadow-2xl space-y-4 overflow-hidden relative">
        <div className="absolute top-0 right-0 h-40 w-40 bg-violet-600/5 rounded-full blur-3xl pointer-events-none" />
        
        {/* Time ruler ticks header */}
        <div className="relative h-6 border-b border-border/20 mb-2">
          {Array.from({ length: 10 }).map((_, i) => {
            const timeVal = (i * (totalDuration / 9)).toFixed(1);
            return (
              <div 
                key={i} 
                className="absolute text-[8px] font-mono text-muted-foreground select-none"
                style={{ left: `${(i / 9) * 96}%` }}
              >
                {timeVal}s
              </div>
            );
          })}
        </div>

        {/* The Timeline Track Stack */}
        <div className="space-y-3 relative min-h-[200px]">
          
          {/* Vertical Playhead Cursor */}
          <div 
            className="absolute top-0 bottom-0 w-[2px] bg-violet-500 z-30 pointer-events-none shadow-[0_0_8px_rgba(139,92,246,0.8)]"
            style={{ left: `${(playhead / totalDuration) * 100}%` }}
          >
            <div className="absolute -top-1 -left-[5px] h-3 w-3 bg-violet-500 rounded-full border border-white" />
          </div>

          {/* Interactive Scrub Layer overlay */}
          <div 
            ref={timelineRef}
            onClick={handleTimelineScrub}
            className="absolute inset-0 z-20 cursor-ew-resize opacity-0"
            title="Scrub playhead"
          />

          {/* TRACK 1: Dynamic Text Captions */}
          <div className="flex items-center gap-4 relative">
            <span className="w-16 text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5 z-10 shrink-0">
              <Type className="h-3.5 w-3.5" />
              Text
            </span>
            <div className="flex-grow h-12 bg-white/[0.02] border border-white/5 rounded-lg relative overflow-hidden">
              {tracks.filter(t => t.type === "text").map(item => {
                const isSel = selectedItem === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item.id)}
                    className={`absolute h-8 top-1.5 rounded-md border flex items-center justify-between px-3 text-[9px] font-semibold tracking-wide shadow-md transition-all z-10 select-none ${item.color} ${
                      isSel ? "ring-2 ring-violet-500 border-transparent scale-[1.02]" : "opacity-85 hover:opacity-100"
                    }`}
                    style={{
                      left: `${(item.start / totalDuration) * 100}%`,
                      width: `${(item.duration / totalDuration) * 100}%`
                    }}
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="text-[7px] font-mono text-white/50">{item.duration.toFixed(1)}s</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* TRACK 2: B-Roll & Memes */}
          <div className="flex items-center gap-4 relative">
            <span className="w-16 text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 z-10 shrink-0">
              <ImageIcon className="h-3.5 w-3.5" />
              Overlays
            </span>
            <div className="flex-grow h-12 bg-white/[0.02] border border-white/5 rounded-lg relative overflow-hidden">
              {tracks.filter(t => t.type === "broll").map(item => {
                const isSel = selectedItem === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item.id)}
                    className={`absolute h-8 top-1.5 rounded-md border flex items-center justify-between px-3 text-[9px] font-semibold tracking-wide shadow-md transition-all z-10 select-none ${item.color} ${
                      isSel ? "ring-2 ring-violet-500 border-transparent scale-[1.02]" : "opacity-85 hover:opacity-100"
                    }`}
                    style={{
                      left: `${(item.start / totalDuration) * 100}%`,
                      width: `${(item.duration / totalDuration) * 100}%`
                    }}
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="text-[7px] font-mono text-white/50">{item.duration.toFixed(1)}s</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* TRACK 3: Core Video footage */}
          <div className="flex items-center gap-4 relative">
            <span className="w-16 text-[10px] font-bold uppercase tracking-wider text-violet-400 flex items-center gap-1.5 z-10 shrink-0">
              <Tv className="h-3.5 w-3.5" />
              Video
            </span>
            <div className="flex-grow h-12 bg-white/[0.02] border border-white/5 rounded-lg relative overflow-hidden">
              {tracks.filter(t => t.type === "video").map(item => {
                const isSel = selectedItem === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item.id)}
                    className={`absolute h-8 top-1.5 rounded-md border flex items-center justify-between px-3 text-[9px] font-semibold tracking-wide shadow-md transition-all z-10 select-none ${item.color} ${
                      isSel ? "ring-2 ring-violet-500 border-transparent scale-[1.02]" : "opacity-85 hover:opacity-100"
                    }`}
                    style={{
                      left: `${(item.start / totalDuration) * 100}%`,
                      width: `${(item.duration / totalDuration) * 100}%`
                    }}
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="text-[7px] font-mono text-white/50">{item.duration.toFixed(1)}s</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* TRACK 4: Audio Beat track */}
          <div className="flex items-center gap-4 relative">
            <span className="w-16 text-[10px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5 z-10 shrink-0">
              <Music className="h-3.5 w-3.5" />
              Audio
            </span>
            <div className="flex-grow h-12 bg-white/[0.02] border border-white/5 rounded-lg relative overflow-hidden">
              {tracks.filter(t => t.type === "audio").map(item => {
                const isSel = selectedItem === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item.id)}
                    className={`absolute h-8 top-1.5 rounded-md border flex items-center justify-between px-3 text-[9px] font-semibold tracking-wide shadow-md transition-all z-10 select-none ${item.color} ${
                      isSel ? "ring-2 ring-violet-500 border-transparent scale-[1.02]" : "opacity-85 hover:opacity-100"
                    }`}
                    style={{
                      left: `${(item.start / totalDuration) * 100}%`,
                      width: `${(item.duration / totalDuration) * 100}%`
                    }}
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="text-[7px] font-mono text-white/50">{item.duration.toFixed(1)}s</span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Clip details configuration drawer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Transition configurations */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-4">
          <h3 className="font-bold text-white text-sm">Transitions & Audio ducking</h3>
          <p className="text-xs text-muted-foreground">Select default transitions to place between video cut sequences.</p>
          
          <div className="grid grid-cols-3 gap-3">
            {["crossfade", "fade-black", "zoom-in", "glitch", "slide-left", "none"].map((t) => (
              <button
                key={t}
                onClick={() => setTransitionType(t)}
                className={`py-2 rounded-lg text-[10px] font-semibold border capitalize transition-all cursor-pointer ${
                  transitionType === t
                    ? "border-violet-500 bg-violet-600/10 text-white font-bold"
                    : "border-border/30 bg-white/5 text-muted-foreground hover:text-white"
                }`}
              >
                {t.replace("-", " ")}
              </button>
            ))}
          </div>

          <div className="pt-2 flex justify-between items-center text-xs">
            <span className="text-slate-300 font-semibold">Enable Smart Background Music Ducking</span>
            <button className="w-8 h-4 bg-violet-600 rounded-full transition-all relative">
              <div className="w-3 h-3 bg-white rounded-full absolute top-[2px] left-4" />
            </button>
          </div>
        </div>

        {/* Selected asset inspector */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-white text-sm">Asset Inspector</h3>
            {selectedItem ? (
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type:</span>
                  <span className="text-white capitalize font-medium">{tracks.find(t => t.id === selectedItem)?.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Title:</span>
                  <span className="text-white truncate max-w-[200px] font-semibold">{tracks.find(t => t.id === selectedItem)?.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Position Start:</span>
                  <span className="text-violet-400 font-mono">{tracks.find(t => t.id === selectedItem)?.start.toFixed(1)}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="text-violet-400 font-mono">{tracks.find(t => t.id === selectedItem)?.duration.toFixed(1)}s</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-3">Select any track clip in the timeline above to edit its attributes.</p>
            )}
          </div>

          <Button
            onClick={renderVideo}
            disabled={isRendering}
            className="w-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs py-4.5 shadow-lg transition-all active:scale-95 cursor-pointer mt-4"
          >
            {isRendering ? (
              <>
                <Loader2 className="h-4.5 w-4.5 animate-spin mr-2" />
                Compiling NLE Timeline (HD)...
              </>
            ) : (
              <>
                Compile & Render HD Clip
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </>
            )}
          </Button>
        </div>

      </div>

    </div>
  );
}
