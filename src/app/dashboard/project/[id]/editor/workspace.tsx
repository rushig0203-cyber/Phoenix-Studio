"use client";

import { useEffect, useRef, useState } from "react";
import { FileVideo, Loader2 } from "lucide-react";
import EditorHeader from "@/components/editor/EditorHeader";
import PreviewPlayer from "@/components/editor/PreviewPlayer";
import Timeline from "@/components/editor/Timeline";
import CaptionsControls from "@/components/editor/CaptionsControls";
import AudioControls from "@/components/editor/AudioControls";
import ElementsControls from "@/components/editor/ElementsControls";
import { useEditorStore, type AudioClip, type ElementOverlay, type VideoClip } from "@/store/editorStore";

type SavedTimeline = {
  videoClips?: VideoClip[];
  audioClips?: AudioClip[];
  elementOverlays?: ElementOverlay[];
};

function getVideoDetails(file: File): Promise<{ duration: number; size: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: video.duration, size: `${(file.size / (1024 * 1024)).toFixed(1)} MB` });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected file could not be read as a video."));
    };
    video.src = url;
  });
}

export default function EditorWorkspace({ projectId }: { projectId: string }) {
  const hydrated = useRef(false);
  const lastSaved = useRef("");
  const setVideoFile = useEditorStore((state) => state.setVideoFile);
  const clearVideoFile = useEditorStore((state) => state.clearVideoFile);
  const videoFile = useEditorStore((state) => state.videoFile);
  const videoClips = useEditorStore((state) => state.videoClips);
  const audioClips = useEditorStore((state) => state.audioClips);
  const elementOverlays = useEditorStore((state) => state.elementOverlays);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadFile = async (file: File, saved: SavedTimeline = {}) => {
    const details = await getVideoDetails(file);
    setVideoFile(file, details.duration, details.size, [], saved.videoClips, saved.audioClips, saved.elementOverlays);
    setMessage(null);
  };

  useEffect(() => {
    let active = true;
    Promise.all([fetch(`/api/projects/${projectId}`),fetch(`/api/projects/${projectId}/timeline`)]).then(async([mediaRes,timelineRes])=>{
      if(!mediaRes.ok)throw new Error("Cloud copy removed");
      const media=await mediaRes.json();
      const timeline=projectId.startsWith("local-")
        ? JSON.parse(window.localStorage.getItem(`auraclip-timeline-${projectId}`) || "{}")
        : timelineRes.ok?await timelineRes.json():{};
      const source=await fetch(media.url);if(!source.ok)throw new Error("Video unavailable");
      const blob=await source.blob();const file=new File([blob],"source-video.mp4",{type:blob.type||"video/mp4"});
      if(active){lastSaved.current=JSON.stringify({videoClips:timeline.videoClips||[],audioClips:timeline.audioClips||[],elementOverlays:timeline.elementOverlays||[]});await loadFile(file,timeline);hydrated.current=true;}
    })
      .catch((error) => active && setMessage(error instanceof Error?error.message:"Video unavailable"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      clearVideoFile();
    };
  }, [projectId]);

  useEffect(()=>{if(!hydrated.current)return;const body=JSON.stringify({videoClips,audioClips,elementOverlays});if(body===lastSaved.current)return;const timer=setTimeout(()=>{if(projectId.startsWith("local-")){window.localStorage.setItem(`auraclip-timeline-${projectId}`,body);lastSaved.current=body;return;}void fetch(`/api/projects/${projectId}/timeline`,{method:"PUT",headers:{"Content-Type":"application/json"},body}).then(response=>{if(response.ok)lastSaved.current=body})},900);return()=>clearTimeout(timer)},[projectId,videoClips,audioClips,elementOverlays]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!videoFile) {
    return (
      <main className="min-h-screen grid place-items-center bg-background p-6 text-center">
        <div className="max-w-md rounded-2xl border border-border/40 bg-card/40 p-8 shadow-xl">
          <FileVideo className="mx-auto h-10 w-10 text-violet-400" />
          <h1 className="mt-4 text-xl font-bold text-white">Video unavailable</h1>
          {message && <p className="mt-4 text-sm text-rose-400">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="creator-shell min-h-screen bg-background text-foreground">
      <EditorHeader projectId={projectId} />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-4">
          <PreviewPlayer />
          <Timeline />
        </section>
        <aside className="space-y-4 xl:max-h-[calc(100vh-96px)] xl:overflow-y-auto xl:pr-1">
          <CaptionsControls />
          <AudioControls />
          <ElementsControls />
        </aside>
      </div>
    </main>
  );
}
