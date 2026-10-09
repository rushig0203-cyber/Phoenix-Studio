import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { ensureReviewFolders, makeReviewFile, readReviewFiles, safeFilename, sourcePath } from "@/lib/reviewFiles";
import { withReviewPublicationSummaries } from "@/lib/reviewPublicationSummary";

const providerHosts = {
  pexels: new Set(["videos.pexels.com"]),
  pixabay: new Set(["cdn.pixabay.com"]),
};

const titleFor = (topic: string, audience: string) => topic.trim().slice(0, 120) || (audience === "kids-1-3" ? "Gentle nature discovery" : "Nature review file");
const captionFor = (topic: string, audience: string) => audience === "kids-1-3"
  ? [`A gentle ${topic || "nature"} moment for little explorers.`, "Simple, calm, and ready for your review."]
  : [`A calm ${topic || "nature"} moment worth watching.`, "Review the natural sound and final caption before posting."];

export async function GET(request: Request) {
  const trash = new URL(request.url).searchParams.get("trash") === "1";
  const files = await readReviewFiles(trash);
  const visible = trash ? files.filter(file => file.trashedAt) : files;
  return NextResponse.json(await withReviewPublicationSummaries(visible), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const topic = String(form.get("topic") || "").trim();
    const audience = form.get("audience") === "kids-1-3" ? "kids-1-3" : "general";
    const targets = [form.get("instagram") === "true" ? "instagram" : null, form.get("youtube") === "true" ? "youtube" : null].filter(Boolean) as Array<"instagram" | "youtube">;
    if (!targets.length) return NextResponse.json({ error: "Choose Instagram, YouTube, or both." }, { status: 400 });
    const provider = String(form.get("provider") || "upload");
    const remoteUrl = String(form.get("sourceUrl") || "").trim();
    const uploaded = form.get("file");
    let bytes: Buffer;
    let filename: string;
    let source: { kind: "upload" | "pexels" | "pixabay"; filename: string; providerUrl?: string; providerMediaId?: string; licence: string; downloadedAt?: string };

    if (uploaded instanceof File && uploaded.size > 0) {
      if (!uploaded.type.startsWith("video/") || uploaded.size > 5 * 1024 * 1024 * 1024) return NextResponse.json({ error: "Upload an MP4, MOV, WebM, or other video under 5 GB." }, { status: 400 });
      filename = safeFilename(uploaded.name);
      bytes = Buffer.from(await uploaded.arrayBuffer());
      source = { kind: "upload", filename, licence: "Local file supplied by studio owner" };
    } else {
      if (provider !== "pexels" && provider !== "pixabay") return NextResponse.json({ error: "Choose a local upload, Pexels, or Pixabay." }, { status: 400 });
      let url: URL;
      try { url = new URL(remoteUrl); } catch { return NextResponse.json({ error: "A valid Pexels or Pixabay video URL is required." }, { status: 400 }); }
      if (url.protocol !== "https:" || !providerHosts[provider].has(url.hostname)) return NextResponse.json({ error: "Only approved Pexels/Pixabay video hosts are allowed." }, { status: 400 });
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("video/")) return NextResponse.json({ error: "The approved provider did not return a video file." }, { status: 422 });
      const length = Number(response.headers.get("content-length") || 0);
      if (length && length > 5 * 1024 * 1024 * 1024) return NextResponse.json({ error: "This provider video is larger than 5 GB." }, { status: 413 });
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 5 * 1024 * 1024 * 1024) return NextResponse.json({ error: "This provider video is larger than 5 GB." }, { status: 413 });
      filename = `${provider}-${Date.now()}.mp4`;
      source = { kind: provider, filename, providerUrl: url.toString(), providerMediaId: String(form.get("providerMediaId") || ""), licence: provider === "pexels" ? "Pexels License — record retained with review file" : "Pixabay Content License — record retained with review file", downloadedAt: new Date().toISOString() };
    }
    await ensureReviewFolders();
    const item = makeReviewFile({ title: titleFor(topic, audience), targets, source, audience, quality: { audio: "needs-review", captions: captionFor(topic, audience), hashtags: audience === "kids-1-3" ? ["#LittleExplorers", "#NatureForKids", "#CalmMoments"] : ["#Nature", "#Beach", "#Mountains", "#MindfulMoments"], checks: ["Source stored locally", "Provider/licence record saved", "No generated voice", "Awaiting approved local renderer"], warning: "A verified local renderer is required before an export can be marked Review Ready." } });
    await fs.writeFile(sourcePath(item.id, filename), bytes);
    const saved = await import("@/lib/reviewFiles").then(({ saveReviewFile }) => saveReviewFile(item));
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create review file" }, { status: 500 });
  }
}
