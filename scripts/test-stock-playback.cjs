const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Pure planning/metadata tests: no app dependency graph, provider or media decode.
function load(filename, mocks = {}) {
  const full = path.join(__dirname, '..', filename);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, URL, process: { env: {} }, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } }, { filename: full });
  return module.exports;
}
const playback = load('src/lib/stockPlayback.ts');
const shots = load('src/lib/stockStoryboard.ts', {
  './footageSemantics': { actionMismatch: () => undefined },
  './writingModel': { generateWritingModel: () => { throw new Error('No writer allowed'); }, withWritingSession: () => { throw new Error('No writer allowed'); } },
});
const reels = load('src/lib/stockReel.ts');
const shot = { narration: 'Water flows over the rocks.', query: 'rocky waterfall', start: 0, end: 5, timing: 'subtitle-boundary', sourcePage: 'https://www.pexels.com/video/waterfall-42/' };

test('local renderer must explicitly support only the native-speed contract', () => {
  assert.equal(playback.supportsNativeStockPlayback(undefined), false);
  assert.equal(playback.supportsNativeStockPlayback({ phoenix_playback_policy: {} }), false);
  assert.equal(playback.supportsNativeStockPlayback({ phoenix_playback_policy: { const: 'native-speed-v1' } }), true);
  assert.equal(playback.supportsNativeStockPlayback({ phoenix_playback_policy: { enum: ['native-speed-v1'] } }), true);
  assert.equal(playback.supportsNativeStockPlayback({ phoenix_playback_policy: { enum: ['native-speed-v1', 'stretch'] } }), false);
  assert.equal(playback.supportsNativeStockPlayback({ phoenix_playback_policy: { const: 'stretch' } }), false);
});

test('new stock output requires confirmed normal playback and retains supplemental explanation', () => {
  assert.throws(() => shots.readStockShots([shot], 5, true), /original-speed/);
  const result = shots.readStockShots([{ ...shot, playbackRate: 1, supplementalReason: 'An additional same-subject source covers the narration.' }], 5, true);
  assert.equal(result[0].playbackRate, 1);
  assert.match(result[0].supplementalReason, /same-subject/);
});

test('slowdown, speedup and old visual-stretch declarations are rejected', () => {
  for (const playbackRate of [0.5, 0.99, 1.02, 2, '1', null]) {
    assert.throws(() => shots.readStockShots([{ ...shot, playbackRate }], 5), /original-speed/);
  }
  assert.throws(() => shots.readStockShots([{ ...shot, playbackRate: 1, visualStretch: 1.025 }], 5, true), /original-speed/);
  assert.equal(shots.readStockShots([shot], 5).length, 1, 'legacy records can still be read, without certifying normal playback');
});

test('short real footage stays short under a longer cap; another shot supplies actual footage time', () => {
  const single = reels.planStockIntervals([{ duration: 8 }], 60);
  assert.equal(single[0].start, 0); assert.equal(single[0].end, 8); assert.equal(single[0].outputEnd, 8);
  const sequence = reels.planStockIntervals([{ duration: 8 }, { duration: 12 }], 60);
  assert.equal(sequence[1].outputEnd, 20);
  for (const item of sequence) assert.ok(Math.abs(item.outputEnd - item.outputStart - (item.end - item.start)) <= 1 / reels.STOCK_REEL_FPS);
});

test('a smaller duration cap trims source ranges, never accelerates them', () => {
  const sequence = reels.planStockIntervals([{ duration: 40 }, { duration: 40 }], 60);
  assert.equal(sequence[1].outputEnd, 60);
  for (const item of sequence) {
    assert.equal(item.end - item.start, item.outputEnd - item.outputStart);
    assert.equal(item.end, 40);
  }
});
