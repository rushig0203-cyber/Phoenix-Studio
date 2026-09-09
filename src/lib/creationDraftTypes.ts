import type { GenerationInput } from "./generation";

export type FootageChoice = {
  id: number;
  duration: number;
  width: number;
  height: number;
  previewUrl: string;
  image: string;
  sourcePage: string;
  creator: string;
};
export type DraftScene = { narration: string; query: string; footage?: FootageChoice };
export type CreationDraft = {
  id: string;
  requestKey: string;
  version: number;
  status: "QUEUED" | "PLANNING" | "READY" | "FAILED" | "APPROVING" | "APPROVED" | "ARCHIVED";
  stage: string;
  input: GenerationInput;
  scenes: DraftScene[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  leaseUntil?: number;
  leaseOwner?: string;
  approvedJobId?: string;
  songTaskId?: string;
  songSubmissionStarted?: boolean;
};
