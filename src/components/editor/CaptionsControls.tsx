"use strict";
"use client";

import React, { useState } from "react";
import { Type, Sparkles, AlertCircle, FileText, Check, MessageSquare } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";

const PRESET_STYLES = [
  {
    name: "TikTok Bold",
    font: "Impact" as const,
    color: "#EAB308", // Yellow
    size: "lg" as const,
    stroke: true,
    uppercase: true,
    preset: "tiktok" as const,
  },
  {
    name: "Minimalist Sub",
    font: "Inter" as const,
    color: "#FFFFFF", // White
    size: "sm" as const,
    stroke: false,
    uppercase: false,
    preset: "minimalist" as const,
  },
  {
    name: "Classic Vlogger",
    font: "Montserrat" as const,
    color: "#22D3EE", // Cyan
    size: "md" as const,
    stroke: true,
    uppercase: true,
    preset: "classic" as const,
  },
  {
    name: "Karaoke Fire",
    font: "Arial" as const,
    color: "#4ADE80", // Green
    size: "xl" as const,
    stroke: true,
    uppercase: true,
    preset: "karaoke" as const,
  },
];

const COLOR_OPTIONS = [
  { label: "Yellow", value: "#EAB308" },
  { label: "White", value: "#FFFFFF" },
  { label: "Cyan", value: "#22D3EE" },
  { label: "Lime", value: "#4ADE80" },
  { label: "Orange", value: "#F97316" },
  { label: "Fuchsia", value: "#D946EF" },
];

const TOPIC_TEMPLATES = {
  gaming: {
    label: "🎮 Gaming",
    templates: [
      "This is officially the most insane play I have ever pulled off in a match. You won't believe how this ended.",
      "Everyone told me this build was absolute trash, but I just proved them completely wrong. Look at this.",
      "Ranking the top five hidden spots in the new season update. Make sure you save this video for later.",
      "This is why you never celebrate too early in gaming. Look at the playhead, it was a close call."
    ]
  },
  motivation: {
    label: "🧠 Motivation",
    templates: [
      "The secret to self-discipline is simple. Stop waiting for motivation and start building actual habits.",
      "If you want to achieve greatness, you have to be willing to do the hard work when nobody is watching.",
      "Your biggest competitor is not other people. It is the person you were yesterday. Focus on growth.",
      "Stop wasting your potential on things that will not matter in five years. Start taking action today."
    ]
  },
  tech: {
    label: "💻 Tech & Dev",
    templates: [
      "This new developer shortcut will literally save you hours of work. Share this with your dev friends.",
      "Here are the top three hidden AI features in Windows that you are probably not using yet. Look at this.",
      "This is how we host all our applications locally to completely avoid expensive cloud provider bills.",
      "Is this new tool going to completely replace software engineers? Let us look at what it can do."
    ]
  },
  business: {
    label: "📈 Business",
    templates: [
      "Over ninety percent of new startup ideas fail because they build something nobody actually wants.",
      "The absolute best way to scale your sales is to focus on solving a single massive pain point.",
      "Before you spend months building a product, talk to fifty customers and see if they will pay.",
      "Distributing your message where people are already paying attention is the secret to modern brand growth."
    ]
  },
  vlogs: {
    label: "📷 Vlogs",
    templates: [
      "Today I am taking you on a full tour of my new creative design studio and camera workspace gear.",
      "It took me nearly three months to hide all the cables to keep this workspace layout clean.",
      "We have custom ambient lighting, sound-treated walls, and a new high-end dual screen display.",
      "I built a space that inspires my daily editing flow and makes capturing videos seamless."
    ]
  },
  entertainment: {
    label: "🎬 Fun & Viral",
    templates: [
      "I was not expecting this to happen at all. Watch what happens when we click this button.",
      "The funniest thing just happened while we were recording. I literally cannot stop laughing at this.",
      "Here is a quick hack that sounds completely illegal but is actually perfectly fine. Look.",
      "I tried eating only viral TikTok recipes for a full week, and here are the shocking results."
    ]
  }
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

  const [activeTopic, setActiveTopic] = useState<keyof typeof TOPIC_TEMPLATES>("gaming");

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
            AI Caption Suggestions
          </h4>

          {selectedVideoClip ? (
            <div className="space-y-3">
              {/* Category selector chips */}
              <div className="flex gap-1.5 flex-wrap">
                {(Object.keys(TOPIC_TEMPLATES) as Array<keyof typeof TOPIC_TEMPLATES>).map((key) => {
                  const isActive = activeTopic === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTopic(key)}
                      className={`text-[9px] px-2.5 py-1 rounded-full border transition-all cursor-pointer font-bold ${
                        isActive
                          ? "border-violet-500 bg-violet-500/20 text-white"
                          : "border-border/40 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {TOPIC_TEMPLATES[key].label}
                    </button>
                  );
                })}
              </div>

              {/* Suggestions Templates List */}
              <div className="space-y-2">
                {TOPIC_TEMPLATES[activeTopic].templates.map((tmpl, idx) => {
                  const isApplied = selectedVideoClip.transcript === tmpl;
                  return (
                    <button
                      key={idx}
                      onClick={() => applySuggestedCaption(tmpl)}
                      className={`w-full p-2.5 rounded-lg border text-left text-[10px] transition-all relative cursor-pointer ${
                        isApplied
                          ? "border-emerald-500 bg-emerald-500/5 text-white"
                          : "border-border/10 bg-black/20 text-slate-300 hover:border-violet-500/30 hover:bg-white/5"
                      }`}
                    >
                      <span className="line-clamp-2 pr-4">{tmpl}</span>
                      {isApplied && (
                        <Check className="absolute top-2.5 right-2.5 h-3 w-3 text-emerald-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/30 bg-white/[0.01] p-4 text-center">
              <AlertCircle className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No clip selected</p>
              <p className="text-[9px] text-slate-500 mt-1">Select a video block to display custom templates.</p>
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

          {selectedVideoClip && (
            <div className="space-y-2">
              <textarea
                value={selectedVideoClip.transcript || ""}
                onChange={handleTranscriptChange}
                placeholder="Speech transcript of this clip segment. Type to add or rewrite relevant captions..."
                className="w-full h-20 rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-white placeholder-muted-foreground focus:border-violet-500 focus:outline-none resize-none font-sans leading-relaxed"
              />
            </div>
          )}
        </div>

        {/* Caption Style Presets */}
        <div className="space-y-3 pt-4 border-t border-border/20">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
            Style Presets
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_STYLES.map((preset, idx) => {
              const isActive = captionPreset === preset.preset;
              return (
                <button
                  key={idx}
                  onClick={() => applyPreset(preset)}
                  className={`p-2.5 rounded-lg border text-left text-xs font-bold transition-all relative cursor-pointer ${
                    isActive
                      ? "border-violet-500 bg-violet-600/10 text-white"
                      : "border-border/40 bg-white/5 text-slate-300 hover:border-violet-500/30 hover:bg-white/10"
                  }`}
                >
                  {preset.name}
                  {isActive && (
                    <div className="absolute top-1.5 right-1.5 h-3.5 w-3.5 rounded-full bg-violet-600 flex items-center justify-center border border-black text-white">
                      <Check className="h-2 w-2" />
                    </div>
                  )}
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
            <div className="grid grid-cols-4 gap-1.5">
              {(["Impact", "Montserrat", "Inter", "Arial"] as const).map((font) => {
                const isActive = captionFont === font;
                return (
                  <button
                    key={font}
                    onClick={() => {
                      setCaptionFont(font);
                      setCaptionPreset("classic");
                    }}
                    className={`py-1.5 px-1 rounded-lg border text-[10px] font-bold text-center transition-all cursor-pointer ${
                      isActive
                        ? "border-violet-500 bg-violet-600/10 text-white"
                        : "border-border/40 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {font}
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
