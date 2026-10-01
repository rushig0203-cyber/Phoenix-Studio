import { assertLocalRequest } from "@/lib/localRequest";
import { CONTENT_IDEAS, contentIdeas } from "@/lib/contentIdeas";
import { readReviewFiles } from "@/lib/reviewFiles";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const params = new URL(request.url).searchParams;
    const rotation = Math.max(0, Math.min(10000, Number(params.get("rotation")) || 0));
    return Response.json({ categories: [...new Set(CONTENT_IDEAS.map(idea => idea.category))], ideas: contentIdeas((await readReviewFiles()).map(file => file.title), params.get("category") || "all", rotation), source: "Original editorial starting points, rotated against local review history. Not live trends or guaranteed view predictions. Edit any topic or search for anything else." });
  } catch { return Response.json({ error: "Could not load local ideas." }, { status: 500 }); }
}
