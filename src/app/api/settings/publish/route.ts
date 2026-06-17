import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  try {
    let settings = await db.publishSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await db.publishSettings.create({
        data: {
          userId,
          makeWebhookUrl: "",
          instagramConnected: false,
          instagramAccountName: "",
          instagramAccessToken: "",
          instagramAccountId: "",
          youtubeConnected: false,
          youtubeChannelName: "",
          youtubeAccessToken: "",
          youtubeRefreshToken: "",
          youtubeClientId: "",
          youtubeClientSecret: "",
        },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Fetch publish settings error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  try {
    const {
      makeWebhookUrl,
      instagramConnected,
      instagramAccountName,
      instagramAccessToken,
      instagramAccountId,
      youtubeConnected,
      youtubeChannelName,
      youtubeAccessToken,
      youtubeRefreshToken,
      youtubeClientId,
      youtubeClientSecret,
    } = await req.json();

    const updated = await db.publishSettings.upsert({
      where: { userId },
      update: {
        makeWebhookUrl,
        instagramConnected,
        instagramAccountName,
        instagramAccessToken,
        instagramAccountId,
        youtubeConnected,
        youtubeChannelName,
        youtubeAccessToken,
        youtubeRefreshToken,
        youtubeClientId,
        youtubeClientSecret,
      },
      create: {
        userId,
        makeWebhookUrl,
        instagramConnected,
        instagramAccountName,
        instagramAccessToken,
        instagramAccountId,
        youtubeConnected,
        youtubeChannelName,
        youtubeAccessToken,
        youtubeRefreshToken,
        youtubeClientId,
        youtubeClientSecret,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Save publish settings error:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
