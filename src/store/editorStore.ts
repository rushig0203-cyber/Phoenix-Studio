"use strict";

import { create } from "zustand";

export interface VideoClip {
  id: string;
  title: string;
  startTime: number;      // Trim start point in original video (seconds)
  endTime: number;        // Trim end point in original video (seconds)
  playStartTime: number;  // Absolute timeline start position (seconds)
  duration: number;       // Current trimmed duration (seconds)
  volume: number;         // 0 to 1
  transcript?: string;
  hookText?: string;
  keywords?: string[];
  scale?: number;
  fitMode?: "cover" | "contain";
}

export interface AudioClip {
  id: string;
  title: string;
  audioUrl: string;       // Blob URL of the imported audio file
  startTime: number;      // Trim start in audio source (seconds)
  endTime: number;        // Trim end in audio source (seconds)
  playStartTime: number;  // Absolute timeline placement (seconds)
  duration: number;       // Clip duration (seconds)
  volume: number;         // 0 to 1
  fadeIn: number;         // Fade in duration (seconds)
  fadeOut: number;        // Fade out duration (seconds)
  isMuted: boolean;
}

export interface ElementOverlay {
  id: string;
  type: "text" | "shape" | "image";
  text?: string;                // For text elements
  fontFamily?: string;          // e.g. Impact, Montserrat, Arial, Inter, "Neon", "Glow"
  color?: string;               // Text/shape color (e.g. #FFFFFF)
  backgroundColor?: string;     // For shape or text backings
  fontSize?: number;            // For text elements
  shapeType?: "rectangle" | "circle" | "arrow" | "star"; // For shape elements
  imageUrl?: string;            // For image elements (blob URL)
  opacity: number;              // 0 to 1
  x: number;                    // Percent from left (0 to 100)
  y: number;                    // Percent from top (0 to 100)
  width: number;                // Percent of viewport width (0 to 100)
  height: number;               // Percent of viewport height (0 to 100)
  playStartTime: number;        // Timeline start in seconds
  duration: number;             // Overlay duration in seconds
  zIndex: number;               // CSS layering
}

interface EditorState {
  videoFile: File | null;
  videoUrl: string | null;
  videoMetadata: {
    duration: number;
    size: string;
    width?: number;
    height?: number;
  } | null;

  videoClips: VideoClip[];
  audioClips: AudioClip[];
  elementOverlays: ElementOverlay[];

  currentTime: number;
  isPlaying: boolean;
  zoom: number; // Pixels per second of timeline width

  selectedClipId: string | null;
  selectedTrackType: "video" | "audio" | "element" | null;
  selectedElementId: string | null;

  // Undo / Redo Stacks
  history: Array<{ videoClips: VideoClip[]; audioClips: AudioClip[]; elementOverlays: ElementOverlay[] }>;
  future: Array<{ videoClips: VideoClip[]; audioClips: AudioClip[]; elementOverlays: ElementOverlay[] }>;

  thumbnails: string[];

  // Actions
  setVideoFile: (file: File, duration: number, size: string, thumbnails?: string[], initialClips?: VideoClip[], initialAudioClips?: AudioClip[], initialElementOverlays?: ElementOverlay[]) => void;
  clearVideoFile: () => void;

  addVideoClip: (clip: Omit<VideoClip, "id" | "playStartTime">) => void;
  updateVideoClip: (clipId: string, updates: Partial<VideoClip>) => void;
  splitVideoClip: (clipId: string, absoluteTime: number) => void;
  deleteVideoClip: (clipId: string) => void;
  reorderVideoClips: (clips: VideoClip[]) => void;

  addAudioClip: (title: string, url: string, duration: number) => void;
  updateAudioClip: (clipId: string, updates: Partial<AudioClip>) => void;
  deleteAudioClip: (clipId: string) => void;

  addElementOverlay: (overlay: Omit<ElementOverlay, "id">) => void;
  updateElementOverlay: (id: string, updates: Partial<ElementOverlay>) => void;
  deleteElementOverlay: (id: string) => void;
  setSelectedElementId: (elementId: string | null) => void;

  setCurrentTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setZoom: (zoom: number) => void;

  setSelectedClip: (clipId: string | null, trackType: "video" | "audio" | "element" | null) => void;

  captionFont: "Impact" | "Montserrat" | "Inter" | "Arial";
  captionColor: string;
  captionSize: "sm" | "md" | "lg" | "xl";
  captionPreset: "tiktok" | "classic" | "minimalist" | "karaoke";
  captionStroke: boolean;
  captionUppercase: boolean;

  setCaptionFont: (font: "Impact" | "Montserrat" | "Inter" | "Arial") => void;
  setCaptionColor: (color: string) => void;
  setCaptionSize: (size: "sm" | "md" | "lg" | "xl") => void;
  setCaptionPreset: (preset: "tiktok" | "classic" | "minimalist" | "karaoke") => void;
  setCaptionStroke: (stroke: boolean) => void;
  setCaptionUppercase: (uppercase: boolean) => void;

  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;
}

// Utility to re-calculate gapless sequential times on the video track
const updateVideoPlayStartTimes = (clips: VideoClip[]): VideoClip[] => {
  let currentStart = 0;
  return clips.map((clip) => {
    const playStartTime = currentStart;
    currentStart += clip.duration;
    return { ...clip, playStartTime };
  });
};

export const useEditorStore = create<EditorState>((set, get) => ({
  videoFile: null,
  videoUrl: null,
  videoMetadata: null,

  videoClips: [],
  audioClips: [],
  elementOverlays: [],
  thumbnails: [],

  currentTime: 0,
  isPlaying: false,
  zoom: 15, // Default zoom: 15px per second

  selectedClipId: null,
  selectedTrackType: null,
  selectedElementId: null,

  captionFont: "Impact",
  captionColor: "#EAB308", // Tailwind Amber/Yellow-500
  captionSize: "md",
  captionPreset: "tiktok",
  captionStroke: true,
  captionUppercase: true,

  setCaptionFont: (captionFont) => set({ captionFont }),
  setCaptionColor: (captionColor) => set({ captionColor }),
  setCaptionSize: (captionSize) => set({ captionSize }),
  setCaptionPreset: (captionPreset) => set({ captionPreset }),
  setCaptionStroke: (captionStroke) => set({ captionStroke }),
  setCaptionUppercase: (captionUppercase) => set({ captionUppercase }),

  history: [],
  future: [],

  setVideoFile: (file, duration, size, thumbnails = [], initialClips, initialAudioClips, initialElementOverlays) => {
    const videoUrl = URL.createObjectURL(file);
    
    // Use initialClips if provided, otherwise fallback to default single clip covering the whole video
    const videoClips = initialClips && initialClips.length > 0 
      ? updateVideoPlayStartTimes(initialClips.map((clip) => ({
          ...clip,
          volume: clip.volume ?? 1.0
        })))
      : [
          {
            id: "vclip-default",
            title: file.name.replace(/\.[^/.]+$/, ""),
            startTime: 0,
            endTime: duration,
            playStartTime: 0,
            duration: duration,
            volume: 1.0,
          }
        ];

    set({
      videoFile: file,
      videoUrl,
      videoMetadata: { duration, size },
      videoClips,
      audioClips: initialAudioClips || [],
      elementOverlays: initialElementOverlays || [],
      thumbnails,
      currentTime: 0,
      isPlaying: false,
      selectedClipId: videoClips[0]?.id || null,
      selectedTrackType: videoClips[0] ? "video" : null,
      selectedElementId: null,
      history: [],
      future: [],
    });
  },

  clearVideoFile: () => {
    const { videoUrl } = get();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
 
    set({
      videoFile: null,
      videoUrl: null,
      videoMetadata: null,
      videoClips: [],
      audioClips: [],
      elementOverlays: [],
      currentTime: 0,
      isPlaying: false,
      selectedClipId: null,
      selectedTrackType: null,
      selectedElementId: null,
      history: [],
      future: [],
    });
  },

  addVideoClip: (clip) => {
    get().saveToHistory();
    const newClip: VideoClip = {
      ...clip,
      volume: clip.volume ?? 1.0,
      id: "vclip-" + Math.random().toString(36).substr(2, 9),
      playStartTime: 0, // Computed by updateVideoPlayStartTimes
    };

    set((state) => {
      const updatedClips = updateVideoPlayStartTimes([...state.videoClips, newClip]);
      return { videoClips: updatedClips };
    });
  },

  updateVideoClip: (clipId, updates) => {
    get().saveToHistory();
    set((state) => {
      const updatedClips = state.videoClips.map((clip) => {
        if (clip.id !== clipId) return clip;
        const newClip = { ...clip, ...updates };
        
        // If start/end times updated, recalculate duration
        if (updates.startTime !== undefined || updates.endTime !== undefined) {
          const newStart = updates.startTime ?? clip.startTime;
          const newEnd = updates.endTime ?? clip.endTime;
          newClip.duration = Math.max(0.1, newEnd - newStart);
        }
        return newClip;
      });

      return {
        videoClips: updateVideoPlayStartTimes(updatedClips),
      };
    });
  },

  splitVideoClip: (clipId, absoluteTime) => {
    const { videoClips } = get();
    const clipIndex = videoClips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return;

    const clip = videoClips[clipIndex];
    
    // Ensure absoluteTime falls within this clip
    if (absoluteTime <= clip.playStartTime || absoluteTime >= clip.playStartTime + clip.duration) {
      return;
    }

    get().saveToHistory();

    const relativeSplitOffset = absoluteTime - clip.playStartTime;
    
    const clip1: VideoClip = {
      ...clip,
      endTime: clip.startTime + relativeSplitOffset,
      duration: relativeSplitOffset,
    };

    const clip2: VideoClip = {
      ...clip,
      id: "vclip-" + Math.random().toString(36).substr(2, 9),
      title: `${clip.title} (Part 2)`,
      startTime: clip.startTime + relativeSplitOffset,
      duration: clip.duration - relativeSplitOffset,
    };

    set((state) => {
      const newClips = [...state.videoClips];
      newClips.splice(clipIndex, 1, clip1, clip2);
      const updatedClips = updateVideoPlayStartTimes(newClips);

      return {
        videoClips: updatedClips,
        selectedClipId: clip2.id,
        selectedTrackType: "video",
      };
    });
  },

  deleteVideoClip: (clipId) => {
    get().saveToHistory();
    set((state) => {
      const filtered = state.videoClips.filter((c) => c.id !== clipId);
      const updatedClips = updateVideoPlayStartTimes(filtered);
      
      return {
        videoClips: updatedClips,
        selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
        selectedTrackType: state.selectedClipId === clipId ? null : state.selectedTrackType,
      };
    });
  },

  reorderVideoClips: (clips) => {
    get().saveToHistory();
    set({
      videoClips: updateVideoPlayStartTimes(clips),
    });
  },

  addAudioClip: (title, url, duration) => {
    get().saveToHistory();
    const newAudio: AudioClip = {
      id: "aclip-" + Math.random().toString(36).substr(2, 9),
      title,
      audioUrl: url,
      startTime: 0,
      endTime: duration,
      playStartTime: get().currentTime, // Place at playhead
      duration,
      volume: 0.8,
      fadeIn: 0,
      fadeOut: 0,
      isMuted: false,
    };

    set((state) => ({
      audioClips: [...state.audioClips, newAudio],
      selectedClipId: newAudio.id,
      selectedTrackType: "audio",
    }));
  },

  updateAudioClip: (clipId, updates) => {
    get().saveToHistory();
    set((state) => ({
      audioClips: state.audioClips.map((clip) => {
        if (clip.id !== clipId) return clip;
        const newClip = { ...clip, ...updates };

        if (updates.startTime !== undefined || updates.endTime !== undefined) {
          const newStart = updates.startTime ?? clip.startTime;
          const newEnd = updates.endTime ?? clip.endTime;
          newClip.duration = Math.max(0.1, newEnd - newStart);
        }
        return newClip;
      }),
    }));
  },

  deleteAudioClip: (clipId) => {
    get().saveToHistory();
    set((state) => ({
      audioClips: state.audioClips.filter((c) => c.id !== clipId),
      selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      selectedTrackType: state.selectedClipId === clipId ? null : state.selectedTrackType,
    }));
  },

  addElementOverlay: (overlay) => {
    get().saveToHistory();
    const newElement: ElementOverlay = {
      ...overlay,
      id: "eoverlay-" + Math.random().toString(36).substr(2, 9),
    };
    set((state) => ({
      elementOverlays: [...state.elementOverlays, newElement],
      selectedClipId: newElement.id,
      selectedTrackType: "element",
      selectedElementId: newElement.id,
    }));
  },

  updateElementOverlay: (id, updates) => {
    get().saveToHistory();
    set((state) => ({
      elementOverlays: state.elementOverlays.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    }));
  },

  deleteElementOverlay: (id) => {
    get().saveToHistory();
    set((state) => ({
      elementOverlays: state.elementOverlays.filter((e) => e.id !== id),
      selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
      selectedTrackType: state.selectedClipId === id ? null : state.selectedTrackType,
      selectedElementId: state.selectedElementId === id ? null : state.selectedElementId,
    }));
  },

  setSelectedElementId: (elementId) => {
    set({
      selectedElementId: elementId,
      selectedClipId: elementId,
      selectedTrackType: elementId ? "element" : null,
    });
  },

  setCurrentTime: (time) => {
    // Clamp time to 0 or total video duration
    const duration = get().videoClips.reduce((sum, c) => sum + c.duration, 0);
    const clampedTime = Math.max(0, Math.min(time, duration));
    set({ currentTime: clampedTime });
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  
  setZoom: (zoom) => set({ zoom: Math.max(2, Math.min(zoom, 100)) }), // Zoom clamp: 2px/s to 100px/s

  setSelectedClip: (clipId, trackType) =>
    set({ selectedClipId: clipId, selectedTrackType: trackType }),

  saveToHistory: () => {
    const { videoClips, audioClips, elementOverlays, history } = get();
    // Deep clone arrays to store state
    const snapshot = {
      videoClips: JSON.parse(JSON.stringify(videoClips)),
      audioClips: JSON.parse(JSON.stringify(audioClips)),
      elementOverlays: JSON.parse(JSON.stringify(elementOverlays)),
    };
    
    set({
      history: [...history, snapshot],
      future: [], // Clear redo stack on new action
    });
  },

  undo: () => {
    const { history, future, videoClips, audioClips, elementOverlays } = get();
    if (history.length === 0) return;

    const previous = history[history.length - 1];
    const newHistory = history.slice(0, history.length - 1);
    const currentSnapshot = {
      videoClips: JSON.parse(JSON.stringify(videoClips)),
      audioClips: JSON.parse(JSON.stringify(audioClips)),
      elementOverlays: JSON.parse(JSON.stringify(elementOverlays)),
    };

    set({
      videoClips: previous.videoClips,
      audioClips: previous.audioClips,
      elementOverlays: previous.elementOverlays || [],
      history: newHistory,
      future: [currentSnapshot, ...future],
      selectedClipId: null, // Reset selection on state undo to avoid mapping errors
      selectedTrackType: null,
      selectedElementId: null,
    });
  },

  redo: () => {
    const { history, future, videoClips, audioClips, elementOverlays } = get();
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);
    const currentSnapshot = {
      videoClips: JSON.parse(JSON.stringify(videoClips)),
      audioClips: JSON.parse(JSON.stringify(audioClips)),
      elementOverlays: JSON.parse(JSON.stringify(elementOverlays)),
    };

    set({
      videoClips: next.videoClips,
      audioClips: next.audioClips,
      elementOverlays: next.elementOverlays || [],
      history: [...history, currentSnapshot],
      future: newFuture,
      selectedClipId: null,
      selectedTrackType: null,
      selectedElementId: null,
    });
  },
}));
