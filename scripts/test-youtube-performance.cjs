const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-youtube-performance-'));
const previousStorage = process.env.PHOENIX_PUBLISH_STORAGE;
process.env.PHOENIX_PUBLISH_STORAGE = temporary;
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const channels = require('../src/lib/channelConnections');
const route = require('../src/app/api/youtube-performance/route');
const previous = { fetch: global.fetch, access: channels.getYouTubePerformanceAccess };
const account = { accountId: 'UC' + 'A'.repeat(22), name: 'Fixture channel', connectionRevision: '', accessToken: 'fixture-youtube-secret-not-real', credentialBinding: 'fixture-key' };
const youtubeVideo = 'aB3dEFgHiJ0';
const otherVideo = 'zZ3dEFgHnJ0';
const reviewId = '14c4ef04-2b0d-431f-8ee6-bdb909a1c001';
const otherReview = '14c4ef04-2b0d-431f-8ee6-bdb909a1c002';
const url = 'http://localhost:3000/api/youtube-performance';
let connected, requests, fetcher, renewals, generation = 0;
const post = (suffix = '', input = { action: 'refresh' }, origin = 'http://localhost:3000') =>
  new Request(url + suffix, { method: 'POST', headers: { origin }, body: JSON.stringify(input) });
const record = (id = reviewId, extra = {}) => fs.writeFileSync(path.join(temporary, id + '-youtube.json'), JSON.stringify({
  id: 'be30eaa3-ab1b-427a-b81e-2c9e84f7e8ad', version: 1, reviewId: id, accountId: account.accountId,
  status: 'COMPLETE', phase: 'complete', platform: 'youtube', updatedAt: '2026-11-18T12:00:00Z', remoteId: youtubeVideo, ...extra,
}));
const item = (id = youtubeVideo, channelId = account.accountId) => ({ id,
  snippet: { channelId, title: 'River at dusk', publishedAt: '2026-11-17T12:00:00Z' }, statistics: { viewCount: '0', likeCount: '12' } });
beforeEach(() => {
  for (const entry of fs.readdirSync(temporary)) fs.rmSync(path.join(temporary, entry), { force: true });
  connected = { ...account, connectionRevision: 'fixture-' + (++generation) };
  requests = []; renewals = 0;
  channels.getYouTubePerformanceAccess = async renew => {
    if (renew) renewals++;
    if (!connected) throw new channels.YouTubePerformanceAccessError('not_connected');
    return { ...connected };
  };
  fetcher = () => Response.json({ items: [item()] });
  global.fetch = async (target, init) => { requests.push({ target: new URL(target), init }); return fetcher(); };
});
after(() => {
  global.fetch = previous.fetch; channels.getYouTubePerformanceAccess = previous.access;
  if (previousStorage === undefined) delete process.env.PHOENIX_PUBLISH_STORAGE; else process.env.PHOENIX_PUBLISH_STORAGE = previousStorage;
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('reads only confirmed videos for the verified channel and applies one bounded refresh', async () => {
  record();
  record(otherReview, { remoteId: otherVideo, status: 'PROCESSING' });
  const initial = await (await route.GET(new Request(url))).json();
  assert.equal(initial.status, 'syncing');
  assert.equal(requests.length, 0);
  assert.equal(renewals, 0);
  const refresh = await route.POST(post());
  assert.equal(refresh.status, 200);
  const result = await refresh.json();
  assert.equal(result.status, 'limited');
  assert.deepEqual(result.videos[0].metrics, { views: 0, likes: 12, comments: null, shares: null, averageWatchTimeMs: null });
  assert.equal(result.videos[0].permalink, 'https://www.youtube.com/watch?v=' + youtubeVideo);
  assert.equal(result.videos[0].reviewId, reviewId);
  assert.equal(renewals, 1);
  const [{ target, init }] = requests;
  assert.equal(target.origin + target.pathname, 'https://www.googleapis.com/youtube/v3/videos');
  assert.equal(target.searchParams.get('id'), youtubeVideo);
  assert.equal(target.searchParams.get('part'), 'snippet,statistics');
  assert.equal(target.searchParams.has('access_token'), false);
  assert.equal(init.headers.Authorization, 'Bearer ' + account.accessToken);
  assert.equal(init.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(result), /fixture-youtube-secret|credentialBinding|connectionRevision/);
  const focus = await (await route.GET(new Request(url + '?reviewId=' + reviewId))).json();
  assert.equal(focus.videos[0].id, youtubeVideo);
  const other = await (await route.POST(post('?reviewId=' + otherReview))).json();
  assert.deepEqual(other.videos, []);
  await route.POST(post());
  assert.equal(requests.length, 1);
});

test('rejects wrong channel figures, unconfirmed IDs, out-of-scope records and arbitrary API inputs', async () => {
  record();
  record(otherReview, { remoteId: otherVideo, accountId: 'UC' + 'B'.repeat(22) });
  for (const request of [post('?reviewId=../escape'), post('?id=' + youtubeVideo), post('', { action: 'publish' }), post('', { action: 'refresh', token: 'never-accept' })]) {
    assert.equal((await route.POST(request)).status, 400);
  }
  assert.equal((await route.POST(post('', { action: 'refresh' }, 'https://outside.example'))).status, 403);
  assert.equal(requests.length, 0);
  fetcher = () => Response.json({ items: [item(youtubeVideo, 'UC' + 'B'.repeat(22))] });
  const state = await (await route.POST(post('?reviewId=' + reviewId))).json();
  assert.equal(state.status, 'limited');
  assert.deepEqual(state.videos, []);
  assert.equal(requests[0].target.searchParams.get('id'), youtubeVideo);
});

test('concurrent refreshes return the same counts from a single provider request', async () => {
  record();
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  fetcher = () => new Promise(resolve => { finish = resolve; entered(); });
  const first = route.POST(post());
  await started;
  const second = route.POST(post());
  await new Promise(resolve => setImmediate(resolve));
  finish(Response.json({ items: [item()] }));
  const states = await Promise.all([first, second].map(async pending => (await pending).json()));
  assert.deepEqual(states[0], states[1]);
  assert.equal(states[0].videos[0].id, youtubeVideo);
  assert.equal(requests.length, 1);
});

test('revocation while the provider responds discards statistics', async () => {
  record();
  fetcher = () => {
    connected = null;
    return Response.json({ items: [item()] });
  };
  const state = await (await route.POST(post())).json();
  assert.equal(state.status, 'not_connected');
  assert.deepEqual(state.videos, []);
  assert.equal(requests.length, 1);
});

test('quota failures never follow provider data or reveal credentials and suppress refresh retries', async () => {
  record();
  fetcher = () => Response.json({ error: { message: account.accessToken, errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
  const first = await (await route.POST(post())).json();
  const retry = await (await route.POST(post('?reviewId=' + reviewId))).json();
  assert.equal(first.status, 'rate_limited');
  assert.equal(retry.status, 'rate_limited');
  assert.equal(requests.length, 1);
  assert.doesNotMatch(JSON.stringify(first), /fixture-youtube-secret/);
});
