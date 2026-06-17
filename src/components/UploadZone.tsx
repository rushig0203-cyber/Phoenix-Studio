"use strict";
"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileVideo, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Validate and start upload
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
            // Mock a video duration between 30s and 300s
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
    <div className="w-full">
      <AnimatePresence mode="wait">
        {!isUploading ? (
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
                onClick={(e) => e.stopPropagation()} // prevent double trigger
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="progress"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="relative rounded-2xl border border-border/40 bg-white/5 p-8 text-left shadow-lg backdrop-blur-md"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 shrink-0">
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
                        Uploading to AuraClip Secure S3...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        Upload complete! Finalizing...
                      </>
                    )}
                  </p>
                </div>
              </div>

              <button
                onClick={cancelUpload}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5 hover:text-white transition-colors"
                title="Cancel upload"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Progress Bar Container */}
            <div className="mt-6">
              <div className="flex justify-between items-center text-xs font-semibold text-white mb-2">
                <span>Progress</span>
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

            {/* Metadata / Details */}
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>Remaining time: {uploadProgress < 100 ? `${Math.ceil((100 - uploadProgress) / 8)}s` : "0s"}</span>
              <span>Speed: ~24.5 MB/s</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
