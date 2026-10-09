const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const visual = require('../src/lib/stockVisualContinuity.ts');
const pair = (luma, u = 128, v = 128) => ({ opening: { luma, u, v, contrast: 80 }, ending: { luma, u, v, contrast: 80 } });
test('visual sequence retains selected opening and avoids avoidable light/colour jumps', () => {
  assert.deepEqual(visual.stockVisualOrder([pair(60), pair(180), pair(70), pair(150)]), [0, 2, 3, 1]);
  assert.deepEqual(visual.stockVisualOrder([pair(60, 100), pair(60, 190), pair(60, 110)]), [0, 2, 1]);
});
test('unknown appearance leaves catalogue order intact rather than inventing evidence', () => {
  assert.deepEqual(visual.stockVisualOrder([pair(60), undefined, pair(70)]), [0, 1, 2]);
  assert.deepEqual(visual.stockVisualOrder([undefined, pair(180), pair(70)]), [0, 1, 2]);
});
test('appearance parsing is compact, bounded and rejects partial or invalid tool output', () => {
  const log = 'lavfi.signalstats.YAVG=90\nlavfi.signalstats.UAVG=120\nlavfi.signalstats.VAVG=125\nlavfi.signalstats.YLOW=20\nlavfi.signalstats.YHIGH=180';
  assert.deepEqual(visual.stockAppearance(log), { luma: 90, u: 120, v: 125, contrast: 160 });
  assert.equal(visual.stockAppearance(log.replace('YAVG=90', 'YAVG=900')), undefined);
  assert.equal(visual.stockAppearance('no decoded frame'), undefined);
  assert.equal(visual.stockAppearance(log.replace('YLOW=20', 'YLOW=200')), undefined);
  const args = visual.stockAppearanceArgs('local source.mp4', 3.5);
  assert.ok(args.includes('1') && args.includes('-an'));
  assert.match(args[args.indexOf('-vf') + 1], /^scale=32:18/);
  assert.equal(args[args.indexOf('-frames:v') + 1], '1');
  assert.throws(() => visual.stockAppearanceArgs('local', -1), /Invalid/);
});
test('visual ordering is deterministic, nonmutating and refuses unbounded/invalid samples', () => {
  const samples = [pair(80), pair(90), pair(90)]; const saved = JSON.stringify(samples);
  assert.deepEqual(visual.stockVisualOrder(samples), [0, 1, 2]);
  assert.equal(JSON.stringify(samples), saved);
  assert.throws(() => visual.stockVisualOrder([]), /bounded/);
  assert.throws(() => visual.stockVisualOrder(Array.from({ length: 13 }, () => pair(90))), /bounded/);
  assert.throws(() => visual.stockVisualOrder([{ opening: { luma: NaN }, ending: pair(80).ending }]), /Invalid/);
});
