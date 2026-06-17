"use strict";

/**
 * AuraClip — Clip Exporter
 * 
 * Uses FFmpeg.wasm to extract individual clips from the original video.
 * Trims video from startTime to endTime and triggers browser download.
 */

import { getFFmpeg, toSafeBlob } from "./ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { VideoClip, AudioClip } from "@/store/editorStore";

export type ExportProgress = (percent: number, message: string) => void;

/**
 * Export a single clip from a video file.
 * Trims the video to the specified time range and returns a downloadable Blob.
 */
export async function exportClip(
  videoFile: File,
  startTime: number,
  endTime: number,
  clipTitle: string,
  onProgress?: ExportProgress
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

    // Execute clip extraction
    await ffmpeg.exec([
      "-ss", startStr,
      "-i", inputPath,
      "-t", durationStr,
      "-c:v", "copy",     // Copy video codec (fast, no re-encode)
      "-c:a", "copy",     // Copy audio codec
      "-avoid_negative_ts", "make_zero",
      "-y",
      outputName,
    ]);

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
  clipNumber?: number
): Promise<void> {
  const blob = await exportClip(videoFile, startTime, endTime, clipTitle, onProgress);

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
export async function exportTimeline(
  videoFile: File,
  videoClips: VideoClip[],
  audioClips: AudioClip[],
  onProgress?: ExportProgress
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

      await ffmpeg.exec([
        "-ss", startStr,
        "-i", inputPath,
        "-t", durationStr,
        "-c:v", "copy",
        "-c:a", "copy",
        "-avoid_negative_ts", "make_zero",
        "-y",
        partName,
      ]);
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

    // 2. Mix audio files if any are present
    const activeAudioClips = audioClips.filter((c) => !c.isMuted && c.volume > 0);
    if (activeAudioClips.length === 0) {
      onProgress?.(90, "Finalizing export...");
      const data = (await ffmpeg.readFile(stitchedName)) as Uint8Array;
      const blob = toSafeBlob(data, "video/mp4");

      try {
        await ffmpeg.deleteFile(stitchedName);
      } catch {}

      onProgress?.(100, "Export complete!");
      return blob;
    }

    onProgress?.(70, "Processing audio tracks...");
    // Write audio files to virtual FS and prepare inputs/filter complex
    const audioInputs: string[] = [];
    const filterParts: string[] = [];
    const amixInputsStringList: string[] = [];
    
    for (let i = 0; i < activeAudioClips.length; i++) {
      const clip = activeAudioClips[i];
      const audioName = `audio_${i}.wav`;
      
      // Fetch and write the audio
      const audioData = await fetchFile(clip.audioUrl);
      await ffmpeg.writeFile(audioName, audioData);
      audioInputs.push(audioName);

      // Apply delay and volume adjustments
      const delayMs = Math.round(clip.playStartTime * 1000);
      const inputIdx = i + 1; // 0 is the stitched video
      filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=${clip.volume}[a${inputIdx}]`);
      amixInputsStringList.push(`[a${inputIdx}]`);
    }

    onProgress?.(85, "Mixing audio tracks with video...");
    
    // Build filter_complex string
    const amixInputs = 1 + activeAudioClips.length;
    const amixInputsString = amixInputsStringList.join("");
    const filterComplex = `${filterParts.join(";")};[0:a]volume=1.0[v_a];[v_a]${amixInputsString}amix=inputs=${amixInputs}:duration=first[aout]`;

    const execArgs = [
      "-i", stitchedName,
      ...audioInputs.flatMap((name) => ["-i", name]),
      "-filter_complex", filterComplex,
      "-map", "0:v",     // Copy video channel directly
      "-map", "[aout]",   // Map the mixed audio channel
      "-c:v", "copy",     // Don't re-encode video (ultra fast)
      "-c:a", "aac",      // Encode mixed audio to AAC
      "-y",
      outputName
    ];

    try {
      await ffmpeg.exec(execArgs);
    } catch (err) {
      console.warn("AuraClip: Failed to mix with video audio (possibly no audio stream in source), retrying mix with only background audio...", err);
      
      const execArgsFallback = [
        "-i", stitchedName,
        ...audioInputs.flatMap((name) => ["-i", name]),
        "-filter_complex", activeAudioClips.length > 1 
          ? `${filterParts.join(";")};${amixInputsString}amix=inputs=${activeAudioClips.length}:duration=first[aout]`
          : `${filterParts.join(";")};[a1]volume=1.0[aout]`,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
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
