const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
// Pure local planning and inert catalogue fixtures: no media, jobs or providers.
const editing = require('../src/lib/stockReel.ts');
const automatic = require('../src/lib/automaticStockReel.ts');
const shot = (duration = 20, extra = {}) => ({ duration, trimMode: 'auto', ...extra });
const plan = (shots, profile, extra = {}) => editing.planStockIntervals(shots, 40, 'cinematic', undefined, 'adaptive-v3', extra.rhythm, extra.opening, profile);
const video = (id, title = 'Sun City skyline') => ({ provider: 'pexels', id, title, duration: 40, width: 720, height: 1280,
  sourcePage: `https://www.pexels.com/video/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id}/`,
  previewUrl: `https://videos.pexels.com/fixture-${id}.mp4`, image: '', creator: 'Fixture contributor' });

test('focused four-source recipes keep natural frame budgets without filling twelve seconds', () => {
  const shots = Array.from({ length: 4 }, () => shot());
  const before = JSON.stringify(shots), focused = plan(shots, 'focus-four-v1');
  assert.deepEqual(focused.map(item => item.frames), [38, 52, 62, 57]);
  assert.ok(focused.at(-1).outputEnd < 12);
  assert.equal(plan(shots).at(-1).outputEnd, 12, 'The saved four-source cadence still has its exact old floor');
  assert.ok(focused.every(item => item.speed === 1));
  assert.equal(JSON.stringify(shots), before);
  assert.deepEqual(plan(shots, 'focus-four-v1', { opening: 'watch-time-v1' }).map(item => item.frames), [28, 52, 62, 57]);
});

test('focused short measured windows remain inside genuine native-speed source bounds', () => {
  const shots = [.7, 1.2, 1.6, 2].map((length, index) => shot(20, { start: index, end: index + 6,
    motionWindows: [{ start: index + 1, end: index + 1 + length, motion: index + 1 }] }));
  const focused = plan(shots, 'focus-four-v1', { rhythm: { bpm: 90 } });
  assert.ok(focused.at(-1).outputEnd < 6);
  focused.forEach((item, index) => {
    const window = shots[index].motionWindows[0];
    assert.equal(item.speed, 1); assert.ok(item.start >= window.start - 1e-7 && item.end <= window.end + 1e-7);
    assert.equal(item.outputStart, index ? focused[index - 1].outputEnd : 0);
    assert.ok(Number.isInteger(item.frames) && item.frames > 0);
    assert.ok(Math.abs(item.end - item.start - item.frames / editing.STOCK_REEL_FPS) < 1e-7);
  });
  assert.throws(() => plan(shots), /Not enough meaningful/);
});

test('control and unmarked recipes preserve exact prior budgets and manual trims', () => {
  for (const count of [4, 8, 10]) {
    const shots = Array.from({ length: count }, (_, index) => shot(20, { motionWindows: [{ start: 2, end: 18, motion: index + 1 }] }));
    for (const extra of [{}, { opening: 'watch-time-v1', rhythm: { bpm: 90 } }]) assert.deepEqual(plan(shots, 'montage-control-v1', extra), plan(shots, undefined, extra));
  }
  const savedV2 = editing.planStockIntervals(Array.from({ length: 8 }, () => shot()), 40, 'cinematic', undefined, 'adaptive-v2');
  assert.deepEqual(savedV2.map(item => item.frames), [48, 62, 74, 69, 79, 64, 62, 74]);
  assert.deepEqual(editing.planStockIntervals([{ duration: 20, start: 1, end: 7, trimMode: 'manual' }], 40, 'cinematic'), [{ start: 1, end: 7, outputStart: 0, outputEnd: 6, frames: 144 }]);
});

test('unknown profiles and unsupported manual/cadence/count/minimum shapes fail closed', () => {
  const four = Array.from({ length: 4 }, () => shot());
  for (const profile of ['unknown', '', null, 4]) assert.throws(() => plan(four, profile), /Sequence experiments/);
  for (const profile of editing.STOCK_SEQUENCE_EXPERIMENTS) {
    assert.throws(() => editing.planStockIntervals(four, 40, 'cinematic', undefined, 'adaptive-v2', undefined, undefined, profile), /Sequence experiments/);
    assert.throws(() => editing.planStockIntervals(four, 40, 'cinematic', 12, 'adaptive-v3', undefined, undefined, profile), /Sequence experiments/);
    assert.throws(() => plan(four.map(item => ({ ...item, trimMode: 'manual' })), profile), /Sequence experiments/);
  }
  for (const count of [3, 5, 8]) assert.throws(() => plan(Array.from({ length: count }, () => shot()), 'focus-four-v1'), /exactly four/);
});

test('focused catalogue selection stops at four authoritative related sources and retains the anchor', async () => {
  const anchor = video(1), resolved = [];
  const catalog = { async search() { return Array.from({ length: 15 }, (_, index) => video(index + 2)); },
    async resolve(provider, id) { resolved.push(id); return id === 2 ? video(2, 'Ocean waves') : video(id); } };
  const result = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], catalog, new Set(), new Set(['pexels:3']), 'focus-four-v1');
  assert.equal(result.length, 4); assert.equal(result[0], anchor);
  assert.deepEqual(result.map(item => item.id), [1, 4, 5, 6]);
  assert.deepEqual(resolved, [2, 4, 5, 6], 'Changed metadata is rejected, blocked IDs are never resolved, and no fifth source is fetched');
});

test('control catalogue selection matches legacy and invalid profiles never call the catalogue', async () => {
  const anchor = video(1), catalog = { async search() { return Array.from({ length: 15 }, (_, index) => video(index + 2)); }, async resolve(provider, id) { return video(id); } };
  const legacy = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], catalog);
  const control = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], catalog, new Set(), new Set(), 'montage-control-v1');
  assert.ok(legacy.length >= 8 && legacy.length <= 10); assert.deepEqual(control, legacy);
  const forbidden = { async search() { assert.fail('Invalid profile must be rejected before a search'); }, async resolve() { assert.fail('Invalid profile must be rejected before resolution'); } };
  await assert.rejects(automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], forbidden, new Set(), new Set(), 'unknown'), /Unknown automatic sequence/);
  await assert.rejects(automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], { async search() { return [video(2), video(3)]; }, async resolve(provider, id) { return video(id); } }, new Set(), new Set(), 'focus-four-v1'), /Not enough related/);
});
