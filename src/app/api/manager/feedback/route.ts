import { assertLocalManagerRequest, saveCreativeFeedback } from "@/lib/qualityManager";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalManagerRequest(request,true);
    if (Number(request.headers.get("content-length")||0)>12000) return Response.json({error:"Feedback is too large."},{status:413});
    return Response.json(await saveCreativeFeedback(await request.json()));
  } catch (error) { return Response.json({error:error instanceof Error?error.message:"Could not save feedback."},{status:400}); }
}
