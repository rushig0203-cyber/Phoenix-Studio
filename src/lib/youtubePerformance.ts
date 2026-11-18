import fs from "node:fs/promises";
import path from "node:path";
import { getYouTubePerformanceAccess, YouTubePerformanceAccessError } from "./channelConnections";
import { boundedJson } from "./groqWriter";

export type YouTubePerformanceState = {
  status: "not_connected" | "permission_required" | "syncing" | "ready" | "limited" | "rate_limited" | "error";
  detail: string;
  account?: { name: string };
  lastSuccessfulSyncAt?: string;
  videos: Array<{ id: string; reviewId: string; caption: string; timestamp: string; permalink: string;
    metrics: { views: number | null; likes: number | null; comments: number | null; shares: null; averageWatchTimeMs: null } }>;
};
type Access = Awaited<ReturnType<typeof getYouTubePerformanceAccess>>;
type Publication = { id: string; reviewId: string; updatedAt: number };
type CacheEntry = { state: YouTubePerformanceState; until: number };
const limit = 25;
const cooldown = 60_000;
export const isYouTubeReviewId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const videoId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const owner = (access: Access) => JSON.stringify([access.accountId, access.connectionRevision]);
const cleanText = (value: unknown, limit: number, token: string) => typeof value === "string" && !(token && value.includes(token))
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";
let cachedOwner = "";
const cached = new Map<string, CacheEntry>();
let inFlight: { owner: string; scope: string; result: Promise<YouTubePerformanceState> } | undefined;
let backoff: { owner: string; until: number; status: "permission_required" | "rate_limited" | "error" } | undefined;

function accessFailure(error: unknown): YouTubePerformanceState {
  return error instanceof YouTubePerformanceAccessError && error.code === "permission_required"
    ? { status: "permission_required", detail: "Check the existing YouTube read permission in Settings. Posting access is separate.", videos: [] }
    : { status: "not_connected", detail: "Connect or check YouTube in Settings to see counts for videos posted through Phoenix.", videos: [] };
}

function accountState(access: Access): YouTubePerformanceState {
  return { status: "syncing", detail: "Choose Refresh to read basic counts for confirmed Phoenix YouTube posts.", videos: [],
    account: { name: cleanText(access.name, 120, access.accessToken) || "YouTube" } };
}

function scopedCache(access: Access, reviewId?: string): YouTubePerformanceState {
  const base = accountState(access);
  if (cachedOwner !== owner(access)) return base;
  const saved = cached.get(reviewId ?? "");
  if (saved) return saved.state;
  const recent = cached.get("")?.state;
  const selected = reviewId && recent?.videos.find(row => row.reviewId === reviewId);
  return selected ? { ...base, status: "ready", detail: "Basic counts for this confirmed YouTube video.", lastSuccessfulSyncAt: recent?.lastSuccessfulSyncAt, videos: [selected] } : base;
}

async function savedPublication(root: string, reviewId: string, accountId: string): Promise<Publication | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const file = path.join(root, reviewId + "-youtube.json");
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return;
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) return;
    const row: unknown = JSON.parse(buffer.toString("utf8", 0, length));
    if (!object(row) || row.version !== 1 || typeof row.id !== "string" || !isYouTubeReviewId(row.id)
      || row.reviewId !== reviewId || row.accountId !== accountId || row.platform !== "youtube" || row.kind !== undefined
      || row.status !== "COMPLETE" || row.phase !== "complete" || !videoId(row.remoteId)) return;
    const updatedAt = typeof row.updatedAt === "string" ? Date.parse(row.updatedAt) : NaN;
    if (Number.isFinite(updatedAt)) return { id: row.remoteId, reviewId, updatedAt };
  } catch { /* Missing, rewritten or invalid records cannot confirm a post. */ }
  finally { await handle?.close(); }
}

async function publishedVideos(accountId: string, reviewId?: string): Promise<Publication[]> {
  const root = process.env.PHOENIX_PUBLISH_STORAGE || path.join(process.cwd(), "storage", "private", "review-publications");
  if (reviewId) {
    const row = isYouTubeReviewId(reviewId) && await savedPublication(root, reviewId, accountId);
    return row ? [row] : [];
  }
  const rows: Publication[] = [];
  let directory;
  try { directory = await fs.opendir(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  let scanned = 0;
  // shortcut: bounded local journal scan; use a dated publication index if the archive exceeds this cap.
  for await (const entry of directory) {
    if (++scanned > 5000) break;
    if (!entry.isFile() || !entry.name.endsWith("-youtube.json")) continue;
    const id = entry.name.slice(0, -"-youtube.json".length);
    if (!isYouTubeReviewId(id)) continue;
    const record = await savedPublication(root, id, accountId);
    if (record) rows.push(record);
  }
  const seen = new Set<string>();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .filter(row => !seen.has(row.id) && !!seen.add(row.id)).slice(0, limit);
}

function count(value: unknown): number | null {
  const numeric = typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : value;
  return typeof numeric === "number" && Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}
class StatsFailure extends Error {
  constructor(readonly status: NonNullable<typeof backoff>["status"], readonly delay = cooldown) { super("YouTube counts unavailable."); }
}
function retryDelay(headers: Headers) {
  const value = headers.get("retry-after") || "";
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(cooldown, Math.min(delay, 86_400_000)) : 3_600_000;
}
function errorState(base: YouTubePerformanceState, status: StatsFailure["status"]): YouTubePerformanceState {
  const detail = status === "rate_limited" ? "YouTube limited statistics requests. Wait before refreshing again."
    : status === "permission_required" ? "YouTube could not authorize reading these counts. Check the connection in Settings."
    : "YouTube counts could not refresh. Previously loaded figures remain available.";
  return { ...base, detail, status };
}

async function fetchVideos(access: Access, rows: Publication[]): Promise<YouTubePerformanceState["videos"]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("id", rows.map(row => row.id).join(","));
  url.searchParams.set("fields", "items(id,snippet(channelId,title,publishedAt),statistics(viewCount,likeCount,commentCount))");
  const response = await fetch(url, { headers: { Authorization: "Bearer " + access.accessToken }, redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(10_000) });
  if (response.status === 429 || response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    throw response.status === 429 ? new StatsFailure("rate_limited", retryDelay(response.headers)) : new StatsFailure("permission_required", 600_000);
  }
  const payload = await boundedJson(response).catch(error => {
    if (response.ok) throw error;
    return null;
  });
  if (!response.ok) {
    const providerErrors = object(payload) && object(payload.error) && Array.isArray(payload.error.errors) ? payload.error.errors : [];
    if (providerErrors.some(error => object(error) && ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(String(error.reason)))) {
      throw new StatsFailure("rate_limited", retryDelay(response.headers));
    }
    throw response.status === 403 ? new StatsFailure("permission_required", 600_000) : new StatsFailure("error");
  }
  if (!object(payload) || !Array.isArray(payload.items) || payload.items.length > rows.length) throw new StatsFailure("error");
  const videos: YouTubePerformanceState["videos"] = [];
  for (const row of rows) {
    const item: unknown = payload.items.find((item: unknown) => object(item) && item.id === row.id);
    if (!object(item) || !object(item.snippet) || item.snippet.channelId !== access.accountId) continue;
    const publishedAt = typeof item.snippet.publishedAt === "string" ? Date.parse(item.snippet.publishedAt) : NaN;
    const metrics = object(item.statistics) ? item.statistics : {};
    videos.push({ id: row.id, reviewId: row.reviewId, caption: cleanText(item.snippet.title, 120, access.accessToken),
      timestamp: new Date(Number.isFinite(publishedAt) ? publishedAt : row.updatedAt).toISOString(),
      permalink: "https://www.youtube.com/watch?v=" + row.id,
      metrics: { views: count(metrics.viewCount), likes: count(metrics.likeCount), comments: count(metrics.commentCount), shares: null, averageWatchTimeMs: null } });
  }
  return videos;
}

/** Local metadata only; no provider request or token renewal. */
export async function readYouTubePerformance(reviewId?: string): Promise<YouTubePerformanceState> {
  try { return scopedCache(await getYouTubePerformanceAccess(), reviewId); }
  catch (error) { return accessFailure(error); }
}

function assertSameAccount(previous: Access, current: Access) {
  if (owner(previous) !== owner(current) || previous.credentialBinding !== current.credentialBinding) throw new YouTubePerformanceAccessError("not_connected");
}

async function collect(access: Access, reviewId?: string): Promise<YouTubePerformanceState> {
  const key = owner(access), scope = reviewId ?? "";
  let next = accountState(access);
  try {
    const rows = await publishedVideos(access.accountId, reviewId);
    if (rows.length) {
      const renewed = await getYouTubePerformanceAccess(true);
      assertSameAccount(access, renewed);
      assertSameAccount(access, await getYouTubePerformanceAccess());
      const videos = await fetchVideos(renewed, rows);
      assertSameAccount(access, await getYouTubePerformanceAccess());
      const limited = videos.length < rows.length || videos.some(video => [video.metrics.views, video.metrics.likes, video.metrics.comments].includes(null));
      next = { ...next, status: limited ? "limited" : "ready", detail: limited
        ? "Some confirmed YouTube videos or counts are unavailable. Missing counts remain unknown."
        : "Basic counts for confirmed Phoenix posts. Watch time and shares are unavailable in this view.",
        videos, lastSuccessfulSyncAt: new Date().toISOString() };
    } else {
      assertSameAccount(access, await getYouTubePerformanceAccess());
      next = { ...next, status: "ready", detail: reviewId ? "No confirmed YouTube post is saved for this video." : "No confirmed posts from Phoenix are saved for this YouTube channel." };
    }
  } catch (error) {
    try { assertSameAccount(access, await getYouTubePerformanceAccess()); }
    catch (currentError) { return accessFailure(currentError); }
    const failure = error instanceof StatsFailure ? error : new StatsFailure(error instanceof YouTubePerformanceAccessError && error.code === "permission_required" ? "permission_required" : "error");
    backoff = { owner: key, status: failure.status, until: Date.now() + failure.delay };
    return errorState(scopedCache(access, reviewId), failure.status);
  }
  if (cachedOwner !== key) { cached.clear(); cachedOwner = key; }
  cached.delete(scope);
  cached.set(scope, { state: next, until: Date.now() + cooldown });
  if (cached.size > 8) cached.delete(cached.keys().next().value!);
  return next;
}

/** One explicitly requested, bounded stats batch. Never starts an upload or insight background job. */
export async function syncYouTubePerformance(reviewId?: string): Promise<YouTubePerformanceState> {
  let access: Access;
  try { access = await getYouTubePerformanceAccess(); }
  catch (error) { return accessFailure(error); }
  const key = owner(access), scope = reviewId ?? "";
  if (inFlight) {
    if (inFlight.owner === key && inFlight.scope === scope) return inFlight.result;
    return { ...scopedCache(access, reviewId), status: "syncing", detail: "Another YouTube refresh is running. Try again shortly." };
  }
  if (backoff?.owner === key && backoff.until > Date.now()) return errorState(scopedCache(access, reviewId), backoff.status);
  const saved = cachedOwner === key ? cached.get(scope) : undefined;
  if (saved && saved.until > Date.now()) return saved.state;
  const result = collect(access, reviewId);
  inFlight = { owner: key, scope, result };
  try { return await result; }
  finally { inFlight = undefined; }
}
