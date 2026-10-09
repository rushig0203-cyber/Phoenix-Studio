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
    if (new URL(url).pathname.endsWith("/permissions")) return Response.json({ data: [] });
    assert.match(new URL(url).pathname, /\/me\/accounts$/);
    return Response.json({ data: [{ id: "page-fixture", name: "A Facebook Page",
      instagram_business_account: { id: "real-ig-fixture", username: "linked_ig" } }] });
  };
  await channels.connectInstagramToken(fbToken);
  const status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
  assert.equal(status.name, "@linked_ig"); assert.equal(status.connected, true);
  assert.deepEqual(paths, ["/me", "/v21.0/me/accounts", "/v21.0/me/permissions"]);
  assert.equal(status.loginType, "facebook"); assert.equal(status.publishReady, false);
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

const fixturePageId = "1234567890123456";
const fixtureInstagramId = "17841400000000001";
const grantedFacebookPermissions = ["instagram_basic", "instagram_content_publish", "pages_read_engagement", "ads_read"];
const fixtureLinkedPage = () => ({ id: fixturePageId, name: "Fixture business Page",
  instagram_business_account: { id: fixtureInstagramId, username: "explicit_page_ig" } });
const fixturePermissionResponse = (permissions = grantedFacebookPermissions) => Response.json({
  data: permissions.map(permission => ({ permission, status: "granted" })),
});

test("optional Instagram hashtag access reads only a current verified Facebook basic grant without authorizing, publishing or changing the vault", async () => {
  // These fixtures are encrypted only inside PHOENIX_CHANNEL_STORAGE's test
  // directory. Preserve other test setup verbatim; never read an owner vault.
  const crypto = require("node:crypto"), filename = path.join(temporary, "private/channels.enc");
  const keyFile = filename + ".key";
  const oldVault = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
  const oldKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : null;
  const fixtureKey = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(keyFile, fixtureKey);
  const now = new Date().toISOString();
  const baseline = { accessToken: fbToken, id: fixtureInstagramId, name: "@fixture",
    profileUrl: "https://www.instagram.com/fixture/", connectedAt: now, verifiedAt: now,
    connectionRevision: "fixture-research-revision", loginType: "facebook", pageId: fixturePageId,
    grantedScopes: ["instagram_basic"], permissionsVerifiedAt: now, expiresAt: Date.now() + 3600000 };
  const writeFixture = account => {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", fixtureKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify({ accounts: account ? { instagram: account } : {} }), "utf8"), cipher.final()]);
    fs.writeFileSync(filename, JSON.stringify({ kind: "aes-256-gcm", iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }));
  };
  global.fetch = async () => assert.fail("Read-only research access cannot request permissions, renew a token or contact a provider");
  try {
    for (const [account, available] of [[baseline, true], [null, false],
      [{ ...baseline, grantedScopes: [] }, false], [{ ...baseline, permissionsVerifiedAt: undefined }, false],
      [{ ...baseline, expiresAt: Date.now() - 1000 }, false], [{ ...baseline, error: "Fixture authorization failure" }, false],
      [{ ...baseline, loginType: "instagram" }, false], [{ ...baseline, id: "not-a-verified-numeric-id" }, false],
      [{ ...baseline, accessToken: "" }, false]]) {
      writeFixture(account); const before = fs.readFileSync(filename);
      const access = await channels.getInstagramHashtagResearchAccess();
      assert.equal(Boolean(access), available); assert.deepEqual(fs.readFileSync(filename), before, "Reading access does not mutate the vault");
      if (available) {
        assert.equal(access.accountId, fixtureInstagramId); assert.equal(access.connectionRevision, "fixture-research-revision");
        assert.equal(access.accessToken, fbToken);
        const status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
        assert.equal(status.publishReady, false, "Research basic access must not fabricate upload permission");
        assert.ok(!JSON.stringify(status).includes(fbToken));
      } else assert.equal(access, null);
    }
  } finally {
    if (oldVault) fs.writeFileSync(filename, oldVault); else fs.rmSync(filename, { force: true });
    if (oldKey) fs.writeFileSync(keyFile, oldKey); else fs.rmSync(keyFile, { force: true });
  }
});

test("optional Page IDs reject URLs, commands, wrong types and out-of-bounds IDs before provider or vault activity", async () => {
  assert.equal(channels.normalizeInstagramPageId(undefined), undefined);
  assert.equal(channels.normalizeInstagramPageId("  " + fixturePageId + "  "), fixturePageId);
  const invalid = ["", "1234", "1".repeat(31), "x".repeat(65), 123456, null,
    "https://www.facebook.com/profile.php?id=" + fixturePageId, "page-name", fixturePageId + "/me", fixturePageId + "\n" + token];
  const vault = path.join(temporary, "private/channels.enc"), before = fs.existsSync(vault) ? fs.readFileSync(vault) : null;
  global.fetch = async () => assert.fail("Malformed Page IDs cannot contact a provider");
  for (const value of invalid) {
    assert.throws(() => channels.normalizeInstagramPageId(value), error => /numeric Facebook Page ID/.test(error.message) && !error.message.includes(token));
    const response = await route.POST(request("instagram", { action: "instagram-token", accessToken: fbToken, pageId: value }), context("instagram"));
    assert.equal(response.status, 400); assert.ok(!JSON.stringify(await response.json()).includes(fbToken));
  }
  assert.deepEqual(fs.existsSync(vault) ? fs.readFileSync(vault) : null, before, "Invalid selection cannot replace a connection or create a pending attempt");
});

test('optional location proof is a server-only HMAC of the current token, never a raw App Secret or a credential mutation', async () => {
  const crypto = require('node:crypto'), filename = path.join(temporary, 'private/channels.enc'), keyFile = filename + '.key';
  const oldVault = fs.existsSync(filename) ? fs.readFileSync(filename) : null, oldKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : null;
  const fixtureKey = crypto.randomBytes(32), secret = 'fixture-location-app-secret';
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(keyFile, fixtureKey);
  const timestamp = new Date().toISOString();
  const account = { accessToken: fbToken, id: fixtureInstagramId, name: '@fixture', profileUrl: 'https://www.instagram.com/fixture/',
    connectedAt: timestamp, verifiedAt: timestamp, connectionRevision: 'fixture-location-revision', loginType: 'facebook', pageId: fixturePageId,
    grantedScopes: grantedFacebookPermissions, permissionsVerifiedAt: timestamp, expiresAt: Date.now() + 3600000 };
  const writeFixture = (clientSecret, change = {}) => {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', fixtureKey, iv);
    const value = { accounts: { instagram: { ...account, ...change } }, credentials: { instagram: { clientId: 'fixture-app-id', clientSecret } } };
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    fs.writeFileSync(filename, JSON.stringify({ kind: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
  };
  global.fetch = async () => assert.fail('Proof generation must not contact Meta, renew the token or acquire permissions');
  try {
    writeFixture(secret); const access = await channels.getChannelPublishAccess('instagram', account.connectionRevision), before = fs.readFileSync(filename);
    const proof = await channels.getInstagramLocationAppSecretProof(access);
    assert.equal(proof, crypto.createHmac('sha256', secret).update(fbToken).digest('hex')); assert.match(proof, /^[a-f0-9]{64}$/);
    assert.ok(!proof.includes(secret)); assert.deepEqual(fs.readFileSync(filename), before);
    const publicStatus = JSON.stringify(await channels.listChannels('http://localhost:3000'));
    assert.ok(!publicStatus.includes(secret)); assert.ok(!publicStatus.includes(proof)); assert.ok(!publicStatus.includes(fbToken));
    writeFixture(''); assert.equal(await channels.getInstagramLocationAppSecretProof(access), null, 'No secret means no name-search proof, not a fabricated fallback credential');
    for (const change of [{ connectionRevision: 'replacement-revision' }, { accessToken: 'replacement-fixture-token' }, { id: 'changed-account' }, { grantedScopes: [] }]) {
      writeFixture(secret, change); await assert.rejects(channels.getInstagramLocationAppSecretProof(access), /changed or disconnected/);
    }
    await assert.rejects(channels.getInstagramLocationAppSecretProof({ ...access, platform: 'youtube' }), /Facebook Login/);
    await assert.rejects(channels.getInstagramLocationAppSecretProof({ ...access, loginType: 'instagram' }), /Facebook Login/);
  } finally {
    if (oldVault) fs.writeFileSync(filename, oldVault); else fs.rmSync(filename, { force: true });
    if (oldKey) fs.writeFileSync(keyFile, oldKey); else fs.rmSync(keyFile, { force: true });
  }
});

test('adding same-app metadata credentials retains a pasted Facebook connection, rotates approval revision and never grants scopes or contacts Meta', async () => {
  const crypto = require('node:crypto'), filename = path.join(temporary, 'private/channels.enc'), keyFile = filename + '.key';
  const oldVault = fs.existsSync(filename) ? fs.readFileSync(filename) : null, oldKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : null;
  const fixtureKey = crypto.randomBytes(32), timestamp = new Date().toISOString(), secret = 'fixture-first-metadata-secret';
  const account = { accessToken: fbToken, id: fixtureInstagramId, name: '@fixture', profileUrl: 'https://www.instagram.com/fixture/',
    connectedAt: timestamp, verifiedAt: timestamp, connectionRevision: 'fixture-before-metadata', loginType: 'facebook', pageId: fixturePageId,
    grantedScopes: grantedFacebookPermissions, permissionsVerifiedAt: timestamp, expiresAt: Date.now() + 3600000 };
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(keyFile, fixtureKey);
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', fixtureKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ accounts: { instagram: account } }), 'utf8'), cipher.final()]);
  fs.writeFileSync(filename, JSON.stringify({ kind: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
  global.fetch = async () => assert.fail('Local app setup must not contact Meta, renew tokens or acquire permissions');
  try {
    const before = (await channels.listChannels('http://localhost:3000')).find(item => item.platform === 'instagram');
    assert.equal(before.connected, true); assert.equal(before.configured, false); assert.equal(before.oauthAvailable, false);
    const oldAccess = await channels.getChannelPublishAccess('instagram', before.connectionRevision);
    const response = await route.POST(request('instagram', { action: 'configure', clientId: '1443393741188691', clientSecret: secret }), context('instagram'));
    assert.equal(response.status, 200);
    const body = await response.json(), current = body.channels.find(item => item.platform === 'instagram');
    assert.equal(current.connected, true); assert.equal(current.configured, true); assert.equal(current.publishReady, true);
    assert.equal(current.accountId, fixtureInstagramId); assert.equal(current.loginType, 'facebook');
    assert.notEqual(current.connectionRevision, before.connectionRevision);
    assert.ok(!JSON.stringify(body).includes(secret)); assert.ok(!JSON.stringify(body).includes(fbToken));
    await assert.rejects(channels.assertChannelPublishAccessCurrent(oldAccess), /changed or disconnected/);
    const currentAccess = await channels.getChannelPublishAccess('instagram', current.connectionRevision);
    assert.equal(await channels.getInstagramLocationAppSecretProof(currentAccess), crypto.createHmac('sha256', secret).update(fbToken).digest('hex'));
    assert.ok(!fs.readFileSync(filename, 'utf8').includes(secret)); assert.ok(!fs.readFileSync(filename, 'utf8').includes(fbToken));
    await assert.rejects(channels.saveChannelCredentials('instagram', 'different-configured-app', ''), /new app secret/);
    assert.equal((await channels.listChannels('http://localhost:3000')).find(item => item.platform === 'instagram').connected, true);
    await channels.saveChannelCredentials('instagram', 'different-configured-app', 'replacement-fixture-secret');
    assert.equal((await channels.listChannels('http://localhost:3000')).find(item => item.platform === 'instagram').connected, false, 'Replacing a configured app must still disconnect');
  } finally {
    if (oldVault) fs.writeFileSync(filename, oldVault); else fs.rmSync(filename, { force: true });
    if (oldKey) fs.writeFileSync(keyFile, oldKey); else fs.rmSync(keyFile, { force: true });
  }
});

test("an explicit Page selects its proven Instagram account even when Page listing is empty, with extra actual grants accepted", async () => {
  const calls = [];
  global.fetch = async (target, options) => {
    const url = new URL(target); calls.push(url.pathname);
    assert.equal(url.hostname, "graph.facebook.com");
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(options.headers.Authorization, "Bearer " + fbToken);
    assert.equal(options.redirect, "error"); assert.ok(options.signal);
    if (url.pathname === "/v21.0/" + fixturePageId) {
      assert.equal(url.searchParams.get("fields"), "id,name,instagram_business_account{id,username}");
      return Response.json(fixtureLinkedPage());
    }
    if (url.pathname === "/v21.0/me/permissions") return fixturePermissionResponse();
    if (url.pathname === "/v21.0/me/accounts") return Response.json({ data: [] });
    assert.fail("No direct Instagram identity or unrelated Page may be selected");
  };
  const response = await route.POST(request("instagram", { action: "instagram-token", accessToken: fbToken, pageId: " " + fixturePageId + " " }), context("instagram"));
  assert.equal(response.status, 200);
  const body = await response.json(), status = body.channels.find(channel => channel.platform === "instagram");
  assert.equal(status.accountId, fixtureInstagramId); assert.equal(status.pageId, fixturePageId);
  assert.equal(status.name, "@explicit_page_ig"); assert.equal(status.loginType, "facebook"); assert.equal(status.publishReady, true);
  assert.ok(!JSON.stringify(body).includes(fbToken));
  assert.deepEqual(calls, ["/v21.0/" + fixturePageId, "/v21.0/me/permissions"], "The selected Page takes precedence over listing and direct identity");
  global.fetch = async () => assert.fail("Saved capability does not need provider access");
  const access = await channels.getChannelPublishAccess("instagram", status.connectionRevision);
  assert.equal(access.accountId, fixtureInstagramId);
  await channels.disconnectChannel("instagram");
});

test("denied, unlinked, malformed or mismatched explicit Pages cannot fall back to another Instagram destination", async () => {
  const cases = [
    [() => failure(200), /token permissions, app role/],
    [() => Response.json({ id: fixturePageId, name: "Unlinked Page" }), /verified linked Instagram professional account/],
    [() => Response.json({ ...fixtureLinkedPage(), id: "9876543210987654" }), /different Facebook Page/],
    [() => Response.json({ id: fixturePageId, instagram_business_account: { id: "not-a-numeric-IG-id", username: "explicit_page_ig" } }), /verified linked Instagram professional account/],
    [() => Response.json({ id: fixturePageId, instagram_business_account: { id: fixtureInstagramId } }), /verified linked Instagram professional account/],
    [() => Response.json({ id: fixturePageId, instagram_business_account: { id: fixtureInstagramId, username: "https://untrusted.test/" } }), /verified linked Instagram professional account/],
  ];
  for (const [result, expected] of cases) {
    let calls = 0;
    global.fetch = async target => {
      calls++; assert.equal(String(target), "https://graph.facebook.com/v21.0/" + fixturePageId + "?fields=id,name,instagram_business_account{id,username}");
      return result();
    };
    const response = await route.POST(request("instagram", { action: "instagram-token", accessToken: fbToken, pageId: fixturePageId }), context("instagram"));
    assert.equal(response.status, 400);
    const body = await response.json(); assert.match(body.error, expected); assert.ok(!JSON.stringify(body).includes(token)); assert.ok(!JSON.stringify(body).includes(fbToken));
    assert.equal(calls, 1, "A rejected selection never discovers another account or checks its permissions");
    await rejectIfConnected();
  }
});

test("saved Facebook verification reuses the proven Page, retains actual extra grants, and cannot silently switch Instagram accounts", async () => {
  const calls = [], childProcess = require("node:child_process"), originalSpawn = childProcess.spawn;
  const savedFixtureAccounts = [];
  // Observe only writes of this isolated fixture vault, before test-only DPAPI
  // encryption. No owner vault, credential or production provider is accessed.
  childProcess.spawn = function(command, args, options) {
    const child = originalSpawn.call(this, command, args, options);
    if (command === "powershell.exe" && args.some(argument => String(argument).includes("::Protect("))) {
      const originalEnd = child.stdin.end;
      child.stdin.end = function(value, ...rest) {
        const fixture = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
        if (fixture.accounts?.instagram) savedFixtureAccounts.push(fixture.accounts.instagram);
        return originalEnd.call(this, value, ...rest);
      };
    }
    return child;
  };
  let differentAccount = false;
  global.fetch = async target => {
    const url = new URL(target); calls.push(url.pathname);
    assert.equal(url.hostname, "graph.facebook.com");
    if (url.pathname === "/v21.0/me/permissions") return fixturePermissionResponse();
    assert.equal(url.pathname, "/v21.0/" + fixturePageId, "Verification uses the saved Page, not /me or a listing");
    return Response.json({ ...fixtureLinkedPage(), ...(differentAccount ? {
      instagram_business_account: { id: "17841400000000002", username: "different_destination" },
    } : {}) });
  };
  try {
    await channels.connectInstagramToken(fbToken, fixturePageId);
    const initial = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
    const verified = await route.POST(request("instagram", { action: "verify" }), context("instagram"));
    assert.equal(verified.status, 200);
    const checked = (await verified.json()).channels.find(channel => channel.platform === "instagram");
    assert.equal(checked.pageId, fixturePageId); assert.equal(checked.accountId, fixtureInstagramId);
    assert.equal(checked.connectionRevision, initial.connectionRevision); assert.equal(checked.publishReady, true);
    if (process.platform === "win32") assert.deepEqual(savedFixtureAccounts.at(-1).grantedScopes, grantedFacebookPermissions);
    else {
      const crypto = require("node:crypto"), filename = path.join(temporary, "private/channels.enc");
      const envelope = JSON.parse(fs.readFileSync(filename, "utf8"));
      const decipher = crypto.createDecipheriv("aes-256-gcm", fs.readFileSync(filename + ".key"), Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const fixture = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
      assert.deepEqual(fixture.accounts.instagram.grantedScopes, grantedFacebookPermissions);
    }
    assert.deepEqual(calls, ["/v21.0/" + fixturePageId, "/v21.0/me/permissions", "/v21.0/" + fixturePageId, "/v21.0/me/permissions"]);
    calls.length = 0; differentAccount = true;
    await assert.rejects(channels.verifyChannel("instagram"), /different account/);
    const stopped = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
    assert.equal(stopped.accountId, fixtureInstagramId); assert.equal(stopped.pageId, fixturePageId); assert.equal(stopped.name, "@explicit_page_ig");
    assert.equal(stopped.publishReady, false); assert.match(stopped.error, /different account/);
    assert.deepEqual(calls, ["/v21.0/" + fixturePageId]);
  } finally {
    childProcess.spawn = originalSpawn;
    await channels.disconnectChannel("instagram");
  }
});

test("an explicit Page relationship alone cannot grant publishing capability", async () => {
  global.fetch = async target => new URL(target).pathname.endsWith("/permissions")
    ? fixturePermissionResponse(["instagram_basic", "ads_read"]) : Response.json(fixtureLinkedPage());
  await channels.connectInstagramToken(fbToken, fixturePageId);
  const status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
  assert.equal(status.connected, true); assert.equal(status.pageId, fixturePageId); assert.equal(status.publishReady, false);
  global.fetch = async () => assert.fail("Missing actual grants cannot trigger a provider request");
  await assert.rejects(channels.getChannelPublishAccess("instagram", status.connectionRevision), /publishing permission/);
  await channels.disconnectChannel("instagram");
});

test("saved direct Instagram Login verifies without a Facebook Page hint", async () => {
  let calls = 0;
  global.fetch = async target => {
    calls++; assert.equal(String(target), "https://graph.instagram.com/me?fields=user_id,username");
    return Response.json({ user_id: "direct-verify-fixture", username: "direct_verification" });
  };
  await channels.connectInstagramToken(token);
  await channels.verifyChannel("instagram");
  const status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
  assert.equal(status.connected, true); assert.equal(status.loginType, "instagram"); assert.equal(status.pageId, undefined);
  assert.equal(status.accountId, "direct-verify-fixture"); assert.equal(calls, 2);
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
    Response.json({ data: [{ id: "page-one", instagram_business_account: { id: "one", username: "one" } },
      { id: "page-two", instagram_business_account: { id: "two", username: "two" } }] });
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

test("timeout and DNS failures retain distinct, secret-free network diagnoses through fetch causes", async () => {
  const timeout = new Error("Private timeout details " + token); timeout.name = "TimeoutError";
  const cases = [[timeout, /connection timed out/]];
  for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
    const cause = Object.assign(new Error("Private resolver details " + token), { code });
    cases.push([new TypeError("fetch failed " + token, { cause: new AggregateError([cause], "Private aggregate " + token) }), /DNS lookup failed/]);
  }
  for (const [failure, expected] of cases) {
    global.fetch = async () => { throw failure; };
    await assert.rejects(channels.connectInstagramToken(token), error => error.kind === "network" && expected.test(error.message) && !error.message.includes(token));
  }
  await rejectIfConnected();
});

test("reset, refused and TLS certificate failures are distinguished without exposing private causes", async () => {
  for (const [code, expected] of [["ECONNRESET", /connection was reset/], ["ECONNREFUSED", /connection was refused/],
    ["CERT_HAS_EXPIRED", /TLS certificate/], ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", /TLS certificate/], ["ERR_TLS_CERT_ALTNAME_INVALID", /TLS certificate/]]) {
    const cause = Object.assign(new Error("Private transport endpoint and token " + token), { code });
    global.fetch = async () => { throw new TypeError("fetch failed " + token, { cause }); };
    await assert.rejects(channels.connectInstagramToken(token), error => error.kind === "network" && expected.test(error.message) && !error.message.includes(token) && !error.message.includes("Private"));
  }
  await rejectIfConnected();
});

test("unknown and cyclic network exceptions remain generic and redacted at the private-token route", async () => {
  const unknown = Object.assign(new Error("Unknown private network details " + token), { code: "PRIVATE_" + token });
  unknown.cause = unknown;
  global.fetch = async () => { throw unknown; };
  const response = await route.POST(request("instagram", { action: "instagram-token", accessToken: token }), context("instagram"));
  assert.equal(response.status, 400);
  const body = await response.json(); assert.match(body.error, /platform did not respond/);
  assert.ok(!JSON.stringify(body).includes(token)); assert.ok(!JSON.stringify(body).includes("PRIVATE_")); assert.ok(!JSON.stringify(body).includes("Unknown private"));
  await rejectIfConnected();
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

const uploadScope = "https://www.googleapis.com/auth/youtube.upload";
const readonlyScope = "https://www.googleapis.com/auth/youtube.readonly";
async function connectFixtureYouTube(scope, expiresIn = 3600) {
  await channels.saveChannelCredentials("youtube", "fixture-client.apps.googleusercontent.com", "fixture-client-secret-not-real");
  const started = await channels.beginChannelOAuth("youtube", "http://localhost:3000", "upload");
  global.fetch = async target => new URL(target).hostname === "oauth2.googleapis.com"
    ? Response.json({ access_token: "fixture-upload-access", refresh_token: "fixture-upload-refresh", expires_in: expiresIn,
      ...(scope === undefined ? {} : { scope }) })
    : Response.json({ items: [{ id: "fixture-upload-channel", snippet: { title: "Fixture upload destination" } }] });
  await channels.finishChannelOAuth("youtube", "http://localhost:3000", new URL(started.url).searchParams.get("state"), started.browser, "fixture-code");
  return (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube");
}

test("upload setup is explicit, retains identity scope and cannot be mistaken for a granted permission", async () => {
  const response = await route.POST(request("youtube", { action: "connect", intent: "upload" }), context("youtube"));
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).authorizationUrl);
  assert.deepEqual(url.searchParams.get("scope").split(" "), [readonlyScope, uploadScope]);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  for (const scope of [undefined, readonlyScope]) {
    const status = await connectFixtureYouTube(scope);
    assert.equal(status.connected, true); assert.equal(status.publishReady, false);
    assert.ok(status.accountId); assert.ok(status.connectionRevision);
    global.fetch = async () => assert.fail("Denied capability cannot refresh or contact a provider");
    await assert.rejects(channels.getChannelPublishAccess("youtube", status.connectionRevision), /Enable YouTube uploads/);
    await channels.disconnectChannel("youtube");
  }
});

test("approved YouTube access is server-only, revision bound, and cancelled by disconnect or new credentials", async () => {
  const status = await connectFixtureYouTube(`${readonlyScope} ${uploadScope}`);
  assert.equal(status.publishReady, true); assert.equal(status.loginType, "youtube");
  assert.ok(!JSON.stringify(status).includes("fixture-upload-access"));
  global.fetch = async () => assert.fail("Current access does not need a provider request");
  const access = await channels.getChannelPublishAccess("youtube", status.connectionRevision);
  assert.equal(access.accountId, status.accountId); assert.equal(access.accessToken, "fixture-upload-access");
  await channels.assertChannelPublishAccessCurrent(access);
  await assert.rejects(channels.getChannelPublishAccess("youtube", "wrong-revision"), /connected account changed/);
  await channels.saveChannelCredentials("youtube", "fixture-client.apps.googleusercontent.com", "fixture-replacement-secret-not-real");
  await assert.rejects(channels.assertChannelPublishAccessCurrent(access), /changed or disconnected/);
  await channels.disconnectChannel("youtube");
  await assert.rejects(channels.assertChannelPublishAccessCurrent(access), /changed or disconnected/);
});

test("YouTube upload renewal retains proven scopes but respects a provider's explicit narrower grant", async () => {
  for (const narrowed of [false, true]) {
    const status = await connectFixtureYouTube(`${readonlyScope} ${uploadScope}`, 1);
    let calls = 0;
    global.fetch = async (target, options) => {
      calls++; assert.equal(String(target), "https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "fixture-upload-refresh");
      return Response.json({ access_token: "fixture-renewed-upload-access", expires_in: 3600,
        ...(narrowed ? { scope: readonlyScope } : {}) });
    };
    if (narrowed) await assert.rejects(channels.getChannelPublishAccess("youtube", status.connectionRevision), /Enable YouTube uploads/);
    else {
      const access = await channels.getChannelPublishAccess("youtube", status.connectionRevision);
      assert.equal(access.accessToken, "fixture-renewed-upload-access");
      assert.equal(access.connectionRevision, status.connectionRevision);
    }
    assert.equal(calls, 1);
    await channels.disconnectChannel("youtube");
  }
});

test("disconnect during YouTube upload renewal cannot expose or resurrect the stale account", async () => {
  const status = await connectFixtureYouTube(`${readonlyScope} ${uploadScope}`, 1);
  let enteredRefresh, releaseRefresh;
  const entered = new Promise(resolve => { enteredRefresh = resolve; });
  const pending = new Promise(resolve => { releaseRefresh = resolve; });
  global.fetch = async () => { enteredRefresh(); return pending; };
  const access = channels.getChannelPublishAccess("youtube", status.connectionRevision);
  await entered; await channels.disconnectChannel("youtube");
  releaseRefresh(Response.json({ access_token: "fixture-stale-renewed-access", expires_in: 3600 }));
  await assert.rejects(access, /connection changed while renewing/);
  assert.equal((await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "youtube").connected, false);
});

test("direct Instagram identity is explicit and never enables unsupported local uploads", async () => {
  global.fetch = async () => Response.json({ user_id: "direct-fixture", username: "direct_identity" });
  await channels.connectInstagramToken(token);
  const status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
  assert.equal(status.connected, true); assert.equal(status.loginType, "instagram"); assert.equal(status.publishReady, false);
  assert.match(status.publishReason, /direct Instagram Login publishing is not enabled/);
  global.fetch = async () => assert.fail("Unsupported publishing cannot contact a provider");
  await assert.rejects(channels.getChannelPublishAccess("instagram", status.connectionRevision), /direct Instagram Login/);
  await assert.rejects(channels.beginChannelOAuth("instagram", "https://localhost:3000", "upload"), /Facebook Login token/);
  await channels.disconnectChannel("instagram");
});

test("Facebook local uploads require actual granted publish permissions, with credentials only in headers", async () => {
  for (const result of ["granted", "declined", "unavailable"]) {
    const calls = [];
    global.fetch = async (target, options) => {
      const url = new URL(target); calls.push(url.pathname);
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(options.headers.Authorization, `Bearer ${fbToken}`);
      if (url.hostname === "graph.instagram.com") return failure(190);
      if (url.pathname.endsWith("/permissions")) {
        assert.equal(url.searchParams.get("fields"), "permission,status");
        if (result === "unavailable") return failure(100);
        return Response.json({ data: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "instagram_content_publish", status: result },
        ] });
      }
      return Response.json({ data: [{ id: "publish-page", instagram_business_account: { id: "publish-ig", username: "publish_ig" } }] });
    };
    await channels.connectInstagramToken(fbToken);
    const status = (await channels.listChannels("http://localhost:3000")).find(channel => channel.platform === "instagram");
    assert.equal(status.connected, true); assert.equal(status.loginType, "facebook");
    assert.equal(status.publishReady, result === "granted");
    assert.ok(!JSON.stringify(status).includes(fbToken));
    assert.deepEqual(calls, ["/me", "/v21.0/me/accounts", "/v21.0/me/permissions"]);
    global.fetch = async () => assert.fail("Reading saved access and capability cannot contact Facebook");
    if (result === "granted") {
      const access = await channels.getChannelPublishAccess("instagram", status.connectionRevision);
      assert.equal(access.accountId, "publish-ig"); assert.equal(access.loginType, "facebook");
      await channels.assertChannelPublishAccessCurrent(access);
    } else await assert.rejects(channels.getChannelPublishAccess("instagram", status.connectionRevision), /publishing permission/);
    await channels.disconnectChannel("instagram");
  }
});

test("upload session capabilities stay encrypted, sanitized from public status, and validate host and job keys", async () => {
  const job = "57b7800a-4549-4f49-a8a8-415fab017767";
  const session = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=fixture-private-capability";
  await channels.saveChannelUploadSession(job, session);
  assert.equal(await channels.getChannelUploadSession(job), session);
  assert.ok(!fs.readFileSync(path.join(temporary, "private/channels.enc"), "utf8").includes("fixture-private-capability"));
  assert.ok(!JSON.stringify(await channels.listChannels("http://localhost:3000")).includes("fixture-private-capability"));
  for (const url of ["http://www.googleapis.com/upload", "https://attacker.test/upload", "https://secret@rupload.facebook.com/upload", "https://rupload.facebook.com:444/upload"]) {
    await assert.rejects(channels.saveChannelUploadSession(job, url), /invalid upload session/);
  }
  await assert.rejects(channels.saveChannelUploadSession("../../private", session), /Invalid upload job/);
  await channels.saveChannelUploadSession(job, null);
  assert.equal(await channels.getChannelUploadSession(job), null);
});

test("channel bodies are cancelled at the actual byte limit without Content-Length or with an understated length", async () => {
  const vault = path.join(temporary, "private/channels.enc"), before = fs.existsSync(vault) ? fs.readFileSync(vault) : null;
  global.fetch = async () => assert.fail("Oversized settings cannot contact a provider");
  for (const declaredLength of [undefined, "1"]) {
    let cancelled = false, pulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ action: "instagram-token", accessToken: token + "x".repeat(8500) })));
      },
      cancel() { cancelled = true; },
    });
    const oversized = new Request("http://localhost:3000/api/channels/instagram", {
      method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json",
        ...(declaredLength ? { "Content-Length": declaredLength } : {}) }, body, duplex: "half",
    });
    oversized.json = async () => assert.fail("Whole-body JSON parsing must not be used");
    const response = await route.POST(oversized, context("instagram"));
    assert.equal(response.status, 413); assert.equal(cancelled, true);
    assert.ok(pulls < 5, "Reading stops and cancels near the 16 KB cap");
    const value = await response.json();
    assert.equal(value.error, "Channel settings are too large."); assert.ok(!JSON.stringify(value).includes(token));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(fs.existsSync(vault) ? fs.readFileSync(vault) : null, before, "Oversized input cannot write to the credential vault");
  }
});

test("declared oversized channel settings cancel their unread body and leave the credential vault untouched", async () => {
  const vault = path.join(temporary, "private/channels.enc"), before = fs.existsSync(vault) ? fs.readFileSync(vault) : null;
  global.fetch = async () => assert.fail("Declared oversized input cannot contact a provider");
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const oversized = new Request("http://localhost:3000/api/channels/youtube", {
    method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json", "Content-Length": "16001" }, body, duplex: "half",
  });
  const response = await route.POST(oversized, context("youtube"));
  assert.equal(response.status, 413); assert.equal(cancelled, true);
  assert.equal((await response.json()).error, "Channel settings are too large.");
  assert.deepEqual(fs.existsSync(vault) ? fs.readFileSync(vault) : null, before);
});

test("upload monitor avoids credential reads and PowerShell until the vault changes, then revalidates access", async () => {
  const status = await connectFixtureYouTube(`${readonlyScope} ${uploadScope}`);
  global.fetch = async () => assert.fail("Monitoring saved permission cannot contact a provider");
  const access = await channels.getChannelPublishAccess("youtube", status.connectionRevision);
  const monitor = await channels.createChannelPublishAccessMonitor(access);
  const fsPromises = require("node:fs/promises"), childProcess = require("node:child_process");
  const originalRead = fsPromises.readFile, originalSpawn = childProcess.spawn;
  const vault = path.join(temporary, "private/channels.enc");
  let reads = 0, spawns = 0;
  fsPromises.readFile = function(filename, ...args) {
    if (String(filename) === vault) reads++;
    return originalRead.call(this, filename, ...args);
  };
  childProcess.spawn = function(...args) { spawns++; return originalSpawn.apply(this, args); };
  try {
    for (let index = 0; index < 3; index++) await monitor();
    assert.equal(reads, 0); assert.equal(spawns, 0, "Unchanged vault checks never start PowerShell");
    const job = "2113e7d2-b84e-4e94-b33e-759124060637";
    await channels.saveChannelUploadSession(job, "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=fixture-monitor-session");
    reads = 0; spawns = 0;
    await monitor();
    assert.equal(reads, 1, "A session write triggers a single permission revalidation");
    assert.equal(spawns, process.platform === "win32" ? 1 : 0);
    assert.equal(access.connectionRevision, status.connectionRevision, "Monitoring never changes the approved connection revision");
    reads = 0; spawns = 0;
    await monitor(); assert.equal(reads, 0); assert.equal(spawns, 0);
    await channels.disconnectChannel("youtube");
    reads = 0;
    await assert.rejects(monitor(), /changed or disconnected/);
    assert.equal(reads, 1);
  } finally {
    fsPromises.readFile = originalRead; childProcess.spawn = originalSpawn;
    await channels.disconnectChannel("youtube");
  }
});

test("a missing upload-monitor vault stops checks with a sanitized message before reading credentials", async () => {
  const status = await connectFixtureYouTube(`${readonlyScope} ${uploadScope}`);
  global.fetch = async () => assert.fail("Missing-vault monitoring cannot contact a provider");
  const access = await channels.getChannelPublishAccess("youtube", status.connectionRevision);
  const monitor = await channels.createChannelPublishAccessMonitor(access);
  const fsPromises = require("node:fs/promises"), originalStat = fsPromises.stat;
  const vault = path.join(temporary, "private/channels.enc");
  fsPromises.stat = async function(filename, ...args) {
    if (String(filename) === vault) throw Object.assign(new Error("Sensitive private path " + vault), { code: "ENOENT" });
    return originalStat.call(this, filename, ...args);
  };
  try {
    for (const action of [monitor, () => channels.createChannelPublishAccessMonitor(access)]) {
      await assert.rejects(action(), error => /channel settings are missing or unavailable/.test(error.message) && !error.message.includes(vault));
    }
  } finally { fsPromises.stat = originalStat; await channels.disconnectChannel("youtube"); }
});
