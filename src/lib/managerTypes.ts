export type FeedbackDecision = "keep" | "revise";
export type FeedbackDimension = "story" | "visuals" | "audio" | "captions";
export type CreativeFeedback = {
  reviewId: string;
  title: string;
  creationType: string;
  decision: FeedbackDecision;
  ratings: Record<FeedbackDimension, number>;
  note: string;
  updatedAt: string;
};
export type CreativeGuidance = {
  feedbackCount: number;
  revision: string;
  priorities: FeedbackDimension[];
  rules: string[];
  maxCaptionWords: number;
  wordsPerSecond: number;
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
