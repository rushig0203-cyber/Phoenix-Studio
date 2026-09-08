import { assertLocalManagerRequest, getQualityManagerState } from "@/lib/qualityManager";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { assertLocalManagerRequest(request); return Response.json(await getQualityManagerState()); }
  catch (error) { return Response.json({error:error instanceof Error?error.message:"Manager status unavailable."},{status:400}); }
}
