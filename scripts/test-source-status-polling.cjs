const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { z } = require('zod');

// Execute the real route and local-request guard against memory-only fixtures.
// Never load the processor dependency graph, binaries, models, owner store or media.
const project = path.resolve(__dirname, '..');
function compile(relative) {
  const filename = path.join(project, relative);
  return { filename, source: ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText };
}
const routeSource = compile('src/app/api/source-processing/route.ts');
const localRequestSource = compile('src/lib/localRequest.ts');
function evaluate(compiled, dependencies) {
  const module = { exports: {} };
  new vm.Script(compiled.source, { filename: compiled.filename }).runInNewContext({
    module, exports: module.exports, Error, URL, Request, Response,
    console: { log() {}, error() {} },
    fetch() { assert.fail('Isolated status tests must never use the network'); },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected isolated status import: ${name}`);
      return dependencies[name];
    },
  }, { timeout: 1000 });
  return module.exports;
}
const localRequest = evaluate(localRequestSource, {});
const readyPreflight = {
  ready: true, summary: 'Fixture tools ready', firstModelDownloadRequired: false,
  dependencies: { ffmpeg: true, ffprobe: true, python: true, fasterWhisper: true },
  whisperModel: { name: 'fixture', cached: true, status: 'cached', message: 'Fixture cached model' },
};
const fixtureJob = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001', status: 'PROCESSING', progress: 25,
  stage: 'Fixture processing', attempts: 2, completedClips: 1, totalClips: 4,
});
class JobHistoryConflictError extends Error {}
class SourceUploadInterruptedError extends Error {}
class SourceUploadTooLargeError extends Error {}

function harness({ jobs = [fixtureJob], preflight = readyPreflight, readError, preflightError, timingError } = {}) {
  const calls = { reads: 0, timing: [], preflight: [], binary: [], model: [], local: [], create: [], remove: [], retry: [] };
  const processor = {
    MAX_SOURCE_BYTES: 5 * 1024 * 1024 * 1024,
    SourceUploadInterruptedError, SourceUploadTooLargeError,
    async readSourceJobs() { calls.reads++; if (readError) throw readError; return jobs; },
    sourceJobWithTiming(job) {
      calls.timing.push(job);
      if (timingError) throw timingError;
      return { ...job, elapsedSeconds: 12, estimatedRemainingSeconds: 36 };
    },
    async sourceProcessingPreflight(...args) {
      calls.preflight.push(args);
      // These sentinels represent the resources reached only through preflight.
      calls.binary.push('fixture-ffmpeg', 'fixture-ffprobe', 'fixture-python');
      calls.model.push('fixture-whisper-check');
      if (preflightError) throw preflightError;
      return preflight;
    },
    async createSourceJob(...args) { calls.create.push(args); return fixtureJob; },
    async removeSourceJob(...args) { calls.remove.push(args); return fixtureJob; },
    async retrySourceJob(...args) { calls.retry.push(args); assert.fail('Status reads must never retry a job'); },
  };
  const api = evaluate(routeSource, {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    zod: { z },
    '@/lib/localRequest': {
      assertLocalRequest(...args) { calls.local.push(args); return localRequest.assertLocalRequest(...args); },
    },
    '@/lib/jobHistory': { JobHistoryConflictError },
    '@/lib/sourceProcessing': processor,
  });
  return { api, calls, setJobs(value) { jobs = value; } };
}
const getRequest = query => new Request(`http://localhost/api/source-processing${query || ''}`);
function postRequest({ authorized = true, query = '' } = {}) {
  return new Request(`http://localhost/api/source-processing${query}`, {
    method: 'POST', body: 'Fixture video bytes',
    headers: {
      origin: authorized ? 'http://localhost' : 'https://other.example', host: 'localhost',
      'content-type': 'video/mp4', 'content-length': '19',
      'x-phoenix-filename': 'fixture%20episode.mp4', 'x-phoenix-title': 'Fixture%20title',
      'x-phoenix-mode': 'highlights',
    },
  });
}
function assertNoMutation(calls) {
  assert.equal(calls.create.length, 0);
  assert.equal(calls.remove.length, 0);
  assert.equal(calls.retry.length, 0);
}

test('status-only polling returns current timed jobs without preflight, binary/model checks or mutations', async () => {
  const h = harness({ preflightError: new Error('Readiness must not run for status-only polling') });
  for (let poll = 0; poll < 3; poll++) {
    const current = { ...fixtureJob, progress: 25 + poll };
    h.setJobs([current]);
    const response = await h.api.GET(getRequest('?statusOnly=1&action=retry'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { jobs: [{ ...current, elapsedSeconds: 12, estimatedRemainingSeconds: 36 }] });
  }
  assert.equal(h.calls.reads, 3);
  assert.equal(h.calls.timing.length, 3);
  assert.deepEqual(h.calls.preflight, []);
  assert.deepEqual(h.calls.binary, []);
  assert.deepEqual(h.calls.model, []);
  assert.equal(h.calls.local.length, 0);
  assertNoMutation(h.calls);
  assert.equal(fixtureJob.progress, 25, 'Timing reads must not alter saved job state');
});

test('ordinary GET retains the complete readiness response, including genuine unavailable tools', async () => {
  for (const ready of [true, false]) {
    const preflight = { ...readyPreflight, ready, summary: ready ? 'Fixture ready' : 'Fixture missing Python' };
    for (const query of ['', '?statusOnly=0', '?statusOnly=true']) {
      const h = harness({ preflight });
      const response = await h.api.GET(getRequest(query));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        rendererAvailable: ready, preflight,
        jobs: [{ ...fixtureJob, elapsedSeconds: 12, estimatedRemainingSeconds: 36 }],
      });
      assert.deepEqual(h.calls.preflight, [[]], 'Ordinary GET preserves the unforced readiness check');
      assert.equal(h.calls.reads, 1);
      assert.equal(h.calls.binary.length, 3);
      assert.equal(h.calls.model.length, 1);
      assertNoMutation(h.calls);
    }
  }
});

test('status-only history and timing failures return actionable HTTP 500 without reporting false readiness', async () => {
  for (const failure of [
    { readError: new Error('Fixture history is unreadable') },
    { timingError: new Error('Fixture timing could not be calculated') },
  ]) {
    const h = harness(failure);
    const response = await h.api.GET(getRequest('?statusOnly=1'));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: (failure.readError || failure.timingError).message });
    assert.equal(h.calls.preflight.length, 0);
    assert.equal(h.calls.binary.length, 0);
    assert.equal(h.calls.model.length, 0);
    assertNoMutation(h.calls);
  }
});

test('ordinary GET errors remain failures with an error message rather than a successful readiness fallback', async () => {
  for (const failure of [
    { readError: new Error('Fixture history unavailable') },
    { preflightError: new Error('Fixture readiness check failed') },
    { readError: 'Fixture non-Error failure' },
  ]) {
    const h = harness(failure);
    const response = await h.api.GET(getRequest());
    assert.equal(response.status, 500);
    const error = failure.readError || failure.preflightError;
    assert.deepEqual(await response.json(), { error: error instanceof Error ? error.message : 'Could not load source processing status.' });
    assert.equal(h.calls.preflight.length, 1);
    assertNoMutation(h.calls);
  }
});

test('authorized POST still forces real readiness before creating a source job, even with statusOnly in its URL', async () => {
  const h = harness();
  const request = postRequest({ query: '?statusOnly=1' });
  const response = await h.api.POST(request);
  assert.equal(response.status, 201);
  assert.deepEqual(h.calls.preflight, [[true]]);
  assert.deepEqual(h.calls.local, [[request, true]]);
  assert.equal(h.calls.create.length, 1);
  assert.deepEqual(h.calls.create[0], [request.body, 'fixture episode.mp4', 'highlights', 'Fixture title', 19]);
  assert.deepEqual(await response.json(), {
    job: fixtureJob, rendererAvailable: true, preflight: readyPreflight,
    message: 'Upload complete. Queued in FIFO order and visible in Workflow Manager.',
  });
  assert.equal(h.calls.reads, 0);
  assert.equal(h.calls.remove.length, 0);
  assert.equal(h.calls.retry.length, 0);
});

test('unavailable POST readiness still blocks upload with its existing actionable 503 response', async () => {
  const preflight = { ...readyPreflight, ready: false, summary: 'Fixture transcription is unavailable' };
  const h = harness({ preflight });
  const response = await h.api.POST(postRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: preflight.summary, preflight });
  assert.deepEqual(h.calls.preflight, [[true]]);
  assertNoMutation(h.calls);
});

test('POST and DELETE retain local mutation authorization before any readiness check or job mutation', async () => {
  const h = harness();
  const post = await h.api.POST(postRequest({ authorized: false, query: '?statusOnly=1' }));
  const remove = await h.api.DELETE(new Request(`http://localhost/api/source-processing?id=${fixtureJob.id}`, {
    method: 'DELETE', headers: { origin: 'https://other.example', host: 'localhost' },
  }));
  for (const response of [post, remove]) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Open this action directly in Phoenix Studio on this PC.' });
  }
  assert.equal(h.calls.local.length, 2);
  assert.ok(h.calls.local.every(call => call[1] === true));
  assert.equal(h.calls.preflight.length, 0);
  assert.equal(h.calls.reads, 0);
  assertNoMutation(h.calls);
});
