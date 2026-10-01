export type FeedbackDecision = "keep" | "revise";
export type FeedbackDimension = "story" | "visuals" | "audio" | "captions";
export const FEEDBACK_REQUESTS = ["clearer-explanation", "less-repetition", "stronger-ending", "matching-visuals", "natural-sentences"] as const;
export type FeedbackRequest = typeof FEEDBACK_REQUESTS[number];
export const FEEDBACK_REQUEST_LABELS: Record<FeedbackRequest, string> = {
  "clearer-explanation": "Explain the point with concrete details",
  "less-repetition": "Remove repeated points and filler",
  "stronger-ending": "Deliver what the opening promises",
  "matching-visuals": "Describe actions the visuals can show",
  "natural-sentences": "Use shorter, natural spoken sentences",
};
export type CreativeFeedback = {
  reviewId: string;
  title: string;
  creationType: string;
  decision: FeedbackDecision;
  ratings: Record<FeedbackDimension, number>;
  note: string;
  requests?: FeedbackRequest[];
  updatedAt: string;
};
export type CreativeGuidance = {
  feedbackCount: number;
  revision: string;
  priorities: FeedbackDimension[];
  rules: string[];
  maxCaptionWords: number;
  wordsPerSecond: number;
  policyVersion?: number;
  requests?: FeedbackRequest[];
};
export type QualityAssessment = {
  reviewId: string;
  title: string;
  decision: "BLOCKED" | "REVISE" | "AWAITING_REVIEW" | "OWNER_APPROVED";
  blockers: string[];
  checks: string[];
  feedback?: CreativeFeedback;
};
export type QualityManagerState = {
  mode: "local-feedback";
  checkedAt: string;
  queued: number;
  running: number;
  failed: number;
  reviewReady: number;
  guidance: CreativeGuidance;
  assessments: QualityAssessment[];
  capabilities: { singing: false; animation: string; learning: string; paidServices: false };
};
