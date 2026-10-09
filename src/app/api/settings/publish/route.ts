import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { z } from "zod";
import { listChannels } from "@/lib/channelConnections";

export const dynamic = "force-dynamic";

const preferences = z.object({ aiModel: z.string().max(80).optional(), aiTone: z.string().max(40).optional(), aiInstructions: z.string().max(2000).optional(), subtitleFont: z.string().max(80).optional(), subtitleColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), subtitleSize: z.string().max(20).optional(), subtitleStroke: z.boolean().optional(), subtitleUppercase: z.boolean().optional(), defaultMusicVolume: z.number().min(0).max(1).optional(), duckingLevel: z.number().min(0).max(1).optional() });
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
export async function POST(req: Request) { try { const userId = await requireUserId(); const parsed = preferences.safeParse(await req.json()); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid settings" }, { status: 400 }); const settings = await db.publishSettings.upsert({ where: { userId }, update: parsed.data, create: { userId, ...parsed.data } }); return NextResponse.json(await publicSettings(settings, new URL(req.url).origin)); } catch (error) { return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Unable to save settings" }, { status: isUnauthorized(error) ? 401 : 500 }); } }
