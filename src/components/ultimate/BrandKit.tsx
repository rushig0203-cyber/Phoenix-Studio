"use strict";
"use client";

import React, { useState } from "react";
import { 
  Type, 
  Palette, 
  Upload, 
  Plus, 
  Sparkles, 
  Check, 
  ChevronRight, 
  Video,
  FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PRESETS = [
  {
    id: "hormozi",
    name: "Alex Hormozi Style",
    font: "Anton / Impact",
    color: "#eab308", // yellow-500
    color2: "#ffffff",
    stroke: "#000000",
    uppercase: true,
  },
  {
    id: "cooper",
    name: "Podcaster Pro",
    font: "Montserrat",
    color: "#c084fc", // purple-400
    color2: "#ffffff",
    stroke: "#1e1b4b",
    uppercase: true,
  },
  {
    id: "minimal",
    name: "Modern Minimalist",
    font: "Inter / Outfit",
    color: "#ffffff",
    color2: "#94a3b8",
    stroke: "#0f172a",
    uppercase: false,
  },
  {
    id: "beast",
    name: "Beast Mode",
    font: "Bangers / Bold",
    color: "#22c55e", // green-500
    color2: "#facc15", // yellow-400
    stroke: "#000000",
    uppercase: true,
  }
];

export default function BrandKit() {
  const [selectedPreset, setSelectedPreset] = useState("hormozi");
  const [font, setFont] = useState("Impact");
  const [primaryColor, setPrimaryColor] = useState("#eab308");
  const [secondaryColor, setSecondaryColor] = useState("#ffffff");
  const [fontSize, setFontSize] = useState(32);
  const [watermarkText, setWatermarkText] = useState("AuraClip.co");
  const [watermarkOpacity, setWatermarkOpacity] = useState(60);
  const [hasIntro, setHasIntro] = useState(true);
  const [hasOutro, setHasOutro] = useState(false);
  const [customLogoName, setCustomLogoName] = useState<string | null>("brand_logo_gold.png");

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setSelectedPreset(preset.id);
    setFont(preset.font.split(" / ")[0]);
    setPrimaryColor(preset.color);
    setSecondaryColor(preset.color2);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Configuration Controls - Left */}
      <div className="lg:col-span-7 space-y-6">
        
        {/* Presets Grid */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-400" />
            <h3 className="font-bold text-white text-sm">One-Click Style Presets</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Apply curated style presets designed by professional content editors to maximize retention.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PRESETS.map((p) => {
              const isActive = selectedPreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={`flex flex-col text-left p-4 rounded-xl border transition-all relative group overflow-hidden ${
                    isActive 
                      ? "border-violet-500 bg-violet-600/10 shadow-lg shadow-violet-500/5" 
                      : "border-border/40 bg-white/5 hover:border-violet-500/30 hover:bg-white/10"
                  }`}
                >
                  <div className="flex justify-between items-start w-full">
                    <span className="font-semibold text-xs text-white group-hover:text-violet-400 transition-colors">
                      {p.name}
                    </span>
                    {isActive && (
                      <span className="bg-violet-600 text-white p-0.5 rounded-full">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span 
                      className="text-lg font-extrabold uppercase px-1.5 rounded"
                      style={{ 
                        fontFamily: p.font.toLowerCase().includes("impact") ? "Impact, sans-serif" : "sans-serif",
                        color: p.color,
                        textShadow: `2px 2px 0px ${p.stroke}`
                      }}
                    >
                      Retention
                    </span>
                    <span 
                      className="text-lg font-extrabold uppercase px-1.5 rounded"
                      style={{ 
                        fontFamily: p.font.toLowerCase().includes("impact") ? "Impact, sans-serif" : "sans-serif",
                        color: p.color2,
                        textShadow: `2px 2px 0px ${p.stroke}`
                      }}
                    >
                      Hacks
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-2 font-mono">
                    Font: {p.font}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Captions Styling */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-6">
          <div className="flex items-center gap-2 border-b border-border/20 pb-3">
            <Type className="h-4.5 w-4.5 text-violet-400" />
            <h3 className="font-bold text-white text-sm">Typography & Colors</h3>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Font Family</label>
              <select
                value={font}
                onChange={(e) => {
                  setFont(e.target.value);
                  setSelectedPreset("custom");
                }}
                className="w-full rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="Impact" className="bg-slate-900">Impact (Bold Title)</option>
                <option value="Montserrat" className="bg-slate-900">Montserrat</option>
                <option value="Inter" className="bg-slate-900">Inter / Outfit</option>
                <option value="Bangers" className="bg-slate-900">Bangers (Meme Style)</option>
                <option value="Arial" className="bg-slate-900">Arial Black</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Font Size (px)</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="20"
                  max="60"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="flex-grow accent-violet-600 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-xs font-mono text-white bg-white/5 border border-border/30 px-2 py-1 rounded min-w-[35px] text-center">
                  {fontSize}px
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Primary Color (Active Word)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => {
                    setPrimaryColor(e.target.value);
                    setSelectedPreset("custom");
                  }}
                  className="h-8 w-8 rounded-lg border-0 bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => {
                    setPrimaryColor(e.target.value);
                    setSelectedPreset("custom");
                  }}
                  className="flex-grow rounded-lg border border-border/40 bg-white/5 px-3 py-1.5 text-xs text-white uppercase font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Secondary Color (Normal Text)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => {
                    setSecondaryColor(e.target.value);
                    setSelectedPreset("custom");
                  }}
                  className="h-8 w-8 rounded-lg border-0 bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={secondaryColor}
                  onChange={(e) => {
                    setSecondaryColor(e.target.value);
                    setSelectedPreset("custom");
                  }}
                  className="flex-grow rounded-lg border border-border/40 bg-white/5 px-3 py-1.5 text-xs text-white uppercase font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Logo and Watermark */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-6">
          <div className="flex items-center gap-2 border-b border-border/20 pb-3">
            <Palette className="h-4.5 w-4.5 text-violet-400" />
            <h3 className="font-bold text-white text-sm">Logo & Brand Watermark</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Watermark Logo Upload */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Brand Logo / PNG Overlay</label>
              <div className="border border-dashed border-border/40 rounded-xl p-4 flex flex-col items-center justify-center bg-white/5 hover:bg-white/10 transition-colors cursor-pointer text-center relative group">
                {customLogoName ? (
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 inline-block">
                      Loaded
                    </span>
                    <p className="text-[10px] text-white font-mono truncate max-w-[180px]">{customLogoName}</p>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomLogoName(null);
                      }}
                      className="text-[9px] text-rose-400 hover:text-rose-300 underline block mx-auto mt-1 border-0 bg-transparent cursor-pointer"
                    >
                      Remove Logo
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground group-hover:text-violet-400 transition-colors mb-2" />
                    <p className="text-[10px] text-slate-300 font-medium">Upload Transparent PNG</p>
                    <span className="text-[8px] text-muted-foreground mt-0.5">Max size 2MB</span>
                  </>
                )}
              </div>
            </div>

            {/* Watermark text */}
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Watermark Custom Text</label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="e.g. @yourhandle"
                  className="w-full rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Watermark Opacity ({watermarkOpacity}%)</label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={watermarkOpacity}
                  onChange={(e) => setWatermarkOpacity(parseInt(e.target.value))}
                  className="w-full accent-violet-600 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Brand Assets: Intro/Outro templates */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border/20 pb-3">
            <Video className="h-4.5 w-4.5 text-violet-400" />
            <h3 className="font-bold text-white text-sm">Auto Intro & Outro Assets</h3>
          </div>
          
          <div className="flex flex-col gap-4">
            {/* Intro Video Switch */}
            <div className="flex justify-between items-center p-3 rounded-xl border border-border/40 bg-white/5">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-white">Auto-attach Custom Outro Clip</span>
                <p className="text-[10px] text-muted-foreground">Appends a calls-to-action video at the end of every export.</p>
              </div>
              <button
                type="button"
                onClick={() => setHasIntro(!hasIntro)}
                className={`w-9 h-5 rounded-full transition-all relative ${
                  hasIntro ? "bg-violet-600" : "bg-slate-700"
                }`}
              >
                <div 
                  className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                    hasIntro ? "left-4.5" : "left-1"
                  }`} 
                />
              </button>
            </div>

            {hasIntro && (
              <div className="flex gap-4 items-center bg-white/5 border border-dashed border-border/30 rounded-xl p-4 animate-in fade-in duration-200">
                <div className="h-12 w-12 rounded bg-slate-950 flex flex-col items-center justify-center shrink-0 border border-border/40">
                  <Video className="h-5 w-5 text-violet-400" />
                </div>
                <div className="flex-grow min-w-0">
                  <h4 className="text-xs font-bold text-white truncate">outro_cta_youtube_shorts.mp4</h4>
                  <p className="text-[10px] text-muted-foreground">Duration: 3.2s • MP4 • 1080x1920</p>
                </div>
                <button 
                  onClick={() => setHasIntro(false)} 
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold cursor-pointer border-0 bg-transparent"
                >
                  Change
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Live Preview Display - Right */}
      <div className="lg:col-span-5 space-y-6">
        <div className="sticky top-6 rounded-2xl border border-violet-500/20 bg-slate-900/60 p-6 flex flex-col items-center gap-6 shadow-2xl relative">
          <div className="absolute top-0 right-0 h-32 w-32 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="w-full flex justify-between items-center border-b border-border/20 pb-3">
            <h3 className="font-bold text-white text-sm">Live Mobile Render Preview</h3>
            <span className="text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded font-bold uppercase">
              1080 x 1920 (9:16)
            </span>
          </div>

          {/* Smartphone Mock Frame */}
          <div className="relative aspect-[9/16] w-[260px] rounded-3xl border-4 border-slate-950 bg-slate-950 overflow-hidden shadow-2xl flex flex-col justify-end items-center">
            
            {/* Camera Notch mock */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 h-4.5 w-24 bg-black rounded-full z-30 flex items-center justify-center">
              <div className="h-1.5 w-1.5 bg-slate-800 rounded-full ml-auto mr-4" />
            </div>

            {/* Video Background Mock */}
            <div className="absolute inset-0 z-0 bg-gradient-to-br from-indigo-900/30 via-slate-950 to-indigo-950/20 flex flex-col items-center justify-center text-center">
              {/* Overlay simulation of branding */}
              <div className="absolute inset-0 bg-black/10 z-10" />
              <img 
                src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=260&auto=format&fit=crop" 
                className="w-full h-full object-cover" 
                alt="Video mockup background" 
              />
            </div>

            {/* Watermark Logo Overlay in top right */}
            {customLogoName && (
              <div className="absolute top-10 right-4 z-20 bg-black/40 backdrop-blur-sm rounded border border-white/10 p-1 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-yellow-400" />
                <span className="text-[7px] text-white font-bold tracking-widest font-mono uppercase">PRO</span>
              </div>
            )}

            {/* Watermark Text Overlay in top left */}
            {watermarkText && (
              <div 
                className="absolute top-10 left-4 z-20 text-[9px] font-bold tracking-wide text-white drop-shadow font-sans"
                style={{ opacity: watermarkOpacity / 100 }}
              >
                {watermarkText}
              </div>
            )}

            {/* Dynamic subtitles mockup */}
            <div className="w-full px-4 mb-16 text-center z-20 pointer-events-none flex flex-col items-center gap-1.5">
              <div className="bg-black/50 backdrop-blur-sm rounded-lg px-2.5 py-1.5 border border-white/5 shadow-lg max-w-full">
                <div className="flex flex-wrap justify-center items-center gap-x-1 gap-y-0.5 text-xs font-bold leading-none">
                  <span className="text-white/80 uppercase">How</span>
                  <span className="text-white/80 uppercase">to</span>
                  <span className="text-white/80 uppercase">build</span>
                  <span 
                    className="scale-110 font-bold transition-all px-1 rounded inline-block"
                    style={{ 
                      fontFamily: font.toLowerCase().includes("impact") ? "Impact, sans-serif" : font.toLowerCase().includes("bangers") ? "sans-serif" : "inherit",
                      color: primaryColor,
                      textShadow: `1.5px 1.5px 0px #000`
                    }}
                  >
                    RETENTION
                  </span>
                  <span className="text-white/80 uppercase">hacks</span>
                </div>
              </div>
            </div>

            {/* Bottom App Overlay mockup (Reels style icons) */}
            <div className="w-full p-3 bg-gradient-to-t from-black/80 to-transparent z-20 flex justify-between items-center text-white">
              <div className="flex items-center gap-1.5">
                <div className="h-5 w-5 rounded-full bg-violet-600 flex items-center justify-center text-[7px] font-bold">A</div>
                <div className="space-y-0.5">
                  <p className="text-[7px] font-bold">AuraClip Creator</p>
                  <p className="text-[6px] text-white/60">Audio original • 3.2M views</p>
                </div>
              </div>
              <div className="h-5 w-5 bg-white/10 rounded border border-white/20 flex items-center justify-center">
                <Sparkles className="h-2.5 w-2.5 text-yellow-400" />
              </div>
            </div>

          </div>

          {/* Action Trigger */}
          <Button 
            className="w-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs py-5 active:scale-95 transition-all shadow-lg shadow-violet-500/10 cursor-pointer"
          >
            Apply Branding to All Clips
          </Button>

        </div>
      </div>
    </div>
  );
}
