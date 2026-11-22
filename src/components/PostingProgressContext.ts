"use client";

import { createContext, useContext } from "react";
import type { ReviewFile } from "@/lib/reviewFiles";
import type { ReviewPublishJob } from "@/lib/reviewPublishing";

type ProgressContext = {
  jobs: ReviewPublishJob[];
  error: string;
  observe: (file: ReviewFile, jobs: ReviewPublishJob[]) => void;
  accepted: (file: ReviewFile, job: ReviewPublishJob) => void;
};

export const PostingContext = createContext<ProgressContext | null>(null);
export const usePostingProgress = () => useContext(PostingContext);
