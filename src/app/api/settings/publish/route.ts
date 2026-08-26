import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  console.log("Publish Settings GET: session =", JSON.stringify(session), "cookie =", req.headers.get("cookie"));
  let userId = (session?.user as any)?.id;

  if (!userId) {
    try {
      const defaultUser = await db.user.findFirst();
      userId = defaultUser?.id || "cmqh695mz0000y4jl85hnwwpl";
    } catch {
      userId = "cmqh695mz0000y4jl85hnwwpl";
    }
  }

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
          pexelsApiKey: "",
          pixabayApiKey: "",
          geminiApiKey: "",
          aiModel: "gemini-2.0-flash",
          aiTone: "clickbait",
          aiInstructions: "",
          subtitleFont: "Montserrat",
          subtitleColor: "#FFFF00",
          subtitleSize: "lg",
          subtitleStroke: true,
          subtitleUppercase: true,
          defaultMusicVolume: 0.15,
          duckingLevel: 0.80,
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
  console.log("Publish Settings POST: session =", JSON.stringify(session), "cookie =", req.headers.get("cookie"));
  let userId = (session?.user as any)?.id;

  if (!userId) {
    try {
      const defaultUser = await db.user.findFirst();
      userId = defaultUser?.id || "cmqh695mz0000y4jl85hnwwpl";
    } catch {
      userId = "cmqh695mz0000y4jl85hnwwpl";
    }
  }

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
      pexelsApiKey,
      pixabayApiKey,
      geminiApiKey,
      aiModel,
      aiTone,
      aiInstructions,
      subtitleFont,
      subtitleColor,
      subtitleSize,
      subtitleStroke,
      subtitleUppercase,
      defaultMusicVolume,
      duckingLevel,
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
        pexelsApiKey,
        pixabayApiKey,
        geminiApiKey,
        aiModel,
        aiTone,
        aiInstructions,
        subtitleFont,
        subtitleColor,
        subtitleSize,
        subtitleStroke,
        subtitleUppercase,
        defaultMusicVolume: defaultMusicVolume !== undefined ? parseFloat(defaultMusicVolume) : undefined,
        duckingLevel: duckingLevel !== undefined ? parseFloat(duckingLevel) : undefined,
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
        pexelsApiKey,
        pixabayApiKey,
        geminiApiKey,
        aiModel,
        aiTone,
        aiInstructions,
        subtitleFont,
        subtitleColor,
        subtitleSize,
        subtitleStroke,
        subtitleUppercase,
        defaultMusicVolume: defaultMusicVolume !== undefined ? parseFloat(defaultMusicVolume) : 0.15,
        duckingLevel: duckingLevel !== undefined ? parseFloat(duckingLevel) : 0.80,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Save publish settings error:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
