import { assertLocalRequest } from "@/lib/localRequest";
import { readInstagramPerformance, syncInstagramPerformance } from "@/lib/instagramPerformance";
import { instagramPerformanceSummary } from "@/lib/instagramPerformanceLearning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try { assertLocalRequest(request); }
  catch { return Response.json({ error: "Open Instagram performance directly in Phoenix on this PC." }, { status: 403, headers }); }
  try {
    const state = await readInstagramPerformance();
    return Response.json({ ...state, summary: instagramPerformanceSummary(state) }, { headers });
  } catch {
    return Response.json({ error: "Saved Instagram performance could not be read. Existing videos and posting access are unaffected." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  try { assertLocalRequest(request, true); }
  catch { return Response.json({ error: "Open Instagram performance directly in Phoenix on this PC." }, { status: 403, headers }); }
  try {
    if (Number(request.headers.get("content-length") || 0) > 1024) throw new Error("Invalid refresh request.");
    if (!request.body) throw new Error("Invalid refresh request.");
    const reader = request.body.getReader(), bytes = new Uint8Array(1024);
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (length + chunk.value.byteLength > bytes.byteLength) { await reader.cancel(); throw new Error("Invalid refresh request."); }
        bytes.set(chunk.value, length); length += chunk.value.byteLength;
      }
    } finally { reader.releaseLock(); }
    const text = new TextDecoder().decode(bytes.subarray(0, length));
    const input = JSON.parse(text);
    if (!input || input.action !== "refresh" || Object.keys(input).some(key => key !== "action")) throw new Error("Invalid refresh request.");
  } catch { return Response.json({ error: "Use Refresh insights without posting choices or account credentials." }, { status: 400, headers }); }
  try {
    const state = await syncInstagramPerformance(true);
    return Response.json({ ...state, summary: instagramPerformanceSummary(state) }, { headers });
  } catch {
    return Response.json({ error: "Instagram insights could not refresh. Saved statistics remain available; no post was submitted." }, { status: 503, headers });
  }
}
