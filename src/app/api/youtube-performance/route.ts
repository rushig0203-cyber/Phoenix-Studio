import { assertLocalRequest } from "@/lib/localRequest";
import { isYouTubeReviewId, readYouTubePerformance, syncYouTubePerformance } from "@/lib/youtubePerformance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

async function handle(request: Request, refresh = false) {
  try { assertLocalRequest(request, refresh); }
  catch { return Response.json({ error: "Open YouTube Insights directly in Phoenix on this PC." }, { status: 403, headers }); }
  const params = new URL(request.url).searchParams;
  const reviewId = params.get("reviewId") ?? undefined;
  if ([...params.keys()].some(key => key !== "reviewId") || params.getAll("reviewId").length > 1 || (reviewId !== undefined && !isYouTubeReviewId(reviewId))) {
    return Response.json({ error: "Choose a saved video or view recent YouTube posts." }, { status: 400, headers });
  }
  if (refresh) {
    try {
      if (!request.body || Number(request.headers.get("content-length") || 0) > 1024) throw new Error();
      const reader = request.body.getReader(), bytes = new Uint8Array(1024);
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (length + chunk.value.length > bytes.length) { await reader.cancel(); throw new Error(); }
          bytes.set(chunk.value, length);
          length += chunk.value.length;
        }
      } finally { reader.releaseLock(); }
      const input = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
      if (input?.action !== "refresh" || Object.keys(input).length !== 1) throw new Error();
    } catch { return Response.json({ error: "Use Refresh to read YouTube counts." }, { status: 400, headers }); }
  }
  const state = await (refresh ? syncYouTubePerformance(reviewId) : readYouTubePerformance(reviewId));
  return Response.json(state, { headers });
}

export function GET(request: Request) { return handle(request); }
export function POST(request: Request) { return handle(request, true); }
