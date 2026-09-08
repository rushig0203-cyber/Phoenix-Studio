import { NextResponse } from "next/server";
import { assertLocalChannelRequest, channelError, listChannels } from "@/lib/channelConnections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalChannelRequest(request);
    return NextResponse.json({ channels: await listChannels(new URL(request.url).origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: channelError(error) }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
