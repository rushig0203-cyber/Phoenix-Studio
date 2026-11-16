const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
// Pure decoded-dimension/appearance fixtures only: no media or owner state.
const { stockReadableOpening, stockVisualOrder } = require('../src/lib/stockVisualContinuity.ts');
const portrait = { width: 720, height: 1280 }, wide = { width: 1920, height: 1080 };
const pair = luma => ({ opening: { luma, u: 128, v: 128, contrast: 80 }, ending: { luma, u: 128, v: 128, contrast: 80 } });

test('decoded portrait opening stays first or replaces a wide opening without cropping any source', () => {
  assert.equal(stockReadableOpening([portrait, wide, portrait]), 0);
  assert.equal(stockReadableOpening([wide, portrait, { width: 1080, height: 1920 }]), 1);
  assert.equal(stockReadableOpening([wide, { width: 1080, height: 1080 }, portrait]), 2);
  assert.equal(stockReadableOpening([wide, { width: 720, height: 1200 }]), 1, 'A source retaining at least92% of its native picture qualifies');
  assert.equal(stockReadableOpening([wide, { width: 720, height: 1150 }, portrait]), 2, 'A wider near-portrait source cannot pass the retention threshold');
  assert.equal(stockReadableOpening([wide, { width: 540, height: 960 }, portrait]), 2, 'A small portrait cannot be promoted by upscaling');
});

test('all landscape or uncertain decoded dimensions preserve the original opening', () => {
  assert.equal(stockReadableOpening([wide, { width: 1280, height: 720 }]), 0);
  for (const invalid of [{}, { width: 720 }, { width: 0, height: 1280 }, { width: NaN, height: 1280 }, { width: Infinity, height: 1280 }, { width: 720.5, height: 1280 }, null]) {
    assert.equal(stockReadableOpening([invalid, portrait]), 0);
    assert.equal(stockReadableOpening([wide, invalid, portrait]), 0);
  }
  assert.equal(stockReadableOpening([]), 0);
});

test('default ordering is unchanged while a selected portrait starts the same color chain', () => {
  const samples = [pair(60), pair(180), pair(70), pair(150)], before = JSON.stringify(samples);
  assert.deepEqual(stockVisualOrder(samples), [0, 2, 3, 1]);
  assert.deepEqual(stockVisualOrder(samples, 0), [0, 2, 3, 1]);
  assert.deepEqual(stockVisualOrder(samples, 3), [3, 1, 2, 0]);
  assert.equal(JSON.stringify(samples), before);
  assert.equal(new Set(stockVisualOrder(samples, 3)).size, samples.length, 'Every source, including the selected reference, is retained exactly once');
});

test('unknown appearance retains the known portrait opening then original remaining order', () => {
  assert.deepEqual(stockVisualOrder([pair(60), undefined, pair(70)], 2), [2, 0, 1]);
  assert.deepEqual(stockVisualOrder([undefined, pair(180), pair(70)], 1), [1, 0, 2]);
  assert.deepEqual(stockVisualOrder([undefined, pair(180), pair(70)]), [0, 1, 2]);
});

test('opening indices must be an exact member of the bounded sequence', () => {
  for (const invalid of [-1, 3, 1.5, NaN, Infinity, '1', null]) assert.throws(() => stockVisualOrder([pair(60), pair(180), pair(70)], invalid), /Choose an opening/);
});
