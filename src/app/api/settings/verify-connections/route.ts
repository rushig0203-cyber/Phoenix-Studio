import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { refreshYouTubeAccessToken } from "@/lib/publisher";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
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
    const settings = await db.publishSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      return NextResponse.json({
        instagram: { status: "unconfigured", details: "No settings found" },
        youtube: { status: "unconfigured", details: "No settings found" }
      });
    }

    const results = {
      instagram: { status: "unconfigured", details: "" },
      youtube: { status: "unconfigured", details: "" }
    };

    // 1. Verify Instagram Connection
    if (settings.instagramConnected) {
      const token = settings.instagramAccessToken || "";
      const accountId = settings.instagramAccountId || "";
      
      const isMock =
        token.startsWith("mock") ||
        token.startsWith("test") ||
        accountId.startsWith("mock") ||
        accountId.startsWith("test") ||
        token.length < 15;

      if (isMock) {
        results.instagram = {
          status: "mock",
          details: settings.instagramAccountName || "Mock Instagram Account"
        };
      } else if (!token || !accountId) {
        results.instagram = {
          status: "invalid",
          details: "Missing Access Token or Account ID"
        };
      } else {
        try {
          const verifyRes = await fetch(
            `https://graph.facebook.com/v21.0/${accountId}?fields=id,username,name&access_token=${token}`
          );
          const data = await verifyRes.json();
          if (verifyRes.ok && !data.error) {
            results.instagram = {
              status: "valid",
              details: `Connected as @${data.username || data.name || settings.instagramAccountName}`
            };
          } else {
            results.instagram = {
              status: "invalid",
              details: data.error?.message || "Invalid token or account ID"
            };
          }
        } catch (err: any) {
          results.instagram = {
            status: "invalid",
            details: `Meta API request failed: ${err.message}`
          };
        }
      }
    }

    // 2. Verify YouTube Connection
    if (settings.youtubeConnected) {
      const token = settings.youtubeAccessToken || "";
      
      const isMock =
        token.startsWith("mock") ||
        token.startsWith("test") ||
        token.length < 15;

      if (isMock) {
        results.youtube = {
          status: "mock",
          details: settings.youtubeChannelName || "Mock YouTube Channel"
        };
      } else if (!token) {
        results.youtube = {
          status: "invalid",
          details: "Missing Access Token"
        };
      } else {
        let currentToken = token;
        
        const tryYoutubeApi = async (tok: string) => {
          try {
            const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
              headers: { Authorization: `Bearer ${tok}` }
            });
            const data = await res.json();
            return { status: res.status, data };
          } catch (err: any) {
            return { status: 500, error: err.message };
          }
        };

        let apiResult = await tryYoutubeApi(currentToken);

        // Attempt refresh if unauthorized (401)
        if (apiResult.status === 401 && settings.youtubeRefreshToken) {
          console.log("AuraClip Verifier: YouTube token expired, attempting database refresh...");
          const newAccessToken = await refreshYouTubeAccessToken({
            userId,
            youtubeClientId: settings.youtubeClientId,
            youtubeClientSecret: settings.youtubeClientSecret,
            youtubeRefreshToken: settings.youtubeRefreshToken
          });

          if (newAccessToken) {
            currentToken = newAccessToken;
            apiResult = await tryYoutubeApi(currentToken);
          }
        }

        if (apiResult.status === 200 && apiResult.data && !apiResult.data.error) {
          results.youtube = {
            status: "valid",
            details: `Connected to "${settings.youtubeChannelName || "YouTube Channel"}"`
          };
        } else {
          const errDetail = apiResult.error || apiResult.data?.error?.message || `Google API returned status ${apiResult.status}`;
          results.youtube = {
            status: "invalid",
            details: `YouTube API Verification Failed: ${errDetail}`
          };
        }
      }
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error("Connection check API error:", error);
    return NextResponse.json({ error: error.message || "Internal validation failure" }, { status: 500 });
  }
}
