// Pure history and isolated in-memory-download fixtures; no owner jobs/providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { test, after, mock } = require('node:test');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const reuse = require(path.join(project, 'src/lib/stockReuse.ts'));
const now = Date.parse('2026-10-09T12:34:56.789Z');
const shot = (mediaId = '1', provider = 'pexels') => ({ provider, mediaId });
const history = (id, extra = {}) => ({ id, status: 'COMPLETED', createdAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-09-01T00:00:00.000Z', stockSource: { shots: [shot()] }, ...extra });

test('four uses block provider-scoped canonical identities and each job counts a clip only once', () => {
  const jobs = Array.from({ length: 3 }, (_, at) => history(`job-${at}`, { stockSource: { shots: [shot('001'), shot('1'), shot('0001')] } }));
  assert.deepEqual([...reuse.stockReuseBlocked(jobs, now)], []);
  reuse.assertStockReuseAvailable([shot()], jobs, now);
  jobs.push(history('fourth', { archivedAt: '2026-09-02T00:00:00.000Z', stockSource: { provider: 'pexels', mediaId: '01' } }));
  assert.deepEqual([...reuse.stockReuseBlocked(jobs, now)], ['pexels:1']);
  assert.throws(() => reuse.assertStockReuseAvailable([shot()], jobs, now), /four uses or reservations.*18 months/);
  reuse.assertStockReuseAvailable([shot('1', 'pixabay')], jobs, now);
  assert.equal(reuse.STOCK_REUSE_POLICY, 'four-in-18-months-v1');
});

test('old queued/processing jobs reserve uses while failed cancelled and blocked attempts release them', () => {
  const jobs = [history('complete'), ...['QUEUED', 'PROCESSING', 'QUEUED'].map((status, at) => history(`active-${at}`, {
    status, createdAt: '2020-01-01T00:00:00.000Z', finishedAt: undefined, archivedAt: '2021-01-01T00:00:00.000Z',
  })), ...['FAILED', 'CANCELLED', 'BLOCKED'].map(status => history(status, { status, stockSource: null, createdAt: 'broken', finishedAt: 'broken' })),
  { id: 'nonstock', status: 'COMPLETED', createdAt: 'broken' }];
  assert.deepEqual([...reuse.stockReuseBlocked(jobs, now)], ['pexels:1']);
  assert.deepEqual([...reuse.stockReuseBlocked(jobs, now, 'active-0')], []);
  reuse.assertStockReuseAvailable([shot()], jobs, now, 'active-0');
});

test('rolling 18 calendar UTC months clamp month ends and expire the exact millisecond boundary', () => {
  for (const [current, cutoff] of [
    ['2026-10-31T12:34:56.789Z', '2025-04-30T12:34:56.789Z'],
    ['2026-03-31T12:34:56.789Z', '2024-09-30T12:34:56.789Z'],
    ['2025-08-31T12:34:56.789Z', '2024-02-29T12:34:56.789Z'],
  ]) {
    const clock = Date.parse(current), base = Array.from({ length: 3 }, (_, at) => history(`recent-${at}`, { finishedAt: new Date(clock - 1000).toISOString() }));
    assert.deepEqual([...reuse.stockReuseBlocked([...base, history('boundary', { finishedAt: cutoff })], clock)], []);
    assert.deepEqual([...reuse.stockReuseBlocked([...base, history('inside', { finishedAt: new Date(Date.parse(cutoff) + 1).toISOString() })], clock)], ['pexels:1']);
  }
});

test('completion cooldown uses immutable finish time or legacy creation time and ignores mutable updates', () => {
  const old = Array.from({ length: 4 }, (_, at) => history(`old-${at}`, { finishedAt: '2024-01-01T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' }));
  assert.deepEqual([...reuse.stockReuseBlocked(old, now)], []);
  const fallback = Array.from({ length: 4 }, (_, at) => history(`fallback-${at}`, { finishedAt: undefined, createdAt: '2026-01-01T00:00:00Z' }));
  assert.deepEqual([...reuse.stockReuseBlocked(fallback, now)], ['pexels:1']);
  assert.throws(() => reuse.stockReuseBlocked([history('bad', { finishedAt: 'broken' })], now), /timestamp/);
  assert.throws(() => reuse.stockReuseBlocked([history('bad', { finishedAt: '2026-02-30T00:00:00.000Z' })], now), /timestamp/);
});

test('corrupt relevant history or requested identities fail closed rather than silently releasing quota', () => {
  for (const entry of [
    null, history(undefined), history('bad', { status: 'UNKNOWN' }), history('bad', { stockSource: null }),
    history('bad', { stockSource: { shots: [] } }), history('bad', { stockSource: { shots: {} } }),
    history('bad', { stockSource: { shots: [shot('1', 'unknown')] } }), history('bad', { stockSource: { shots: [shot('0')] } }),
    history('bad', { stockSource: { shots: [shot('https://example.test/1')] } }), history('bad', { stockSource: { shots: [shot('9007199254740992')] } }),
    history('bad', { stockSource: { shots: Array(2) } }), history('bad', { status: 'QUEUED', createdAt: 'broken' }),
    history('bad', { finishedAt: undefined, createdAt: undefined }), history('bad', { finishedAt: '2027-01-01T00:00:00.000Z' }),
  ]) assert.throws(() => reuse.stockReuseBlocked([entry], now), /history cannot be verified/);
  assert.throws(() => reuse.stockReuseBlocked({}, now), /history/);
  assert.throws(() => reuse.stockReuseBlocked([], NaN), /current time/);
  assert.throws(() => reuse.stockReuseBlocked([], now, ''), /job ID/);
  assert.throws(() => reuse.stockReuseBlocked([history('same'), history('same')], now), /duplicated/);
  assert.throws(() => reuse.stockReuseBlocked([history('retry', { status: 'FAILED' }), history('retry')], now, 'retry'), /duplicated/);
  assert.throws(() => reuse.stockReuseBlocked([history('same', { status: 'CANCELLED' }), history('same')], now), /duplicated/);
  for (const shots of [[], [shot('-1')], [shot(' 1')], Array(1)]) assert.throws(() => reuse.assertStockReuseAvailable(shots, [], now), /history cannot be verified/);
});

test('the hard cap considers all retained history beyond a recent-preference sample', () => {
  const jobs = [...Array.from({ length: 300 }, (_, at) => history(`other-${at}`, { stockSource: { shots: [shot(String(at + 100))] } })),
    ...Array.from({ length: 4 }, (_, at) => history(`archived-${at}`, { archivedAt: '2026-09-02T00:00:00.000Z' }))];
  assert.deepEqual([...reuse.stockReuseBlocked(jobs, now)], ['pexels:1']);
});

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-stock-reuse-'));
process.chdir(temporary);
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const jobsPath = path.join(temporary, 'storage', 'Phoenix Studio Review Files', 'source-processing-jobs.json');
const input = (options = {}) => ({ requestId: crypto.randomUUID(), caption: '', theme: 'isolated stock reuse fixture', maxDuration: 60,
  options: { audio: 'original', mood: 'warm', transition: 'cut', framing: 'auto', reusePolicy: reuse.STOCK_REUSE_POLICY, ...options } });
const download = open => ({ ...shot(), sourcePage: 'https://www.pexels.com/video/fixture-1/', creator: 'Fixture', title: 'Fixture', start: 0, end: 2, open });
const recentHistory = count => Array.from({ length: count }, (_, at) => history(`retained-${at}`, { archivedAt: '2026-09-02T00:00:00.000Z' }));
function replaceHistory(jobs) { fs.mkdirSync(path.dirname(jobsPath), { recursive: true }); fs.writeFileSync(jobsPath, JSON.stringify(jobs)); }
const memoryStream = async () => ({ stream: Readable.toWeb(Readable.from(Buffer.alloc(4))), expectedBytes: 4 });
after(() => {
  mock.restoreAll(); process.chdir(project);
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('phoenix-stock-reuse-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('source admission reads archived history and rejects blocked or malformed policies before streams', async () => {
  replaceHistory(recentHistory(4)); let opened = 0;
  const open = async () => { opened++; return memoryStream(); };
  assert.deepEqual([...await source.readStockReuseBlocked()], ['pexels:1']);
  assert.equal((await source.readSourceJobs()).length, 0, 'Normal browsing excludes archived fixtures');
  await assert.rejects(source.createStockReelJob([download(open)], input()), /four uses or reservations/);
  await assert.rejects(source.createStockReelJob([download(open)], input({ reusePolicy: 'unknown' })), /reuse policy is unsupported/);
  assert.equal(opened, 0); assert.equal(JSON.parse(fs.readFileSync(jobsPath, 'utf8')).length, 4);
  await assert.rejects(source.createStockReelJob([download(open)], input({ reusePolicy: undefined })), /four uses or reservations/);
  assert.equal(opened, 0, 'New unmarked/manual stock requests obey the same cap');
  replaceHistory(recentHistory(3));
  const legacy = await source.createStockReelJob([download(open)], input({ reusePolicy: undefined }));
  assert.equal(legacy.status, 'QUEUED'); assert.equal(opened, 1, 'The fourth use remains available without changing manual options');
  const duplicate = await source.createStockReelJob([download(open)], { ...input({ reusePolicy: 'unknown' }), requestId: legacy.stockSource.requestId });
  assert.equal(duplicate.id, legacy.id); assert.equal(opened, 1, 'The saved UUID owns its original recipe before changed-input validation');
});

test('concurrent distinct requests atomically share the last allowed use and clean only rejected staging', async () => {
  replaceHistory(recentHistory(3));
  const originals = path.dirname(reviews.sourcePath('fixture', 'fixture.mp4')), before = new Set(fs.readdirSync(originals));
  let entered = 0, release, bothEntered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { bothEntered = resolve; });
  const open = async () => { if (++entered === 2) bothEntered(); await gate; return memoryStream(); };
  const requests = [source.createStockReelJob([download(open)], input()), source.createStockReelJob([download(open)], input({ reusePolicy: undefined }))];
  await ready; release();
  const results = await Promise.allSettled(requests);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected'); assert.match(rejected.reason.message, /four uses or reservations/);
  const accepted = results.find(result => result.status === 'fulfilled').value;
  assert.equal(JSON.parse(fs.readFileSync(jobsPath, 'utf8')).length, 4);
  const folder = path.dirname(reviews.sourcePath(accepted.id, accepted.stockSource.shots[0].sourceFile));
  assert.deepEqual(fs.readdirSync(folder).filter(file => !before.has(file)), [path.basename(reviews.sourcePath(accepted.id, accepted.stockSource.shots[0].sourceFile))]);
  assert.deepEqual([...await source.readStockReuseBlocked()], ['pexels:1']);
});

test('all failed stock retries atomically recheck quota while queued and completed return paths retain their recipe', async () => {
  const retry = { ...history('retry', { status: 'FAILED', finishedAt: undefined }), title: 'Fixture', sourceFile: 'fixture.mp4', mode: 'coverage', progress: 1, stage: 'Failed fixture', updatedAt: '2026-09-01T00:00:00.000Z', completedClips: 0, totalClips: 1, reviewIds: [],
    stockSource: { provider: 'pexels', mediaId: '1', requestId: crypto.randomUUID(), shots: [shot()], options: input().options } };
  replaceHistory([retry, ...recentHistory(4)]);
  await assert.rejects(source.retrySourceJob(retry.id), /four uses or reservations/);
  assert.equal((await source.getSourceJob(retry.id)).status, 'FAILED');
  replaceHistory([retry, ...recentHistory(3)]);
  const accepted = await source.retrySourceJob(retry.id); assert.equal(accepted.changed, true); assert.equal(accepted.job.status, 'QUEUED');
  assert.equal((await source.retrySourceJob(retry.id)).changed, false, 'A queued retry does not consume a second reservation');
  assert.deepEqual([...await source.readStockReuseBlocked()], ['pexels:1']);
  replaceHistory([{ ...retry, stockSource: { ...retry.stockSource, options: input({ reusePolicy: undefined }).options } }, ...recentHistory(4)]);
  await assert.rejects(source.retrySourceJob(retry.id), /four uses or reservations/);
  replaceHistory([{ ...retry, stockSource: { ...retry.stockSource, options: input({ reusePolicy: 'unknown' }).options } }]);
  await assert.rejects(source.retrySourceJob(retry.id), /reuse policy is unsupported/);
  replaceHistory([retry, history(retry.id), ...recentHistory(3)]);
  await assert.rejects(source.retrySourceJob(retry.id), /duplicated/);
  replaceHistory([{ ...retry, createdAt: 'broken' }]);
  await assert.rejects(source.retrySourceJob(retry.id), /timestamp/);
  assert.equal((await source.getSourceJob(retry.id)).status, 'FAILED', 'Invalid own metadata cannot poison the next queued reservation');
  replaceHistory([{ ...retry, status: 'UNKNOWN' }]);
  await assert.rejects(source.retrySourceJob(retry.id), /invalid saved metadata or status/);
  replaceHistory([{ ...retry, status: 'COMPLETED', finishedAt: new Date(Date.now() - 1000).toISOString() }, ...recentHistory(4)]);
  assert.equal((await source.retrySourceJob(retry.id)).changed, false, 'Completed owner recipes are not retried or rewritten');
});

test('concurrent single-source stock uploads also recheck the last use under the shared acceptance lock', async () => {
  replaceHistory(recentHistory(3));
  const originals = path.dirname(reviews.sourcePath('fixture', 'fixture.mp4')), before = new Set(fs.readdirSync(originals));
  let entered = 0, release, bothEntered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { bothEntered = resolve; });
  const stream = () => new ReadableStream({ async pull(controller) {
    if (++entered === 2) bothEntered(); await gate;
    controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close();
  } }, { highWaterMark: 0 });
  const stock = () => ({ ...shot(), sourcePage: 'https://www.pexels.com/video/fixture-1/', creator: 'Fixture', requestId: crypto.randomUUID(), caption: '', maxDuration: 60 });
  const requests = [source.createSourceJob(stream(), 'single-a.mp4', 'coverage', 'Fixture', 4, stock()), source.createSourceJob(stream(), 'single-b.mp4', 'coverage', 'Fixture', 4, stock())];
  await ready; release();
  const results = await Promise.allSettled(requests);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /four uses or reservations/);
  const accepted = results.find(result => result.status === 'fulfilled').value;
  assert.deepEqual(fs.readdirSync(originals).filter(file => !before.has(file)), [path.basename(reviews.sourcePath(accepted.id, accepted.sourceFile))]);
  assert.equal(JSON.parse(fs.readFileSync(jobsPath, 'utf8')).length, 4);
});

test('single-source stock admission cancels a rejected stream and leaves ordinary uploads unchanged', async () => {
  replaceHistory(recentHistory(4)); let cancelled = false;
  const blocked = new ReadableStream({ cancel() { cancelled = true; } });
  const stock = { ...shot(), sourcePage: 'https://www.pexels.com/video/fixture-1/', creator: 'Fixture', requestId: crypto.randomUUID(), caption: '', maxDuration: 60 };
  await assert.rejects(source.createSourceJob(blocked, 'single.mp4', 'coverage', 'Fixture', undefined, stock), /four uses or reservations/);
  assert.equal(cancelled, true);
  const upload = await source.createSourceJob((await memoryStream()).stream, 'uploaded.mp4', 'coverage', 'Fixture upload', 4);
  assert.equal(upload.status, 'QUEUED'); assert.equal(upload.stockSource, undefined);
  replaceHistory(recentHistory(3));
  const fourth = await source.createSourceJob((await memoryStream()).stream, 'single.mp4', 'coverage', 'Fixture', 4, stock);
  assert.equal(fourth.status, 'QUEUED'); assert.deepEqual([...await source.readStockReuseBlocked()], ['pexels:1']);
  let duplicateCancelled = false;
  const duplicate = await source.createSourceJob(new ReadableStream({ cancel() { duplicateCancelled = true; } }), 'duplicate.mp4', 'coverage', 'Fixture', undefined, stock);
  assert.equal(duplicate.id, fourth.id); assert.equal(duplicateCancelled, true);
});

test('archiving a legacy completed source keeps its original cooldown rather than restarting it today', async () => {
  const jobs = Array.from({ length: 4 }, (_, at) => history(`archive-${at}`, { createdAt: '2020-01-01T00:00:00.000Z', finishedAt: undefined }));
  replaceHistory(jobs); assert.deepEqual([...await source.readStockReuseBlocked()], []);
  for (const job of jobs) {
    const archived = await source.removeSourceJob(job.id);
    assert.equal(archived.finishedAt, job.createdAt); assert.ok(archived.archivedAt);
  }
  assert.equal(JSON.parse(fs.readFileSync(jobsPath, 'utf8')).length, 4);
  assert.deepEqual([...await source.readStockReuseBlocked()], []);
});
