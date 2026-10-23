import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { listChannels } from "@/lib/channelConnections";

export const dynamic = "force-dynamic";

async function publicSettings(settings: Awaited<ReturnType<typeof db.publishSettings.findUnique>>, origin: string) {
  const channels = await listChannels(origin);
  return {
    instagramConnected: Boolean(channels.find(channel => channel.platform === "instagram")?.connected),
    youtubeConnected: Boolean(channels.find(channel => channel.platform === "youtube")?.connected),
    instagramPublishReady: Boolean(channels.find(channel => channel.platform === "instagram")?.publishReady),
    youtubePublishReady: Boolean(channels.find(channel => channel.platform === "youtube")?.publishReady),
    aiModel: settings?.aiModel,
    aiTone: settings?.aiTone,
    aiInstructions: settings?.aiInstructions,
    subtitleFont: settings?.subtitleFont,
    subtitleColor: settings?.subtitleColor,
    subtitleSize: settings?.subtitleSize,
    subtitleStroke: settings?.subtitleStroke,
    subtitleUppercase: settings?.subtitleUppercase,
    defaultMusicVolume: settings?.defaultMusicVolume,
    duckingLevel: settings?.duckingLevel,
  };
}
export async function GET(req: Request) { try { const userId = await requireUserId(); return NextResponse.json(await publicSettings(await db.publishSettings.findUnique({ where: { userId } }), new URL(req.url).origin)); } catch (error) { return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Unable to load settings" }, { status: isUnauthorized(error) ? 401 : 500 }); } }
