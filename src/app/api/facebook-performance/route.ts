import { assertLocalRequest } from "@/lib/localRequest";
import { readFacebookPerformance, syncFacebookPerformance } from "@/lib/facebookPerformance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try { assertLocalRequest(request); }
  catch { return Response.json({ error: "Open Facebook performance directly in Phoenix on this PC." }, { status: 403, headers }); }
  try { return Response.json(await readFacebookPerformance(), { headers }); }
  catch { return Response.json({ error: "Saved Facebook counts could not be read. Videos and posting access are unaffected." }, { status: 500, headers }); }
}
export async function POST(request: Request) {
  try { assertLocalRequest(request, true); }
  catch { return Response.json({ error: "Open Facebook performance directly in Phoenix on this PC." }, { status: 403, headers }); }
  try {
    if (Number(request.headers.get("content-length") || 0) > 1024 || !request.body) throw new Error("Invalid refresh.");
    const reader = request.body.getReader(), bytes = new Uint8Array(1024);
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        if (length + chunk.value.byteLength > bytes.byteLength) { await reader.cancel(); throw new Error("Invalid refresh."); }
        bytes.set(chunk.value, length); length += chunk.value.byteLength;
      }
    } finally { reader.releaseLock(); }
    const input: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
    if (!input || typeof input !== "object" || Array.isArray(input) || (input as { action?: unknown }).action !== "refresh"
      || Object.keys(input).some(key => key !== "action")) throw new Error("Invalid refresh.");
  } catch { return Response.json({ error: "Use Refresh counts without credentials, URLs or posting choices." }, { status: 400, headers }); }
  try { return Response.json(await syncFacebookPerformance(), { headers }); }
  catch { return Response.json({ error: "Facebook counts could not refresh. No post was submitted." }, { status: 503, headers }); }
}
