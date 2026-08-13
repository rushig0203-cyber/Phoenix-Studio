import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";
import { readOAuthState } from "@/lib/oauth-state";

export async function GET(req: Request) {
  const url = new URL(req.url); const origin = process.env.NEXTAUTH_URL || url.origin;
  try {
    const { userId } = readOAuthState(url.searchParams.get("state") || "", "youtube");
    const code = url.searchParams.get("code"); if (!code) throw new Error("Authorization was cancelled");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${origin}/api/oauth/youtube/callback`, grant_type: "authorization_code" }) });
    const tokens = await tokenRes.json(); if (!tokenRes.ok) throw new Error(tokens.error_description || "Google token exchange failed");
    const channelRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const channel = await channelRes.json(); if (!channelRes.ok || !channel.items?.[0]) throw new Error("No YouTube channel was found");
    await db.publishSettings.upsert({ where: { userId }, update: { youtubeConnected: true, youtubeChannelName: channel.items[0].snippet.title, youtubeAccessToken: encryptSecret(tokens.access_token), youtubeRefreshToken: encryptSecret(tokens.refresh_token), youtubeClientId: null, youtubeClientSecret: null }, create: { userId, youtubeConnected: true, youtubeChannelName: channel.items[0].snippet.title, youtubeAccessToken: encryptSecret(tokens.access_token), youtubeRefreshToken: encryptSecret(tokens.refresh_token) } });
    return NextResponse.redirect(`${origin}/dashboard/settings?connected=youtube`);
  } catch (error) { return NextResponse.redirect(`${origin}/dashboard/settings?error=${encodeURIComponent(error instanceof Error ? error.message : "YouTube connection failed")}`); }
}
