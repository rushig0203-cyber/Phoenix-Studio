import { getReviewFile, safeReviewId } from "@/lib/reviewFiles";
import { getEditorMedia } from "@/lib/reviewEdits";
import { reviewMediaPath, streamReviewMedia } from "@/lib/reviewMedia";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!safeReviewId(id)) return new Response("Review file not found.", { status: 404 });
  const file = await getReviewFile(id);
  if (!file) return new Response("Review file not found or moved to Trash.", { status: 404 });
  try {
    const query = new URL(request.url).searchParams;
    const editorMedia = query.get("editSource") === "1" ? await getEditorMedia(id) : null;
    const selected = editorMedia || reviewMediaPath(file, query.get("target"));
    if (!selected) return new Response("This video format has not been rendered.", { status: 404 });
    return await streamReviewMedia(request, selected);
  } catch (error) {
    console.warn("[review-media] playback unavailable", { id, error: error instanceof Error ? error.message : String(error) });
    return new Response("The saved video cannot be opened. Check that its MP4 still exists in Review Files.", { status: 404 });
  }
}

export const HEAD = GET;
