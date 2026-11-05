import type { ReviewFile } from "./reviewFiles";

/** Resolve older edited copies through retained ancestors, including recoverable Trash. */
export function reviewEpisode(file: ReviewFile, byId: Map<string, ReviewFile>) {
  const visited = new Set<string>();
  let current: ReviewFile | undefined = file;
  while (current && !visited.has(current.id)) {
    if (current.episode) return current.episode;
    if (current.processing && !current.processing.scoreKind && !current.delivery && current.source.kind === "upload"
      && !current.source.filename.startsWith("stock-") && !current.source.filename.startsWith("local-cartoon-")) {
      const title = current.source.filename.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();
      return { id: current.processing.jobId, title: title || "Untitled episode", start: current.processing.start };
    }
    visited.add(current.id);
    current = current.editedFrom ? byId.get(current.editedFrom) : undefined;
  }
}
