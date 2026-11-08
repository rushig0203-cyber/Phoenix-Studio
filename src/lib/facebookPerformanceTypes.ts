export type FacebookPerformanceMetrics = {
  views: number | null; likes: number | null; comments: number | null;
  shares: number | null; averageWatchTimeMs: number | null;
};
export type FacebookPerformanceVideo = {
  id: string; caption: string; timestamp: string; permalink?: string;
  metrics: FacebookPerformanceMetrics;
};
export type FacebookPerformanceState = {
  status: "not_connected" | "permission_required" | "ready" | "limited" | "error" | "rate_limited" | "syncing";
  detail: string; account?: { name: string }; lastSuccessfulSyncAt?: string;
  videos: FacebookPerformanceVideo[];
};
