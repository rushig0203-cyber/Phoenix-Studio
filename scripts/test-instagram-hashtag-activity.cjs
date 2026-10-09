const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
if (os.freemem() < 600 * 1024 * 1024) { console.log('Skipped optional hashtag tests: less than 600 MiB free RAM.'); process.exit(0); }
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-hashtag-'));
process.chdir(temp);
const channels = require('../src/lib/channelConnections');
const originalAccess = channels.getInstagramHashtagResearchAccess;
const originalFetch = global.fetch;
const activity = require('../src/lib/instagramHashtagActivity');
const account = { accountId: '17841400000123456', connectionRevision: 'fixture-revision-1', accessToken: 'fixture-token-never-real' };
const cache = path.join(temp, 'storage', 'private', 'instagram-hashtag-activity.json');
let calls = [], selectedAccess;
function successFetch(url, init) {
  calls.push({ url, init });
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/recently_searched_hashtags')) return Response.json({ data: [] });
  if (parsed.pathname.endsWith('/ig_hashtag_search')) return Response.json({ data: [{ id: parsed.searchParams.get('q') === 'Waterfall' ? '900001' : '900002' }] });
  if (parsed.pathname.endsWith('/recent_media')) return Response.json({ data: [
    { id: '70001', media_type: 'VIDEO', timestamp: Math.floor(Date.now() / 1000) - 60 },
    { id: '70002', media_type: 'IMAGE', timestamp: new Date(Date.now() - 120000).toISOString() },
    { id: '70001', media_type: 'VIDEO', timestamp: Math.floor(Date.now() / 1000) - 60 },
  ], paging: { next: 'https://malicious.invalid/?access_token=must-not-follow' } });
  throw new Error('Unexpected mocked endpoint.');
}
beforeEach(() => {
  fs.rmSync(path.join(temp, 'storage'), { recursive: true, force: true });
  calls = []; selectedAccess = { ...account };
  channels.getInstagramHashtagResearchAccess = async () => selectedAccess;
  global.fetch = async (...args) => successFetch(...args);
});
after(() => {
  channels.getInstagramHashtagResearchAccess = originalAccess; global.fetch = originalFetch;
  process.chdir(project);
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.match(path.basename(temp), /^phoenix-hashtag-/);
  fs.rmSync(temp, { recursive: true, force: true });
});
test('only two sanitized relevant tags are considered; no token appears in URLs or saved metadata', async () => {
  assert.deepEqual(activity.selectedActivityTags(['#Nature', '#nature', '#fyp', '#Viral', '#Waterfall', '#Mountain', 'http://evil.invalid']), ['#Nature', '#Waterfall']);
  const result = await activity.analyzeInstagramHashtagActivity(['#Waterfall', '#Nature', '#Mountain']);
  assert.equal(result.status, 'CHECKED'); assert.equal(calls.length, 5);
  assert.deepEqual(result.samples.map(item => [item.tag, item.recentSample, item.videos]), [['#Waterfall', 2, 1], ['#Nature', 2, 1]]);
  assert.match(result.detail, /last 24 hours/); assert.match(result.detail, /not total popularity/); assert.match(result.detail, /does not verify Reel/);
  for (const { url, init } of calls) {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://graph.facebook.com');
    assert.match(parsed.pathname, /^\/v21\.0\//); assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(init.headers.Authorization, `Bearer ${account.accessToken}`); assert.equal(init.redirect, 'error');
    if (parsed.pathname.endsWith('/recent_media')) {
      assert.equal(parsed.searchParams.get('fields'), 'id,media_type,timestamp'); assert.equal(parsed.searchParams.get('limit'), '25');
    }
  }
  assert.ok(!JSON.stringify(result).includes(account.accessToken)); assert.ok(!fs.readFileSync(cache, 'utf8').includes(account.accessToken));
  assert.ok(calls.every(call => !call.url.includes('malicious.invalid')));
});
test('a six-hour cache is reused with its original checked-at time, not claimed as a new live lookup', async () => {
  const first = await activity.analyzeInstagramHashtagActivity(['#Waterfall']);
  const count = calls.length;
  const second = await activity.analyzeInstagramHashtagActivity(['#waterfall']);
  assert.equal(calls.length, count); assert.equal(second.checkedAt, first.checkedAt);
  assert.match(second.detail, /Cached within six hours/); assert.equal(second.status, 'CHECKED');
});
test('missing access or specific hashtags never sends a request or writes channel credentials', async () => {
  selectedAccess = null;
  assert.equal((await activity.analyzeInstagramHashtagActivity(['#Nature'])).status, 'UNAVAILABLE');
  selectedAccess = { ...account };
  assert.equal((await activity.analyzeInstagramHashtagActivity(['not-a-tag', '#fyp'])).status, 'UNAVAILABLE');
  assert.equal(calls.length, 0); assert.equal(fs.existsSync(cache), false);
});
test('permission failures are redacted and backed off for the same connection; replacing it allows a new read', async () => {
  global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ error: { code: 10, message: `private echo ${account.accessToken}` } }, { status: 403 }); };
  const first = await activity.analyzeInstagramHashtagActivity(['#Nature']);
  assert.equal(first.status, 'UNAVAILABLE'); assert.match(first.detail, /App Review/);
  await activity.analyzeInstagramHashtagActivity(['#Waterfall']); assert.equal(calls.length, 1);
  const saved = JSON.parse(fs.readFileSync(cache));
  assert.ok(saved.backoff.until - Date.now() > 23 * 60 * 60 * 1000);
  assert.ok(!JSON.stringify(saved).includes(account.accessToken)); assert.ok(!JSON.stringify(first).includes('private echo'));
  selectedAccess = { ...account, connectionRevision: 'fixture-revision-2' }; global.fetch = async (...args) => successFetch(...args);
  assert.equal((await activity.analyzeInstagramHashtagActivity(['#Nature'])).status, 'CHECKED'); assert.equal(calls.length, 4);
});
test('temporary API rate limits honor bounded retry-after, not a seven-day weekly-search wait', async () => {
  global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ error: { code: 4, message: `token=${account.accessToken}` } }, { status: 429, headers: { 'retry-after': '120' } }); };
  const first = await activity.analyzeInstagramHashtagActivity(['#Nature']);
  assert.equal(first.status, 'LIMITED'); await activity.analyzeInstagramHashtagActivity(['#Waterfall']); assert.equal(calls.length, 1);
  const saved = JSON.parse(fs.readFileSync(cache)); assert.ok(saved.backoff.until - Date.now() > 110000);
  assert.ok(saved.backoff.until - Date.now() <= 120000); assert.match(first.detail, /temporary API rate limit/);
  assert.ok(!JSON.stringify(first).includes(account.accessToken)); assert.ok(!JSON.stringify(saved).includes('token='));
});
test('generic Meta error 4/17 uses a one-hour fallback and unreasonably long retry-after is capped', async () => {
  for (const [code, header, minimum, maximum] of [[4, undefined, 3500000, 3600000], [17, '9999999999', 23 * 3600000, 24 * 3600000]]) {
    fs.rmSync(path.join(temp, 'storage'), { recursive: true, force: true }); calls = [];
    global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ error: { code, message: account.accessToken } }, { status: 400,
      headers: header ? { 'retry-after': header } : {} }); };
    assert.equal((await activity.analyzeInstagramHashtagActivity(['#Nature'])).status, 'LIMITED');
    const until = JSON.parse(fs.readFileSync(cache)).backoff.until - Date.now(); assert.ok(until > minimum); assert.ok(until <= maximum);
    await activity.analyzeInstagramHashtagActivity(['#Waterfall']); assert.equal(calls.length, 1);
  }
});
test('a full or paginated weekly history prevents new unique hashtag searches and never follows pagination', async () => {
  for (const history of [
    { data: Array.from({ length: 30 }, (_, index) => ({ id: String(50000 + index) })) },
    { data: [{ id: '50000' }], paging: { next: `https://graph.facebook.com/?access_token=${account.accessToken}` } },
  ]) {
    fs.rmSync(path.join(temp, 'storage'), { recursive: true, force: true }); calls = [];
    global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json(history); };
    assert.equal((await activity.analyzeInstagramHashtagActivity(['#Nature'])).status, 'LIMITED'); assert.equal(calls.length, 1);
  }
});
test('a known hashtag already counted this week can refresh even with a full weekly allowance', async () => {
  const now = Date.now(); fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify({ version: 2,
    identity: crypto.createHash('sha256').update(`${account.accountId}:${account.connectionRevision}`).digest('hex'),
    entries: { '#nature': { tag: '#Nature', id: '50000', recentSample: 1, videos: 1,
      sampledAt: now - 7 * 60 * 60 * 1000, firstSearchedAt: now - 8 * 60 * 60 * 1000 } } }));
  global.fetch = async (url, init) => {
    if (new URL(url).pathname.endsWith('/recently_searched_hashtags')) { calls.push({ url, init }); return Response.json({ data: Array.from({ length: 30 }, (_, index) => ({ id: String(50000 + index) })) }); }
    return successFetch(url, init);
  };
  const result = await activity.analyzeInstagramHashtagActivity(['#Nature']); assert.equal(result.status, 'CHECKED');
  assert.equal(calls.length, 2); assert.ok(calls.every(call => !call.url.includes('ig_hashtag_search')));
});
test('single-object search results work; malformed/network responses are secret-free optional failures', async () => {
  global.fetch = async (url, init) => {
    if (new URL(url).pathname.endsWith('/ig_hashtag_search')) { calls.push({ url, init }); return Response.json({ id: '900001' }); }
    return successFetch(url, init);
  };
  assert.equal((await activity.analyzeInstagramHashtagActivity(['#Waterfall'])).status, 'CHECKED');
  fs.rmSync(path.join(temp, 'storage'), { recursive: true, force: true }); calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); throw new Error(`Network error ${account.accessToken}`); };
  const value = await activity.analyzeInstagramHashtagActivity(['#Nature']); assert.equal(value.status, 'UNAVAILABLE');
  assert.ok(!JSON.stringify(value).includes(account.accessToken)); await activity.analyzeInstagramHashtagActivity(['#Nature']); assert.equal(calls.length, 1);
});
test('disconnect, replacement token, revision or account stops the next graph request', async () => {
  for (const changed of [null, { ...account, accountId: '17841400000999999' },
    { ...account, connectionRevision: 'new-revision' }, { ...account, accessToken: 'fixture-replacement-token' }]) {
    fs.rmSync(path.join(temp, 'storage'), { recursive: true, force: true }); calls = []; selectedAccess = { ...account };
    global.fetch = async (url, init) => { calls.push({ url, init }); selectedAccess = changed; return Response.json({ data: [] }); };
    const value = await activity.analyzeInstagramHashtagActivity(['#Nature']); assert.equal(value.status, 'UNAVAILABLE');
    assert.equal(calls.length, 1, 'No hashtag search may follow the in-flight history response after access changed');
    assert.ok(!JSON.stringify(value).includes(account.accessToken)); assert.ok(!JSON.stringify(value).includes('fixture-replacement-token'));
  }
  fs.rmSync(path.join(temp, 'storage'), { recursive: true, force: true }); calls = [];
  let reads = 0; channels.getInstagramHashtagResearchAccess = async () => ++reads === 1 ? { ...account } : null;
  assert.equal((await activity.analyzeInstagramHashtagActivity(['#Nature'])).status, 'UNAVAILABLE'); assert.equal(calls.length, 0);
});
test('partial cached samples with an access backoff retain their oldest evidence timestamp', async () => {
  const now = Date.now(), sampledAt = now - 5 * 3600000;
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify({ version: 2,
    identity: crypto.createHash('sha256').update(`${account.accountId}:${account.connectionRevision}`).digest('hex'),
    entries: { '#nature': { tag: '#Nature', id: '50000', recentSample: 1, videos: 1,
      sampledAt, firstSearchedAt: now - 8 * 3600000 } } }));
  global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ error: { code: 10 } }, { status: 403 }); };
  const first = await activity.analyzeInstagramHashtagActivity(['#Nature', '#Waterfall']);
  assert.equal(first.status, 'LIMITED'); assert.equal(first.checkedAt, new Date(sampledAt).toISOString());
  const second = await activity.analyzeInstagramHashtagActivity(['#Nature', '#Waterfall']);
  assert.equal(second.checkedAt, first.checkedAt); assert.equal(calls.length, 1); assert.match(second.detail, /cached, not a new live lookup/);
});
