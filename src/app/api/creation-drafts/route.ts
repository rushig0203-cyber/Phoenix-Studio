import { z } from "zod";
import { approveCreationDraft, changeDraftStatus, chooseDraftFootage, DraftConflict, listCreationDrafts, saveCreationDraft } from "@/lib/creationDrafts";
import { assertLocalRequest } from "@/lib/localRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { assertLocalRequest(request); return Response.json((await listCreationDrafts()).filter(d => d.status !== "ARCHIVED").map(draft => ({ ...draft, leaseOwner: undefined, leaseUntil: undefined }))); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Drafts unavailable." }, { status: 400 }); }
}
const common = { id: z.string().uuid(), version: z.number().int().positive() };
const command = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("save"), scenes: z.array(z.object({ narration: z.string().trim().min(1).max(4000), query: z.string().trim().max(80) })).min(1).max(18) }),
  z.object({ ...common, action: z.literal("choose"), index: z.number().int().min(0).max(17), assetId: z.number().int().positive() }),
  z.object({ ...common, action: z.literal("approve"), reviewConfirmed: z.literal(true) }),
  z.object({ ...common, action: z.literal("retry") }),
  z.object({ ...common, action: z.literal("finish") }),
  z.object({ ...common, action: z.literal("archive") }),
]);
export async function PATCH(request: Request) {
  try {
    assertLocalRequest(request, true);
    const body = command.parse(await request.json());
    const draft = body.action === "save" ? await saveCreationDraft(body.id, body.version, body.scenes)
      : body.action === "choose" ? await chooseDraftFootage(body.id, body.version, body.index, body.assetId)
      : body.action === "approve" ? await approveCreationDraft(body.id, body.version)
      : await changeDraftStatus(body.id, body.version, body.action);
    return Response.json(draft);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not update draft." }, { status: error instanceof DraftConflict ? 409 : 400 }); }
}
