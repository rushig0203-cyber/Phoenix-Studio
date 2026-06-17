"use strict";
"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Video,
  Search,
  Filter,
  Plus,
  Coins,
  FolderOpen,
  Loader2,
} from "lucide-react";
import ProjectCard, { Project } from "@/components/ProjectCard";
import UploadZone from "@/components/UploadZone";
import { Button } from "@/components/ui/button";
import { saveVideoFile, getVideoFile } from "@/lib/videoStorage";
import {
  processVideo,
  isProjectProcessed,
  type ProcessingStatus,
} from "@/lib/processingPipeline";

const INITIAL_PROJECTS: Project[] = [];

// Inner component that reads search params
function DashboardContent() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<string>("NEWEST");
  const [showUploadZone, setShowUploadZone] = useState(true);

  // Track processing status per project
  const [processingStates, setProcessingStates] = useState<
    Record<string, ProcessingStatus>
  >({});
  const processingRef = useRef<Set<string>>(new Set());
  const autoProcessingRef = useRef<Set<string>>(new Set());

  // Load projects from localStorage on client-side mount
  useEffect(() => {
    const saved = localStorage.getItem("auraclip_projects");
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
          .map((p: any) => ({
            ...p,
            createdAt: new Date(p.createdAt),
          }))
          .filter((p: any) => p.id !== "proj-1" && p.id !== "proj-2" && p.id !== "proj-3");
        setProjects(parsed);
      } catch (e) {
        setProjects([]);
      }
    } else {
      setProjects([]);
    }

    setMounted(true);
  }, []);

  // Save projects to localStorage whenever state changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("auraclip_projects", JSON.stringify(projects));
    }
  }, [projects, mounted]);

  // Check if a new upload was requested via redirect query params
  useEffect(() => {
    if (!mounted) return;

    const newUpload = searchParams.get("newUpload");
    const title = searchParams.get("title");
    const duration = searchParams.get("duration");
    const id = searchParams.get("id");

    if (newUpload === "true" && title) {
      const parsedDuration = duration ? parseInt(duration) : 120;

      setProjects((prev) => {
        const titleExists = prev.some(
          (p) =>
            p.title === title &&
            (p.status === "UPLOADING" || p.status === "PROCESSING")
        );
        if (titleExists) return prev;

        const newProj: Project = {
          id: id || "proj-" + Math.random().toString(36).substr(2, 9),
          title: title,
          duration: parsedDuration,
          status: "UPLOADING",
          progress: 15,
          createdAt: new Date(),
        };

        return [newProj, ...prev];
      });

      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, [searchParams, mounted]);

  // Auto-process projects in UPLOADING/PROCESSING states that are not currently running
  // Uses autoProcessingRef to lock checking operations and prevent overlapping asynchronous race condition loops
  useEffect(() => {
    if (!mounted) return;

    const autoProcessStuckProjects = async () => {
      for (const project of projects) {
        if (
          (project.status === "UPLOADING" || project.status === "PROCESSING") &&
          !processingRef.current.has(project.id) &&
          !autoProcessingRef.current.has(project.id)
        ) {
          autoProcessingRef.current.add(project.id);
          try {
            const file = await getVideoFile(project.id);
            if (file) {
              console.log("AuraClip: Auto-starting processing for stuck/redirected project:", project.id);
              startProcessing(project.id, file);
            } else {
              if (project.title.toLowerCase().includes("youtube")) {
                const mockBlob = new Blob(["mock video content"], { type: "video/mp4" });
                const mockFile = new File([mockBlob], "mock_youtube.mp4", { type: "video/mp4" });
                startProcessing(project.id, mockFile);
              } else {
                console.warn("AuraClip: No file found in IndexedDB for stuck project:", project.id);
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === project.id ? { ...p, status: "FAILED" as const, progress: 0 } : p
                  )
                );
              }
            }
          } catch (e) {
            console.error("AuraClip: Error auto-starting project:", project.id, e);
          } finally {
            autoProcessingRef.current.delete(project.id);
          }
        }
      }
    };

    autoProcessStuckProjects();
  }, [projects, mounted]);

  /**
   * Start real processing pipeline for a project.
   */
  const startProcessing = async (projectId: string, file: File) => {
    // Prevent duplicate processing
    if (processingRef.current.has(projectId)) return;
    processingRef.current.add(projectId);

    // Update project status to PROCESSING
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, status: "PROCESSING" as const, progress: 0, processingStage: "transcribing" }
          : p
      )
    );

    try {
      await processVideo(projectId, file, (status: ProcessingStatus) => {
        // Store processing state
        setProcessingStates((prev) => ({
          ...prev,
          [projectId]: status,
        }));

        // Map pipeline stage to project progress
        const stageLabel =
          status.stage === "transcribing"
            ? "Transcribing audio..."
            : status.stage === "analyzing"
            ? "AI analyzing content..."
            : status.stage === "generating"
            ? "Generating clips..."
            : status.stage === "complete"
            ? "Ready"
            : status.stage === "error"
            ? "Failed"
            : "Processing...";

        setProjects((prev) =>
          prev.map((p) => {
            if (p.id !== projectId) return p;

            if (status.stage === "complete") {
              return {
                ...p,
                status: "COMPLETED" as const,
                progress: 100,
                processingStage: undefined,
              };
            }

            if (status.stage === "error") {
              return {
                ...p,
                status: "FAILED" as const,
                progress: 0,
                processingStage: undefined,
              };
            }

            return {
              ...p,
              status: "PROCESSING" as const,
              progress: status.progress,
              processingStage: stageLabel,
            };
          })
        );
      });
    } catch (err) {
      console.error("AuraClip: Pipeline failed for project:", projectId, err);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, status: "FAILED" as const, progress: 0 }
            : p
        )
      );
    } finally {
      processingRef.current.delete(projectId);
    }
  };

  // Handle manual upload completing on Dashboard
  const handleUploadComplete = async (data: {
    title: string;
    duration: number;
    size: string;
    file: File;
  }) => {
    const projectId =
      "proj-" + Math.random().toString(36).substr(2, 9);

    // Save video file to IndexedDB
    try {
      await saveVideoFile(projectId, data.file);
      console.log("AuraClip: Video stored in IndexedDB.");
    } catch (e) {
      console.error("AuraClip: Failed to store video:", e);
    }

    const newProj: Project = {
      id: projectId,
      title: data.title,
      duration: data.duration,
      status: "PROCESSING",
      progress: 0,
      createdAt: new Date(),
      processingStage: "Preparing...",
    };
    setProjects((prev) => [newProj, ...prev]);
    setShowUploadZone(false);

    // Start real processing pipeline
    startProcessing(projectId, data.file);
  };

  // Retry handler — reprocess from stored IndexedDB file
  const handleRetry = async (id: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              status: "PROCESSING" as const,
              progress: 0,
              processingStage: "Retrying...",
            }
          : p
      )
    );

    // Try to load the stored file
    try {
      const file = await getVideoFile(id);
      if (file) {
        startProcessing(id, file);
      } else {
        // No file in IndexedDB — mark as failed
        setProjects((prev) =>
          prev.map((p) =>
            p.id === id
              ? { ...p, status: "FAILED" as const, progress: 0 }
              : p
          )
        );
      }
    } catch (e) {
      console.error("AuraClip: Retry failed:", e);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, status: "FAILED" as const, progress: 0 }
            : p
        )
      );
    }
  };

  // Actions
  const handleRename = (id: string, newTitle: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, title: newTitle } : p))
    );
  };

  const handleDelete = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  // Filter & Sort computation
  const filteredProjects = projects
    .filter((proj) => {
      const matchesSearch = proj.title
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      if (statusFilter === "ALL") return matchesSearch;
      return matchesSearch && proj.status === statusFilter;
    })
    .sort((a, b) => {
      if (sortBy === "NEWEST") {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      if (sortBy === "DURATION") {
        return b.duration - a.duration;
      }
      return 0;
    });

  return (
    <div className="flex-1 flex flex-col">
      {/* Main dashboard content */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Banner with CTA */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-6">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Recent Projects
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Upload a video to automatically extract AI-analyzed viral clips
              with real transcription.
            </p>
          </div>

          <Button
            onClick={() => setShowUploadZone(!showUploadZone)}
            className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs gap-1.5 px-6 shrink-0 shadow-lg active:scale-95 transition-transform"
          >
            <Plus className="h-4 w-4" />
            New Upload
          </Button>
        </div>

        {/* Collapsible Upload Zone */}
        {showUploadZone && (
          <div className="rounded-2xl border border-border/40 bg-card/20 p-6 shadow-xl relative animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-violet-400">
                Upload video file
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUploadZone(false)}
                className="text-xs hover:bg-white/5"
              >
                Close
              </Button>
            </div>
            <UploadZone onUploadComplete={handleUploadComplete} />
          </div>
        )}

        {/* Controls: Search, Filter, Sort */}
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-card/20 border border-border/40 rounded-xl p-4">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search project titles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border/40 bg-white/5 pl-9 pr-4 py-2 text-xs text-white placeholder-muted-foreground focus:border-violet-500 focus:outline-none transition-all duration-200"
            />
          </div>

          {/* Filtering row */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-slate-300 focus:border-violet-500 focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900 text-white">
                  All States
                </option>
                <option
                  value="COMPLETED"
                  className="bg-slate-900 text-white"
                >
                  Ready
                </option>
                <option
                  value="PROCESSING"
                  className="bg-slate-900 text-white"
                >
                  Processing
                </option>
                <option
                  value="UPLOADING"
                  className="bg-slate-900 text-white"
                >
                  Uploading
                </option>
                <option value="FAILED" className="bg-slate-900 text-white">
                  Failed
                </option>
              </select>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-lg border border-border/40 bg-white/5 px-3 py-2 text-xs text-slate-300 focus:border-violet-500 focus:outline-none cursor-pointer"
            >
              <option value="NEWEST" className="bg-slate-900 text-white">
                Newest First
              </option>
              <option value="DURATION" className="bg-slate-900 text-white">
                Longest Duration
              </option>
            </select>
          </div>
        </div>

        {/* Project Grid / Library */}
        {filteredProjects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((proj) => (
              <ProjectCard
                key={proj.id}
                project={proj}
                onRename={handleRename}
                onDelete={handleDelete}
                onRetry={handleRetry}
              />
            ))}
          </div>
        ) : (
          // Empty State Layout
          <div className="rounded-2xl border border-dashed border-border/40 bg-card/10 p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
            <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h4 className="font-bold text-white text-base">
              No projects found
            </h4>
            <p className="text-xs text-muted-foreground mt-2 max-w-sm leading-relaxed">
              {searchQuery || statusFilter !== "ALL"
                ? "No projects match your current search and filters. Reset filters to see all uploads."
                : "Get started by uploading your first long video file. AuraClip will transcribe, analyze, and extract viral clips automatically."}
            </p>
            {(searchQuery || statusFilter !== "ALL") && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("ALL");
                }}
                className="mt-6 rounded-full text-xs border-border/40 hover:bg-white/5"
              >
                Clear Filters
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Default export wrapper with Suspense
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground font-medium">
          <Loader2 className="h-6 w-6 animate-spin mb-2" />
          Loading Creator Dashboard...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
