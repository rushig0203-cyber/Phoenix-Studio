import { z } from "zod";
import { searchFootage } from "@/lib/stockCatalog";
import { assertLocalRequest } from "@/lib/localRequest";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const params = new URL(request.url).searchParams;
    const query = z.string().trim().min(2).max(80).parse(params.get("q"));
    const aspect = z.enum(["9:16", "16:9"]).parse(params.get("aspect"));
    return Response.json({ choices: await searchFootage(query, aspect) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Footage search failed." }, { status: 400 }); }
}
