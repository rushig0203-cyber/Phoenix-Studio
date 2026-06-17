"use strict";

/**
 * AuraClip — Processing Pipeline Orchestrator
 *
 * Coordinates the full video processing flow:
 *   1. Upload accepted → file stored in IndexedDB
 *   2. Transcribe audio using Web Speech API
 *   3. Analyze transcript for viral clip segments
 *   4. Store results in localStorage for the project
 *   5. Emit progress events throughout
 *
 * Runs entirely in the browser. No backend required.
 */

import { transcribeVideo, type TranscriptResult } from "./transcriber";
import { analyzeWithAI, type AnalysisResult, type AnalyzedClip } from "./clipAnalyzer";

export type ProcessingStage =
  | "idle"
  | "preparing"
  | "transcribing"
  | "analyzing"
  | "generating"
  | "complete"
  | "error";

export interface ProcessingStatus {
  stage: ProcessingStage;
  progress: number; // 0-100
  message: string;
  clips?: AnalyzedClip[];
  transcript?: TranscriptResult;
  analysis?: AnalysisResult;
  error?: string;
}

export type ProcessingCallback = (status: ProcessingStatus) => void;

/** Storage key prefix for processed project results */
const RESULTS_KEY_PREFIX = "auraclip_results_";
const TRANSCRIPT_KEY_PREFIX = "auraclip_transcript_";

/**
 * Run the full processing pipeline for a video file.
 */
export async function processVideo(
  projectId: string,
  file: File,
  onStatus: ProcessingCallback
): Promise<AnalysisResult | null> {
  try {
    // Stage 1: Preparing
    onStatus({
      stage: "preparing",
      progress: 2,
      message: "Preparing video for analysis...",
    });

    // Quick validation
    if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
      throw new Error("Invalid file type. Please upload a video file.");
    }

    onStatus({
      stage: "preparing",
      progress: 5,
      message: "Video loaded. Starting transcription...",
    });

    // Stage 2: Transcription (5% - 50%)
    onStatus({
      stage: "transcribing",
      progress: 8,
      message: "Extracting audio and starting speech recognition...",
    });

    const transcript = await transcribeVideo(file, (stage, percent) => {
      // Map transcriber progress (0-100) to our range (8-48)
      const mappedProgress = 8 + (percent / 100) * 40;
      onStatus({
        stage: "transcribing",
        progress: Math.round(mappedProgress),
        message: stage,
      });
    });

    onStatus({
      stage: "transcribing",
      progress: 50,
      message: `Transcription complete: ${transcript.wordCount} words detected`,
    });

    // Save transcript to localStorage
    try {
      localStorage.setItem(
        TRANSCRIPT_KEY_PREFIX + projectId,
        JSON.stringify(transcript)
      );
    } catch (e) {
      console.warn("AuraClip: Failed to save transcript to localStorage:", e);
    }

    // Stage 3: Analysis (50% - 80%)
    onStatus({
      stage: "analyzing",
      progress: 52,
      message: "AI analyzing transcript for viral moments...",
    });

    const analysis = await analyzeWithAI(transcript, (stage, percent) => {
      const mappedProgress = 52 + (percent / 100) * 28;
      onStatus({
        stage: "analyzing",
        progress: Math.round(mappedProgress),
        message: stage,
      });
    });

    onStatus({
      stage: "analyzing",
      progress: 80,
      message: `Found ${analysis.clips.length} viral clip segments`,
    });

    // Stage 4: Generating clip metadata (80% - 95%)
    onStatus({
      stage: "generating",
      progress: 85,
      message: "Generating clip metadata and hooks...",
    });

    // Save full results to localStorage
    const resultData = {
      clips: analysis.clips,
      totalDuration: analysis.totalDuration,
      averageScore: analysis.averageScore,
      topKeywords: analysis.topKeywords,
      processedAt: new Date().toISOString(),
      videoName: file.name,
      videoSize: file.size,
    };

    try {
      localStorage.setItem(
        RESULTS_KEY_PREFIX + projectId,
        JSON.stringify(resultData)
      );
    } catch (e) {
      console.warn("AuraClip: Failed to save results to localStorage:", e);
    }

    onStatus({
      stage: "generating",
      progress: 95,
      message: "Finalizing clip generation...",
    });

    // Stage 5: Complete
    onStatus({
      stage: "complete",
      progress: 100,
      message: "Processing complete! Clips are ready to view.",
      clips: analysis.clips,
      transcript,
      analysis,
    });

    return analysis;
  } catch (err: any) {
    const errorMessage = err?.message || "An unknown error occurred during processing";
    console.error("AuraClip Pipeline Error:", err);

    onStatus({
      stage: "error",
      progress: 0,
      message: errorMessage,
      error: errorMessage,
    });

    return null;
  }
}

/**
 * Get saved processing results for a project from localStorage.
 */
export function getProcessingResults(projectId: string): {
  clips: AnalyzedClip[];
  totalDuration: number;
  averageScore: number;
  topKeywords: string[];
  processedAt: string;
  videoName: string;
} | null {
  try {
    const raw = localStorage.getItem(RESULTS_KEY_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get saved transcript for a project from localStorage.
 */
export function getTranscript(projectId: string): TranscriptResult | null {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_KEY_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Clear processing results for a project.
 */
export function clearProcessingResults(projectId: string): void {
  localStorage.removeItem(RESULTS_KEY_PREFIX + projectId);
  localStorage.removeItem(TRANSCRIPT_KEY_PREFIX + projectId);
}

/**
 * Check if a project has been processed.
 */
export function isProjectProcessed(projectId: string): boolean {
  return localStorage.getItem(RESULTS_KEY_PREFIX + projectId) !== null;
}
