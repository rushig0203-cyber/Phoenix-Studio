import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertLocalChannelRequest, beginChannelOAuth, channelError, connectInstagramToken,
  disconnectChannel, isChannelPlatform, listChannels, normalizeInstagramToken, saveChannelCredentials, verifyChannel,
} from "@/lib/channelConnections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ platform: string }> };
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), clientId: z.string().trim().min(3).max(500), clientSecret: z.string().trim().max(2000).default("") }),
  z.object({ action: z.literal("connect") }),
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("instagram-token"), accessToken: z.string().max(16000).transform((value, context) => {
    try { return normalizeInstagramToken(value); }
    catch { context.addIssue({ code: "custom", message: "Paste the complete Instagram access token, not a URL, command, JSON response, or app secret." }); return z.NEVER; }
  }) }),
]);

export async function POST(request: Request, context: Context) {
  try {
    assertLocalChannelRequest(request, true);
    const { platform } = await context.params;
    if (!isChannelPlatform(platform)) return NextResponse.json({ error: "Unknown channel." }, { status: 404 });
    if (Number(request.headers.get("content-length") || 0) > 16000) return NextResponse.json({ error: "Channel settings are too large." }, { status: 413 });
    const rawBody = await request.json().catch(() => ({}));
    const parsed = input.safeParse(rawBody);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid channel request." }, { status: 400 });
    const data = parsed.data, origin = new URL(request.url).origin;
    if (data.action === "configure") await saveChannelCredentials(platform, data.clientId, data.clientSecret);
    if (data.action === "verify") await verifyChannel(platform);
    if (data.action === "instagram-token") {
      if (platform !== "instagram") return NextResponse.json({ error: "This option is for Instagram only." }, { status: 400 });
      await connectInstagramToken(data.accessToken);
    }
    if (data.action === "connect") {
      const result = await beginChannelOAuth(platform, origin);
      const response = NextResponse.json({ authorizationUrl: result.url }, { headers: { "Cache-Control": "no-store" } });
      response.cookies.set(`phoenix-channel-${platform}`, result.browser, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), maxAge: 600, path: `/api/channels/${platform}/callback` });
      return response;
    }
    return NextResponse.json({ channels: await listChannels(origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: channelError(error) }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertLocalChannelRequest(request, true);
    const { platform } = await context.params;
    if (!isChannelPlatform(platform)) return NextResponse.json({ error: "Unknown channel." }, { status: 404 });
    await disconnectChannel(platform);
    return NextResponse.json({ channels: await listChannels(new URL(request.url).origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: channelError(error) }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
