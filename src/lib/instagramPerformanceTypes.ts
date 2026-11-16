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
  /** Recorded only for a matched, unchanged published experiment recipe. */
  sequenceExperiment?: "focus-four-v1" | "montage-control-v1";
};

export type InstagramPerformanceState = {
  version: 1;
  account?: { id: string; name: string; connectionRevision: string };
  status: "not_connected" | "permission_required" | "syncing" | "ready" | "limited" | "error" | "rate_limited";
  detail: string;
  updatedAt?: string;
  lastSuccessfulSyncAt?: string;
  /** Current measured rows can teach while older account history is still scanning. */
  lastSuccessfulBatchAt?: string;
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
  attentionDiagnostic?: InstagramAttentionDiagnostic;
  attentionCohorts?: InstagramAttentionCohort[];
  attentionExperiment?: "focus-four-v1";
};

export type InstagramAttentionDiagnostic = {
  measuredCount: number; belowHalfCount: number;
  medianWatchSeconds: number; medianRuntimeSeconds: number; medianWatchRatio: number;
};

export type InstagramAttentionCohort = {
  recipe: "focus-four-v1" | "montage-control-v1";
  ageBand: string; exposureMeasure: "reach" | "views"; videoCount: number; comparable: boolean;
  attention?: InstagramAttentionDiagnostic;
  rates: { comments: InstagramObservedRate; saves: InstagramObservedRate; shares: InstagramObservedRate };
};
type InstagramObservedRate = { measuredCount: number; medianPer100: number | null };

export type InstagramPerformanceResponse = InstagramPerformanceState & {
  summary: InstagramPerformanceSummary;
};
