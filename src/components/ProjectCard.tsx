"use strict";
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Play, MoreVertical, Edit2, Trash2, Video, CheckCircle2, Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface Project {
  id: string;
  title: string;
  duration: number; // in seconds
  status: "COMPLETED" | "PROCESSING" | "FAILED" | "UPLOADING";
  progress: number;
  thumbnailUrl?: string;
  createdAt: Date;
  processingStage?: string; // Real pipeline stage label
}

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onRetry?: (id: string) => void;
}

export default function ProjectCard({ project, onDelete, onRename, onRetry }: ProjectCardProps) {
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(project.title);

  const formatDuration = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim() && newTitle !== project.title) {
      onRename(project.id, newTitle.trim());
      setIsRenameOpen(false);
    }
  };

  // Status visual configurations
  const statusConfig = {
    COMPLETED: {
      label: "Ready",
      class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    PROCESSING: {
      label: project.processingStage || `Processing (${project.progress}%)`,
      class: "bg-violet-500/10 text-violet-400 border-violet-500/20",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    },
    UPLOADING: {
      label: `Uploading (${project.progress}%)`,
      class: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    },
    FAILED: {
      label: "Failed",
      class: "bg-rose-500/10 text-rose-400 border-rose-500/20",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
  };

  return (
    <>
      <div className="group relative flex flex-col rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm overflow-hidden hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-300">
        {/* Card Thumbnail Area */}
        <div className="relative aspect-video w-full bg-slate-950 overflow-hidden flex items-center justify-center">
          {project.thumbnailUrl ? (
            <img
              src={project.thumbnailUrl}
              alt={project.title}
              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            // Abstract procedural thumbnail representation
            <div className="absolute inset-0 bg-gradient-to-br from-violet-900/30 via-slate-900 to-indigo-950/20 flex flex-col items-center justify-center">
              <Video className="h-10 w-10 text-violet-400/40 group-hover:scale-110 group-hover:text-violet-400/60 transition-all duration-300" />
            </div>
          )}

          {/* Time Duration Badge */}
          <div className="absolute bottom-2.5 right-2.5 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
            {formatDuration(project.duration)}
          </div>

          {/* Overlay Link & Play Indicator */}
          {project.status === "COMPLETED" && (
            <Link
              href={`/dashboard/project/${project.id}`}
              className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-300"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:bg-violet-500 hover:scale-105">
                <Play className="h-5 w-5 fill-current ml-0.5" />
              </div>
            </Link>
          )}
        </div>

        {/* Card Body */}
        <div className="p-4 flex-1 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            {/* Title & Actions Row */}
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-semibold text-sm text-white line-clamp-1 group-hover:text-violet-300 transition-colors">
                {project.status === "COMPLETED" ? (
                  <Link href={`/dashboard/project/${project.id}`} className="hover:underline">
                    {project.title}
                  </Link>
                ) : (
                  project.title
                )}
              </h4>

              {/* Action Dropdown Menu */}
              <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger className="rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-white transition-colors cursor-pointer outline-none">
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40 border-border/40 bg-card/95 backdrop-blur-md">
                    <DropdownMenuItem
                      onClick={() => setIsRenameOpen(true)}
                      className="gap-2 text-xs font-medium cursor-pointer hover:bg-white/5"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setIsDeleteOpen(true)}
                      className="gap-2 text-xs font-medium text-rose-400 cursor-pointer hover:bg-rose-500/10 focus:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Date Created */}
            <p className="text-xs text-muted-foreground">
              Uploaded {formatDistanceToNow(project.createdAt, { addSuffix: true })}
            </p>
          </div>

          {/* Status Indicators */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusConfig[project.status].class}`}>
                {statusConfig[project.status].icon}
                <span>{statusConfig[project.status].label}</span>
              </div>
              
              {/* Go to Clips link for Ready status */}
              {project.status === "COMPLETED" && (
                <Link
                  href={`/dashboard/project/${project.id}`}
                  className="text-violet-400 hover:text-violet-300 font-medium flex items-center gap-0.5 hover:underline transition-all"
                >
                  View Clips
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}

              {/* Retry link for Failed status */}
              {project.status === "FAILED" && onRetry && (
                <button
                  onClick={() => onRetry(project.id)}
                  className="text-violet-400 hover:text-violet-300 font-semibold flex items-center gap-0.5 hover:underline transition-all cursor-pointer bg-transparent border-none outline-none"
                >
                  Retry Curation
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Micro progress bars for active actions */}
            {(project.status === "PROCESSING" || project.status === "UPLOADING") && (
              <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    project.status === "PROCESSING"
                      ? "bg-gradient-to-r from-violet-600 to-indigo-500"
                      : "bg-gradient-to-r from-blue-600 to-cyan-500"
                  }`}
                  style={{ width: `${project.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="border-border/40 bg-card/95 backdrop-blur-md max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-base">Rename Project</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Enter a new name for your project video file.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit}>
            <div className="py-4">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Project title"
                className="border-border/40 bg-white/5 text-white placeholder-muted-foreground focus:border-violet-500"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsRenameOpen(false)}
                className="text-xs border-border/40 hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
              >
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="border-border/40 bg-card/95 backdrop-blur-md max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-base">Delete Project?</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete <span className="font-semibold text-white">&ldquo;{project.title}&rdquo;</span>? This action is permanent and will remove all extracted viral clips.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsDeleteOpen(false)}
              className="text-xs border-border/40 hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onDelete(project.id);
                setIsDeleteOpen(false);
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
            >
              Delete Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
