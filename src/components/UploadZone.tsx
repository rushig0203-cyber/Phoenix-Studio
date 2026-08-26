"use strict";
"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { 
  Upload, 
  FileVideo, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Search, 
  Sparkles, 
  Download,
  Video,
  ExternalLink,
  RefreshCw,
  Send,
  Check,
  Play
} from "lucide-react";
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

interface UploadZoneProps {
  onUploadStart?: (fileName: string) => void;
  onUploadComplete?: (projectData: {
    title: string;
    duration: number;
    size: string;
    file: File;
  }) => void;
}

export default function UploadZone({ onUploadStart, onUploadComplete }: UploadZoneProps) {
  const [uploadTab, setUploadTab] = useState<"local" | "pexels" | "pixabay">("local");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Live Pexels states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [stockVideos, setStockVideos] = useState<any[]>([]);
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [pexelsApiKey, setPexelsApiKey] = useState("");
  const [pixabayApiKey, setPixabayApiKey] = useState("");
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [stockPage, setStockPage] = useState(1);
  const [importedPexelsIds, setImportedPexelsIds] = useState<string[]>([]);
  const [previewVideo, setPreviewVideo] = useState<any | null>(null);

  // Direct Publish Modal States
  const [publishingVideo, setPublishingVideo] = useState<any | null>(null);
  const [publishPlatform, setPublishPlatform] = useState<"YouTube" | "Instagram">("Instagram");
  const [directCaption, setDirectCaption] = useState("");
  const [directHashtags, setDirectHashtags] = useState("");
  const [directYtTitle, setDirectYtTitle] = useState("");
  const [directYtDesc, setDirectYtDesc] = useState("");
  const [directYtTags, setDirectYtTags] = useState("");
  const [isDirectPublishing, setIsDirectPublishing] = useState(false);
  const [isGeneratingDirectAI, setIsGeneratingDirectAI] = useState(false);
  const [directPublishProgress, setDirectPublishProgress] = useState(0);
  const [directPublishStatus, setDirectPublishStatus] = useState("");
  const [directPublishError, setDirectPublishError] = useState("");
  const [directPublishSuccess, setDirectPublishSuccess] = useState(false);
  const [directPostUrl, setDirectPostUrl] = useState("");
  const [directDownloadUrl, setDirectDownloadUrl] = useState("");

  const handleCloseDirectPublish = () => {
    if (directDownloadUrl) {
      URL.revokeObjectURL(directDownloadUrl);
    }
    setDirectDownloadUrl("");
    setPublishingVideo(null);
  };

  const handleOpenDirectPublish = (video: any) => {
    setPublishingVideo(video);
    setDirectPublishError("");
    setDirectPublishSuccess(false);
    setDirectPublishProgress(0);
    setDirectPublishStatus("");
    setDirectPostUrl("");
    setDirectDownloadUrl("");
    
    // Set default fields
    setDirectYtTitle(video.title.slice(0, 70));
    setDirectYtDesc(`Check out this trending stock clip! #${video.category || "stock"} #viral`);
    setDirectYtTags(video.category || "stock");
    setDirectCaption(`Check out this trending stock video!`);
    setDirectHashtags(`#${video.category || "stock"} #reels #viral`);
  };

  const handleDirectAIAssist = async () => {
    if (!publishingVideo) return;
    setIsGeneratingDirectAI(true);
    setDirectPublishError("");
    try {
      const res = await fetch("/api/clips/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: publishingVideo.title,
          transcript: `This is a trending stock video about "${publishingVideo.title}". It displays beautiful content in the "${publishingVideo.category}" category.`,
          keywords: [publishingVideo.category || "stock", "trending", "visuals"],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (publishPlatform === "YouTube") {
          setDirectYtTitle(data.youtubeTitle?.slice(0, 70) || publishingVideo.title.slice(0, 70));
          setDirectYtDesc(data.youtubeDescription || "");
          setDirectYtTags(data.youtubeHashtags?.replace(/#/g, "").split(" ").join(", ") || "");
        } else {
          setDirectCaption(data.instagramCaption || "");
          setDirectHashtags(data.instagramHashtags || "");
        }
      } else {
        throw new Error("AI Curate API returned an error status.");
      }
    } catch (err: any) {
      setDirectPublishError("Failed to generate AI assets. Please enter details manually.");
    } finally {
      setIsGeneratingDirectAI(false);
    }
  };

  const handleExecuteDirectPublish = async () => {
    if (!publishingVideo) return;
    
    setIsDirectPublishing(true);
    setDirectPublishError("");
    setDirectPublishSuccess(false);
    setDirectPublishProgress(15);
    setDirectPublishStatus("Downloading stock video from provider...");

    try {
      // 1. Download the stock video via local proxy to bypass CORS
      const downloadRes = await fetch(`/api/stock/proxy?url=${encodeURIComponent(publishingVideo.url)}`);
      if (!downloadRes.ok) {
        throw new Error("Failed to download video file buffer from provider CDN.");
      }
      
      setDirectPublishProgress(45);
      setDirectPublishStatus("Preparing video stream buffer...");
      const videoBlob = await downloadRes.blob();
      try {
        const blobUrl = URL.createObjectURL(videoBlob);
        setDirectDownloadUrl(blobUrl);
      } catch (blobErr) {
        console.warn("Failed to create direct download URL:", blobErr);
      }
      
      // 2. Upload the video stream to server local folder
      const projId = "proj_direct_" + Math.random().toString(36).substring(2, 11);
      const filename = `${projId}.mp4`;
      const file = new File([videoBlob], filename, { type: "video/mp4" });
      
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);
      uploadFormData.append("fileName", filename);

      setDirectPublishProgress(65);
      setDirectPublishStatus("Saving video buffer to server filesystem...");
      
      const saveRes = await fetch(`/api/projects/${projId}/save-local`, {
        method: "POST",
        body: uploadFormData,
      });

      if (!saveRes.ok) {
        throw new Error("Failed to store media stream on server storage.");
      }
      
      const { path: mediaPath } = await saveRes.json();

      // 3. Dispatch to publisher queue
      setDirectPublishProgress(85);
      setDirectPublishStatus("Initializing publishing event pipeline...");

      const publishRes = await fetch(`/api/projects/${projId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: `clip_${Date.now()}`,
          clipTitle: publishingVideo.title,
          platform: publishPlatform,
          scheduledFor: null, // Publish immediately
          caption: publishPlatform === "Instagram" ? directCaption : null,
          hashtags: publishPlatform === "Instagram" ? directHashtags : null,
          youtubeTitle: publishPlatform === "YouTube" ? directYtTitle : null,
          youtubeDesc: publishPlatform === "YouTube" ? directYtDesc : null,
          youtubeTags: publishPlatform === "YouTube" ? directYtTags : null,
          mediaPath,
        }),
      });

      if (!publishRes.ok) {
        const errData = await publishRes.json();
        throw new Error(errData.error || "Publish service returned an error status.");
      }

      const publishData = await publishRes.json();
      if (!publishData.success) {
        throw new Error(publishData.record?.error || "Publish action failed.");
      }

      setDirectPublishProgress(100);
      setDirectPublishStatus("Successfully published video!");
      setDirectPublishSuccess(true);
      setDirectPostUrl(publishData.record?.postUrl || `https://instagram.com/reel/mock_post`);
    } catch (err: any) {
      console.error("Direct publish failed:", err);
      setDirectPublishError(err.message || "An unexpected error occurred during direct publishing.");
    } finally {
      setIsDirectPublishing(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load Settings from database on client-side mount & reactive to tab selections
  useEffect(() => {
    async function initSettingsAndIds() {
      let localPexels = "";
      let localPixabay = "";
      if (typeof window !== "undefined") {
        localPexels = localStorage.getItem("auraclip_pexels_api_key") || "";
        localPixabay = localStorage.getItem("auraclip_pixabay_api_key") || "";
      }

      try {
        const res = await fetch("/api/settings/publish");
        if (res.ok) {
          const data = await res.json();
          const pexels = data.pexelsApiKey || localPexels;
          const pixabay = data.pixabayApiKey || localPixabay;
          setPexelsApiKey(pexels);
          setPixabayApiKey(pixabay);
          
          if (uploadTab === "pixabay" && pixabay) {
            setIsLiveMode(true);
          } else if (uploadTab === "pexels" && pexels) {
            setIsLiveMode(true);
          } else {
            setIsLiveMode(false);
          }
        }
      } catch (err) {
        console.error("Failed to fetch settings in UploadZone:", err);
      }

      if (typeof window !== "undefined") {
        const imported = JSON.parse(localStorage.getItem("auraclip_imported_pexels_ids") || "[]");
        setImportedPexelsIds(imported);
      }
    }
    
    initSettingsAndIds();
  }, [uploadTab]);

  useEffect(() => {
    if (uploadTab === "pexels" && pexelsApiKey) {
      setIsLiveMode(true);
    } else if (uploadTab === "pixabay" && pixabayApiKey) {
      setIsLiveMode(true);
    } else {
      setIsLiveMode(false);
    }
  }, [uploadTab, pexelsApiKey, pixabayApiKey]);

  // Fetch Stock Videos from API proxy
  const fetchStockVideos = async (
    queryVal = searchQuery,
    categoryVal = selectedCategory,
    pageVal = stockPage,
    providerVal = uploadTab
  ) => {
    setIsLoadingStock(true);
    setError(null);
    try {
      const provider = providerVal === "pixabay" ? "pixabay" : "pexels";
      const key = provider === "pixabay" ? pixabayApiKey : pexelsApiKey;
      const url = `/api/stock/${provider}?apiKey=${encodeURIComponent(key)}&query=${encodeURIComponent(queryVal)}&category=${encodeURIComponent(categoryVal)}&page=${pageVal}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setStockVideos(data.videos || []);
        setIsLiveMode(data.source === "live-pexels" || data.source === "live-pixabay");
      } else {
        throw new Error("Failed to load stock list");
      }
    } catch (err) {
      console.error("AuraClip: Failed to query stock videos:", err);
      setError("Failed to fetch stock videos. Try checking your API connection.");
    } finally {
      setIsLoadingStock(false);
    }
  };

  const handleRefreshStock = () => {
    const nextPage = Math.floor(Math.random() * 10) + 1;
    setStockPage(nextPage);
    fetchStockVideos(searchQuery, selectedCategory, nextPage, uploadTab);
  };

  // Debounced auto-fetch
  useEffect(() => {
    if (uploadTab === "pexels" || uploadTab === "pixabay") {
      setStockPage(1);
      const fetchTimer = setTimeout(() => {
        fetchStockVideos(searchQuery, selectedCategory, 1, uploadTab);
      }, 350);
      return () => clearTimeout(fetchTimer);
    }
  }, [uploadTab, searchQuery, selectedCategory]);

  // Validate and start local file upload
  const processFile = (file: File) => {
    setError(null);
    
    // Validate format
    const validTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|avi|webm)$/i)) {
      setError("Unsupported format. Please upload MP4, MOV, AVI, or WebM.");
      return;
    }

    // Validate size (5GB max)
    const maxSize = 5 * 1024 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("File is too large. Maximum file size is 5GB.");
      return;
    }

    setFileName(file.name);
    setIsUploading(true);
    setUploadProgress(0);

    if (onUploadStart) {
      onUploadStart(file.name);
    }

    // Mock progress increment
    let progress = 0;
    progressIntervalRef.current = setInterval(() => {
      progress += Math.floor(Math.random() * 8) + 4; // increment between 4% and 12%
      if (progress >= 100) {
        progress = 100;
        setUploadProgress(100);
        clearInterval(progressIntervalRef.current!);
        
        // Complete mock upload after short delay
        setTimeout(() => {
          setIsUploading(false);
          if (onUploadComplete) {
            const mockDuration = Math.floor(Math.random() * 270) + 30;
            const sizeInMb = (file.size / (1024 * 1024)).toFixed(1) + " MB";
            
            onUploadComplete({
              title: file.name.replace(/\.[^/.]+$/, ""), // remove extension
              duration: mockDuration,
              size: sizeInMb,
              file,
            });
          }
        }, 600);
      } else {
        setUploadProgress(progress);
      }
    }, 250);
  };

  // Direct fetch import for Stock Videos
  const handleImportStock = async (videoId: string, videoUrl: string, title: string, duration: number) => {
    setError(null);
    setIsUploading(true);
    const providerName = uploadTab === "pixabay" ? "Pixabay" : "Pexels";
    setFileName(`${providerName} Stock: ${title}`);
    setUploadProgress(10);

    if (onUploadStart) {
      onUploadStart(title);
    }

    try {
      setUploadProgress(30);
      // Fetch via server-side proxy to bypass browser CORS blocks
      const res = await fetch(`/api/stock/proxy?url=${encodeURIComponent(videoUrl)}`);
      setUploadProgress(60);
      
      let blob: Blob;
      if (res.ok) {
        blob = await res.blob();
      } else {
        throw new Error("Proxy fetch failed");
      }
      
      setUploadProgress(90);
      const filename = `${title.toLowerCase().replace(/[^a-z0-9]/g, "_")}.mp4`;
      const file = new File([blob], filename, { type: "video/mp4" });
      setUploadProgress(100);

      setTimeout(() => {
        setIsUploading(false);
        // Save imported videoId to localstorage history so it is hidden next time
        const updatedImported = [...importedPexelsIds, videoId];
        setImportedPexelsIds(updatedImported);
        localStorage.setItem("auraclip_imported_pexels_ids", JSON.stringify(updatedImported));

        if (onUploadComplete) {
          onUploadComplete({
            title: `${providerName}: ${title}`,
            duration,
            size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
            file
          });
        }
      }, 500);

    } catch (err) {
      console.warn("Stock fetch fallback to local placeholder activated:", err);
      // Fallback to local placeholder.mp4 to guarantee a valid decodable video file
      try {
        setUploadProgress(70);
        const res = await fetch("/placeholder.mp4");
        setUploadProgress(90);
        const blob = await res.blob();
        const filename = `${title.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${providerName.toLowerCase()}.mp4`;
        const file = new File([blob], filename, { type: "video/mp4" });
        setUploadProgress(100);

        setTimeout(() => {
          setIsUploading(false);
          // Save imported videoId to localstorage history so it is hidden next time
          const updatedImported = [...importedPexelsIds, videoId];
          setImportedPexelsIds(updatedImported);
          localStorage.setItem("auraclip_imported_pexels_ids", JSON.stringify(updatedImported));

          if (onUploadComplete) {
            onUploadComplete({
              title: `${providerName}: ${title}`,
              duration,
              size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
              file
            });
          }
        }, 500);
      } catch (fallbackErr) {
        console.error("AuraClip: Fallback download failed:", fallbackErr);
        setError("Failed to download video. Please check your network connection.");
        setIsUploading(false);
      }
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const cancelUpload = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    setIsUploading(false);
    setUploadProgress(0);
    setFileName("");
    setError(null);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full space-y-5">
      {/* Upload category switch tabs */}
      {!isUploading && (
        <div className="flex bg-slate-900 border border-border/40 rounded-xl p-1 max-w-md w-full shadow-inner">
          <button
            type="button"
            onClick={() => setUploadTab("local")}
            className={`flex-1 text-center py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              uploadTab === "local"
                ? "bg-violet-600 text-white shadow-lg"
                : "text-muted-foreground hover:text-white"
            }`}
          >
            Local File
          </button>
          <button
            type="button"
            onClick={() => setUploadTab("pexels")}
            className={`flex-1 text-center py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
              uploadTab === "pexels"
                ? "bg-violet-600 text-white shadow-lg"
                : "text-muted-foreground hover:text-white"
            }`}
          >
            <Sparkles className="h-3 w-3 text-yellow-300 animate-pulse" />
            Pexels Stock
          </button>
          <button
            type="button"
            onClick={() => setUploadTab("pixabay")}
            className={`flex-1 text-center py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
              uploadTab === "pixabay"
                ? "bg-violet-600 text-white shadow-lg"
                : "text-muted-foreground hover:text-white"
            }`}
          >
            <Sparkles className="h-3 w-3 text-emerald-400 animate-pulse" />
            Pixabay Stock
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {isUploading ? (
          // Active Uploading/Importing Progress Panel
          <motion.div
            key="progress"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="relative rounded-2xl border border-border/40 bg-white/5 p-8 text-left shadow-lg backdrop-blur-md"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 shrink-0 animate-pulse">
                  <FileVideo className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate max-w-[250px] sm:max-w-[400px]">
                    {fileName}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    {uploadProgress < 100 ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
                        Downloading and preparing for edit timeline...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        Import complete! Loading Pro Studio...
                      </>
                    )}
                  </p>
                </div>
              </div>

              <button
                onClick={cancelUpload}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5 hover:text-white transition-colors border-0 bg-transparent cursor-pointer"
                title="Cancel upload"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Progress Bar Container */}
            <div className="mt-6">
              <div className="flex justify-between items-center text-xs font-semibold text-white mb-2">
                <span>Importing status</span>
                <span className="bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">
                  {uploadProgress}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 via-indigo-500 to-fuchsia-500"
                  initial={{ width: "0%" }}
                  animate={{ width: `${uploadProgress}%` }}
                  transition={{ ease: "easeOut" }}
                />
              </div>
            </div>
          </motion.div>
        ) : uploadTab === "local" ? (
          // Drag & Drop Local Upload
          <motion.div
            key="dropzone"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileInput}
            className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 md:p-12 text-center cursor-pointer transition-all duration-300 ${
              isDragActive
                ? "border-violet-500 bg-violet-500/5 shadow-inner"
                : "border-border/40 bg-white/5 hover:border-violet-500/50 hover:bg-white/10"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="hidden"
            />
            
            {/* Hover mesh gradient */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-violet-600/5 to-fuchsia-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10 text-violet-400 group-hover:scale-110 group-hover:bg-violet-500/20 transition-all duration-300">
              <Upload className="h-6 w-6" />
            </div>

            <h3 className="mt-4 text-base font-semibold text-white">
              Drag and drop your video file
            </h3>
            <p className="mt-2 text-xs text-muted-foreground max-w-sm leading-relaxed">
              Support MP4, MOV, AVI, and WebM. Up to 5GB.
            </p>

            <div className="mt-6">
              <Button
                type="button"
                variant="outline"
                className="rounded-full px-6 border-border/40 hover:bg-white/5 hover:text-white"
              >
                Browse Files
              </Button>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-center gap-1.5 text-xs text-rose-400"
                onClick={(e) => e.stopPropagation()}
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </motion.div>
        ) : (
          // Pexels Stock Video Search Grid
          <motion.div
            key={uploadTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4 text-left"
          >
            {/* API Key Connection Status Banner */}
            {!isLiveMode && (
              <div className="bg-violet-950/20 border border-violet-500/20 text-violet-300 rounded-xl p-3.5 text-[10px] leading-relaxed flex items-center justify-between gap-3 animate-in fade-in duration-200">
                <div>
                  <span className="font-extrabold text-white block mb-0.5 flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-yellow-300" />
                    CURATED DEMO MODE
                  </span>
                  To search and download the entire {uploadTab === "pixabay" ? "Pixabay" : "Pexels"} trending stock collection directly in real-time, connect your free API key.
                </div>
                <Link href="/dashboard/settings" className="shrink-0">
                  <Button size="sm" className="bg-violet-600 hover:bg-violet-500 text-white font-bold text-[9px] h-7 px-3.5 rounded-lg cursor-pointer">
                    Setup Key
                  </Button>
                </Link>
              </div>
            )}

            {/* Search and Filters row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={isLiveMode ? `Search live ${uploadTab === "pixabay" ? "Pixabay" : "Pexels"} stock video library...` : "Filter curated stock video collection..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border/40 bg-slate-950/40 pl-9 pr-4 py-2 text-xs text-white placeholder-muted-foreground focus:border-violet-500 focus:outline-none transition-all duration-200"
                />
              </div>

              {/* Category Quick Tags */}
              <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0 items-center">
                {isLiveMode && (
                  <Button
                    type="button"
                    onClick={handleRefreshStock}
                    variant="outline"
                    className="text-[9px] font-bold px-3 py-0 h-7 rounded-lg border border-violet-500/20 bg-slate-900/40 text-violet-400 hover:text-white hover:bg-violet-600 transition-all shrink-0 cursor-pointer flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3 shrink-0" />
                    Refresh
                  </Button>
                )}
                {["all", "coding", "sunset", "office", "fitness", "city"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border capitalize shrink-0 cursor-pointer ${
                      selectedCategory === cat
                        ? "border-violet-500 bg-violet-600/10 text-white font-bold"
                        : "border-border/30 bg-slate-900/40 text-muted-foreground hover:text-white"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid list of stock videos */}
            {isLoadingStock ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-medium">
                <Loader2 className="h-6 w-6 animate-spin text-violet-400 mb-2" />
                Searching live {uploadTab === "pixabay" ? "Pixabay" : "Pexels"} community...
              </div>
            ) : (() => {
              const filteredVideos = stockVideos.filter((v: any) => !importedPexelsIds.includes(v.id));
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
                  {filteredVideos.length > 0 ? (
                    filteredVideos.map((video) => (
                      <div 
                        key={video.id}
                        className="group border border-border/40 bg-card/40 backdrop-blur-sm rounded-xl overflow-hidden hover:border-violet-500/50 transition-all duration-300 flex flex-col justify-between"
                      >
                        {/* Thumbnail representation with Play Hover Preview */}
                        <div 
                          onClick={() => setPreviewVideo(video)}
                          className="relative aspect-video w-full bg-slate-900 overflow-hidden flex items-center justify-center cursor-pointer group/thumb"
                        >
                          <img
                            src={video.thumbnail}
                            alt={video.title}
                            crossOrigin="anonymous"
                            className="h-full w-full object-cover group-hover/thumb:scale-105 transition-transform duration-300"
                            referrerPolicy="no-referrer"
                          />
                          
                          {/* Hover Play Icon overlay */}
                          <div className="absolute inset-0 bg-black/45 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center z-10">
                            <div className="h-10 w-10 rounded-full bg-violet-600/90 text-white flex items-center justify-center shadow-lg transform scale-90 group-hover/thumb:scale-100 transition-transform duration-300">
                              <Play className="h-4.5 w-4.5 fill-current ml-0.5" />
                            </div>
                          </div>

                          <span className="absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[8px] font-bold text-white font-mono z-20">
                            {video.duration}s
                          </span>
                          <span className="absolute top-1.5 left-1.5 bg-violet-600 text-white px-1.5 py-0.5 rounded text-[7px] font-extrabold uppercase tracking-wide z-20">
                            {isLiveMode ? (uploadTab === "pixabay" ? "Live Pixabay" : "Live Pexels") : "Curated"}
                          </span>
                        </div>

                        {/* Metadata and button */}
                        <div className="p-3 space-y-3 flex-grow flex flex-col justify-between">
                          <h4 className="text-[11px] font-bold text-white leading-tight line-clamp-1" title={video.title}>
                            {video.title}
                          </h4>
                          
                          <div className="flex gap-2 w-full">
                            <Button
                              type="button"
                              onClick={() => handleImportStock(video.id, video.url, video.title, video.duration)}
                              className="flex-1 h-7 text-[9px] font-bold bg-white/5 border border-border/30 hover:bg-white/10 text-white rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Import & Edit
                            </Button>
                            <Button
                              type="button"
                              onClick={() => handleOpenDirectPublish(video)}
                              className="flex-1 h-7 text-[9px] font-bold bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Send className="h-3.5 w-3.5" />
                              Publish
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full py-12 text-center text-xs text-muted-foreground">
                      No new videos match your query. Clear filters or hit Refresh to see other clips!
                    </div>
                  )}
                </div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Direct Publish Modal Overlay */}
      {publishingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200 text-left">
          <div className="bg-slate-900 border border-border/40 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="p-5 flex items-center justify-between border-b border-border/20 bg-gradient-to-r from-pink-600/20 to-orange-600/20">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-600 to-rose-600 text-white font-extrabold text-xs">
                  <Send className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Direct Social Publisher</h3>
                  <p className="text-[10px] text-slate-400">Publish stock video instantly without editing</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => { if (!isDirectPublishing) handleCloseDirectPublish(); }} 
                className="text-slate-500 hover:text-white transition-colors disabled:opacity-40"
                disabled={isDirectPublishing}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 overflow-y-auto flex-grow space-y-5 text-xs text-slate-300">
              {directPublishSuccess ? (
                // Success State
                <div className="text-center py-8 space-y-4 animate-in scale-in-95 duration-200">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Reel/Short Successfully Published!</h4>
                    <p className="text-[10px] text-muted-foreground mt-1">Your video is now live on social media.</p>
                  </div>
                  {directPostUrl && (
                    <a
                      href={directPostUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-pink-400 hover:underline bg-pink-500/5 px-4 py-2 rounded-xl border border-pink-500/20 mt-2"
                    >
                      View Live Post <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <div className="pt-4">
                    <Button 
                      type="button" 
                      onClick={handleCloseDirectPublish} 
                      className="w-full h-9 rounded-xl bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold cursor-pointer"
                    >
                      Done
                    </Button>
                  </div>
                </div>
              ) : isDirectPublishing ? (
                // Progress/Publishing State
                <div className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
                  <div>
                    <h4 className="text-sm font-bold text-white">{directPublishStatus}</h4>
                    <p className="text-[10px] text-muted-foreground mt-1">Please keep this window open while we process.</p>
                  </div>
                  <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden max-w-xs">
                    <div className="bg-gradient-to-r from-pink-500 to-rose-500 h-full rounded-full transition-all duration-300" style={{ width: `${directPublishProgress}%` }} />
                  </div>
                </div>
              ) : (
                // Setup & Form State
                <div className="space-y-4">
                  
                  {/* Select Destination Platform */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Publish Destination</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setPublishPlatform("Instagram"); setDirectPublishError(""); }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          publishPlatform === "Instagram"
                            ? "border-pink-500/30 bg-pink-500/10 text-pink-400 shadow-md shadow-pink-900/10"
                            : "border-border/30 bg-slate-950/40 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <Instagram className="h-4 w-4" />
                        Instagram Reels
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPublishPlatform("YouTube"); setDirectPublishError(""); }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          publishPlatform === "YouTube"
                            ? "border-rose-500/30 bg-rose-500/10 text-rose-500 shadow-md shadow-rose-900/10"
                            : "border-border/30 bg-slate-950/40 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <Youtube className="h-4 w-4" />
                        YouTube Shorts
                      </button>
                    </div>
                  </div>

                  {/* AI Copywriting Assist Card */}
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 flex items-center justify-between gap-4">
                    <div className="text-left">
                      <h4 className="text-xs font-bold text-white flex items-center gap-1">
                        <Sparkles className="h-3.5 w-3.5 text-fuchsia-400 animate-pulse" />
                        AI Social Curator
                      </h4>
                      <p className="text-[10px] text-muted-foreground leading-normal mt-0.5 max-w-[250px]">
                        Auto-generate viral copywriting, descriptions, and hashtags tailored for this video.
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={handleDirectAIAssist}
                      disabled={isGeneratingDirectAI}
                      className="h-8 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50 shrink-0 border-0"
                    >
                      {isGeneratingDirectAI ? (
                        <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Generating...</>
                      ) : (
                        <><Sparkles className="h-3 w-3 mr-1" /> Curate Assets</>
                      )}
                    </Button>
                  </div>

                  {/* Platform-Specific Form Fields */}
                  {publishPlatform === "Instagram" ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-300">Reels Caption</label>
                        <textarea
                          rows={3}
                          placeholder="Attention grabbing Reels caption..."
                          value={directCaption}
                          onChange={(e) => setDirectCaption(e.target.value)}
                          className="w-full rounded-xl border border-border/40 bg-slate-950/40 p-3 text-xs text-white focus:border-pink-500/40 focus:outline-none placeholder-slate-700"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-300">Hashtags</label>
                        <input
                          type="text"
                          placeholder="#viral #reels #trend"
                          value={directHashtags}
                          onChange={(e) => setDirectHashtags(e.target.value)}
                          className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-3.5 py-2.5 text-xs text-white focus:border-pink-500/40 focus:outline-none placeholder-slate-700 font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-300">Shorts Title (max 70 chars)</label>
                        <input
                          type="text"
                          maxLength={70}
                          placeholder="YouTube Short Title..."
                          value={directYtTitle}
                          onChange={(e) => setDirectYtTitle(e.target.value)}
                          className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-3.5 py-2.5 text-xs text-white focus:border-rose-500/40 focus:outline-none placeholder-slate-700 font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-300">Description</label>
                        <textarea
                          rows={2}
                          placeholder="Short description details..."
                          value={directYtDesc}
                          onChange={(e) => setDirectYtDesc(e.target.value)}
                          className="w-full rounded-xl border border-border/40 bg-slate-950/40 p-3 text-xs text-white focus:border-rose-500/40 focus:outline-none placeholder-slate-700"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-300">Search Tags (comma-separated)</label>
                        <input
                          type="text"
                          placeholder="tag1, tag2, tag3"
                          value={directYtTags}
                          onChange={(e) => setDirectYtTags(e.target.value)}
                          className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-3.5 py-2.5 text-xs text-white focus:border-rose-500/40 focus:outline-none placeholder-slate-700 font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {/* Error display */}
                  {directPublishError && (
                    <div className="space-y-2">
                      <div className="p-3 rounded-xl border border-rose-500/20 bg-rose-500/5 text-[11px] text-rose-400">
                        ⚠️ {directPublishError}
                      </div>
                      {directDownloadUrl && (
                        <a
                          href={directDownloadUrl}
                          download={`${publishingVideo.title.replace(/[^a-zA-Z0-9\s-_]/g, "").replace(/\s+/g, "_")}.mp4`}
                          className="w-full h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download Video (Manual Upload Fallback)
                        </a>
                      )}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleCloseDirectPublish}
                      className="flex-1 h-9 rounded-xl text-xs hover:bg-white/5 border-border/30 border"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={handleExecuteDirectPublish}
                      className={`flex-1 h-9 rounded-xl text-xs font-bold text-white cursor-pointer border-0 ${
                        publishPlatform === "Instagram"
                          ? "bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 shadow-lg shadow-pink-900/20"
                          : "bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 shadow-lg shadow-rose-900/20"
                      }`}
                    >
                      Publish Now
                    </Button>
                  </div>

                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stock Video Preview Modal Overlay */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200 text-left">
          <div className="bg-slate-900 border border-border/40 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="p-4 flex items-center justify-between border-b border-border/20 bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white">
                  <Play className="h-4 w-4 fill-current ml-0.5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Stock Clip Preview</h3>
                  <p className="text-[10px] text-slate-400 truncate max-w-[280px] sm:max-w-md">{previewVideo.title}</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setPreviewVideo(null)} 
                className="text-slate-500 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Video Player Box */}
            <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center border-b border-border/20">
              <video
                src={previewVideo.url}
                controls
                autoPlay
                loop
                playsInline
                className="w-full h-full object-contain"
              />
            </div>

            {/* Actions Bar */}
            <div className="p-4 bg-slate-950/40 flex items-center justify-between gap-3">
              <div className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
                Duration: <span className="text-white font-bold">{previewVideo.duration}s</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => setPreviewVideo(null)}
                  variant="ghost"
                  className="h-8 text-xs hover:bg-white/5 border border-border/30 rounded-lg px-4"
                >
                  Close
                </Button>
                
                <Button
                  type="button"
                  onClick={() => {
                    const video = previewVideo;
                    setPreviewVideo(null);
                    handleImportStock(video.id, video.url, video.title, video.duration);
                  }}
                  className="h-8 text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white rounded-lg flex items-center gap-1 cursor-pointer shadow-lg active:scale-95 transition-transform px-5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Import & Edit
                </Button>
                
                <Button
                  type="button"
                  onClick={() => {
                    const video = previewVideo;
                    setPreviewVideo(null);
                    handleOpenDirectPublish(video);
                  }}
                  className="h-8 text-xs font-bold bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white rounded-lg flex items-center gap-1 cursor-pointer shadow-lg active:scale-95 transition-transform px-5"
                >
                  <Send className="h-3.5 w-3.5" />
                  Publish
                </Button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
