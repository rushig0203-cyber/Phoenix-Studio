import type { ReviewFile, ReviewTarget } from "./reviewFiles";

export function postingText(file: ReviewFile) {
  const caption = file.quality.postCopy?.trim() || file.title;
  return [caption, file.quality.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

export function postingDownload(file: ReviewFile, preferred?: ReviewTarget) {
  if (file.status !== "READY" || file.trashedAt) return null;
  const target = preferred && file.outputs[preferred] ? preferred
    : file.delivery?.platform && file.outputs[file.delivery.platform] ? file.delivery.platform
      : file.outputs.instagram ? "instagram" : file.outputs.youtube ? "youtube" : null;
  return target ? { target, url: `/api/review-files/${encodeURIComponent(file.id)}/media?target=${target}` } : null;
}
