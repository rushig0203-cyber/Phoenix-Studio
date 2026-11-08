type JobProgressProps = { label: string; status?: string; progress?: number; failed?: boolean };

/** Numeric progress comes from the queue; planning without a measurement stays indeterminate. */
export default function JobProgress({ label, status = "", progress, failed = ["FAILED", "BLOCKED"].includes(status) }: JobProgressProps) {
  const percent = status === "COMPLETED" ? 100 : typeof progress === "number" && Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.floor(progress))) : status === "QUEUED" ? 0 : undefined;
  const state = status === "COMPLETED" || !status && percent === 100 ? "Completed" : failed ? "Needs attention" : status === "QUEUED" ? "Queued"
    : ["PLANNING", "APPROVING", "READY"].includes(status) ? "Preparing" : status === "CANCELLED" ? "Cancelled" : "Processing";
  return <div className="mt-1.5 max-w-md" aria-label={label}>
    <div className={`mb-0.5 flex items-center justify-between gap-2 text-[11px] ${failed ? "text-destructive" : "text-muted-foreground"}`}>
      <span>{state}</span>{percent !== undefined ? <span>{percent}%</span> : null}
    </div>
    <progress aria-label={`${label}: ${state}`} aria-valuetext={percent === undefined ? "Progress not measured" : undefined}
      value={percent ?? (failed || status === "CANCELLED" ? 0 : undefined)} max={100} className={`block h-1 w-full overflow-hidden rounded-full ${failed ? "accent-destructive" : "accent-primary"}`} />
  </div>;
}
