"use strict";
"use client";

import React, { useRef, useState, useEffect } from "react";
import { Play, Pause, RefreshCw, Type, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThumbnailGeneratorProps {
  videoUrl: string;
  onSave: (dataUrl: string) => void;
}

export default function ThumbnailGenerator({ videoUrl, onSave }: ThumbnailGeneratorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // States
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1);

  // Styling States
  const [textLine1, setTextLine1] = useState("VIRAL TRUTH!");
  const [textLine2, setTextLine2] = useState("DON'T MISS THIS");
  const [textColor, setTextColor] = useState("#FBBF24"); // Yellow
  const [bannerColor] = useState("rgba(0, 0, 0, 0.75)");
  const [fontFamily, setFontFamily] = useState("Impact");
  const [textPosition, setTextPosition] = useState<"top" | "center" | "bottom">("center");

  // Re-draw Canvas overlay
  const drawFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Matches internal width/height to standard horizontal 16:9 ratio
    canvas.width = 1280;
    canvas.height = 720;

    // 1. Draw raw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 2. Draw styled overlay texts
    ctx.save();
    
    // Choose font family
    const fontStr = fontFamily === "Impact"
      ? "bold 70px Impact, sans-serif"
      : fontFamily === "Montserrat"
      ? "bold 58px 'Montserrat', sans-serif"
      : "bold 52px Arial, sans-serif";

    ctx.font = fontStr;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Set position offset
    let yOffset = canvas.height / 2;
    if (textPosition === "top") {
      yOffset = canvas.height * 0.25;
    } else if (textPosition === "bottom") {
      yOffset = canvas.height * 0.75;
    }

    // Measure text widths
    const metrics1 = ctx.measureText(textLine1.toUpperCase());
    const metrics2 = ctx.measureText(textLine2.toUpperCase());

    const maxW = Math.max(metrics1.width, metrics2.width) + 60;
    const lineSpacing = 85;

    // Draw background banner box for contrast
    if (bannerColor && (textLine1.trim() || textLine2.trim())) {
      ctx.fillStyle = bannerColor;
      const boxHeight = (textLine1.trim() && textLine2.trim()) ? lineSpacing * 2 + 30 : lineSpacing + 30;
      ctx.fillRect(
        canvas.width / 2 - maxW / 2,
        yOffset - boxHeight / 2,
        maxW,
        boxHeight
      );
    }

    // Draw Line 1
    if (textLine1.trim()) {
      const line1Y = textLine2.trim() ? yOffset - lineSpacing / 2 : yOffset;
      
      // Shadow stroke
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 10;
      ctx.strokeText(textLine1.toUpperCase(), canvas.width / 2, line1Y);

      // Text fill
      ctx.fillStyle = textColor;
      ctx.fillText(textLine1.toUpperCase(), canvas.width / 2, line1Y);
    }

    // Draw Line 2
    if (textLine2.trim()) {
      const line2Y = textLine1.trim() ? yOffset + lineSpacing / 2 : yOffset;
      
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 10;
      ctx.strokeText(textLine2.toUpperCase(), canvas.width / 2, line2Y);

      ctx.fillStyle = "#FFFFFF"; // Second line defaults to white for high contrast
      ctx.fillText(textLine2.toUpperCase(), canvas.width / 2, line2Y);
    }

    ctx.restore();
  };

  // Re-draw preview when text/time changes
  useEffect(() => {
    drawFrame();
  }, [currentTime, textLine1, textLine2, textColor, bannerColor, textPosition, fontFamily]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(console.error);
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleApply = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      // Export canvas as high-quality image URL
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      onSave(dataUrl);
    }
  };

  return (
    <div className="space-y-4">
      {/* Video element (hidden/small for decoding, or visible to seek) */}
      <div className="relative aspect-video w-full bg-black rounded-lg overflow-hidden border border-border/20">
        <video
          ref={videoRef}
          src={videoUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          className="absolute inset-0 h-full w-full object-contain pointer-events-none opacity-0"
          muted
          playsInline
        />
        {/* Render Preview Canvas directly */}
        <canvas ref={canvasRef} className="h-full w-full object-contain z-10" />
      </div>

      {/* Scrub and Playhead controls */}
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="ghost"
          onClick={togglePlay}
          className="h-8 w-8 rounded-lg hover:bg-white/5"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
        </Button>
        <input
          type="range"
          min="0"
          max={duration}
          step="0.05"
          value={currentTime}
          onChange={handleSeek}
          className="flex-grow h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-rose-500"
        />
        <span className="text-[10px] font-mono text-muted-foreground">
          {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
        </span>
      </div>

      {/* Overlay custom text configurations */}
      <div className="space-y-3.5 bg-slate-950/20 border border-border/20 rounded-xl p-4">
        <h4 className="text-[11px] font-bold text-white flex items-center gap-1.5">
          <Type className="h-3.5 w-3.5 text-rose-400" />
          Clickbait Text & Overlay Settings
        </h4>

        <div className="grid grid-cols-2 gap-3.5">
          <div className="space-y-1">
            <label className="text-[9px] font-semibold text-slate-400">Line 1 Text (Viral hook)</label>
            <input
              type="text"
              value={textLine1}
              onChange={(e) => setTextLine1(e.target.value)}
              className="w-full h-8.5 rounded-lg border border-border/40 bg-slate-950/40 px-2.5 text-xs text-white focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-semibold text-slate-400">Line 2 Text (Action hook)</label>
            <input
              type="text"
              value={textLine2}
              onChange={(e) => setTextLine2(e.target.value)}
              className="w-full h-8.5 rounded-lg border border-border/40 bg-slate-950/40 px-2.5 text-xs text-white focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[9px] font-semibold text-slate-400">Font Theme</label>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="w-full h-8 rounded-lg border border-border/40 bg-slate-900 text-xs text-white focus:outline-none"
            >
              <option value="Impact">Impact (Bold Bold)</option>
              <option value="Montserrat">Montserrat</option>
              <option value="Arial">Sans Serif</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-semibold text-slate-400">Text Position</label>
            <select
              value={textPosition}
              onChange={(e) => setTextPosition(e.target.value as any)}
              className="w-full h-8 rounded-lg border border-border/40 bg-slate-900 text-xs text-white focus:outline-none"
            >
              <option value="top">Top Segment</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom Segment</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-semibold text-slate-400 font-medium">Text Color</label>
            <div className="flex gap-2.5 pt-1.5">
              <button
                type="button"
                onClick={() => setTextColor("#FBBF24")}
                className={`h-4.5 w-4.5 rounded-full bg-yellow-400 border ${
                  textColor === "#FBBF24" ? "border-white scale-110" : "border-transparent"
                }`}
              />
              <button
                type="button"
                onClick={() => setTextColor("#EF4444")}
                className={`h-4.5 w-4.5 rounded-full bg-red-500 border ${
                  textColor === "#EF4444" ? "border-white scale-110" : "border-transparent"
                }`}
              />
              <button
                type="button"
                onClick={() => setTextColor("#FFFFFF")}
                className={`h-4.5 w-4.5 rounded-full bg-white border ${
                  textColor === "#FFFFFF" ? "border-white scale-110" : "border-transparent"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action triggers */}
      <div className="flex justify-end gap-2.5">
        <Button
          type="button"
          onClick={drawFrame}
          className="h-8 px-4 text-xs font-bold bg-white/5 border border-border/30 hover:bg-white/10 rounded-xl"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh Frame
        </Button>
        <Button
          type="button"
          onClick={handleApply}
          className="h-8 px-6 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white rounded-xl"
        >
          <Eye className="h-3 w-3 mr-1" />
          Apply & Save Image
        </Button>
      </div>

    </div>
  );
}
