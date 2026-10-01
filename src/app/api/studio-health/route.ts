import { studioHealth } from "@/lib/studioHealth";
import { assertLocalRequest } from "@/lib/localRequest";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { assertLocalRequest(request); return Response.json(await studioHealth(true)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Studio health unavailable." }, { status: 503 }); }
}
