const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-facebook-performance-'));
const previousCwd = process.cwd();
const previousStorage = process.env.PHOENIX_FACEBOOK_PERFORMANCE_STORAGE;
const previousPublications = process.env.PHOENIX_PUBLISH_STORAGE;
process.env.PHOENIX_FACEBOOK_PERFORMANCE_STORAGE = temporary;
process.env.PHOENIX_PUBLISH_STORAGE = path.join(temporary, 'publications');
process.chdir(temporary);
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const channels = require('../src/lib/channelConnections');
const previous = { fetch: global.fetch, access: channels.getChannelPublishAccess, monitor: channels.createChannelPublishAccessMonitor };
const collector = require('../src/lib/facebookPerformance');
const route = require('../src/app/api/facebook-performance/route');
const file = path.join(temporary, 'facebook-performance.json');
const account = { platform: 'facebook', loginType: 'facebook', accountId: '1390878777432770', name: 'Fixture Page', connectionRevision: 'fixture-facebook-revision', accessToken: 'fixture-facebook-token-not-real' };
let connected, calls, fetcher, accessCalls;
const video = (id = '100000000000001', extra = {}) => ({ id, title: 'Waterfall', description: 'Water flowing over rocks.', created_time: '2026-11-08T08:00:00+0000', permalink_url: `https://www.facebook.com/reel/${id}/`, views: 0,
  likes: { data: [], summary: { total_count: 0 } }, comments: { data: [], summary: { total_count: 0 } }, ...extra });
const metric = (id, value = 0, extra = {}) => ({ name: 'fb_reels_total_plays', period: 'lifetime', values: [{ value }], id: `${id}/video_insights/fb_reels_total_plays/lifetime`, ...extra });
const insight = (url, value = 0, extra = {}) => Response.json({ data: [metric(url.pathname.split('/')[2], value, extra)] });
const isInsights = url => url.pathname.endsWith('/video_insights');
const listed = rows => url => isInsights(url) ? insight(url) : Response.json({ data: rows });
function expire() { const saved = JSON.parse(fs.readFileSync(file)); saved.nextRefreshAt = new Date(0).toISOString(); fs.writeFileSync(file, JSON.stringify(saved)); }
const post = (input, headers = {}, url = 'http://localhost:3000/api/facebook-performance') => new Request(url, { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers }, body: typeof input === 'string' ? input : JSON.stringify(input) });
beforeEach(() => {
  for (const entry of fs.readdirSync(temporary)) fs.rmSync(path.join(temporary, entry), { recursive: true, force: true });
  connected = { ...account }; calls = []; accessCalls = []; fetcher = listed([video()]);
  channels.getChannelPublishAccess = async platform => { accessCalls.push(platform); if (connected instanceof Error) throw connected; if (!connected) throw new Error('Fixture disconnected'); return { ...connected }; };
  channels.createChannelPublishAccessMonitor = async captured => async () => {
    if (!connected || connected instanceof Error || connected.accountId !== captured.accountId || connected.connectionRevision !== captured.connectionRevision || connected.accessToken !== captured.accessToken) throw new Error('Fixture revoked');
  };
  global.fetch = async (target, init) => { const url = new URL(target); calls.push({ url: url.href, init }); return fetcher(url, init); };
});
after(() => {
  channels.getChannelPublishAccess = previous.access; channels.createChannelPublishAccessMonitor = previous.monitor; global.fetch = previous.fetch;
  if (previousStorage === undefined) delete process.env.PHOENIX_FACEBOOK_PERFORMANCE_STORAGE; else process.env.PHOENIX_FACEBOOK_PERFORMANCE_STORAGE = previousStorage;
  if (previousPublications === undefined) delete process.env.PHOENIX_PUBLISH_STORAGE; else process.env.PHOENIX_PUBLISH_STORAGE = previousPublications;
  process.chdir(previousCwd);
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.match(path.basename(temporary), /^phoenix-facebook-performance-/);
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('GET is cache-only; explicit refresh measures documented total Reel plays including true zero', async () => {
  const empty = await collector.readFacebookPerformance(); assert.equal(empty.videos.length, 0); assert.equal(calls.length, 0);
  const response = await route.POST(post({ action: 'refresh' })); assert.equal(response.status, 200);
  const state = await response.json(); assert.equal(state.status, 'ready'); assert.equal(state.account.name, account.name);
  assert.deepEqual(state.videos[0].metrics, { views: 0, likes: 0, comments: 0, shares: null, averageWatchTimeMs: null });
  assert.ok(state.lastSuccessfulSyncAt); assert.ok(state.videos[0].metricsUpdatedAt); assert.equal(state.viewsMetric, 'fb_reels_total_plays'); assert.equal(calls.length, 2);
  const requested = new URL(calls[0].url);
  assert.equal(requested.origin, 'https://graph.facebook.com'); assert.equal(requested.pathname, `/v26.0/${account.accountId}/video_reels`);
  assert.equal(requested.searchParams.get('limit'), '25');
  assert.equal(requested.searchParams.get('fields'), 'id,title,description,created_time,permalink_url,likes.limit(0).summary(true),comments.limit(0).summary(true)');
  const plays = new URL(calls[1].url);
  assert.equal(plays.pathname, '/v26.0/100000000000001/video_insights'); assert.equal(plays.searchParams.get('metric'), 'fb_reels_total_plays'); assert.equal(plays.searchParams.get('period'), 'lifetime');
  assert.match(state.detail, /include replays/i);
  assert.ok(!requested.searchParams.has('access_token')); assert.equal(calls[0].init.headers.Authorization, `Bearer ${account.accessToken}`);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store');
  assert.equal((await route.GET(new Request('http://localhost:3000/api/facebook-performance'))).status, 200);
  await collector.syncFacebookPerformance(); assert.equal(calls.length, 2, 'Success cooldown prevents repeated refreshes');
  assert.ok(accessCalls.every(platform => platform === 'facebook'));
  assert.doesNotMatch(JSON.stringify(state), /fixture-facebook-token|connectionRevision|lease|read_insights/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /fixture-facebook-token-not-real/);
});

test('missing or invalid counters stay unknown while actual returned shares are retained', async () => {
  fetcher = url => isInsights(url) ? url.pathname.includes('100000000000002') ? insight(url, '12') : Response.json({ data: [] })
    : Response.json({ data: [video(undefined, { views: 777, likes: {}, comments: { summary: { total_count: -1 } } }), video('100000000000002', { views: 0, likes: { summary: { total_count: '2' } }, shares: { count: 3 } })] });
  const state = await collector.syncFacebookPerformance(); assert.equal(state.status, 'limited');
  assert.deepEqual(state.videos[0].metrics, { views: null, likes: null, comments: null, shares: null, averageWatchTimeMs: null });
  assert.deepEqual(state.videos[1].metrics, { views: 12, likes: 2, comments: 0, shares: 3, averageWatchTimeMs: null });
  assert.equal((await collector.readFacebookPerformance()).videos[0].metrics.views, null);
});

test('provider links cannot escape Facebook, expose credentials or trigger pagination fetches', async () => {
  fetcher = url => isInsights(url) ? insight(url) : Response.json({ data: [video(undefined, { permalink_url: 'https://evil.example/reel/100000000000001', description: `private ${account.accessToken}` }), video('100000000000002', { permalink_url: 'https://www.facebook.com.evil.example/reel/100000000000002' }), video('100000000000003', { permalink_url: 'https://www.facebook.com/watch/?v=100000000000003&tracking=private' })], paging: { next: `https://evil.example/?access_token=${account.accessToken}` } });
  const state = await collector.syncFacebookPerformance(); assert.equal(calls.length, 4); assert.equal(state.status, 'limited');
  assert.ok(calls.every(call => new URL(call.url).origin === 'https://graph.facebook.com'));
  assert.equal(state.videos[0].caption, ''); assert.equal(state.videos[0].permalink, undefined); assert.equal(state.videos[1].permalink, undefined);
  assert.equal(state.videos[2].permalink, 'https://www.facebook.com/watch/?v=100000000000003');
  assert.doesNotMatch(JSON.stringify(state), /evil|tracking|fixture-facebook-token/); assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /evil|fixture-facebook-token/);
});

test('an unavailable or different Page never receives cached Facebook figures or Instagram access', async () => {
  await collector.syncFacebookPerformance(); connected = null;
  assert.equal((await collector.readFacebookPerformance()).status, 'not_connected'); assert.equal((await collector.syncFacebookPerformance()).videos.length, 0); assert.equal(calls.length, 2);
  connected = { ...account, accountId: '200000000000001', connectionRevision: 'different-page' };
  assert.equal((await collector.readFacebookPerformance()).videos.length, 0); assert.equal(calls.length, 2);
  connected = { ...account, platform: 'instagram' };
  assert.equal((await collector.syncFacebookPerformance()).status, 'not_connected'); assert.equal(calls.length, 2);
});

test('revocation or account revision changes during collection discard late statistics', async () => {
  for (const change of [() => { connected = null; }, () => { connected = { ...account, connectionRevision: 'replaced-revision' }; }]) {
    if (fs.existsSync(file)) fs.rmSync(file); connected = { ...account };
    fetcher = () => { change(); return Response.json({ data: [video()] }); };
    const state = await collector.syncFacebookPerformance(); assert.equal(state.status, 'not_connected'); assert.equal(state.videos.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(file)).videos.length, 0, 'Late provider result was not committed');
  }
});

test('permission failures keep same-Page cached figures and never expose provider error text', async () => {
  await collector.syncFacebookPerformance(); expire();
  fetcher = () => Response.json({ error: { code: 200, message: `SECRET ${account.accessToken}` } }, { status: 403 });
  const state = await collector.syncFacebookPerformance(); assert.equal(state.status, 'permission_required'); assert.equal(state.videos.length, 1);
  assert.ok(state.lastSuccessfulSyncAt); assert.doesNotMatch(state.detail, /SECRET|fixture-facebook-token/);
  assert.equal(state.videos[0].metrics.views, 0);
  await collector.syncFacebookPerformance(); assert.equal(calls.length, 3, 'Permission failure backoff cannot be bypassed by another click');
});

test('rate limiting applies durable bounded backoff even for an unreadable provider error body', async () => {
  fetcher = () => new Response('not JSON', { status: 429, headers: { 'retry-after': '120' } });
  const state = await collector.syncFacebookPerformance(); assert.equal(state.status, 'rate_limited'); assert.equal(calls.length, 1);
  assert.ok(Date.parse(JSON.parse(fs.readFileSync(file)).nextRefreshAt) >= Date.now() + 119_000);
  await collector.syncFacebookPerformance(); await collector.readFacebookPerformance(); assert.equal(calls.length, 1);
});

test('concurrent refreshes share one collection rather than duplicate provider requests', async () => {
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  fetcher = url => isInsights(url) ? insight(url) : new Promise(resolve => { finish = resolve; entered(); });
  const first = collector.syncFacebookPerformance(); await started;
  const second = await collector.syncFacebookPerformance(); assert.equal(second.status, 'syncing'); assert.equal(calls.length, 1);
  finish(Response.json({ data: [video()] })); assert.equal((await first).status, 'ready'); assert.equal(calls.length, 2);
});

test('oversized provider data and more than 25 rows cannot enter the saved cache', async () => {
  for (const payload of [{ data: [video(undefined, { description: 'x'.repeat(1024 * 1024 + 20) })] }, { data: Array.from({ length: 26 }, (_, at) => video(String(100000000000000 + at))) }]) {
    if (fs.existsSync(file)) fs.rmSync(file);
    fetcher = () => Response.json(payload); const state = await collector.syncFacebookPerformance();
    assert.equal(state.status, 'error'); assert.equal(state.videos.length, 0); assert.equal(JSON.parse(fs.readFileSync(file)).videos.length, 0);
  }
});

test('unreadable or oversized local cache stays untouched and does not trigger a provider request', async () => {
  fs.writeFileSync(file, 'x'.repeat(128 * 1024 + 1));
  assert.equal((await collector.readFacebookPerformance()).status, 'error'); assert.equal((await collector.syncFacebookPerformance()).status, 'error');
  assert.equal(calls.length, 0); assert.equal(fs.statSync(file).size, 128 * 1024 + 1);
});

test('legacy general-video views remain unverified without rewriting the saved cache', async () => {
  await collector.syncFacebookPerformance();
  const saved = JSON.parse(fs.readFileSync(file)); delete saved.viewsMetric;
  saved.videos[0].metrics.views = 940; saved.videos[0].metrics.likes = 8;
  fs.writeFileSync(file, JSON.stringify(saved));
  const before = fs.readFileSync(file), stat = fs.statSync(file), countBefore = calls.length;
  const state = await collector.readFacebookPerformance();
  assert.equal(state.status, 'limited'); assert.equal(state.viewsMetric, undefined); assert.equal(state.videos[0].metrics.views, null);
  assert.equal(state.videos[0].metrics.likes, 8); assert.equal(state.videos[0].metricsUpdatedAt, undefined); assert.match(state.detail, /unverified/);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.statSync(file).mtimeMs, stat.mtimeMs); assert.equal(calls.length, countBefore);
  saved.viewsMetric = 'fb_reels_total_plays'; delete saved.videos[0].metricsUpdatedAt; saved.videos[0].metrics.views = 0;
  fs.writeFileSync(file, JSON.stringify(saved)); assert.equal((await collector.readFacebookPerformance()).videos[0].metrics.views, null);
});

test('only the requested lifetime total metric is accepted, never generic views or initial plays', async () => {
  fetcher = url => isInsights(url) ? Response.json({ data: [metric('100000000000001', 17), metric('100000000000001', 2, { name: 'blue_reels_play_count' })] })
    : Response.json({ data: [video(undefined, { views: 0 })] });
  const state = await collector.syncFacebookPerformance(); assert.equal(state.videos[0].metrics.views, 17);
  assert.equal((await collector.readFacebookPerformance()).videos[0].metrics.views, 17);
  assert.equal(calls.length, 2); assert.ok(!new URL(calls[1].url).searchParams.get('metric').includes('blue_reels'));
});

test('missing, conflicting and malformed metric values stay unknown rather than zero', async () => {
  for (const data of [[], [metric('1', -1)], [metric('1', { total: 12 })], [metric('1', '12.5')],
    [metric('1', 2, { name: 'blue_reels_play_count' })], [metric('1', 2, { period: 'day' })],
    [metric('1', 2), metric('1', 3)], [metric('1', 2, { values: [{ value: 2 }, { value: 3 }] })]]) {
    if (fs.existsSync(file)) fs.rmSync(file);
    fetcher = url => isInsights(url) ? Response.json({ data }) : Response.json({ data: [video(undefined, { views: 999 })] });
    const state = await collector.syncFacebookPerformance();
    assert.equal(state.status, 'limited'); assert.equal(state.videos[0].metrics.views, null); assert.ok(state.videos[0].metricsUpdatedAt);
    assert.equal((await collector.readFacebookPerformance()).videos[0].metrics.views, null);
  }
});

test('at most four insight reads prioritize confirmed Phoenix uploads, then rotate completed unknown checks', async () => {
  const rows = Array.from({ length: 8 }, (_, at) => video(String(100000000000001 + at)));
  const reviewId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const root = path.join(temporary, 'storage', 'Phoenix Studio Review Files'); fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify([{ id: reviewId, status: 'READY', createdAt: '2026-11-20T00:00:00Z' }]));
  fs.mkdirSync(process.env.PHOENIX_PUBLISH_STORAGE, { recursive: true });
  fs.writeFileSync(path.join(process.env.PHOENIX_PUBLISH_STORAGE, `${reviewId}-facebook.json`), JSON.stringify({ version: 1, reviewId, platform: 'facebook',
    accountId: account.accountId, connectionRevision: account.connectionRevision, status: 'COMPLETE', phase: 'complete', remoteId: rows[7].id }));
  fetcher = url => isInsights(url) ? Response.json({ error: { code: 100, message: 'Metric unavailable' } }, { status: 400 }) : Response.json({ data: rows });
  const first = await collector.syncFacebookPerformance();
  assert.equal(calls.length, 5); assert.equal(calls[1].url.includes(`/${rows[7].id}/video_insights`), true); assert.equal(first.status, 'limited');
  assert.equal(first.videos.filter(row => row.metricsUpdatedAt).length, 4); assert.ok(first.videos.every(row => row.metrics.views === null));
  assert.equal((await collector.readFacebookPerformance()).videos.filter(row => row.metricsUpdatedAt).length, 4, 'Unknown completed checks survive cache reads');
  const firstIds = new Set(calls.slice(1).map(call => new URL(call.url).pathname.split('/')[2]));
  expire(); calls = []; await collector.syncFacebookPerformance(); assert.equal(calls.length, 5);
  const secondIds = calls.slice(1).map(call => new URL(call.url).pathname.split('/')[2]);
  assert.equal(secondIds[0], rows[7].id, 'Phoenix publication remains preferred');
  assert.ok(secondIds.slice(1).every(id => !firstIds.has(id)), 'Other unchecked Reels advance instead of repeating unsupported recent rows');
});

test('verified cached counts survive bounded refreshes and unmeasured IDs rotate first', async () => {
  const rows = Array.from({ length: 6 }, (_, at) => video(String(100000000000001 + at)));
  fetcher = url => isInsights(url) ? insight(url, 30) : Response.json({ data: rows });
  const first = await collector.syncFacebookPerformance(); assert.equal(first.videos.filter(row => row.metrics.views === 30).length, 4);
  expire(); calls = [];
  const second = await collector.syncFacebookPerformance();
  assert.equal(calls.length, 5); assert.equal(second.videos.filter(row => row.metrics.views === 30).length, 6);
  assert.equal(new URL(calls[1].url).pathname.split('/')[2], rows[4].id); assert.equal(new URL(calls[2].url).pathname.split('/')[2], rows[5].id);
  assert.equal(second.status, 'ready');
});

test('a denied insight read stops immediately, keeps plays unknown and respects existing backoff', async () => {
  fetcher = url => isInsights(url) ? Response.json({ error: { code: 200, message: account.accessToken } }, { status: 403 })
    : Response.json({ data: [video(), video('100000000000002')] });
  const state = await collector.syncFacebookPerformance();
  assert.equal(state.status, 'permission_required'); assert.equal(calls.length, 2); assert.ok(state.videos.every(row => row.metrics.views === null));
  assert.match(state.detail, /read_insights/); assert.doesNotMatch(JSON.stringify(state), /fixture-facebook-token/);
  assert.ok(Date.parse(JSON.parse(fs.readFileSync(file)).nextRefreshAt) >= Date.now() + 599_000);
  await collector.syncFacebookPerformance(); assert.equal(calls.length, 2);
});

test('throttling midway stops the loop and preserves only completed measurements', async () => {
  let insights = 0;
  fetcher = url => !isInsights(url) ? Response.json({ data: [video(), video('100000000000002'), video('100000000000003')] })
    : ++insights === 1 ? insight(url, 6) : new Response('unreadable', { status: 429, headers: { 'retry-after': '120' } });
  const state = await collector.syncFacebookPerformance();
  assert.equal(state.status, 'rate_limited'); assert.equal(calls.length, 3); assert.deepEqual(state.videos.map(row => row.metrics.views), [6, null, null]);
  assert.equal((await collector.readFacebookPerformance()).videos[0].metrics.views, 6);
  await collector.syncFacebookPerformance(); assert.equal(calls.length, 3);
});

test('revocation during an insight read discards all late same-request measurements', async () => {
  fetcher = url => { if (isInsights(url)) { connected = null; return insight(url, 45); } return Response.json({ data: [video()] }); };
  const state = await collector.syncFacebookPerformance(); assert.equal(state.status, 'not_connected'); assert.equal(state.videos.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(file)).videos.length, 0); assert.equal(calls.length, 2);
});

test('route rejects foreign origins/hosts and invalid refresh bodies before accessing the provider', async () => {
  for (const request of [post({ action: 'refresh' }, { origin: 'https://evil.example' }), post({ action: 'refresh' }, { host: 'evil.example' }), post({ action: 'refresh' }, { origin: '' }), post({ action: 'refresh' }, { 'sec-fetch-site': 'cross-site' }), post({ action: 'refresh' }, {}, 'https://evil.example/api/facebook-performance')]) {
    assert.equal((await route.POST(request)).status, 403);
  }
  for (const input of [{ action: 'refresh', accessToken: 'never-accept-credentials' }, { action: 'publish' }, [], null, '{', 'x'.repeat(1025)]) {
    assert.equal((await route.POST(post(input))).status, 400);
  }
  assert.equal((await route.POST(post({ action: 'refresh' }, { 'content-length': '4096' }))).status, 400);
  assert.equal((await route.GET(new Request('https://evil.example/api/facebook-performance'))).status, 403);
  assert.equal(calls.length, 0); assert.equal(accessCalls.length, 0);
  connected = null; const response = await route.POST(post({ action: 'refresh' })); assert.equal((await response.json()).status, 'not_connected'); assert.equal(calls.length, 0);
});
