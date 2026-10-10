export const DASHBOARD_ENDPOINTS = ["/api/review-files", "/api/source-processing", "/api/generations", "/api/review-edits", "/api/creation-drafts", "/api/studio-health"] as const;
const labels = ["Video library", "Source jobs", "Creation jobs", "Edited exports", "Video preparation", "Studio health"];

export class MonitorFailure extends Error {
  constructor(readonly kind: "network" | "http" | "response", readonly status?: number) {
    super(kind === "http" ? `HTTP ${status}` : kind === "response" ? "unreadable response" : "connection unavailable");
  }
}

export function dashboardMonitorReport(results: readonly PromiseSettledResult<unknown>[]) {
  const failed = results.flatMap((result, index) => result.status === "rejected" ? [{ label: labels[index], error: result.reason }] : []);
  const offline = results.length === DASHBOARD_ENDPOINTS.length && failed.length === results.length && failed.every(item => item.error instanceof MonitorFailure && item.error.kind === "network");
  return {
    offline,
    message: offline ? "Phoenix connection is unavailable."
      : failed.length ? `Could not refresh ${failed.map(item => `${item.label}${item.error instanceof MonitorFailure && item.error.kind === "http" ? ` (HTTP ${item.error.status})` : ""}`).join(", ")}. Showing the last received data for these sections.` : "",
  };
}

export async function fetchDashboardSnapshot(signal: AbortSignal) {
  return Promise.allSettled(DASHBOARD_ENDPOINTS.map(async endpoint => {
    let response: Response;
    try { response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }); }
    catch { throw new MonitorFailure("network"); }
    if (!response.ok) throw new MonitorFailure("http", response.status);
    try { return await response.json(); }
    catch { throw new MonitorFailure("response"); }
  }));
}

/** Back off only when every independent work queue has confirmed it is idle. */
export function dashboardHasPendingWork(results: readonly PromiseSettledResult<unknown>[]) {
  if (results.length !== DASHBOARD_ENDPOINTS.length) return true;
  const pending = new Set(["QUEUED", "RUNNING", "PROCESSING", "PLANNING", "APPROVING", "ANALYZING", "WAITING"]);
  return results.slice(0, 5).some((result, index) => {
    if (result.status !== "fulfilled") return true;
    const value = result.value;
    const records = index === 1 && value && typeof value === "object" && "jobs" in value ? value.jobs : value;
    if (!Array.isArray(records)) return true;
    return records.some(record => pending.has(record?.status) || (index === 4 && record?.status === "READY") || (index === 0 && pending.has(record?.quality?.postingAnalysis?.status)));
  });
}

/** Schedule after each finished poll, with immediate wake-up and no overlap. */
export function startDashboardPolling(options: {
  refresh: () => Promise<unknown>; offline: () => boolean; visible: () => boolean;
  active?: () => boolean;
  schedule?: typeof setTimeout; cancel?: typeof clearTimeout;
}) {
  const schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, stopped = false;
  async function retry() {
    if (stopped || running) return;
    if (timer !== undefined) { cancel(timer); timer = undefined; }
    if (!options.visible()) return;
    running = true;
    try { await options.refresh(); }
    finally {
      running = false;
      if (!stopped && options.visible()) timer = schedule(() => { void retry(); }, options.offline() || options.active?.() === false ? 15_000 : 3_000);
    }
  }
  void retry();
  return {
    retry,
    stop() { stopped = true; if (timer !== undefined) cancel(timer); },
  };
}
