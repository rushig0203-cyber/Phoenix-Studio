import { assertLocalRequest } from "@/lib/localRequest";
import { newsIdeas } from "@/lib/newsResearch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { assertLocalRequest(request); return Response.json({ items: await newsIdeas(), checkedAt: new Date().toISOString(), limitation: "Reports from BBC News, not verified trends or an independent fact check." }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "World news is unavailable." }, { status: 503 }); }
}
