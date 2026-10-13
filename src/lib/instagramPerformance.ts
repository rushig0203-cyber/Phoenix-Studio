import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createInstagramPerformanceAccessMonitor, getInstagramPerformanceAccess, type InstagramPerformanceAccess } from "./channelConnections";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { boundedJson } from "./groqWriter";
import { instagramPublishedReviews } from "./instagramPublishedReviews";
import type { InstagramPerformanceMetrics, InstagramPerformanceState, InstagramPerformanceVideo } from "./instagramPerformanceTypes";

const graphVersion = "v26.0";
const hour = 3_600_000;
const storeLimit = 8 * 1024 * 1024;
const videoLimit = 5000;
const metricNames = ["views", "reach", "saved", "shares", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"] as const;
type Metric = typeof metricNames[number];
type Budget = { remaining: number; assertCurrent: () => Promise<void> };
type Store = InstagramPerformanceState & {
  cursor?: string;
  pending?: string[];
  probes?: Record<string, Metric[]>;
  unsupported?: Record<string, Metric[]>;
  cycleStartedAt?: string;
  seenCursors?: string[];
  lease?: { token: string; until: number };
};
const filename = () => path.join(process.env.PHOENIX_INSTAGRAM_PERFORMANCE_STORAGE || path.join(process.cwd(), "storage", "private"), "instagram-performance.json");
const numericId = (value: unknown): value is string => typeof value === "string" && /^\d{1,40}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, limit) : "";
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && value.length <= 40 ? new Date(value).toISOString() : undefined;
const count = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const product = (value: unknown): "REELS" | "FEED" => value === "REELS" ? "REELS" : "FEED";
const sameAccount = (left: InstagramPerformanceState["account"], right: InstagramPerformanceState["account"]) => !!left && !!right && left.id === right.id && left.connectionRevision === right.connectionRevision;
const publicAccount = (access: InstagramPerformanceAccess) => ({ id: access.accountId, name: text(access.name, 120), connectionRevision: access.connectionRevision });
const emptyMetrics = (): InstagramPerformanceMetrics => ({ views: null, reach: null, likes: null, comments: null, saves: null, shares: null, averageWatchTimeMs: null, totalWatchTimeMs: null });
const permissionDetail = "Instagram performance needs instagram_manage_insights, instagram_basic and pages_read_engagement. Reconnect in Settings with those permissions; publishing access is separate.";
const connectionDetail = "Connect or check your Instagram professional account in Settings to read its video performance.";
const issue = (metric: Metric) => `Meta did not provide ${metric}; its value is unknown, not zero.`;

function empty(account?: InstagramPerformanceState["account"]): Store {
  return { version: 1, ...(account ? { account } : {}), status: account ? "syncing" : "not_connected", detail: account ? "Instagram video statistics have not been collected yet." : connectionDetail,
    videos: [], scannedVideos: 0, historyComplete: false, pending: [], probes: {}, unsupported: {} };
}
function permalink(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(?:www\.)?instagram\.com$/.test(url.hostname) || url.port || url.username || url.password || !/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]{1,64}\/?$/.test(url.pathname)) return undefined;
    url.search = ""; url.hash = ""; return url.href;
  } catch { return undefined; }
}
function checkedVideo(value: unknown): InstagramPerformanceVideo | undefined {
  if (!object(value) || !numericId(value.id) || !date(value.timestamp) || !object(value.metrics)) return undefined;
  const metrics = emptyMetrics();
  for (const name of Object.keys(metrics) as Array<keyof InstagramPerformanceMetrics>) metrics[name] = count(value.metrics[name]);
  const link = permalink(value.permalink), updated = date(value.metricsUpdatedAt);
  const metricIssues = Array.isArray(value.metricIssues) ? value.metricIssues : [];
  const reviewId = typeof value.reviewId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.reviewId) ? value.reviewId : undefined;
  return { id: value.id, caption: text(value.caption, 600), timestamp: date(value.timestamp)!, mediaProductType: product(value.mediaProductType), metrics,
    ...(link ? { permalink: link } : {}), ...(updated ? { metricsUpdatedAt: updated } : {}),
    ...(metricIssues.length ? { metricIssues: metricNames.filter(metric => metricIssues.includes(issue(metric))).map(issue) } : {}),
    ...(reviewId ? { reviewId, ...(text(value.topic, 200) ? { topic: text(value.topic, 200) } : {}), ...(text(value.creationType, 40) ? { creationType: text(value.creationType, 40) } : {}), ...(count(value.durationSeconds) !== null ? { durationSeconds: count(value.durationSeconds)! } : {}) } : {}) };
}
async function readStore(): Promise<Store | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const stat = await fs.lstat(filename());
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > storeLimit) throw new Error("Unreadable performance cache.");
    handle = await fs.open(filename(), "r");
    const bytes = Buffer.alloc(Math.min(storeLimit + 1, stat.size + 1));
    let offset = 0;
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    if (offset > stat.size || offset > storeLimit) throw new Error("Oversized performance cache.");
    const saved: unknown = JSON.parse(bytes.subarray(0, offset).toString("utf8"));
    if (!object(saved) || saved.version !== 1 || !object(saved.account) || !numericId(saved.account.id) || typeof saved.account.connectionRevision !== "string" || saved.account.connectionRevision.length > 200
      || !Array.isArray(saved.videos) || saved.videos.length > videoLimit) throw new Error("Invalid performance cache.");
    const state = empty({ id: saved.account.id, name: text(saved.account.name, 120), connectionRevision: saved.account.connectionRevision });
    const statuses: InstagramPerformanceState["status"][] = ["not_connected", "permission_required", "syncing", "ready", "limited", "error", "rate_limited"];
    state.status = statuses.includes(saved.status as InstagramPerformanceState["status"]) ? saved.status as InstagramPerformanceState["status"] : "error";
    // Cached/provider prose is not a trusted error message. Derive fixed copy below.
    state.detail = detailFor(state.status);
    state.videos = saved.videos.map(checkedVideo).filter((video): video is InstagramPerformanceVideo => !!video);
    const seen = new Set<string>(); state.videos = state.videos.filter(video => !seen.has(video.id) && !!seen.add(video.id));
    state.scannedVideos = state.videos.length; state.historyComplete = saved.historyComplete === true;
    state.updatedAt = date(saved.updatedAt); state.lastSuccessfulSyncAt = date(saved.lastSuccessfulSyncAt); state.nextSyncAt = date(saved.nextSyncAt);
    state.cycleStartedAt = date(saved.cycleStartedAt);
    state.seenCursors = Array.isArray(saved.seenCursors) ? saved.seenCursors.filter((value): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)).slice(0, 5000) : [];
    state.cursor = validCursor(saved.cursor) ? saved.cursor : undefined;
    state.pending = Array.isArray(saved.pending) ? saved.pending.filter((id): id is string => numericId(id) && seen.has(id)).slice(0, 25) : [];
    state.probes = {};
    if (object(saved.probes)) for (const id of state.pending) {
      const metrics = saved.probes[id]; if (Array.isArray(metrics)) state.probes[id] = metricNames.filter(metric => metrics.includes(metric));
    }
    state.unsupported = {};
    if (object(saved.unsupported)) for (const id of seen) {
      const metrics = saved.unsupported[id]; if (Array.isArray(metrics)) state.unsupported[id] = metricNames.filter(metric => metrics.includes(metric));
    }
    if (object(saved.lease) && typeof saved.lease.token === "string" && /^[a-f0-9-]{36}$/i.test(saved.lease.token) && typeof saved.lease.until === "number" && saved.lease.until > Date.now() && saved.lease.until < Date.now() + 5 * 60_000) {
      state.lease = { token: saved.lease.token, until: saved.lease.until };
    }
    return state;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("The local Instagram performance cache is unreadable. Your videos and uploads were not changed."); }
  finally { await handle?.close(); }
}
function detailFor(status: InstagramPerformanceState["status"]) {
  if (status === "permission_required") return permissionDetail;
  if (status === "not_connected") return connectionDetail;
  if (status === "rate_limited") return "Meta temporarily limited statistics requests. Cached figures remain available; collection will resume after the saved backoff.";
  if (status === "error") return "Instagram statistics could not refresh. Valid cached figures are retained; collection will retry automatically.";
  if (status === "limited") return "Collected available video statistics; some metrics or older history remain unavailable. Unknown values are not counted as zero.";
  if (status === "ready") return "All available owned Instagram video pages have been scanned. Figures are API statistics, not a guarantee of future reach.";
  return "Collecting all owned Instagram video pages in small, resumable batches, including videos posted outside Phoenix.";
}
function publicState(state: Store): InstagramPerformanceState {
  const { version, account, status, detail, updatedAt, lastSuccessfulSyncAt, nextSyncAt, videos, scannedVideos, historyComplete } = state;
  return { version, ...(account ? { account } : {}), status, detail, ...(updatedAt ? { updatedAt } : {}), ...(lastSuccessfulSyncAt ? { lastSuccessfulSyncAt } : {}), ...(nextSyncAt ? { nextSyncAt } : {}), videos, scannedVideos, historyComplete };
}
async function accessFailure(error: unknown): Promise<InstagramPerformanceState> {
  const value = error as { code?: unknown; account?: InstagramPerformanceState["account"] };
  if (value?.code === "permission_required") {
    let cached: Store | undefined; try { cached = await readStore(); } catch { /* Permission guidance is still actionable. */ }
    const state = sameAccount(cached?.account, value.account) ? cached! : empty(value.account);
    return publicState({ ...state, status: "permission_required", detail: permissionDetail });
  }
  return publicState(empty());
}

/** Cache-only GET: never sends Graph requests or reads any image/video bytes. */
export async function readInstagramPerformance(): Promise<InstagramPerformanceState> {
  let access: InstagramPerformanceAccess;
  try { access = await getInstagramPerformanceAccess(); } catch (error) { return accessFailure(error); }
  try { const saved = await readStore(); return publicState(sameAccount(saved?.account, publicAccount(access)) ? saved! : empty(publicAccount(access))); }
  catch { return publicState({ ...empty(publicAccount(access)), status: "error", detail: "The local Instagram statistics cache is unreadable. Your videos, jobs and uploads were not changed." }); }
}

class GraphFailure extends Error {
  constructor(readonly kind: "permission" | "connection" | "quota" | "network" | "metric" | "missing" | "request", readonly delay = 15 * 60_000) { super("Instagram statistics request unavailable."); }
}
function validCursor(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_+=/.:\-]{1,4096}$/.test(value); }
function nextCursor(data: Record<string, unknown>, accountId: string) {
  if (!object(data.paging) || data.paging.next === undefined) return undefined;
  if (typeof data.paging.next !== "string" || data.paging.next.length > 10000) throw new GraphFailure("network");
  let next: URL;
  try { next = new URL(data.paging.next); } catch { throw new GraphFailure("network"); }
  if (next.origin !== "https://graph.facebook.com" || next.username || next.password || next.hash || next.pathname.replace(/\/$/, "") !== `/${graphVersion}/${accountId}/media`) throw new GraphFailure("network");
  const after = object(data.paging.cursors) ? data.paging.cursors.after : next.searchParams.get("after");
  if (!validCursor(after)) throw new GraphFailure("network");
  return after;
}
function rateDelay(headers: Headers) {
  const retry = headers.get("retry-after")?.trim();
  const delay = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry && date(retry) ? Date.parse(retry) - Date.now() : hour;
  return Math.ceil(Math.max(60_000, Math.min(24 * hour, Number.isFinite(delay) ? delay : hour)));
}
async function graph(access: InstagramPerformanceAccess, endpoint: string, query: Record<string, string>, budget: Budget) {
  if (budget.remaining <= 0) return undefined;
  await budget.assertCurrent(); budget.remaining--;
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${endpoint}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  let response: Response;
  try { response = await fetch(url.href, { headers: { Authorization: `Bearer ${access.accessToken}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(6000) }); }
  catch { throw new GraphFailure("network"); }
  let data: unknown;
  try { data = await boundedJson(response); } catch { throw new GraphFailure(response.status === 429 ? "quota" : "network", response.status === 429 ? rateDelay(response.headers) : undefined); }
  const error = object(data) && object(data.error) ? data.error : undefined, code = Number(error?.code);
  if (response.status === 429 || [4, 17, 32, 613, 80004, 80006].includes(code)) throw new GraphFailure("quota", rateDelay(response.headers));
  if (response.status >= 500 || error?.is_transient === true) throw new GraphFailure("network");
  if (response.status === 401 || response.status === 403 || [10, 190, 200, 294].includes(code)) throw new GraphFailure("permission", 24 * hour);
  if (!response.ok || error) {
    const message = text(error?.message, 4096);
    if (endpoint.endsWith("/insights") && code === 100 && /(?:metric.*(?:invalid|not supported|unsupported|not valid|must|allowed)|(?:invalid|unsupported|not supported).*metric|valid.*metric)/i.test(message)) throw new GraphFailure("metric");
    if (endpoint.endsWith("/insights") && code === 100 && /unsupported get request|does not exist|cannot be loaded/i.test(message)) throw new GraphFailure("missing");
    throw new GraphFailure("request", 30 * 60_000);
  }
  if (!object(data)) throw new GraphFailure("network");
  return data;
}
const requestedMetrics = (video: InstagramPerformanceVideo, store: Store) => metricNames.filter(metric => (product(video.mediaProductType) === "REELS" || !metric.startsWith("ig_reels_")) && !store.unsupported?.[video.id]?.includes(metric));
const metricKey: Record<Metric, keyof InstagramPerformanceMetrics> = { views: "views", reach: "reach", saved: "saves", shares: "shares", ig_reels_avg_watch_time: "averageWatchTimeMs", ig_reels_video_view_total_time: "totalWatchTimeMs" };
function applyInsights(video: InstagramPerformanceVideo, data: Record<string, unknown>, requested: Metric[]) {
  if (!Array.isArray(data.data) || data.data.length > 100) throw new GraphFailure("network");
  const values = new Map<Metric, number | null>();
  for (const row of data.data) {
    if (!object(row) || !metricNames.includes(row.name as Metric) || values.has(row.name as Metric)) continue;
    const value = object(row.total_value) ? row.total_value.value : Array.isArray(row.values) && row.values.length === 1 && object(row.values[0]) ? row.values[0].value : undefined;
    values.set(row.name as Metric, count(value));
  }
  const issues = new Set(video.metricIssues || []);
  for (const metric of requested) {
    const value = values.get(metric) ?? null; video.metrics[metricKey[metric]] = value;
    if (value === null) issues.add(issue(metric)); else issues.delete(issue(metric));
  }
  video.metricIssues = [...issues];
}
function markUnsupported(video: InstagramPerformanceVideo, store: Store, metric: Metric) {
  // Old/non-eligible posts can lack a metric that newer Reels support.
  const saved = store.unsupported?.[video.id] || [];
  (store.unsupported ||= {})[video.id] = [...new Set([...saved, metric])];
  video.metrics[metricKey[metric]] = null; video.metricIssues = [...new Set([...(video.metricIssues || []), issue(metric)])];
}
async function collectVideo(access: InstagramPerformanceAccess, store: Store, video: InstagramPerformanceVideo, budget: Budget) {
  const metrics = requestedMetrics(video, store);
  for (const metric of store.unsupported?.[video.id] || []) { video.metrics[metricKey[metric]] = null; video.metricIssues = [...new Set([...(video.metricIssues || []), issue(metric)])]; }
  let probes = store.probes?.[video.id];
  if (!probes && metrics.length) {
    const remaining = budget.remaining;
    try {
      const data = await graph(access, `${video.id}/insights`, { metric: metrics.join(","), period: "lifetime" }, budget);
      if (!data) return false;
      applyInsights(video, data, metrics);
    } catch (error) {
      if (error instanceof GraphFailure && error.kind === "metric") probes = (store.probes ||= {})[video.id] = metrics;
      else if (error instanceof GraphFailure && error.kind === "missing") { for (const metric of metrics) { video.metrics[metricKey[metric]] = null; video.metricIssues = [...new Set([...(video.metricIssues || []), issue(metric)])]; } }
      else throw error;
    }
    if (budget.remaining === remaining) return false;
  }
  while (probes?.length) {
    const metric = probes[0];
    if (store.unsupported?.[video.id]?.includes(metric)) { probes.shift(); continue; }
    try {
      const data = await graph(access, `${video.id}/insights`, { metric, period: "lifetime" }, budget);
      if (!data) return false;
      applyInsights(video, data, [metric]);
    } catch (error) {
      if (error instanceof GraphFailure && error.kind === "metric") markUnsupported(video, store, metric);
      else if (error instanceof GraphFailure && error.kind === "missing") { video.metrics[metricKey[metric]] = null; video.metricIssues = [...new Set([...(video.metricIssues || []), issue(metric)])]; }
      else throw error;
    }
    probes.shift();
  }
  delete store.probes?.[video.id]; video.metricsUpdatedAt = new Date().toISOString(); return true;
}
async function collectPage(access: InstagramPerformanceAccess, store: Store, budget: Budget) {
  const data = await graph(access, `${access.accountId}/media`, { fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count", limit: "25", ...(store.cursor ? { after: store.cursor } : {}) }, budget);
  if (!data || !Array.isArray(data.data) || data.data.length > 25) throw new GraphFailure("network");
  const cursor = nextCursor(data, access.accountId);
  if (cursor && cursor === store.cursor) throw new GraphFailure("network");
  const pending: string[] = [];
  for (const row of data.data) {
    if (!object(row) || row.media_type !== "VIDEO" || row.media_product_type === "STORY") continue;
    if (!numericId(row.id) || !date(row.timestamp)) throw new GraphFailure("network");
    const previous = store.videos.find(video => video.id === row.id);
    if (!previous && store.videos.length >= videoLimit) { store.scannedVideos = store.videos.length; return false; }
    const safeCaption = typeof row.caption === "string" && row.caption.includes(access.accessToken) ? "" : text(row.caption, 600);
    const safeLink = typeof row.permalink === "string" && row.permalink.includes(access.accessToken) ? undefined : row.permalink;
    const video = checkedVideo({ ...row, caption: safeCaption, permalink: safeLink, mediaProductType: product(row.media_product_type), metrics: { ...(previous?.metrics || emptyMetrics()), likes: count(row.like_count), comments: count(row.comments_count) },
      metricsUpdatedAt: previous?.metricsUpdatedAt, metricIssues: previous?.metricIssues, reviewId: previous?.reviewId, topic: previous?.topic, creationType: previous?.creationType, durationSeconds: previous?.durationSeconds });
    if (!video) throw new GraphFailure("network");
    if (previous) Object.assign(previous, video); else store.videos.push(video);
    if (!pending.includes(video.id)) pending.push(video.id);
  }
  if (cursor) {
    const hash = crypto.createHash("sha256").update(cursor).digest("hex");
    if (store.seenCursors?.includes(hash) || (store.seenCursors?.length || 0) >= 5000) throw new GraphFailure("request");
    (store.seenCursors ||= []).push(hash);
  }
  store.cursor = cursor; store.pending = pending; store.scannedVideos = store.videos.length; return true;
}
async function save(store: Store) {
  if (Buffer.byteLength(JSON.stringify(store, null, 2), "utf8") > storeLimit) throw new Error("Performance storage bound reached.");
  await writeAtomicJson(filename(), store);
}

/** Background statistics only. Force skips the hourly schedule, never a live lease or quota backoff. */
export async function syncInstagramPerformance(force = false): Promise<InstagramPerformanceState> {
  let access: InstagramPerformanceAccess;
  try { access = await getInstagramPerformanceAccess(); } catch (error) { return accessFailure(error); }
  let claim: { state: Store; token?: string };
  try {
    claim = await withFileLock(`${filename()}.lock`, async () => {
      const saved = await readStore(), state = sameAccount(saved?.account, publicAccount(access)) ? saved! : empty(publicAccount(access));
      const now = Date.now(), due = Date.parse(state.nextSyncAt || "") > now;
      if (state.lease || (due && (!force || state.status === "rate_limited" || state.status === "error"))) return { state };
      if (!state.cycleStartedAt || state.historyComplete) { state.cursor = undefined; state.pending = []; state.probes = {}; state.seenCursors = []; state.cycleStartedAt = new Date(now).toISOString(); state.historyComplete = false; }
      const token = crypto.randomUUID(); state.lease = { token, until: now + 180_000 }; state.status = "syncing"; state.detail = detailFor("syncing");
      state.updatedAt = new Date(now).toISOString(); await save(state); return { state, token };
    }, { timeoutMs: 250 });
  } catch { return readInstagramPerformance(); }
  if (!claim.token) return publicState(claim.state);
  let monitor: () => Promise<void>;
  try { monitor = await createInstagramPerformanceAccessMonitor(access); }
  catch { return readInstagramPerformance(); }
  const state = claim.state, budget: Budget = { remaining: 12, assertCurrent: async () => {
    try { await monitor(); } catch { throw new GraphFailure("connection"); }
  } };
  const matches = await instagramPublishedReviews(access.accountId).catch(() => new Map());
  try {
    if (!state.pending?.length && !await collectPage(access, state, budget)) {
      state.status = "limited"; state.detail = `Statistics storage reached its safe ${videoLimit}-video limit. Older history is not claimed complete; existing figures are retained.`; state.nextSyncAt = new Date(Date.now() + hour).toISOString();
    } else {
      for (let processed = 0; state.pending?.length && processed < 4 && budget.remaining; processed++) {
        const video = state.videos.find(item => item.id === state.pending![0]);
        if (!video) { state.pending.shift(); continue; }
        if (!await collectVideo(access, state, video, budget)) break;
        state.pending.shift();
      }
      state.historyComplete = !state.pending?.length && !state.cursor;
      if (state.historyComplete) {
        state.lastSuccessfulSyncAt = new Date().toISOString(); state.status = state.videos.some(video => video.metricIssues?.length) ? "limited" : "ready";
        state.detail = detailFor(state.status); state.nextSyncAt = new Date(Date.now() + hour).toISOString();
      } else { state.status = "syncing"; state.detail = detailFor("syncing"); state.nextSyncAt = new Date(Date.now() + 60_000).toISOString(); }
    }
  } catch (error) {
    const failure = error instanceof GraphFailure ? error : new GraphFailure("network");
    if (failure.kind === "connection") return readInstagramPerformance();
    state.status = failure.kind === "quota" ? "rate_limited" : failure.kind === "permission" ? "permission_required" : "error";
    state.detail = detailFor(state.status); state.nextSyncAt = new Date(Date.now() + failure.delay).toISOString();
  }
  for (const video of state.videos) {
    delete video.reviewId; delete video.topic; delete video.creationType; delete video.durationSeconds;
    const matched = matches.get(video.id);
    if (matched) Object.assign(video, matched);
  }
  try {
    await budget.assertCurrent();
    return await withFileLock(`${filename()}.lock`, async () => {
      const current = await readStore();
      if (!current || !sameAccount(current.account, state.account) || current.lease?.token !== claim.token) return readInstagramPerformance();
      delete state.lease; state.updatedAt = new Date().toISOString();
      try { await save(state); }
      catch {
        delete current.lease; current.status = "limited"; current.historyComplete = false; current.detail = "The safe statistics storage limit was reached. Cached figures are retained; older history is not claimed complete.";
        current.nextSyncAt = new Date(Date.now() + hour).toISOString(); await save(current); return publicState(current);
      }
      return publicState(state);
    }, { timeoutMs: 250 });
  } catch { return readInstagramPerformance(); }
}
