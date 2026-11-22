import type { ReviewPublishJob } from "./reviewPublishing";

export const postingActive = (job: ReviewPublishJob): boolean => ["QUEUED", "UPLOADING", "PROCESSING"].includes(job.status);

export function postingDestinations(jobs: ReviewPublishJob[]): ReviewPublishJob[] {
  const destinations = new Map<string, ReviewPublishJob>();
  for (const job of jobs) {
    destinations.set(job.id, job);
    if (job.companionStory) destinations.set(job.companionStory.id, job.companionStory);
  }
  return [...destinations.values()];
}

export function mergePostingJob(jobs: ReviewPublishJob[], job: ReviewPublishJob) {
  if (job.kind === "story" && !job.standaloneStory) {
    const parent = jobs.find(item => item.reviewId === job.reviewId && item.platform === "instagram" && !item.kind);
    if (parent) return jobs.map(item => item.id === parent.id ? { ...item, companionStory: job } : item);
  }
  return [...jobs.filter(item => item.id !== job.id && !(item.reviewId === job.reviewId && item.platform === job.platform && item.kind === job.kind))
    .map(item => job.standaloneStory && item.companionStory?.id === job.id
      ? { ...item, companionStory: undefined, companionStoryApproved: undefined, companionStoryDetached: true } : item), job];
}

export function transferPercent(job: ReviewPublishJob): number | undefined {
  if (!Number.isSafeInteger(job.totalBytes) || job.totalBytes <= 0 || !Number.isSafeInteger(job.bytesUploaded)
      || job.bytesUploaded < 0 || job.bytesUploaded > job.totalBytes) return undefined;
  return Math.floor(100 * job.bytesUploaded / job.totalBytes);
}

export function postingOverview(jobs: ReviewPublishJob[]) {
  const destinations = postingDestinations(jobs);
  const active = destinations.filter(postingActive);
  const attention = destinations.filter(job => job.status === "FAILED" || job.status === "NEEDS_CHECK").length;
  const measured = active.length > 0 && active.every(job => transferPercent(job) !== undefined);
  const percent = measured && active.some(job => job.status === "UPLOADING")
    ? Math.floor(100 * active.reduce((sum, job) => sum + job.bytesUploaded, 0) / active.reduce((sum, job) => sum + job.totalBytes, 0))
    : active.length === 0 && attention === 0 && destinations.length ? 100 : undefined;
  return { active, remaining: active.length, attention, percent };
}

export type TransferSample = { bytes: number; total: number; at: number; rate?: number };

/** Estimate only an observed, advancing transfer; platform processing has no measured deadline. */
export function sampleTransfers(jobs: ReviewPublishJob[], previous: Map<string, TransferSample>, at: number) {
  const samples = new Map<string, TransferSample>();
  for (const job of postingDestinations(jobs)) {
    if (job.status !== "UPLOADING" || transferPercent(job) === undefined) continue;
    const prior = previous.get(job.id);
    if (!prior || prior.total !== job.totalBytes || prior.bytes > job.bytesUploaded || at <= prior.at) {
      samples.set(job.id, { bytes: job.bytesUploaded, total: job.totalBytes, at });
    } else if (job.bytesUploaded > prior.bytes) {
      samples.set(job.id, { bytes: job.bytesUploaded, total: job.totalBytes, at,
        rate: (job.bytesUploaded - prior.bytes) / ((at - prior.at) / 1000) });
    } else samples.set(job.id, prior);
  }
  return samples;
}

export function transferTime(job: ReviewPublishJob, sample?: TransferSample, at = Date.now()) {
  if (job.status === "PROCESSING") return "Processing on platform";
  if (job.status === "QUEUED") return "Waiting to upload";
  if (job.status !== "UPLOADING") return "";
  if (transferPercent(job) === 100) return "Waiting for platform";
  if (!sample?.rate || sample.rate <= 0 || at - sample.at > 15_000 || sample.bytes !== job.bytesUploaded || sample.total !== job.totalBytes) return "Calculating time…";
  const seconds = Math.max(1, Math.ceil((job.totalBytes - job.bytesUploaded) / sample.rate));
  const duration = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.ceil(seconds / 60)} min` : `${Math.ceil(seconds / 3600)} hr`;
  return `About ${duration} transfer left`;
}
