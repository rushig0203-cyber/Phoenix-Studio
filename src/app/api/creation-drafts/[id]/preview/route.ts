import { z } from "zod";
import { listCreationDrafts, isStockDraft } from "@/lib/creationDrafts";
import { kidsAnimationSvg } from "@/lib/kidsAnimation";
import { castFor } from "@/lib/kidsRenderer";
import { assertLocalRequest } from "@/lib/localRequest";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request);
    const id = z.string().uuid().parse((await context.params).id);
    const params = new URL(request.url).searchParams;
    const index = z.coerce.number().int().min(0).max(17).parse(params.get("scene") || 0);
    const frame = z.coerce.number().int().min(0).max(47).parse(params.get("frame") || 0);
    const draft = (await listCreationDrafts()).find(d => d.id === id && d.status !== "ARCHIVED");
    if (!draft || isStockDraft(draft) || !draft.scenes[index]) return new Response("Scene not found", { status: 404 });
    const cast = castFor(draft.input.topic);
    const svg = kidsAnimationSvg({ topic: draft.input.topic, caption: draft.scenes[index].narration, index, frame, aspect: draft.input.aspect, cast: [cast[0].kind, cast[1].kind], song: draft.input.creationType === "children-song" });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-cache", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Invalid scene preview", { status: 400 }); }
}
