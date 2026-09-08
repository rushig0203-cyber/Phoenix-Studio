import { getReviewFile, safeReviewId } from "@/lib/reviewFiles";
import { reviewMediaPath } from "@/lib/reviewMedia";
import { reviewPoster } from "@/lib/reviewPoster";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!safeReviewId(id)) return new Response(null, { status: 404 });
  const file = await getReviewFile(id);
  if (!file) return new Response(null, { status: 404 });
  const media = reviewMediaPath(file, new URL(request.url).searchParams.get("target"));
  if (!media) return new Response(null, { status: 404 });
  try {
    const bytes = await reviewPoster(media);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    console.warn("[review-poster] frame unavailable", { id, error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 503, headers: { "Retry-After": "5" } });
  }
}
