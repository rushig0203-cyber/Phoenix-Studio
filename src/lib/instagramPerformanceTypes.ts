/** Only public account metadata and optional metrics; credentials stay in the vault. */
export type InstagramPerformanceMetrics = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  averageWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
};

export type InstagramPerformanceVideo = {
  id: string;
  caption: string;
  timestamp: string;
  mediaProductType: string;
  permalink?: string;
  metrics: InstagramPerformanceMetrics;
  metricsUpdatedAt?: string;
  metricIssues?: string[];
  /** Present only when the published media ID matches a saved Phoenix upload. */
  reviewId?: string;
  topic?: string;
  creationType?: string;
  durationSeconds?: number;
};

export type InstagramPerformanceState = {
  version: 1;
  account?: { id: string; name: string; connectionRevision: string };
  status: "not_connected" | "permission_required" | "syncing" | "ready" | "limited" | "error" | "rate_limited";
  detail: string;
  updatedAt?: string;
  lastSuccessfulSyncAt?: string;
  nextSyncAt?: string;
  videos: InstagramPerformanceVideo[];
  scannedVideos: number;
  historyComplete: boolean;
};

export type InstagramPerformanceAssessment = {
  videoId: string;
  label: "stronger" | "weaker" | "typical" | "too_early" | "insufficient_data" | "unavailable";
  reason: string;
  likeRate: number | null;
  engagementRate: number | null;
  baselineEngagementRate: number | null;
  peerCount: number;
};

export type InstagramPerformanceSummary = {
  revision: string;
  evaluatedAt: string;
  eligibleCount: number;
  assessments: InstagramPerformanceAssessment[];
  rules: string[];
  topicPreferences: Array<{ topic: string; evidenceCount: number; reviewIds: string[] }>;
  durationExperimentSeconds?: number;
};

export type InstagramPerformanceResponse = InstagramPerformanceState & {
  summary: InstagramPerformanceSummary;
};
