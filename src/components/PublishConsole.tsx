"use strict";
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useEditorStore } from "@/store/editorStore";
import { Sparkles, Calendar, Zap, RefreshCw, Link as LinkIcon, Check, AlertTriangle, Loader2, Download } from "lucide-react";
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
  activeClip?: Clip;
}

export default function PublishConsole({ projectId, activeClip }: PublishConsoleProps) {
  const {
    captionFont,
    captionColor,
    captionSize,
    captionStroke,
    captionUppercase,
    captionPreset,
  } = useEditorStore();

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
  const [compiledVideoUrl, setCompiledVideoUrl] = useState<string | null>(null);
  const [compiledVideoName, setCompiledVideoName] = useState("");
  const [historyList, setHistoryList] = useState<PublishHistory[]>([]);
  
  const [webhookConfigured, setWebhookConfigured] = useState(true);
  const [igConnected, setIgConnected] = useState(false);
  const [ytConnected, setYtConnected] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);
  const [generatedPlatform, setGeneratedPlatform] = useState<string>("");
  const [viralityScore, setViralityScore] = useState<number | null>(null);
  const [hookAnalysis, setHookAnalysis] = useState("");
  const [ctrHooks, setCtrHooks] = useState<string[]>([]);

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
    setViralityScore(null);
    setHookAnalysis("");
    setCtrHooks([]);
    setCompiledVideoUrl(null);
    setCompiledVideoName("");
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
        setViralityScore(data.viralityScore || null);
        setHookAnalysis(data.hookAnalysis || "");
        setCtrHooks(data.ctrHooks || []);
        setSuccessMsg("AI copies and virality analytics generated successfully! Review them below.");
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
        },
        {
          burnCaptions: true,
          transcript: activeClip.transcript,
          style: {
            fontFamily: captionFont,
            color: captionColor,
            size: captionSize,
            stroke: captionStroke,
            uppercase: captionUppercase,
            preset: captionPreset,
          }
        }
      );

      // Save compiled video object URL in React state to allow direct local browser download
      const blobUrl = URL.createObjectURL(clipBlob);
      setCompiledVideoUrl(blobUrl);
      const outputFilename = `${activeClip.title.replace(/[^a-zA-Z0-9]/g, "_")}.mp4`;
      setCompiledVideoName(outputFilename);

      // 3. Upload the compiled clip file to Next.js server
      setPublishStep("Uploading clip buffer to server directory...");
      const uploadFormData = new FormData();
      const clipFile = new File([clipBlob], `${activeClip.title.replace(/[^a-zA-Z0-9]/g, "_")}.mp4`, { type: "video/mp4" });
      uploadFormData.append("file", clipFile);
      uploadFormData.append("clipId", activeClip.id);

      const uploadRes = await fetch(`/api/projects/${projectId}/publish-media`, {
        method: "POST",
        body: uploadFormData,
      });

      if (!uploadRes.ok) {
        let errorMsg = "Failed to store media buffer on the server.";
        try {
          const contentType = uploadRes.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const uploadData = await uploadRes.json();
            errorMsg = uploadData.error || errorMsg;
          } else {
            const text = await uploadRes.text();
            errorMsg = text.slice(0, 150) || errorMsg;
          }
        } catch {}
        throw new Error(errorMsg);
      }

      const uploadResult = await uploadRes.json();
      const mediaPath = uploadResult.path;

      // Reset generated share link
      setGeneratedShareUrl(null);
      setGeneratedPlatform("");

      // 4. Record and trigger publishes for each selected platform
      const platforms = [];
      if (publishInstagram) platforms.push("Instagram");
      if (publishYoutube) platforms.push("YouTube");

      let shareUrlFound = "";
      let lastPlatform = "";
      let directPublishCount = 0;
      let webhookPublishCount = 0;

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
          let errorMsg = `Failed to trigger publishing for ${platform}`;
          try {
            const contentType = publishRes.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const publishData = await publishRes.json();
              errorMsg = publishData.error || errorMsg;
            } else {
              const text = await publishRes.text();
              errorMsg = text.slice(0, 150) || errorMsg;
            }
          } catch {}
          throw new Error(errorMsg);
        }

        const publishData = await publishRes.json();
        if (publishData.success && publishData.record) {
          if (publishData.record.status === "FAILED") {
            throw new Error(publishData.record.error || `Failed to publish to ${platform}.`);
          }
          const isShareLink = (platform === "Instagram" && !igConnected && !webhookConfigured) || 
                              (platform === "YouTube" && !ytConnected && !webhookConfigured) ||
                              (publishData.record.postUrl && (publishData.record.postUrl.includes("transfer.sh") || publishData.record.postUrl.includes("0x0.st")));
          if (isShareLink && publishData.record.postUrl) {
            shareUrlFound = publishData.record.postUrl;
            lastPlatform = platform;
          } else {
            if ((platform === "Instagram" && igConnected) || (platform === "YouTube" && ytConnected)) {
              directPublishCount++;
            } else if (webhookConfigured) {
              webhookPublishCount++;
            }
          }
        } else {
          throw new Error(publishData.error || publishData.record?.error || `Failed to publish to ${platform}.`);
        }
      }

      if (shareUrlFound) {
        setGeneratedShareUrl(shareUrlFound);
        setGeneratedPlatform(lastPlatform);
        setSuccessMsg("Clip compiled and upload link generated successfully! Scan the QR code or copy the link below.");
      } else {
        if (publishMode === "schedule") {
          setSuccessMsg("Clip scheduled successfully! You can verify scheduling details in logs.");
        } else if (directPublishCount > 0 && webhookPublishCount === 0) {
          setSuccessMsg("Clip published successfully directly to your connected channel(s)!");
        } else if (directPublishCount > 0 && webhookPublishCount > 0) {
          setSuccessMsg("Clip published successfully! Check your connected channel(s) and Make.com webhook triggers.");
        } else {
          setSuccessMsg("Clip published successfully! Check Make.com webhook triggers and platform URLs.");
        }
      }
      
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

      {/* AI Hook Analyzer & CTR Insights */}
      {(viralityScore !== null || hookAnalysis || ctrHooks.length > 0) && (
        <div className="rounded-xl border border-violet-500/20 bg-slate-950/40 p-4 space-y-4 animate-in fade-in duration-300">
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5 border-b border-border/10 pb-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            AI Virality & Hook Analytics
          </h4>
          
          <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start justify-between">
            {/* Virality Score Ring */}
            {viralityScore !== null && (
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className="relative h-16 w-16 flex items-center justify-center rounded-full bg-slate-900 border-2 border-dashed border-border/40">
                  <span className={`text-base font-extrabold ${
                    viralityScore >= 85 
                      ? "text-emerald-400" 
                      : viralityScore >= 70 
                        ? "text-amber-400" 
                        : "text-rose-400"
                  }`}>
                    {viralityScore}
                  </span>
                  <div className="absolute inset-0 rounded-full border-2 border-violet-500/20 pointer-events-none" />
                </div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Virality Score</span>
              </div>
            )}

            {/* Hook Analysis text */}
            {hookAnalysis && (
              <div className="flex-1 space-y-1 w-full text-left">
                <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wider block">Hook Strength Assessment</span>
                <p className="text-[11px] text-slate-300 leading-relaxed italic">
                  &ldquo;{hookAnalysis}&rdquo;
                </p>
              </div>
            )}
          </div>

          {/* Alternative Clickbait Hook suggestions */}
          {ctrHooks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border/10">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Alternative Viral Hooks (High CTR)</span>
              <div className="grid grid-cols-1 gap-2">
                {ctrHooks.map((hook, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 bg-slate-900/60 border border-border/20 rounded-lg p-2 px-3 text-[11px] text-white">
                    <span className="truncate">{hook}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(hook);
                        alert("Hook copied to clipboard!");
                      }}
                      className="h-6 px-2 text-[9px] font-bold text-violet-400 hover:text-violet-300 rounded cursor-pointer"
                    >
                      Copy
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Generated Shareable Link Card */}
      {generatedShareUrl && (
        <div className="rounded-xl border border-violet-500/40 bg-slate-950/60 p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-start justify-between border-b border-border/10 pb-3">
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-violet-400" />
                Your {generatedPlatform} Clip is Ready!
              </h4>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Scan the QR code or copy the link to post it manually.
              </p>
            </div>
            <button
              onClick={() => setGeneratedShareUrl(null)}
              className="text-muted-foreground hover:text-white text-[10px] font-bold"
            >
              Clear
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5 bg-slate-900/40 p-4 rounded-xl border border-border/20">
            {/* QR Code */}
            <div className="bg-white p-2 rounded-lg shrink-0 shadow-md">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(generatedShareUrl)}`}
                alt="QR Code"
                className="h-[120px] w-[120px]"
              />
            </div>

            {/* Link & Instructions */}
            <div className="flex-1 space-y-3.5 w-full">
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase">Download Link</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedShareUrl}
                    className="flex-1 bg-slate-950/60 border border-border/30 rounded-lg px-3 py-1.5 text-[10px] font-mono text-white focus:outline-none"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedShareUrl);
                      alert("Download link copied to clipboard!");
                    }}
                    className="h-8 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold cursor-pointer"
                  >
                    Copy Link
                  </Button>
                </div>
              </div>

              {/* Quick actions for captions/hashtags */}
              <div className="flex flex-wrap gap-2">
                {generatedPlatform === "Instagram" && instagramCaption && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(instagramCaption);
                      alert("Instagram caption copied to clipboard!");
                    }}
                    className="h-7.5 px-3 rounded-lg border-border/40 hover:bg-white/5 text-[10px] font-bold cursor-pointer"
                  >
                    Copy Caption
                  </Button>
                )}
                {generatedPlatform === "Instagram" && instagramHashtags && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(instagramHashtags);
                      alert("Instagram hashtags copied to clipboard!");
                    }}
                    className="h-7.5 px-3 rounded-lg border-border/40 hover:bg-white/5 text-[10px] font-bold cursor-pointer"
                  >
                    Copy Hashtags
                  </Button>
                )}
                {generatedPlatform === "YouTube" && youtubeDescription && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(youtubeDescription);
                      alert("YouTube description copied to clipboard!");
                    }}
                    className="h-7.5 px-3 rounded-lg border-border/40 hover:bg-white/5 text-[10px] font-bold cursor-pointer"
                  >
                    Copy Description
                  </Button>
                )}
                {generatedPlatform === "YouTube" && youtubeHashtags && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(youtubeHashtags);
                      alert("YouTube hashtags copied to clipboard!");
                    }}
                    className="h-7.5 px-3 rounded-lg border-border/40 hover:bg-white/5 text-[10px] font-bold cursor-pointer"
                  >
                    Copy Hashtags
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1 bg-violet-500/5 p-3.5 rounded-xl border border-violet-500/10">
            <h5 className="font-bold text-slate-200">How to publish to {generatedPlatform}:</h5>
            <ol className="list-decimal list-inside space-y-0.5 text-slate-300">
              <li>Scan the QR code with your phone or open the link to download the video.</li>
              <li>Click &quot;Copy Caption&quot; / &quot;Copy Description&quot; to copy your curated text.</li>
              <li>Open {generatedPlatform}, select Reels/Shorts, upload the video, and paste!</li>
            </ol>
          </div>
        </div>
      )}

      {/* Main Form Fields */}
      <form onSubmit={handlePublish} className="space-y-6">
        {/* Connection handles status */}
        <div className="flex gap-2">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            igConnected 
              ? "bg-pink-500/10 text-pink-400 border-pink-500/20" 
              : webhookConfigured
                ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                : "bg-slate-900 text-slate-400 border-border/20"
          }`}>
            Instagram Reel: {igConnected ? "Ready (Direct)" : webhookConfigured ? "Ready (Make.com)" : "Manual Share Link"}
          </span>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            ytConnected 
              ? "bg-rose-500/10 text-rose-400 border-rose-500/20" 
              : webhookConfigured
                ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                : "bg-slate-900 text-slate-400 border-border/20"
          }`}>
            YouTube Shorts: {ytConnected ? "Ready (Direct)" : webhookConfigured ? "Ready (Make.com)" : "Manual Share Link"}
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
        
        {compiledVideoUrl && (
          <div className="pt-3 animate-in fade-in duration-200">
            <Button
              type="button"
              onClick={() => {
                const a = document.createElement("a");
                a.href = compiledVideoUrl;
                a.download = compiledVideoName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white py-4 flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 active:scale-95 transition-all cursor-pointer"
            >
              <Download className="h-4 w-4 text-white" />
              <span>Download Compiled MP4 (Local)</span>
            </Button>
          </div>
        )}
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
                          {job.postUrl.includes("transfer.sh") || 
                           job.postUrl.includes("0x0.st") || 
                           job.postUrl.includes("temp_publishes") || 
                           job.postUrl.includes("localhost")
                            ? "Download Link"
                            : "View Post"
                          }
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
