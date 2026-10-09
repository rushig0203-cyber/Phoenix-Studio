const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-cloudflare-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const settings = require('../src/lib/writingSettings.ts');
const local = require('../src/lib/localModelSession.ts');
const router = require('../src/lib/writingModel.ts');
const writer = require('../src/lib/cloudflareWriter.ts');
const original = { fetch: global.fetch, read: settings.readWritingSettings, generate: local.generateLocalModel, session: local.withLocalWritingSession };
const selected = { provider: 'cloudflare', model: settings.WRITING_CLOUDFLARE_MODEL, apiKey: 'cf_test_token_for_mock_only_123456789', accountId: '0123456789abcdef0123456789abcdef', freePlanConfirmed: true };
const answer = (text = '{"ok":true}') => Response.json({ success: true, result: { response: text } });
const prompt = { prompt: 'Write one relevant complete line.', options: { num_ctx: 4096, num_predict: 500 } };
let active, calls;
process.chdir(temporary);
beforeEach(() => {
  fs.rmSync(path.join(temporary, 'storage'), { recursive: true, force: true }); active = { ...selected }; calls = [];
  settings.readWritingSettings = () => ({ ...active });
  local.generateLocalModel = async () => assert.fail('Cloudflare must not load Ollama');
  local.withLocalWritingSession = async () => assert.fail('Cloudflare must not enter local memory admission');
  global.fetch = async (url, init) => { calls.push({ url: String(url), init }); return answer('A useful complete line.'); };
});
after(() => { global.fetch = original.fetch; settings.readWritingSettings = original.read; local.generateLocalModel = original.generate; local.withLocalWritingSession = original.session; process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true }); });

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
