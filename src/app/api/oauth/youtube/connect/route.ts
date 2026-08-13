import { NextResponse } from "next/server";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { createOAuthState } from "@/lib/oauth-state";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    if (!process.env.GOOGLE_CLIENT_ID) return NextResponse.json({ error: "YouTube OAuth is not configured" }, { status: 503 });
    const origin = process.env.NEXTAUTH_URL || new URL(req.url).origin;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${origin}/api/oauth/youtube/callback`, response_type: "code", scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent", state: createOAuthState(userId, "youtube") }).toString();
    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Unable to start YouTube connection" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}
