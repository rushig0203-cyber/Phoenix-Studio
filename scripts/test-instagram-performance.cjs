const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-instagram-performance-'));
const originalStorage = process.env.PHOENIX_INSTAGRAM_PERFORMANCE_STORAGE;
process.env.PHOENIX_INSTAGRAM_PERFORMANCE_STORAGE = temporary;
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const channels = require('../src/lib/channelConnections');
const originalAccess = channels.getInstagramPerformanceAccess;
const originalMonitor = channels.createInstagramPerformanceAccessMonitor;
const originalFetch = global.fetch;
const publications = require('../src/lib/instagramPublishedReviews');
const originalMatches = publications.instagramPublishedReviews;
const collector = require('../src/lib/instagramPerformance');
const file = path.join(temporary, 'instagram-performance.json');
const account = { accountId: '17841400000123456', name: '@fixture', connectionRevision: 'fixture-revision', accessToken: 'fixture-token-never-real' };
let access, calls, fetcher;
function video(id = '180000000000001', extra = {}) {
  return { id, caption: 'A clear mountain view.', timestamp: '2026-09-10T12:00:00+0000', media_type: 'VIDEO', media_product_type: 'REELS',
    permalink: 'https://www.instagram.com/reel/fixture/', like_count: 12, comments_count: 2, ...extra };
}
function insights(url, values = {}) {
  return Response.json({ data: (url.searchParams.get('metric') || '').split(',').filter(Boolean).map(name => ({ name, period: 'lifetime',
    values: [{ value: Object.hasOwn(values, name) ? values[name] : ({ views: 1000, reach: 800, saved: 3, shares: 4, ig_reels_avg_watch_time: 5500, ig_reels_video_view_total_time: 5500000 })[name] }] })) });
}
function defaultFetch(url) {
  if (url.pathname.endsWith('/media')) return Response.json({ data: [video()] });
  if (url.pathname.endsWith('/insights')) return insights(url);
  throw new Error('Unexpected fixture endpoint');
}
function changeSaved(change) { const saved = JSON.parse(fs.readFileSync(file)); change(saved); fs.writeFileSync(file, JSON.stringify(saved)); }
beforeEach(() => {
  for (const entry of fs.readdirSync(temporary)) fs.rmSync(path.join(temporary, entry), { force: true });
  access = { ...account }; calls = []; fetcher = defaultFetch;
  publications.instagramPublishedReviews = async () => new Map();
  channels.getInstagramPerformanceAccess = async () => {
    if (access instanceof Error) throw access;
    if (!access) { const error = new Error('Fixture disconnected'); error.code = 'not_connected'; throw error; }
    return access;
  };
  channels.createInstagramPerformanceAccessMonitor = async captured => async () => {
    if (!access || access instanceof Error || access.accountId !== captured.accountId || access.connectionRevision !== captured.connectionRevision || access.accessToken !== captured.accessToken) {
      throw new Error('Fixture connection changed');
    }
  };
  global.fetch = async (target, init) => { const url = new URL(target); calls.push({ url: url.href, init }); return fetcher(url, init); };
});
after(() => {
  channels.getInstagramPerformanceAccess = originalAccess; global.fetch = originalFetch;
  channels.createInstagramPerformanceAccessMonitor = originalMonitor;
  publications.instagramPublishedReviews = originalMatches;
  if (originalStorage === undefined) delete process.env.PHOENIX_INSTAGRAM_PERFORMANCE_STORAGE;
  else process.env.PHOENIX_INSTAGRAM_PERFORMANCE_STORAGE = originalStorage;
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.match(path.basename(temporary), /^phoenix-instagram-performance-/);
  fs.rmSync(temporary, { recursive: true, force: true });
});
test('cache-only reads make no Graph request; full sync retains real metrics and private credentials stay private', async () => {
  const before = await collector.readInstagramPerformance(); assert.equal(before.videos.length, 0); assert.equal(calls.length, 0);
  const result = await collector.syncInstagramPerformance();
  assert.equal(result.status, 'ready'); assert.equal(result.historyComplete, true); assert.equal(result.scannedVideos, 1);
  assert.equal(calls.length, 2); assert.deepEqual(result.videos[0].metrics, { views: 1000, reach: 800, likes: 12, comments: 2, saves: 3, shares: 4, averageWatchTimeMs: 5500, totalWatchTimeMs: 5500000 });
  for (const call of calls) {
    const url = new URL(call.url); assert.equal(url.origin, 'https://graph.facebook.com'); assert.match(url.pathname, /^\/v26\.0\//);
    assert.equal(url.searchParams.has('access_token'), false); assert.equal(call.init.headers.Authorization, `Bearer ${account.accessToken}`);
    assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store');
  }
  const cached = await collector.readInstagramPerformance(); assert.equal(calls.length, 2); assert.equal(cached.updatedAt, result.updatedAt);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token|cursor|pending|lease|probes/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /fixture-token-never-real/);
});
test('hourly due gate sends no requests until due; an explicit refresh can bypass only the schedule', async () => {
  await collector.syncInstagramPerformance(); await collector.syncInstagramPerformance(); assert.equal(calls.length, 2);
  await collector.syncInstagramPerformance(true); assert.equal(calls.length, 4);
});
test('a malformed provider row cannot echo a credential in saved caption or permalink', async () => {
  fetcher = url => url.pathname.endsWith('/media') ? Response.json({ data: [video(undefined, { caption: `private ${account.accessToken}`,
    permalink: `https://www.instagram.com/reel/${account.accessToken}/` })] }) : insights(url);
  const result = await collector.syncInstagramPerformance(); assert.equal(result.videos[0].caption, ''); assert.equal(result.videos[0].permalink, undefined);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token-never-real/); assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /fixture-token-never-real/);
});
test('only exact same-account published media matches supply Phoenix topic and duration attribution', async () => {
  publications.instagramPublishedReviews = async id => {
    assert.equal(id, account.accountId);
    return new Map([['180000000000001', { reviewId: '12345678-1234-1234-1234-123456789abc', topic: 'Mountain sunrise', creationType: 'source', durationSeconds: 23 }],
      ['180000000000999', { reviewId: '12345678-1234-1234-1234-123456789aaa', topic: 'Unrelated', creationType: 'business' }]]);
  };
  const result = await collector.syncInstagramPerformance(); assert.equal(result.videos[0].topic, 'Mountain sunrise'); assert.equal(result.videos[0].durationSeconds, 23);
  assert.equal(result.videos[0].reviewId, '12345678-1234-1234-1234-123456789abc');
  publications.instagramPublishedReviews = async () => new Map();
  const refreshed = await collector.syncInstagramPerformance(true); assert.equal(refreshed.videos[0].reviewId, undefined);
});
test('all paginated videos including manually posted videos eventually sync across bounded four-video turns', async () => {
  fetcher = url => {
    if (!url.pathname.endsWith('/media')) return insights(url);
    if (url.searchParams.get('after') === 'older-page') return Response.json({ data: [video('180000000000006')] });
    return Response.json({ data: Array.from({ length: 5 }, (_, index) => video(String(180000000000001 + index))),
      paging: { cursors: { after: 'older-page' }, next: `https://graph.facebook.com/v26.0/${account.accountId}/media?after=older-page&access_token=${account.accessToken}` } });
  };
  const first = await collector.syncInstagramPerformance(); assert.equal(first.status, 'syncing'); assert.equal(first.historyComplete, false); assert.equal(calls.length, 5);
  const second = await collector.syncInstagramPerformance(true); assert.equal(second.historyComplete, false); assert.equal(calls.length, 6);
  const final = await collector.syncInstagramPerformance(true); assert.equal(final.historyComplete, true); assert.equal(final.videos.length, 6); assert.equal(calls.length, 8);
  const pages = calls.map(call => new URL(call.url)).filter(url => url.pathname.endsWith('/media'));
  assert.equal(pages.length, 2); assert.equal(pages[1].searchParams.get('after'), 'older-page');
  assert.ok(calls.every(call => !call.url.includes(account.accessToken))); assert.doesNotMatch(JSON.stringify(final), /older-page/);
});
test('image and Story rows are excluded; ordinary feed video does not request Reel-only watch metrics', async () => {
  fetcher = url => url.pathname.endsWith('/media') ? Response.json({ data: [video('180000000000001', { media_product_type: 'FEED' }),
    video('180000000000002', { media_type: 'IMAGE' }), video('180000000000003', { media_product_type: 'STORY' })] }) : insights(url);
  const result = await collector.syncInstagramPerformance(); assert.equal(result.videos.length, 1); assert.equal(result.videos[0].metrics.averageWatchTimeMs, null);
  assert.equal(new URL(calls[1].url).searchParams.get('metric'), 'views,reach,saved,shares');
});
test('missing or malformed values stay null while genuine zero metrics remain zero', async () => {
  fetcher = url => url.pathname.endsWith('/media') ? Response.json({ data: [video(undefined, { like_count: undefined, comments_count: 0 })] })
    : Response.json({ data: [{ name: 'views', values: [{ value: 0 }] }, { name: 'reach', total_value: { value: 0 } },
      { name: 'saved', values: [{ value: '99' }] }, { name: 'shares', values: [{ value: -1 }] }] });
  const result = await collector.syncInstagramPerformance(); assert.equal(result.status, 'limited');
  const metrics = result.videos[0].metrics; assert.equal(metrics.views, 0); assert.equal(metrics.reach, 0); assert.equal(metrics.comments, 0);
  assert.equal(metrics.likes, null); assert.equal(metrics.saves, null); assert.equal(metrics.shares, null); assert.equal(metrics.averageWatchTimeMs, null);
});
test('a rejected optional metric is isolated, quarantined per media and never fabricated or retried forever', async () => {
  fetcher = url => {
    if (url.pathname.endsWith('/media')) return Response.json({ data: [video()] });
    if (url.searchParams.get('metric').includes('ig_reels_avg_watch_time')) return Response.json({ error: { code: 100,
      message: `metric must be a valid insights metric private=${account.accessToken}` } }, { status: 400 });
    return insights(url);
  };
  const first = await collector.syncInstagramPerformance(); assert.equal(first.status, 'limited'); assert.equal(first.historyComplete, true);
  assert.equal(first.videos[0].metrics.views, 1000); assert.equal(first.videos[0].metrics.averageWatchTimeMs, null); assert.ok(calls.length <= 12);
  assert.doesNotMatch(JSON.stringify(first), /private=|fixture-token/); assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /private=|fixture-token/);
  const previous = calls.length; await collector.syncInstagramPerformance(true);
  assert.equal(calls.length - previous, 2); assert.ok(!new URL(calls.at(-1).url).searchParams.get('metric').includes('ig_reels_avg_watch_time'));
});
test('probe checkpoints resume within the request budget rather than repeatedly requesting a failing group', async () => {
  fetcher = url => {
    if (url.pathname.endsWith('/media')) return Response.json({ data: [video('180000000000001'), video('180000000000002'), video('180000000000003')] });
    if (url.searchParams.get('metric').includes(',')) return Response.json({ error: { code: 100, message: 'invalid metric' } }, { status: 400 });
    return insights(url);
  };
  const first = await collector.syncInstagramPerformance(); assert.equal(first.status, 'syncing'); assert.equal(calls.length, 12);
  const saved = JSON.parse(fs.readFileSync(file)); assert.ok(Object.keys(saved.probes).length > 0);
  const previous = calls.length; const second = await collector.syncInstagramPerformance(true); assert.equal(second.historyComplete, true); assert.ok(calls.length - previous <= 12);
  assert.equal(calls.filter(call => new URL(call.url).searchParams.get('metric')?.includes(',')).length, 3);
});
test('permission failures retain same-account cache but never expose provider errors or request URLs', async () => {
  await collector.syncInstagramPerformance();
  const failure = new Error(`private ${account.accessToken}`); failure.code = 'permission_required';
  failure.account = { id: account.accountId, name: account.name, connectionRevision: account.connectionRevision }; access = failure;
  const read = await collector.readInstagramPerformance(); assert.equal(read.status, 'permission_required'); assert.equal(read.videos.length, 1); assert.match(read.detail, /instagram_manage_insights/);
  await collector.syncInstagramPerformance(); assert.equal(calls.length, 2); assert.doesNotMatch(JSON.stringify(read), /private|fixture-token/);
  failure.account = { ...failure.account, id: '17841400000999999' };
  assert.equal((await collector.readInstagramPerformance()).videos.length, 0);
});
test('HTTP permission rejection retains valid cached metrics and backs off without changing posting readiness', async () => {
  await collector.syncInstagramPerformance();
  fetcher = () => Response.json({ error: { code: 10, message: `secret echo ${account.accessToken}` } }, { status: 403 });
  const result = await collector.syncInstagramPerformance(true); assert.equal(result.status, 'permission_required'); assert.equal(result.videos[0].metrics.views, 1000);
  const previous = calls.length; await collector.syncInstagramPerformance(); assert.equal(calls.length, previous);
  assert.doesNotMatch(JSON.stringify(result), /secret echo|fixture-token/);
});
test('rate limits honor Retry-After and even an explicit refresh cannot bypass the saved backoff', async () => {
  await collector.syncInstagramPerformance();
  fetcher = () => Response.json({ error: { code: 4, message: account.accessToken } }, { status: 429, headers: { 'retry-after': '120' } });
  const result = await collector.syncInstagramPerformance(true); assert.equal(result.status, 'rate_limited'); assert.equal(result.videos[0].metrics.views, 1000);
  const remaining = Date.parse(result.nextSyncAt) - Date.now(); assert.ok(remaining > 110000 && remaining <= 120000);
  const previous = calls.length; await collector.syncInstagramPerformance(true); assert.equal(calls.length, previous);
});
test('temporary/network or malformed responses preserve cache, use backoff and never save arbitrary error prose', async () => {
  await collector.syncInstagramPerformance();
  for (const response of ['network', 'malformed', 'oversized']) {
    changeSaved(saved => { saved.nextSyncAt = undefined; });
    fetcher = () => {
      if (response === 'network') throw new Error(`https://private.invalid/?access_token=${account.accessToken}`);
      if (response === 'malformed') return new Response('not JSON');
      return new Response('x'.repeat(1024 * 1024 + 1));
    };
    const result = await collector.syncInstagramPerformance(true); assert.equal(result.status, 'error'); assert.equal(result.videos[0].metrics.views, 1000);
    assert.doesNotMatch(JSON.stringify(result), /private.invalid|fixture-token|not JSON/);
  }
});
test('pagination rejects foreign hosts, credentials, wrong account paths or repeated cursors without following them', async () => {
  for (const next of ['https://evil.invalid/media?after=older', `https://user:secret@graph.facebook.com/v26.0/${account.accountId}/media?after=older`,
    'https://graph.facebook.com/v26.0/999999/media?after=older']) {
    fs.rmSync(file, { force: true }); calls = [];
    fetcher = () => Response.json({ data: [video()], paging: { cursors: { after: 'older' }, next } });
    const result = await collector.syncInstagramPerformance(); assert.equal(result.status, 'error'); assert.equal(calls.length, 1);
    assert.ok(calls.every(call => new URL(call.url).hostname === 'graph.facebook.com')); assert.doesNotMatch(JSON.stringify(result), /evil|user:secret/);
  }
});
test('disconnect, token, account or revision changes during a request stop further calls and stale commits', async () => {
  for (const changed of [null, { ...account, accessToken: 'fixture-replacement-token' }, { ...account, accountId: '17841400000999999' }, { ...account, connectionRevision: 'new-revision' }]) {
    fs.rmSync(file, { force: true }); calls = []; access = { ...account };
    fetcher = () => { access = changed; return Response.json({ data: [video()] }); };
    const result = await collector.syncInstagramPerformance(); assert.equal(calls.length, 1); assert.equal(result.videos.length, 0);
    const saved = JSON.parse(fs.readFileSync(file)); assert.equal(saved.videos.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /fixture-token|fixture-replacement/);
  }
});
test('same-account live lease blocks concurrent sync and is hidden from all public responses', async () => {
  await collector.syncInstagramPerformance();
  changeSaved(saved => { saved.lease = { token: '12345678-1234-1234-1234-123456789abc', until: Date.now() + 60000 }; });
  const previous = calls.length; const result = await collector.syncInstagramPerformance(true); assert.equal(calls.length, previous); assert.doesNotMatch(JSON.stringify(result), /lease|12345678/);
});
test('a removed collection checkpoint cannot be recreated by an in-flight stale result', async () => {
  fetcher = url => {
    const response = defaultFetch(url);
    if (url.pathname.endsWith('/insights')) fs.rmSync(file, { force: true });
    return response;
  };
  const result = await collector.syncInstagramPerformance();
  assert.equal(calls.length, 2); assert.equal(result.videos.length, 0);
  assert.equal(fs.existsSync(file), false); assert.doesNotMatch(JSON.stringify(result), /fixture-token|lease/);
});
test('over-bound or malformed caches are not overwritten and never return untrusted credential-bearing strings', async () => {
  fs.writeFileSync(file, 'x'.repeat(8 * 1024 * 1024 + 1)); const before = fs.statSync(file).size;
  const result = await collector.readInstagramPerformance(); assert.equal(result.status, 'error'); assert.equal(result.videos.length, 0);
  await collector.syncInstagramPerformance(); assert.equal(calls.length, 0); assert.equal(fs.statSync(file).size, before);
  fs.writeFileSync(file, JSON.stringify({ version: 1, account: { id: account.accountId, name: account.name, connectionRevision: account.connectionRevision },
    status: 'ready', detail: `private ${account.accessToken}`, videos: [], historyComplete: true, pending: [], cursor: 'https://evil.invalid' }));
  const clean = await collector.readInstagramPerformance(); assert.equal(clean.status, 'ready'); assert.doesNotMatch(JSON.stringify(clean), /private|fixture-token|evil/);
});
