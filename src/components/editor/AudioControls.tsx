"use strict";
"use client";

import React, { useRef, useState } from "react";
import { Volume2, VolumeX, Upload, Sliders, Compass } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "@/components/ui/button";

export default function AudioControls() {
  const {
    selectedClipId,
    selectedTrackType,
    videoClips,
    audioClips,
    updateVideoClip,
    updateAudioClip,
    addAudioClip,
  } = useEditorStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Get active selected clip references
  const selectedVideoClip =
    selectedTrackType === "video"
      ? videoClips.find((c) => c.id === selectedClipId)
      : null;

  const selectedAudioClip =
    selectedTrackType === "audio"
      ? audioClips.find((c) => c.id === selectedClipId)
      : null;

  const videoVolume = selectedVideoClip && typeof selectedVideoClip.volume === "number" ? selectedVideoClip.volume : 1.0;
  const audioVolume = selectedAudioClip && typeof selectedAudioClip.volume === "number" ? selectedAudioClip.volume : 0.8;

  // Handle local background music audio import
  const handleAudioImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsImporting(true);

    // Validate format
    if (!file.name.match(/\.(mp3|wav|m4a|ogg|aac)$/i)) {
      setError("Unsupported format. Please select MP3, WAV, M4A, OGG, or AAC.");
      setIsImporting(false);
      return;
    }

    const audioUrl = URL.createObjectURL(file);
    const audio = new Audio();
    audio.src = audioUrl;

    audio.onloadedmetadata = () => {
      addAudioClip(file.name.replace(/\.[^/.]+$/, ""), audioUrl, audio.duration);
      setIsImporting(false);
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      setError("Failed to decode audio file metadata.");
      setIsImporting(false);
    };
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleAddBuiltinTrack = (track: { title: string; duration: number }) => {
    try {
      const audioUrl = createSilentAudioUrl(track.duration);
      addAudioClip(`${track.title}`, audioUrl, track.duration);
      console.log(`AuraClip: Added built-in track ${track.title} to timeline.`);
    } catch (e) {
      setError("Failed to initialize built-in soundtrack.");
      console.error(e);
    }
  };

  const formatDuration = (sec: number) => {
    return `${sec.toFixed(1)}s`;
  };

  return (
    <div className="bg-slate-950/60 border border-border/40 rounded-xl p-5 flex flex-col gap-6 shadow-2xl h-full justify-between">
      <div className="space-y-6">
        
        {/* Panel Header */}
        <div className="flex items-center gap-2 border-b border-border/40 pb-3">
          <Sliders className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white tracking-tight">Audio Diagnostics</h3>
        </div>

        {/* Conditional Rendering: Audio Clip Selected */}
        {selectedAudioClip && (
          <div className="space-y-5">
            <div>
              <p className="text-[10px] uppercase font-bold text-emerald-400">Audio Track Selected</p>
              <h4 className="text-sm font-bold text-white mt-1 truncate">{selectedAudioClip.title}</h4>
            </div>

            {/* Volume Control */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center text-xs text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  Volume
                </span>
                <span className="font-semibold text-white">{Math.round(audioVolume * 100)}%</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={audioVolume}
                  onChange={(e) =>
                    updateAudioClip(selectedAudioClip.id, { volume: parseFloat(e.target.value) })
                  }
                  className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    updateAudioClip(selectedAudioClip.id, { isMuted: !selectedAudioClip.isMuted })
                  }
                  className="h-8 w-8 rounded-lg hover:bg-white/5 shrink-0"
                >
                  {selectedAudioClip.isMuted ? (
                    <VolumeX className="h-4 w-4 text-rose-400 animate-pulse" />
                  ) : (
                    <Volume2 className="h-4 w-4 text-slate-300" />
                  )}
                </Button>
              </div>
            </div>

            {/* Fade In / Fade Out */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] text-muted-foreground font-bold uppercase block">
                  Fade In (sec)
                </label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={selectedAudioClip.fadeIn}
                  onChange={(e) =>
                    updateAudioClip(selectedAudioClip.id, {
                      fadeIn: Math.max(0, Math.min(5, parseFloat(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] text-muted-foreground font-bold uppercase block">
                  Fade Out (sec)
                </label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={selectedAudioClip.fadeOut}
                  onChange={(e) =>
                    updateAudioClip(selectedAudioClip.id, {
                      fadeOut: Math.max(0, Math.min(5, parseFloat(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Metadata Stats */}
            <div className="bg-slate-900/40 rounded-xl border border-border/10 p-3.5 space-y-2 text-[10px] text-muted-foreground font-mono">
              <div className="flex justify-between">
                <span>Duration:</span>
                <span className="text-white">{formatDuration(selectedAudioClip.duration)}</span>
              </div>
              <div className="flex justify-between">
                <span>Offset:</span>
                <span className="text-white">{formatDuration(selectedAudioClip.playStartTime)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Conditional Rendering: Video Clip Selected (control audio of video) */}
        {selectedVideoClip && (
          <div className="space-y-5">
            <div>
              <p className="text-[10px] uppercase font-bold text-violet-400">Video Segment Audio</p>
              <h4 className="text-sm font-bold text-white mt-1 truncate">{selectedVideoClip.title}</h4>
            </div>

            <div className="space-y-2.5">
              <div className="flex justify-between items-center text-xs text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  Original Volume
                </span>
                <span className="font-semibold text-white">{Math.round(videoVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={videoVolume}
                onChange={(e) =>
                  updateVideoClip(selectedVideoClip.id, { volume: parseFloat(e.target.value) })
                }
                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-violet-500"
              />
            </div>

            <div className="bg-slate-900/40 rounded-xl border border-border/10 p-3.5 space-y-2 text-[10px] text-muted-foreground font-mono">
              <div className="flex justify-between">
                <span>Clip Start:</span>
                <span className="text-white">{formatDuration(selectedVideoClip.startTime)}</span>
              </div>
              <div className="flex justify-between">
                <span>Clip End:</span>
                <span className="text-white">{formatDuration(selectedVideoClip.endTime)}</span>
              </div>
            </div>
          </div>
        )}

        {/* No Selection State */}
        {!selectedClipId && (
          <div className="text-center py-6 text-muted-foreground border border-dashed border-border/30 rounded-xl bg-white/[0.01] p-4 flex flex-col items-center">
            <Compass className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-xs">No clip selected</p>
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              Select a video track block to adjust segment volume, or add background tracks.
            </p>
          </div>
        )}
      </div>

      {/* Soundtracks Selection Section */}
      <div className="border-t border-border/30 pt-4 space-y-4 shrink-0 overflow-y-auto max-h-[200px]">
        {/* Built-in Tracks (Zero cost) */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            Built-in Free Soundtracks
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {BUILTIN_TRACKS.map((track) => (
              <button
                key={track.title}
                onClick={() => handleAddBuiltinTrack(track)}
                className="py-1.5 px-2 rounded-lg border border-border/40 bg-white/5 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-left text-[10px] font-semibold text-slate-200 transition-all flex flex-col justify-between h-12 cursor-pointer"
              >
                <span className="truncate w-full">{track.title}</span>
                <span className="text-[8px] text-emerald-400/80 font-mono mt-1">
                  {track.duration}s
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Audio Import */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Or upload custom audio
          </h4>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleAudioImport}
            className="hidden"
          />

          <Button
            onClick={triggerFileInput}
            disabled={isImporting}
            variant="outline"
            className="w-full h-8 text-[10px] rounded-lg border-dashed border-border/40 hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-emerald-400 gap-1 cursor-pointer"
          >
            <Upload className="h-3 w-3" />
            {isImporting ? "Loading track..." : "Import Audio File"}
          </Button>
        </div>

        {error && (
          <p className="text-[9px] text-rose-400 text-center font-medium animate-pulse">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// Built-in mock soundtracks
const BUILTIN_TRACKS = [
  { title: "Upbeat Vlog Theme", duration: 120 },
  { title: "Chill Lofi Sunset", duration: 180 },
  { title: "Epic Cinematic Beat", duration: 150 },
  { title: "Synthwave Pulse", duration: 140 },
];

// Dynamically generate a playable synthesized electronic loop WAV URL locally in browser
function createSilentAudioUrl(duration: number): string {
  const sampleRate = 8000;
  const numChannels = 1;
  const numSamples = duration * sampleRate;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, numSamples * 2, true);

  // Synthesize a nice 8-bit chip melody loop with a rhythmic beat!
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    
    // A minor pentatonic note sequence (frequencies in Hz)
    // C4 (261.63), E4 (329.63), G4 (392.00), A4 (440.00), C5 (523.25), D5 (587.33)
    const noteIndex = Math.floor(t / 0.25) % 16;
    const notes = [
      440.00, 523.25, 392.00, 440.00,
      329.63, 392.00, 440.00, 523.25,
      392.00, 440.00, 523.25, 587.33,
      440.00, 392.00, 329.63, 261.63
    ];
    const freq = notes[noteIndex];
    
    // Melodic pulse wave
    const pulse = Math.sin(2 * Math.PI * freq * t) > 0 ? 0.15 : -0.15;
    
    // Beat kick drum approximation (every 0.5 seconds)
    const beatPhase = (t % 0.5) / 0.5; // 0 to 1
    const kick = Math.sin(2 * Math.PI * 65 * Math.exp(-beatPhase * 16)) * Math.max(0, 1 - beatPhase * 3.5);
    
    // Hi-hat sound (white noise burst every 0.25s)
    const hatPhase = (t % 0.25) / 0.25;
    const hat = (Math.random() * 2 - 1) * Math.max(0, 1 - hatPhase / 0.12) * 0.08;
    
    // Mix and normalize volume
    let mixed = pulse + kick * 0.35 + hat;
    mixed = Math.max(-1, Math.min(1, mixed));
    
    // Set 16-bit PCM value
    const val = Math.floor(mixed * 16000);
    view.setInt16(44 + i * 2, val, true);
  }

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
