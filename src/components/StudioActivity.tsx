/** Lightweight shared activity indicator; percentages are shown only when measured. */
export default function StudioActivity({ label, percent }: { label: string; percent?: number }) {
  const measured = typeof percent === "number" && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, Math.floor(percent))) : undefined;
  return <span className="studio-activity" role="status" aria-busy="true">
    <span className="studio-activity-label"><span className="studio-loading-dot" aria-hidden="true" /><span>{label}</span>{measured !== undefined && <span className="studio-activity-percent" aria-hidden="true">{measured}%</span>}</span>
    <progress className="studio-activity-track" aria-label={label} aria-valuetext={measured === undefined ? "Progress not measured" : undefined} value={measured} max={100} />
  </span>;
}
