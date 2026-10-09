import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertLocalChannelRequest, beginChannelOAuth, channelError, connectInstagramToken,
  disconnectChannel, isChannelPlatform, listChannels, normalizeInstagramToken, normalizeInstagramPageId, saveChannelCredentials, verifyChannel,
} from "@/lib/channelConnections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ platform: string }> };
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), clientId: z.string().trim().min(3).max(500), clientSecret: z.string().trim().max(2000).default("") }),
  z.object({ action: z.literal("connect"), intent: z.enum(["identity", "upload"]).default("identity") }),
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("instagram-token"), accessToken: z.string().max(16000).transform((value, context) => {
    try { return normalizeInstagramToken(value); }
    catch { context.addIssue({ code: "custom", message: "Paste the complete Instagram access token, not a URL, command, JSON response, or app secret." }); return z.NEVER; }
  }), pageId: z.string().max(64).optional().transform((value, context) => {
    try { return normalizeInstagramPageId(value); }
    catch { context.addIssue({ code: "custom", message: "Enter the numeric Facebook Page ID from Meta Business Suite (5–30 digits), not a URL or account name." }); return z.NEVER; }
  }) }),
]);
const channelBodyLimit = 16000;
class ChannelBodyTooLarge extends Error {
  constructor() { super("Channel settings are too large."); }
}
async function readChannelBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > channelBodyLimit) {
    await request.body?.cancel().catch(() => undefined);
    throw new ChannelBodyTooLarge();
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > channelBodyLimit) {
        await reader.cancel().catch(() => undefined);
        throw new ChannelBodyTooLarge();
      }
      parts.push(next.value);
    }
  } catch (error) {
    if (error instanceof ChannelBodyTooLarge) throw error;
    throw new Error("Could not read the channel settings. Try submitting them again.");
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts, size).toString("utf8")); }
  catch { return {}; }
}

export async function POST(request: Request, context: Context) {
  try {
    assertLocalChannelRequest(request, true);
    const { platform } = await context.params;
    if (!isChannelPlatform(platform)) return NextResponse.json({ error: "Unknown channel." }, { status: 404 });
    const rawBody = await readChannelBody(request);
    const parsed = input.safeParse(rawBody);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid channel request." }, { status: 400 });
    const data = parsed.data, origin = new URL(request.url).origin;
    if (data.action === "configure") await saveChannelCredentials(platform, data.clientId, data.clientSecret);
    if (data.action === "verify") await verifyChannel(platform);
    if (data.action === "instagram-token") {
      if (platform !== "instagram") return NextResponse.json({ error: "This option is for Instagram only." }, { status: 400 });
      await connectInstagramToken(data.accessToken, data.pageId);
    }
    if (data.action === "connect") {
      const result = await beginChannelOAuth(platform, origin, data.intent);
      const response = NextResponse.json({ authorizationUrl: result.url }, { headers: { "Cache-Control": "no-store" } });
      response.cookies.set(`phoenix-channel-${platform}`, result.browser, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), maxAge: 600, path: `/api/channels/${platform}/callback` });
      return response;
    }
    return NextResponse.json({ channels: await listChannels(origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: channelError(error) }, { status: error instanceof ChannelBodyTooLarge ? 413 : 400, headers: { "Cache-Control": "no-store" } });
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
