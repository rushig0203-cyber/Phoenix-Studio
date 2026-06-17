"use strict";

import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile, importScript } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let isLoading = false;

// Initialize and load FFmpeg WebAssembly in browser
export const getFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpeg) return ffmpeg;
  if (isLoading) {
    // Wait for ongoing loading
    while (isLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ffmpeg) return ffmpeg;
  }

  isLoading = true;
  try {
    // Load FFmpeg from UMD library to bypass Turbopack's dynamic import restrictions on Web Workers
    const win = window as unknown as {
      FFmpegWASM?: {
        FFmpeg: new (...args: unknown[]) => FFmpeg;
      };
    };
    if (typeof win.FFmpegWASM === "undefined") {
      await importScript("/ffmpeg.js");
    }
    
    if (!win.FFmpegWASM) {
      throw new Error("FFmpegWASM failed to load on global scope");
    }
    
    const { FFmpeg: FFmpegClass } = win.FFmpegWASM;
    const instance = new FFmpegClass();
    
    // Core binaries hosted on official unpkg CDN
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await instance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/octet-stream"),
    });

    ffmpeg = instance;
    return ffmpeg;
  } catch (err) {
    console.error("FFmpeg.wasm failed to load, falling back to browser canvas APIs.", err);
    throw err;
  } finally {
    isLoading = false;
  }
};

// Retrieve video duration using HTML5 Video metadata
export const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load video file metadata"));
    };
  });
};

// Generate video thumbnails using HTML5 Canvas (Ultra-fast fallback/default)
export const generateThumbnailsCanvas = (file: File, count: number = 8): Promise<string[]> => {
  return new Promise((resolve) => {
    const thumbnails: string[] = [];
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadeddata = async () => {
      const duration = video.duration;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // Set internal thumbnail size
      canvas.width = 160;
      canvas.height = 90;

      const interval = duration / (count + 1);

      for (let i = 1; i <= count; i++) {
        const targetTime = i * interval;
        
        // Seek to target frame
        await new Promise<void>((seekResolve) => {
          video.currentTime = targetTime;
          video.onseeked = () => seekResolve();
        });

        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          thumbnails.push(canvas.toDataURL("image/jpeg", 0.7));
        }
      }

      URL.revokeObjectURL(objectUrl);
      resolve(thumbnails);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Return empty array on error
      resolve([]);
    };
  });
};

// Generate video thumbnails using FFmpeg.wasm (runs on WASM thread)
export const generateThumbnailsWasm = async (
  file: File,
  count: number = 8
): Promise<string[]> => {
  try {
    const instance = await getFFmpeg();
    const inName = "input.mp4";
    
    // Write original file into FFmpeg virtual storage
    await instance.writeFile(inName, await fetchFile(file));
    
    const duration = await getVideoDuration(file);
    const interval = duration / (count + 1);
    const thumbnails: string[] = [];

    for (let i = 1; i <= count; i++) {
      const seekTime = i * interval;
      
      // Format time string to hh:mm:ss.xxx
      const h = Math.floor(seekTime / 3600).toString().padStart(2, "0");
      const m = Math.floor((seekTime % 3600) / 60).toString().padStart(2, "0");
      const s = (seekTime % 60).toFixed(3).padStart(6, "0");
      const formattedTime = `${h}:${m}:${s}`;
      
      const outName = `thumb_${i}.jpg`;
      
      // Execute frame slice command
      await instance.exec([
        "-ss", formattedTime,
        "-i", inName,
        "-vframes", "1",
        "-q:v", "5",
        outName,
      ]);

      try {
        const fileData = await instance.readFile(outName);
        const data = fileData as Uint8Array;
        
        const blob = toSafeBlob(data, "image/jpeg");
        const imgUrl = URL.createObjectURL(blob);
        thumbnails.push(imgUrl);
        
        // Cleanup virtual file
        await instance.deleteFile(outName);
      } catch (readErr) {
        console.error("WASM failed to read output frame", i, readErr);
      }
    }

    // Cleanup virtual input file
    await instance.deleteFile(inName);
    return thumbnails;
  } catch (err) {
    console.warn("WASM thumbnail extraction failed, using browser canvas fallback...", err);
    return generateThumbnailsCanvas(file, count);
  }
};

/**
 * Safely convert a Uint8Array (which might be backed by a SharedArrayBuffer)
 * to a Blob without risking a contiguous memory allocation crash for large arrays.
 */
export function toSafeBlob(data: Uint8Array, type: string): Blob {
  if (typeof SharedArrayBuffer === "undefined" || !(data.buffer instanceof SharedArrayBuffer)) {
    return new Blob([data as any], { type });
  }

  // Copy in chunks to avoid allocating one giant contiguous buffer
  const chunkSize = 10 * 1024 * 1024; // 10MB chunks
  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  
  while (offset < data.byteLength) {
    const end = Math.min(offset + chunkSize, data.byteLength);
    const length = end - offset;
    const chunkBuffer = new ArrayBuffer(length);
    new Uint8Array(chunkBuffer).set(data.subarray(offset, end) as any);
    chunks.push(chunkBuffer);
    offset = end;
  }
  
  return new Blob(chunks, { type });
}
