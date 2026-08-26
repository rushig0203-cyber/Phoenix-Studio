import fs from "fs";
import path from "path";

interface PublishPayload {
  projectId: string;
  clipId: string;
  clipTitle: string;
  platform: string;
  caption?: string;
  hashtags?: string;
  youtubeTitle?: string;
  youtubeDesc?: string;
  youtubeTags?: string;
  thumbnailUrl?: string; // Path to local thumbnail file
}

/**
 * Direct Platform API Publisher for AuraClip
 */
export async function publishToPlatform(
  payload: PublishPayload,
  mediaPath: string,
  credentials: {
    instagramAccessToken?: string | null;
    instagramAccountId?: string | null;
    youtubeAccessToken?: string | null;
    youtubeRefreshToken?: string | null;
    youtubeClientId?: string | null;
    youtubeClientSecret?: string | null;
    makeWebhookUrl?: string | null;
  },
  publicMediaUrl?: string | null
): Promise<{ success: boolean; postUrl?: string; error?: string }> {
  try {
    const fullMediaPath = path.resolve(process.cwd(), mediaPath);
    if (!fs.existsSync(fullMediaPath)) {
      return { success: false, error: `Media file not found locally: ${mediaPath}` };
    }

    if (payload.platform === "YouTube") {
      // Check YouTube OAuth tokens
      if (!credentials.youtubeAccessToken) {
        return {
          success: false,
          error: `YouTube integration credentials missing. Please set your OAuth credentials in Dashboard Settings.
          
Manual Upload Steps:
1. Locate your clip at: ${fullMediaPath}
2. Open YouTube Studio (https://studio.youtube.com).
3. Click 'Create' > 'Upload video' and select your clip.
4. Set title to: "${payload.youtubeTitle || payload.clipTitle}"
5. Add description: "${payload.youtubeDesc || ""}"
6. Upload custom thumbnail if generated.`
        };
      }

      return await publishToYouTube(payload, fullMediaPath, credentials);
    } else if (payload.platform === "Instagram") {
      // Check Instagram credentials
      const token = credentials.instagramAccessToken || "";
      const accId = credentials.instagramAccountId || "";
      const isMock =
        token.startsWith("mock") ||
        token.startsWith("test") ||
        accId.startsWith("mock") ||
        accId.startsWith("test") ||
        token.length < 15;

      if (!token || !accId) {
        return {
          success: false,
          error: `Instagram Graph API Credentials missing. Please configure Page Access Token and Instagram Account ID in Settings.
          
Manual Upload Steps:
1. Locate your clip at: ${fullMediaPath}
2. Go to Instagram Web or use your mobile device.
3. Tap '+' > 'Reels' and select the video file.
4. Paste Caption: "${payload.caption || ""}"
5. Add Hashtags: "${payload.hashtags || ""}"
6. Publish Reel.`
        };
      }

      if (!publicMediaUrl && !isMock) {
        return {
          success: false,
          error: "Instagram Graph API requires a public URL. Failed to host the video buffer on a temporary public CDN."
        };
      }

      return await publishToInstagram(payload, publicMediaUrl || "", credentials);
    }

    return { success: false, error: `Unsupported platform: ${payload.platform}` };
  } catch (err: any) {
    console.error("AuraClip Direct Publisher error:", err);
    return { success: false, error: err.message || "Failed to publish clip" };
  }
}

/**
 * YouTube Direct API publisher (resumable protocol)
 */
async function publishToYouTube(
  payload: PublishPayload,
  filePath: string,
  credentials: any
): Promise<{ success: boolean; postUrl?: string; error?: string }> {
  try {
    // Support mock publishing fallback for developer/local testing
    const tokenVal = credentials.youtubeAccessToken || "";
    if (
      tokenVal.startsWith("mock") ||
      tokenVal.startsWith("test") ||
      tokenVal.length < 15
    ) {
      console.log("AuraClip: Mock publishing YouTube Short...");
      return {
        success: true,
        postUrl: `https://youtube.com/shorts/mock_${Math.random().toString(36).substring(2, 11)}`
      };
    }

    const fileStats = fs.statSync(filePath);
    const title = payload.youtubeTitle || payload.clipTitle;
    const description = payload.youtubeDesc || "";
    const tags = payload.youtubeTags ? payload.youtubeTags.split(",").map(t => t.trim()) : [];

    // Step 1: Initialize Resumable Session
    const metadata = {
      snippet: {
        title: title.slice(0, 100),
        description,
        tags,
        categoryId: "22", // People & Blogs
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
    };

    let accessToken = credentials.youtubeAccessToken;

    let sessionRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(fileStats.size),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify(metadata),
      }
    );

    if (sessionRes.status === 401 && credentials.youtubeRefreshToken && credentials.youtubeClientId && credentials.youtubeClientSecret) {
      console.log("AuraClip Publisher: Access token expired or invalid. Attempting refresh...");
      const newAccessToken = await refreshYouTubeAccessToken(credentials);
      if (newAccessToken) {
        accessToken = newAccessToken;
        sessionRes = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json; charset=UTF-8",
              "X-Upload-Content-Length": String(fileStats.size),
              "X-Upload-Content-Type": "video/mp4",
            },
            body: JSON.stringify(metadata),
          }
        );
      }
    }

    if (!sessionRes.ok) {
      const errText = await sessionRes.text();
      const isAuthError = sessionRes.status === 401 || errText.includes("invalid_client") || errText.includes("authError");
      const errorMsg = isAuthError 
        ? "YouTube Authentication Failed: The API key or token has expired or is invalid. Please download the compiled clip and upload it manually via YouTube Studio."
        : `Failed to initialize YouTube session: ${errText}`;
      return { success: false, error: errorMsg };
    }

    const uploadUrl = sessionRes.headers.get("Location");
    if (!uploadUrl) {
      return { success: false, error: "YouTube API response missing upload session Location header." };
    }

    // Step 2: Stream Video Buffer to Upload URL
    const fileStream = fs.createReadStream(filePath);
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(fileStats.size),
        "Content-Type": "video/mp4",
      },
      body: fileStream as any,
      duplex: "half",
    } as any);

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return { success: false, error: `Failed to upload YouTube Shorts payload: ${errText}` };
    }

    const uploadData: any = await uploadRes.json();
    const videoId = uploadData.id;
    const postUrl = `https://youtube.com/shorts/${videoId}`;

    // Step 3: Set Custom Thumbnail if available
    if (payload.thumbnailUrl && videoId) {
      try {
        const thumbPath = path.resolve(process.cwd(), payload.thumbnailUrl);
        if (fs.existsSync(thumbPath)) {
          const thumbBuffer = fs.readFileSync(thumbPath);
          const thumbRes = await fetch(
            `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "image/jpeg",
                "Content-Length": String(thumbBuffer.length),
              },
              body: thumbBuffer,
            }
          );
          if (!thumbRes.ok) {
            console.warn("YouTube Direct Publisher: Failed to upload custom thumbnail:", await thumbRes.text());
          }
        }
      } catch (thumbErr) {
        console.warn("YouTube Direct Publisher: Error uploading custom thumbnail:", thumbErr);
      }
    }

    return { success: true, postUrl };
  } catch (err: any) {
    return { success: false, error: `YouTube API publishing error: ${err.message}` };
  }
}

/**
 * Instagram Reels direct API publisher
 */
async function publishToInstagram(
  payload: PublishPayload,
  publicMediaUrl: string,
  credentials: any
): Promise<{ success: boolean; postUrl?: string; error?: string }> {
  try {
    const { instagramAccountId, instagramAccessToken } = credentials;

    // Support mock publishing fallback for developer/local testing
    const token = instagramAccessToken || "";
    const accId = instagramAccountId || "";
    if (
      token.startsWith("mock") ||
      token.startsWith("test") ||
      accId.startsWith("mock") ||
      accId.startsWith("test") ||
      token.length < 15
    ) {
      console.log("AuraClip: Mock publishing Instagram Reel...");
      return {
        success: true,
        postUrl: `https://instagram.com/reel/mock_${Math.random().toString(36).substring(2, 11)}`
      };
    }

    const caption = `${payload.caption || ""} ${payload.hashtags || ""}`.trim();

    // Step 1: Create media container
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media?media_type=REELS&video_url=${encodeURIComponent(
        publicMediaUrl
      )}&caption=${encodeURIComponent(caption)}&access_token=${instagramAccessToken}`,
      { method: "POST" }
    );

    if (!containerRes.ok) {
      const errText = await containerRes.text();
      console.error("AuraClip Instagram Graph API Error response:", errText);
      let metaErrorDetail = "";
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error && parsed.error.message) {
          metaErrorDetail = ` Meta error: ${parsed.error.message} (code ${parsed.error.code}, subcode ${parsed.error.error_subcode})`;
        }
      } catch {}

      const isAuthError = containerRes.status === 401 || errText.includes("access token") || errText.includes("invalid token") || (errText.includes("OAuthException") && (errText.includes("token") || errText.includes("Session")));
      const errorMsg = isAuthError
        ? `Instagram Authentication Failed: The Page Access Token is invalid or expired.${metaErrorDetail} Please download the compiled clip and upload it manually via the Instagram app/web.`
        : `Instagram Container creation failed: ${metaErrorDetail || errText}`;
      return { success: false, error: errorMsg };
    }

    const { id: containerId } = await containerRes.json();

    // Step 2: Poll container status (max 10 retries, 15 seconds spacing)
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 15;

    while (!isReady && attempts < maxAttempts) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 15000));

      const statusRes = await fetch(
        `https://graph.facebook.com/v19.0/${containerId}?fields=status_code,error_message&access_token=${instagramAccessToken}`
      );

      if (statusRes.ok) {
        const { status_code, error_message } = await statusRes.json();
        if (status_code === "FINISHED") {
          isReady = true;
        } else if (status_code === "ERROR") {
          return { success: false, error: `Meta media processing error: ${error_message}` };
        }
      } else {
        const statusErrText = await statusRes.text();
        console.warn(`AuraClip Instagram Status Check Failed: Status ${statusRes.status}: ${statusErrText}`);
      }
    }

    if (!isReady) {
      return { success: false, error: "Meta Graph API Reels processing timed out. Try again in a few minutes." };
    }

    // Step 3: Publish container
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish?creation_id=${containerId}&access_token=${instagramAccessToken}`,
      { method: "POST" }
    );

    if (!publishRes.ok) {
      const errText = await publishRes.text();
      console.error("AuraClip Instagram Publish Container Error response:", errText);
      return { success: false, error: `Failed to publish Instagram Reels container: ${errText}` };
    }

    const publishData = await publishRes.json();
    const mediaId = publishData.id;
    const postUrl = `https://instagram.com/reel/${mediaId}`;

    return { success: true, postUrl };
  } catch (err: any) {
    return { success: false, error: `Instagram API publishing error: ${err.message}` };
  }
}

/**
 * Exchange YouTube Refresh Token for a fresh Access Token
 */
export async function refreshYouTubeAccessToken(credentials: any): Promise<string | null> {
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: credentials.youtubeClientId,
        client_secret: credentials.youtubeClientSecret,
        refresh_token: credentials.youtubeRefreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("AuraClip: Failed to refresh YouTube access token:", errText);
      return null;
    }

    const data = await tokenRes.json();
    const newAccessToken = data.access_token;
    if (!newAccessToken) {
      console.error("AuraClip: Refreshed token response did not contain access_token.");
      return null;
    }

    if (credentials.userId) {
      const { db } = await import("./db");
      await db.publishSettings.update({
        where: { userId: credentials.userId },
        data: { youtubeAccessToken: newAccessToken },
      });
      console.log("AuraClip: YouTube access token successfully refreshed and saved to database.");
    }

    return newAccessToken;
  } catch (err) {
    console.error("AuraClip: Error refreshing YouTube access token:", err);
    return null;
  }
}

export async function uploadToUguu(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const https = require("https");
      const fs = require("fs");
      const path = require("path");
      
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const fileName = path.basename(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      
      const header = 
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files[]"; filename="${fileName}"\r\n` +
        `Content-Type: video/mp4\r\n\r\n`;
        
      const footer = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([
        Buffer.from(header, "utf-8"),
        fileBuffer,
        Buffer.from(footer, "utf-8")
      ]);
      
      const req = https.request("https://uguu.se/upload", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          "User-Agent": "AuraClip/1.0"
        },
        timeout: 60000
      }, (res: any) => {
        let data = "";
        res.on("data", (chunk: any) => data += chunk);
        res.on("end", () => {
          try {
            if (res.statusCode === 200) {
              const json = JSON.parse(data);
              if (json.success && json.files?.[0]?.url) {
                resolve(json.files[0].url);
                return;
              }
            }
          } catch {}
          resolve(null);
        });
      });
      
      req.on("error", (err: any) => {
        console.warn("AuraClip Uguu upload error:", err.message);
        resolve(null);
      });
      
      req.write(body);
      req.end();
    } catch (err: any) {
      console.warn("AuraClip Uguu helper error:", err.message);
      resolve(null);
    }
  });
}

export async function uploadTo0x0(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const https = require("https");
      const fs = require("fs");
      const path = require("path");
      
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const fileName = path.basename(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      
      const header = 
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: video/mp4\r\n\r\n`;
        
      const footer = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([
        Buffer.from(header, "utf-8"),
        fileBuffer,
        Buffer.from(footer, "utf-8")
      ]);
      
      const req = https.request("https://0x0.st", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          "User-Agent": "AuraClip/1.0"
        },
        timeout: 60000
      }, (res: any) => {
        let data = "";
        res.on("data", (chunk: any) => data += chunk);
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(data.trim());
          } else {
            resolve(null);
          }
        });
      });
      
      req.on("error", (err: any) => {
        console.warn("AuraClip 0x0.st upload error:", err.message);
        resolve(null);
      });
      
      req.write(body);
      req.end();
    } catch (err: any) {
      console.warn("AuraClip 0x0.st helper error:", err.message);
      resolve(null);
    }
  });
}

/**
 * Upload a local video file to get a temporary public URL.
 * Falls back sequentially between Uguu.se, 0x0.st, and other free CDNs.
 */
export async function uploadToTransferSh(filePath: string, fileName: string): Promise<string | null> {
  try {
    // 1. Try Uguu.se (native HTTPS, extremely reliable on Windows)
    console.log("AuraClip: Trying to upload to uguu.se via native HTTPS...");
    const uguuUrl = await uploadToUguu(filePath);
    if (uguuUrl) {
      console.log(`AuraClip: Successfully uploaded to uguu.se. URL: ${uguuUrl}`);
      return uguuUrl;
    }

    // 2. Try 0x0.st (native HTTPS, extremely reliable on Windows)
    console.log("AuraClip: Trying to upload to 0x0.st via native HTTPS...");
    const zeroUrl = await uploadTo0x0(filePath);
    if (zeroUrl) {
      console.log(`AuraClip: Successfully uploaded to 0x0.st. URL: ${zeroUrl}`);
      return zeroUrl;
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: "video/mp4" });

    // Use tmpfiles.org and catbox.moe as secondary fallbacks
    const uploadHosts = [
      {
        url: `https://tmpfiles.org/api/v1/upload`,
        method: "POST",
        buildBody: () => {
          const fd = new FormData();
          fd.append("file", blob, fileName);
          return fd;
        },
        parseUrl: (text: string) => {
          try {
            const json = JSON.parse(text);
            if (json.status === "success" && json.data?.url) {
              return json.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
            }
          } catch {}
          return text.trim();
        },
      },
      {
        url: `https://catbox.moe/user/api.php`,
        method: "POST",
        buildBody: () => {
          const fd = new FormData();
          fd.append("reqtype", "fileupload");
          fd.append("fileToUpload", blob, fileName);
          return fd;
        },
        parseUrl: (text: string) => text.trim(),
      },
      {
        url: `https://0x0.st`,
        method: "POST",
        buildBody: () => {
          const fd = new FormData();
          fd.append("file", blob, fileName);
          return fd;
        },
        parseUrl: (text: string) => text.trim(),
      },
      {
        url: `https://transfer.sh/${encodeURIComponent(fileName)}`,
        method: "PUT",
        buildBody: () => blob,
        parseUrl: (text: string) => text.trim(),
      },
    ];

    for (const host of uploadHosts) {
      try {
        console.log(`AuraClip: Trying to upload to ${host.url}...`);
        const res = await fetch(host.url, {
          method: host.method,
          body: host.buildBody() as BodyInit,
          headers: host.method === "PUT" ? { "Content-Type": "video/mp4" } : {},
          signal: AbortSignal.timeout(20_000), // 20s timeout
        });
        if (res.ok) {
          const responseText = await res.text();
          const url = host.parseUrl(responseText);
          if (url.startsWith("http")) {
            console.log(`AuraClip: Successfully uploaded to ${host.url}. URL: ${url}`);
            return url;
          }
        } else {
          const errorText = await res.text();
          console.warn(`AuraClip: Upload to ${host.url} failed with status ${res.status}: ${errorText.slice(0, 200)}`);
        }
      } catch (err: any) {
        console.warn(`AuraClip: Upload to ${host.url} threw error:`, err.message);
      }
    }

    console.error("AuraClip: All public upload hosts failed.");
    return null;
  } catch (err) {
    console.error("AuraClip: Failed to upload clip to public host:", err);
    return null;
  }
}

// Helper to trigger the Make.com webhook with JSON payload including a public mediaUrl
export async function triggerWebhook(
  webhookUrl: string,
  payload: {
    projectId: string;
    clipId: string;
    clipTitle: string;
    platform: string;
    caption?: string;
    hashtags?: string;
    youtubeTitle?: string;
    youtubeDesc?: string;
  },
  mediaPath?: string
): Promise<{ success: boolean; postUrl?: string; error?: string }> {
  try {
    // Auto-upload clip to a free public host so Make.com can access the Video URL
    let mediaUrl: string | undefined;
    if (mediaPath) {
      const fullPath = path.resolve(process.cwd(), mediaPath);
      if (fs.existsSync(fullPath)) {
        const fileName = path.basename(fullPath);
        console.log(`AuraClip: Uploading ${fileName} to public host for Make.com...`);
        const uploaded = await uploadToTransferSh(fullPath, fileName);
        if (uploaded) {
          mediaUrl = uploaded;
          console.log(`AuraClip: Public media URL ready → ${mediaUrl}`);
        } else {
          console.warn("AuraClip: Could not upload to public host. Make.com will receive no mediaUrl.");
        }
      } else {
        return { success: false, error: `Media file not found at path: ${mediaPath}` };
      }
    }

    // Send clean JSON to Make.com so every field is individually mappable
    const jsonPayload = {
      projectId: payload.projectId,
      clipId: payload.clipId,
      clipTitle: payload.clipTitle,
      platform: payload.platform,
      mediaUrl,                              // ← direct public video URL for Instagram/YouTube
      instagram: {
        caption: payload.caption || "",
        hashtags: payload.hashtags || "",
      },
      youtube: {
        title: payload.youtubeTitle || "",
        description: payload.youtubeDesc || "",
        hashtags: payload.hashtags || "",
      },
      timestamp: new Date().toISOString(),
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonPayload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Webhook responded with status ${res.status}: ${text}` };
    }

    let postUrl = `https://instagram.com/p/mock-post-${payload.clipId}`;
    if (payload.platform === "YouTube") {
      postUrl = `https://youtube.com/shorts/mock-shorts-${payload.clipId}`;
    }

    try {
      const data = await res.json();
      if (data.postUrl) postUrl = data.postUrl;
    } catch {
      // Non-JSON response is fine, use fallback
    }

    return { success: true, postUrl };
  } catch (error: any) {
    console.error("AuraClip Publishing: Webhook trigger failed:", error);
    return { success: false, error: error.message || "Network request failed" };
  }
}

