import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { withFileLock } from "./fileLock";

export type ChannelPlatform = "youtube" | "instagram";
type Credentials = { clientId: string; clientSecret: string };
type Account = {
  accessToken: string; refreshToken?: string; expiresAt?: number;
  id: string; name: string; profileUrl: string; connectedAt: string;
  verifiedAt: string; error?: string;
};
type Pending = { platform: ChannelPlatform; stateHash: string; browserHash: string; expiresAt: number; redirectUri: string; verifier: string; claimed?: boolean; mode?: "token" };
type Vault = { credentials?: Partial<Record<ChannelPlatform, Credentials>>; accounts?: Partial<Record<ChannelPlatform, Account>>; pending?: Pending[] };
export type ChannelStatus = {
  platform: ChannelPlatform; configured: boolean; connected: boolean;
  state: "not_connected" | "connected" | "needs_attention";
  name?: string; profileUrl?: string; verifiedAt?: string; error?: string;
  redirectUri: string; oauthAvailable: boolean; hasClientSecret: boolean; clientId: string;
};
const vaultPath = () => path.join(process.env.PHOENIX_CHANNEL_STORAGE || path.join(process.cwd(), "storage", "private"), "channels.enc");
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
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
  };
}
export async function listChannels(origin: string): Promise<ChannelStatus[]> {
  const vault = await readVault();
  return channelPlatforms.map((platform) => status(vault, platform, origin));
}

export async function saveChannelCredentials(platform: ChannelPlatform, clientId: string, clientSecret: string) {
  return withVault(async (vault) => {
    const old = credentials(vault, platform);
    if (!clientId.trim() || (!clientSecret.trim() && !old.clientSecret)) throw new Error("Enter the app client ID and secret from the platform developer console.");
    if (old.clientId && old.clientId !== clientId.trim() && !clientSecret.trim()) throw new Error("Enter the new app secret when changing the client ID.");
    vault.credentials = { ...vault.credentials, [platform]: { clientId: clientId.trim(), clientSecret: clientSecret.trim() || old.clientSecret } };
    if (old.clientId !== clientId.trim() && vault.accounts) delete vault.accounts[platform];
    vault.pending = vault.pending?.filter((item) => item.platform !== platform);
    await writeVault(vault);
  });
}

type ProviderFailureKind = "authorization" | "permission" | "configuration" | "quota" | "network" | "request";
class ProviderRequestError extends Error {
  constructor(message: string, readonly kind: ProviderFailureKind) { super(message); }
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
  catch { throw new ProviderRequestError("The platform did not respond. Check your internet connection, then try again.", "network"); }
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

async function profile(platform: ChannelPlatform, accessToken: string) {
  if (platform === "youtube") {
    const data = await providerJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
    const channel = data.items?.[0];
    if (!channel?.id || !channel.snippet?.title) throw new Error("This Google account has no accessible YouTube channel. Choose the account that owns your channel.");
    return { id: String(channel.id), name: String(channel.snippet.title), profileUrl: `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}` };
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
  try {
    const direct = identity(await providerJson("https://graph.instagram.com/me?fields=user_id,username", { headers }));
    if (direct) return direct;
  } catch (error) { failures.push({ path: "instagram", error }); }

  let accessibleFacebookProfile = false;
  try {
    const pages = await providerJson("https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account{id,username}", { headers });
    accessibleFacebookProfile = Array.isArray(pages.data);
    const candidates: { id: string; name: string; profileUrl: string }[] = [];
    for (const page of Array.isArray(pages.data) ? pages.data : []) {
      const linked = identity(page.instagram_business_account);
      if (linked) candidates.push(linked);
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
    if (linked) return linked;
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

export async function beginChannelOAuth(platform: ChannelPlatform, origin: string) {
  return withVault(async (vault) => {
    const config = credentials(vault, platform);
    if (!config.clientId || !config.clientSecret) throw new Error("Set up this platform's app credentials first.");
    if (platform === "instagram" && !origin.startsWith("https://")) throw new Error("Instagram OAuth needs HTTPS. On this local site, connect using the Instagram access-token option instead.");
    const state = crypto.randomBytes(32).toString("base64url"), browser = crypto.randomBytes(32).toString("base64url"), verifier = crypto.randomBytes(32).toString("base64url");
    const redirectUri = `${origin}/api/channels/${platform}/callback`;
    vault.pending = (vault.pending || []).filter((item) => item.expiresAt > Date.now() && item.platform !== platform);
    vault.pending.push({ platform, stateHash: hash(state), browserHash: hash(browser), expiresAt: Date.now() + 10 * 60_000, redirectUri, verifier });
    await writeVault(vault);
    const url = new URL(platform === "youtube" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://www.instagram.com/oauth/authorize");
    Object.entries({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", state,
      scope: platform === "youtube" ? "https://www.googleapis.com/auth/youtube.readonly" : "instagram_business_basic",
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
  await withVault(async (vault) => {
    const current = vault.pending?.find((item) => item.platform === platform && item.claimed && item.stateHash === pending.stateHash && item.browserHash === pending.browserHash && item.expiresAt > Date.now());
    const config = credentials(vault, platform);
    if (!current || config.clientId !== pending.config.clientId || config.clientSecret !== pending.config.clientSecret) throw new Error("This connection request was cancelled or replaced. Start Connect again if you still want to connect.");
    vault.pending = vault.pending?.filter((item) => item !== current);
    const now = new Date().toISOString();
    vault.accounts = { ...vault.accounts, [platform]: { ...identity, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000, connectedAt: now, verifiedAt: now } };
    await writeVault(vault);
  });
}

export async function connectInstagramToken(accessToken: string) {
  accessToken = normalizeInstagramToken(accessToken);
  const attempt: Pending = { platform: "instagram", mode: "token", stateHash: hash(crypto.randomUUID()), browserHash: "", expiresAt: Date.now() + 90_000, redirectUri: "", verifier: "", claimed: true };
  await withVault(async (vault) => {
    vault.pending = (vault.pending || []).filter((item) => item.platform !== "instagram" && item.expiresAt > Date.now());
    vault.pending.push(attempt);
    await writeVault(vault);
  });
  try {
    const identity = await profile("instagram", accessToken);
    await withVault(async (vault) => {
      const current = vault.pending?.find((item) => item.platform === "instagram" && item.mode === "token" && item.stateHash === attempt.stateHash && item.expiresAt > Date.now());
      if (!current) throw new Error("This connection request was cancelled or replaced. Verify the token again if you still want to connect.");
      vault.pending = vault.pending?.filter((item) => item !== current);
      const now = new Date().toISOString();
      vault.accounts = { ...vault.accounts, instagram: { ...identity, accessToken, connectedAt: now, verifiedAt: now } };
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

export async function verifyChannel(platform: ChannelPlatform) {
  const vault = await readVault();
  const account = vault.accounts?.[platform];
  if (!account) throw new Error("Connect this channel first.");
  try {
    if (platform === "youtube" && account.refreshToken && (!account.expiresAt || account.expiresAt < Date.now() + 60_000)) {
      const config = credentials(vault, platform);
      const data = await providerJson("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: account.refreshToken, grant_type: "refresh_token" }) });
      if (!data.access_token) throw new Error("Could not renew the YouTube connection. Reconnect the channel.");
      account.accessToken = data.access_token;
      account.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    }
    const identity = await profile(platform, account.accessToken);
    await withVault(async (latest) => {
      // A completed network check must never resurrect a disconnected account.
      if (latest.accounts?.[platform]?.connectedAt !== account.connectedAt) return;
      latest.accounts[platform] = { ...account, ...identity, error: undefined, verifiedAt: new Date().toISOString() };
      await writeVault(latest);
    });
  } catch (error) {
    await withVault(async (latest) => {
      if (latest.accounts?.[platform]?.connectedAt !== account.connectedAt) return;
      latest.accounts[platform] = { ...latest.accounts[platform]!, error: channelError(error) };
      await writeVault(latest);
    });
    throw error;
  }
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
