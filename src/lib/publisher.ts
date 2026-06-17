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
      if (!credentials.instagramAccessToken || !credentials.instagramAccountId) {
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

      if (!publicMediaUrl) {
        return {
          success: false,
          error: "Instagram Graph API requires a public URL. Failed to host the video buffer on a temporary public CDN."
        };
      }

      return await publishToInstagram(payload, publicMediaUrl, credentials);
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

    const sessionRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.youtubeAccessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(fileStats.size),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!sessionRes.ok) {
      const errText = await sessionRes.text();
      return { success: false, error: `Failed to initialize YouTube session: ${errText}` };
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
                Authorization: `Bearer ${credentials.youtubeAccessToken}`,
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
    const caption = `${payload.caption || ""} ${payload.hashtags || ""}`.trim();
    const { instagramAccountId, instagramAccessToken } = credentials;

    // Step 1: Create media container
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media?media_type=REELS&video_url=${encodeURIComponent(
        publicMediaUrl
      )}&caption=${encodeURIComponent(caption)}&access_token=${instagramAccessToken}`,
      { method: "POST" }
    );

    if (!containerRes.ok) {
      const errText = await containerRes.text();
      return { success: false, error: `Instagram Container creation failed: ${errText}` };
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
