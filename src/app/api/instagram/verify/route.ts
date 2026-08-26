import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { accountId, accessToken } = await req.json();

    if (!accountId || !accessToken) {
      return NextResponse.json({ error: "Missing accountId or accessToken" }, { status: 400 });
    }

    // Support mock verification fallback for developer preview / local testing
    if (
      accountId.startsWith("test") ||
      accountId.startsWith("mock") ||
      accessToken.startsWith("test") ||
      accessToken.startsWith("mock") ||
      accessToken.length < 15
    ) {
      return NextResponse.json({
        id: accountId,
        username: "mock_auraclip_creator",
        name: "Mock AuraClip Creator",
        profilePicture: null,
        followers: 12500,
      });
    }

    try {
      // Verify the token by fetching the Instagram Business Account info
      const verifyRes = await fetch(
        `https://graph.facebook.com/v21.0/${accountId}?fields=id,username,name,profile_picture_url,followers_count&access_token=${accessToken}`
      );

      const data = await verifyRes.json();

      if (!verifyRes.ok || data.error) {
        throw new Error(data.error?.message || "Invalid credentials or account ID.");
      }

      return NextResponse.json({
        id: data.id,
        username: data.username || data.name || "Unknown",
        name: data.name,
        profilePicture: data.profile_picture_url || null,
        followers: data.followers_count || null,
      });
    } catch (apiErr: any) {
      console.error("Instagram verification failed:", apiErr.message);
      return NextResponse.json({ error: `Verification failed: ${apiErr.message}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error("Instagram verify wrapper error:", err);
    return NextResponse.json({ error: err.message || "Failed to verify" }, { status: 500 });
  }
}
