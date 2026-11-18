import { getReviewFile, safeReviewId } from "@/lib/reviewFiles";
import { reviewMediaPath, selectedReviewTarget } from "@/lib/reviewMedia";
import { reviewPoster } from "@/lib/reviewPoster";
import { reviewPosterSeek } from "@/lib/reviewPosterPolicy";
import { HeavyWorkWaitError } from "@/lib/renderResources";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!safeReviewId(id)) return new Response(null, { status: 404 });
  const file = await getReviewFile(id);
  if (!file) return new Response(null, { status: 404 });
  const requestedTarget = new URL(request.url).searchParams.get("target");
  const media = reviewMediaPath(file, requestedTarget);
  if (!media) return new Response(null, { status: 404 });
  try {
    const selected = selectedReviewTarget(file, requestedTarget);
    const seek = reviewPosterSeek(selected ? file.outputs[selected]?.duration : undefined);
    const bytes = await reviewPoster(media, request.signal, seek);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) return new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (!(error instanceof HeavyWorkWaitError)) console.warn("[review-poster] frame unavailable", { id, error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
  }
}
