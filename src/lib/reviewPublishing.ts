import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { writeAtomicJson } from "./atomicJson";
import { withFileLock } from "./fileLock";
import { captionHashtags, INSTAGRAM_HASHTAG_LIMIT } from "./postingCopyPolicy";
import { stripFootageProvenance } from "./posting";
import { getReviewFile, reviewRoot, safeReviewId, type ReviewTarget } from "./reviewFiles";
import { reviewMediaPath, selectedReviewTarget } from "./reviewMedia";
import { eligibleInstagramLocation, instagramLocationId, publicInstagramLocation, INSTAGRAM_LOCATION_SEARCH_LIMIT, type InstagramLocation, type InstagramLocationSearch } from "./instagramLocations";
import { instagramAudioId, instagramAudioConfiguration, publicInstagramAudioTrack, publicInstagramAudioSelection, INSTAGRAM_AUDIO_SEARCH_LIMIT, INSTAGRAM_AUDIO_GRAPH_VERSION,
  type InstagramAudioConfiguration, type InstagramAudioSelection, type InstagramAudioSearch } from "./instagramAudio";
import { instagramUserTags, publicInstagramUserTags, INSTAGRAM_USER_TAG_LIMIT } from "./instagramTags";
import { musicBriefFromReview, musicSeedMatches, musicSeedsFor, type RecommendedInstagramAudio } from "./reelMusic";
import { postingMediaFingerprint } from "./postingEvidence";
import {
  assertLocalChannelRequest, assertChannelPublishAccessCurrent, createChannelPublishAccessMonitor, getChannelPublishAccess,
  getChannelUploadSession, saveChannelUploadSession, getInstagramLocationAppSecretProof, type ChannelPublishAccess,
} from "./channelConnections";

export type ReviewPublishJob = {
  id: string; reviewId: string; platform: ReviewTarget;
  status: "QUEUED" | "UPLOADING" | "PROCESSING" | "COMPLETE" | "FAILED" | "NEEDS_CHECK";
  percent: number; detail: string; accountName: string; privacy: "public" | "unlisted" | "private";
  actualPrivacy?: "public" | "unlisted" | "private"; outputTarget?: ReviewTarget;
  bytesUploaded: number; totalBytes: number; canContinue: boolean;
  remoteId?: string; remoteUrl?: string; updatedAt: string;
  kind?: "story"; companionStoryApproved?: boolean; companionStory?: ReviewPublishJob;
  location?: InstagramLocation;
  audio?: InstagramAudioSelection;
  userTags?: string[];
};
export type InstagramStoryCapability = { ready: boolean; reason: string; requiresBusinessConfirmation?: boolean };
export type InstagramPostingDefaults = { userTags: string[]; location?: InstagramLocation; locationQuery?: string; locationReason?: string };
type StoredPostingDefaults = { version: 1; accountId: string; userTags: string[]; location?: InstagramLocation; locationQuery?: string };
type Phase = "created" | "initiating" | "session" | "sending" | "processing" | "publishing" | "complete" | "session_unknown" | "publish_unknown";
type Fingerprint = { size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number };
type StoredJob = ReviewPublishJob & {
  version: 1; phase: Phase; accountId: string; connectionRevision: string;
  title: string; caption: string; madeForKids: boolean; fingerprint: Fingerprint;
  renderTarget: ReviewTarget;
  containerId?: string; queuedAt: number;
  parentReelId?: string;
  instagramGraphVersion?: typeof INSTAGRAM_AUDIO_GRAPH_VERSION;
};
type PublishInput = { action: "create"; platform: ReviewTarget; title: string; caption: string; privacy?: ReviewPublishJob["privacy"]; madeForKids: boolean; connectionRevision: string; confirm: true };
type ProviderResult = { status: number; headers: Headers; json: Record<string, unknown> };
const JSON_LIMIT = 64 * 1024;
const BODY_LIMIT = 24 * 1024;
const LEASE_MS = 30_000;
const GRAPH = "https://graph.facebook.com/v21.0";
const AUDIO_GRAPH = `https://graph.facebook.com/${INSTAGRAM_AUDIO_GRAPH_VERSION}`;
const instagramGraph = (job: StoredJob) => job.instagramGraphVersion === INSTAGRAM_AUDIO_GRAPH_VERSION ? AUDIO_GRAPH : GRAPH;
const storeRoot = () => process.env.PHOENIX_PUBLISH_STORAGE || path.join(process.cwd(), "storage", "private", "review-publications");
const storyBusinessPath = () => path.join(storeRoot(), "instagram-story-business.json");
const postingDefaultsPath = () => path.join(storeRoot(), "instagram-posting-defaults.json");
const STORY_BUSINESS_CONFIRMATION = "Confirm that this connected Instagram account is Business, not Creator, before enabling Stories. Facebook Login does not expose a reliable account-type check. Reel posting is unaffected.";
const jobPath = (reviewId: string, platform: ReviewTarget, kind?: "story") => path.join(storeRoot(), `${reviewId}-${platform}${kind === "story" ? "-story" : ""}.json`);
const pairLock = (reviewId: string, platform: ReviewTarget, kind?: "story") => `${jobPath(reviewId, platform, kind)}.lock`;
const operationLock = (job: StoredJob) => `${jobPath(job.reviewId, job.platform, job.kind)}.operation.lock`;
const isPlatform = (value: unknown): value is ReviewTarget => value === "youtube" || value === "instagram";
const validId = (value: unknown): value is string => typeof value === "string" && safeReviewId(value) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const now = () => new Date().toISOString();

export class ReviewPublishingError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly ambiguous = false) { super(message); }
}
const problem = (message: string, status = 400, ambiguous = false) => new ReviewPublishingError(message, status, ambiguous);

export function assertReviewPublishRequest(request: Request, mutation = false) {
  try { assertLocalChannelRequest(request, mutation); }
  catch { throw problem("Open Phoenix directly on localhost to manage video uploads.", 403); }
}
export function reviewPublishError(error: unknown) {
  return error instanceof ReviewPublishingError ? { error: error.message, status: error.statusCode }
    : { error: "Phoenix could not update the upload safely. The saved video and upload status are retained.", status: 500 };
}

async function boundedJson(body: ReadableStream<Uint8Array> | null, limit: number, oversized: string, unreadable: string) {
  if (!body) return {} as Record<string, unknown>;
  const reader = body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => undefined); throw problem(oversized, 400, true); }
      parts.push(next.value);
    }
    if (!size) return {} as Record<string, unknown>;
    const parsed: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw problem(unreadable);
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ReviewPublishingError) throw error;
    throw problem(unreadable, 400, true);
  } finally { reader.releaseLock(); }
}
export async function readReviewPublishBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw problem("Send upload settings as JSON.", 415);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) throw problem("Upload settings are too large.", 413);
  return boundedJson(request.body, BODY_LIMIT, "Upload settings are too large.", "Upload settings must contain a JSON object.");
}

function checkedText(value: unknown, label: string, maximum: number, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw problem(`${label} must contain at most ${maximum} characters.`);
  const result = value.trim();
  if (!allowEmpty && !result) throw problem(`${label} is required.`);
  return result;
}
function checkPlatformHashtags(platform: ReviewTarget, caption: string) {
  if (platform === "instagram" && captionHashtags(caption).length > INSTAGRAM_HASHTAG_LIMIT) {
    throw problem("Instagram allows at most five hashtags per Reel. Remove extra hashtags before posting; no text was silently changed.");
  }
}
function fingerprint(stats: Stats): Fingerprint {
  return { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, ino: stats.ino, dev: stats.dev };
}
function sameFile(left: Fingerprint, right: Fingerprint) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.ino === right.ino && left.dev === right.dev;
}
async function readyMedia(reviewId: string, platform: ReviewTarget, expected?: Fingerprint, renderTarget?: ReviewTarget) {
  const file = await getReviewFile(reviewId);
  if (!file || file.trashedAt) throw problem("The saved review video is no longer available.", 404);
  if (file.status !== "READY") throw problem("Render a ready video output before uploading.");
  const target = renderTarget ? selectedReviewTarget(file, renderTarget) : selectedReviewTarget(file, platform) || selectedReviewTarget(file);
  if (!target) throw problem("The confirmed rendered output is unavailable. Render a ready video first.");
  const filename = reviewMediaPath(file, target);
  if (!filename) throw problem("The rendered video is unavailable.");
  try {
    const [resolved, allowed, stats] = await Promise.all([fs.realpath(filename), fs.realpath(path.join(reviewRoot(), "outputs")), fs.stat(filename)]);
    if (path.dirname(resolved) !== allowed || path.basename(resolved) !== `${reviewId}-${target}.mp4` || !stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size < 1) throw problem("The saved output must be a regular rendered MP4 video.");
    const fp = fingerprint(stats);
    if (expected && !sameFile(fp, expected)) throw problem("The saved video changed after confirmation. This upload is paused; check the platform before creating another upload.", 409);
    if (platform === "instagram" && stats.size > 1_000_000_000) throw problem("Instagram Reels accepts files up to 1 GB. Render a smaller saved output first.");
    return { file, filename: resolved, fingerprint: fp, target };
  } catch (error) {
    if (error instanceof ReviewPublishingError) throw error;
    throw problem("The rendered video is missing or cannot be read. Render it again before uploading.");
  }
}
async function readStored(reviewId: string, platform: ReviewTarget, kind?: "story"): Promise<StoredJob | null> {
  try {
    const filename = jobPath(reviewId, platform, kind); const stats = await fs.stat(filename);
    if (stats.size > JSON_LIMIT) throw problem("The saved upload status needs local inspection.", 500);
    const value = JSON.parse(await fs.readFile(filename, "utf8")) as StoredJob;
    if (value.version !== 1 || !validId(value.id) || value.reviewId !== reviewId || value.platform !== platform || value.kind !== kind || (kind === "story" && !validId(value.parentReelId)) || !isPlatform(value.renderTarget) || !value.fingerprint || !Number.isSafeInteger(value.totalBytes)
        || (value.location !== undefined && (platform !== "instagram" || kind === "story" || !publicInstagramLocation(value.location)))
        || (value.audio !== undefined && (platform !== "instagram" || kind === "story" || !publicInstagramAudioSelection(value.audio) || value.instagramGraphVersion !== INSTAGRAM_AUDIO_GRAPH_VERSION))
        || (value.userTags !== undefined && (platform !== "instagram" || kind === "story" || !publicInstagramUserTags(value.userTags)))
        || (value.instagramGraphVersion !== undefined && (value.instagramGraphVersion !== INSTAGRAM_AUDIO_GRAPH_VERSION || !value.audio))) throw problem("The saved upload status needs local inspection.", 500);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof ReviewPublishingError) throw error;
    throw problem("The saved upload status could not be read safely.", 500);
  }
}
async function persist(job: StoredJob) {
  job.updatedAt = now(); await fs.mkdir(storeRoot(), { recursive: true, mode: 0o700 });
  await writeAtomicJson(jobPath(job.reviewId, job.platform, job.kind), job);
}
async function operationActive(job: StoredJob) {
  try { return Date.now() - (await fs.stat(operationLock(job))).mtimeMs < LEASE_MS; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function continuable(job: StoredJob) {
  return !["complete", "session_unknown", "publish_unknown", "initiating", "publishing"].includes(job.phase);
}
function publicRemoteUrl(value: string | undefined, platform: ReviewTarget) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    if (platform === "youtube") {
      if (url.hostname !== "www.youtube.com" || url.pathname !== "/watch" || !/^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get("v") || "")) return undefined;
      return `https://www.youtube.com/watch?v=${url.searchParams.get("v")}`;
    }
    if (!/^(?:www\.)?instagram\.com$/.test(url.hostname) || !/^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return undefined;
    url.search = ""; url.hash = ""; return url.href;
  } catch { return undefined; }
}
async function publicJob(job: StoredJob): Promise<ReviewPublishJob> {
  const freshQueue = job.status === "QUEUED" && Date.now() - job.queuedAt < LEASE_MS;
  const interrupted = ["QUEUED", "UPLOADING", "PROCESSING"].includes(job.status) && !freshQueue && !await operationActive(job);
  const remoteUrl = publicRemoteUrl(job.remoteUrl, job.platform);
  const story = job.platform === "instagram" && !job.kind && job.companionStoryApproved ? await readStored(job.reviewId, "instagram", "story") : null;
  const parent = job.kind === "story" && job.phase === "created" ? await readStored(job.reviewId, "instagram") : null;
  const waitingForReel = parent && parent.id === job.parentReelId && parent.phase !== "complete";
  const parentStopped = waitingForReel && !["QUEUED", "UPLOADING", "PROCESSING"].includes(parent.status);
  return {
    id: job.id, reviewId: job.reviewId, platform: job.platform,
    status: waitingForReel ? parentStopped ? "NEEDS_CHECK" : "QUEUED" : interrupted ? "NEEDS_CHECK" : job.status,
    percent: job.percent, detail: waitingForReel ? parentStopped ? "Matching Story is waiting for its Reel. Continue or check the Reel first; no Story has been sent." : "Matching Story approved; waiting for its Reel to finish. No Story has been sent yet." : interrupted ? "Upload work stopped. Continue explicitly to check its saved state; Phoenix will not restart it automatically." : job.detail,
    accountName: job.accountName, privacy: job.privacy, outputTarget: job.renderTarget,
    ...(job.actualPrivacy ? { actualPrivacy: job.actualPrivacy } : {}), bytesUploaded: job.bytesUploaded, totalBytes: job.totalBytes,
    canContinue: waitingForReel ? false : interrupted ? continuable(job) : job.canContinue,
    ...(job.remoteId ? { remoteId: job.remoteId } : {}), ...(remoteUrl ? { remoteUrl } : {}), updatedAt: job.updatedAt,
    ...(job.kind ? { kind: job.kind } : {}),
    ...(job.location ? { location: publicInstagramLocation(job.location)! } : {}),
    ...(job.audio ? { audio: publicInstagramAudioSelection(job.audio)! } : {}),
    ...(job.userTags ? { userTags: [...job.userTags] } : {}),
    ...(job.companionStoryApproved ? { companionStoryApproved: true } : {}),
    ...(story && story.parentReelId === job.id ? { companionStory: await publicJob(story) } : {}),
  };
}
/** Reading status never loads credentials, refreshes tokens, contacts a provider, or dispatches work. */
export async function listReviewPublishJobs(reviewId: string) {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  const jobs = await Promise.all([readStored(reviewId, "youtube"), readStored(reviewId, "instagram")]);
  return Promise.all(jobs.filter((job): job is StoredJob => Boolean(job)).map(publicJob));
}
async function accessFor(platform: ReviewTarget, revision: string) {
  try { return await getChannelPublishAccess(platform, revision); }
  catch { throw problem("This channel is disconnected, changed, or lacks upload permission. Check Channels and authorize uploading again.", 403); }
}
async function assertCurrent(access: ChannelPublishAccess) {
  try { await assertChannelPublishAccessCurrent(access); }
  catch { throw problem("The channel connection changed or was disconnected. Uploading stopped before the next provider action.", 409); }
}

const LOCATION_SEARCH_SECRET = "Location name search needs this Meta app's App Secret in Phoenix Settings and eligible Pages Search access. No credentials or permissions were changed. You can enter a known Facebook location Page ID to check it directly, or add the location manually in Instagram.";
const LOCATION_SEARCH_ACCESS = "Meta did not allow this location lookup. Pages Search can require App Review with advanced Page Public Metadata Access. Check the existing app/token access, enter a known location Page ID, or add the location manually in Instagram; ordinary Reel posting is unaffected.";

async function locationProof(access: ChannelPublishAccess) {
  try { return await getInstagramLocationAppSecretProof(access); }
  catch { throw problem("The Instagram connection changed or its location credentials are unavailable. Check Channels before selecting a location.", 409); }
}
async function locationProviderGet(url: URL, access: ChannelPublishAccess) {
  await assertCurrent(access);
  try {
    const result = await providerCall(url.href, { headers: { Authorization: `Bearer ${access.accessToken}` } });
    await assertCurrent(access); return result.json;
  } catch (error) {
    if (error instanceof ReviewPublishingError && error.statusCode === 409) throw error;
    if (error instanceof ReviewPublishingError && error.statusCode === 401) throw problem("The Instagram token expired or was revoked during location lookup. Reconnect before selecting a location.", 401);
    if (error instanceof ReviewPublishingError && error.statusCode === 429) throw problem("Meta's location lookup limit was reached. Wait before searching again; no upload was started.", 429);
    throw problem(LOCATION_SEARCH_ACCESS, 403);
  }
}
async function verifiedInstagramLocation(id: string, access: ChannelPublishAccess): Promise<InstagramLocation> {
  if (!instagramLocationId(id) || access.loginType !== "facebook") throw problem("Choose an eligible numeric Facebook location Page ID for this Instagram account.");
  const proof = await locationProof(access);
  const url = new URL(`${GRAPH}/${id}`); url.searchParams.set("fields", "id,name,location");
  if (proof) url.searchParams.set("appsecret_proof", proof);
  const location = eligibleInstagramLocation(await locationProviderGet(url, access));
  if (!location || location.id !== id) throw problem("This Facebook Page is not an eligible Instagram location: Meta must return its name, latitude and longitude. Choose another place or add a location manually in Instagram.");
  return location;
}

/** Explicit, bounded metadata lookup only; normal status polling never calls Meta. */
export async function searchInstagramLocations(reviewId: string, query: string, connectionRevision: string): Promise<InstagramLocationSearch> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  const q = checkedText(query, "Location search", 100), revision = checkedText(connectionRevision, "Channel connection", 200);
  if (q.length < 2 && !instagramLocationId(q)) throw problem("Enter a place name of at least two characters or a numeric Facebook location Page ID.");
  await readyMedia(reviewId, "instagram");
  const access = await accessFor("instagram", revision);
  if (access.loginType !== "facebook") throw problem("Location tagging needs the existing Facebook-linked Instagram publishing connection.", 403);
  if (instagramLocationId(q)) {
    try { return { locations: [await verifiedInstagramLocation(q, access)] }; }
    catch (error) { if (error instanceof ReviewPublishingError) return { locations: [], reason: error.message }; throw error; }
  }
  const proof = await locationProof(access);
  if (!proof) return { locations: [], reason: LOCATION_SEARCH_SECRET };
  const url = new URL(`${GRAPH}/pages/search`);
  url.searchParams.set("q", q); url.searchParams.set("fields", "id,name,location");
  url.searchParams.set("limit", String(INSTAGRAM_LOCATION_SEARCH_LIMIT)); url.searchParams.set("appsecret_proof", proof);
  try {
    const data = await locationProviderGet(url, access), seen = new Set<string>();
    const locations = (Array.isArray(data.data) ? data.data.slice(0, INSTAGRAM_LOCATION_SEARCH_LIMIT) : []).flatMap(value => {
      const location = eligibleInstagramLocation(value);
      if (!location || seen.has(location.id)) return [];
      seen.add(location.id); return [location];
    });
    return { locations, ...(!locations.length ? { reason: "No Meta-eligible location with latitude and longitude was returned. Try a more specific place or a known location Page ID; Phoenix will not invent a location." } : {}) };
  } catch (error) { if (error instanceof ReviewPublishingError) return { locations: [], reason: error.message }; throw error; }
}

async function readPostingDefaults(access: ChannelPublishAccess): Promise<StoredPostingDefaults | null> {
  try {
    const filename = postingDefaultsPath(); const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 4096) throw problem("Saved posting choices need local inspection; no defaults were applied.", 500);
    const value = JSON.parse(await fs.readFile(filename, "utf8")) as StoredPostingDefaults;
    const tags = publicInstagramUserTags(value.userTags);
    if (value.version !== 1 || typeof value.accountId !== "string" || !/^\d{1,40}$/.test(value.accountId) || !tags
        || (value.location !== undefined && !publicInstagramLocation(value.location))
        || (value.locationQuery !== undefined && (typeof value.locationQuery !== "string" || !value.locationQuery.trim() || value.locationQuery.length > 100 || /[\u0000-\u001f\u007f]/.test(value.locationQuery)))) throw problem("Saved posting choices need local inspection; no defaults were applied.", 500);
    // A different connected profile never inherits the owner's tags or place.
    return value.accountId === access.accountId ? { version: 1, accountId: value.accountId, userTags: tags,
      ...(value.location ? { location: publicInstagramLocation(value.location)! } : {}), ...(value.locationQuery ? { locationQuery: value.locationQuery.trim() } : {}) } : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof ReviewPublishingError) throw error;
    throw problem("Saved posting choices could not be read safely. No defaults were applied.", 500);
  }
}

/** A new-post setup read; normal status polling does not resolve defaults. */
export async function getInstagramPostingDefaults(reviewId: string, connectionRevision: string): Promise<InstagramPostingDefaults> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  const revision = checkedText(connectionRevision, "Channel connection", 200);
  await readyMedia(reviewId, "instagram");
  const access = await accessFor("instagram", revision);
  if (access.loginType !== "facebook") throw problem("Posting defaults need the existing Facebook-linked Instagram connection.", 403);
  const saved = await readPostingDefaults(access);
  if (!saved) return { userTags: [] };
  const defaults: InstagramPostingDefaults = { userTags: saved.userTags, ...(saved.locationQuery ? { locationQuery: saved.locationQuery } : {}) };
  try {
    if (saved.location) defaults.location = await verifiedInstagramLocation(saved.location.id, access);
    else if (saved.locationQuery) {
      const found = await searchInstagramLocations(reviewId, saved.locationQuery, revision);
      const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
      const matches = found.locations.filter(place => normalized(place.name) === normalized(saved.locationQuery!));
      // Owner chose a posting label, not a guessed filming location. A unique
      // exact Meta-eligible result is required; never attach an unrelated Page.
      if (matches.length === 1) defaults.location = matches[0];
      else defaults.locationReason = found.reason || `Meta did not return one unambiguous eligible location named ${saved.locationQuery}. No location tag was invented; choose an eligible result in Location if you want to post with a tag.`;
    }
    await assertCurrent(access);
    return defaults;
  } catch (error) {
    if (error instanceof ReviewPublishingError) {
      if (error.statusCode === 409 || error.statusCode === 401) throw error;
      return { ...defaults, location: undefined, locationReason: error.message };
    }
    throw error;
  }
}

/** Explicitly remember approved choices, without creating any upload or post. */
export async function saveInstagramPostingDefaults(reviewId: string, body: Record<string, unknown>): Promise<InstagramPostingDefaults> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  if (body.action !== "save-posting-defaults" || body.confirm !== true || Object.keys(body).some(key => !["action", "confirm", "connectionRevision", "userTags", "location"].includes(key))) throw problem("Confirm saving only these posting defaults.");
  const userTags = publicInstagramUserTags(body.userTags);
  if (!userTags) throw problem("Posting defaults need a canonical list of valid Instagram usernames.");
  const location = body.location === null ? null : publicInstagramLocation(body.location);
  if (body.location !== null && !location) throw problem("Choose a valid Meta location or explicitly save no location.");
  const revision = checkedText(body.connectionRevision, "Channel connection", 200);
  await readyMedia(reviewId, "instagram");
  const access = await accessFor("instagram", revision);
  if (access.loginType !== "facebook") throw problem("Posting defaults need the existing Facebook-linked Instagram connection.", 403);
  const verified = location ? await verifiedInstagramLocation(location.id, access) : undefined;
  if (verified && verified.name !== location!.name) throw problem("The location name changed. Check it again before saving defaults.", 409);
  await withFileLock(`${postingDefaultsPath()}.lock`, async () => {
    await assertCurrent(access);
    await fs.mkdir(storeRoot(), { recursive: true, mode: 0o700 });
    await writeAtomicJson(postingDefaultsPath(), { version: 1, accountId: access.accountId, userTags, ...(verified ? { location: verified } : {}) } satisfies StoredPostingDefaults);
  });
  return { userTags, ...(verified ? { location: verified } : {}) };
}

const AUDIO_ACCESS = "Meta could not make this Instagram audio available for the connected account. Check its Facebook Login publishing access or choose another track; no upload was started.";
async function audioProviderGet(url: URL, access: ChannelPublishAccess) {
  await assertCurrent(access);
  try {
    const result = await providerCall(url.href, { headers: { Authorization: `Bearer ${access.accessToken}` } }, true, false, 10_000);
    await assertCurrent(access);
    if (result.json.error) throw problem(AUDIO_ACCESS, 403);
    return result.json;
  } catch (error) {
    if (error instanceof ReviewPublishingError && error.statusCode === 409) throw error;
    if (error instanceof ReviewPublishingError && error.statusCode === 401) throw problem("The Instagram token expired or was revoked during audio lookup. Reconnect before choosing a track.", 401);
    if (error instanceof ReviewPublishingError && error.statusCode === 429) throw problem("Meta's audio lookup limit was reached. Wait before searching again; no upload was started.", 429);
    throw problem(AUDIO_ACCESS, 403);
  }
}
async function verifiedInstagramAudio(config: InstagramAudioConfiguration, access: ChannelPublishAccess): Promise<InstagramAudioSelection> {
  if (!instagramAudioId(config.audio_id) || access.loginType !== "facebook") throw problem("Instagram audio needs the Facebook-linked publishing connection.", 403);
  const url = new URL(`${AUDIO_GRAPH}/${config.audio_id}`); url.searchParams.set("user_id", access.accountId);
  const track = publicInstagramAudioTrack(await audioProviderGet(url, access));
  if (!track || track.audio_id !== config.audio_id) throw problem("The selected Instagram audio is unavailable for this account. Choose another track before confirming; Phoenix will not omit it silently.", 403);
  return { ...config, title: track.title, display_artist: track.display_artist };
}
/** Read-only catalog actions contact Meta; ordinary upload status polling never does. */
export async function searchInstagramAudio(reviewId: string, query: string, connectionRevision: string): Promise<InstagramAudioSearch> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  const q = checkedText(query, "Audio search", 100, true), revision = checkedText(connectionRevision, "Channel connection", 200);
  await readyMedia(reviewId, "instagram");
  const access = await accessFor("instagram", revision);
  if (access.loginType !== "facebook") throw problem("Instagram audio needs the existing Facebook-linked publishing connection.", 403);
  const url = new URL(`${AUDIO_GRAPH}/ig_audio`);
  url.searchParams.set("audio_type", "music"); url.searchParams.set("user_id", access.accountId);
  if (q) url.searchParams.set("search_query", q);
  try {
    const result = await audioProviderGet(url, access), seen = new Set<string>();
    const audio = (Array.isArray(result.audio) ? result.audio.slice(0, INSTAGRAM_AUDIO_SEARCH_LIMIT) : []).flatMap(value => {
      const track = publicInstagramAudioTrack(value);
      if (!track || seen.has(track.audio_id)) return [];
      seen.add(track.audio_id); return [track];
    });
    return { audio, ...(!audio.length ? { reason: "Meta returned no available Instagram audio. Try another search or keep this video's saved audio." } : {}) };
  } catch (error) { if (error instanceof ReviewPublishingError) return { audio: [], reason: error.message }; throw error; }
}

async function mediaDigest(filename: string) {
  const hash = crypto.createHash("sha256");
  // Only for proving legacy dual outputs are identical. Bounded streaming,
  // no video decoder, full-file buffer, frames or model involved.
  for await (const chunk of createReadStream(filename, { highWaterMark: 64 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}
async function matchingMusicEvidence(media: Awaited<ReturnType<typeof readyMedia>>) {
  const analysis = media.file.quality.postingAnalysis;
  if (analysis?.status !== "COMPLETE" || !analysis.fingerprint) return null;
  const currentIdentity = postingMediaFingerprint(media.file, media.target, media.fingerprint);
  if (analysis.fingerprint === currentIdentity) return { identity: currentIdentity, target: media.target, fingerprint: media.fingerprint };
  // Existing completed analyses preferred YouTube when both outputs existed.
  // Never reset that cache or assume two aspect-ratio exports show the same
  // footage. Reuse evidence only after exact, bounded byte-equality proof.
  const otherTarget = media.target === "instagram" ? "youtube" : "instagram";
  if (!media.file.outputs[otherTarget]) return null;
  const other = await readyMedia(media.file.id, "instagram", undefined, otherTarget);
  const identity = postingMediaFingerprint(other.file, other.target, other.fingerprint);
  if (analysis.fingerprint !== identity || media.fingerprint.size !== other.fingerprint.size || media.file.outputs[media.target]?.duration !== other.file.outputs[other.target]?.duration) return null;
  if (await mediaDigest(media.filename) !== await mediaDigest(other.filename)) return null;
  await readyMedia(media.file.id, "instagram", media.fingerprint, media.target);
  await readyMedia(media.file.id, "instagram", other.fingerprint, other.target);
  return { identity, target: other.target, fingerprint: other.fingerprint };
}

/** Reuses saved visual evidence without another model call or song download. */
export async function recommendInstagramAudio(reviewId: string, connectionRevision: string): Promise<InstagramAudioSearch> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  const revision = checkedText(connectionRevision, "Channel connection", 200);
  const media = await readyMedia(reviewId, "instagram");
  const access = await accessFor("instagram", revision);
  if (access.loginType !== "facebook") throw problem("Instagram audio needs the existing Facebook-linked publishing connection.", 403);
  const evidence = await matchingMusicEvidence(media);
  if (!evidence) return { audio: [], reason: "Music recommendations need caption analysis of this finished output. Its analysis is missing or out of date; no generic trending music was substituted. You can search a track yourself or keep the saved audio." };
  const profile = musicBriefFromReview(media.file);
  if (!profile) return { audio: [], reason: "There is not enough saved visual evidence to recommend fitting English songs or instrumentals. No extra model call was made. You can search a track yourself or keep the saved audio." };
  const recommendation = { preference: "english-and-instrumental" as const, basis: profile.basis, mood: profile.brief.mood, energy: profile.brief.energy, reason: profile.brief.reason };
  const seeds = musicSeedsFor(profile.brief);
  if (!seeds.length) return { audio: [], recommendation, reason: "The sampled visual mood is uncertain. No unrelated trending track was substituted; choose music yourself or keep the saved audio." };
  const seen = new Set<string>(); const audio: RecommendedInstagramAudio[] = [];
  try {
    // At most three sequential, bounded metadata requests. Strict original
    // title/artist matching establishes the seed identity, never vocal language
    // inferred from an English-looking title. Meta decides account availability.
    for (const seed of seeds) {
      await readyMedia(reviewId, "instagram", media.fingerprint, media.target);
      const url = new URL(`${AUDIO_GRAPH}/ig_audio`);
      url.searchParams.set("audio_type", "music"); url.searchParams.set("user_id", access.accountId);
      url.searchParams.set("search_query", seed.title);
      const result = await audioProviderGet(url, access);
      for (const value of Array.isArray(result.audio) ? result.audio.slice(0, INSTAGRAM_AUDIO_SEARCH_LIMIT) : []) {
        const track = publicInstagramAudioTrack(value);
        if (!track || seen.has(track.audio_id) || !musicSeedMatches(track, seed)) continue;
        seen.add(track.audio_id);
        audio.push({ ...track, recommendation: { rank: audio.length + 1, kind: seed.kind,
          reason: `${seed.character} for a ${profile.brief.mood} visual mood (${profile.brief.energy} suggested energy). Editorial fit, not beat or lyric analysis.` } });
        break; // One original per seed, not multiple copies of the same song.
      }
    }
    await assertCurrent(access);
    const latest = await readyMedia(reviewId, "instagram", media.fingerprint, media.target);
    await readyMedia(reviewId, "instagram", evidence.fingerprint, evidence.target);
    if (latest.file.quality.postingAnalysis?.fingerprint !== evidence.identity || JSON.stringify(musicBriefFromReview(latest.file)) !== JSON.stringify(profile)) throw problem("This video's analysis changed during music lookup. Check its latest recommendations before choosing a track.", 409);
    return { audio, recommendation, ...(!audio.length ? { reason: "Meta returned none of the matching English songs or instrumentals for this account. No unrelated track was substituted. Search another track or keep the saved audio." } : {}) };
  } catch (error) {
    // A rate/permission/output change discards partial results. No retry, paid
    // fallback, automatic track selection or upload is triggered by this read.
    if (error instanceof ReviewPublishingError) return { audio: [], recommendation, reason: error.message };
    throw error;
  }
}

function assertStoryMedia(media: Awaited<ReturnType<typeof readyMedia>>) {
  const output = media.file.outputs[media.target];
  if (!output || !Number.isFinite(output.duration) || output.duration < 3 || output.duration > 60 ||
      !Number.isFinite(output.width) || !Number.isFinite(output.height) || output.width <= 0 || output.width >= output.height || output.width > 1920 || media.fingerprint.size > 100_000_000) {
    throw problem("A matching Story needs a ready portrait MP4, 3–60 seconds and at most 100 MB. This Reel can still be posted on its own; Phoenix will not shorten or re-encode it.");
  }
}

async function assertStoryAccount(access: ChannelPublishAccess) {
  if (access.platform !== "instagram" || access.loginType !== "facebook" || !/^\d{1,40}$/.test(access.accountId)) throw problem("Automatic Stories require verified Facebook-linked Business publishing access.", 403);
  await assertCurrent(access);
  // Facebook's Page edge includes Creator accounts and its IG User fields do
  // not document account_type. Never send an unsupported probe or infer type
  // from a Page link. Retain the owner's explicit type confirmation privately,
  // bound to this exact account and connection; Meta still enforces eligibility.
  try {
    const stats = await fs.stat(storyBusinessPath());
    if (stats.size > 2048) throw new Error();
    const saved = JSON.parse(await fs.readFile(storyBusinessPath(), "utf8"));
    if (saved.version === 1 && saved.accountId === access.accountId && saved.connectionRevision === access.connectionRevision
        && saved.accountType === "BUSINESS" && Number.isFinite(Date.parse(saved.confirmedAt)) && Date.parse(saved.confirmedAt) <= Date.now()) {
      await assertCurrent(access); return;
    }
  } catch { /* No private file/path/provider details are exposed. */ }
  throw problem(STORY_BUSINESS_CONFIRMATION, 403);
}

/** Local type confirmation only. No provider mutation, container or publication. */
export async function confirmInstagramStoryBusiness(reviewId: string, body: Record<string, unknown>): Promise<InstagramStoryCapability> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  if (body.confirm !== true || body.businessAccountConfirmed !== true) throw problem("Confirm in Instagram Settings that this account is Business, not Creator.");
  const revision = checkedText(body.connectionRevision, "Channel connection", 200);
  const media = await readyMedia(reviewId, "instagram"); assertStoryMedia(media);
  const access = await accessFor("instagram", revision);
  if (access.loginType !== "facebook") throw problem("Story uploads need the existing Facebook-linked publishing connection.", 403);
  await withFileLock(`${storyBusinessPath()}.lock`, async () => {
    await assertCurrent(access);
    await fs.mkdir(storeRoot(), { recursive: true, mode: 0o700 });
    await writeAtomicJson(storyBusinessPath(), { version: 1, accountId: access.accountId, connectionRevision: access.connectionRevision, accountType: "BUSINESS", confirmedAt: now() });
  });
  return checkInstagramStoryCapability(reviewId, revision);
}

/** Explicit, read-only capability check; ordinary upload status GETs never call Meta. */
export async function checkInstagramStoryCapability(reviewId: string, connectionRevision: string): Promise<InstagramStoryCapability> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  const revision = checkedText(connectionRevision, "Channel connection", 200);
  try {
    const media = await readyMedia(reviewId, "instagram"); assertStoryMedia(media);
    const access = await accessFor("instagram", revision); await assertStoryAccount(access);
    return { ready: true, reason: "Business account confirmed for this connection; publishing permission verified. The same saved video can accompany this Reel after it succeeds, without re-rendering. Meta makes the final eligibility check." };
  } catch (error) {
    const reason = error instanceof ReviewPublishingError ? error.message : "Story capability could not be verified. You can still post the Reel and add a Story manually.";
    return { ready: false, reason, ...(reason === STORY_BUSINESS_CONFIRMATION ? { requiresBusinessConfirmation: true } : {}) };
  }
}

async function assertStoryParent(job: StoredJob) {
  const parent = await readStored(job.reviewId, "instagram");
  if (!parent || parent.id !== job.parentReelId || !parent.companionStoryApproved || parent.phase !== "complete" || parent.status !== "COMPLETE" || !parent.remoteId ||
      parent.accountId !== job.accountId || parent.connectionRevision !== job.connectionRevision || parent.renderTarget !== job.renderTarget || !sameFile(parent.fingerprint, job.fingerprint)) {
    throw problem("The confirmed Reel must finish successfully before its matching Story. Phoenix will never repeat the Reel to retry a Story.", 409);
  }
}

/** A create request returns the existing per-file/platform job rather than creating duplicates. */
export async function prepareReviewPublication(reviewId: string, body: Record<string, unknown>): Promise<{ job: ReviewPublishJob; dispatch: boolean }> {
  if (!validId(reviewId)) throw problem("Review video not found.", 404);
  if (body.confirm !== true) throw problem("Confirm this upload before Phoenix sends the video to the platform.");
  if (body.action === "create") {
    if (!isPlatform(body.platform)) throw problem("Choose YouTube or Instagram.");
    const platform = body.platform;
    const title = checkedText(body.title, "Video title", 100);
    const requestedCaption = checkedText(body.caption, "Caption", platform === "youtube" ? 4800 : 2200, true);
    checkPlatformHashtags(platform, requestedCaption);
    const revision = checkedText(body.connectionRevision, "Channel connection", 200);
    const privacy = body.privacy ?? "private";
    if (!["public", "unlisted", "private"].includes(String(privacy))) throw problem("Choose public, unlisted, or private visibility.");
    if (platform === "instagram" && privacy !== "public") throw problem("Instagram Reels are published publicly. Confirm public visibility to upload this Reel.");
    const madeForKids = body.madeForKids;
    if (typeof madeForKids !== "boolean") throw problem("Choose the made-for-kids setting explicitly.");
    if (body.companionStory !== undefined && typeof body.companionStory !== "boolean") throw problem("Choose whether to include a matching Story explicitly.");
    if (body.companionStory === true && platform !== "instagram") throw problem("Matching Stories are only available with an Instagram Reel.");
    let requestedLocation: string | undefined;
    if (body.location !== undefined) {
      if (platform !== "instagram") throw problem("Location tagging is only available for an Instagram Reel.");
      if (!body.location || typeof body.location !== "object" || Array.isArray(body.location)
          || Object.keys(body.location).length !== 1 || !instagramLocationId((body.location as { id?: unknown }).id)) throw problem("Choose one eligible location using its numeric Facebook Page ID, not a free-form country or URL.");
      requestedLocation = (body.location as { id: string }).id;
    }
    let requestedAudio: InstagramAudioConfiguration | undefined;
    if (body.audio !== undefined) {
      if (platform !== "instagram") throw problem("Instagram audio can only accompany an Instagram Reel.");
      const config = instagramAudioConfiguration(body.audio);
      if (!config) throw problem("Choose an Instagram audio ID and integer audio/video volumes from 1 to 100.");
      requestedAudio = config;
    }
    let requestedUserTags: string[] | undefined;
    if (body.userTags !== undefined) {
      if (platform !== "instagram") throw problem("People tagging is only available for an Instagram Reel.");
      const tags = instagramUserTags(body.userTags);
      if (!tags) throw problem(`Choose at most ${INSTAGRAM_USER_TAG_LIMIT} Instagram usernames, each 1 to 30 letters, digits, underscores or dots. Use usernames, not profile URLs or Facebook Page IDs.`);
      requestedUserTags = tags;
    }
    return withFileLock(pairLock(reviewId, platform), async () => {
      const existing = await readStored(reviewId, platform);
      if (existing) return { job: await publicJob(existing), dispatch: false };
      const media = await readyMedia(reviewId, platform);
      // Stock provenance remains in saved metadata, not the social caption.
      // Only recognizable generated footer blocks are removed; owner text and
      // report/news citations stay intact. Existing upload jobs keep their
      // already-confirmed immutable metadata on duplicate create/continue.
      const caption = stripFootageProvenance(requestedCaption, media.file);
      checkPlatformHashtags(platform, caption);
      if (caption.length > (platform === "youtube" ? 5000 : 2200)) throw problem("Shorten the caption to fit the platform's limit.");
      const access = await accessFor(platform, revision);
      if (platform === "instagram" && access.loginType !== "facebook") throw problem("This Instagram connection verifies identity only. Connect a Facebook-linked professional account with publishing permission.", 403);
      await assertCurrent(access);
      if (body.companionStory === true) { assertStoryMedia(media); await assertStoryAccount(access); }
      const location = requestedLocation ? await verifiedInstagramLocation(requestedLocation, access) : undefined;
      const audio = requestedAudio ? await verifiedInstagramAudio(requestedAudio, access) : undefined;
      const job: StoredJob = {
        version: 1, id: crypto.randomUUID(), reviewId, platform, status: "QUEUED", phase: "created",
        percent: 0, detail: "Confirmed upload queued. Keep Phoenix running while it sends the saved video.", accountName: access.name,
        accountId: access.accountId, connectionRevision: access.connectionRevision,
        privacy: privacy as PublishInput["privacy"] & ReviewPublishJob["privacy"], title, caption, madeForKids,
        renderTarget: media.target, fingerprint: media.fingerprint, bytesUploaded: 0, totalBytes: media.fingerprint.size,
        canContinue: false, queuedAt: Date.now(), updatedAt: now(),
        ...(body.companionStory === true ? { companionStoryApproved: true } : {}),
        ...(location ? { location } : {}),
        ...(audio ? { audio, instagramGraphVersion: INSTAGRAM_AUDIO_GRAPH_VERSION } : {}),
        ...(requestedUserTags?.length ? { userTags: requestedUserTags } : {}),
      };
      if (job.companionStoryApproved) {
        const orphan = await readStored(reviewId, "instagram", "story");
        if (orphan) throw problem("A saved matching Story already exists without its Reel record. Inspect the local upload history before creating another request.", 409);
        const story: StoredJob = { ...job, id: crypto.randomUUID(), kind: "story", parentReelId: job.id, companionStoryApproved: undefined,
          location: undefined, audio: undefined, userTags: undefined, instagramGraphVersion: undefined, caption: "", detail: "Matching Story approved. Waiting for this Reel to finish; the same saved MP4 will be reused." };
        await persist(story);
      }
      await persist(job); return { job: await publicJob(job), dispatch: true };
    });
  }
  if (body.location !== undefined) throw problem("The confirmed location is immutable. Continue the saved upload without changing its location.");
  if (body.audio !== undefined) throw problem("The confirmed Instagram audio is immutable. Continue the saved upload without changing its track or volumes.");
  if (body.userTags !== undefined) throw problem("The confirmed Instagram people tags are immutable. Continue the saved upload without changing its usernames.");
  if (!["continue", "continue-story"].includes(String(body.action)) || !validId(body.jobId)) throw problem("Use create or continue with a saved upload job.");
  const candidates: Array<{ platform: ReviewTarget; kind?: "story" }> = body.action === "continue-story" ? [{ platform: "instagram", kind: "story" }] : [{ platform: "youtube" }, { platform: "instagram" }];
  for (const { platform, kind } of candidates) {
    const result = await withFileLock(pairLock(reviewId, platform, kind), async () => {
      const job = await readStored(reviewId, platform, kind);
      if (!job || job.id !== body.jobId) return null;
      if (job.phase === "complete" || await operationActive(job) || (job.status === "QUEUED" && Date.now() - job.queuedAt < LEASE_MS)) return { job: await publicJob(job), dispatch: false };
      if (!continuable(job)) throw problem("The provider may have accepted the previous request. Check the destination channel before taking another action; Phoenix will not repeat an ambiguous publish.", 409);
      checkPlatformHashtags(platform, job.caption);
      const access = await accessFor(platform, job.connectionRevision);
      if (access.accountId !== job.accountId) throw problem("The destination account changed. This saved upload cannot be continued.", 409);
      const media = await readyMedia(reviewId, platform, job.fingerprint, job.renderTarget); await assertCurrent(access);
      if (kind === "story") { await assertStoryParent(job); assertStoryMedia(media); await assertStoryAccount(access); }
      job.status = "QUEUED"; job.queuedAt = Date.now(); job.canContinue = false;
      job.detail = "Continue confirmed. Phoenix will check the existing upload before sending more data.";
      await persist(job); return { job: await publicJob(job), dispatch: true };
    });
    if (result) return result;
  }
  throw problem("Saved upload job not found.", 404);
}

/** Session URIs are credentials: validate before attaching tokens or opening the stream. */
export function validateReviewUploadUrl(value: string, platform: ReviewTarget) {
  try {
    const url = new URL(value);
    const host = platform === "youtube" ? "www.googleapis.com" : "rupload.facebook.com";
    if (value.length > 8192 || url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password || url.hash) throw new Error();
    if (platform === "youtube" && (url.pathname !== "/upload/youtube/v3/videos" || url.searchParams.get("uploadType") !== "resumable" || !url.searchParams.get("upload_id"))) throw new Error();
    if (platform === "instagram" && !/^\/ig-api-upload\/(?:v\d+\.\d+\/)?\d+\/?$/.test(url.pathname)) throw new Error();
    if (url.searchParams.has("access_token")) throw new Error();
    return url.href;
  } catch { throw problem("The provider returned an unsafe upload destination. No credentials or video were sent to it.", 502, true); }
}
function providerFailure(status: number, json: Record<string, unknown>) {
  const error = json.error as { code?: unknown; errors?: Array<{ reason?: unknown }> } | undefined;
  const code = typeof error?.code === "number" ? error.code : undefined;
  const reason = error?.errors?.[0]?.reason;
  if (status === 401 || code === 190) return problem("The platform token expired or was revoked. Reconnect the channel, then check this saved upload.", 401);
  if ([4, 17, 32, 613].includes(code || 0) || status === 429 || reason === "quotaExceeded" || reason === "dailyLimitExceeded") return problem("The platform upload quota or rate limit was reached. Wait for the platform limit to reset; this job is retained.", 429);
  if (reason === "accessNotConfigured" || reason === "serviceDisabled") return problem("Enable YouTube Data API v3 in the connected Google project, then continue this saved upload.", 403);
  if (status === 403 || code === 10 || code === 200 || reason === "insufficientPermissions") return problem("The platform denied upload permission. Check the app permissions and account role in Channels.", 403);
  return problem(`The platform rejected this upload (HTTP ${status}). Check its video requirements and your channel permissions.`, 502, status >= 500);
}
async function providerCall(url: string, options: RequestInit & { duplex?: "half" }, readBody = true, upload = false, timeoutMs = 20_000): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upload ? 30 * 60_000 : timeoutMs);
  try {
    const response = await fetch(url, { ...options, cache: "no-store", redirect: "error", signal: controller.signal });
    let json: Record<string, unknown> = {};
    if (readBody) json = await boundedJson(response.body, JSON_LIMIT, "The platform returned an unexpectedly large response; check the saved upload before continuing.", "The platform returned an unreadable response; check the saved upload before continuing.");
    else await response.body?.cancel().catch(() => undefined);
    if (!response.ok && response.status !== 308) throw providerFailure(response.status, json);
    return { status: response.status, headers: response.headers, json };
  } catch (error) {
    if (error instanceof ReviewPublishingError) throw error;
    throw problem("The platform did not respond reliably. This upload is saved; use Continue to check its existing state.", 502, true);
  } finally { clearTimeout(timer); }
}
function videoId(value: unknown, platform: ReviewTarget) {
  if (typeof value !== "string" || !(platform === "youtube" ? /^[A-Za-z0-9_-]{11}$/ : /^\d{1,40}$/).test(value)) throw problem("The platform response did not identify the uploaded video. Check the channel before taking another action.", 502, true);
  return value;
}
export function youtubeResumeOffset(range: string | null, total: number) {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  const last = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(last) || last < 0 || last >= total) throw problem("YouTube returned an invalid resume range. No further video data was sent.", 502, true);
  return last + 1;
}
async function completeYoutube(job: StoredJob, result: ProviderResult) {
  job.remoteId = videoId(result.json.id, "youtube"); job.remoteUrl = `https://www.youtube.com/watch?v=${job.remoteId}`;
  job.phase = "complete"; job.status = "COMPLETE"; job.percent = 100; job.bytesUploaded = job.totalBytes; job.canContinue = false;
  const actual = (result.json.status as { privacyStatus?: unknown } | undefined)?.privacyStatus;
  if (actual === "private" || actual === "unlisted" || actual === "public") job.actualPrivacy = actual;
  job.detail = job.actualPrivacy
    ? `YouTube accepted the video with ${job.actualPrivacy} visibility. It may still be processing on YouTube.`
    : "YouTube accepted the video. Its actual visibility was not returned; check the video on YouTube. It may still be processing.";
  await persist(job); await saveChannelUploadSession(job.id, null);
}

async function streamSavedVideo(job: StoredJob, access: ChannelPublishAccess, url: string, offset: number, instagram = false) {
  const safeUrl = validateReviewUploadUrl(url, job.platform);
  const media = await readyMedia(job.reviewId, job.platform, job.fingerprint, job.renderTarget);
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(media.filename, "r"); }
  catch { throw problem("The saved video could not be opened. The upload is retained."); }
  let stream: ReturnType<typeof handle.createReadStream> | undefined;
  try {
    if (!sameFile(fingerprint(await handle.stat()), job.fingerprint)) throw problem("The saved video changed before uploading. No video data was sent.", 409);
    job.phase = "sending"; job.status = "UPLOADING"; job.canContinue = false; job.bytesUploaded = offset;
    job.detail = "Streaming the saved video directly from disk. Keep Phoenix running."; await persist(job);
    stream = handle.createReadStream({ start: offset, end: job.totalBytes - 1, highWaterMark: 64 * 1024, autoClose: false });
    let sent = offset; let lastSaved = Date.now(); let lastSavedBytes = sent;
    let accessMonitor: (() => Promise<void>) | undefined;
    let monitorFailure: ReviewPublishingError | undefined;
    let firstChunk = true; let lastAccessCheck = 0;
    async function checkStreamAccess() {
      try {
        if (!accessMonitor) throw new Error();
        await accessMonitor();
      } catch {
        monitorFailure = problem("The channel connection changed or was disconnected. The video stream stopped before sending more data.", 409);
        throw monitorFailure;
      }
    }
    async function* chunks() {
      for await (const chunk of stream!) {
        // Async iteration applies backpressure; no whole-video buffer is allocated.
        if (firstChunk || Date.now() - lastAccessCheck >= 2000) {
          await checkStreamAccess(); firstChunk = false; lastAccessCheck = Date.now();
        }
        sent += chunk.length;
        if (sent > job.totalBytes) throw problem("The saved video changed during upload.", 409);
        if (Date.now() - lastSaved >= 1000 || sent - lastSavedBytes >= 1024 * 1024) {
          if (!sameFile(fingerprint(await handle.stat()), job.fingerprint)) throw problem("The saved video changed during upload. Check the platform before continuing.", 409);
          job.bytesUploaded = sent; job.percent = Math.min(95, Math.floor(sent / job.totalBytes * 95)); await persist(job);
          lastSaved = Date.now(); lastSavedBytes = sent;
        }
        yield chunk;
      }
      await checkStreamAccess();
      if (sent !== job.totalBytes || !sameFile(fingerprint(await handle.stat()), job.fingerprint)) throw problem("The saved video changed or ended early during upload.", 409);
    }
    const body = Readable.from(chunks(), { objectMode: false, highWaterMark: 64 * 1024 });
    try {
      // Initial assertion is followed by cheap file-version checks during the stream.
      // Decryption is needed again only when the encrypted channel store changes.
      try { accessMonitor = await createChannelPublishAccessMonitor(access); }
      catch { throw problem("The channel connection changed or was disconnected. Uploading stopped before sending the video.", 409); }
      return await providerCall(safeUrl, {
        method: instagram ? "POST" : "PUT", body: body as unknown as BodyInit, duplex: "half",
        headers: instagram ? { Authorization: `OAuth ${access.accessToken}`, offset: "0", file_size: String(job.totalBytes), "Content-Length": String(job.totalBytes), "Content-Type": "video/mp4" }
          : { Authorization: `Bearer ${access.accessToken}`, "Content-Length": String(job.totalBytes - offset), "Content-Type": "video/mp4", "Content-Range": `bytes ${offset}-${job.totalBytes - 1}/${job.totalBytes}` },
      }, true, true);
    } catch (error) {
      // fetch may wrap an iterator error; retain our fixed, secret-free explanation.
      if (monitorFailure) throw monitorFailure;
      throw error;
    } finally { body.destroy(); stream.destroy(); }
  } finally { stream?.destroy(); await handle.close().catch(() => undefined); }
}
async function youtube(job: StoredJob, access: ChannelPublishAccess) {
  let session = await getChannelUploadSession(job.id);
  if (!session) {
    if (job.phase !== "created") throw problem("The previous upload session request has no safely saved destination. Check YouTube before creating another upload.", 409, true);
    job.phase = "initiating"; job.status = "UPLOADING"; job.canContinue = false;
    job.detail = "Creating a YouTube resumable upload session."; await persist(job); await assertCurrent(access);
    const result = await providerCall("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST", headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(job.totalBytes), "X-Upload-Content-Type": "video/mp4" },
      body: JSON.stringify({ snippet: { title: job.title, description: job.caption }, status: { privacyStatus: job.privacy, selfDeclaredMadeForKids: job.madeForKids } }),
    }, false);
    if (result.status !== 200) throw problem("YouTube returned an unexpected upload-session response. Check the channel before creating another upload.", 502, true);
    session = validateReviewUploadUrl(result.headers.get("location") || "", "youtube");
    await saveChannelUploadSession(job.id, session);
    job.phase = "session"; await persist(job);
  }
  session = validateReviewUploadUrl(session, "youtube");
  await assertCurrent(access);
  const checked = await providerCall(session, { method: "PUT", headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Length": "0", "Content-Range": `bytes */${job.totalBytes}` } });
  if (checked.status === 200 || checked.status === 201) return completeYoutube(job, checked);
  if (checked.status !== 308) throw problem("YouTube did not return a valid upload status. Check the saved upload before continuing.", 502, true);
  const offset = youtubeResumeOffset(checked.headers.get("range"), job.totalBytes);
  if (offset >= job.totalBytes) throw problem("YouTube received the bytes but has not confirmed the video. Continue later to check the existing session.", 409);
  const uploaded = await streamSavedVideo(job, access, session, offset);
  if (uploaded.status === 200 || uploaded.status === 201) return completeYoutube(job, uploaded);
  if (uploaded.status === 308) {
    job.bytesUploaded = youtubeResumeOffset(uploaded.headers.get("range"), job.totalBytes);
    job.percent = Math.min(95, Math.floor(job.bytesUploaded / job.totalBytes * 95)); job.status = "NEEDS_CHECK"; job.canContinue = true;
    job.detail = "YouTube saved part of the upload. Continue explicitly to query the saved session and resume."; await persist(job); return;
  }
  throw problem("YouTube has not confirmed this upload. Continue to check the saved session.", 502, true);
}
async function instagramStatus(job: StoredJob, access: ChannelPublishAccess) {
  if (!job.containerId || !/^\d{1,40}$/.test(job.containerId)) throw problem("Instagram container status is unavailable. Check the account before taking another action.", 409, true);
  await assertCurrent(access);
  const result = await providerCall(`${instagramGraph(job)}/${job.containerId}?fields=status_code`, { headers: { Authorization: `Bearer ${access.accessToken}` } });
  return result.json.status_code;
}
async function instagram(job: StoredJob, access: ChannelPublishAccess) {
  const label = job.kind === "story" ? "Story" : "Reel";
  if (access.loginType !== "facebook") throw problem("This Instagram connection does not have verified Facebook-linked publishing access.", 403);
  if (!/^\d{1,40}$/.test(access.accountId)) throw problem("The verified Instagram destination is invalid. Reconnect the channel.", 403);
  if (!job.containerId) {
    if (job.phase !== "created") throw problem("The previous Instagram container request was interrupted. Check the account before taking another action.", 409, true);
    if (job.location && !job.kind) {
      const verified = await verifiedInstagramLocation(job.location.id, access);
      if (verified.name !== job.location.name) throw problem("The selected Instagram location changed after confirmation. No container was created; inspect the saved place before continuing.", 409);
    }
    if (job.audio && !job.kind) {
      const verified = await verifiedInstagramAudio(job.audio, access);
      if (verified.title !== job.audio.title || verified.display_artist !== job.audio.display_artist) throw problem("The selected Instagram audio changed after confirmation. No container was created; review the saved track before continuing.", 409);
    }
    job.phase = "initiating"; job.status = "UPLOADING"; job.canContinue = false;
    job.detail = `Creating an Instagram ${label} upload container.`; await persist(job); await assertCurrent(access);
    const created = await providerCall(`${instagramGraph(job)}/${access.accountId}/media`, {
      method: "POST", headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(job.kind === "story" ? { media_type: "STORIES", upload_type: "resumable" } : { media_type: "REELS", upload_type: "resumable", caption: job.caption, ...(job.location ? { location_id: job.location.id } : {}),
        ...(job.userTags?.length ? { user_tags: JSON.stringify(job.userTags.map(username => ({ username }))) } : {}),
        ...(job.audio ? { audio_configuration: JSON.stringify({ audio_id: job.audio.audio_id, audio_volume: job.audio.audio_volume, video_volume: job.audio.video_volume }) } : {}) }),
    });
    const containerId = videoId(created.json.id, "instagram");
    if (typeof created.json.uri !== "string") throw problem("Instagram did not return a safe video upload destination. Check the account before taking another action.", 502, true);
    const session = validateReviewUploadUrl(created.json.uri, "instagram");
    await saveChannelUploadSession(job.id, session);
    job.containerId = containerId; job.phase = "session"; await persist(job);
  }
  if (job.phase === "session") {
    const session = await getChannelUploadSession(job.id);
    if (!session) throw problem("The private Instagram upload session is unavailable. Check the account before taking another action.", 409, true);
    const uploaded = await streamSavedVideo(job, access, session, 0, true);
    if (uploaded.json.success !== true) throw problem("Instagram has not acknowledged the video transfer. Continue to check this container; Phoenix will not resend it blindly.", 502, true);
    job.phase = "processing";
  }
  // An interrupted binary request is checked on its existing container, never resent at offset zero.
  job.status = "PROCESSING"; job.percent = 96; job.detail = `Instagram is processing the uploaded ${label}.`; await persist(job);
  let finished = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const status = await instagramStatus(job, access);
    if (status === "FINISHED") { finished = true; break; }
    if (status === "PUBLISHED") throw problem("Instagram reports this container as published but has not returned its media ID. Check the account; Phoenix will not publish it again.", 409, true);
    if (status === "ERROR" || status === "EXPIRED") throw problem("Instagram could not process this container or it expired. Check Instagram's video requirements and the account before taking another action.", 409, true);
    if (status !== "IN_PROGRESS") throw problem("Instagram returned an unknown processing state. Check the account before taking another action.", 502, true);
    if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  if (!finished) {
    job.status = "NEEDS_CHECK"; job.canContinue = true;
    job.detail = "Instagram is still processing or has not confirmed the transfer. Continue explicitly to check the same container."; await persist(job); return;
  }
  job.phase = "publishing"; job.status = "PROCESSING"; job.percent = 98; job.canContinue = false;
  job.detail = `Instagram finished processing. Publishing the confirmed public ${label}.`; await persist(job);
  const media = await readyMedia(job.reviewId, job.platform, job.fingerprint, job.renderTarget);
  if (job.kind === "story") { await assertStoryParent(job); assertStoryMedia(media); }
  await assertCurrent(access);
  const published = await providerCall(`${instagramGraph(job)}/${access.accountId}/media_publish`, {
    method: "POST", headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: job.containerId! }),
  });
  job.remoteId = videoId(published.json.id, "instagram");
  // Persist the actual ID before the optional permalink lookup, so a failed lookup cannot repeat publish.
  job.phase = "complete"; job.status = "COMPLETE"; job.percent = 100; job.bytesUploaded = job.totalBytes; job.canContinue = false;
  job.detail = `Instagram published the ${label}. Its media ID is saved.`; await persist(job); await saveChannelUploadSession(job.id, null);
  if (job.kind === "story") return; // Stories are temporary; never fabricate a Reel permalink.
  try {
    await assertCurrent(access);
    const result = await providerCall(`${instagramGraph(job)}/${job.remoteId}?fields=permalink`, { headers: { Authorization: `Bearer ${access.accessToken}` } });
    if (typeof result.json.permalink === "string") {
      const url = new URL(result.json.permalink);
      if (url.protocol === "https:" && /^(?:www\.)?instagram\.com$/.test(url.hostname) && !url.username && !url.password && !url.port && /^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) { url.search = ""; url.hash = ""; job.remoteUrl = url.href; }
    }
    await persist(job);
  } catch { /* Publishing already succeeded; permalink lookup must never trigger a second publish. */ }
}

/** Called only from a confirmed POST's after() callback; importing the module does not run jobs. */
export async function runReviewPublication(reviewId: string, jobId: string) {
  if (!validId(reviewId) || !validId(jobId)) return;
  for (const { platform, kind } of [{ platform: "youtube" }, { platform: "instagram" }, { platform: "instagram", kind: "story" }] as Array<{ platform: ReviewTarget; kind?: "story" }>) {
    const saved = await readStored(reviewId, platform, kind);
    if (!saved || saved.id !== jobId) continue;
    try {
      // Own this job while it waits, then allow just one upload across all processes.
      // Both locks heartbeat; GET can distinguish a live queue from interrupted work.
      await withFileLock(operationLock(saved), async () => {
        const job = await readStored(reviewId, platform, kind);
        if (!job || job.id !== jobId || job.status !== "QUEUED" || !continuable(job)) return;
        job.detail = "Waiting for Phoenix's upload slot. One video uploads at a time to keep memory use small.";
        await persist(job);
        try {
          await withFileLock(path.join(storeRoot(), ".publication-stream.lock"), async () => {
            checkPlatformHashtags(platform, job.caption);
            const access = await accessFor(platform, job.connectionRevision);
            if (access.accountId !== job.accountId) throw problem("The upload destination account changed. The saved upload was stopped.", 409);
            const media = await readyMedia(reviewId, platform, job.fingerprint, job.renderTarget); await assertCurrent(access);
            if (kind === "story") { await assertStoryParent(job); assertStoryMedia(media); await assertStoryAccount(access); }
            if (platform === "youtube") await youtube(job, access); else await instagram(job, access);
          }, { timeoutMs: 31 * 60_000, retryMs: 1000, staleMs: LEASE_MS });
        } catch (error) {
          if (job.phase === "complete") return;
          const timedOut = error instanceof Error && /^Timed out (?:waiting for|accessing) local store lock:/.test(error.message);
          const safe = error instanceof ReviewPublishingError ? error : timedOut
            ? problem("The upload slot stayed busy too long. Continue explicitly after the other upload finishes.", 409)
            : problem("Phoenix could not finish this upload safely. The saved job is retained for inspection.", 500, true);
          if (job.phase === "initiating") job.phase = safe.ambiguous ? "session_unknown" : "created";
          if (job.phase === "publishing") job.phase = safe.ambiguous ? "publish_unknown" : "processing";
          job.status = safe.ambiguous ? "NEEDS_CHECK" : "FAILED";
          job.canContinue = continuable(job);
          job.detail = safe.message;
          if (!job.canContinue && safe.ambiguous) job.detail += " Check the destination channel; Phoenix will not repeat an ambiguous creation or publish request.";
          await persist(job);
        }
      }, { timeoutMs: 250, staleMs: LEASE_MS });
    } catch {
      // Do not leave a second queued job looking as though its video is uploading.
      // Never overwrite a job whose own operation is still running.
      try {
        await withFileLock(pairLock(reviewId, platform, kind), async () => {
          const job = await readStored(reviewId, platform, kind);
          if (!job || job.id !== jobId || job.status !== "QUEUED" || await operationActive(job)) return;
          job.status = "FAILED"; job.canContinue = continuable(job);
          job.detail = "Another upload is using Phoenix's upload slot, or the local upload store is busy. Continue explicitly after it finishes.";
          await persist(job);
        });
      } catch { /* Keep the existing durable status; do not log filenames or provider data. */ }
    }
    // Only the current confirmed Reel can trigger its new companion. Old posts
    // have no approval flag. Story continuation always uses the Story's own ID.
    if (platform === "instagram" && !kind) {
      const parent = await readStored(reviewId, platform);
      if (parent?.id === jobId && parent.phase === "complete" && parent.companionStoryApproved) {
        const story = await readStored(reviewId, platform, "story");
        if (story?.parentReelId === parent.id && story.status === "QUEUED" && story.phase === "created") await runReviewPublication(reviewId, story.id);
      }
    }
    return;
  }
}
