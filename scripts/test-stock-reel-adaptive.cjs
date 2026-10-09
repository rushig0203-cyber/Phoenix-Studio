const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const reel = require('../src/lib/stockReel.ts');

const automatic = (duration = 12, extra = {}) => ({ duration, trimMode: 'auto', ...extra });
const adaptive = (shots, maximum = 40) => reel.planStockIntervals(shots, maximum, 'cinematic', undefined, 'adaptive-v2');

test('adaptive picks the highest measured motion window and keeps output frame boundaries exact', () => {
  const shots = Array.from({ length: 5 }, () => automatic(20, { motionWindows: [
    { start: 1, end: 8, motion: 22 }, { start: 10, end: 19, motion: 80 }, { start: 2, end: 6, motion: 3 },
  ] }));
  const plan = adaptive(shots);
  assert.equal(plan.length, 5);
  assert.ok(plan.every(shot => shot.start >= 10 && shot.end <= 19 && shot.speed === 1));
  assert.equal(plan[0].frames, 48, 'The opening follows its two-second natural target and remains below 2.25 seconds');
  assert.ok(plan.slice(1).every(shot => shot.frames <= 84));
  assert.equal(plan.reduce((sum, shot) => sum + shot.frames, 0), Math.round(plan.at(-1).outputEnd * reel.STOCK_REEL_FPS));
  plan.forEach((shot, index) => assert.equal(shot.outputStart, index ? plan[index - 1].outputEnd : 0));
});

test('unknown motion uses the centre of available footage and never guesses a speed change', () => {
  const plan = adaptive(Array.from({ length: 5 }, () => automatic(14)), 20);
  assert.ok(plan.every(shot => shot.speed === 1));
  assert.ok(plan.every(shot => Math.abs((shot.start + shot.end) / 2 - 7) < 1e-7));
  assert.ok(plan.every(shot => Math.abs(shot.end - shot.start - shot.frames / reel.STOCK_REEL_FPS) < 1e-7));
});

test('ten-source adaptive cadence shrinks to the reel cap using whole frames', () => {
  const plan = adaptive(Array.from({ length: 10 }, () => automatic(20)), 18);
  assert.equal(plan.at(-1).outputEnd, 18);
  assert.ok(plan.at(-1).outputEnd >= 12);
  assert.ok(plan.every((shot, index) => shot.frames >= 1 && shot.end - shot.start <= (index === 0 ? 2.25 : 3.5)));
  assert.ok(new Set(plan.map(shot => shot.frames)).size > 3);
  assert.equal(plan.reduce((sum, shot) => sum + shot.frames, 0), 18 * reel.STOCK_REEL_FPS);
});

test('optional instrumental rhythm snaps only nearby cumulative cuts and preserves total duration', () => {
  const shots = Array.from({ length: 6 }, () => automatic(20));
  const plain = adaptive(shots), rhythmPlan = reel.planStockIntervals(shots, 40, 'cinematic', undefined, 'adaptive-v2', { bpm: 90 });
  const baseTotal = plain.reduce((sum, shot) => sum + shot.frames, 0);
  const snappedTotal = rhythmPlan.reduce((sum, shot) => sum + shot.frames, 0);
  assert.equal(snappedTotal, baseTotal);
  assert.equal(rhythmPlan.at(-1).outputEnd, plain.at(-1).outputEnd);
  let baseBoundary = 0, snappedBoundary = 0, changed = false;
  for (let index = 0; index < shots.length - 1; index += 1) {
    baseBoundary += plain[index].frames;
    snappedBoundary += rhythmPlan[index].frames;
    const beatFrames = reel.STOCK_REEL_FPS * 60 / 90;
    const nearestBeat = Math.round(Math.round(baseBoundary / beatFrames) * beatFrames);
    if (Math.abs(nearestBeat - baseBoundary) <= 4) {
      assert.equal(snappedBoundary, nearestBeat);
      changed ||= snappedBoundary !== baseBoundary;
    } else assert.equal(snappedBoundary, baseBoundary, 'Distant cuts keep their natural timing');
  }
  assert.ok(changed);
  assert.ok(rhythmPlan.every(shot => shot.frames > 0 && shot.end - shot.start <= 3.5));
  assert.throws(() => reel.planStockIntervals(shots, 40, 'cinematic', undefined, 'adaptive-v2', { bpm: 500 }), /40 and 180 BPM/);
});

test('short real sources reduce the result without padding, while measured low motion uses only a bounded speed-up', () => {
  const short = adaptive([
    automatic(1.5), automatic(3), automatic(3), automatic(3), automatic(3),
  ]);
  assert.ok(short.at(-1).outputEnd < 16);
  assert.ok(short.at(-1).outputEnd > 12);
  assert.ok(short.every(shot => shot.speed === 1 && shot.end <= [1.5, 3, 3, 3, 3][short.indexOf(shot)] + 1e-7));

  const lowMotion = adaptive(Array.from({ length: 5 }, () => automatic(15, { motionWindows: [{ start: 2, end: 12, motion: 3.99 }] })));
  assert.ok(lowMotion.every(shot => shot.speed === 1.25));
  assert.ok(lowMotion.every(shot => shot.speed >= 1 && shot.speed <= 1.4));
  assert.ok(lowMotion.every(shot => Math.abs((shot.end - shot.start) - shot.frames / reel.STOCK_REEL_FPS * shot.speed) < 1e-7));
  assert.ok(lowMotion.every(shot => shot.start >= 2 && shot.end <= 12));
});

test('adaptive rejects manual intervals, unsupported recipe bounds, and insufficient real footage', () => {
  for (const [shots, maximum, pacing, minimum] of [
    [Array.from({ length: 4 }, () => automatic()), 40, 'cinematic', 1],
    [Array.from({ length: 3 }, () => automatic()), 40, 'cinematic', undefined],
    [Array.from({ length: 11 }, () => automatic()), 40, 'cinematic', undefined],
    [Array.from({ length: 4 }, () => automatic()), 17.99, 'cinematic', undefined],
    [Array.from({ length: 4 }, () => automatic()), 40.01, 'cinematic', undefined],
    [Array.from({ length: 4 }, () => automatic()), 40, 'selected', undefined],
    [[automatic(), automatic(), automatic(), { duration: 12, start: 1, end: 5, trimMode: 'manual' }], 40, 'cinematic', undefined],
    [Array.from({ length: 4 }, () => automatic(2.9)), 40, 'cinematic', undefined],
  ]) assert.throws(() => reel.planStockIntervals(shots, maximum, pacing, minimum, 'adaptive-v2'), /Adaptive cadence|Not enough meaningful/);
});

test('motion measurements are range checked and planning does not mutate source inputs', () => {
  for (const window of [
    { start: -0.1, end: 3, motion: 10 }, { start: 4, end: 3, motion: 10 },
    { start: 2, end: 13, motion: 10 }, { start: 1, end: 3, motion: -1 },
    { start: 1, end: 3, motion: 256 }, { start: NaN, end: 3, motion: 10 },
  ]) assert.throws(() => adaptive(Array.from({ length: 4 }, () => automatic(12, { motionWindows: [window] }))), /motion window/);
  const shots = Array.from({ length: 5 }, (_item, index) => automatic(12, { start: index, end: 11, motionWindows: [{ start: 2, end: 9, motion: index }] }));
  const before = JSON.stringify(shots);
  adaptive(shots);
  assert.equal(JSON.stringify(shots), before);
});

test('legacy and brisk recipes retain their previous exact outputs and omit speed', () => {
  const legacy = reel.planStockIntervals([{ duration: 50, start: 4, end: 30 }], 60, 'cinematic');
  assert.deepEqual(legacy, [{ start: 4, end: 30, outputStart: 0, outputEnd: 26, frames: 624 }]);
  const brisk = reel.planStockIntervals(Array.from({ length: 10 }, () => automatic(30)), 45, 'cinematic', 40, 'brisk-v1');
  assert.deepEqual(brisk.map(shot => shot.frames / reel.STOCK_REEL_FPS), [3, 4.5, 4, 5, 4.25, 4.75, 4.5, 4, 5, 4.5]);
  assert.ok([...legacy, ...brisk].every(shot => !Object.hasOwn(shot, 'speed')));
});
