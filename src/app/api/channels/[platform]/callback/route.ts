import { NextRequest, NextResponse } from "next/server";
import { assertLocalChannelRequest, channelError, finishChannelOAuth, isChannelPlatform } from "@/lib/channelConnections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  if (!isChannelPlatform(platform)) return NextResponse.json({ error: "Unknown channel." }, { status: 404 });
  const url = new URL(request.url);
  try { assertLocalChannelRequest(request); }
  catch { return NextResponse.json({ error: "Open Phoenix Studio on localhost." }, { status: 403 }); }
  const result = new URL("/dashboard/settings", url.origin);
  result.hash = "channels";
  try {
    if (url.searchParams.has("error")) throw new Error("Connection cancelled or permission was not granted. You can try Connect again.");
    const code = url.searchParams.get("code") || "";
    if (!code || code.length > 10000) throw new Error("Missing authorization code. Start Connect again.");
    await finishChannelOAuth(platform, url.origin, url.searchParams.get("state") || "", request.cookies.get(`phoenix-channel-${platform}`)?.value || "", code);
    result.searchParams.set("channelConnected", platform);
  } catch (error) { result.searchParams.set("channelError", channelError(error)); }
  const response = NextResponse.redirect(result, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  response.cookies.set(`phoenix-channel-${platform}`, "", { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 0, path: `/api/channels/${platform}/callback` });
  return response;
}
