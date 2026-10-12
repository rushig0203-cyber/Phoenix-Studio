const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const timers = require('node:timers/promises');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-cloudflare-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const settings = require('../src/lib/writingSettings.ts');
const local = require('../src/lib/localModelSession.ts');
const router = require('../src/lib/writingModel.ts');
const writer = require('../src/lib/cloudflareWriter.ts');
const original = { fetch: global.fetch, read: settings.readWritingSettings, generate: local.generateLocalModel, session: local.withLocalWritingSession, pause: timers.setTimeout };
const selected = { provider: 'cloudflare', model: settings.WRITING_CLOUDFLARE_MODEL, apiKey: 'cf_test_token_for_mock_only_123456789', accountId: '0123456789abcdef0123456789abcdef', freePlanConfirmed: true };
const answer = (text = '{"ok":true}') => Response.json({ success: true, result: { response: text } });
const prompt = { prompt: 'Write one relevant complete line.', options: { num_ctx: 4096, num_predict: 500 } };
let active, calls, waits;
process.chdir(temporary);
beforeEach(() => {
  fs.rmSync(path.join(temporary, 'storage'), { recursive: true, force: true }); active = { ...selected }; calls = []; waits = [];
  timers.setTimeout = async (ms, _value, options) => { waits.push(ms); options?.signal?.throwIfAborted(); };
  settings.readWritingSettings = () => ({ ...active });
  local.generateLocalModel = async () => assert.fail('Cloudflare must not load Ollama');
  local.withLocalWritingSession = async () => assert.fail('Cloudflare must not enter local memory admission');
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return answer('A useful complete line.'); };
});
after(() => { global.fetch = original.fetch; settings.readWritingSettings = original.read; local.generateLocalModel = original.generate; local.withLocalWritingSession = original.session; timers.setTimeout = original.pause; process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true }); });

test('Cloudflare writer sends bounded text to the fixed account/model endpoint and normalizes response', async () => {
  const value = await (await router.generateWritingModel(prompt)).json();
  assert.equal(value.provider, 'cloudflare'); assert.equal(value.done, true); assert.equal(value.response, 'A useful complete line.');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${selected.accountId}/ai/run/${selected.model}`);
  const body = JSON.parse(calls[0].init.body); assert.equal(body.model, undefined); assert.equal(body.messages.length, 2); assert.equal(body.tools, undefined);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store');
});

test('Cloudflare JSON mode uses the supplied schema without claiming schema enforcement', async () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false };
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return answer('{"title":"One"}'); };
  const result = await router.generateWritingModel({ ...prompt, format: schema });
  assert.deepEqual(JSON.parse(calls[0].init.body).response_format, { type: 'json_schema', json_schema: schema });
  assert.equal((await result.json()).response, '{"title":"One"}');
  global.fetch = async () => answer({ title: 'Native JSON object' });
  assert.equal((await (await router.generateWritingModel({ ...prompt, format: schema })).json()).response, '{"title":"Native JSON object"}');
  global.fetch = async () => answer('not json');
  await assert.rejects(router.generateWritingModel({ ...prompt, format: schema }), error => error.code === 'PHOENIX_WRITER_OUTPUT_VALIDATION');
});

test('Cloudflare rejects media, tools, message arrays and endpoint/URL overrides before sending', async () => {
  for (const extra of [{ images: ['private'] }, { tools: [{}] }, { messages: [{}] }, { endpoint: 'https://other.example' }, { url: 'https://other.example' }, { prompt: 'x'.repeat(40_001) }]) {
    await assert.rejects(router.generateWritingModel({ ...prompt, ...extra }));
  }
  assert.equal(calls.length, 0);
  active.apiKey = 'gsk_wrong_provider_key_123456789012345';
  await assert.rejects(router.generateWritingModel(prompt), /valid Cloudflare/);
  assert.equal(calls.length, 0, 'A recognizable Groq secret is never sent to Cloudflare');
});

test('read-only probe confirms exact model without sending inference', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ success: true, result: [{ name: selected.model }] }); };
  const result = await writer.probeCloudflareWriter(selected);
  assert.equal(result.state, 'ready'); assert.match(calls[0].url, /ai\/models\/search\?search=/); assert.equal(calls.length, 1);
});

test('daily Free quota exhaustion persists a wait until next UTC reset with no second request', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ success: false, errors: [{ code: 3036 }] }, { status: 429 }); };
  await assert.rejects(router.generateWritingModel(prompt), error => router.isWritingWaitError(error) && /next UTC reset/.test(error.message));
  const state = JSON.parse(fs.readFileSync(path.join(temporary, 'storage/private/cloudflare-writer-cooldown.json'), 'utf8'));
  assert.ok(state.until > Date.now()); assert.ok(state.until <= Date.now() + 86_400_000);
  await assert.rejects(router.generateWritingModel(prompt), router.isWritingWaitError); assert.equal(calls.length, 1);
});

test('402 never falls back and cancellation does not send an inference request', async () => {
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({}, { status: 402 }); };
  await assert.rejects(router.generateWritingModel(prompt), error => /requested billing/.test(error.message) && !router.isWritingWaitError(error));
  assert.equal(calls.length, 1);
  calls = []; const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(router.generateWritingModel(prompt, { signal: controller.signal })); assert.equal(calls.length, 0);
});

test('temporary HTTP failures retry the same stage at most three times with bounded backoff', async () => {
  for (const statuses of [[500, 502], [503, 504], [408, 500]]) {
    calls = []; waits = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length <= 2 ? Response.json({ errors: [{ message: `private ${selected.apiKey}` }] }, { status: statuses[calls.length - 1] }) : answer('Recovered final answer.');
    };
    const value = await (await router.generateWritingModel(prompt, { timeoutMs: 180_000 })).json();
    assert.equal(value.response, 'Recovered final answer.'); assert.equal(calls.length, 3); assert.deepEqual(waits, [1000, 2000]);
    for (const call of calls) {
      assert.equal(call.url, calls[0].url); assert.equal(call.init.body, calls[0].init.body); assert.equal(call.init.signal, calls[0].init.signal, 'One timeout budget, not a new timeout per retry');
    }
    assert.equal(fs.existsSync(path.join(temporary, 'storage/private/cloudflare-writer.lock')), false);
  }
});

test('exhausted temporary service failures stop instead of becoming an infinite queue wait', async () => {
  const responses = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init }); const result = Response.json({ errors: [{ message: `private prompt ${selected.apiKey}` }] }, { status: 500 }); responses.push(result); return result;
  };
  await assert.rejects(router.generateWritingModel(prompt), error => /HTTP 500 after 3 attempts/.test(error.message) && !router.isWritingWaitError(error) && !error.message.includes(selected.apiKey) && !error.message.includes('private prompt'));
  assert.equal(calls.length, 3); assert.deepEqual(waits, [1000, 2000]); assert.ok(responses.every(response => response.bodyUsed));
  assert.equal(fs.existsSync(path.join(temporary, 'storage/private/cloudflare-writer-cooldown.json')), false, 'A server failure is not quota exhaustion');
  assert.equal(fs.existsSync(path.join(temporary, 'storage/private/cloudflare-writer.lock')), false);
});

test('network interruptions recover, but permanent transport/security errors never retry', async () => {
  global.fetch = async (url, init) => {
    calls.push({ url, init }); if (calls.length === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); return answer('After interruption.');
  };
  assert.equal((await (await router.generateWritingModel(prompt)).json()).response, 'After interruption.'); assert.equal(calls.length, 2); assert.deepEqual(waits, [1000]);
  calls = []; waits = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); throw new TypeError('fetch failed'); };
  await assert.rejects(router.generateWritingModel(prompt), error => /network interruption after 3 attempts/.test(error.message) && !router.isWritingWaitError(error));
  assert.equal(calls.length, 3); assert.deepEqual(waits, [1000, 2000]);
  for (const error of [new TypeError('fetch failed', { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }), new Error(`private ${selected.apiKey}`)]) {
    calls = []; waits = [];
    global.fetch = async (url, init) => { calls.push({ url, init }); throw error; };
    await assert.rejects(router.generateWritingModel(prompt), value => !value.message.includes(selected.apiKey) && !router.isWritingWaitError(value));
    assert.equal(calls.length, 1); assert.deepEqual(waits, []);
  }
});

test('billing, auth, configuration, invalid input and invalid output never use transient retries', async () => {
  for (const status of [400, 401, 402, 403, 404, 405, 413, 422]) {
    calls = []; waits = [];
    global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ errors: [{ code: status === 403 ? 5035 : 5004 }] }, { status }); };
    await assert.rejects(router.generateWritingModel(prompt), error => !router.isWritingWaitError(error));
    assert.equal(calls.length, 1); assert.deepEqual(waits, []);
  }
  for (const response of [answer('not JSON'), Response.json({ success: false }), new Response('unreadable JSON')]) {
    calls = []; waits = [];
    global.fetch = async (url, init) => { calls.push({ url, init }); return response; };
    await assert.rejects(router.generateWritingModel({ ...prompt, format: 'json' })); assert.equal(calls.length, 1); assert.deepEqual(waits, []);
  }
});

test('quota encountered during recovery retains its existing persistent cooldown without transient retries', async () => {
  global.fetch = async (url, init) => {
    calls.push({ url, init }); return Response.json({ errors: [{ code: calls.length === 1 ? 5000 : 3036 }] }, { status: calls.length === 1 ? 500 : 429 });
  };
  await assert.rejects(router.generateWritingModel(prompt), error => router.isWritingWaitError(error) && /next UTC reset/.test(error.message));
  assert.equal(calls.length, 2); assert.deepEqual(waits, [1000]);
  await assert.rejects(router.generateWritingModel(prompt), router.isWritingWaitError); assert.equal(calls.length, 2);
});

test('cancellation or changed credentials during recovery prevents another request and releases the lock', async () => {
  for (const cancel of [false, true]) {
    calls = []; waits = [];
    const controller = new AbortController();
    global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({}, { status: 500 }); };
    timers.setTimeout = async (ms, _value, options) => {
      waits.push(ms); if (cancel) controller.abort(new Error('Owner cancelled')); else active.apiKey = 'another_mock_cloudflare_token_123456789';
      options.signal.throwIfAborted();
    };
    await assert.rejects(router.generateWritingModel(prompt, { signal: controller.signal }), cancel ? /Owner cancelled/ : /settings changed/);
    assert.equal(calls.length, 1); assert.deepEqual(waits, [1000]);
    assert.equal(fs.existsSync(path.join(temporary, 'storage/private/cloudflare-writer.lock')), false);
    active = { ...selected };
  }
});

test('provider retry-after is respected and never extends the original request deadline', async () => {
  global.fetch = async (url, init) => {
    calls.push({ url, init }); return calls.length === 1 ? Response.json({}, { status: 503, headers: { 'retry-after': '15' } }) : answer('Ready after provider delay.');
  };
  assert.equal((await (await router.generateWritingModel(prompt)).json()).response, 'Ready after provider delay.'); assert.deepEqual(waits, [15000]); assert.equal(calls.length, 2);
  calls = []; waits = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({}, { status: 503, headers: { 'retry-after': '86400' } }); };
  await assert.rejects(router.generateWritingModel(prompt), error => /bounded recovery/.test(error.message) && !router.isWritingWaitError(error));
  assert.equal(calls.length, 1); assert.deepEqual(waits, [], 'A day-long backoff cannot turn a bounded request into indefinite recovery');
});

test('expiry of the original deadline after a transient failure prevents a second send', async () => {
  const originalNow = Date.now;
  try {
    for (const network of [false, true]) {
      calls = []; waits = [];
      let now = originalNow(); Date.now = () => now;
      global.fetch = async (url, init) => {
        calls.push({ url, init }); now += 90_001;
        if (network) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
        return Response.json({}, { status: 503 });
      };
      await assert.rejects(router.generateWritingModel(prompt, { timeoutMs: 90_000 }), error => /timed out during bounded recovery/.test(error.message) && !router.isWritingWaitError(error));
      assert.equal(calls.length, 1); assert.deepEqual(waits, []);
      assert.equal(fs.existsSync(path.join(temporary, 'storage/private/cloudflare-writer.lock')), false);
    }
  } finally { Date.now = originalNow; }
});
