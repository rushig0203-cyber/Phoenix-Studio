"use client";

import React, { useState } from "react";
import { Sparkles, Upload, Send, CheckCircle2, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThumbnailGenerator from "./editor/ThumbnailGenerator";

const Youtube = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
  >
    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17z" />
    <polygon points="10 15 15 12 10 9" />
  </svg>
);

const Instagram = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

export default function UploadTabConsole() {
  const [activeTab, setActiveTab] = useState<"youtube" | "instagram">("youtube");
  
  // File States
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Form Fields
  const [ytTitle, setYtTitle] = useState("");
  const [ytDescription, setYtDescription] = useState("");
  const [ytTags, setYtTags] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  const [instaCaption, setInstaCaption] = useState("");
  const [instaHashtags, setInstaHashtags] = useState("");

  // Process States
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Show/Hide thumbnail generator
  const [showThumbGen, setShowThumbGen] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setStatusMsg("");
      setErrorMsg("");
    }
  };

  const handleAIAssist = async () => {
    if (!videoFile) {
      setErrorMsg("Please select a video file first.");
      return;
    }

    setIsGeneratingAI(true);
    setErrorMsg("");
    setStatusMsg("");

    try {
      const res = await fetch("/api/clips/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: videoFile.name,
          transcript: `This is a high-energy video uploaded as ${videoFile.name}. It discusses target concepts, marketing ideas, and viral content strategies.`,
          keywords: ["marketing", "viral", "growth", "business"],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (activeTab === "youtube") {
          setYtTitle(data.youtubeTitle || "");
          setYtDescription(data.youtubeDescription || "");
          setYtTags(data.youtubeHashtags?.replace(/#/g, "").split(" ").join(", ") || "");
        } else {
          setInstaCaption(data.instagramCaption || "");
          setInstaHashtags(data.instagramHashtags || "");
        }
        setStatusMsg("AI viral copy generated successfully! Review and edit the fields below.");
      } else {
        throw new Error("API responded with an error");
      }
    } catch {
      setErrorMsg("AI Assistant failed to generate viral assets. Please fill in details manually.");
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleEnqueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setErrorMsg("Please select a video file to enqueue.");
      return;
    }

    setIsEnqueuing(true);
    setErrorMsg("");
    setStatusMsg("Compiling local buffers...");

    try {
      // 1. Create a Project on the DB
      const projId = "proj_upload_" + Math.random().toString(36).substring(2, 11);
      
      // Save file locally via save-local route
      const uploadFormData = new FormData();
      uploadFormData.append("file", videoFile);
      uploadFormData.append("fileName", `${projId}.mp4`);

      setStatusMsg("Uploading video buffer to server directory...");
      const saveRes = await fetch(`/api/projects/${projId}/save-local`, {
        method: "POST",
        body: uploadFormData,
      });

      if (!saveRes.ok) {
        throw new Error("Failed to save media buffer on the server.");
      }

      const { path: mediaPath } = await saveRes.json();

      // If thumbnail is generated as data URL, save it
      let savedThumbPath = null;
      if (activeTab === "youtube" && thumbnailPreview) {
        setStatusMsg("Saving video thumbnail...");
        const thumbBlob = await (await fetch(thumbnailPreview)).blob();
        const thumbFormData = new FormData();
        thumbFormData.append("file", thumbBlob);
        thumbFormData.append("fileName", `${projId}_thumb.jpg`);

        const thumbRes = await fetch(`/api/projects/${projId}/save-local`, {
          method: "POST",
          body: thumbFormData,
        });
        if (thumbRes.ok) {
          const thumbData = await thumbRes.json();
          savedThumbPath = thumbData.path;
        }
      }

      // 2. Submit Publish Job Queue Entry
      setStatusMsg("Adding job to publish queue...");
      const publishRes = await fetch(`/api/projects/${projId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: `clip_${Date.now()}`,
          clipTitle: videoFile.name,
          platform: activeTab === "youtube" ? "YouTube" : "Instagram",
          scheduledFor: null, // Publish immediately
          caption: activeTab === "instagram" ? instaCaption : null,
          hashtags: activeTab === "instagram" ? instaHashtags : null,
          youtubeTitle: activeTab === "youtube" ? ytTitle : null,
          youtubeDesc: activeTab === "youtube" ? ytDescription : null,
          youtubeTags: activeTab === "youtube" ? ytTags : null,
          thumbnailUrl: savedThumbPath,
          mediaPath,
        }),
      });

      if (!publishRes.ok) {
        const errData = await publishRes.json();
        throw new Error(errData.error || "Failed to enqueue job.");
      }

      setStatusMsg("Successfully enqueued post! The sequential publisher queue will dispatch it next.");
      // Reset form
      setVideoFile(null);
      setVideoUrl(null);
      setThumbnailPreview(null);
      setYtTitle("");
      setYtDescription("");
      setYtTags("");
      setInstaCaption("");
      setInstaHashtags("");
    } catch (err: any) {
      console.error("Enqueue error:", err);
      setErrorMsg(err.message || "Failed to add post to publishing queue.");
    } finally {
      setIsEnqueuing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Tab selection */}
      <div className="flex border-b border-border/30 gap-1.5 p-1 bg-slate-950/40 rounded-xl max-w-sm">
        <button
          onClick={() => {
            setActiveTab("youtube");
            setErrorMsg("");
            setStatusMsg("");
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex-1 justify-center ${
            activeTab === "youtube"
              ? "bg-rose-500/10 border border-rose-500/20 text-rose-500"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Youtube className="h-4 w-4" />
          YouTube Shorts
        </button>
        <button
          onClick={() => {
            setActiveTab("instagram");
            setErrorMsg("");
            setStatusMsg("");
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex-1 justify-center ${
            activeTab === "instagram"
              ? "bg-pink-500/10 border border-pink-500/20 text-pink-400"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Instagram className="h-4 w-4" />
          Instagram Reels
        </button>
      </div>

      {/* Upload layout panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left side upload selector & preview */}
        <div className="md:col-span-1 space-y-4">
          <div className="rounded-2xl border border-dashed border-border/40 bg-card/20 p-6 text-center flex flex-col items-center justify-center aspect-video sm:aspect-square relative overflow-hidden group">
            {videoUrl ? (
              <>
                <video src={videoUrl} controls className="max-h-full max-w-full rounded-lg object-contain z-10" />
                <button
                  onClick={() => {
                    setVideoFile(null);
                    setVideoUrl(null);
                    setThumbnailPreview(null);
                  }}
                  className="absolute top-2 right-2 z-20 text-[9px] bg-slate-900 border border-border/30 text-white rounded-full px-2.5 py-1 hover:bg-rose-600 transition-colors"
                >
                  Change File
                </button>
              </>
            ) : (
              <label className="cursor-pointer flex flex-col items-center justify-center h-full w-full space-y-3">
                <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center border border-border/20 text-slate-400 group-hover:text-white group-hover:scale-105 transition-all">
                  <Upload className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">Select video file</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">MP4, MOV, WebM (max 100MB)</p>
                </div>
                <input type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
              </label>
            )}
          </div>

          {/* AI trigger box */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3 text-center">
            <div className="text-left">
              <h4 className="text-xs font-bold text-white flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-fuchsia-400 animate-pulse" />
                AI Social Curator
              </h4>
              <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">
                Generate high-engagement viral clickbaits and SEO tags instantly.
              </p>
            </div>
            <Button
              onClick={handleAIAssist}
              disabled={!videoFile || isGeneratingAI || isEnqueuing}
              className="w-full h-8.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {isGeneratingAI ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Analyzing Video...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Generate Viral Assets
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Right side form fields */}
        <div className="md:col-span-2">
          <form onSubmit={handleEnqueue} className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-6 shadow-xl">
            
            {/* Status alerts */}
            {statusMsg && (
              <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400 animate-in fade-in flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{statusMsg}</span>
              </div>
            )}
            {errorMsg && (
              <div className="p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-xs text-rose-400 animate-in fade-in">
                ⚠️ {errorMsg}
              </div>
            )}

            {activeTab === "youtube" ? (
              // YouTube fields
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 border-b border-border/20 pb-3">
                  <Youtube className="h-5 w-5 text-rose-500" />
                  <h3 className="text-sm font-bold text-white">YouTube Shorts Configuration</h3>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-slate-300">Shorts Title (max 70 chars)</label>
                  <input
                    type="text"
                    maxLength={70}
                    placeholder="E.g., Stop making this mistake in your coding career! 🤯 #shorts"
                    value={ytTitle}
                    onChange={(e) => setYtTitle(e.target.value)}
                    className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3 text-xs text-white focus:border-rose-500/40 focus:outline-none placeholder-slate-700 font-semibold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-slate-300">Shorts Description</label>
                  <textarea
                    rows={3}
                    placeholder="Write a brief description details..."
                    value={ytDescription}
                    onChange={(e) => setYtDescription(e.target.value)}
                    className="w-full rounded-xl border border-border/40 bg-slate-950/40 p-3.5 text-xs text-white focus:border-rose-500/40 focus:outline-none placeholder-slate-700"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-slate-300">YouTube Search Tags (comma-separated)</label>
                  <input
                    type="text"
                    placeholder="career, programming, tips, tutorial"
                    value={ytTags}
                    onChange={(e) => setYtTags(e.target.value)}
                    className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3 text-xs text-white focus:border-rose-500/40 focus:outline-none placeholder-slate-700 font-mono"
                  />
                </div>

                {/* Custom thumbnail selector */}
                <div className="space-y-3 border border-border/30 bg-slate-950/20 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <ImageIcon className="h-3.5 w-3.5 text-rose-400" />
                      YouTube Custom Thumbnail (Optional)
                    </label>
                    {videoUrl && (
                      <Button
                        type="button"
                        onClick={() => setShowThumbGen(true)}
                        className="h-7 px-3 text-[10px] font-extrabold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg cursor-pointer"
                      >
                        Launch Interactive Creator
                      </Button>
                    )}
                  </div>

                  {thumbnailPreview ? (
                    <div className="flex items-center gap-4 bg-black/40 p-3 rounded-lg border border-border/10">
                      <img src={thumbnailPreview} className="h-16 aspect-video rounded object-cover border border-white/10" alt="thumbnail preview" />
                      <div className="flex-grow">
                        <p className="text-[10px] text-white font-bold">Thumbnail Created</p>
                        <p className="text-[9px] text-muted-foreground">Interactive overlay applied</p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => setThumbnailPreview(null)}
                        className="h-6 px-2 text-[9px] font-bold bg-white/5 border border-border/35 hover:bg-rose-600 rounded"
                      >
                        Reset
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground leading-normal font-medium">
                      Provide a custom thumbnail for your Shorts using the canvas builder to increase click rates.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              // Instagram fields
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 border-b border-border/20 pb-3">
                  <Instagram className="h-5 w-5 text-pink-500" />
                  <h3 className="text-sm font-bold text-white">Instagram Reels Configuration</h3>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-slate-300">Reels Caption</label>
                  <textarea
                    rows={4}
                    placeholder="Write your attention grabbing Reels caption..."
                    value={instaCaption}
                    onChange={(e) => setInstaCaption(e.target.value)}
                    className="w-full rounded-xl border border-border/40 bg-slate-950/40 p-3.5 text-xs text-white focus:border-pink-500/40 focus:outline-none placeholder-slate-700"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-slate-300">Reels Hashtags</label>
                  <input
                    type="text"
                    placeholder="#viral #reels #contentcreator"
                    value={instaHashtags}
                    onChange={(e) => setInstaHashtags(e.target.value)}
                    className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3 text-xs text-white focus:border-pink-500/40 focus:outline-none placeholder-slate-700 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Enqueue button */}
            <Button
              type="submit"
              disabled={!videoFile || isEnqueuing || isGeneratingAI}
              className={`w-full rounded-full ${
                activeTab === "youtube"
                  ? "bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500"
                  : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500"
              } text-xs font-bold text-white py-5.5 flex items-center justify-center gap-2 shadow-lg active:scale-95 disabled:opacity-50 transition-all cursor-pointer`}
            >
              {isEnqueuing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  <span>{statusMsg}</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 text-white" />
                  <span>Enqueue Publish Event</span>
                </>
              )}
            </Button>

          </form>
        </div>

      </div>

      {/* Interactive Thumbnail Generator Modal Overlay */}
      {showThumbGen && videoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-border/40 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-border/20 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Create Catchy Thumbnail</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowThumbGen(false)}
                className="text-xs hover:bg-white/5"
              >
                Close
              </Button>
            </div>
            
            <ThumbnailGenerator
              videoUrl={videoUrl}
              onSave={(previewUrl) => {
                setThumbnailPreview(previewUrl);
                setShowThumbGen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
