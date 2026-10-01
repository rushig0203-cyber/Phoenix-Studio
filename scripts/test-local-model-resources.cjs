const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { estimateLocalModelMemory, assertLocalModelResources, LocalModelResourceWaitError, LocalModelConfigurationError, isLocalModelResourceWaitError } = require('../src/lib/localModelResources.ts');
const MiB = 1024 * 1024;
const realFetch = global.fetch;
const realFree = os.freemem;
after(() => { global.fetch = realFetch; os.freemem = realFree; });
const cold = { installedBytes: 1929912432, freeBytes: 1024 * MiB, contextTokens: 4096 };

test('cold admission budgets weights, context, runtime and OS reserve, blocking this laptop at 1 GiB free', () => {
  const estimate = estimateLocalModelMemory(cold);
  assert.equal(estimate.admitted, false);
  assert.equal(estimate.resident, false);
  assert.ok(estimate.requiredFreeBytes > cold.installedBytes + 512 * MiB);
  assert.equal(estimate.deficitBytes, estimate.requiredFreeBytes - cold.freeBytes);
  assert.equal(estimateLocalModelMemory({ ...cold, freeBytes: 5 * 1024 * MiB }).admitted, true);
});

test('resident matching-context runner is not charged full weights again, but retains scratch and OS headroom', () => {
  const estimate = estimateLocalModelMemory({ ...cold, nowMs: 1000, resident: { sizeBytes: 2500 * MiB, contextTokens: 4096, expiresAtMs: 61_000 } });
  assert.equal(estimate.resident, true);
  assert.equal(estimate.additionalBytes, 256 * MiB);
  assert.equal(estimate.admitted, true);
  assert.equal(estimateLocalModelMemory({ ...cold, freeBytes: 700 * MiB, nowMs: 1000, resident: { sizeBytes: 2500 * MiB, contextTokens: 4096, expiresAtMs: 61_000 } }).admitted, false);
});

test('context growth, expiry and uncertain residency get cold-load budget', () => {
  for (const resident of [
    { sizeBytes: 2500 * MiB, contextTokens: 2048, expiresAtMs: 61_000 },
    { sizeBytes: 2500 * MiB, contextTokens: 4096, expiresAtMs: 10_000 },
    { sizeBytes: 0, contextTokens: 4096, expiresAtMs: 61_000 },
    { sizeBytes: 1, contextTokens: 4096, expiresAtMs: 61_000 },
    { sizeBytes: 2500 * MiB, contextTokens: 4096.5, expiresAtMs: 61_000 },
    { sizeBytes: 2500 * MiB, contextTokens: 4096, expiresAtMs: NaN },
  ]) assert.equal(estimateLocalModelMemory({ ...cold, nowMs: 1000, resident }).resident, false);
  assert.ok(estimateLocalModelMemory({ ...cold, contextTokens: 8192 }).requiredFreeBytes > estimateLocalModelMemory(cold).requiredFreeBytes);
});

test('invalid inputs fail closed and reserve cannot be configured away', () => {
  for (const override of [{ installedBytes: NaN }, { freeBytes: -1 }, { contextTokens: 0 }, { contextTokens: 1000000 }, { reserveBytes: -1 }]) {
    assert.throws(() => estimateLocalModelMemory({ ...cold, ...override }), LocalModelConfigurationError);
  }
  assert.equal(estimateLocalModelMemory({ ...cold, reserveBytes: 0 }).reserveBytes, 512 * MiB);
});

function mockInventory({ running = [], installed = [{ name: 'test:latest', size: cold.installedBytes, digest: 'v1' }], free = cold.freeBytes } = {}) {
  const calls = [];
  os.freemem = () => free;
  global.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ models: String(url).endsWith('/api/tags') ? installed : running });
  };
  return calls;
}

test('assertion probes only local read endpoints and returns typed queue wait before allocation', async () => {
  const calls = mockInventory();
  await assert.rejects(assertLocalModelResources({ model: 'test' }), error => {
    assert.ok(isLocalModelResourceWaitError(error)); assert.equal(error.reason, 'memory');
    assert.equal(error.retryAfterMs, 30000); assert.equal(error.estimate.admitted, false); return true;
  });
  assert.deepEqual(calls.sort(), ['http://127.0.0.1:11434/api/ps', 'http://127.0.0.1:11434/api/tags']);
});

test('live inventory recognizes same model/context and does not credit a different model version', async () => {
  const loaded = { name: 'test:latest', digest: 'v1', size: 2500 * MiB, context_length: 4096, expires_at: new Date(Date.now() + 120000).toISOString() };
  mockInventory({ running: [loaded] });
  assert.equal((await assertLocalModelResources({ model: 'test' })).resident, true);
  mockInventory({ running: [{ ...loaded, digest: 'v2' }] });
  await assert.rejects(assertLocalModelResources({ model: 'test' }), LocalModelResourceWaitError);
  mockInventory({ running: [{ ...loaded, digest: undefined }] });
  await assert.rejects(assertLocalModelResources({ model: 'test' }), LocalModelResourceWaitError);
  mockInventory({ running: [{ ...loaded, size: 1 }] });
  await assert.rejects(assertLocalModelResources({ model: 'test' }), LocalModelResourceWaitError);
});

test('remote URLs and cloud routes are rejected without requests or downloads', async () => {
  global.fetch = async () => { assert.fail('unsafe endpoint must not be contacted'); };
  for (const baseUrl of ['https://api.example.com', 'http://127.0.0.1:11434/path', 'http://user:secret@localhost:11434', 'http://localhost:11434/?secret=value']) {
    await assert.rejects(assertLocalModelResources({ model: 'test', baseUrl }), LocalModelConfigurationError);
  }
  await assert.rejects(assertLocalModelResources({ model: 'test:cloud' }), LocalModelConfigurationError);
  mockInventory({ installed: [{ name: 'test', size: 42, remote_model: 'cloud-model' }] });
  await assert.rejects(assertLocalModelResources({ model: 'test' }), LocalModelConfigurationError);
});

test('offline or malformed probes wait safely; missing installed model is an actionable configuration error', async () => {
  for (const response of [null, { models: 'unknown' }, { models: [null] }]) {
    global.fetch = async () => Response.json(response);
    await assert.rejects(assertLocalModelResources({ model: 'test' }), error => isLocalModelResourceWaitError(error) && error.reason === 'probe-unavailable');
  }
  global.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(assertLocalModelResources({ model: 'test' }), LocalModelResourceWaitError);
  mockInventory({ installed: [] });
  await assert.rejects(assertLocalModelResources({ model: 'test' }), LocalModelConfigurationError);
});
