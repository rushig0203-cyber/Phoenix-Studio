import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { withFileLock } from "./fileLock";

export type ChannelPlatform = "youtube" | "instagram";
export type ChannelLoginType = "youtube" | "facebook" | "instagram";
export type ChannelPublishAccess = {
  platform: ChannelPlatform; accountId: string; name: string;
  connectionRevision: string; accessToken: string; loginType: ChannelLoginType;
};
/** Private server-only access for optional public hashtag research, not uploads. */
export type InstagramHashtagResearchAccess = {
  accountId: string; connectionRevision: string; accessToken: string;
};
type Credentials = { clientId: string; clientSecret: string };
type Account = {
  accessToken: string; refreshToken?: string; expiresAt?: number;
  id: string; name: string; profileUrl: string; connectedAt: string;
  verifiedAt: string; error?: string;
  connectionRevision?: string; loginType?: ChannelLoginType; pageId?: string;
  grantedScopes?: string[]; permissionsVerifiedAt?: string; publishPermissionError?: string;
};
type Pending = { platform: ChannelPlatform; stateHash: string; browserHash: string; expiresAt: number; redirectUri: string; verifier: string; claimed?: boolean; mode?: "token"; intent?: "identity" | "upload" };
type Vault = { credentials?: Partial<Record<ChannelPlatform, Credentials>>; accounts?: Partial<Record<ChannelPlatform, Account>>; pending?: Pending[]; uploadSessions?: Record<string, string> };
export type ChannelStatus = {
  platform: ChannelPlatform; configured: boolean; connected: boolean;
  state: "not_connected" | "connected" | "needs_attention";
  name?: string; profileUrl?: string; verifiedAt?: string; error?: string;
  redirectUri: string; oauthAvailable: boolean; hasClientSecret: boolean; clientId: string;
  accountId?: string; connectionRevision?: string; loginType?: ChannelLoginType; pageId?: string;
  publishReady: boolean; publishReason: string;
};
const vaultPath = () => path.join(process.env.PHOENIX_CHANNEL_STORAGE || path.join(process.cwd(), "storage", "private"), "channels.enc");
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const youtubeReadScope = "https://www.googleapis.com/auth/youtube.readonly";
const youtubeUploadScope = "https://www.googleapis.com/auth/youtube.upload";
const facebookPublishScopes = ["instagram_basic", "instagram_content_publish", "pages_read_engagement"];
function revision(account: Account) { return account.connectionRevision || hash(`channel-connection:${account.connectedAt}`); }
function actualScopes(value: unknown): string[] {
  const values = typeof value === "string" ? value.split(/[\s,]+/) : Array.isArray(value) ? value : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length < 200))];
}
function publishCapability(platform: ChannelPlatform, account?: Account, allowRenewal = false) {
  if (!account) return { publishReady: false, publishReason: "Connect this channel before uploading." };
  if (account.error) return { publishReady: false, publishReason: "Check this connection before uploading." };
  if (platform === "youtube") {
    if (account.loginType !== "youtube" || !account.grantedScopes?.includes(youtubeUploadScope)) return { publishReady: false, publishReason: "Enable YouTube uploads and grant upload permission. Channel identity access alone cannot upload videos." };
  } else {
    if (account.loginType === "instagram") return { publishReady: false, publishReason: "Instagram identity verified. Local-file publishing currently requires a Facebook Login token for the linked professional account; direct Instagram Login publishing is not enabled." };
    if (account.loginType !== "facebook" || !account.pageId) return { publishReady: false, publishReason: "Check or reconnect Instagram using a Facebook Login token for its linked professional account." };
    if (!account.permissionsVerifiedAt || !facebookPublishScopes.every(scope => account.grantedScopes?.includes(scope))) return { publishReady: false, publishReason: account.publishPermissionError || "Instagram identity verified, but publishing permission was not granted. Reconnect with instagram_basic, instagram_content_publish and pages_read_engagement." };
  }
  if (account.expiresAt && account.expiresAt <= Date.now() && !(allowRenewal && platform === "youtube" && account.refreshToken)) return { publishReady: false, publishReason: "Connection expired. Check or reconnect before uploading." };
  return { publishReady: true, publishReason: "Upload permission verified. Each video still requires your final confirmation." };
}
export const channelPlatforms: ChannelPlatform[] = ["youtube", "instagram"];
export function isChannelPlatform(value: string): value is ChannelPlatform { return channelPlatforms.includes(value as ChannelPlatform); }

// Accept a token copied on its own or from an Authorization header. Validate on
// the server so a failed request never echoes the credential to the browser.
export function normalizeInstagramToken(value: string): string {
  let token = value.trim();
  const unwrap = () => {
    if (token.length > 1 && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))) token = token.slice(1, -1).trim();
  };
  unwrap();
  token = token.replace(/^Authorization\s*:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
  unwrap();
  if (token.length < 10 || token.length > 10000 || !/^[A-Za-z0-9._~+\/=-]+$/.test(token)) {
    throw new Error("Paste the complete Instagram access token, not a URL, command, JSON response, or app secret.");
  }
  return token;
}

export function normalizeInstagramPageId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 64 || !/^\d{5,30}$/.test(value.trim())) {
    throw new Error("Enter the numeric Facebook Page ID from Meta Business Suite (5–30 digits), not a URL or account name.");
  }
  return value.trim();
}

// Windows protects this vault with the current user's DPAPI key. Secrets travel
// over stdin, never command-line arguments, and are never returned by the API.
async function protectWindows(value: string, decrypt: boolean): Promise<string> {
  const method = decrypt ? "Unprotect" : "Protect";
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[System.Security.Cryptography.ProtectedData]::${method}($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("The Windows credential vault did not respond.")); }, 10_000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new Error("The Windows credential vault is unavailable.")); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(new Error("Could not unlock channel credentials for this Windows user.")); });
    child.stdin.end(value);
  });
}

async function unixKey() {
  const filename = `${vaultPath()}.key`;
  try { return await fs.readFile(filename); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const key = crypto.randomBytes(32);
    try { await fs.writeFile(filename, key, { mode: 0o600, flag: "wx" }); return key; }
    catch (writeError) { if ((writeError as NodeJS.ErrnoException).code === "EEXIST") return fs.readFile(filename); throw writeError; }
  }
}

async function readVault(): Promise<Vault> {
  let raw: string;
  try { raw = await fs.readFile(vaultPath(), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  const envelope = JSON.parse(raw) as { kind: string; data: string; iv?: string; tag?: string };
  if (envelope.kind === "windows-dpapi") {
    if (process.platform !== "win32") throw new Error("These credentials belong to the original Windows user. Reconnect on this computer.");
    return JSON.parse(Buffer.from(await protectWindows(envelope.data, true), "base64").toString("utf8"));
  }
  if (envelope.kind !== "aes-256-gcm") throw new Error("Unknown channel credential format.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", await unixKey(), Buffer.from(envelope.iv!, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag!, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
}

async function writeVault(value: Vault) {
  await fs.mkdir(path.dirname(vaultPath()), { recursive: true, mode: 0o700 });
  let envelope;
  if (process.platform === "win32") envelope = { kind: "windows-dpapi", data: await protectWindows(Buffer.from(JSON.stringify(value)).toString("base64"), false) };
  else {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", await unixKey(), iv);
    envelope = { kind: "aes-256-gcm", iv: iv.toString("base64"), tag: "", data: Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]).toString("base64") };
    envelope.tag = cipher.getAuthTag().toString("base64");
  }
  const temp = `${vaultPath()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(envelope), { mode: 0o600 });
  await fs.rename(temp, vaultPath());
}

const withVault = <T>(action: (vault: Vault) => Promise<T>) => withFileLock(`${vaultPath()}.lock`, async () => action(await readVault()));
function credentials(vault: Vault, platform: ChannelPlatform): Credentials {
  const saved = vault.credentials?.[platform];
  return { clientId: saved?.clientId || process.env[platform === "youtube" ? "YOUTUBE_CLIENT_ID" : "INSTAGRAM_APP_ID"] || "", clientSecret: saved?.clientSecret || process.env[platform === "youtube" ? "YOUTUBE_CLIENT_SECRET" : "INSTAGRAM_APP_SECRET"] || "" };
}

// This application is a single-owner local studio, without remote account login.
// Keep credential routes loopback-only and require same-origin browser writes.
export function assertLocalChannelRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Manage channel credentials from localhost on this PC.");
  const host = request.headers.get("host");
  if (host && host !== url.host) throw new Error("Invalid studio host.");
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) throw new Error("Open channel settings directly in Phoenix Studio.");
  if (mutation && origin !== url.origin) throw new Error("Open channel settings directly in Phoenix Studio.");
  if (request.headers.get("sec-fetch-site") === "cross-site" && mutation) throw new Error("Cross-site channel changes are blocked.");
}

function status(vault: Vault, platform: ChannelPlatform, origin: string): ChannelStatus {
  const config = credentials(vault, platform), account = vault.accounts?.[platform];
  const expired = account?.expiresAt && account.expiresAt <= Date.now();
  return {
    platform, configured: Boolean(config.clientId && config.clientSecret), clientId: config.clientId,
    hasClientSecret: Boolean(config.clientSecret), connected: Boolean(account && !account.error && !expired),
    state: !account ? "not_connected" : account.error || expired ? "needs_attention" : "connected",
    name: account?.name, profileUrl: account?.profileUrl, verifiedAt: account?.verifiedAt,
    error: account?.error || (expired ? "Connection expired. Reconnect this channel." : undefined),
    redirectUri: `${origin}/api/channels/${platform}/callback`,
    oauthAvailable: platform === "youtube" || origin.startsWith("https://"),
    accountId: account?.id, connectionRevision: account ? revision(account) : undefined, pageId: account?.pageId,
    loginType: account?.loginType, ...publishCapability(platform, account),
  };
}
export async function listChannels(origin: string): Promise<ChannelStatus[]> {
  const vault = await readVault();
  return channelPlatforms.map((platform) => status(vault, platform, origin));
}

/** Read existing verified access only: never renew, authorize, or change a channel. */
export async function getInstagramHashtagResearchAccess(): Promise<InstagramHashtagResearchAccess | null> {
  const account = (await readVault()).accounts?.instagram;
  if (!account || account.error || account.loginType !== "facebook" || !account.permissionsVerifiedAt
    || !account.grantedScopes?.includes("instagram_basic") || !/^\d{5,30}$/.test(account.id)
    || !account.accessToken || (account.expiresAt && account.expiresAt <= Date.now())) return null;
  return { accountId: account.id, connectionRevision: revision(account), accessToken: account.accessToken };
}

export async function saveChannelCredentials(platform: ChannelPlatform, clientId: string, clientSecret: string) {
  return withVault(async (vault) => {
    const old = credentials(vault, platform);
    if (!clientId.trim() || (!clientSecret.trim() && !old.clientSecret)) throw new Error("Enter the app client ID and secret from the platform developer console.");
    if (old.clientId && old.clientId !== clientId.trim() && !clientSecret.trim()) throw new Error("Enter the new app secret when changing the client ID.");
    vault.credentials = { ...vault.credentials, [platform]: { clientId: clientId.trim(), clientSecret: clientSecret.trim() || old.clientSecret } };
    // Pasted Facebook tokens work before an app is configured. Adding that
    // same app's secret for optional metadata lookup must not discard the token.
    // Replacing a previously configured client still requires reconnection.
    const addingFacebookApp = platform === "instagram" && !old.clientId && vault.accounts?.instagram?.loginType === "facebook";
    if (old.clientId !== clientId.trim() && !addingFacebookApp && vault.accounts) delete vault.accounts[platform];
    else if (vault.accounts?.[platform] && (old.clientId !== clientId.trim() || old.clientSecret !== vault.credentials[platform]!.clientSecret)) vault.accounts[platform]!.connectionRevision = crypto.randomUUID();
    vault.pending = vault.pending?.filter((item) => item.platform !== platform);
    await writeVault(vault);
  });
}

type ProviderFailureKind = "authorization" | "permission" | "configuration" | "quota" | "network" | "request";
class ProviderRequestError extends Error {
  constructor(message: string, readonly kind: ProviderFailureKind) { super(message); }
}

function providerNetworkMessage(error: unknown) {
  const codes = new Set<string>();
  const queue: unknown[] = [error];
  let timedOut = false;
  const certificateCodes = new Set(["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_SIGNATURE_FAILURE"]);
  // Node fetch wraps transport failures in cause and sometimes AggregateError.
  // Inspect only bounded structured fields; never interpolate messages or stacks.
  for (let inspected = 0; queue.length && inspected < 8; inspected++) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    try {
      const detail = value as { name?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
      timedOut ||= detail.name === "TimeoutError";
      if (typeof detail.code === "string") codes.add(detail.code);
      if (detail.cause && typeof detail.cause === "object") queue.push(detail.cause);
      if (Array.isArray(detail.errors)) queue.push(...detail.errors.slice(0, 4));
    } catch { /* Unexpected error shapes retain the generic, secret-free message. */ }
  }
  if (codes.has("ENOTFOUND") || codes.has("EAI_AGAIN")) return "Phoenix could not resolve the platform's address (DNS lookup failed). Check access to the platform, then try again.";
  if (Array.from(codes).some(code => certificateCodes.has(code))) return "Phoenix could not verify the platform's TLS certificate. The secure connection was stopped.";
  if (codes.has("ECONNRESET")) return "The platform connection was reset before a response arrived. Check access to the platform, then try again.";
  if (codes.has("ECONNREFUSED")) return "The platform connection was refused before a response arrived. Check access to the platform, then try again.";
  if (timedOut || codes.has("ETIMEDOUT") || codes.has("UND_ERR_CONNECT_TIMEOUT") || codes.has("UND_ERR_HEADERS_TIMEOUT")) return "The platform connection timed out. Check access to the platform, then try again.";
  return "The platform did not respond. Check your internet connection, then try again.";
}

async function boundedProviderBody(response: Response) {
  const limit = 256 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderRequestError("The platform response was unexpectedly large. Phoenix stopped reading it; try checking the connection again.", "request");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > limit) {
          await reader.cancel().catch(() => undefined);
          throw new ProviderRequestError("The platform response was unexpectedly large. Phoenix stopped reading it; try checking the connection again.", "request");
        }
        chunks.push(next.value);
      }
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      throw new ProviderRequestError("The platform response was interrupted. Check your internet connection, then try again.", "network");
    } finally { reader.releaseLock(); }
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch { /* Do not expose malformed platform output or credentials. */ }
  if (!response.ok) return {};
  throw new ProviderRequestError("The platform returned an unreadable response. Try checking the connection again.", "request");
}

async function providerJson(url: string, init: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch (error) { throw new ProviderRequestError(providerNetworkMessage(error), "network"); }
  const data = await boundedProviderBody(response);
  if (!response.ok || data.error) {
    const reason = data.error?.errors?.[0]?.reason || data.error;
    if (reason === "invalid_client") throw new ProviderRequestError("The platform rejected the client ID or secret. Check the saved app credentials.", "configuration");
    if (reason === "invalid_grant" || response.status === 401 || Number(data.error?.code) === 190) throw new ProviderRequestError("The access token is invalid, expired, or revoked. Generate a new token for the correct app/account and reconnect.", "authorization");
    if (reason === "accessNotConfigured" || reason === "SERVICE_DISABLED") throw new ProviderRequestError("Enable YouTube Data API v3 in the Google project for this client.", "configuration");
    if (response.status === 429 || ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason) || [4, 17, 32, 613].includes(Number(data.error?.code))) throw new ProviderRequestError("The platform's API quota or rate limit was reached. Wait before checking this connection again; Phoenix has not uploaded anything.", "quota");
    if (response.status === 403 || [10, 200].includes(Number(data.error?.code))) throw new ProviderRequestError("The platform refused access. Check the token permissions, app role/test-user access, and authorized account assets.", "permission");
    throw new ProviderRequestError(`The platform rejected the request (HTTP ${response.status}). Check the account type, app settings, and token permissions.`, "request");
  }
  return data;
}

type ChannelIdentity = { id: string; name: string; profileUrl: string; loginType: ChannelLoginType; pageId?: string };
async function profile(platform: ChannelPlatform, accessToken: string, pageIdHint?: string): Promise<ChannelIdentity> {
  if (platform === "youtube") {
    const data = await providerJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
    const channel = data.items?.[0];
    if (!channel?.id || !channel.snippet?.title) throw new Error("This Google account has no accessible YouTube channel. Choose the account that owns your channel.");
    return { id: String(channel.id), name: String(channel.snippet.title), profileUrl: `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`, loginType: "youtube" };
  }
  // Instagram Login does not require a Facebook Page. A Facebook identity's
  // username must never be mistaken for a verified Instagram identity.
  const failures: { path: "instagram" | "facebook"; error: unknown }[] = [];
  const headers = { Authorization: `Bearer ${accessToken}` };
  const identity = (value: { id?: unknown; user_id?: unknown; username?: unknown } | undefined) => {
    const id = value?.user_id || value?.id;
    return id && typeof value?.username === "string" && value.username
      ? { id: String(id), name: `@${value.username}`, profileUrl: `https://www.instagram.com/${encodeURIComponent(value.username)}/` } : undefined;
  };
  const requestedPageId = normalizeInstagramPageId(pageIdHint);
  if (requestedPageId) {
    // A supplied Page selects the destination explicitly. Never silently switch
    // to an account discovered through /me or a different Page in /me/accounts.
    const page = await providerJson(`https://graph.facebook.com/v21.0/${requestedPageId}?fields=id,name,instagram_business_account{id,username}`, { headers });
    if (String(page.id || "") !== requestedPageId) throw new Error("Meta returned a different Facebook Page. Check the Page ID before connecting.");
    const account = page.instagram_business_account;
    if (!account || typeof account.id !== "string" || !/^\d{5,40}$/.test(account.id) || typeof account.username !== "string" || !/^[A-Za-z0-9._]{1,30}$/.test(account.username)) {
      throw new Error("The selected Facebook Page did not return a verified linked Instagram professional account. Check its Instagram connection and token permissions.");
    }
    const linked = identity(account)!;
    return { ...linked, loginType: "facebook", pageId: requestedPageId };
  }
  try {
    const direct = identity(await providerJson("https://graph.instagram.com/me?fields=user_id,username", { headers }));
    if (direct) return { ...direct, loginType: "instagram" };
  } catch (error) { failures.push({ path: "instagram", error }); }

  let accessibleFacebookProfile = false;
  try {
    const pages = await providerJson("https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account{id,username}", { headers });
    accessibleFacebookProfile = Array.isArray(pages.data);
    const candidates: ChannelIdentity[] = [];
    for (const page of Array.isArray(pages.data) ? pages.data : []) {
      const linked = identity(page.instagram_business_account);
      if (linked && page.id) candidates.push({ ...linked, loginType: "facebook", pageId: String(page.id) });
    }
    const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
    if (unique.length > 1) throw new Error("This token can access multiple Instagram accounts. Use a Page-specific token or an Instagram Login token for the account you want to connect.");
    if (unique.length === 1) return unique[0];
  } catch (error) {
    if (!(error instanceof ProviderRequestError)) throw error;
    failures.push({ path: "facebook", error });
  }
  try {
    const page = await providerJson("https://graph.facebook.com/v21.0/me?fields=id,instagram_business_account{id,username}", { headers });
    const linked = identity(page.instagram_business_account);
    if (linked && page.id) return { ...linked, loginType: "facebook", pageId: String(page.id) };
    if (page.id) accessibleFacebookProfile = true;
  } catch (error) { failures.push({ path: "facebook", error }); }

  if (accessibleFacebookProfile) throw new Error("The token was accepted, but no linked Instagram professional account was found. For Facebook Login, authorize the correct Facebook Page with pages_show_list, pages_read_engagement, and instagram_basic, and link its Creator or Business account. An Instagram Login token can connect directly without a Page.");
  // An access token from one API can be rejected by the other. Keep the matching
  // path's safe diagnosis instead of hiding all errors behind generic setup.
  const preferredPath = /^IG/i.test(accessToken) ? "instagram" : /^EAA/i.test(accessToken) ? "facebook" : undefined;
  const preferred = failures.filter((failure) => !preferredPath || failure.path === preferredPath);
  const diagnosed = preferred.find(({ error }) => error instanceof ProviderRequestError && error.kind !== "request") || preferred[0] || failures[0];
  if (diagnosed?.error instanceof ProviderRequestError) throw diagnosed.error;
  throw new Error("Instagram profile could not be verified. Use an Instagram Login token for a Creator/Business account, or a Facebook User/Page token authorized for its linked Instagram account.");
}

// Facebook's official SDK reads this edge and accepts only status=granted.
// A Page token may not expose User permissions; identity remains connected but
// publishing remains unavailable when its grant evidence cannot be verified.
type PublishingPermissions = Pick<Account, "grantedScopes" | "permissionsVerifiedAt" | "publishPermissionError">;
async function facebookPublishingPermissions(accessToken: string): Promise<PublishingPermissions> {
  try {
    const data = await providerJson("https://graph.facebook.com/v21.0/me/permissions?fields=permission,status", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!Array.isArray(data.data)) throw new Error("Publishing permission evidence is unavailable.");
    const grantedScopes = actualScopes(data.data.filter((item: { status?: unknown }) => item?.status === "granted").map((item: { permission?: unknown }) => item.permission));
    return { grantedScopes, permissionsVerifiedAt: new Date().toISOString(), publishPermissionError: undefined };
  } catch {
    return { grantedScopes: [] as string[], permissionsVerifiedAt: undefined, publishPermissionError: "Instagram identity verified, but publishing permissions could not be verified. Use a Facebook User token with instagram_basic, instagram_content_publish and pages_read_engagement, then check the connection." };
  }
}

export async function beginChannelOAuth(platform: ChannelPlatform, origin: string, intent: "identity" | "upload" = "identity") {
  return withVault(async (vault) => {
    const config = credentials(vault, platform);
    if (!config.clientId || !config.clientSecret) throw new Error("Set up this platform's app credentials first.");
    if (platform === "instagram" && intent === "upload") throw new Error("Local Instagram uploads require a publishing-capable Facebook Login token. Direct Instagram Login currently verifies identity only.");
    if (platform === "instagram" && !origin.startsWith("https://")) throw new Error("Instagram OAuth needs HTTPS. On this local site, connect using the Instagram access-token option instead.");
    const state = crypto.randomBytes(32).toString("base64url"), browser = crypto.randomBytes(32).toString("base64url"), verifier = crypto.randomBytes(32).toString("base64url");
    const redirectUri = `${origin}/api/channels/${platform}/callback`;
    vault.pending = (vault.pending || []).filter((item) => item.expiresAt > Date.now() && item.platform !== platform);
    vault.pending.push({ platform, stateHash: hash(state), browserHash: hash(browser), expiresAt: Date.now() + 10 * 60_000, redirectUri, verifier, intent });
    await writeVault(vault);
    const url = new URL(platform === "youtube" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://www.instagram.com/oauth/authorize");
    Object.entries({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", state,
      scope: platform === "youtube" ? [youtubeReadScope, ...(intent === "upload" ? [youtubeUploadScope] : [])].join(" ") : "instagram_business_basic",
      ...(platform === "youtube" ? { access_type: "offline", prompt: "consent select_account", code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" } : { enable_fb_login: "0", force_authentication: "1" }),
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return { url: url.toString(), browser };
  });
}

export async function finishChannelOAuth(platform: ChannelPlatform, origin: string, state: string, browser: string, code: string) {
  const pending = await withVault(async (vault) => {
    const match = vault.pending?.find((item) => item.platform === platform && item.mode !== "token" && !item.claimed && item.stateHash === hash(state) && item.browserHash === hash(browser) && item.expiresAt > Date.now() && item.redirectUri === `${origin}/api/channels/${platform}/callback`);
    if (!state || !browser || !match) throw new Error("The connection request expired or belongs to a different browser. Start Connect again.");
    // Claim once before contacting the provider, but keep the marker so that a
    // later Disconnect, new Connect or app-credential change cancels this flow.
    match.claimed = true;
    await writeVault(vault);
    return { ...match, config: credentials(vault, platform) };
  });
  const body = new URLSearchParams({ client_id: pending.config.clientId, client_secret: pending.config.clientSecret, redirect_uri: pending.redirectUri, grant_type: "authorization_code", code });
  if (platform === "youtube") body.set("code_verifier", pending.verifier);
  const token = await providerJson(platform === "youtube" ? "https://oauth2.googleapis.com/token" : "https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const data = token.data?.[0] || token;
  if (!data.access_token) throw new Error("The platform did not return an access token. Start Connect again.");
  const identity = await profile(platform, data.access_token);
  const permissions: PublishingPermissions = identity.loginType === "facebook" ? await facebookPublishingPermissions(data.access_token) : {};
  await withVault(async (vault) => {
    const current = vault.pending?.find((item) => item.platform === platform && item.claimed && item.stateHash === pending.stateHash && item.browserHash === pending.browserHash && item.expiresAt > Date.now());
    const config = credentials(vault, platform);
    if (!current || config.clientId !== pending.config.clientId || config.clientSecret !== pending.config.clientSecret) throw new Error("This connection request was cancelled or replaced. Start Connect again if you still want to connect.");
    vault.pending = vault.pending?.filter((item) => item !== current);
    const now = new Date().toISOString();
    vault.accounts = { ...vault.accounts, [platform]: { ...identity, ...permissions, accessToken: data.access_token, refreshToken: data.refresh_token,
      expiresAt: tokenExpiry(data.expires_in), connectedAt: now, verifiedAt: now, connectionRevision: crypto.randomUUID(),
      grantedScopes: identity.loginType === "facebook" ? permissions.grantedScopes : actualScopes(data.scope ?? data.permissions) } };
    await writeVault(vault);
  });
}

export async function connectInstagramToken(accessToken: string, pageIdHint?: string) {
  accessToken = normalizeInstagramToken(accessToken);
  const pageId = normalizeInstagramPageId(pageIdHint);
  const attempt: Pending = { platform: "instagram", mode: "token", stateHash: hash(crypto.randomUUID()), browserHash: "", expiresAt: Date.now() + 90_000, redirectUri: "", verifier: "", claimed: true };
  await withVault(async (vault) => {
    vault.pending = (vault.pending || []).filter((item) => item.platform !== "instagram" && item.expiresAt > Date.now());
    vault.pending.push(attempt);
    await writeVault(vault);
  });
  try {
    const identity = await profile("instagram", accessToken, pageId);
    const permissions: PublishingPermissions = identity.loginType === "facebook" ? await facebookPublishingPermissions(accessToken) : {};
    await withVault(async (vault) => {
      const current = vault.pending?.find((item) => item.platform === "instagram" && item.mode === "token" && item.stateHash === attempt.stateHash && item.expiresAt > Date.now());
      if (!current) throw new Error("This connection request was cancelled or replaced. Verify the token again if you still want to connect.");
      vault.pending = vault.pending?.filter((item) => item !== current);
      const now = new Date().toISOString();
      vault.accounts = { ...vault.accounts, instagram: { ...identity, ...permissions, accessToken, connectedAt: now, verifiedAt: now, connectionRevision: crypto.randomUUID() } };
      await writeVault(vault);
    });
  } catch (error) {
    await withVault(async (vault) => {
      if (!vault.pending?.some((item) => item.platform === "instagram" && item.mode === "token" && item.stateHash === attempt.stateHash)) return;
      vault.pending = vault.pending.filter((item) => item.stateHash !== attempt.stateHash);
      await writeVault(vault);
    });
    throw error;
  }
}

function tokenExpiry(value: unknown) {
  const seconds = Number(value);
  return Date.now() + (Number.isFinite(seconds) && seconds > 0 && seconds <= 366 * 24 * 3600 ? seconds : 3600) * 1000;
}

async function renewedYouTubeAccount(account: Account, config: Credentials): Promise<Account> {
  if (account.expiresAt && account.expiresAt >= Date.now() + 60_000) return account;
  if (!account.refreshToken) {
    if (account.expiresAt && account.expiresAt <= Date.now()) throw new Error("YouTube connection expired. Reconnect and enable uploads.");
    return account;
  }
  if (!config.clientId || !config.clientSecret) throw new Error("Set up this YouTube app's credentials before renewing its connection.");
  const data = await providerJson("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: account.refreshToken, grant_type: "refresh_token" }) });
  if (typeof data.access_token !== "string" || !data.access_token) throw new Error("Could not renew the YouTube connection. Reconnect the channel.");
  // An omitted refresh-response scope retains the original proven grant; it
  // never adds scopes to a legacy or identity-only connection.
  return { ...account, accessToken: data.access_token, expiresAt: tokenExpiry(data.expires_in),
    grantedScopes: data.scope === undefined ? account.grantedScopes : actualScopes(data.scope) };
}

export async function verifyChannel(platform: ChannelPlatform) {
  const vault = await readVault();
  let account = vault.accounts?.[platform];
  if (!account) throw new Error("Connect this channel first.");
  const original = account, config = credentials(vault, platform);
  try {
    if (platform === "youtube") account = await renewedYouTubeAccount(account, config);
    const identity = await profile(platform, account.accessToken, platform === "instagram" && account.loginType === "facebook" ? account.pageId : undefined);
    if (identity.id !== original.id) throw new Error("The connection now resolves to a different account. Reconnect and review the destination before uploading.");
    const permissions: PublishingPermissions = identity.loginType === "facebook" ? await facebookPublishingPermissions(account.accessToken) : {};
    const checked = { ...account, ...identity, ...permissions, error: undefined, verifiedAt: new Date().toISOString() };
    await withVault(async (latest) => {
      // A completed network check must never resurrect a disconnected account.
      const current = latest.accounts?.[platform], currentConfig = credentials(latest, platform);
      if (!current || revision(current) !== revision(original) || current.accessToken !== original.accessToken || currentConfig.clientId !== config.clientId || currentConfig.clientSecret !== config.clientSecret) return;
      latest.accounts![platform] = checked;
      await writeVault(latest);
    });
  } catch (error) {
    await withVault(async (latest) => {
      const current = latest.accounts?.[platform];
      if (!current || revision(current) !== revision(original) || current.accessToken !== original.accessToken) return;
      latest.accounts![platform] = { ...current, error: channelError(error) };
      await writeVault(latest);
    });
    throw error;
  }
}

/** Server-only credential access, invoked by an explicitly approved upload. */
export async function getChannelPublishAccess(platform: ChannelPlatform, expectedRevision?: string): Promise<ChannelPublishAccess> {
  const vault = await readVault(), original = vault.accounts?.[platform];
  if (!original) throw new Error("Connect this channel before uploading.");
  if (expectedRevision && revision(original) !== expectedRevision) throw new Error("The connected account changed. Review the upload destination again.");
  const capability = publishCapability(platform, original, true);
  if (!capability.publishReady) throw new Error(capability.publishReason);
  let account = original;
  if (platform === "youtube") {
    const config = credentials(vault, platform), renewed = await renewedYouTubeAccount(original, config);
    if (renewed !== original) {
      account = await withVault(async (latest) => {
        const current = latest.accounts?.[platform], currentConfig = credentials(latest, platform);
        if (!current || revision(current) !== revision(original) || current.id !== original.id || currentConfig.clientId !== config.clientId || currentConfig.clientSecret !== config.clientSecret) throw new Error("The connection changed while renewing access. Review the upload destination again.");
        if (current.accessToken !== original.accessToken) return current;
        latest.accounts![platform] = renewed;
        await writeVault(latest);
        return renewed;
      });
    }
  }
  const ready = publishCapability(platform, account);
  if (!ready.publishReady) throw new Error(ready.publishReason);
  const access: ChannelPublishAccess = { platform, accountId: account.id, name: account.name, connectionRevision: revision(account), accessToken: account.accessToken, loginType: account.loginType! };
  await assertChannelPublishAccessCurrent(access);
  return access;
}

/** No provider request: approvals cannot survive disconnect/replacement. */
export async function assertChannelPublishAccessCurrent(access: ChannelPublishAccess): Promise<void> {
  const current = (await readVault()).accounts?.[access.platform];
  if (!current || current.id !== access.accountId || revision(current) !== access.connectionRevision || current.loginType !== access.loginType || current.accessToken !== access.accessToken) throw new Error("The connected account changed or disconnected. Review the upload destination again.");
  const capability = publishCapability(access.platform, current);
  if (!capability.publishReady) throw new Error(capability.publishReason);
}

/** Private server-only HMAC for explicit optional location lookup; never return it through an API. */
export async function getInstagramLocationAppSecretProof(access: ChannelPublishAccess): Promise<string | null> {
  if (access.platform !== "instagram" || access.loginType !== "facebook") throw new Error("Instagram locations need the connected Facebook Login account.");
  const vault = await readVault(), current = vault.accounts?.instagram;
  if (!current || current.id !== access.accountId || revision(current) !== access.connectionRevision || current.loginType !== access.loginType
      || current.accessToken !== access.accessToken || !publishCapability("instagram", current).publishReady) {
    throw new Error("The connected Instagram account changed or disconnected.");
  }
  const secret = credentials(vault, "instagram").clientSecret.trim();
  return secret ? crypto.createHmac("sha256", secret).update(access.accessToken).digest("hex") : null;
}

type VaultVersion = { mtimeMs: number; ctimeMs: number; ino: number; dev: number; size: number };
async function channelVaultVersion(): Promise<VaultVersion> {
  try {
    const stats = await fs.stat(vaultPath());
    if (!stats.isFile()) throw new Error();
    return { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, ino: stats.ino, dev: stats.dev, size: stats.size };
  } catch { throw new Error("The channel settings are missing or unavailable. Uploading stopped; reconnect and review the destination again."); }
}
function sameVaultVersion(left: VaultVersion, right: VaultVersion) {
  return left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.ino === right.ino && left.dev === right.dev && left.size === right.size;
}

/** Check file metadata cheaply; unlock credentials only after a vault change. */
export async function createChannelPublishAccessMonitor(access: ChannelPublishAccess): Promise<() => Promise<void>> {
  // Capture before validation: a concurrent later mutation must be detected by
  // the next check, including one that happens during the credential read.
  let observed = await channelVaultVersion();
  await assertChannelPublishAccessCurrent(access);
  return async () => {
    const version = await channelVaultVersion();
    if (sameVaultVersion(observed, version)) return;
    await assertChannelPublishAccessCurrent(access);
    // Keep the version observed before validation so a still newer mutation
    // remains visible to the next check instead of being skipped.
    observed = version;
  };
}

function assertUploadJobId(jobId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error("Invalid upload job.");
}
function assertUploadSessionUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The platform returned an invalid upload session."); }
  if (value.length > 8192 || url.protocol !== "https:" || url.username || url.password || url.port || !["www.googleapis.com", "rupload.facebook.com"].includes(url.hostname)) throw new Error("The platform returned an invalid upload session.");
}
export async function getChannelUploadSession(jobId: string): Promise<string | null> {
  assertUploadJobId(jobId);
  const value = (await readVault()).uploadSessions?.[jobId];
  if (!value) return null;
  assertUploadSessionUrl(value);
  return value;
}
export async function saveChannelUploadSession(jobId: string, url: string | null): Promise<void> {
  assertUploadJobId(jobId);
  if (url !== null) assertUploadSessionUrl(url);
  await withVault(async (vault) => {
    vault.uploadSessions = { ...vault.uploadSessions };
    if (url === null) delete vault.uploadSessions[jobId]; else vault.uploadSessions[jobId] = url;
    await writeVault(vault);
  });
}

export async function disconnectChannel(platform: ChannelPlatform) {
  await withVault(async (vault) => {
    if (vault.accounts) delete vault.accounts[platform];
    vault.pending = vault.pending?.filter((item) => item.platform !== platform);
    await writeVault(vault);
  });
}

export function channelError(error: unknown) {
  return error instanceof Error && !/EN[OT]|ENOENT|SyntaxError|Unexpected token|fetch failed/.test(error.message)
    ? error.message : "Could not access the local channel settings. Try again or reconnect.";
}
