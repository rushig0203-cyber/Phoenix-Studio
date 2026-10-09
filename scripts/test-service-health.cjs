const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const writingSettings = require('../src/lib/writingSettings.ts');
mock.method(writingSettings, 'readWritingSettings', () => ({ provider: 'ollama', model: process.env.OLLAMA_MODEL || 'local-test:small', freePlanConfirmed: false }));
const { probeLocalServices } = require('../src/lib/localServiceHealth.ts');
const realFetch = global.fetch;
const saved = { MPT_BASE_URL: process.env.MPT_BASE_URL, OLLAMA_MODEL: process.env.OLLAMA_MODEL };
after(() => { global.fetch = realFetch; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test('health checks actual local model inventory and compatible renderer protocol', async () => {
  process.env.MPT_BASE_URL = 'http://127.0.0.1:8080'; process.env.OLLAMA_MODEL = 'local-test:small';
  global.fetch = async url => String(url).endsWith('/api/tags')
    ? Response.json({ models: [{ name: 'local-test:small' }] })
    : Response.json({ components: { schemas: { TaskVideoRequest: { properties: { phoenix_storyboard: {}, phoenix_artifacts_version: {}, phoenix_playback_policy: { const: 'native-speed-v1' } } } } } });
  const state = await probeLocalServices();
  assert.equal(state.ollama.state, 'ready'); assert.equal(state.renderer.state, 'ready');
});
test('missing models and incompatible backends are blocked, not silently ready', async () => {
  global.fetch = async url => String(url).endsWith('/api/tags') ? Response.json({ models: [] }) : Response.json({ components: {} });
  const state = await probeLocalServices();
  assert.equal(state.ollama.state, 'blocked'); assert.equal(state.renderer.state, 'blocked');
});
test('an older renderer with artifacts but no native-speed contract is blocked', async () => {
  global.fetch = async url => String(url).endsWith('/api/tags') ? Response.json({ models: [] })
    : Response.json({ components: { schemas: { TaskVideoRequest: { properties: { phoenix_storyboard: {}, phoenix_artifacts_version: {} } } } } });
  assert.equal((await probeLocalServices()).renderer.state, 'blocked');
});
test('remote endpoints are never contacted and offline services have actionable states', async () => {
  process.env.MPT_BASE_URL = 'https://paid-provider.example';
  global.fetch = async url => { assert.equal(String(url), 'http://127.0.0.1:11434/api/tags'); throw Error('unreachable'); };
  const state = await probeLocalServices();
  assert.equal(state.ollama.state, 'offline'); assert.equal(state.renderer.state, 'blocked');
});
