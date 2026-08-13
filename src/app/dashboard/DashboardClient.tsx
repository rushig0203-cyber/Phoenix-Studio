"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  FileVideo,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import UploadZone from "@/components/UploadZone";
import { Button } from "@/components/ui/button";

type Folder = "ALL" | "UPLOADED" | "EDITED" | "PUBLISHED";
type LibraryProject = {
  id: string;
  title: string;
  duration: number;
  workflowState: Exclude<Folder, "ALL">;
  sourceProvider: string;
  sourceBytes: number;
  cloudAvailable: boolean;
  createdAt: string;
  previewUrl?: string | null;
  publishHistories: Array<{ platform: string; postUrl?: string | null }>;
};

const folders: Array<{ value: Folder; label: string }> = [
  { value: "ALL", label: "All files" },
  { value: "UPLOADED", label: "Uploaded" },
  { value: "EDITED", label: "Edited" },
  { value: "PUBLISHED", label: "Published" },
];

export default function DashboardClient() {
  const [projects, setProjects] = useState<LibraryProject[]>([]);
  const [folder, setFolder] = useState<Folder>("ALL");
  const [query, setQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState({
    bytes: 0,
    limitBytes: 8 * 1024 ** 3,
    percent: 0,
  });

  async function load() {
    const [projectsRes, usageRes] = await Promise.all([
      fetch("/api/projects", { cache: "no-store" }),
      fetch("/api/storage/usage", { cache: "no-store" }),
    ]);
    if (projectsRes.ok) setProjects(await projectsRes.json());
    if (usageRes.ok) setUsage(await usageRes.json());
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function upload(data: {
    title: string;
    duration: number;
    size: string;
    file: File;
    sourceProvider?: string;
    sourceMediaId?: string;
  }) {
    setUploading(true);
    setNotice("Uploading…");
    try {
      const ticketRes = await fetch("/api/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: data.file.name,
          fileType: data.file.type || "video/mp4",
          bytes: data.file.size,
        }),
      });
      const ticket = await ticketRes.json();
      if (!ticketRes.ok) throw new Error(ticket.error || "Upload failed");
      const put = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": data.file.type || "video/mp4" },
        body: data.file,
      });
      if (!put.ok) throw new Error("Upload failed");
      const finalRes = await fetch("/api/upload/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3Key: ticket.s3Key,
          title: data.title,
          filename: data.file.name,
          mimeType: data.file.type,
          duration: data.duration,
          sourceProvider: data.sourceProvider,
          sourceMediaId: data.sourceMediaId,
        }),
      });
      const final = await finalRes.json();
      if (!finalRes.ok) throw new Error(final.error || "Upload failed");
      setNotice("Uploaded");
      setShowUpload(false);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(project: LibraryProject) {
    if (!confirm(`Delete ${project.title}?`)) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "DELETE",
    });
    if (res.ok)
      setProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
  }
  async function rename(project: LibraryProject) {
    const title = prompt("Rename file", project.title)?.trim();
    if (!title || title === project.title) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok)
      setProjects((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, title } : item,
        ),
      );
  }
  async function download(project: LibraryProject) {
    const res = await fetch(`/api/projects/${project.id}?download=1`);
    const data = await res.json();
    if (res.ok) location.href = data.url;
    else setNotice(data.error || "Download unavailable");
  }

  const visible = useMemo(
    () =>
      projects.filter(
        (project) =>
          (folder === "ALL" || project.workflowState === folder) &&
          project.title.toLowerCase().includes(query.toLowerCase()),
      ),
    [projects, folder, query],
  );
  const gb = (usage.bytes / 1024 ** 3).toFixed(2);

  return (
    <div className="min-h-screen bg-[#101114] text-[#f3f3f5]">
      <Navbar inStudio />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Library</h1>
            <p className="mt-2 text-sm text-slate-400">
              {projects.length} files · {gb} GB of 8 GB
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard/settings">
              <Button
                variant="outline"
                className="rounded-xl border-white/10 bg-transparent"
              >
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </Link>
            <Button
              onClick={() => setShowUpload((value) => !value)}
              className="rounded-xl bg-violet-600 hover:bg-violet-500"
            >
              <Plus className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        </header>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-violet-500"
            style={{ width: `${usage.percent}%` }}
          />
        </div>
        {notice && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-white/10 bg-[#18191d] px-4 py-3 text-sm"
          >
            {uploading && (
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            )}
            {notice}
          </div>
        )}
        {showUpload && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-[#18191d] p-5">
            <UploadZone onUploadComplete={upload} />
          </section>
        )}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <nav
            className="flex gap-1 overflow-x-auto"
            aria-label="Library folders"
          >
            {folders.map((item) => (
              <button
                key={item.value}
                onClick={() => setFolder(item.value)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${folder === item.value ? "bg-white text-black" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <label className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search files"
              placeholder="Search"
              className="h-10 rounded-xl border border-white/10 bg-[#18191d] pl-9 pr-3 text-sm outline-none focus:border-violet-500"
            />
          </label>
        </div>
        {loading ? (
          <div className="grid min-h-64 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-8 grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-500">
            No files
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((project) => (
              <article
                key={project.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-[#18191d]"
              >
                <div className="relative aspect-video bg-black">
                  {project.previewUrl ? (
                    <video
                      src={project.previewUrl}
                      className="h-full w-full object-cover"
                      preload="metadata"
                    />
                  ) : (
                    <div className="grid h-full place-items-center">
                      <FileVideo className="h-9 w-9 text-slate-600" />
                    </div>
                  )}
                  <span className="absolute bottom-3 left-3 rounded-md bg-black/75 px-2 py-1 text-xs">
                    {project.workflowState.toLowerCase()}
                  </span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">
                        {project.title}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {project.sourceProvider} ·{" "}
                        {Math.ceil(project.duration / 60)} min
                      </p>
                    </div>
                    <button onClick={() => rename(project)} aria-label={`Rename ${project.title}`} className="rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-white">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                  {!project.cloudAvailable && (
                    <p className="mt-3 text-xs text-amber-400">
                      Cloud copy removed
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/dashboard/project/${project.id}`}
                      className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold"
                    >
                      Open
                    </Link>
                    <button
                      disabled={!project.cloudAvailable}
                      onClick={() => download(project)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40"
                    >
                      <Download className="mr-1 inline h-3.5 w-3.5" />
                      Download
                    </button>
                    {project.publishHistories[0]?.postUrl && (
                      <a
                        href={project.publishHistories[0].postUrl!}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-white/10 px-3 py-2 text-xs"
                      >
                        <ExternalLink className="mr-1 inline h-3.5 w-3.5" />
                        Post
                      </a>
                    )}
                    <button
                      onClick={() => remove(project)}
                      aria-label={`Delete ${project.title}`}
                      className="ml-auto rounded-lg border border-white/10 p-2 text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
