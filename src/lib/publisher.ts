type Payload = {
  projectId: string;
  clipId: string;
  clipTitle: string;
  platform: string;
  caption?: string;
  hashtags?: string;
  youtubeTitle?: string;
  youtubeDesc?: string;
  youtubeTags?: string;
  thumbnailUrl?: string;
};

type Credentials = {
  userId?: string;
  instagramAccessToken?: string | null;
  instagramAccountId?: string | null;
  youtubeAccessToken?: string | null;
  youtubeRefreshToken?: string | null;
  youtubeClientId?: string | null;
  youtubeClientSecret?: string | null;
};

const localOnlyMessage =
  "Automatic cloud publishing is disabled in free local mode. Download the finished review file and post it yourself.";

export async function publishToPlatform(
  _payload: Payload,
  _mediaPath: string,
  _credentials: Credentials,
  _publicMediaUrl?: string | null
): Promise<{ success: boolean; postUrl?: string; error?: string }> {
  return { success: false, error: localOnlyMessage };
}

export async function refreshYouTubeAccessToken(
  _credentials: {
    userId?: string;
    youtubeClientId?: string | null;
    youtubeClientSecret?: string | null;
    youtubeRefreshToken?: string | null;
  }
) {
  return null;
}
