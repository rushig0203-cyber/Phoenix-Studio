const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Evaluate this route with deny-by-default imports and an in-memory upstream.
// Never load stockReel's app graph, fetch a provider or allocate large media.
const project = path.resolve(__dirname, '..');
const filename = path.join(project, 'src/app/api/stock/proxy/route.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const approvedUrl = 'https://videos.pexels.com/mock-video.mp4';
const request = (url = approvedUrl, options) => new Request(`http://localhost/api/stock/proxy?url=${encodeURIComponent(url)}`, options);
async function flush() { for (let step = 0; step < 10; step++) await Promise.resolve(); }

function upstream({ status = 200, headers = { 'Content-Type': 'video/mp4' }, chunks = [], pending = false } = {}) {
  let pendingRead;
  const state = { reads: 0, getReaders: 0, readerCancels: [], bodyCancels: [], releases: 0, arrayBuffers: 0 };
  const reader = {
    read() {
      state.reads++;
      if (chunks.length) return Promise.resolve({ value: chunks.shift(), done: false });
      if (pending) return new Promise(resolve => { pendingRead = resolve; });
      return Promise.resolve({ value: undefined, done: true });
    },
    async cancel(reason) {
      state.readerCancels.push(reason);
      pendingRead?.({ value: undefined, done: true });
    },
    releaseLock() { state.releases++; },
  };
  const body = {
    getReader() { state.getReaders++; return reader; },
    async cancel(reason) { state.bodyCancels.push(reason); },
  };
  return {
    state,
    response: {
      status, ok: status >= 200 && status < 300, headers: new Headers(headers), body,
      arrayBuffer() { state.arrayBuffers++; throw new Error('Proxy must never buffer the upstream asset'); },
    },
  };
}

function harness(source = upstream(), fetchOverride) {
  const calls = [], timers = new Map();
  let timerId = 0;
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, Error, URL, Request, Response, Headers,
    ReadableStream, Uint8Array, AbortController, AbortSignal,
    require(name) {
      if (name === '@/lib/stockReel') return { MAX_STOCK_REEL_BYTES: MAX_VIDEO_BYTES };
      throw new Error(`Unexpected isolated stock proxy import: ${name}`);
    },
    async fetch(...args) {
      calls.push(args);
      return fetchOverride ? fetchOverride(...args) : source.response;
    },
    setTimeout(callback, duration) {
      const timer = { id: ++timerId, unref() {} };
      timers.set(timer, { callback, duration });
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  });
  new vm.Script(output, { filename }).runInContext(context, { timeout: 1000 });
  return { api: module.exports, source, calls, timers };
}

test('proxy streams on demand without arrayBuffer or read-ahead and releases its reader', { timeout: 2000 }, async () => {
  const source = upstream({
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': '5', 'Accept-Ranges': 'bytes', ETag: 'mock-tag', 'Last-Modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
    chunks: [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])],
  });
  const h = harness(source);
  const response = await h.api.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '5');
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('ETag'), 'mock-tag');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Vary'), 'Range, If-Range');
  assert.equal(source.state.reads, 0, 'No upstream bytes are requested before consumption');
  assert.equal(source.state.arrayBuffers, 0);
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2]));
  assert.equal(source.state.reads, 1);
  await flush();
  assert.equal(source.state.reads, 1, 'Consumption does not prefetch the next media chunk');
  assert.deepEqual((await reader.read()).value, new Uint8Array([3, 4, 5]));
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
  assert.equal(source.state.releases, 1);
  assert.equal(source.state.readerCancels.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls[0][1].signal.aborted, false);
});

test('huge or invalid size headers reject before reading or allocating any asset body', { timeout: 2000 }, async () => {
  const cases = [
    [{ 'Content-Type': 'video/mp4', 'Content-Length': String(MAX_VIDEO_BYTES + 1) }, 413],
    [{ 'Content-Type': 'image/jpeg', 'Content-Length': String(MAX_IMAGE_BYTES + 1) }, 413],
    [{ 'Content-Type': 'video/mp4', 'Content-Length': '9007199254740992' }, 502],
    [{ 'Content-Type': 'video/mp4', 'Content-Length': '-1' }, 502],
    [{ 'Content-Type': 'video/mp4', 'Content-Length': '1e9' }, 502],
  ];
  for (const [headers, status] of cases) {
    const source = upstream({ headers });
    const h = harness(source);
    const response = await h.api.GET(request());
    await flush();
    assert.equal(response.status, status);
    assert.equal(source.state.reads, 0);
    assert.equal(source.state.getReaders, 0);
    assert.equal(source.state.arrayBuffers, 0);
    assert.equal(source.state.bodyCancels.length, 1);
    assert.equal(h.calls[0][1].signal.aborted, true);
    assert.equal(h.timers.size, 0);
  }
});

test('partial media keeps status 206 and forwards valid range validators', { timeout: 2000 }, async () => {
  const source = upstream({
    status: 206,
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': '3', 'Content-Range': 'bytes 2-4/10', 'Accept-Ranges': 'bytes', ETag: 'mock-range-tag' },
    chunks: [new Uint8Array([2, 3, 4])],
  });
  const h = harness(source);
  const response = await h.api.GET(request(approvedUrl, { headers: { Range: 'bytes=2-4', 'If-Range': 'mock-range-tag' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-4/10');
  assert.equal(response.headers.get('Content-Length'), '3');
  assert.equal(h.calls[0][1].headers.get('Range'), 'bytes=2-4');
  assert.equal(h.calls[0][1].headers.get('If-Range'), 'mock-range-tag');
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([2, 3, 4]));
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
  assert.equal(h.timers.size, 0);
});

test('suffix ranges are validated against the full bounded media size', { timeout: 2000 }, async () => {
  const source = upstream({
    status: 206,
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 7-9/10' },
    chunks: [new Uint8Array([7, 8, 9])],
  });
  const h = harness(source);
  const response = await h.api.GET(request(approvedUrl, { headers: { Range: 'bytes=-3' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Length'), '3');
  await response.body.cancel('Mock consumer finished');
  assert.equal(source.state.readerCancels.length, 1);
});

test('small range slices cannot bypass the maximum full-asset size', { timeout: 2000 }, async () => {
  const source = upstream({
    status: 206,
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1', 'Content-Range': `bytes 0-0/${MAX_VIDEO_BYTES + 1}` },
  });
  const h = harness(source);
  const response = await h.api.GET(request(approvedUrl, { headers: { Range: 'bytes=0-0' } }));
  await flush();
  assert.equal(response.status, 413);
  assert.equal(source.state.getReaders, 0);
  assert.equal(source.state.reads, 0);
  assert.equal(source.state.bodyCancels.length, 1);
});

test('unsupported URLs, credentials, ports and hosts never reach fetch', { timeout: 2000 }, async () => {
  for (const url of [
    'http://videos.pexels.com/mock.mp4',
    'https://user:password@videos.pexels.com/mock.mp4',
    'https://videos.pexels.com:444/mock.mp4',
    'https://videos.pexels.com.attacker.invalid/mock.mp4',
    'https://attacker.invalid/mock.mp4',
    'not-a-url',
  ]) {
    const h = harness();
    assert.equal((await h.api.GET(request(url))).status, 400);
    assert.equal(h.calls.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('fetch forbids redirects and credentials and explicitly requests unencoded media', { timeout: 2000 }, async () => {
  const h = harness(undefined, async () => { throw new TypeError('Mock redirect blocked'); });
  const response = await h.api.GET(request());
  assert.equal(response.status, 502);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], approvedUrl);
  const options = h.calls[0][1];
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers.get('Accept-Encoding'), 'identity');
  assert.equal(options.signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('redirect responses, non-media and compressed media close their upstream body', { timeout: 2000 }, async () => {
  for (const options of [
    { status: 302, headers: { 'Content-Type': 'video/mp4', Location: 'https://attacker.invalid/mock.mp4' } },
    { headers: { 'Content-Type': 'text/html' } },
    { headers: { 'Content-Type': 'video/mp4', 'Content-Encoding': 'gzip' } },
  ]) {
    const source = upstream(options);
    const h = harness(source);
    assert.equal((await h.api.GET(request())).status, 502);
    await flush();
    assert.equal(source.state.getReaders, 0);
    assert.equal(source.state.bodyCancels.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('invalid or multiple request ranges return 400 before fetch', { timeout: 2000 }, async () => {
  for (const range of ['bytes=0-1,3-4', 'bytes=-', 'bytes=4-2', 'bytes=-0', 'bytes=9007199254740992-', 'items=0-1']) {
    const h = harness();
    const response = await h.api.GET(request(approvedUrl, { headers: { Range: range } }));
    assert.equal(response.status, 400);
    assert.equal(h.calls.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('invalid upstream content ranges reject without reading media', { timeout: 2000 }, async () => {
  for (const headers of [
    { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-4/10', 'Content-Length': '2' },
    { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 3-4/10' },
    { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-11/10' },
    { 'Content-Type': 'video/mp4', 'Content-Range': 'invalid' },
  ]) {
    const source = upstream({ status: 206, headers });
    const h = harness(source);
    assert.equal((await h.api.GET(request(approvedUrl, { headers: { Range: 'bytes=2-4' } }))).status, 502);
    await flush();
    assert.equal(source.state.getReaders, 0);
    assert.equal(source.state.bodyCancels.length, 1);
  }
});

test('consumer cancellation aborts fetch and cancels and releases the upstream reader', { timeout: 2000 }, async () => {
  const source = upstream({ pending: true });
  const h = harness(source);
  const response = await h.api.GET(request());
  await response.body.cancel('Mock tab closed');
  assert.equal(source.state.readerCancels.length, 1);
  assert.equal(source.state.releases, 1);
  assert.equal(h.calls[0][1].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('request abort cancels an in-flight read and errors the downstream stream', { timeout: 2000 }, async () => {
  const source = upstream({ pending: true });
  const h = harness(source);
  const controller = new AbortController();
  const response = await h.api.GET(request(approvedUrl, { signal: controller.signal }));
  const reader = response.body.getReader();
  const read = reader.read();
  const rejected = assert.rejects(read, /cancelled/);
  await flush();
  assert.equal(source.state.reads, 1);
  controller.abort();
  await rejected;
  await flush();
  reader.releaseLock();
  assert.equal(source.state.readerCancels.length, 1);
  assert.equal(source.state.releases, 1);
  assert.equal(h.calls[0][1].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('already aborted requests never start fetch', { timeout: 2000 }, async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  assert.equal((await h.api.GET(request(approvedUrl, { signal: controller.signal }))).status, 408);
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
});

test('a late fetch response is closed after request abort even when fetch ignores its signal', { timeout: 2000 }, async () => {
  const source = upstream();
  let finishFetch;
  const h = harness(source, () => new Promise(resolve => { finishFetch = resolve; }));
  const controller = new AbortController();
  const transfer = h.api.GET(request(approvedUrl, { signal: controller.signal }));
  controller.abort();
  finishFetch(source.response);
  assert.equal((await transfer).status, 408);
  await flush();
  assert.equal(source.state.bodyCancels.length, 1);
  assert.equal(source.state.getReaders, 0);
  assert.equal(h.timers.size, 0);
});

test('unknown-length media enforces byte limits using a virtual large chunk without allocating it', { timeout: 2000 }, async () => {
  const source = upstream({ chunks: [{ byteLength: MAX_VIDEO_BYTES + 1 }] });
  const h = harness(source);
  const response = await h.api.GET(request());
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await assert.rejects(reader.read(), /exceeds its size limit/);
  await flush();
  reader.releaseLock();
  assert.equal(source.state.readerCancels.length, 1);
  assert.equal(source.state.releases, 1);
  assert.equal(source.state.arrayBuffers, 0);
  assert.equal(h.calls[0][1].signal.aborted, true);
});

test('a truncated body errors the stream and closes the upstream reader', { timeout: 2000 }, async () => {
  const source = upstream({ headers: { 'Content-Type': 'video/mp4', 'Content-Length': '2' }, chunks: [new Uint8Array([1])] });
  const h = harness(source);
  const response = await h.api.GET(request());
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1]));
  await assert.rejects(reader.read(), /truncated/);
  await flush();
  reader.releaseLock();
  assert.equal(source.state.readerCancels.length, 1);
  assert.equal(h.timers.size, 0);
});
