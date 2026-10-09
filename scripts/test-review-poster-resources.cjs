const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Only transpile the two units under test. Files, decoders and resource leases
// below are memory-only mocks; never import the application or touch user media.
const project = path.resolve(__dirname, '..');
function compile(relative) {
  const filename = path.join(project, relative);
  return {
    filename,
    output: ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText,
  };
}
const posterModule = compile('src/lib/reviewPoster.ts');
const routeModule = compile('src/app/api/review-files/[id]/poster/route.ts');
class HeavyWorkWaitError extends Error {
  code = 'PHOENIX_HEAVY_WORK_WAIT';
  retryAfterMs = 5000;
}
function evaluate(compiled, dependencies, extra = {}) {
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, Buffer, Error, DOMException, Uint8Array,
    URL, Request, Response, AbortController, AbortSignal,
    process: { env: {}, cwd: () => project, platform: 'win32', arch: 'x64' },
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected isolated poster import: ${name}`);
      return dependencies[name];
    },
    ...extra,
  });
  new vm.Script(compiled.output, { filename: compiled.filename }).runInContext(context, { timeout: 1000 });
  return module.exports;
}
async function until(predicate, message) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await Promise.resolve();
  assert.ok(predicate(), message);
}
const sample = Buffer.from('bounded mocked jpeg');
function posterHarness() {
  const files = new Map();
  const events = [], executions = [], priorities = [];
  let busy = false, held = false, admissions = 0, releases = 0;
  const root = path.join(project, 'unused-mocked-poster-root');
  const stat = { isFile: () => true, size: 1024, mtimeMs: 17 };
  const cachedPath = filename => path.join(root, 'previews', `${crypto.createHash('sha256').update(`${filename}:${stat.size}:${stat.mtimeMs}`).digest('hex')}.jpg`);
  const fakeFs = {
    async stat() { return stat; },
    async readFile(filename) {
      if (!files.has(filename)) throw Object.assign(new Error('Mock cache miss'), { code: 'ENOENT' });
      return files.get(filename);
    },
    async mkdir() { assert.ok(held, 'Cache directory creation stays within the lease'); events.push('mkdir'); },
    async writeFile(filename, bytes) { assert.ok(held, 'Poster cache writes stay within the lease'); files.set(filename, bytes); events.push('write'); },
    async rename(from, to) { assert.ok(held, 'Atomic cache publication stays within the lease'); files.set(to, files.get(from)); files.delete(from); events.push('rename'); },
    async rm(filename) { assert.ok(held, 'Temporary cache cleanup stays within the lease'); files.delete(filename); events.push('rm'); },
  };
  const api = evaluate(posterModule, {
    'node:crypto': crypto,
    'node:fs/promises': fakeFs,
    'node:path': path,
    'node:child_process': {
      execFile(executable, args, options, callback) {
        assert.ok(held, 'Decoder launch requires an acquired lease');
        assert.equal(options.encoding, 'buffer');
        assert.equal(options.windowsHide, true);
        assert.equal(options.timeout, 10_000);
        assert.equal(options.maxBuffer, 1024 * 1024);
        assert.equal(args[args.indexOf('-frames:v') + 1], '1');
        assert.equal(args[args.indexOf('-filter_threads') + 1], '1');
        assert.ok(args.includes('scale=384:216:force_original_aspect_ratio=decrease'));
        const execution = {
          executable, args, options, kills: 0,
          complete(error = null, bytes = sample) {
            assert.ok(held, 'Lease remains held until the decoder completes');
            events.push(error ? 'decoder-error' : 'decoder-complete');
            callback(error, bytes);
          },
        };
        executions.push(execution);
        events.push('decoder-start');
        return { pid: 41000 + executions.length, kill() { execution.kills++; } };
      },
    },
    './renderResources': {
      HeavyWorkWaitError,
      lowerChildProcessPriority(pid) { assert.ok(held); priorities.push(pid); },
      async tryWithLocalRenderSlot(operation, kind) {
        assert.equal(kind, 'review-poster');
        admissions++;
        if (busy) return { acquired: false };
        assert.equal(held, false, 'Poster decoding remains serial');
        held = true;
        events.push('acquire');
        try { return { acquired: true, value: await operation() }; }
        finally { events.push('release'); held = false; releases++; }
      },
    },
    './reviewFiles': { reviewRoot: () => root },
  });
  return {
    api, events, executions, priorities,
    setBusy(value) { busy = value; },
    seedCache(filename, bytes = sample) { files.set(cachedPath(filename), bytes); },
    get held() { return held; }, get admissions() { return admissions; }, get releases() { return releases; },
  };
}

test('cached posters bypass busy admission and never launch a decoder', { timeout: 2000 }, async () => {
  const h = posterHarness();
  h.setBusy(true);
  h.seedCache('mock-cached.mp4');
  assert.equal(await h.api.reviewPoster('mock-cached.mp4'), sample);
  assert.equal(h.admissions, 0);
  assert.equal(h.executions.length, 0);
});

test('cold posters defer while busy and recover on the next request', { timeout: 2000 }, async () => {
  const h = posterHarness();
  h.setBusy(true);
  await assert.rejects(h.api.reviewPoster('mock-busy.mp4'), error => error instanceof HeavyWorkWaitError);
  assert.equal(h.executions.length, 0);
  assert.equal(h.held, false);
  h.setBusy(false);
  const result = h.api.reviewPoster('mock-busy.mp4');
  await until(() => h.executions.length === 1, 'Retry starts one admitted decoder');
  h.executions[0].complete();
  assert.equal(await result, sample);
  assert.equal(h.releases, 1);
});

test('poster decode, cache publication and cleanup hold one bounded lease', { timeout: 2000 }, async () => {
  const h = posterHarness();
  const result = h.api.reviewPoster('mock-held.mp4');
  await until(() => h.executions.length === 1, 'Mock decoder starts');
  assert.equal(h.held, true);
  assert.equal(h.releases, 0);
  assert.equal(h.priorities.length, 1);
  h.executions[0].complete();
  assert.equal(await result, sample);
  assert.equal(h.held, false);
  assert.equal(h.releases, 1);
  assert.deepEqual(h.events, ['acquire', 'decoder-start', 'decoder-complete', 'mkdir', 'write', 'rename', 'rm', 'release']);
  assert.equal(await h.api.reviewPoster('mock-held.mp4'), sample);
  assert.equal(h.executions.length, 1);
});

test('failed decode releases admission and does not poison the serial queue or cache', { timeout: 2000 }, async () => {
  const h = posterHarness();
  const failed = h.api.reviewPoster('mock-failed.mp4');
  const rejection = assert.rejects(failed, /Mock decoder failed/);
  await until(() => h.executions.length === 1, 'First mocked decoder starts');
  h.executions[0].complete(new Error('Mock decoder failed'));
  await rejection;
  assert.equal(h.held, false);
  assert.equal(h.releases, 1);
  assert.equal(h.events.includes('write'), false);
  const recovered = h.api.reviewPoster('mock-failed.mp4');
  await until(() => h.executions.length === 2, 'Failure is eligible for a fresh decode');
  h.executions[1].complete();
  assert.equal(await recovered, sample);
  assert.equal(h.releases, 2);
});

test('duplicate subscribers share one decode and cancelling one does not kill the other', { timeout: 2000 }, async () => {
  const h = posterHarness();
  const firstSignal = new AbortController();
  const secondSignal = new AbortController();
  const first = h.api.reviewPoster('mock-shared.mp4', firstSignal.signal).then(value => ({ value }), error => ({ error }));
  const second = h.api.reviewPoster('mock-shared.mp4', secondSignal.signal);
  await until(() => h.executions.length === 1, 'Shared decoder starts');
  for (let step = 0; step < 10; step++) await Promise.resolve();
  firstSignal.abort();
  assert.equal(h.executions[0].kills, 0);
  assert.equal(h.held, true);
  h.executions[0].complete();
  assert.equal(await second, sample);
  await first;
  assert.equal(h.executions.length, 1);
  assert.equal(h.admissions, 1);
  assert.equal(h.releases, 1);
});

test('all subscribers cancelled while queued skip decoder admission', { timeout: 2000 }, async () => {
  const h = posterHarness();
  const active = h.api.reviewPoster('mock-first.mp4');
  await until(() => h.executions.length === 1, 'First decoder holds the queue');
  const left = new AbortController(), right = new AbortController();
  const queuedLeft = h.api.reviewPoster('mock-queued.mp4', left.signal);
  const queuedRight = h.api.reviewPoster('mock-queued.mp4', right.signal);
  const cancelledLeft = assert.rejects(queuedLeft, error => error.name === 'AbortError');
  const cancelledRight = assert.rejects(queuedRight, error => error.name === 'AbortError');
  for (let step = 0; step < 10; step++) await Promise.resolve();
  left.abort(); right.abort();
  h.executions[0].complete();
  await active;
  await Promise.all([cancelledLeft, cancelledRight]);
  assert.equal(h.executions.length, 1);
  assert.equal(h.admissions, 1);
  assert.equal(h.releases, 1);
});

test('already cancelled requests never inspect media or admit work', { timeout: 2000 }, async () => {
  const h = posterHarness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.api.reviewPoster('mock-cancelled.mp4', controller.signal), error => error.name === 'AbortError');
  assert.equal(h.executions.length, 0);
  assert.equal(h.admissions, 0);
});

function routeHarness(poster) {
  const warnings = [], calls = [];
  const api = evaluate(routeModule, {
    '@/lib/reviewFiles': { safeReviewId: () => true, getReviewFile: async () => ({ id: 'mock-id' }) },
    '@/lib/reviewMedia': { reviewMediaPath: () => 'mock-media.mp4' },
    '@/lib/reviewPoster': { reviewPoster: async (...args) => { calls.push(args); return poster(...args); } },
    '@/lib/renderResources': { HeavyWorkWaitError },
  }, { console: { warn: (...args) => warnings.push(args) } });
  return { api, warnings, calls };
}

test('deferred poster route returns retryable 503 with no-store and the request signal', { timeout: 2000 }, async () => {
  const h = routeHarness(async () => { throw new HeavyWorkWaitError('Mock busy'); });
  const request = new Request('http://localhost/api/review-files/mock-id/poster?target=source');
  const response = await h.api.GET(request, { params: Promise.resolve({ id: 'mock-id' }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Retry-After'), '5');
  assert.equal(h.calls[0][1], request.signal);
  assert.equal(h.warnings.length, 0);
});

test('decoder failure is also retryable and missing media stays an uncached 404', { timeout: 2000 }, async () => {
  for (const [error, status] of [[new Error('Mock failure'), 503], [Object.assign(new Error('Mock missing'), { code: 'ENOENT' }), 404]]) {
    const h = routeHarness(async () => { throw error; });
    const response = await h.api.GET(new Request('http://localhost/api/review-files/mock-id/poster'), { params: Promise.resolve({ id: 'mock-id' }) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Retry-After'), status === 503 ? '5' : null);
  }
});
