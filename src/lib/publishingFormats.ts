export const PUBLISHING_PROFILES = {
  "youtube-full": {
    label: "YouTube full video / song",
    shortLabel: "YouTube Full",
    platform: "YouTube",
    reviewTarget: "youtube",
    aspect: "16:9",
    minDuration: 150,
    maxDuration: 210,
    defaultDuration: 180,
    durationOptions: [150, 180, 210],
  },
  "youtube-short": {
    label: "YouTube Short",
    shortLabel: "YouTube Short",
    platform: "YouTube",
    reviewTarget: "youtube",
    aspect: "9:16",
    minDuration: 60,
    maxDuration: 90,
    defaultDuration: 75,
    durationOptions: [60, 75, 90],
  },
  "instagram-reel": {
    label: "Instagram Reel",
    shortLabel: "Instagram Reel",
    platform: "Instagram",
    reviewTarget: "instagram",
    aspect: "9:16",
    minDuration: 45,
    maxDuration: 105,
    defaultDuration: 75,
    durationOptions: [45, 60, 75, 90, 105],
  },
} as const;

export type PublishingFormat = keyof typeof PUBLISHING_PROFILES;
export type PublishingProfile = (typeof PUBLISHING_PROFILES)[PublishingFormat];

export function isPublishingFormat(value: unknown): value is PublishingFormat {
  return typeof value === "string" && value in PUBLISHING_PROFILES;
}

export function publishingProfile(format: PublishingFormat): PublishingProfile {
  return PUBLISHING_PROFILES[format];
}

export function durationFitsPublishingFormat(format: PublishingFormat, duration: number) {
  const profile = publishingProfile(format);
  return Number.isInteger(duration) && duration >= profile.minDuration && duration <= profile.maxDuration;
}

export function inferPublishingFormat(input: {
  publishingFormat?: unknown;
  aspect?: unknown;
  targetPlatform?: unknown;
  duration?: unknown;
}): PublishingFormat {
  if (isPublishingFormat(input.publishingFormat)) return input.publishingFormat;
  if (input.targetPlatform === "Instagram") return "instagram-reel";
  if (input.aspect === "16:9" || Number(input.duration) > 105) return "youtube-full";
  return "youtube-short";
}
