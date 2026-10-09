const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
// Only the pure helpers load: no provider, speech model, renderer or app graph.
const editing = require('../src/lib/stockReel.ts');

const automatic = (duration = 20, start = 0, end = duration) => ({ duration, start, end, trimMode: 'auto' });
function exactFrameBudget(plan) {
  assert.equal(plan.reduce((sum, shot) => sum + shot.frames, 0), Math.round(plan.at(-1).outputEnd * editing.STOCK_REEL_FPS));
  plan.forEach((shot, index) => {
    assert.equal(shot.outputStart, index ? plan[index - 1].outputEnd : 0);
    assert.ok(shot.end > shot.start);
    assert.ok(Math.abs((shot.outputEnd - shot.outputStart) - (shot.end - shot.start)) <= 1 / editing.STOCK_REEL_FPS + 1e-7, 'One native interval supplies the output; no stretching or looping');
  });
}

test('saved jobs without pacing retain the exact legacy selected-ending recipe', () => {
  const shots = Array.from({ length: 6 }, (_, index) => ({ duration: 30, start: index, end: index + 20 }));
  const plan = editing.planStockIntervals(shots, 45);
  assert.equal(plan.length, 6);
  plan.forEach((shot, index) => { assert.equal(shot.end, shots[index].end); assert.equal(shot.start, shots[index].end - 7.5); });
  assert.equal(plan.at(-1).outputEnd, 45);
  assert.equal(editing.DEFAULT_STOCK_REEL_OPTIONS.pacing, undefined, 'New pacing is explicit, not injected into legacy jobs');
  exactFrameBudget(plan);
});

test('cinematic multi-shot pacing varies short original-speed windows, with an opening and ending', () => {
  const shots = Array.from({ length: 8 }, () => automatic(30, 2, 22));
  const plan = editing.planStockIntervals(shots, 60, 'cinematic');
  assert.equal(plan.length, 8);
  assert.equal(plan[0].start, 2, 'The first source opening is retained, not tail-trimmed away');
  assert.equal(plan.at(-1).end, 22, 'The selected final ending is retained');
  assert.ok(plan.every(shot => shot.end - shot.start >= 4 && shot.end - shot.start <= 7));
  assert.ok(new Set(plan.map(shot => shot.end - shot.start)).size > 3);
  assert.equal(plan.at(-1).outputEnd, 45.25, 'The length is actual useful footage, not a target to pad');
  exactFrameBudget(plan);
});

test('a strong continuous automatic shot can last twelve seconds without artificial cuts or fill', () => {
  const plan = editing.planStockIntervals([automatic(50, 4, 40)], 60, 'cinematic');
  assert.deepEqual(plan, [{ start: 4, end: 16, outputStart: 0, outputEnd: 12, frames: 288 }]);
  const short = editing.planStockIntervals([automatic(3)], 60, 'cinematic');
  assert.equal(short.at(-1).outputEnd, 3);
  assert.equal(short[0].end, 3);
});

test('manual or unmarked intervals never move under cinematic pacing', () => {
  const plan = editing.planStockIntervals([automatic(20), { duration: 40, start: 17, end: 28, trimMode: 'manual' }, automatic(30, 3, 23)], 20, 'cinematic');
  assert.equal(plan[1].start, 17); assert.equal(plan[1].end, 28);
  assert.equal(plan.at(-1).outputEnd, 20);
  assert.ok(plan.filter((_shot, index) => index !== 1).every(shot => shot.end - shot.start >= 4));
  assert.deepEqual(editing.planStockIntervals([{ duration: 50, start: 4, end: 30 }], 60, 'cinematic'), [{ start: 4, end: 30, outputStart: 0, outputEnd: 26, frames: 624 }]);
  exactFrameBudget(plan);
});

test('explicit selected pacing keeps owner choices; impossible caps ask for a change instead of silently cutting', () => {
  const shots = [{ duration: 40, start: 2, end: 20, trimMode: 'manual' }, automatic(30, 7, 19)];
  const plan = editing.planStockIntervals(shots, 60, 'selected');
  assert.equal(plan[0].start, 2); assert.equal(plan[0].end, 20);
  assert.equal(plan[1].start, 7); assert.equal(plan[1].end, 19);
  assert.equal(plan.at(-1).outputEnd, 30);
  assert.throws(() => editing.planStockIntervals(shots, 20, 'selected'), /manual trims|Increase the maximum/);
  assert.throws(() => editing.planStockIntervals([automatic(20), { duration: 40, start: 17, end: 28, trimMode: 'manual' }, automatic(30)], 18, 'cinematic'), /Increase the maximum length or remove a shot/);
  assert.throws(() => editing.planStockIntervals(Array.from({ length: 12 }, () => automatic()), 45, 'cinematic'), /without cutting/);
  exactFrameBudget(plan);
});

test('short sources are not stretched, and twelve distinct shots are bounded without reducing disk limits', () => {
  const plan = editing.planStockIntervals([automatic(2), automatic(3), automatic(1.5)], 60, 'cinematic');
  assert.equal(plan.at(-1).outputEnd, 6.5);
  assert.equal(editing.MAX_STOCK_SHOTS, 12);
  assert.equal(editing.MAX_STOCK_REEL_BYTES, 500 * 1024 * 1024);
  assert.equal(editing.planStockIntervals(Array.from({ length: 12 }, () => automatic()), 60, 'cinematic').length, 12);
  assert.throws(() => editing.planStockIntervals(Array.from({ length: 13 }, () => automatic()), 60, 'cinematic'), /one to twelve/);
  assert.throws(() => editing.planStockIntervals([automatic()], 106, 'cinematic'), /105 seconds/);
  assert.throws(() => editing.planStockIntervals([{ duration: 10, start: 3, end: 12, trimMode: 'auto' }], 60, 'cinematic'), /outside/);
  assert.throws(() => editing.planStockIntervals([{ duration: 10, trimMode: 'guessed' }], 60, 'cinematic'), /invalid trim mode/);
  exactFrameBudget(plan);
});

test('new minimum recipes use40–45 seconds of real distinct windows with no source interval beyond8 seconds', () => {
  for (const count of [5, 6, 7, 8, 9, 10]) {
    const shots = Array.from({ length: count }, () => automatic(30, 2, 22));
    const plan = editing.planStockIntervals(shots, 45, 'cinematic', 40);
    assert.ok(plan.at(-1).outputEnd >= 40 && plan.at(-1).outputEnd <= 45);
    assert.ok(plan.every(shot => shot.end - shot.start <= 8 && shot.end <= 22 && shot.start >= 2));
    assert.equal(plan[0].start, 2); assert.equal(plan.at(-1).end, 22);
    exactFrameBudget(plan);
  }
  const old = editing.planStockIntervals([automatic(), automatic(), automatic()], 45, 'cinematic');
  assert.equal(old.at(-1).outputEnd, 17.5, 'A saved recipe without the opt-in policy is not silently changed');
});

test('minimum recipes reject fractional or sparse real footage instead of rounding, slowing or repeating it', () => {
  for (const shots of [Array.from({ length: 4 }, () => automatic(80)), Array.from({ length: 5 }, () => automatic(7.999)), Array.from({ length: 8 }, () => automatic(4.999)), Array.from({ length: 10 }, () => automatic(3.99))]) {
    assert.throws(() => editing.planStockIntervals(shots, 45, 'cinematic', 40), /Not enough related footage.*40-second.*original speed/);
  }
  assert.equal(editing.planStockIntervals(Array.from({ length: 10 }, () => automatic(4)), 45, 'cinematic', 40).at(-1).outputEnd, 40);
  assert.throws(() => editing.planStockIntervals([automatic()], 45, undefined, 40), /automatic cinematic/);
  assert.throws(() => editing.planStockIntervals([automatic()], 45, 'cinematic', 46), /length cap/);
  assert.throws(() => editing.planStockIntervals([{ duration: 40, trimMode: 'manual' }], 45, 'cinematic', 40), /automatic cinematic/);
  assert.throws(() => editing.planStockIntervals(Array.from({ length: 8 }, () => automatic(30)), 40.001, 'cinematic', 40.001), /whole native video frames/);
});

test('completed-output minimum checks reject missing and audio-padded short pictures, while old exports remain compatible', () => {
  for (const duration of [undefined, NaN, 17.5, 38, 39.999]) assert.throws(() => editing.assertStockReelMinimum(duration, 40), /rendered picture.*shorter.*40/);
  editing.assertStockReelMinimum(40, 40); editing.assertStockReelMinimum(45, 40);
  editing.assertStockReelMinimum(undefined); editing.assertStockReelMinimum(17.5);
});

test('marked brisk recipes prefer more native cuts with a three-second opening and six-second ceiling', () => {
  for (const count of [8, 9, 10]) {
    const shots = Array.from({ length: count }, () => automatic(30, 2, 22));
    const before = JSON.stringify(shots), plan = editing.planStockIntervals(shots, 45, 'cinematic', 40, 'brisk-v1');
    assert.equal(plan.length, count); assert.equal(plan[0].start, 2); assert.equal(plan[0].end, 5);
    assert.equal(plan.at(-1).end, 22); assert.equal(JSON.stringify(shots), before);
    assert.ok(plan.every(shot => shot.frames <= 6 * 24 && shot.end <= 22));
    assert.equal(plan.at(-1).outputEnd, count === 10 ? 43.5 : 40);
    assert.ok(new Set(plan.map(shot => shot.frames)).size >= 4, 'Brisk cuts keep varied lengths');
    exactFrameBudget(plan);
  }
  const ten = editing.planStockIntervals(Array.from({ length: 10 }, () => automatic(30)), 45, 'cinematic', 40, 'brisk-v1');
  assert.deepEqual(ten.map(shot => shot.frames / 24), [3, 4.5, 4, 5, 4.25, 4.75, 4.5, 4, 5, 4.5]);
  assert.equal(editing.DEFAULT_STOCK_REEL_OPTIONS.shotCadence, undefined);
  assert.equal(editing.AUTOMATIC_STOCK_SHOT_MAX_DURATION, 8, 'Saved minimum recipes keep their eight-second limit');
  assert.equal(editing.BRISK_STOCK_SHOT_MAX_DURATION, 6);
});

test('brisk minimum uses whole real frames and fails when a short opening or source bounds leave insufficient picture', () => {
  const exact = [automatic(3), ...Array.from({ length: 7 }, (_, at) => automatic(at < 5 ? 5.25 : 5.375))];
  const plan = editing.planStockIntervals(exact, 45, 'cinematic', 40, 'brisk-v1');
  assert.equal(plan.at(-1).outputEnd, 40); exactFrameBudget(plan);
  for (const [shot, index] of plan.map((shot, index) => [shot, index])) assert.ok(shot.end <= exact[index].duration + 1e-7);
  const short = exact.map(shot => ({ ...shot })); short.at(-1).duration -= .001; short.at(-1).end -= .001;
  assert.throws(() => editing.planStockIntervals(short, 45, 'cinematic', 40, 'brisk-v1'), /Not enough related footage/);
  assert.throws(() => editing.planStockIntervals(Array.from({ length: 8 }, () => automatic(5)), 45, 'cinematic', 40, 'brisk-v1'), /Not enough related footage/);
});

test('brisk marker cannot change manual, legacy, unsupported or unbounded recipes', () => {
  const shots = Array.from({ length: 8 }, () => automatic(30));
  for (const [items, cap, pacing, minimum, cadence] of [
    [shots, 45, 'cinematic', undefined, 'brisk-v1'], [shots, 45, undefined, 40, 'brisk-v1'],
    [shots, 45, 'selected', 40, 'brisk-v1'], [shots, 60, 'cinematic', 40, 'brisk-v1'],
    [shots, 45, 'cinematic', 39, 'brisk-v1'], [shots.slice(1), 45, 'cinematic', 40, 'brisk-v1'],
    [[...shots, ...shots.slice(0, 3)], 45, 'cinematic', 40, 'brisk-v1'],
    [shots.map((shot, index) => index ? shot : { ...shot, trimMode: 'manual' }), 45, 'cinematic', 40, 'brisk-v1'],
    [shots.map((shot, index) => index ? shot : { ...shot, trimMode: undefined }), 45, 'cinematic', 40, 'brisk-v1'],
    [shots, 45, 'cinematic', 40, 'unknown'],
  ]) assert.throws(() => editing.planStockIntervals(items, cap, pacing, minimum, cadence), /Brisk cadence|supported automatic shot cadence/);
  const old = editing.planStockIntervals(Array.from({ length: 5 }, () => automatic(30)), 45, 'cinematic', 40);
  assert.deepEqual(old.map(shot => shot.frames / 24), [8, 8, 8, 8, 8], 'A saved minimum recipe remains exact without the marker');
});

test('suggested previews stay bounded and clearly identify automatic—not semantic—selection', () => {
  assert.deepEqual(editing.suggestStockTrim(30), { start: 0, end: 6, trimMode: 'auto' });
  assert.deepEqual(editing.suggestStockTrim(30, true), { start: 0, end: 12, trimMode: 'auto' });
  assert.deepEqual(editing.suggestStockTrim(4, true), { start: 0, end: 4, trimMode: 'auto' });
  assert.throws(() => editing.suggestStockTrim(NaN), /readable duration/);
});

test('landscape pictures retain their complete source on a dark-neutral matte; portrait can fill conservatively', () => {
  const wide = editing.stockFraming({ width: 1920, height: 1080 });
  assert.match(wide.filter, /color=#121615/); assert.doesNotMatch(wide.filter, /crop=/);
  assert.match(wide.description, /Entire source picture/);
  assert.match(editing.stockFraming({ width: 720, height: 1280 }).filter, /crop=720:1280/);
});

test('the original music is deterministic stereo PCM with softened ends, audible detail and no clipping', () => {
  const music = editing.stockMusicWav(3, 'warm', 'specific-output');
  assert.deepEqual(music, editing.stockMusicWav(3, 'warm', 'specific-output'));
  assert.notDeepEqual(music, editing.stockMusicWav(3, 'reflective', 'specific-output'));
  assert.notDeepEqual(music, editing.stockMusicWav(3, 'warm', 'another-output'));
  assert.equal(music.toString('ascii', 0, 4), 'RIFF');
  assert.equal(music.readUInt16LE(22), 2); assert.equal(music.readUInt32LE(24), 24000);
  assert.equal(music.readUInt32LE(28), 96000); assert.equal(music.readUInt16LE(32), 4);
  assert.equal(music.readUInt32LE(40), music.length - 44);
  assert.equal(music.readInt16LE(44), 0); assert.equal(music.readInt16LE(46), 0);
  let peak = 0, squared = 0, differences = 0;
  for (let offset = 44; offset < music.length; offset += 4) {
    const left = music.readInt16LE(offset), right = music.readInt16LE(offset + 2);
    peak = Math.max(peak, Math.abs(left), Math.abs(right)); squared += left * left + right * right;
    if (left !== right) differences++;
  }
  assert.ok(peak > 500 && peak < 20000);
  assert.ok(Math.sqrt(squared / ((music.length - 44) / 2)) > 200);
  assert.ok(differences > 24000, 'Stereo voices are spatially distinct, not duplicated mono');
  assert.ok(Math.abs(music.readInt16LE(music.length - 4)) < peak * .01);
  assert.ok(Math.abs(music.readInt16LE(music.length - 2)) < peak * .01);
});

test('a maximum-length original stereo bed uses one small bounded buffer, with no added model or service', () => {
  const music = editing.stockMusicWav(105, 'journey', 'bounded-long-reel');
  assert.equal(music.length, 44 + 105 * 24000 * 4);
  assert.ok(music.length < 15 * 1024 * 1024);
  assert.throws(() => editing.stockMusicWav(107, 'warm', 'bounded'), /bounded/);
  assert.throws(() => editing.stockMusicWav(2, 'unknown', 'bounded'), /supported/);
});

test('instrumental phrases have clean attacks/releases, restrained levels and gentle musical ends for each mood', () => {
  const rms = (music, start, end) => {
    let sum = 0, count = 0;
    for (let frame = Math.floor(start * 24000); frame < Math.floor(end * 24000); frame++) {
      const left = music.readInt16LE(44 + frame * 4), right = music.readInt16LE(46 + frame * 4);
      sum += left * left + right * right; count += 2;
    }
    return Math.sqrt(sum / count);
  };
  for (const mood of ['reflective', 'warm', 'journey']) {
    const music = editing.stockMusicWav(12, mood, 'sunrise-phrase-detail');
    let largestJump = 0, peak = 0;
    for (let offset = 48; offset < music.length; offset += 2) {
      const current = music.readInt16LE(offset), previous = music.readInt16LE(offset - 4);
      largestJump = Math.max(largestJump, Math.abs(current - previous)); peak = Math.max(peak, Math.abs(current));
    }
    assert.ok(peak > 500 && peak < 12000, 'Original music is audible but leaves headroom; not a clipped foreground tone');
    assert.ok(largestJump < 3000, 'Attack/release gates avoid abrupt waveform discontinuities');
    assert.ok(rms(music, 0, .15) < rms(music, 3, 3.5), 'The introductory arrangement builds gently');
    assert.ok(rms(music, 11.9, 12) < rms(music, 8, 8.5) * .4, 'The resolving ending fades rather than cutting off');
  }
});
