'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { test, beforeEach, after } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-facebook-channel-'));
process.env.PHOENIX_CHANNEL_STORAGE = path.join(temporary, 'private');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const channels = require('../src/lib/channelConnections.ts');
const route = require('../src/app/api/channels/[platform]/route.ts');
const realFetch = global.fetch, userToken = 'EAA_fixture_user_not_real_123456789', pageToken = 'EAA_fixture_page_not_real_987654321';
const longUserToken = 'EAA_fixture_long_user_not_real_135792468', lifetime = 60 * 24 * 3600;
for (const key of ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET']) delete process.env[key];
const pageId = '1234567890123456', instagramId = '17841400000000001';
const timestamp = new Date().toISOString();
const scopes = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
const instagram = { id: instagramId, name: '@fixture_ig', profileUrl: 'https://www.instagram.com/fixture_ig/', accessToken: userToken,
  loginType: 'facebook', pageId, grantedScopes: scopes, permissionsVerifiedAt: timestamp, connectedAt: timestamp,
  verifiedAt: timestamp, connectionRevision: 'fixture-instagram-revision' };
const vaultPath = path.join(temporary, 'private/channels.enc');
function fixture(account = instagram, facebook, app = { clientId: 'fixture-app-id', clientSecret: 'fixture-secret' }) {
  fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const vault = { credentials: { instagram: app },
    accounts: { ...(account ? { instagram: account } : {}), ...(facebook ? { facebook } : {}) } };
  const data = Buffer.concat([cipher.update(JSON.stringify(vault), 'utf8'), cipher.final()]);
  fs.writeFileSync(vaultPath + '.key', key);
  fs.writeFileSync(vaultPath, JSON.stringify({ kind: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
}
const status = async platform => (await channels.listChannels('http://localhost:3000')).find(channel => channel.platform === platform);
const context = platform => ({ params: Promise.resolve({ platform }) });
const request = (platform, body, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/channels/' + platform,
  { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function provider({ permissions = scopes, linkedId = instagramId, tasks = ['CREATE_CONTENT'], returnedPage = pageId, tokenPage = pageId, beforeIdentity,
  exchangePayload = { access_token: longUserToken, expires_in: lifetime }, exchangeError, initialUser = userToken, afterExchange } = {}) {
  const requests = []; let currentUser = initialUser;
  global.fetch = async (value, options) => {
    const url = new URL(value); requests.push(url.pathname);
    assert.equal(url.origin, 'https://graph.facebook.com');
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    if (url.pathname === '/v26.0/oauth/access_token') {
      assert.equal(requests.length, 5, 'The exact linked Page, scopes and content task must verify before token extension');
      assert.equal(url.searchParams.get('grant_type'), 'fb_exchange_token'); assert.equal(url.searchParams.get('fb_exchange_token'), userToken);
      assert.equal(url.searchParams.get('client_id'), 'fixture-app-id'); assert.equal(url.searchParams.get('client_secret'), 'fixture-secret');
      if (exchangeError) return Response.json({ error: exchangeError }, { status: 400 });
      currentUser = longUserToken; await afterExchange?.();
      return Response.json(exchangePayload);
    }
    const expected = url.pathname === '/v26.0/me' ? pageToken : currentUser;
    assert.equal(options.headers.Authorization, `Bearer ${expected}`);
    if (url.pathname === '/v26.0/me/permissions') return Response.json({ data: permissions.map(permission => ({ permission, status: 'granted' })) });
    if (url.pathname === '/v26.0/' + pageId) return Response.json({ id: pageId, name: 'Fixture Page', instagram_business_account: { id: linkedId } });
    if (url.pathname === '/v26.0/me/accounts') return Response.json({ data: [{ id: '9999999999999999', access_token: 'unrelated-fixture-token', tasks: ['CREATE_CONTENT'] },
      { id: returnedPage, access_token: pageToken, tasks }] });
    if (url.pathname === '/v26.0/me') {
      await beforeIdentity?.();
      return Response.json({ id: tokenPage, name: 'Fixture Page', instagram_business_account: { id: instagramId } });
    }
    assert.fail('Unexpected provider path');
  };
  return requests;
}
beforeEach(() => { fixture(); global.fetch = async () => assert.fail('Unexpected provider request'); });
after(() => {
  global.fetch = realFetch;
  assert.equal(fs.realpathSync(path.dirname(temporary)), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(temporary), /^phoenix-facebook-channel-/);
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('Facebook connects only the verified linked Page and stores its separate Page token privately', async () => {
  const before = await status('instagram'); const requests = provider();
  const response = await route.POST(request('facebook', { action: 'facebook-page' }), context('facebook'));
  assert.equal(response.status, 200);
  const body = await response.json(), facebook = body.channels.find(channel => channel.platform === 'facebook');
  assert.equal(facebook.accountId, pageId); assert.equal(facebook.pageId, pageId); assert.equal(facebook.instagramAccountId, instagramId);
  assert.equal(facebook.name, 'Fixture Page'); assert.equal(facebook.connected, true); assert.equal(facebook.publishReady, true); assert.equal(facebook.oauthAvailable, false);
  assert.deepEqual(await status('instagram'), before);
  assert.equal((await channels.getChannelPublishAccess('facebook', facebook.connectionRevision)).accessToken, pageToken);
  assert.equal((await channels.getChannelPublishAccess('instagram', before.connectionRevision)).accessToken, userToken);
  for (const secret of [userToken, longUserToken, pageToken, 'fixture-secret']) {
    assert.ok(!JSON.stringify(body).includes(secret)); assert.ok(!fs.readFileSync(vaultPath, 'utf8').includes(secret));
  }
  const validation = ['/v26.0/me/permissions', '/v26.0/' + pageId, '/v26.0/me/accounts', '/v26.0/me'];
  assert.deepEqual(requests, [...validation, '/v26.0/oauth/access_token', ...validation]);
});

test('a missing Page publishing grant stays blocked without affecting Instagram', async () => {
  const before = await status('instagram'); const requests = provider({ permissions: scopes.filter(scope => scope !== 'pages_manage_posts') });
  const response = await route.POST(request('facebook', { action: 'facebook-page', accessToken: 'Bearer ' + userToken }), context('facebook'));
  assert.equal(response.status, 400); assert.match((await response.json()).error, /pages_manage_posts/);
  assert.equal((await status('facebook')).connected, false); assert.deepEqual(await status('instagram'), before);
  assert.deepEqual(requests, ['/v26.0/me/permissions']);
});

test('rejected Facebook tokens retain an actionable diagnosis without touching Instagram', async () => {
  const before = await status('instagram');
  global.fetch = async () => Response.json({ error: { code: 190, message: 'Untrusted ' + userToken } }, { status: 400 });
  const response = await route.POST(request('facebook', { action: 'facebook-page' }), context('facebook'));
  assert.equal(response.status, 400);
  const body = await response.json(); assert.match(body.error, /invalid, expired, or revoked/);
  assert.ok(!JSON.stringify(body).includes(userToken));
  assert.equal((await status('facebook')).connected, false); assert.deepEqual(await status('instagram'), before);
});

test('Page identity, exact Instagram link and content task are independently required', async () => {
  for (const options of [{ linkedId: '17841400000000002' }, { tasks: ['ANALYZE'] }, { tasks: ['PROFILE_PLUS_FULL_CONTROL'] },
    { returnedPage: '9999999999999998' }, { tokenPage: '9999999999999997' }]) {
    fixture(); provider(options);
    await assert.rejects(channels.connectFacebookPage(), /linked|content|Page token/);
    assert.equal((await status('facebook')).connected, false); assert.equal((await status('instagram')).connected, true);
  }
  fixture(); provider({ tasks: ['PROFILE_PLUS_CREATE_CONTENT'] });
  await channels.connectFacebookPage(userToken); assert.equal((await status('facebook')).publishReady, true);
});

test('connection accepts no arbitrary Page choice, wrong workflow or cross-origin token submission', async () => {
  for (const [platform, body, origin] of [['facebook', { action: 'facebook-page', pageId: '9999999999999999' }],
    ['instagram', { action: 'facebook-page' }], ['youtube', { action: 'facebook-page' }],
    ['facebook', { action: 'facebook-page', accessToken: userToken + '\nprivate' }],
    ['facebook', { action: 'facebook-page' }, 'https://outside.example']]) {
    const response = await route.POST(request(platform, body, origin), context(platform));
    assert.equal(response.status, 400); assert.ok(!JSON.stringify(await response.json()).includes(userToken));
  }
  const before = fs.readFileSync(vaultPath);
  await assert.rejects(channels.beginChannelOAuth('facebook', 'http://localhost:3000', 'upload'), /linked Facebook Page/);
  await assert.rejects(channels.finishChannelOAuth('facebook', 'http://localhost:3000', '', '', ''), /linked-Page token flow/);
  assert.deepEqual(fs.readFileSync(vaultPath), before);
});

test('a Facebook connection cannot resurrect a changed or disconnected Instagram destination', async () => {
  provider({ beforeIdentity: () => channels.disconnectChannel('instagram') });
  await assert.rejects(channels.connectFacebookPage(), /cancelled|changed/);
  assert.equal((await status('facebook')).connected, false); assert.equal((await status('instagram')).connected, false);
});

test('disconnecting Facebook during verification cancels its pending connection', async () => {
  provider({ beforeIdentity: () => channels.disconnectChannel('facebook') });
  await assert.rejects(channels.connectFacebookPage(), /cancelled/);
  assert.equal((await status('facebook')).connected, false); assert.equal((await status('instagram')).connected, true);
});

test('Facebook access checks retain Page identity and stop after disconnect or grant loss', async () => {
  provider(); await channels.connectFacebookPage();
  const initial = await status('facebook'), access = await channels.getChannelPublishAccess('facebook', initial.connectionRevision);
  await channels.verifyChannel('facebook');
  assert.equal((await status('facebook')).connectionRevision, initial.connectionRevision);
  await channels.assertChannelPublishAccessCurrent(access);
  provider({ initialUser: longUserToken, permissions: scopes.filter(scope => scope !== 'pages_manage_posts') });
  await assert.rejects(channels.verifyChannel('facebook'), /pages_manage_posts/);
  assert.equal((await status('facebook')).publishReady, false);
  await assert.rejects(channels.getChannelPublishAccess('facebook'), /Check this connection/);
  assert.equal((await status('instagram')).publishReady, true);
  await channels.disconnectChannel('facebook');
  await assert.rejects(channels.assertChannelPublishAccessCurrent(access), /changed or disconnected/);
  assert.equal((await status('instagram')).publishReady, true);
});

test('cached Page identity alone never fabricates publishing capability', async () => {
  for (const extra of [{}, { permissionsVerifiedAt: timestamp }, { permissionsVerifiedAt: timestamp, grantedScopes: scopes },
    { permissionsVerifiedAt: timestamp, grantedScopes: scopes, pageTasks: ['ANALYZE'] }]) {
    fixture(instagram, { id: pageId, pageId, instagramAccountId: instagramId, name: 'Fixture Page', loginType: 'facebook', accessToken: pageToken,
      connectedAt: timestamp, verifiedAt: timestamp, ...extra });
    assert.equal((await status('facebook')).publishReady, false);
    await assert.rejects(channels.getChannelPublishAccess('facebook'), /Authorize pages_manage_posts/);
  }
});

test('Facebook records the actual extended User token lifetime and blocks access when it expires', async () => {
  const before = await status('instagram'), clock = Date.now, started = clock();
  provider({ exchangePayload: { access_token: longUserToken, expires_in: 7200 } });
  await channels.connectFacebookPage();
  const access = await channels.getChannelPublishAccess('facebook');
  try {
    Date.now = () => started + 7100 * 1000;
    assert.equal((await status('facebook')).publishReady, true);
    Date.now = () => started + 7300 * 1000;
    assert.equal((await status('facebook')).publishReady, false);
    assert.equal((await status('facebook')).state, 'needs_attention');
    await assert.rejects(channels.getChannelPublishAccess('facebook'), /expired/);
    await assert.rejects(channels.assertChannelPublishAccessCurrent(access), /expired/);
    assert.deepEqual(await status('instagram'), before);
  } finally { Date.now = clock; }
});

test('Facebook extension requires configured app credentials and an actual bounded expiry without changing Instagram', async () => {
  for (const app of [{ clientId: '', clientSecret: 'fixture-secret' }, { clientId: 'fixture-app-id', clientSecret: '' }]) {
    fixture(instagram, undefined, app); const before = fs.readFileSync(vaultPath), instagramBefore = await status('instagram');
    await assert.rejects(channels.connectFacebookPage(), /client ID and App Secret/);
    assert.deepEqual(fs.readFileSync(vaultPath), before); assert.deepEqual(await status('instagram'), instagramBefore);
  }
  for (const expires_in of [undefined, null, '5184000', 0, -1, 1.5, 60 * 24 * 3600 + 301, Number.MAX_SAFE_INTEGER]) {
    fixture(); const before = await status('instagram'), requests = provider({ exchangePayload: { access_token: longUserToken, expires_in } });
    await assert.rejects(channels.connectFacebookPage(), /verified Facebook token lifetime/);
    assert.equal(requests.length, 5); assert.equal((await status('facebook')).connected, false); assert.deepEqual(await status('instagram'), before);
  }
});

test('Facebook exchange errors and token failures remain secret-free and cannot save a connection', async () => {
  for (const options of [
    { exchangeError: { code: 190, message: 'Expired private ' + userToken } },
    { exchangeError: { code: 100, message: 'Wrong app private fixture-secret' } },
    { exchangePayload: { access_token: 'invalid token ' + longUserToken, expires_in: lifetime } },
  ]) {
    fixture(); const before = await status('instagram'); provider(options);
    const response = await route.POST(request('facebook', { action: 'facebook-page' }), context('facebook'));
    assert.equal(response.status, 400); const body = await response.json(); assert.match(body.error, /fresh|saved app/);
    for (const secret of [userToken, longUserToken, pageToken, 'fixture-secret']) assert.ok(!JSON.stringify(body).includes(secret));
    assert.equal((await status('facebook')).connected, false); assert.deepEqual(await status('instagram'), before);
  }
});

test('an app or linked-account change during Facebook extension cannot save stale credentials', async () => {
  for (const change of [() => channels.disconnectChannel('instagram'),
    () => channels.saveChannelCredentials('facebook', 'replacement-app-id', 'replacement-secret')]) {
    fixture(); provider({ afterExchange: change });
    await assert.rejects(channels.connectFacebookPage(), /cancelled|changed/);
    assert.equal((await status('facebook')).connected, false);
  }
});

test('legacy Facebook credentials without verified lifetime cannot upload indefinitely', async () => {
  fixture(instagram, { id: pageId, pageId, instagramAccountId: instagramId, name: 'Fixture Page', loginType: 'facebook', accessToken: pageToken,
    connectedAt: timestamp, verifiedAt: timestamp, permissionsVerifiedAt: timestamp, grantedScopes: scopes, pageTasks: ['CREATE_CONTENT'] });
  assert.equal((await status('facebook')).publishReady, false);
  await assert.rejects(channels.getChannelPublishAccess('facebook'), /verify its token lifetime/);
  assert.equal((await status('instagram')).publishReady, true);
});
