const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");

const project = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-channel-tests-"));
process.env.PHOENIX_CHANNEL_STORAGE = path.join(temporary, "private");
for (const key of ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"]) delete process.env[key];
require("ts-node").register({ project: path.join(project, "tsconfig.json"), transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" } });
require("tsconfig-paths").register({ baseUrl: project, paths: { "@/*": ["src/*"] } });
const channels = require("../src/lib/channelConnections.ts");
const route = require("../src/app/api/channels/[platform]/route.ts");
const callback = require("../src/app/api/channels/[platform]/callback/route.ts");
const { NextRequest } = require("next/server");
const realFetch = global.fetch;
const token = "IGAA_fixture_not_real_123456789";
const fbToken = "EAA_fixture_not_real_123456789";
const context = platform => ({ params: Promise.resolve({ platform }) });
const request = (platform, body, origin = "http://localhost:3000") => new Request(
  "http://localhost:3000/api/channels/" + platform,
  { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const failure = (code, status = 400, reason) => Response.json({
  error: { code, message: "Untrusted provider response containing " + token, ...(reason ? { errors: [{ reason }] } : {}) },
}, { status });
const rejectIfConnected = async () => assert.equal((await channels.listChannels("http://localhost:3000"))
  .find(channel => channel.platform === "instagram").connected, false);

after(() => {
  global.fetch = realFetch;
  const resolved = path.resolve(temporary);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(resolved).startsWith("phoenix-channel-tests-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});

test("raw, quoted, Bearer and Authorization-header token copies normalize identically", () => {
  for (const value of [token, "  " + token + "  ", '"' + token + '"', "'" + token + "'",
    "Bearer " + token, "bEaReR\t" + token, "Authorization: Bearer " + token,
    "'Authorization: Bearer " + token + "'", "Authorization: Bearer '" + token + "'"]) {
    assert.equal(channels.normalizeInstagramToken(value), token);
  }
  assert.equal(channels.normalizeInstagramToken("fixture-token_with.dot+slash/and=padding"), "fixture-token_with.dot+slash/and=padding");
});

test("commands, URLs, JSON, internal whitespace, unmatched quotes and oversized tokens are rejected without echoing them", () => {
  for (const value of ["", "short", "Bearer", "https://example.test/?access_token=" + token,
    '{"access_token":"' + token + '"}', "curl -H 'Authorization: Bearer " + token + "'",
    token + "\n" + token, "Bearer\\s" + token, "'" + token, "x".repeat(10001)]) {
    assert.throws(() => channels.normalizeInstagramToken(value), error =>
      /complete Instagram access token/.test(error.message) && !error.message.includes(token));
  }
});

test("token route accepts copied headers, sends credentials only as a header, and saves a verified identity privately", async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(new URL(url).hostname, "graph.instagram.com");
    assert.equal(new URL(url).searchParams.has("access_token"), false);
    assert.equal(options.headers.Authorization, "Bearer " + token);
    assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return Response.json({ user_id: "ig-fixture", username: "fixture_account" });
  };
  const response = await route.POST(request("instagram", { action: "instagram-token", accessToken: "Authorization: Bearer " + token }), context("instagram"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.channels.find(channel => channel.platform === "instagram").name, "@fixture_account");
  assert.equal(body.channels.find(channel => channel.platform === "instagram").connected, true);
  assert.ok(!JSON.stringify(body).includes(token));
  assert.ok(!fs.readFileSync(path.join(temporary, "private/channels.enc"), "utf8").includes(token));
  assert.equal(calls, 1, "Direct Instagram Login does not need a Facebook Page");
  await channels.disconnectChannel("instagram");
});

test("invalid token syntax and wrong-platform actions never contact a provider or leak the token", async () => {
  global.fetch = async () => assert.fail("No provider request is allowed");
  for (const [platform, value] of [["instagram", token + "\nsecret"], ["youtube", token]]) {
    const response = await route.POST(request(platform, { action: "instagram-token", accessToken: value }), context(platform));
    assert.equal(response.status, 400);
    assert.ok(!JSON.stringify(await response.json()).includes(token));
  }
  const blocked = await route.POST(request("instagram", { action: "instagram-token", accessToken: token }, "https://outside.example"), context("instagram"));
  assert.equal(blocked.status, 400);
});

test("Facebook User tokens connect only the Instagram account proven through a linked Page", async () => {
  const paths = [];
  global.fetch = async (url, options) => {
    paths.push(new URL(url).pathname);
    assert.equal(options.headers.Authorization, "Bearer " + fbToken);
    if (new URL(url).hostname === "graph.instagram.com") return failure(190);
    assert.match(new URL(url).pathname, /\/me\/accounts$/);
    return Response.json({ data: [{ id: "page-fixture", name: "A Facebook Page",
      instagram_business_account: { id: "real-ig-fixture", username: "linked_ig" } }] });
  };
  await channels.connectInstagramToken(fbToken);
  const status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
  assert.equal(status.name, "@linked_ig"); assert.equal(status.connected, true);
  assert.deepEqual(paths, ["/me", "/v21.0/me/accounts"]);
  await channels.disconnectChannel("instagram");
});

test("Facebook Page tokens use only their explicit Instagram business relationship", async () => {
  global.fetch = async url => {
    if (new URL(url).hostname === "graph.instagram.com") return failure(190);
    if (new URL(url).pathname.endsWith("/accounts")) return failure(100);
    return Response.json({ id: "page-fixture", instagram_business_account: { id: "page-ig-fixture", username: "page_linked_ig" } });
  };
  await channels.connectInstagramToken(fbToken);
  assert.equal((await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram").name, "@page_linked_ig");
  await channels.disconnectChannel("instagram");
});

test("a Facebook username without an explicit linked Instagram account is never marked connected", async () => {
  global.fetch = async url => {
    if (new URL(url).hostname === "graph.instagram.com") return failure(190);
    if (new URL(url).pathname.endsWith("/accounts")) return Response.json({ data: [] });
    assert.equal(new URL(url).searchParams.get("fields").includes("username,name"), false);
    return Response.json({ id: "facebook-user", username: "not_an_instagram_account" });
  };
  await assert.rejects(channels.connectInstagramToken(fbToken), /no linked Instagram professional account/);
  await rejectIfConnected();
});

test("multiple linked accounts are not silently connected to the first destination", async () => {
  global.fetch = async url => new URL(url).hostname === "graph.instagram.com" ? failure(190) :
    Response.json({ data: [{ instagram_business_account: { id: "one", username: "one" } },
      { instagram_business_account: { id: "two", username: "two" } }] });
  await assert.rejects(channels.connectInstagramToken(fbToken), /multiple Instagram accounts/);
  await rejectIfConnected();
});

test("expired Instagram tokens retain an actionable, secret-free diagnosis", async () => {
  global.fetch = async () => failure(190);
  const response = await route.POST(request("instagram", { action: "instagram-token", accessToken: token }), context("instagram"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /invalid, expired, or revoked/); assert.ok(!body.error.includes(token));
  await rejectIfConnected();
});

test("Facebook permissions, platform quotas and network failures remain distinguishable", async () => {
  global.fetch = async url => new URL(url).hostname === "graph.instagram.com" ? failure(190) : failure(200);
  await assert.rejects(channels.connectInstagramToken(fbToken), /token permissions, app role/);
  global.fetch = async () => failure(4);
  await assert.rejects(channels.connectInstagramToken(token), /quota or rate limit/);
  global.fetch = async () => { throw new Error("Network exception: " + token); };
  await assert.rejects(channels.connectInstagramToken(token), error => /did not respond/.test(error.message) && !error.message.includes(token));
});

test("provider response reads are bounded even when Content-Length is missing or misleading", async () => {
  let cancelled = 0, reads = 0;
  global.fetch = async () => new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(160000)); },
    cancel() { cancelled++; },
  }));
  await assert.rejects(channels.connectInstagramToken(token), /unexpectedly large/);
  assert.ok(cancelled > 0); assert.ok(reads < 15, "Every fallback must stop its stream near the cap");
  global.fetch = async () => new Response("{}", { headers: { "Content-Length": "99999999" } });
  await assert.rejects(channels.connectInstagramToken(token), /unexpectedly large/);
  global.fetch = async () => new Response("not valid JSON containing " + token);
  await assert.rejects(channels.connectInstagramToken(token), error => /unreadable response/.test(error.message) && !error.message.includes(token));
  await rejectIfConnected();
});

test("YouTube consent remains read-only, browser-bound and PKCE protected", async () => {
  await channels.saveChannelCredentials("youtube", "fixture-client.apps.googleusercontent.com", "fixture-client-secret-not-real");
  const started = await channels.beginChannelOAuth("youtube", "http://localhost:3000");
  const url = new URL(started.url);
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/youtube.readonly");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/channels/youtube/callback");
  assert.equal(url.searchParams.get("access_type"), "offline"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  let calls = 0;
  global.fetch = async () => { calls++; assert.fail("Unbound callback cannot contact Google"); };
  await assert.rejects(channels.finishChannelOAuth("youtube", "http://localhost:3000", url.searchParams.get("state"), "different-browser", "code"), /different browser/);
  assert.equal(calls, 0);
});

test("valid YouTube callback verifies the owning channel and expired access can be renewed on explicit Check connection", async () => {
  const started = await channels.beginChannelOAuth("youtube", "http://localhost:3000");
  const url = new URL(started.url);
  let calls = [], tokenPhase = "initial";
  global.fetch = async (target, options) => {
    calls.push(String(target));
    if (new URL(target).hostname === "oauth2.googleapis.com") {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("client_id"), "fixture-client.apps.googleusercontent.com");
      if (tokenPhase === "initial") {
        assert.equal(body.get("grant_type"), "authorization_code"); assert.ok(body.get("code_verifier"));
        return Response.json({ access_token: "fixture-youtube-access", refresh_token: "fixture-youtube-refresh", expires_in: 1 });
      }
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "fixture-youtube-refresh");
      return Response.json({ access_token: "fixture-youtube-renewed", expires_in: 3600 });
    }
    assert.equal(new URL(target).hostname, "www.googleapis.com");
    assert.equal(new URL(target).searchParams.get("mine"), "true");
    assert.equal(options.headers.Authorization, "Bearer " + (tokenPhase === "initial" ? "fixture-youtube-access" : "fixture-youtube-renewed"));
    return Response.json({ items: [{ id: "fixture-youtube-channel", snippet: { title: "Fixture channel" } }] });
  };
  const result = await callback.GET(new NextRequest(
    "http://localhost:3000/api/channels/youtube/callback?state=" + url.searchParams.get("state") + "&code=fixture-code",
    { headers: { cookie: "phoenix-channel-youtube=" + started.browser } }), context("youtube"));
  assert.equal(result.status, 303);
  assert.match(result.headers.get("location"), /channelConnected=youtube/);
  assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
  let status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube");
  assert.equal(status.name, "Fixture channel");
  tokenPhase = "renew"; await channels.verifyChannel("youtube");
  status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube");
  assert.equal(status.connected, true);
  assert.ok(!JSON.stringify(status).includes("fixture-youtube-renewed"));
  assert.equal(calls.length, 4);
  await channels.disconnectChannel("youtube");
});

test("YouTube API enablement, quota errors and empty ownership results are not misreported as paid-service setup", async () => {
  for (const [reason, pattern] of [["accessNotConfigured", /Enable YouTube Data API v3/],
    ["quotaExceeded", /quota or rate limit/], ["empty", /no accessible YouTube channel/]]) {
    const started = await channels.beginChannelOAuth("youtube", "http://localhost:3000");
    global.fetch = async target => new URL(target).hostname === "oauth2.googleapis.com"
      ? Response.json({ access_token: "fixture-youtube-access" })
      : reason === "empty" ? Response.json({ items: [] }) : failure(403, 403, reason);
    await assert.rejects(channels.finishChannelOAuth("youtube", "http://localhost:3000", new URL(started.url).searchParams.get("state"), started.browser, "code"), pattern);
    assert.equal((await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube").connected, false);
  }
});

test("Disconnect during a YouTube callback cannot resurrect the cancelled connection", async () => {
  const started = await channels.beginChannelOAuth("youtube", "http://localhost:3000");
  let releaseToken, enteredToken;
  const entered = new Promise(resolve => { enteredToken = resolve; });
  const tokenResponse = new Promise(resolve => { releaseToken = resolve; });
  global.fetch = async target => {
    if (new URL(target).hostname === "oauth2.googleapis.com") { enteredToken(); return tokenResponse; }
    return Response.json({ items: [{ id: "stale-channel", snippet: { title: "Must not reconnect" } }] });
  };
  const finishing = channels.finishChannelOAuth("youtube", "http://localhost:3000",
    new URL(started.url).searchParams.get("state"), started.browser, "fixture-code");
  await entered;
  await channels.disconnectChannel("youtube");
  releaseToken(Response.json({ access_token: "fixture-stale-access" }));
  await assert.rejects(finishing, /cancelled or replaced/);
  assert.equal((await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube").connected, false);
});

test("a claimed callback cannot be replayed while the original provider response is pending", async () => {
  const started = await channels.beginChannelOAuth("youtube", "http://localhost:3000");
  const state = new URL(started.url).searchParams.get("state");
  let releaseToken, enteredToken, calls = 0;
  const entered = new Promise(resolve => { enteredToken = resolve; });
  const tokenResponse = new Promise(resolve => { releaseToken = resolve; });
  global.fetch = async target => {
    calls++;
    if (new URL(target).hostname === "oauth2.googleapis.com") { enteredToken(); return tokenResponse; }
    return Response.json({ items: [{ id: "replay-protected", snippet: { title: "Valid original" } }] });
  };
  const finishing = channels.finishChannelOAuth("youtube", "http://localhost:3000", state, started.browser, "fixture-code");
  await entered;
  await assert.rejects(channels.finishChannelOAuth("youtube", "http://localhost:3000", state, started.browser, "fixture-code"), /different browser/);
  assert.equal(calls, 1);
  releaseToken(Response.json({ access_token: "fixture-original-access" }));
  await finishing;
  assert.equal(calls, 2);
  assert.equal((await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube").name, "Valid original");
  await channels.disconnectChannel("youtube");
});

test("changing app credentials invalidates a pending callback instead of saving an account for the old client", async () => {
  const started = await channels.beginChannelOAuth("youtube", "http://localhost:3000");
  let releaseToken, enteredToken;
  const entered = new Promise(resolve => { enteredToken = resolve; });
  const tokenResponse = new Promise(resolve => { releaseToken = resolve; });
  global.fetch = async target => {
    if (new URL(target).hostname === "oauth2.googleapis.com") { enteredToken(); return tokenResponse; }
    return Response.json({ items: [{ id: "wrong-client", snippet: { title: "Old client channel" } }] });
  };
  const finishing = channels.finishChannelOAuth("youtube", "http://localhost:3000", new URL(started.url).searchParams.get("state"), started.browser, "fixture-code");
  await entered;
  await channels.saveChannelCredentials("youtube", "new-fixture.apps.googleusercontent.com", "new-fixture-secret-not-real");
  releaseToken(Response.json({ access_token: "fixture-old-client-access" }));
  await assert.rejects(finishing, /cancelled or replaced/);
  const current = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube");
  assert.equal(current.clientId, "new-fixture.apps.googleusercontent.com"); assert.equal(current.connected, false);
});

test("Disconnect during pasted-token verification cannot reconnect the account when its provider response arrives", async () => {
  let releaseProfile, enteredProfile;
  const entered = new Promise(resolve => { enteredProfile = resolve; });
  const profileResponse = new Promise(resolve => { releaseProfile = resolve; });
  global.fetch = async url => { assert.equal(new URL(url).hostname, "graph.instagram.com"); enteredProfile(); return profileResponse; };
  const connecting = channels.connectInstagramToken(token);
  await entered;
  await channels.disconnectChannel("instagram");
  releaseProfile(Response.json({ user_id: "cancelled-profile", username: "must_not_reconnect" }));
  await assert.rejects(connecting, /cancelled or replaced/);
  await rejectIfConnected();
});

test("a newer Instagram token verification wins over an older, delayed provider response", async () => {
  let releaseProfile, enteredProfile, count = 0;
  const entered = new Promise(resolve => { enteredProfile = resolve; });
  const profileResponse = new Promise(resolve => { releaseProfile = resolve; });
  global.fetch = async () => {
    count++;
    if (count === 1) { enteredProfile(); return profileResponse; }
    return Response.json({ user_id: "newer-profile", username: "chosen_latest" });
  };
  const older = channels.connectInstagramToken(token);
  await entered;
  await channels.connectInstagramToken("IGAA_fixture_newer_not_real_123456789");
  releaseProfile(Response.json({ user_id: "older-profile", username: "not_the_latest" }));
  await assert.rejects(older, /cancelled or replaced/);
  assert.equal((await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram").name, "@chosen_latest");
  await channels.disconnectChannel("instagram");
});

test("starting a newer Instagram OAuth flow cancels an older pasted-token connection", async () => {
  await channels.saveChannelCredentials("instagram", "fixture-instagram-app", "fixture-instagram-app-secret");
  let releaseProfile, enteredProfile;
  const entered = new Promise(resolve => { enteredProfile = resolve; });
  const profileResponse = new Promise(resolve => { releaseProfile = resolve; });
  global.fetch = async () => { enteredProfile(); return profileResponse; };
  const older = channels.connectInstagramToken(token);
  await entered;
  const newer = await channels.beginChannelOAuth("instagram", "https://localhost:3000");
  assert.equal(new URL(newer.url).searchParams.get("scope"), "instagram_business_basic");
  releaseProfile(Response.json({ user_id: "older-token-profile", username: "not_authorized_latest" }));
  await assert.rejects(older, /cancelled or replaced/);
  await rejectIfConnected();
  await channels.disconnectChannel("instagram");
});
