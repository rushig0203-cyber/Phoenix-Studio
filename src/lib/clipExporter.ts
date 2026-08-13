import { getFFmpeg, toSafeBlob } from "./ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { VideoClip, AudioClip, ElementOverlay } from "@/store/editorStore";

export type ExportProgress = (percent: number, message: string) => void;

export interface SubtitleStyle {
  fontFamily: "Impact" | "Montserrat" | "Inter" | "Arial";
  color: string;
  size: "sm" | "md" | "lg" | "xl";
  stroke: boolean;
  uppercase: boolean;
  preset?: "tiktok" | "classic" | "minimalist" | "karaoke";
}

// Convert Hex Color (#RRGGBB) to ASS subtitle format (&H00BBGGRR)
function hexToAssColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "&H00FFFFFF";
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  return `&H00${b}${g}${r}`;
}

// Format seconds into SRT time format (HH:MM:SS,mmm)
function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, "0");
  return `${h}:${m}:${s},${ms}`;
}

// Generate SRT content from raw transcript text distributed evenly over the duration
function generateSrt(transcript: string, duration: number): string {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const wordsPerSub = 4;
  const subs: string[] = [];
  const totalSubtitles = Math.ceil(words.length / wordsPerSub);
  const timePerSub = duration / totalSubtitles;

  for (let i = 0; i < totalSubtitles; i++) {
    const start = i * timePerSub;
    const end = Math.min((i + 1) * timePerSub, duration);
    const startStr = formatSrtTime(start);
    const endStr = formatSrtTime(end);
    const subText = words.slice(i * wordsPerSub, (i + 1) * wordsPerSub).join(" ");

    subs.push(`${i + 1}`);
    subs.push(`${startStr} --> ${endStr}`);
    subs.push(subText);
    subs.push("");
  }
  return subs.join("\n");
}

// Generate premium ASS subtitles matching visual presets (TikTok, Minimalist, Karaoke, Classic)
function generateAss(
  transcript: string,
  duration: number,
  style?: SubtitleStyle
): string {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const fontFamily = style?.fontFamily || "Arial";
  const preset = style?.preset || "classic";
  const uppercase = style?.uppercase ?? true;
  const stroke = style?.stroke ?? true;

  const fontName = fontFamily === "Impact" ? "Impact" :
                   fontFamily === "Montserrat" ? "Montserrat" :
                   fontFamily === "Inter" ? "Inter" : "Arial";

  // Base font size mapped to 1080p height (standard Reels size)
  let fontSize = 48;
  if (style?.size === "sm") fontSize = 38;
  if (style?.size === "lg") fontSize = 58;
  if (style?.size === "xl") fontSize = 72;

  const primaryAssColor = style?.color ? hexToAssColor(style.color) : "&H0008B3EA"; // Active color (BGR)
  const baseAssColor = "&H00FFFFFF"; // Inactive color (White)
  const outlineAssColor = "&H00000000"; // Black outline
  const backAssColor = "&H80000000"; // Translucent black shadow

  const outline = stroke ? 4 : 0;
  const shadow = stroke ? 2 : 1;
  const borderStyle = 1; // 1 = outline + drop shadow

  const alignment = 2; // Bottom Center
  const marginV = 280; // Elevated bottom safe zone to prevent overlap with Instagram UI

  const lines: string[] = [];
  lines.push("[Script Info]");
  lines.push("Title: AuraClip Premium Subtitles");
  lines.push("ScriptType: v4.00+");
  lines.push("PlayResX: 1920");
  lines.push("PlayResY: 1080");
  lines.push("WrapStyle: 0");
  lines.push("ScaledBorderAndShadow: yes");
  lines.push("");

  lines.push("[V4+ Styles]");
  lines.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, Strikeout, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
  lines.push(`Style: Default,${fontName},${fontSize},${baseAssColor},${primaryAssColor},${outlineAssColor},${backAssColor},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},10,10,${marginV},1`);
  lines.push("");

  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  const wordDuration = duration / words.length;

  const formatAssTime = (secs: number): string => {
    const h = Math.floor(secs / 3600).toString().padStart(1, "0");
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(secs % 60).toString().padStart(2, "0");
    const cs = Math.floor((secs % 1) * 100).toString().padStart(2, "0");
    return `${h}:${m}:${s}.${cs}`;
  };

  if (preset === "tiktok") {
    // One word at a time, very big and bold in the highlight color
    for (let i = 0; i < words.length; i++) {
      const start = i * wordDuration;
      const end = (i + 1) * wordDuration;
      let word = words[i];
      if (uppercase) word = word.toUpperCase();
      
      const wordText = `{\\fs${Math.round(fontSize * 1.35)}\\c${primaryAssColor}}${word}`;
      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${wordText}`);
    }
  } else if (preset === "minimalist") {
    // Rolling 7-word window, clean, highlighting the active word
    const windowSize = 7;
    for (let i = 0; i < words.length; i++) {
      const start = i * wordDuration;
      const end = (i + 1) * wordDuration;

      const startIdx = Math.max(0, Math.min(i - 3, words.length - windowSize));
      const endIdx = Math.min(startIdx + windowSize, words.length);

      const sentenceWords = words.slice(startIdx, endIdx).map((w, idx) => {
        const absIdx = startIdx + idx;
        let formattedWord = w;
        if (uppercase) formattedWord = formattedWord.toUpperCase();

        if (absIdx === i) {
          return `{\\c${primaryAssColor}}${formattedWord}{\\c${baseAssColor}}`;
        }
        return formattedWord;
      });

      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${sentenceWords.join(" ")}`);
    }
  } else if (preset === "karaoke") {
    // Karaoke Mode: Words color left-to-right
    const LINE_SIZE = 8;
    for (let i = 0; i < words.length; i++) {
      const start = i * wordDuration;
      const end = (i + 1) * wordDuration;

      const lineStart = Math.floor(i / LINE_SIZE) * LINE_SIZE;
      const lineWords = words.slice(lineStart, lineStart + LINE_SIZE).map((w, idx) => {
        const absIdx = lineStart + idx;
        let formattedWord = w;
        if (uppercase) formattedWord = formattedWord.toUpperCase();

        if (absIdx <= i) {
          return `{\\c${primaryAssColor}}${formattedWord}{\\c${baseAssColor}}`;
        } else {
          return `{\\1a&H70&}${formattedWord}{\\1a&H00&}`; // 40% opaque white
        }
      });

      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${lineWords.join(" ")}`);
    }
  } else {
    // Classic rolling 5-word window
    const windowSize = 5;
    for (let i = 0; i < words.length; i++) {
      const start = i * wordDuration;
      const end = (i + 1) * wordDuration;

      const startIdx = Math.max(0, Math.min(i - 2, words.length - windowSize));
      const endIdx = Math.min(startIdx + windowSize, words.length);

      const sentenceWords = words.slice(startIdx, endIdx).map((w, idx) => {
        const absIdx = startIdx + idx;
        let formattedWord = w;
        if (uppercase) formattedWord = formattedWord.toUpperCase();

        if (absIdx === i) {
          return `{\\c${primaryAssColor}}${formattedWord}{\\c${baseAssColor}}`;
        }
        return formattedWord;
      });

      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${sentenceWords.join(" ")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Export a single clip from a video file.
 * Trims the video to the specified time range and returns a downloadable Blob.
 */
export async function exportClip(
  videoFile: File,
  startTime: number,
  endTime: number,
  clipTitle: string,
  onProgress?: ExportProgress,
  options?: {
    burnCaptions?: boolean;
    transcript?: string;
    style?: SubtitleStyle;
  }
): Promise<Blob> {
  onProgress?.(5, "Loading video encoder...");

  const ffmpeg = await getFFmpeg();
  const outputName = "clip_output.mp4";

  const mountId = `work_${Math.random().toString(36).substring(2, 9)}`;
  const mountDir = `/${mountId}`;

  onProgress?.(15, "Preparing video data (mounting)...");

  try {
    // Mount the video file directly into the Web Worker filesystem without reading it into memory
    await ffmpeg.createDir(mountDir);
    await ffmpeg.mount("WORKERFS" as any, {
      blobs: [{ name: "input.mp4", data: videoFile }]
    }, mountDir);

    onProgress?.(30, "Trimming clip...");

    // Format timestamps for FFmpeg
    const startStr = formatFFmpegTime(startTime);
    const durationStr = formatFFmpegTime(endTime - startTime);
    const inputPath = `${mountDir}/input.mp4`;

    const burn = options?.burnCaptions && options?.transcript;
    let execArgs: string[] = [];

    if (burn) {
      const assText = generateAss(options.transcript!, endTime - startTime, options.style);
      await ffmpeg.writeFile("subtitles.ass", new TextEncoder().encode(assText));

      execArgs = [
        "-ss", startStr,
        "-i", inputPath,
        "-t", durationStr,
        "-vf", "subtitles=subtitles.ass",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "aac",
        "-b:a", "192k",
        "-strict", "-2",
        "-avoid_negative_ts", "make_zero",
        "-y",
        outputName,
      ];
    } else {
      execArgs = [
        "-ss", startStr,
        "-i", inputPath,
        "-t", durationStr,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-strict", "-2",
        "-avoid_negative_ts", "make_zero",
        "-y",
        outputName,
      ];
    }

    // Execute clip extraction
    await ffmpeg.exec(execArgs);

    onProgress?.(80, "Packaging output...");

    // Read the output file
    const outputData = await ffmpeg.readFile(outputName);
    const data = outputData as Uint8Array;

    const blob = toSafeBlob(data, "video/mp4");

    onProgress?.(100, "Export complete!");

    return blob;
  } finally {
    // Cleanup virtual filesystem
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {}
    try {
      await ffmpeg.deleteFile("subtitles.ass");
    } catch {}
    try {
      await ffmpeg.unmount(mountDir);
      await ffmpeg.deleteDir(mountDir);
    } catch {}
  }
}

export async function saveToLocalFolder(
  blob: Blob,
  fileName: string,
  projectId: string,
  clipNumber?: number,
  isCompilation: boolean = false
): Promise<void> {
  try {
    const formData = new FormData();
    formData.append("file", blob, fileName);
    formData.append("fileName", fileName);
    if (clipNumber !== undefined) {
      formData.append("clipNumber", String(clipNumber));
    }
    if (isCompilation) {
      formData.append("isCompilation", "true");
    }

    await fetch(`/api/projects/${projectId}/save-local`, {
      method: "POST",
      body: formData,
    });
    console.log("AuraClip: Copy saved to local workspace folder.");
  } catch (err) {
    console.error("AuraClip: Failed to auto-save to local workspace folder:", err);
  }
}

/**
 * Export a clip and trigger browser download.
 */
export async function downloadClip(
  videoFile: File,
  startTime: number,
  endTime: number,
  clipTitle: string,
  onProgress?: ExportProgress,
  projectId?: string | null,
  clipNumber?: number,
  options?: {
    burnCaptions?: boolean;
    transcript?: string;
    style?: SubtitleStyle;
  }
): Promise<void> {
  const blob = await exportClip(videoFile, startTime, endTime, clipTitle, onProgress, options);

  const fileName = `${sanitizeFileName(clipTitle)}.mp4`;

  // Trigger local save if projectId is provided
  if (projectId) {
    saveToLocalFolder(blob, fileName, projectId, clipNumber, false).catch(console.error);
  }

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Cleanup after a delay
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Format seconds to HH:MM:SS.mmm for FFmpeg */
function formatFFmpegTime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${h}:${m}:${s}`;
}

/** Sanitize a string for use as a filename */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-_]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 50)
    || "auraclip_export";
}

/**
 * Stitch video segments and mix background audio tracks into a final compiled media file.
 */
function getVideoResolution(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720 });
    };
    video.onerror = () => {
      resolve({ width: 1280, height: 720 });
    };
    video.src = URL.createObjectURL(file);
  });
}

async function renderOverlayToPng(
  overlay: any,
  videoWidth: number,
  videoHeight: number
): Promise<Uint8Array> {
  const w_px = Math.round((overlay.width * videoWidth) / 100);
  const h_px = Math.round((overlay.height * videoHeight) / 100);

  const canvas = document.createElement("canvas");
  canvas.width = w_px;
  canvas.height = h_px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context");

  ctx.globalAlpha = overlay.opacity;

  if (overlay.type === "text") {
    if (overlay.backgroundColor && overlay.backgroundColor !== "transparent") {
      ctx.fillStyle = overlay.backgroundColor;
      ctx.fillRect(0, 0, w_px, h_px);
    }

    const fontSize_px = Math.round((overlay.fontSize || 16) * (videoHeight / 360));
    const fontFamily = overlay.fontFamily === "Impact" ? "Impact, Charcoal, sans-serif" :
                       overlay.fontFamily === "Montserrat" ? "'Montserrat', sans-serif" :
                       overlay.fontFamily === "Inter" ? "'Inter', sans-serif" : "Arial, sans-serif";
    ctx.font = `bold ${fontSize_px}px ${fontFamily}`;
    ctx.fillStyle = overlay.color || "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const wrapText = (text: string, maxWidth: number): string[] => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let currentLine = words[0] || "";

      for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
          currentLine += " " + word;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }
      return lines;
    };

    const lines = wrapText(overlay.text || "", w_px * 0.9);
    const lineHeight = fontSize_px * 1.2;
    const totalHeight = lines.length * lineHeight;
    let startY = (h_px - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line) => {
      if (overlay.color === "#FF00FF") {
        ctx.shadowColor = "#FF00FF";
        ctx.shadowBlur = fontSize_px * 0.3;
        ctx.fillText(line, w_px / 2, startY);
        ctx.shadowBlur = 0;
      } else if (overlay.color === "#FFCC00") {
        ctx.fillStyle = "#990000";
        ctx.fillText(line, w_px / 2 + 2, startY + 2);
        ctx.fillStyle = overlay.color;
      }
      ctx.fillText(line, w_px / 2, startY);
      startY += lineHeight;
    });
  } else if (overlay.type === "shape") {
    const fill = overlay.color || "#8B5CF6";
    ctx.fillStyle = fill;

    if (overlay.shapeType === "circle") {
      ctx.beginPath();
      ctx.arc(w_px / 2, h_px / 2, Math.min(w_px, h_px) / 2, 0, 2 * Math.PI);
      ctx.fill();
    } else if (overlay.shapeType === "arrow") {
      ctx.beginPath();
      ctx.moveTo(0, h_px * 0.4);
      ctx.lineTo(w_px * 0.6, h_px * 0.4);
      ctx.lineTo(w_px * 0.6, h_px * 0.2);
      ctx.lineTo(w_px, h_px * 0.5);
      ctx.lineTo(w_px * 0.6, h_px * 0.8);
      ctx.lineTo(w_px * 0.6, h_px * 0.6);
      ctx.lineTo(0, h_px * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (overlay.shapeType === "star") {
      const cx = w_px / 2;
      const cy = h_px / 2;
      const spikes = 5;
      const outerRadius = Math.min(w_px, h_px) / 2;
      const innerRadius = outerRadius * 0.4;
      let rot = (Math.PI / 2) * 3;
      let x = cx;
      let y = cy;
      const step = Math.PI / spikes;

      ctx.beginPath();
      ctx.moveTo(cx, cy - outerRadius);
      for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
      }
      ctx.lineTo(cx, cy - outerRadius);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, w_px, h_px);
    }
  } else if (overlay.type === "image") {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = overlay.imageUrl!;
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    ctx.drawImage(img, 0, 0, w_px, h_px);
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas toBlob failed"));
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(new Uint8Array(reader.result as ArrayBuffer));
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    }, "image/png");
  });
}

export async function exportTimeline(
  videoFile: File,
  videoClips: VideoClip[],
  audioClips: AudioClip[],
  elementOverlays: ElementOverlay[] = [],
  onProgress?: ExportProgress,
  options?: {
    burnCaptions?: boolean;
    style?: SubtitleStyle;
    duckAudio?: boolean;
  }
): Promise<Blob> {
  if (videoClips.length === 0) {
    throw new Error("No video clips on timeline to export.");
  }

  onProgress?.(5, "Loading video encoder...");
  const ffmpeg = await getFFmpeg();
  const outputName = "timeline_output.mp4";

  const mountId = `work_${Math.random().toString(36).substring(2, 9)}`;
  const mountDir = `/${mountId}`;

  onProgress?.(10, "Preparing source video data (mounting)...");
  
  try {
    // Mount the video file directly into the Web Worker filesystem without reading it into memory
    await ffmpeg.createDir(mountDir);
    await ffmpeg.mount("WORKERFS" as any, {
      blobs: [{ name: "input.mp4", data: videoFile }]
    }, mountDir);

    const inputPath = `${mountDir}/input.mp4`;

    // 1. Slice each video clip segment
    const clipFiles: string[] = [];
    for (let i = 0; i < videoClips.length; i++) {
      const clip = videoClips[i];
      const progressPercent = 10 + Math.floor((i / videoClips.length) * 40);
      onProgress?.(progressPercent, `Slicing segment ${i + 1} of ${videoClips.length}...`);

      const partName = `part_${i}.mp4`;
      const startStr = formatFFmpegTime(clip.startTime);
      const durationStr = formatFFmpegTime(clip.duration);

      const burn = options?.burnCaptions && clip.transcript;
      if (burn) {
        const assText = generateAss(clip.transcript!, clip.duration, options?.style);
        const assName = `subs_${i}.ass`;

        await ffmpeg.writeFile(assName, new TextEncoder().encode(assText));

        await ffmpeg.exec([
          "-ss", startStr,
          "-i", inputPath,
          "-t", durationStr,
          "-vf", `subtitles=${assName}`,
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-c:a", "aac",
          "-b:a", "192k",
          "-strict", "-2",
          "-avoid_negative_ts", "make_zero",
          "-y",
          partName,
        ]);

        try {
          await ffmpeg.deleteFile(assName);
        } catch {}
      } else {
        await ffmpeg.exec([
          "-ss", startStr,
          "-i", inputPath,
          "-t", durationStr,
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-strict", "-2",
          "-avoid_negative_ts", "make_zero",
          "-y",
          partName,
        ]);
      }
      clipFiles.push(partName);
    }

    onProgress?.(60, "Stitching video segments together...");
    // Write concat file
    const concatContent = clipFiles.map((file) => `file ${file}`).join("\n");
    await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatContent));

    // Stitch clips
    const stitchedName = "stitched_temp.mp4";
    await ffmpeg.exec([
      "-f", "concat",
      "-safe", "0",
      "-i", "concat.txt",
      "-c", "copy",
      "-y",
      stitchedName,
    ]);

    // Clean up temporary clip files
    for (const file of clipFiles) {
      try {
        await ffmpeg.deleteFile(file);
      } catch {}
    }
    try {
      await ffmpeg.deleteFile("concat.txt");
    } catch {}

    // 1.5 Apply element overlays if present
    let overlayStitchedName = stitchedName;
    if (elementOverlays.length > 0) {
      onProgress?.(65, "Rendering canvas overlays...");
      const { width: W, height: H } = await getVideoResolution(videoFile);
      
      const overlayFiles: string[] = [];
      const overlayInputs: string[] = [];
      const filterParts: string[] = [];

      for (let i = 0; i < elementOverlays.length; i++) {
        const overlay = elementOverlays[i];
        const pngName = `overlay_element_${i}.png`;
        const pngBuffer = await renderOverlayToPng(overlay, W, H);
        await ffmpeg.writeFile(pngName, pngBuffer);
        
        overlayFiles.push(pngName);
        overlayInputs.push("-i", pngName);

        const x_px = Math.round((overlay.x * W) / 100);
        const y_px = Math.round((overlay.y * H) / 100);
        const inputIdx = i + 1; // 0 is stitched video
        const prevLabel = i === 0 ? "0:v" : `[v${i}]`;
        const nextLabel = i === elementOverlays.length - 1 ? "[vout]" : `[v${i + 1}]`;

        filterParts.push(`${prevLabel}[${inputIdx}:v]overlay=x=${x_px}:y=${y_px}:enable='between(t,${overlay.playStartTime},${overlay.playStartTime + overlay.duration})'${nextLabel}`);
      }

      overlayStitchedName = "stitched_overlays.mp4";
      const filterComplexStr = filterParts.join(";");

      await ffmpeg.exec([
        "-i", stitchedName,
        ...overlayInputs,
        "-filter_complex", filterComplexStr,
        "-map", "[vout]",
        "-map", "0:a?", // Map audio if present
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "copy",
        "-y",
        overlayStitchedName,
      ]);

      // Clean up overlay png files
      for (const name of overlayFiles) {
        try {
          await ffmpeg.deleteFile(name);
        } catch {}
      }
    }

    // 2. Mix audio files if any are present
    const activeAudioClips = audioClips.filter((c) => !c.isMuted && c.volume > 0);
    if (activeAudioClips.length === 0) {
      onProgress?.(90, "Finalizing export...");
      const data = (await ffmpeg.readFile(overlayStitchedName)) as Uint8Array;
      const blob = toSafeBlob(data, "video/mp4");

      try {
        await ffmpeg.deleteFile(stitchedName);
      } catch {}
      if (overlayStitchedName !== stitchedName) {
        try {
          await ffmpeg.deleteFile(overlayStitchedName);
        } catch {}
      }

      onProgress?.(100, "Export complete!");
      return blob;
    }

    onProgress?.(70, "Processing audio tracks...");
    // Write audio files to virtual FS and prepare inputs/filter complex
    const audioInputs: string[] = [];
    const filterParts: string[] = [];
    const amixInputsStringList: string[] = [];
    
    let duckExpr = "";
    if (options?.duckAudio && videoClips.length > 0) {
      // Calculate start times of sequential clips on timeline
      let currentTimelineTime = 0;
      const betweenConds = [];
      for (const vc of videoClips) {
        betweenConds.push(`between(t,${currentTimelineTime},${currentTimelineTime + vc.duration})`);
        currentTimelineTime += vc.duration;
      }
      duckExpr = `*if(${betweenConds.join("+")},0.2,1.0)`;
    }

    for (let i = 0; i < activeAudioClips.length; i++) {
      const clip = activeAudioClips[i];
      const audioName = `audio_${i}.wav`;
      
      // Fetch and write the audio
      const audioData = await fetchFile(clip.audioUrl);
      await ffmpeg.writeFile(audioName, audioData);
      audioInputs.push(audioName);

      // Apply delay and volume adjustments with ducking dynamically (eval=frame)
      const delayMs = Math.round(clip.playStartTime * 1000);
      const inputIdx = i + 1; // 0 is the stitched video
      filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume='${clip.volume}${duckExpr}':eval=frame[a${inputIdx}]`);
      amixInputsStringList.push(`[a${inputIdx}]`);
    }

    onProgress?.(85, "Mixing audio tracks with video...");
    
    // Build filter_complex string
    const amixInputs = 1 + activeAudioClips.length;
    const amixInputsString = amixInputsStringList.join("");
    const filterComplex = `${filterParts.join(";")};[0:a]volume=1.0[v_a];[v_a]${amixInputsString}amix=inputs=${amixInputs}:duration=first[aout]`;

    const execArgs = [
      "-i", overlayStitchedName,
      ...audioInputs.flatMap((name) => ["-i", name]),
      "-filter_complex", filterComplex,
      "-map", "0:v",     // Copy video channel directly
      "-map", "[aout]",   // Map the mixed audio channel
      "-c:v", "copy",     // Don't re-encode video (ultra fast)
      "-c:a", "aac",      // Encode mixed audio to AAC
      "-b:a", "192k",
      "-strict", "-2",
      "-y",
      outputName
    ];

    try {
      await ffmpeg.exec(execArgs);
    } catch (err) {
      console.warn("AuraClip: Failed to mix with video audio (possibly no audio stream in source), retrying mix with only background audio...", err);
      
      const execArgsFallback = [
        "-i", overlayStitchedName,
        ...audioInputs.flatMap((name) => ["-i", name]),
        "-filter_complex", activeAudioClips.length > 1 
          ? `${filterParts.join(";")};${amixInputsString}amix=inputs=${activeAudioClips.length}:duration=first[aout]`
          : `${filterParts.join(";")};[a1]volume=1.0[aout]`,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-strict", "-2",
        "-y",
        outputName
      ];
      await ffmpeg.exec(execArgsFallback);
    }

    onProgress?.(95, "Finalizing output...");
    const fileData = (await ffmpeg.readFile(outputName)) as Uint8Array;
    const blob = toSafeBlob(fileData, "video/mp4");

    // Cleanup all files
    try {
      await ffmpeg.deleteFile(stitchedName);
      if (overlayStitchedName !== stitchedName) {
        await ffmpeg.deleteFile(overlayStitchedName);
      }
      await ffmpeg.deleteFile(outputName);
      for (const name of audioInputs) {
        await ffmpeg.deleteFile(name);
      }
    } catch {}

    onProgress?.(100, "Export complete!");
    return blob;
  } finally {
    try {
      await ffmpeg.unmount(mountDir);
      await ffmpeg.deleteDir(mountDir);
    } catch {}
  }
}
