"use strict";
"use client";

import React from "react";
import { Type, Sparkles, AlertCircle, FileText, Check, MessageSquare } from "lucide-react";
import { useEditorStore, VideoClip } from "@/store/editorStore";

const PRESET_STYLES = [
  {
    name: "TikTok Pop",
    description: "One word at a time, big & bold",
    font: "Impact" as const,
    color: "#EAB308",
    size: "xl" as const,
    stroke: true,
    uppercase: true,
    preset: "tiktok" as const,
    icon: "⚡",
  },
  {
    name: "Minimalist",
    description: "Clean text, no background",
    font: "Inter" as const,
    color: "#FFFFFF",
    size: "md" as const,
    stroke: false,
    uppercase: false,
    preset: "minimalist" as const,
    icon: "✦",
  },
  {
    name: "Classic Highlight",
    description: "Rolling words with pill highlight",
    font: "Montserrat" as const,
    color: "#22D3EE",
    size: "md" as const,
    stroke: true,
    uppercase: false,
    preset: "classic" as const,
    icon: "▶",
  },
  {
    name: "Karaoke Fill",
    description: "Words fill with colour as spoken",
    font: "Arial" as const,
    color: "#F97316",
    size: "md" as const,
    stroke: true,
    uppercase: false,
    preset: "karaoke" as const,
    icon: "🎤",
  },
];

const COLOR_OPTIONS = [
  { label: "Yellow", value: "#EAB308" },
  { label: "White", value: "#FFFFFF" },
  { label: "Cyan", value: "#22D3EE" },
  { label: "Lime", value: "#4ADE80" },
  { label: "Orange", value: "#F97316" },
  { label: "Fuchsia", value: "#D946EF" },
  { label: "Sky", value: "#38BDF8" },
  { label: "Rose", value: "#FB7185" },
];

const getClipCaptionSuggestions = (clip: VideoClip) => {
  const suggestions: { label: string; text: string; description: string; type: "transcript" | "hook" | "dynamic" }[] = [];

  // 1. Spoken Transcript
  if (clip.transcript && clip.transcript.trim() !== "") {
    suggestions.push({
      label: "🎤 Original Transcript",
      text: clip.transcript,
      description: "Transcribed speech from this clip segment. Click to apply directly.",
      type: "transcript"
    });
  }

  // 2. AI Hook
  if (clip.hookText && clip.hookText.trim() !== "") {
    suggestions.push({
      label: "⚡ AI Hook Sentence",
      text: clip.hookText,
      description: "A high-retention viral hook version for short-form video algorithms.",
      type: "hook"
    });
  }

  // 3. Dynamic context-based suggestions based on title / keywords
  const title = clip.title || "Selected Clip";
  const keywordsList = clip.keywords || [];
  
  // Clean title
  const cleanTitle = title.replace(/^clip\s+\d+:\s*/i, "").trim();
  const titleLower = cleanTitle.toLowerCase();

  // Tech / Coding
  if (
    titleLower.match(/(code|program|tech|developer|software|javascript|typescript|python|html|css|bug|ide|api|github)/) ||
    keywordsList.some((k: string) => k.toLowerCase().match(/(code|program|tech|dev|software|comput|web)/))
  ) {
    suggestions.push(
      {
        label: "💡 Tech Hook",
        text: `Watch how this works: "${cleanTitle}". 💻 This shortcut will save you hours!`,
        description: "Action-oriented coding hook highlighting a value tip.",
        type: "dynamic"
      },
      {
        label: "🚀 Pro Dev Tip",
        text: `Building a better workflow using ${keywordsList.slice(0, 3).join(" & ") || "clean code"}. One line at a time.`,
        description: "Engaging tech summary mentioning key technologies.",
        type: "dynamic"
      },
      {
        label: "🧠 Developer Vibe",
        text: `How many coffees does it take to debug this? ☕ Let's find out!`,
        description: "Humorous, high-retention developer question.",
        type: "dynamic"
      }
    );
  }
  // Fitness / Gym
  else if (
    titleLower.match(/(fitness|gym|workout|run|athlet|mat|stretch|muscle|train|exercis)/) ||
    keywordsList.some((k: string) => k.toLowerCase().match(/(fit|gym|workout|train|muscle|exercis)/))
  ) {
    suggestions.push(
      {
        label: "💪 Gym Inspiration",
        text: `No excuses. Showing up for the hard work when nobody is watching. 💪`,
        description: "High-energy fitness motivation.",
        type: "dynamic"
      },
      {
        label: "🏃‍♂️ Workout Goal",
        text: `Consistency over intensity: target for today's ${keywordsList.slice(0, 2).join(" & ") || "workout"} routine.`,
        description: "Goal-oriented workout caption.",
        type: "dynamic"
      },
      {
        label: "⚡ Peak Energy",
        text: `Pushing past the limits on this one. Save this for your next session! 🏃‍♂️`,
        description: "Call-to-action fitness caption.",
        type: "dynamic"
      }
    );
  }
  // Scenery / Nature / Sunset
  else if (
    titleLower.match(/(sunset|nature|flower|mountain|sea|beach|tree|river|lake|forest|outdoor|eucalyptus|monk|waterfall)/) ||
    keywordsList.some((k: string) => k.toLowerCase().match(/(nature|scen|sun|beach|outdoor|tree)/))
  ) {
    suggestions.push(
      {
        label: "🌅 Scenery Hook",
        text: `A quick moment to appreciate this view. Nature is the best therapy. 🌸`,
        description: "Peaceful nature appreciation.",
        type: "dynamic"
      },
      {
        label: "✨ Aesthetic Vibe",
        text: `Finding peace and reflection in the details. Scenic vibes only. ✨`,
        description: "Aesthetic scenery caption.",
        type: "dynamic"
      },
      {
        label: "🍃 Mindful Moment",
        text: `Nature never rushes, yet everything is accomplished. 🍃 Take a breath.`,
        description: "Zen mindfulness citation.",
        type: "dynamic"
      }
    );
  }
  // Finance / Business
  else if (
    titleLower.match(/(finance|money|bank|piggy|business|start|startup|market|scale|sales)/) ||
    keywordsList.some((k: string) => k.toLowerCase().match(/(financ|money|busines|start|invest)/))
  ) {
    suggestions.push(
      {
        label: "💰 Wealth Formula",
        text: `Financial freedom starts with small, daily habits. 💰 Here's the key.`,
        description: "Practical wealth-building caption.",
        type: "dynamic"
      },
      {
        label: "📈 Growth Focus",
        text: `Stop trading your time for money. Focus on building assets instead. 📈`,
        description: "Strategic investment advice.",
        type: "dynamic"
      },
      {
        label: "🔥 Business Rule",
        text: `Rule #1 of startups: build something your customers will actually pay for.`,
        description: "Viral startup/product advice.",
        type: "dynamic"
      }
    );
  }
  // Default general fallback
  else {
    suggestions.push(
      {
        label: "🎥 Scene Detail",
        text: `Focusing on this segment: "${cleanTitle}". Watch what happens. ✨`,
        description: "Direct attention-grabbing hook.",
        type: "dynamic"
      },
      {
        label: "⚡ Viral Intro",
        text: `Everyone needs to pay attention to this part of the video! 😱`,
        description: "Curiosity gap viral intro.",
        type: "dynamic"
      },
      {
        label: "🌟 Focus Point",
        text: `Highlighting: ${keywordsList.slice(0, 3).join(", ") || cleanTitle}. What's your take?`,
        description: "Audience engagement question.",
        type: "dynamic"
      }
    );
  }

  return suggestions;
};

export default function CaptionsControls() {
  const {
    selectedClipId,
    selectedTrackType,
    videoClips,
    updateVideoClip,
    captionFont,
    captionColor,
    captionSize,
    captionPreset,
    captionStroke,
    captionUppercase,
    setCaptionFont,
    setCaptionColor,
    setCaptionSize,
    setCaptionPreset,
    setCaptionStroke,
    setCaptionUppercase,
  } = useEditorStore();

  const selectedVideoClip =
    selectedTrackType === "video"
      ? videoClips.find((c) => c.id === selectedClipId)
      : null;

  const handleTranscriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (selectedVideoClip) {
      updateVideoClip(selectedVideoClip.id, { transcript: e.target.value });
    }
  };

  const applyPreset = (preset: typeof PRESET_STYLES[number]) => {
    setCaptionFont(preset.font);
    setCaptionColor(preset.color);
    setCaptionSize(preset.size);
    setCaptionPreset(preset.preset);
    setCaptionStroke(preset.stroke);
    setCaptionUppercase(preset.uppercase);
  };

  const applySuggestedCaption = (text: string) => {
    if (selectedVideoClip) {
      updateVideoClip(selectedVideoClip.id, { transcript: text });
      console.log("AuraClip: Applied suggested caption:", text);
    }
  };

  // Generate dynamic suggestions based on active clip details
  const suggestions = selectedVideoClip ? getClipCaptionSuggestions(selectedVideoClip) : [];

  return (
    <div className="bg-slate-950/60 border border-border/40 rounded-xl p-5 flex flex-col gap-6 shadow-2xl h-full justify-between overflow-y-auto max-h-[600px] custom-scrollbar">
      <div className="space-y-6">
        
        {/* Panel Header */}
        <div className="flex items-center gap-2 border-b border-border/40 pb-3">
          <Type className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white tracking-tight">Captions & Subtitles</h3>
        </div>

        {/* AI Suggestions Box */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-400 animate-pulse" />
            AI Clip Suggestions
          </h4>

          {selectedVideoClip ? (
            <div className="space-y-2.5">
              {suggestions.map((sug, idx) => {
                const isApplied = selectedVideoClip.transcript === sug.text;
                return (
                  <div
                    key={idx}
                    onClick={() => applySuggestedCaption(sug.text)}
                    className={`group relative p-3.5 rounded-xl border text-left transition-all cursor-pointer overflow-hidden ${
                      isApplied
                        ? "border-violet-500 bg-violet-600/10 shadow-lg shadow-violet-900/10"
                        : "border-border/30 bg-slate-900/40 hover:border-violet-500/40 hover:bg-slate-900/60"
                    }`}
                  >
                    {/* Decorative background glow for active */}
                    {isApplied && (
                      <div className="absolute -top-10 -right-10 w-20 h-20 bg-violet-600/20 rounded-full blur-xl pointer-events-none" />
                    )}
                    
                    <div className="flex justify-between items-start gap-2 mb-1.5">
                      <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded tracking-wider ${
                        sug.type === "transcript"
                          ? "bg-violet-500/20 text-violet-300 border border-violet-500/20"
                          : sug.type === "hook"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/20"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/20"
                      }`}>
                        {sug.label}
                      </span>
                      {isApplied && (
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-white font-semibold leading-relaxed pr-2">
                      {sug.text}
                    </p>

                    <p className="text-[9px] text-muted-foreground mt-2 font-normal leading-normal">
                      {sug.description}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/30 bg-white/[0.01] p-4 text-center">
              <AlertCircle className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground font-semibold">No scene clip selected</p>
              <p className="text-[9px] text-slate-500 mt-1">Select a video block in the timeline below to generate captions.</p>
            </div>
          )}
        </div>

        {/* Transcript Editor Box */}
        <div className="space-y-3 pt-4 border-t border-border/20">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              Edit Subtitles Text
            </h4>
          </div>

          {selectedVideoClip ? (
            <div className="space-y-2">
              <textarea
                value={selectedVideoClip.transcript || ""}
                onChange={handleTranscriptChange}
                placeholder="Speech transcript of this clip segment. Type to add or rewrite relevant captions..."
                className="w-full h-20 rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white placeholder-muted-foreground focus:border-violet-500 focus:outline-none resize-none font-sans leading-relaxed"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/30 bg-white/[0.01] p-4 text-center">
              <p className="text-[9px] text-slate-500">Select a clip to edit its text.</p>
            </div>
          )}
        </div>

        {/* Caption Style Presets */}
        <div className="space-y-3 pt-4 border-t border-border/20">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
            Caption Style
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_STYLES.map((preset, idx) => {
              const isActive = captionPreset === preset.preset;
              return (
                <button
                  key={idx}
                  onClick={() => applyPreset(preset)}
                  className={`p-3 rounded-xl border text-left font-bold transition-all relative cursor-pointer flex flex-col gap-1.5 ${
                    isActive
                      ? "border-violet-500 bg-violet-600/15 text-white shadow-lg shadow-violet-900/20"
                      : "border-border/40 bg-white/5 text-slate-300 hover:border-violet-500/30 hover:bg-white/10"
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-[11px] font-extrabold truncate max-w-[80%]">
                      {preset.icon} {preset.name}
                    </span>
                    {isActive && (
                      <span className="h-3.5 w-3.5 rounded-full bg-violet-600 flex items-center justify-center border border-black text-white shrink-0">
                        <Check className="h-2 w-2" />
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-slate-500 font-normal leading-tight">{preset.description}</p>
                  {/* Visual preview */}
                  <div className="h-8 rounded-lg bg-black/60 border border-white/5 flex items-center justify-center overflow-hidden w-full shrink-0">
                    <span
                      style={{
                        fontFamily: preset.font === "Impact" ? "Impact, Charcoal, sans-serif" : preset.font,
                        color: preset.color,
                        textTransform: preset.uppercase ? "uppercase" : "none",
                        textShadow: preset.stroke ? "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000" : "0 2px 6px rgba(0,0,0,0.9)",
                        fontSize: "10px",
                        fontWeight: 900,
                        letterSpacing: preset.preset === "tiktok" ? "0.04em" : "0.01em",
                      }}
                    >
                      {preset.preset === "tiktok" ? "WORD" : preset.preset === "karaoke" ? "Fill ▶ Color" : "Sample Caption"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Caption Style Customizers */}
        <div className="space-y-4 pt-4 border-t border-border/20">
          <h4 className="text-xs font-semibold text-slate-300">Style Customization</h4>
          
          {/* Font choice */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground font-bold uppercase block">
              Font Family
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { id: "Impact", label: "Impact", style: { fontFamily: "Impact, Charcoal, sans-serif", fontWeight: 900 } },
                { id: "Montserrat", label: "Montserrat", style: { fontFamily: "'Montserrat', sans-serif", fontWeight: 800 } },
                { id: "Inter", label: "Inter", style: { fontFamily: "'Inter', sans-serif", fontWeight: 700 } },
                { id: "Arial", label: "Arial", style: { fontFamily: "Arial, sans-serif", fontWeight: 700 } },
              ] as const).map(({ id, label, style }) => {
                const isActive = captionFont === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      setCaptionFont(id);
                      setCaptionPreset("classic");
                    }}
                    className={`py-2 px-2 rounded-lg border text-[10px] text-center transition-all cursor-pointer flex items-center justify-center ${
                      isActive
                        ? "border-violet-500 bg-violet-600/10 text-white"
                        : "border-border/40 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <span style={{ ...style, fontSize: "11px" }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color palette options */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground font-bold uppercase block">
              Highlight Color
            </label>
            <div className="flex gap-2.5 items-center flex-wrap">
              {COLOR_OPTIONS.map((opt) => {
                const isActive = captionColor === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setCaptionColor(opt.value);
                      setCaptionPreset("classic");
                    }}
                    style={{ backgroundColor: opt.value }}
                    className={`h-6 w-6 rounded-full border-2 transition-transform active:scale-90 relative cursor-pointer ${
                      isActive ? "border-violet-500 scale-110 shadow-md" : "border-black/50 hover:scale-105"
                    }`}
                    title={opt.label}
                  >
                    {isActive && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Check className={`h-3.5 w-3.5 ${opt.label === "White" ? "text-black" : "text-white"}`} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sizing selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground font-bold uppercase block">
              Sizing
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["sm", "md", "lg", "xl"] as const).map((sz) => {
                const isActive = captionSize === sz;
                return (
                  <button
                    key={sz}
                    onClick={() => {
                      setCaptionSize(sz);
                      setCaptionPreset("classic");
                    }}
                    className={`py-1 rounded-lg border text-[10px] font-bold text-center uppercase transition-all cursor-pointer ${
                      isActive
                        ? "border-violet-500 bg-violet-600/10 text-white"
                        : "border-border/40 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {sz}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subtitles details switches */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between bg-white/[0.02] border border-border/20 rounded-lg p-2 px-3">
              <span className="text-[10px] font-bold uppercase text-slate-300">Uppercase</span>
              <input
                type="checkbox"
                checked={captionUppercase}
                onChange={(e) => {
                  setCaptionUppercase(e.target.checked);
                  setCaptionPreset("classic");
                }}
                className="h-3.5 w-3.5 rounded border-border/40 accent-violet-600 cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between bg-white/[0.02] border border-border/20 rounded-lg p-2 px-3">
              <span className="text-[10px] font-bold uppercase text-slate-300">Text Stroke</span>
              <input
                type="checkbox"
                checked={captionStroke}
                onChange={(e) => {
                  setCaptionStroke(e.target.checked);
                  setCaptionPreset("classic");
                }}
                className="h-3.5 w-3.5 rounded border-border/40 accent-violet-600 cursor-pointer"
              />
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
