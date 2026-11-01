import { spawn } from "node:child_process";
import path from "node:path";
import { assertLocalRequest } from "@/lib/localRequest";
import { getReviewFile, safeReviewId } from "@/lib/reviewFiles";
import { reviewMediaPath } from "@/lib/reviewMedia";
import { artifactReference, resolveArtifact } from "@/lib/reviewArtifacts";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertLocalRequest(request, true); }
  catch { return Response.json({ error: "Open this action directly in Phoenix Studio on this PC." }, { status: 403 }); }
  if (request.body) {
    // Next can supply a stream even for an empty POST; inspect only its first chunk.
    const reader = request.body.getReader();
    try { if (!(await reader.read()).done) return Response.json({ error: "This action accepts only the saved video ID and format." }, { status: 400 }); }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  if (process.platform !== "win32") return Response.json({ error: "Showing the saved file requires Phoenix running on your Windows PC. Download MP4 is available below." }, { status: 409 });
  const { id } = await params, target = new URL(request.url).searchParams.get("target");
  if (!safeReviewId(id)) return Response.json({ error: "Video not found." }, { status: 404 });
  if (target !== "instagram" && target !== "youtube") return Response.json({ error: "Choose a saved Instagram or YouTube MP4." }, { status: 400 });
  try {
    const file = await getReviewFile(id);
    if (!file || file.status !== "READY") return Response.json({ error: "The finished video is unavailable or in Trash." }, { status: 404 });
    const selected = reviewMediaPath(file, target);
    if (!selected) return Response.json({ error: "This format has not been rendered." }, { status: 404 });
    const filename = await resolveArtifact(artifactReference(selected));
    // Explorer is the interactive handoff: reveal the existing MP4, never execute it.
    await new Promise<void>((resolve, reject) => {
      // Explorer needs its comma and quoted path together, not Node's argument quoting.
      const child = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), [`/select,"${filename}"`], { windowsVerbatimArguments: true, detached: true, windowsHide: false, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
    return Response.json({ revealed: true });
  } catch { return Response.json({ error: "The saved MP4 could not be shown. Check Review Files or use Download MP4 below." }, { status: 500 }); }
}
