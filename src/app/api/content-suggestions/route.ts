import { assertLocalRequest } from "@/lib/localRequest";
import { loadSuggestionContext } from "@/lib/contentSuggestionContext";
import { personalizedStockSuggestions, stockTopicPool, FOOTAGE_SUGGESTION_REFRESH_MS } from "@/lib/stockFootageSuggestions";
import { CREATION_KINDS, personalizedCreationRecommendations, recommendationPool, type CreationKind } from "@/lib/creationRecommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try { assertLocalRequest(request); }
  catch { return Response.json({ error: "Open topic suggestions directly in Phoenix on this PC." }, { status: 403, headers }); }
  let workflow: "footage" | "creation", cursor: number, seen: string[], kind: CreationKind | undefined, opening = false;
  try {
    const query = new URL(request.url).searchParams;
    if (query.toString().length > 8192 || [...query.keys()].some(key => !["workflow", "cursor", "seen", "kind", "opening"].includes(key) || query.getAll(key).length !== 1)) throw new Error();
    const requestedWorkflow = query.get("workflow"), requestedCursor = query.get("cursor") ?? "0";
    if (requestedWorkflow !== "footage" && requestedWorkflow !== "creation" || !/^\d{1,6}$/.test(requestedCursor)) throw new Error();
    workflow = requestedWorkflow; cursor = Number(requestedCursor);
    if (query.has("opening")) {
      if (workflow !== "footage" || query.get("opening") !== "1") throw new Error();
      opening = true;
    }
    const requestedKind = query.get("kind");
    if (requestedKind !== null) {
      if (workflow !== "creation" || !CREATION_KINDS.includes(requestedKind as CreationKind)) throw new Error();
      kind = requestedKind as CreationKind;
    }
    seen = query.get("seen") ? query.get("seen")!.split(",") : [];
    const known = new Set((workflow === "footage" ? stockTopicPool() : recommendationPool()).map(idea => idea.id));
    if (seen.length > 48 || seen.some(value => !known.has(value)) || new Set(seen).size !== seen.length) throw new Error();
  } catch { return Response.json({ error: "Use a saved suggestion workflow, cursor and up to 48 known topic IDs." }, { status: 400, headers }); }
  try {
    const context = await loadSuggestionContext();
    const result = workflow === "footage" ? personalizedStockSuggestions(context, cursor, seen) : personalizedCreationRecommendations(context, cursor, seen, kind);
    const relevant = context.recent.filter(record => !record.news && (workflow === "creation" || record.workflow === "stock-reel"));
    const recentIds = new Set(relevant.map(record => record.reviewId));
    const batch = result.ideas.slice(0, 6);
    const ideas = opening
      ? await (await import("@/lib/quickTemplateOpenings")).quickTemplateOpenings(batch.filter(idea => "query" in idea), request.signal)
      : batch;
    return Response.json({ ...result, ideas, profile: { recentCount: relevant.length, feedbackCount: context.feedback.filter(record => recentIds.has(record.reviewId)).length }, refreshMs: FOOTAGE_SUGGESTION_REFRESH_MS }, { headers });
  } catch { return Response.json({ error: "Saved topic suggestions could not be read. Try More topics again." }, { status: 503, headers }); }
}
