import { assertLocalManagerRequest, getQualityManagerState } from "@/lib/qualityManager";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalManagerRequest(request,true);
    return Response.json({...await getQualityManagerState(),message:"Local reviews refreshed. No video job or paid service was started."});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:"Manager review failed."},{status:400});
  }
}
