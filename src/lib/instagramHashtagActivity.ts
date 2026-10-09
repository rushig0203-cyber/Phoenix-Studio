import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getInstagramHashtagResearchAccess, type InstagramHashtagResearchAccess } from "./channelConnections";
import { boundedJson } from "./groqWriter";
import { withFileLock } from "./fileLock";
import { writeAtomicJson } from "./atomicJson";

export type HashtagActivity = {
  status: "CHECKED" | "UNAVAILABLE" | "LIMITED";
  checkedAt: string;
  detail: string;
  samples: Array<{ tag: string; recentSample: number; videos: number; newestAt?: string }>;
};
type Sample = HashtagActivity["samples"][number];
type Entry = Sample & { id: string; sampledAt: number; firstSearchedAt: number };
type State = {
  version: 2; identity: string; entries: Record<string, Entry>;
  misses?: Record<string, number>;
  backoff?: { until: number; status: "UNAVAILABLE" | "LIMITED"; detail: string };
};
const sixHours = 6 * 60 * 60 * 1000;
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const filename = () => path.join(process.cwd(), "storage", "private", "instagram-hashtag-activity.json");
const numericId = (value: unknown): value is string => typeof value === "string" && /^\d{3,30}$/.test(value);
const unavailableDetail = "Instagram hashtag activity could not be verified. Meta requires Facebook Login and App Review approval for Instagram Public Content Access. Your video-specific caption and hashtags remain available.";
const quotaDetail = "Instagram activity reached a temporary API rate limit. Saved video-specific copy remains available; no global trend or popularity was inferred.";
const limitedDetail = "Only a limited Instagram hashtag sample could be checked. This is not a global trend ranking or a prediction of views.";

/** Accept only already relevant model tags; this helper never invents trending tags. */
export function selectedActivityTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.slice(0, 50).filter((value): value is string => typeof value === "string").map(value => value.trim())
    .filter(value => /^#[\p{L}\p{N}_]{2,40}$/u.test(value) && !/^#(?:viral|fyp|phoenixstudio)$/i.test(value))
    .filter(value => { const key = value.toLocaleLowerCase("en-US"); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 2);
}
function key(tag: string) { return tag.toLocaleLowerCase("en-US"); }
function identity(access: InstagramHashtagResearchAccess) {
  return createHash("sha256").update(`${access.accountId}:${access.connectionRevision}`).digest("hex");
}
function result(status: HashtagActivity["status"], detail: string, samples: Sample[] = [], checkedAt = new Date().toISOString()): HashtagActivity {
  return { status, checkedAt, detail, samples };
}
function sample(entry: Entry): Sample {
  return { tag: entry.tag, recentSample: entry.recentSample, videos: entry.videos, ...(entry.newestAt ? { newestAt: entry.newestAt } : {}) };
}
function freshSamples(state: State, tags: string[], now: number) {
  return tags.map(tag => state.entries[key(tag)]).filter((entry): entry is Entry => !!entry && now - entry.sampledAt < sixHours).map(sample);
}
function sampleCheckedAt(state: State, tags: string[], now: number) {
  const times = tags.map(tag => state.entries[key(tag)]).filter((entry): entry is Entry => !!entry && now - entry.sampledAt < sixHours).map(entry => entry.sampledAt);
  return new Date(times.length ? Math.min(...times) : now).toISOString();
}
async function readState(accessIdentity: string, now: number): Promise<State> {
  let value: unknown;
  try {
    if ((await fs.stat(filename())).size > 65536) throw new Error("Cache too large.");
    value = JSON.parse(await fs.readFile(filename(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Hashtag activity cache is unavailable.");
  }
  const saved = value as Partial<State> | undefined;
  const state: State = { version: 2, identity: accessIdentity, entries: Object.create(null), misses: Object.create(null) };
  if (saved?.version !== 2 || saved.identity !== accessIdentity) return state;
  for (const [entryKey, entry] of Object.entries(saved.entries || {}).slice(0, 60)) {
    if (entry && selectedActivityTags([entry.tag]).length && key(entry.tag) === entryKey && numericId(entry.id)
      && Number.isFinite(entry.sampledAt) && entry.sampledAt <= now + 60000 && entry.sampledAt > now - sevenDays
      && Number.isFinite(entry.firstSearchedAt) && entry.firstSearchedAt <= now + 60000
      && Number.isInteger(entry.recentSample) && entry.recentSample >= 0 && entry.recentSample <= 25
      && Number.isInteger(entry.videos) && entry.videos >= 0 && entry.videos <= entry.recentSample) {
      state.entries[entryKey] = { tag: entry.tag, id: entry.id, sampledAt: entry.sampledAt, firstSearchedAt: entry.firstSearchedAt,
        recentSample: entry.recentSample, videos: entry.videos,
        newestAt: entry.newestAt && Number.isFinite(Date.parse(entry.newestAt)) ? entry.newestAt : undefined };
    }
  }
  for (const [tag, until] of Object.entries(saved.misses || {}).slice(0, 30)) {
    if (selectedActivityTags([tag]).length && Number.isFinite(until) && until > now && until <= now + sixHours) state.misses![tag] = until;
  }
  if (saved.backoff && saved.backoff.until > now && saved.backoff.until <= now + sevenDays
    && ["UNAVAILABLE", "LIMITED"].includes(saved.backoff.status)) {
    // Never expose or persist arbitrary cached/provider error text.
    state.backoff = { until: saved.backoff.until, status: saved.backoff.status, detail: saved.backoff.status === "LIMITED" ? quotaDetail : unavailableDetail };
  }
  return state;
}
class ActivityFailure extends Error {
  constructor(readonly kind: "access" | "quota" | "network" | "connection", readonly retryAfterMs?: number) { super("Optional Instagram activity unavailable."); }
}
function boundedRateDelay(headers: Headers, now = Date.now()) {
  const retry = headers.get("retry-after")?.trim();
  const delay = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000
    : retry && Number.isFinite(Date.parse(retry)) && Date.parse(retry) > now ? Date.parse(retry) - now : 60 * 60 * 1000;
  return Math.ceil(Math.max(5000, Math.min(24 * 60 * 60 * 1000, Number.isFinite(delay) ? delay : 60 * 60 * 1000)));
}
async function graph(access: InstagramHashtagResearchAccess, endpoint: string, query: Record<string, string>) {
  // An owner disconnect/reconnect must stop this read-only research as well as
  // uploads. Re-check before every request; never authorize or renew access.
  let current: InstagramHashtagResearchAccess | null;
  try { current = await getInstagramHashtagResearchAccess(); } catch { throw new ActivityFailure("connection"); }
  if (!current || current.accountId !== access.accountId || current.connectionRevision !== access.connectionRevision || current.accessToken !== access.accessToken) {
    throw new ActivityFailure("connection");
  }
  const url = new URL(`https://graph.facebook.com/v21.0/${endpoint}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${access.accessToken}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
  } catch { throw new ActivityFailure("network"); }
  let data: unknown;
  try { data = await boundedJson(response); } catch { throw new ActivityFailure(response.status === 429 ? "quota" : "network", response.status === 429 ? boundedRateDelay(response.headers) : undefined); }
  const code = (data as { error?: { code?: unknown } })?.error?.code;
  if (response.status === 429 || [4, 17, 32, 613, 80004, 80006].includes(Number(code))) throw new ActivityFailure("quota", boundedRateDelay(response.headers));
  if (!response.ok || (data && typeof data === "object" && "error" in data)) {
    throw new ActivityFailure(response.status >= 500 ? "network" : "access");
  }
  if (!data || typeof data !== "object") throw new ActivityFailure("network");
  return data as { id?: unknown; data?: unknown; paging?: { next?: unknown } };
}
function newestTimestamp(value: unknown, now: number) {
  const seconds = typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) ? Number(value) * 1000 : NaN;
  const time = Number.isFinite(seconds) ? seconds : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > now - 24 * 60 * 60 * 1000 && time <= now + 60000 ? time : undefined;
}
function readSample(tag: string, payload: { data?: unknown }, now: number): Sample {
  if (!Array.isArray(payload.data)) throw new ActivityFailure("network");
  const seen = new Set<string>(); let recentSample = 0, videos = 0, newest: number | undefined;
  for (const item of payload.data.slice(0, 25)) {
    if (!item || typeof item !== "object" || !numericId(item.id) || seen.has(item.id)) continue;
    seen.add(item.id); recentSample++;
    // VIDEO alone is not proof that a media item is a Reel.
    if (item.media_type === "VIDEO") videos++;
    const time = newestTimestamp(item.timestamp, now); if (time !== undefined) newest = Math.max(newest || 0, time);
  }
  return { tag, recentSample, videos, ...(newest !== undefined ? { newestAt: new Date(newest).toISOString() } : {}) };
}

/** Optional, bounded public metadata research. Failure never alters channel readiness. */
export async function analyzeInstagramHashtagActivity(tags: string[]): Promise<HashtagActivity> {
  const selected = selectedActivityTags(tags);
  if (!selected.length) return result("UNAVAILABLE", "No specific video-relevant hashtags were available for an Instagram activity check.");
  try {
    const access = await getInstagramHashtagResearchAccess();
    if (!access) return result("UNAVAILABLE", unavailableDetail);
    return await withFileLock(`${filename()}.lock`, async () => {
      const now = Date.now(), state = await readState(identity(access), now);
      const cached = freshSamples(state, selected, now);
      if (cached.length === selected.length) {
        return result("CHECKED", "Cached within six hours: up to 25 recent public posts per hashtag, not total popularity or a global trend ranking. VIDEO does not verify Reel type.", cached, sampleCheckedAt(state, selected, now));
      }
      if (state.backoff) return result(cached.length ? "LIMITED" : state.backoff.status, `${state.backoff.detail}${cached.length ? " Included samples are cached, not a new live lookup." : ""}`, cached, sampleCheckedAt(state, selected, now));
      let limited = false;
      try {
        const history = await graph(access, `${access.accountId}/recently_searched_hashtags`, { fields: "id", limit: "30" });
        if (!Array.isArray(history.data) || history.data.some(item => !item || typeof item !== "object" || !numericId(item.id))) throw new ActivityFailure("network");
        const used = new Set(history.data.map(item => item && typeof item === "object" ? item.id : undefined).filter(numericId));
        const unknownRemainder = !!history.paging?.next;
        let remaining = unknownRemainder || history.data.length >= 30 ? 0 : Math.max(0, 30 - used.size);
        for (const tag of selected) {
          const tagKey = key(tag), entry = state.entries[tagKey];
          if (entry && now - entry.sampledAt < sixHours) continue;
          if ((state.misses?.[tagKey] || 0) > now) { limited = true; continue; }
          let id = entry?.id;
          const alreadyCounted = !!entry && (used.has(entry.id) || entry.firstSearchedAt > now - sevenDays);
          if (!alreadyCounted && remaining <= 0) { limited = true; continue; }
          if (!alreadyCounted) remaining--;
          if (!id) {
            const found = await graph(access, "ig_hashtag_search", { user_id: access.accountId, q: tag.slice(1) });
            const rows = Array.isArray(found.data) ? found.data : [found];
            id = rows.length === 1 && numericId(rows[0]?.id) ? rows[0].id : undefined;
            if (!id) { state.misses![tagKey] = now + sixHours; limited = true; continue; }
          }
          const media = await graph(access, `${id}/recent_media`, { user_id: access.accountId, fields: "id,media_type,timestamp", limit: "25" });
          state.entries[tagKey] = { ...readSample(tag, media, now), id, sampledAt: now,
            firstSearchedAt: alreadyCounted ? entry!.firstSearchedAt : now };
          used.add(id);
        }
      } catch (error) {
        const failure = error instanceof ActivityFailure ? error.kind : "network";
        const status = failure === "quota" ? "LIMITED" as const : "UNAVAILABLE" as const;
        state.backoff = { status, until: Date.now() + (failure === "quota" ? (error as ActivityFailure).retryAfterMs || 60 * 60 * 1000 : failure === "access" || failure === "connection" ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000),
          detail: failure === "quota" ? quotaDetail : unavailableDetail };
      }
      await writeAtomicJson(filename(), state);
      const samples = freshSamples(state, selected, now);
      if (state.backoff) return result(samples.length ? "LIMITED" : state.backoff.status, `${state.backoff.detail}${samples.length ? " Included samples retain their original checked-at time; they are not a new lookup for every tag." : ""}`, samples, sampleCheckedAt(state, selected, now));
      return result(limited || samples.length !== selected.length ? "LIMITED" : "CHECKED", limited || samples.length !== selected.length ? limitedDetail
        : "Checked up to 25 public posts from the last 24 hours per hashtag. This limited sample is not total popularity, a global trend ranking, or a prediction of views. VIDEO does not verify Reel type.", samples, sampleCheckedAt(state, selected, now));
    }, { timeoutMs: 250, staleMs: 120000 });
  } catch {
    // Never return a URL, provider message, vault error, or credential to review metadata.
    return result("UNAVAILABLE", "Optional Instagram hashtag activity is unavailable. Video-specific caption and hashtags remain available; no trend claim was made.");
  }
}
