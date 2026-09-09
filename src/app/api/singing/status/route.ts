import { localSingingStatus } from "@/lib/localSinging";
import { assertLocalRequest } from "@/lib/localRequest";
export async function GET(request: Request) {
  try { assertLocalRequest(request); return Response.json(await localSingingStatus()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Singing status unavailable." }, { status: 400 }); }
}
