import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FACEBOOK_PAGE_GRAPH_VERSION, getChannelPublishAccess, createChannelPublishAccessMonitor, type ChannelPublishAccess } from "./channelConnections";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";
import { boundedJson } from "./groqWriter";
import type { FacebookPerformanceState, FacebookPerformanceVideo } from "./facebookPerformanceTypes";

type Status = FacebookPerformanceState["status"];
type Store = FacebookPerformanceState & {
  version: 1; account: { id: string; name: string; connectionRevision: string };
  nextRefreshAt?: string; lease?: { token: string; until: number };
};
const cacheLimit = 128 * 1024;
const filename = () => path.join(process.env.PHOENIX_FACEBOOK_PERFORMANCE_STORAGE || path.join(process.cwd(), "storage", "private"), "facebook-performance.json");
const numericId = (value: unknown): value is string => typeof value === "string" && /^\d{1,40}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown) => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const text = (value: unknown, limit: number, secret = "") => typeof value === "string" && !(secret && value.includes(secret))
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, limit) : "";
function count(value: unknown): number | null {
  const number = typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function detailFor(status: Status) {
  if (status === "not_connected") return "Connect or check the Facebook Page in Settings to read its Reel counts.";
  if (status === "permission_required") return "Meta did not allow reading these Facebook Page Reel counts. Check the existing Page connection and permissions; posting access is separate.";
  if (status === "rate_limited") return "Meta temporarily limited Facebook statistics requests. Saved figures remain available; wait before refreshing again.";
  if (status === "error") return "Facebook Reel counts could not refresh. Valid saved figures are retained; no video or posting request was changed.";
  if (status === "syncing") return "Reading basic counts for up to 25 latest Facebook Page Reels.";
  if (status === "limited") return "Available counts for up to 25 latest Page Reels are shown. Some counts or older Reels are unavailable; unknown values are not zero.";
  return "Basic counts for the latest Page Reels are loaded. This is not full Reel analytics; watch time and unreturned share counts remain unknown.";
}
const publicState = (state: FacebookPerformanceState): FacebookPerformanceState => ({ status: state.status,
  detail: state.status === "syncing" && !(state as Partial<Store>).lease ? "Facebook Page connected. Use Refresh to collect its basic Reel counts." : detailFor(state.status),
  ...(state.account ? { account: { name: state.account.name } } : {}), ...(state.lastSuccessfulSyncAt ? { lastSuccessfulSyncAt: state.lastSuccessfulSyncAt } : {}), videos: state.videos });
const empty = (): FacebookPerformanceState => ({ status: "not_connected", detail: detailFor("not_connected"), videos: [] });
const same = (saved: Store | undefined, access: ChannelPublishAccess) => saved?.account.id === access.accountId && saved.account.connectionRevision === access.connectionRevision;
const fresh = (access: ChannelPublishAccess): Store => ({ version: 1, status: "syncing", detail: detailFor("syncing"),
  account: { id: access.accountId, name: text(access.name, 120, access.accessToken), connectionRevision: access.connectionRevision }, videos: [] });

function permalink(value: unknown, id: string, secret = "") {
  if (typeof value !== "string" || value.length > 2048 || secret && value.includes(secret)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(?:(?:www|m|web)\.)?facebook\.com$/.test(url.hostname) || url.username || url.password || url.port) return undefined;
    if (url.pathname.replace(/\/$/, "") === `/reel/${id}` || new RegExp(`^/(?:[A-Za-z0-9_.-]{1,120}/)?videos/${id}/?$`).test(url.pathname)) {
      url.search = ""; url.hash = ""; return url.href;
    }
    if (/^\/watch\/?$/.test(url.pathname) && url.searchParams.get("v") === id) {
      url.search = ""; url.searchParams.set("v", id); url.hash = ""; return url.href;
    }
  } catch { /* Untrusted provider links are never followed. */ }
  return undefined;
}
function checkedVideo(value: unknown, cached = false, secret = ""): FacebookPerformanceVideo | undefined {
  if (!object(value) || !numericId(value.id)) return;
  const timestamp = date(cached ? value.timestamp : value.created_time);
  if (!timestamp) return;
  const metrics = cached && object(value.metrics) ? value.metrics : value;
  const summaryCount = (edge: unknown) => object(edge) && object(edge.summary) ? count(edge.summary.total_count) : null;
  const link = permalink(cached ? value.permalink : value.permalink_url, value.id, secret);
  const shares = cached ? count(metrics.shares) : object(value.shares) ? count(value.shares.count) : count(value.shares);
  return { id: value.id, caption: text(cached ? value.caption : value.description || value.title, 600, secret), timestamp,
    ...(link ? { permalink: link } : {}), metrics: { views: count(metrics.views), likes: cached ? count(metrics.likes) : summaryCount(value.likes),
      comments: cached ? count(metrics.comments) : summaryCount(value.comments), shares, averageWatchTimeMs: null } };
}
async function readStore(): Promise<Store | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const stat = await fs.lstat(filename());
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > cacheLimit) throw new Error("Invalid cache.");
    handle = await fs.open(filename(), "r");
    const bytes = Buffer.alloc(Math.min(cacheLimit + 1, stat.size + 1));
    let offset = 0;
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    if (offset > stat.size || offset > cacheLimit) throw new Error("Invalid cache.");
    const saved: unknown = JSON.parse(bytes.subarray(0, offset).toString("utf8"));
    if (!object(saved) || saved.version !== 1 || !object(saved.account) || !numericId(saved.account.id)
      || typeof saved.account.connectionRevision !== "string" || !saved.account.connectionRevision || saved.account.connectionRevision.length > 200
      || !Array.isArray(saved.videos) || saved.videos.length > 25) throw new Error("Invalid cache.");
    const statuses: Status[] = ["not_connected", "permission_required", "ready", "limited", "error", "rate_limited", "syncing"];
    const status: Status = statuses.includes(saved.status as Status) ? saved.status as Status : "error";
    const seen = new Set<string>();
    const videos = saved.videos.map(row => checkedVideo(row, true)).filter((row): row is FacebookPerformanceVideo => !!row && !seen.has(row.id) && !!seen.add(row.id));
    const state: Store = { version: 1, account: { id: saved.account.id, name: text(saved.account.name, 120), connectionRevision: saved.account.connectionRevision },
      status, detail: detailFor(status), videos, lastSuccessfulSyncAt: date(saved.lastSuccessfulSyncAt), nextRefreshAt: date(saved.nextRefreshAt) };
    if (object(saved.lease) && typeof saved.lease.token === "string" && /^[a-f0-9-]{36}$/i.test(saved.lease.token)
      && typeof saved.lease.until === "number" && saved.lease.until > Date.now() && saved.lease.until < Date.now() + 60_000) state.lease = { token: saved.lease.token, until: saved.lease.until };
    if (state.status === "syncing" && !state.lease) state.status = "error";
    return state;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Facebook performance cache is unreadable."); }
  finally { await handle?.close(); }
}
async function access() {
  const value = await getChannelPublishAccess("facebook");
  if (value.platform !== "facebook" || value.loginType !== "facebook" || !numericId(value.accountId)) throw new Error("No verified Facebook Page.");
  return value;
}

/** Reads only protected local connection/cache data; never contacts Meta. */
export async function readFacebookPerformance(): Promise<FacebookPerformanceState> {
  let connected: ChannelPublishAccess, assertCurrent: () => Promise<void>;
  try { connected = await access(); assertCurrent = await createChannelPublishAccessMonitor(connected); }
  catch { return empty(); }
  try {
    const saved = await readStore(); await assertCurrent();
    return publicState(same(saved, connected) ? saved! : fresh(connected));
  } catch {
    try { await assertCurrent(); } catch { return empty(); }
    return publicState({ ...fresh(connected), status: "error" });
  }
}

class ProviderFailure extends Error {
  constructor(readonly status: "permission_required" | "rate_limited" | "error", readonly delay: number) { super("Facebook statistics unavailable."); }
}
function quotaDelay(headers: Headers) {
  const value = headers.get("retry-after")?.trim();
  const delay = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : value && Number.isFinite(Date.parse(value)) ? Date.parse(value) - Date.now() : 3_600_000;
  return Math.ceil(Math.max(60_000, Math.min(86_400_000, Number.isFinite(delay) ? delay : 3_600_000)));
}

/** Explicit owner refresh: one bounded Page request, no pagination, media or model. */
export async function syncFacebookPerformance(): Promise<FacebookPerformanceState> {
  let connected: ChannelPublishAccess, assertCurrent: () => Promise<void>;
  try { connected = await access(); assertCurrent = await createChannelPublishAccessMonitor(connected); }
  catch { return empty(); }
  let claim: { state: Store; token?: string };
  try {
    claim = await withFileLock(`${filename()}.lock`, async () => {
      await assertCurrent();
      const saved = await readStore(), state = same(saved, connected) ? saved! : fresh(connected);
      if (state.lease || Date.parse(state.nextRefreshAt || "") > Date.now()) return { state };
      const token = crypto.randomUUID();
      state.lease = { token, until: Date.now() + 30_000 }; state.status = "syncing";
      await writeAtomicJson(filename(), state); return { state, token };
    }, { timeoutMs: 250 });
  } catch { return readFacebookPerformance(); }
  const claimed = claim.state;
  const lease = claimed.lease;
  if (!claim.token || !lease) return publicState(claimed);
  let next = { ...claimed, lease: undefined };
  try {
    await assertCurrent();
    const url = new URL(`https://graph.facebook.com/${FACEBOOK_PAGE_GRAPH_VERSION}/${connected.accountId}/video_reels`);
    url.searchParams.set("fields", "id,title,description,created_time,permalink_url,views,likes.limit(0).summary(true),comments.limit(0).summary(true)");
    url.searchParams.set("limit", "25");
    const response = await fetch(url.href, { headers: { Authorization: `Bearer ${connected.accessToken}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.status === 429 || [401, 403].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderFailure(response.status === 429 ? "rate_limited" : "permission_required", response.status === 429 ? quotaDelay(response.headers) : 600_000);
    }
    const data = await boundedJson(response);
    const error = object(data) && object(data.error) ? data.error : undefined;
    const code = typeof error?.code === "number" ? error.code : undefined;
    if (response.status === 429 || [4, 17, 32, 613, 80004, 80006].includes(code || 0)) throw new ProviderFailure("rate_limited", quotaDelay(response.headers));
    if ([401, 403].includes(response.status) || [10, 190, 200, 294].includes(code || 0)) throw new ProviderFailure("permission_required", 600_000);
    if (!response.ok || error || !object(data) || !Array.isArray(data.data) || data.data.length > 25) throw new ProviderFailure("error", 60_000);
    const seen = new Set<string>();
    const videos = data.data.map(row => checkedVideo(row, false, connected.accessToken)).filter((row): row is FacebookPerformanceVideo => !!row && !seen.has(row.id) && !!seen.add(row.id));
    const limited = videos.length !== data.data.length || videos.some(row => [row.metrics.views, row.metrics.likes, row.metrics.comments].includes(null)) || object(data.paging) && !!data.paging.next;
    next = { ...next, videos, status: limited ? "limited" : "ready", lastSuccessfulSyncAt: new Date().toISOString(), nextRefreshAt: new Date(Date.now() + 60_000).toISOString() };
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : new ProviderFailure("error", 60_000);
    next = { ...next, status: failure.status, nextRefreshAt: new Date(Date.now() + failure.delay).toISOString() };
  }
  try {
    await assertCurrent();
    return await withFileLock(`${filename()}.lock`, async () => {
      await assertCurrent(); const current = await readStore();
      if (!same(current, connected) || current?.lease?.token !== lease.token) return empty();
      await writeAtomicJson(filename(), next); return publicState(next);
    }, { timeoutMs: 250 });
  } catch { return empty(); }
}
