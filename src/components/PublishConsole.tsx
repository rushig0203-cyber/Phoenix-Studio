"use strict";
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Sparkles, Calendar, Zap, RefreshCw, Link as LinkIcon, Check, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

interface Clip {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  transcript?: string;
  keywords?: string[];
  hookText?: string;
}

interface PublishHistory {
  id: string;
  projectId: string;
  clipId: string;
  clipTitle: string;
  platform: string;
  status: string;
  scheduledFor: string | null;
  postUrl: string | null;
  error: string | null;
  createdAt: string;
}

interface PublishConsoleProps {
  projectId: string;
  activeClip: Clip | undefined;
}

export default function PublishConsole({ projectId, activeClip }: PublishConsoleProps) {
  // Inputs
  const [instagramCaption, setInstagramCaption] = useState("");
  const [instagramHashtags, setInstagramHashtags] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubeDescription, setYoutubeDescription] = useState("");
  const [youtubeHashtags, setYoutubeHashtags] = useState("");

  const [publishInstagram, setPublishInstagram] = useState(true);
  const [publishYoutube, setPublishYoutube] = useState(true);
  
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");
  const [scheduledDate, setScheduledDate] = useState("");

  // States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState("");
  const [historyList, setHistoryList] = useState<PublishHistory[]>([]);
  
  const [webhookConfigured, setWebhookConfigured] = useState(true);
  const [igConnected, setIgConnected] = useState(false);
  const [ytConnected, setYtConnected] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Load publish history & connection settings
  const loadHistoryAndSettings = async () => {
    try {
      // Fetch history
      const historyRes = await fetch(`/api/projects/${projectId}/publish`);
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setHistoryList(historyData);
      }

      // Fetch integration settings
      const settingsRes = await fetch("/api/settings/publish");
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setWebhookConfigured(!!settings.makeWebhookUrl);
        setIgConnected(settings.instagramConnected);
        setYtConnected(settings.youtubeConnected);
      }
    } catch (err) {
      console.error("AuraClip Publishing: Failed to load data:", err);
    }
  };

  useEffect(() => {
    loadHistoryAndSettings();
    
    // Default scheduled date to 1 hour in the future
    const date = new Date();
    date.setHours(date.getHours() + 1);
    // Format to yyyy-MM-ddThh:mm
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    setScheduledDate(`${year}-${month}-${day}T${hours}:${minutes}`);
  }, [projectId]);

  // Clean form when active clip changes
  useEffect(() => {
    setInstagramCaption("");
    setInstagramHashtags("");
    setYoutubeTitle("");
    setYoutubeDescription("");
    setYoutubeHashtags("");
    setErrorMsg("");
    setSuccessMsg("");
  }, [activeClip]);

  const handleAIAnalyze = async () => {
    if (!activeClip) return;
    setIsAnalyzing(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/clips/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: activeClip.title,
          transcript: activeClip.transcript || "",
          keywords: activeClip.keywords || [],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setInstagramCaption(data.instagramCaption || "");
        setInstagramHashtags(data.instagramHashtags || "");
        setYoutubeTitle(data.youtubeTitle || "");
        setYoutubeDescription(data.youtubeDescription || "");
        setYoutubeHashtags(data.youtubeHashtags || "");
        setSuccessMsg("AI copies generated successfully! Review and edit them below.");
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "AI copy generation failed.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during AI generation.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClip) {
      setErrorMsg("Please select a clip to publish.");
      return;
    }
    if (!publishInstagram && !publishYoutube) {
      setErrorMsg("Please select at least one publishing platform (Instagram Reel or YouTube Shorts).");
      return;
    }
    if (publishMode === "schedule" && !scheduledDate) {
      setErrorMsg("Please specify a date and time for scheduled publishing.");
      return;
    }


    setIsPublishing(true);
    setErrorMsg("");
    setSuccessMsg("");
    setPublishStep("Connecting to local video database...");

    try {
      // 1. Load the original video from IndexedDB
      const { getVideoFile } = await import("@/lib/videoStorage");
      const videoFile = await getVideoFile(projectId);
      if (!videoFile) {
        throw new Error("Original video file not found in local browser storage. Please re-upload your source video.");
      }

      // 2. Compile/Trim the clip in the browser via FFmpeg.wasm
      setPublishStep("Compiling video clip using browser WebAssembly...");
      const { exportClip } = await import("@/lib/clipExporter");
      
      const clipBlob = await exportClip(
        videoFile,
        activeClip.startTime,
        activeClip.endTime,
        activeClip.title,
        (percent, message) => {
          setPublishStep(`Compiling: ${percent}% — ${message}`);
        }
      );

      // 3. Upload the compiled clip file to Next.js server
      setPublishStep("Uploading clip buffer to server directory...");
      const uploadFormData = new FormData();
      const clipFile = new File([clipBlob], `${activeClip.title.replace(/[^a-zA-Z0-9]/g, "_")}.mp4`, { type: "video/mp4" });
      uploadFormData.append("file", clipFile);
      uploadFormData.append("clipId", activeClip.id);

      const uploadRes = await fetch(`/api/projects/${projectId}/publish/media`, {
        method: "POST",
        body: uploadFormData,
      });

      if (!uploadRes.ok) {
        const uploadData = await uploadRes.json();
        throw new Error(uploadData.error || "Failed to store media buffer on the server.");
      }

      const uploadResult = await uploadRes.json();
      const mediaPath = uploadResult.path;

      // 4. Record and trigger publishes for each selected platform
      const platforms = [];
      if (publishInstagram) platforms.push("Instagram");
      if (publishYoutube) platforms.push("YouTube");

      for (const platform of platforms) {
        setPublishStep(`Sending ${platform} post to publish queue...`);

        const publishRes = await fetch(`/api/projects/${projectId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clipId: activeClip.id,
            clipTitle: activeClip.title,
            platform,
            scheduledFor: publishMode === "schedule" ? scheduledDate : null,
            caption: platform === "Instagram" ? instagramCaption : null,
            hashtags: platform === "Instagram" ? instagramHashtags : youtubeHashtags,
            youtubeTitle: platform === "YouTube" ? youtubeTitle : null,
            youtubeDesc: platform === "YouTube" ? youtubeDescription : null,
            mediaPath,
          }),
        });

        if (!publishRes.ok) {
          const publishData = await publishRes.json();
          throw new Error(publishData.error || `Failed to trigger publishing for ${platform}`);
        }
      }

      setSuccessMsg(
        publishMode === "schedule"
          ? "Clip scheduled successfully! You can verify scheduling details in logs."
          : "Clip published successfully! Check Make.com webhook triggers and platform URLs."
      );
      
      // Reload history logs
      loadHistoryAndSettings();
    } catch (err: any) {
      console.error("AuraClip Publishing error:", err);
      setErrorMsg(err.message || "An unexpected error occurred during clip publishing.");
    } finally {
      setIsPublishing(false);
      setPublishStep("");
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setIsPublishing(true);
    setErrorMsg("");
    setSuccessMsg("");
    setPublishStep("Retrying published post...");

    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId }),
      });

      if (res.ok) {
        setSuccessMsg("Retry trigger dispatched successfully!");
        loadHistoryAndSettings();
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "Retry trigger failed.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Retry trigger network request failed.");
    } finally {
      setIsPublishing(false);
      setPublishStep("");
    }
  };



  if (!activeClip) {
    return (
      <div className="text-center py-12 border border-border/20 bg-slate-900/10 rounded-xl">
        <p className="text-xs text-muted-foreground">
          Select a clip from the <strong className="text-slate-300">Extracted Clips</strong> tab first to load the publishing console.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-h-[850px] overflow-y-auto pr-2 custom-scrollbar">
      {!webhookConfigured && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 flex flex-col sm:flex-row items-center gap-3.5 leading-relaxed text-xs animate-in fade-in duration-300">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300">
            <Zap className="h-4.5 w-4.5 animate-pulse text-violet-400" />
          </div>
          <div className="flex-grow space-y-0.5">
            <h5 className="font-bold text-white">Simulated Sandbox Mode</h5>
            <p className="text-[10px] text-muted-foreground">
              Make.com Webhook URL is empty. Publishing will compile your clip locally and log publishing results in history. Enter a webhook in <Link href="/dashboard/settings" className="text-violet-400 font-semibold hover:underline">Settings</Link> to post online.
            </p>
          </div>
        </div>
      )}
      {/* AI Asset Generation Trigger */}
      <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-violet-500/20 bg-violet-500/5">
        <div>
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
            AI Social Media Curation
          </h4>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Generate custom Instagram captions, Reels tags, and YouTube clickbait titles.
          </p>
        </div>
        <Button
          onClick={handleAIAnalyze}
          disabled={isAnalyzing || isPublishing}
          className="h-8.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold shrink-0 cursor-pointer shadow-lg shadow-violet-900/10 disabled:opacity-50"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              AI Generate
            </>
          )}
        </Button>
      </div>

      {/* Success/Error banners */}
      {successMsg && (
        <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400 animate-in fade-in">
          ✅ {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-xs text-rose-400 animate-in fade-in">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Main Form Fields */}
      <form onSubmit={handlePublish} className="space-y-6">
        {/* Connection handles status */}
        <div className="flex gap-2">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            igConnected 
              ? "bg-pink-500/10 text-pink-400 border-pink-500/20" 
              : "bg-slate-900 text-slate-500 border-border/20"
          }`}>
            Instagram Reel: {igConnected ? "Ready" : "Disconnected"}
          </span>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            ytConnected 
              ? "bg-rose-500/10 text-rose-400 border-rose-500/20" 
              : "bg-slate-900 text-slate-500 border-border/20"
          }`}>
            YouTube Shorts: {ytConnected ? "Ready" : "Disconnected"}
          </span>
        </div>

        {/* Channels Select Checkbox */}
        <div className="space-y-2.5">
          <label className="text-xs font-semibold text-slate-300">Target Publishing Networks</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPublishInstagram(!publishInstagram)}
              className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                publishInstagram
                  ? "border-pink-500/40 bg-pink-500/5 text-pink-400"
                  : "border-border/30 bg-slate-950/20 text-muted-foreground hover:bg-slate-950/40"
              }`}
            >
              <Instagram className="h-4 w-4" />
              Instagram Reel
              {publishInstagram && <Check className="h-3.5 w-3.5 ml-auto text-pink-400" />}
            </button>
            <button
              type="button"
              onClick={() => setPublishYoutube(!publishYoutube)}
              className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                publishYoutube
                  ? "border-rose-500/40 bg-rose-500/5 text-rose-400"
                  : "border-border/30 bg-slate-950/20 text-muted-foreground hover:bg-slate-950/40"
              }`}
            >
              <Youtube className="h-4 w-4" />
              YouTube Shorts
              {publishYoutube && <Check className="h-3.5 w-3.5 ml-auto text-rose-400" />}
            </button>
          </div>
        </div>

        {/* Instagram Specific Fields */}
        {publishInstagram && (
          <div className="space-y-3.5 border-l-2 border-pink-500/30 pl-4 py-1 animate-in slide-in-from-left-2 duration-200">
            <h5 className="text-xs font-bold text-white flex items-center gap-1">
              <Instagram className="h-3.5 w-3.5 text-pink-400" />
              Instagram Customization
            </h5>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground">Reels Caption</label>
              <textarea
                rows={3}
                placeholder="Write an attention-grabbing Reel caption..."
                value={instagramCaption}
                onChange={(e) => setInstagramCaption(e.target.value)}
                className="w-full rounded-lg border border-border/40 bg-slate-950/30 p-2.5 text-xs text-white focus:border-pink-500/40 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground">Reels Hashtags</label>
              <input
                type="text"
                placeholder="#viral #reels #contentcreator"
                value={instagramHashtags}
                onChange={(e) => setInstagramHashtags(e.target.value)}
                className="w-full rounded-lg border border-border/40 bg-slate-950/30 px-3 py-2 text-xs text-white focus:border-pink-500/40 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* YouTube Specific Fields */}
        {publishYoutube && (
          <div className="space-y-3.5 border-l-2 border-rose-500/30 pl-4 py-1 animate-in slide-in-from-left-2 duration-200">
            <h5 className="text-xs font-bold text-white flex items-center gap-1">
              <Youtube className="h-3.5 w-3.5 text-rose-500" />
              YouTube Shorts Customization
            </h5>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground">Shorts Title</label>
              <input
                type="text"
                maxLength={70}
                placeholder="YouTube Shorts Title (under 70 chars)"
                value={youtubeTitle}
                onChange={(e) => setYoutubeTitle(e.target.value)}
                className="w-full rounded-lg border border-border/40 bg-slate-950/30 px-3 py-2 text-xs text-white focus:border-rose-500/40 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground">Shorts Description</label>
              <textarea
                rows={3}
                placeholder="YouTube Shorts Description..."
                value={youtubeDescription}
                onChange={(e) => setYoutubeDescription(e.target.value)}
                className="w-full rounded-lg border border-border/40 bg-slate-950/30 p-2.5 text-xs text-white focus:border-rose-500/40 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground">Shorts Hashtags</label>
              <input
                type="text"
                placeholder="#shorts #trending #viral"
                value={youtubeHashtags}
                onChange={(e) => setYoutubeHashtags(e.target.value)}
                className="w-full rounded-lg border border-border/40 bg-slate-950/30 px-3 py-2 text-xs text-white focus:border-rose-500/40 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Scheduling Options */}
        <div className="space-y-3.5 bg-slate-950/20 border border-border/20 rounded-xl p-4">
          <label className="text-xs font-semibold text-slate-300">Publish Mode</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-white cursor-pointer select-none">
              <input
                type="radio"
                name="publishMode"
                checked={publishMode === "now"}
                onChange={() => setPublishMode("now")}
                className="accent-violet-500"
              />
              Publish immediately
            </label>
            <label className="flex items-center gap-2 text-xs text-white cursor-pointer select-none">
              <input
                type="radio"
                name="publishMode"
                checked={publishMode === "schedule"}
                onChange={() => setPublishMode("schedule")}
                className="accent-violet-500"
              />
              Schedule publish
            </label>
          </div>

          {publishMode === "schedule" && (
            <div className="pt-2.5 space-y-1.5 animate-in slide-in-from-top-2 duration-150">
              <label className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-violet-400" />
                Select Date and Time
              </label>
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="rounded-lg border border-border/40 bg-slate-950/50 px-3.5 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Publish Button */}
        <Button
          type="submit"
          disabled={isPublishing || isAnalyzing}
          className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-xs font-bold text-white py-5 flex items-center justify-center gap-2 shadow-lg shadow-violet-900/10 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-white" />
              <span>{publishStep}</span>
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 text-white fill-current" />
              <span>{publishMode === "schedule" ? "Schedule Publishing Event" : "Publish to Selected Platforms"}</span>
            </>
          )}
        </Button>
      </form>

      {/* Publishing History Logs */}
      <div className="space-y-3 pt-4 border-t border-border/20">
        <h4 className="text-xs font-bold text-white">Publishing History & Logs</h4>
        
        {historyList.length === 0 ? (
          <div className="text-center py-6 bg-slate-950/10 border border-border/10 rounded-xl">
            <p className="text-[10px] text-muted-foreground">No publishing actions have been taken for this clip yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/20 bg-slate-950/20 overflow-hidden">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-slate-950/60 text-muted-foreground border-b border-border/10">
                  <th className="p-3 font-semibold">Platform</th>
                  <th className="p-3 font-semibold">Publish Date</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Post Destination</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/10">
                {historyList.map((job) => (
                  <tr key={job.id} className="hover:bg-white/[0.01] transition-colors">
                    {/* Platform */}
                    <td className="p-3 font-bold text-white flex items-center gap-1.5">
                      {job.platform === "Instagram" ? (
                        <Instagram className="h-3.5 w-3.5 text-pink-400" />
                      ) : (
                        <Youtube className="h-3.5 w-3.5 text-rose-500" />
                      )}
                      {job.platform}
                    </td>

                    {/* Publish Date */}
                    <td className="p-3 text-slate-300 font-mono">
                      {job.scheduledFor 
                        ? `${new Date(job.scheduledFor).toLocaleString()} (Sched)`
                        : new Date(job.createdAt).toLocaleString()}
                    </td>

                    {/* Status */}
                    <td className="p-3">
                      {job.status === "PUBLISHED" && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
                          Published
                        </span>
                      )}
                      {job.status === "SCHEDULED" && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/15 animate-pulse">
                          Scheduled
                        </span>
                      )}
                      {job.status === "PENDING" && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/15">
                          Pending
                        </span>
                      )}
                      {job.status === "FAILED" && (
                        <div className="flex flex-col gap-1.5 items-start">
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/15">
                            Failed
                          </span>
                          <span className="text-[9px] text-rose-300/80 leading-relaxed max-w-[180px] line-clamp-1 italic" title={job.error || ""}>
                            {job.error || "Webhook error"}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRetryJob(job.id)}
                            disabled={isPublishing}
                            className="text-[9px] text-violet-400 hover:text-violet-300 font-extrabold flex items-center gap-1 bg-violet-500/5 px-2 py-0.5 rounded border border-violet-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className="h-2.5 w-2.5" />
                            Retry
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Post Destination */}
                    <td className="p-3 font-mono">
                      {job.postUrl ? (
                        <a
                          href={job.postUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-violet-400 hover:underline flex items-center gap-1 font-semibold"
                        >
                          <LinkIcon className="h-3 w-3 shrink-0" />
                          View Post
                        </a>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
