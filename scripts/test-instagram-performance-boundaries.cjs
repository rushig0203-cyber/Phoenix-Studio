const assert = require('node:assert/strict');
const fs = require('node:fs');
const promises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test, after } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
function load(relative, dependencies, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(project, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const compiledModule = { exports: {} };
  new vm.Script(compiled).runInNewContext({ module: compiledModule, exports: compiledModule.exports, Buffer, URL, TextDecoder, Uint8Array, Response,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected boundary import: ${name}`); return dependencies[name]; }, ...globals });
  return compiledModule.exports;
}
const local = load('src/lib/localRequest.ts', {});
function api() {
  let reads = 0, syncs = 0;
  const state = { version: 1, status: 'permission_required', detail: 'Insights permission needed.', videos: [], scannedVideos: 0, historyComplete: false };
  const handlers = load('src/app/api/instagram-performance/route.ts', {
    '@/lib/localRequest': local,
    '@/lib/instagramPerformance': { async readInstagramPerformance() { reads++; return state; }, async syncInstagramPerformance(force) { assert.equal(force, true); syncs++; return state; } },
    '@/lib/instagramPerformanceLearning': { instagramPerformanceSummary() { return { rules: [], assessments: [] }; } },
  });
  return { ...handlers, counts: () => ({ reads, syncs }) };
}
test('cache GET returns explicit permission status, no-store, and never submits a sync', async () => {
  const route = api(), response = await route.GET(new Request('http://localhost:3000/api/instagram-performance'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).status, 'permission_required'); assert.deepEqual(route.counts(), { reads: 1, syncs: 0 });
});
test('remote and cross-origin requests cannot read metrics or request a refresh', async () => {
  const route = api();
  for (const request of [new Request('https://attacker.test/api/instagram-performance'), new Request('http://localhost:3000/api/instagram-performance', { headers: { origin: 'https://attacker.test' } })]) {
    assert.equal((await route.GET(request)).status, 403);
  }
  const post = new Request('http://localhost:3000/api/instagram-performance', { method: 'POST', headers: { origin: 'https://attacker.test' }, body: '{"action":"refresh"}' });
  assert.equal((await route.POST(post)).status, 403); assert.deepEqual(route.counts(), { reads: 0, syncs: 0 });
});
test('only an explicit same-origin refresh is accepted; credentials and publish choices are rejected', async () => {
  const route = api();
  const request = body => new Request('http://localhost:3000/api/instagram-performance', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body });
  for (const body of ['null', '{}', '[]', '{"action":"publish"}', '{"action":"refresh","accessToken":"fixture-secret"}', '{"action":"refresh","confirm":true}', 'bad json']) {
    assert.equal((await route.POST(request(body))).status, 400);
  }
  assert.deepEqual(route.counts(), { reads: 0, syncs: 0 });
  assert.equal((await route.POST(request('{"action":"refresh"}'))).status, 200);
  assert.deepEqual(route.counts(), { reads: 0, syncs: 1 });
});
test('refresh bodies stop at 1 KiB even with a misleading Content-Length', async () => {
  const route = api(); let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2048)); }, cancel() { cancelled = true; } });
  const request = new Request('http://localhost:3000/api/instagram-performance', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-length': '1' }, body, duplex: 'half' });
  assert.equal((await route.POST(request)).status, 400); assert.equal(cancelled, true); assert.equal(route.counts().syncs, 0);
});

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-insights-boundaries-'));
const reviews = path.join(temporary, 'reviews'), publications = path.join(temporary, 'publications');
fs.mkdirSync(reviews); fs.mkdirSync(publications);
const id = 'b40c62a2-6361-4fe3-8611-691ab025efb7', accountId = '1784000000000001';
const outputPath = (reviewId, target) => path.join(reviews, `${reviewId}-${target}.mp4`);
const matcher = load('src/lib/instagramPublishedReviews.ts', {
  'node:fs/promises': promises, 'node:path': path,
  './reviewFiles': { reviewRoot: () => reviews, outputPath },
}, { process: { env: { PHOENIX_PUBLISH_STORAGE: publications } } });
function fixture(extra = {}) {
  fs.writeFileSync(outputPath(id, 'instagram'), 'inert fixture not a rendered owner video');
  const stat = fs.statSync(outputPath(id, 'instagram'));
  fs.writeFileSync(path.join(reviews, 'index.json'), JSON.stringify([{ id, title: 'Lake', status: 'READY', outputs: { instagram: { duration: 18 } }, ...extra }]));
  const fingerprint = Object.fromEntries(['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].map(key => [key, stat[key]]));
  const record = { accountId, status: 'COMPLETE', phase: 'complete', remoteId: '180000000000123', renderTarget: 'instagram', fingerprint };
  fs.writeFileSync(path.join(publications, `${id}-instagram.json`), JSON.stringify(record));
  return record;
}
test('local topic attribution requires the exact accepted Instagram ID, account and unchanged render', async () => {
  fixture(); const map = await matcher.instagramPublishedReviews(accountId);
  assert.equal(map.get('180000000000123').reviewId, id); assert.equal(map.get('180000000000123').topic, 'Lake');
  assert.equal(map.get('180000000000123').durationSeconds, 18); assert.equal(map.get('180000000000123').creationType, 'source');
  assert.equal((await matcher.instagramPublishedReviews('1784000000000002')).size, 0);
  fs.appendFileSync(outputPath(id, 'instagram'), 'changed output');
  assert.equal((await matcher.instagramPublishedReviews(accountId)).size, 0);
});
test('failed uploads, Stories and deleted reviews cannot become content evidence', async () => {
  for (const changes of [{ status: 'FAILED' }, { phase: 'publishing' }, { kind: 'story' }, { remoteId: '../private' }]) {
    const record = { ...fixture(), ...changes };
    fs.writeFileSync(path.join(publications, `${id}-instagram.json`), JSON.stringify(record));
    assert.equal((await matcher.instagramPublishedReviews(accountId)).size, 0);
  }
  fixture({ trashedAt: '2026-10-13T12:00:00Z' }); assert.equal((await matcher.instagramPublishedReviews(accountId)).size, 0);
});
test('invalid IDs, corrupt or oversized local indexes cannot trigger path traversal or unbounded attribution', async () => {
  fixture({ id: '../private' }); assert.equal((await matcher.instagramPublishedReviews(accountId)).size, 0);
  fs.writeFileSync(path.join(reviews, 'index.json'), '{invalid'); assert.equal((await matcher.instagramPublishedReviews(accountId)).size, 0);
  fs.writeFileSync(path.join(reviews, 'index.json'), Buffer.alloc(8 * 1024 * 1024 + 1)); assert.equal((await matcher.instagramPublishedReviews(accountId)).size, 0);
});
test('worker automatically collects bounded read-only insights independently of renderer admission', () => {
  const worker = fs.readFileSync(path.join(project, 'run-worker.js'), 'utf8');
  assert.match(worker, /diagnostics:\s*\{[\s\S]*instagramInsights:\s*\{ run: syncInstagramPerformance, intervalMs: 60_000 \}/);
  assert.ok(worker.indexOf('process.argv.includes("--preflight")') < worker.indexOf('instagramInsights:'));
});
after(() => {
  const resolved = path.resolve(temporary);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.match(path.basename(resolved), /^phoenix-insights-boundaries-/);
  fs.rmSync(resolved, { recursive: true, force: true });
});
