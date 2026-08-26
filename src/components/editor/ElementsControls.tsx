"use strict";
"use client";

import React, { useRef } from "react";
import { Type, Square, HelpCircle, Image as ImageIcon, Trash2, Layers, Clock, Settings, Sparkles } from "lucide-react";
import { useEditorStore, ElementOverlay } from "@/store/editorStore";
import { Button } from "@/components/ui/button";

export default function ElementsControls() {
  const {
    elementOverlays,
    selectedElementId,
    selectedTrackType,
    addElementOverlay,
    updateElementOverlay,
    deleteElementOverlay,
    setSelectedElementId,
    currentTime,
    videoMetadata,
  } = useEditorStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedElement = elementOverlays.find(
    (e) => e.id === selectedElementId && selectedTrackType === "element"
  );

  const durationLimit = videoMetadata?.duration || 60;

  // Add Preset Handlers
  const handleAddText = (style: "heading" | "subheading" | "body" | "neon" | "retro") => {
    const defaultParams = {
      type: "text" as const,
      opacity: 1.0,
      x: 25,
      y: 40,
      width: 50,
      height: 12,
      playStartTime: currentTime,
      duration: Math.min(5, durationLimit - currentTime),
      zIndex: elementOverlays.length + 1,
    };

    let textParams = {};
    if (style === "heading") {
      textParams = {
        text: "ADD A HEADING",
        fontFamily: "Impact",
        color: "#FFFFFF",
        fontSize: 32,
      };
    } else if (style === "subheading") {
      textParams = {
        text: "Add a subheading",
        fontFamily: "Montserrat",
        color: "#E2E8F0",
        fontSize: 20,
      };
    } else if (style === "body") {
      textParams = {
        text: "Add body text here",
        fontFamily: "Arial",
        color: "#94A3B8",
        fontSize: 14,
      };
    } else if (style === "neon") {
      textParams = {
        text: "NEON GLOW",
        fontFamily: "Montserrat",
        color: "#FF00FF",
        backgroundColor: "#000000",
        fontSize: 28,
      };
    } else if (style === "retro") {
      textParams = {
        text: "RETRO STYLE",
        fontFamily: "Impact",
        color: "#FFCC00",
        backgroundColor: "#990000",
        fontSize: 28,
      };
    }

    addElementOverlay({
      ...defaultParams,
      ...textParams,
    });
  };

  const handleAddShape = (shapeType: "rectangle" | "circle" | "arrow" | "star") => {
    addElementOverlay({
      type: "shape" as const,
      shapeType,
      color: "#8B5CF6", // Violet-500
      opacity: 0.8,
      x: 35,
      y: 35,
      width: 30,
      height: 20,
      playStartTime: currentTime,
      duration: Math.min(5, durationLimit - currentTime),
      zIndex: elementOverlays.length + 1,
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const imageUrl = URL.createObjectURL(file);
    addElementOverlay({
      type: "image" as const,
      imageUrl,
      opacity: 1.0,
      x: 35,
      y: 35,
      width: 30,
      height: 20,
      playStartTime: currentTime,
      duration: Math.min(5, durationLimit - currentTime),
      zIndex: elementOverlays.length + 1,
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-950/40 p-5 gap-5 select-none overflow-y-auto max-h-[650px] custom-scrollbar">
      
      {/* Title Header */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-3">
        <Sparkles className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-bold text-white tracking-tight">Canva Pro Elements</h3>
      </div>

      {!selectedElement ? (
        /* ONBOARDING CREATOR SELECTOR */
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Text Overlays Section */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Type className="h-3.5 w-3.5" /> Text Overlays
            </h4>
            
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleAddText("heading")}
                className="w-full text-left bg-slate-900 border border-border/30 hover:border-violet-500/50 p-2.5 rounded-lg text-white font-extrabold text-sm hover:scale-[1.01] active:scale-95 transition-all cursor-pointer shadow"
              >
                Add a heading
              </button>
              <button
                type="button"
                onClick={() => handleAddText("subheading")}
                className="w-full text-left bg-slate-900 border border-border/30 hover:border-violet-500/50 p-2.5 rounded-lg text-slate-200 font-bold text-xs hover:scale-[1.01] active:scale-95 transition-all cursor-pointer shadow"
              >
                Add a subheading
              </button>
              <button
                type="button"
                onClick={() => handleAddText("body")}
                className="w-full text-left bg-slate-900 border border-border/30 hover:border-violet-500/50 p-2.5 rounded-lg text-slate-400 text-[10px] hover:scale-[1.01] active:scale-95 transition-all cursor-pointer shadow"
              >
                Add body text
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleAddText("neon")}
                className="bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20 hover:border-pink-500 text-pink-400 hover:text-pink-300 font-extrabold text-xs py-2 rounded-lg cursor-pointer hover:scale-[1.02] transition-all"
              >
                ⚡ Neon Presets
              </button>
              <button
                type="button"
                onClick={() => handleAddText("retro")}
                className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 hover:border-amber-500 text-amber-400 hover:text-amber-300 font-extrabold text-xs py-2 rounded-lg cursor-pointer hover:scale-[1.02] transition-all"
              >
                🔥 Retro Presets
              </button>
            </div>
          </div>

          {/* Graphic Shapes Section */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Square className="h-3.5 w-3.5" /> Shapes & Stickers
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAddShape("rectangle")}
                className="bg-slate-900 border border-border/30 hover:border-violet-500/50 p-2.5 rounded-lg text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.02] transition-all"
              >
                <div className="h-3 w-5 bg-violet-400 rounded-sm" />
                Rectangle
              </button>
              <button
                type="button"
                onClick={() => handleAddShape("circle")}
                className="bg-slate-900 border border-border/30 hover:border-violet-500/50 p-2.5 rounded-lg text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.02] transition-all"
              >
                <div className="h-4.5 w-4.5 bg-violet-400 rounded-full" />
                Circle
              </button>
              <button
                type="button"
                onClick={() => handleAddShape("arrow")}
                className="bg-slate-900 border border-border/30 hover:border-violet-500/50 p-2.5 rounded-lg text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.02] transition-all"
              >
                <span className="text-violet-400 text-xs">➔</span>
                Arrow Vector
              </button>
              <button
                type="button"
                onClick={() => handleAddShape("star")}
                className="bg-slate-900 border border-border/30 hover:border-violet-500/50 p-2.5 rounded-lg text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.02] transition-all"
              >
                <span className="text-violet-400 text-xs">★</span>
                Star Badge
              </button>
            </div>
          </div>

          {/* Watermarks & Media Section */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" /> Upload Watermarks
            </h4>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center border border-dashed border-border/40 hover:border-violet-500/50 bg-white/5 hover:bg-white/10 py-6 rounded-xl cursor-pointer transition-all gap-1.5"
            >
              <ImageIcon className="h-5 w-5 text-violet-400" />
              <span className="text-xs font-semibold text-white">Import Custom Image</span>
              <span className="text-[9px] text-muted-foreground">PNG, JPG, SVG for branding</span>
            </button>
          </div>
        </div>
      ) : (
        /* ELEMENT ATTRIBUTES EDITOR */
        <div className="space-y-5 animate-in slide-in-from-right-3 duration-150">
          <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-border/10">
            <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wide bg-violet-950/60 border border-violet-900/30 px-2 py-0.5 rounded">
              Selected: {selectedElement.type}
            </span>
            <button
              type="button"
              onClick={() => setSelectedElementId(null)}
              className="text-[10px] text-slate-400 hover:text-white font-bold hover:underline"
            >
              Clear Selection
            </button>
          </div>

          {/* Text Editing Textarea */}
          {selectedElement.type === "text" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Text Content</label>
              <textarea
                rows={2}
                value={selectedElement.text || ""}
                onChange={(e) => updateElementOverlay(selectedElement.id, { text: e.target.value })}
                className="w-full rounded border border-border/40 bg-slate-950/60 p-2 text-xs text-white focus:outline-none focus:border-violet-500"
              />
            </div>
          )}

          {/* Font configurations */}
          {selectedElement.type === "text" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">Font Family</label>
                <select
                  value={selectedElement.fontFamily || "Montserrat"}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { fontFamily: e.target.value })}
                  className="w-full rounded h-8 border border-border/40 bg-slate-950/60 px-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer"
                >
                  <option value="Montserrat">Montserrat</option>
                  <option value="Impact">Impact</option>
                  <option value="Arial">Arial</option>
                  <option value="Inter">Inter</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">Font Size</label>
                <input
                  type="number"
                  min="8"
                  max="120"
                  value={selectedElement.fontSize || 16}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { fontSize: parseInt(e.target.value) || 16 })}
                  className="w-full rounded h-8 border border-border/40 bg-slate-950/60 px-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>
          )}

          {/* Design Style: Color & Backing */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-400 uppercase">
                {selectedElement.type === "text" ? "Text Color" : "Fill Color"}
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={selectedElement.color || "#FFFFFF"}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { color: e.target.value })}
                  className="h-8 w-12 rounded border border-border/40 cursor-pointer bg-slate-950/60 p-0.5"
                />
                <span className="text-[10px] font-mono uppercase text-slate-300">{selectedElement.color || "#FFFFFF"}</span>
              </div>
            </div>

            {selectedElement.type === "text" && (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">Backing Color</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={selectedElement.backgroundColor || "#000000"}
                    onChange={(e) => updateElementOverlay(selectedElement.id, { backgroundColor: e.target.value })}
                    className="h-8 w-12 rounded border border-border/40 cursor-pointer bg-slate-950/60 p-0.5"
                  />
                  <span className="text-[10px] font-mono uppercase text-slate-300">{selectedElement.backgroundColor || "#000000"}</span>
                </div>
              </div>
            )}
          </div>

          {/* Layout Layering: Opacity & Z-Index */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400 uppercase">
                <span>Opacity</span>
                <span className="text-violet-400 font-bold">{Math.round(selectedElement.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={selectedElement.opacity}
                onChange={(e) => updateElementOverlay(selectedElement.id, { opacity: parseFloat(e.target.value) })}
                className="w-full h-1 bg-white/10 rounded cursor-pointer accent-violet-500"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-400 uppercase">Layer Order (Z-Index)</label>
              <input
                type="number"
                min="1"
                max="99"
                value={selectedElement.zIndex}
                onChange={(e) => updateElementOverlay(selectedElement.id, { zIndex: parseInt(e.target.value) || 1 })}
                className="w-full rounded h-8 border border-border/40 bg-slate-950/60 px-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          {/* Timeline Alignment Panel */}
          <div className="bg-slate-900/40 rounded-xl p-4 border border-border/10 space-y-4">
            <h5 className="text-[10px] font-bold uppercase text-white flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-violet-400" />
              Timing & Duration
            </h5>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] font-semibold text-slate-400 uppercase">Show At (sec)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={durationLimit}
                  value={selectedElement.playStartTime.toFixed(1)}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { playStartTime: Math.max(0, parseFloat(e.target.value) || 0) })}
                  className="w-full rounded h-7 border border-border/40 bg-slate-950/60 px-2.5 text-[11px] text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-semibold text-slate-400 uppercase">Duration (sec)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max={durationLimit}
                  value={selectedElement.duration.toFixed(1)}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { duration: Math.max(0.1, parseFloat(e.target.value) || 1.0) })}
                  className="w-full rounded h-7 border border-border/40 bg-slate-950/60 px-2.5 text-[11px] text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>
          </div>

          {/* Size parameters */}
          <div className="bg-slate-900/40 rounded-xl p-4 border border-border/10 space-y-3">
            <h5 className="text-[10px] font-bold uppercase text-white flex items-center gap-1">
              <Settings className="h-3.5 w-3.5 text-violet-400" />
              Position Settings (%)
            </h5>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <label className="text-[8px] text-slate-400 block uppercase mb-1">X Pos</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round(selectedElement.x)}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { x: parseInt(e.target.value) || 0 })}
                  className="w-full text-center rounded h-7 border border-border/40 bg-slate-950/60 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[8px] text-slate-400 block uppercase mb-1">Y Pos</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round(selectedElement.y)}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { y: parseInt(e.target.value) || 0 })}
                  className="w-full text-center rounded h-7 border border-border/40 bg-slate-950/60 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[8px] text-slate-400 block uppercase mb-1">Width</label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={Math.round(selectedElement.width)}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { width: parseInt(e.target.value) || 10 })}
                  className="w-full text-center rounded h-7 border border-border/40 bg-slate-950/60 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[8px] text-slate-400 block uppercase mb-1">Height</label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={Math.round(selectedElement.height)}
                  onChange={(e) => updateElementOverlay(selectedElement.id, { height: parseInt(e.target.value) || 5 })}
                  className="w-full text-center rounded h-7 border border-border/40 bg-slate-950/60 text-xs text-white"
                />
              </div>
            </div>
          </div>

          {/* Delete Action button */}
          <Button
            type="button"
            onClick={() => deleteElementOverlay(selectedElement.id)}
            className="w-full rounded-xl bg-rose-600/10 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/20 text-xs font-bold py-5 flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.01] active:scale-95 transition-all shadow-lg shadow-rose-950/10 mt-6"
          >
            <Trash2 className="h-4 w-4" />
            Delete Element Layer
          </Button>
        </div>
      )}
    </div>
  );
}
