/** Client-safe queue presentation. Filtering never changes or retries saved jobs. */
export type JobFilter = "all" | "active" | "failed" | "completed";
export type QueueEntry = { id: string; phase: "preparation" | "render"; status: string; createdAt: string };
export const JOB_PAGE_SIZE = 8;

export function jobGroup(entry: Pick<QueueEntry, "phase" | "status">): Exclude<JobFilter, "all"> | "history" | "hidden" {
  if (entry.phase === "preparation") {
    if (["APPROVED", "ARCHIVED"].includes(entry.status)) return "hidden";
    if (["QUEUED", "PLANNING", "APPROVING", "READY"].includes(entry.status)) return "active";
  }
  if (["QUEUED", "RUNNING", "PROCESSING"].includes(entry.status)) return "active";
  if (["FAILED", "BLOCKED"].includes(entry.status)) return "failed";
  if (entry.status === "COMPLETED") return "completed";
  return "history";
}

export function jobQueuePage<T extends QueueEntry>(entries: readonly T[], selected: JobFilter | null, requestedPage: number) {
  const saved = entries.filter(entry => jobGroup(entry) !== "hidden");
  const counts = { all: saved.length, active: 0, failed: 0, completed: 0 };
  for (const entry of saved) {
    const group = jobGroup(entry);
    if (group === "active" || group === "failed" || group === "completed") counts[group]++;
  }
  // Start with actual work, not a wall of historical successes. Once the owner
  // chooses a tab, subsequent polling respects that choice, including emptiness.
  const filter = selected ?? (counts.active ? "active" : counts.failed ? "failed" : counts.completed ? "completed" : "all");
  const matching = saved.filter(entry => filter === "all" || jobGroup(entry) === filter).sort((left, right) => {
    const timestamp = (entry: T) => Number.isFinite(Date.parse(entry.createdAt)) ? Date.parse(entry.createdAt) : 0;
    const order = filter === "active" ? timestamp(left) - timestamp(right) : timestamp(right) - timestamp(left);
    return order || `${left.phase}:${left.id}`.localeCompare(`${right.phase}:${right.id}`);
  });
  const pages = Math.max(1, Math.ceil(matching.length / JOB_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1));
  return { filter, counts, total: matching.length, page, pages, displayed: matching.slice((page - 1) * JOB_PAGE_SIZE, page * JOB_PAGE_SIZE) };
}
