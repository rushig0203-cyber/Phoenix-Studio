import { assertLocalRequest } from "@/lib/localRequest";
import { safeReviewId } from "@/lib/reviewFiles";
import { queuePostingAnalysis } from "@/lib/videoPostingAnalysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request, true);
    const { id } = await context.params;
    if (!safeReviewId(id)) return Response.json({ error: "Invalid review file." }, { status: 400 });
    const file = await queuePostingAnalysis(id);
    return file ? Response.json(file, { status: 202 }) : Response.json({ error: "Video not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not queue video analysis." }, { status: 400 });
  }
}
