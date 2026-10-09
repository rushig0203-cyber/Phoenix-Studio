const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const motion = require('../src/lib/stockMotion.ts');
test('motion probes remain small and within the real source picture', () => {
  for (const [start, end] of [[0, 60], [3, 7], [0, .5]]) {
    const windows = motion.stockMotionSamples(start, end);
    assert.ok(windows.length >= 1 && windows.length <= 3);
    for (const window of windows) {
      assert.ok(window.start >= start && window.end <= end && window.end - window.start <= 4.5);
      const args = motion.stockMotionArgs('local source.mp4', window);
      assert.match(args[args.indexOf('-vf') + 1], /fps=2,scale=96:54/);
      assert.equal(args[args.indexOf('-filter_threads') + 1], '1');
      assert.equal(args[args.indexOf('-threads') + 1], '1');
      assert.ok(args.includes('-an') && !args.includes('-stream_loop'));
    }
  }
  assert.throws(() => motion.stockMotionSamples(3, 2), /Invalid/);
});
test('measurements reject incomplete or impossible samples rather than inventing movement', () => {
  assert.equal(motion.stockMotionScore('lavfi.signalstats.YAVG=2\nlavfi.signalstats.YAVG=4\nlavfi.signalstats.YAVG=6'), 4);
  assert.equal(motion.stockMotionScore('no decoded frames'), undefined);
  assert.equal(motion.stockMotionScore('lavfi.signalstats.YAVG=2'), undefined);
  assert.equal(motion.stockMotionScore('lavfi.signalstats.YAVG=999\nlavfi.signalstats.YAVG=3\nlavfi.signalstats.YAVG=6'), undefined);
});

test('sustained movement outranks a brief exposure/edit spike without changing legacy scores', () => {
  const report = values => values.map(value => `lavfi.signalstats.YAVG=${value}`).join('\n');
  const transient = report([1, 1, 180, 190, 1, 1, 1, 1, 1]);
  const sustained = report([22, 24, 25, 23, 22, 24, 26, 23, 24]);
  assert.equal(motion.stockSustainedMotionScore(transient), 1);
  assert.equal(motion.stockSustainedMotionScore(sustained), 24);
  assert.ok(motion.stockSustainedMotionScore(sustained) > motion.stockSustainedMotionScore(transient));
  assert.ok(motion.stockMotionScore(transient) > motion.stockMotionScore(sustained), 'Legacy saved recipes retain their original mean scoring');
  assert.equal(motion.stockSustainedMotionScore(report([12, 14, 16, 18])), 15, 'Even frame counts average only the middle pair');
  assert.equal(motion.stockSustainedMotionScore(report([100, 110, 120, 115, 118, 119, 122])), 118, 'Sustained high movement is not discarded');
});

test('robust movement measurements fail unknown with the same bounded evidence requirements', () => {
  for (const report of ['no decoded frames', 'lavfi.signalstats.YAVG=2',
    'lavfi.signalstats.YAVG=999\nlavfi.signalstats.YAVG=3\nlavfi.signalstats.YAVG=6',
    Array.from({ length: 17 }, () => 'lavfi.signalstats.YAVG=3').join('\n')]) {
    assert.equal(motion.stockSustainedMotionScore(report), undefined);
  }
  assert.equal(motion.stockSustainedMotionScore('lavfi.signalstats.YAVG=0\nlavfi.signalstats.YAVG=0\nlavfi.signalstats.YAVG=0'), 0, 'Genuine static footage has a known zero score');
});
test('video acceleration and sound tempo agree; no slowdown or extreme speed is accepted', () => {
  assert.deepEqual(motion.stockPlaybackFilters(1), { video: 'setpts=PTS-STARTPTS', audio: '' });
  assert.deepEqual(motion.stockPlaybackFilters(1.25), { video: 'setpts=(PTS-STARTPTS)/1.25', audio: 'atempo=1.25,' });
  for (const speed of [0, .75, 1.41, NaN, Infinity]) assert.throws(() => motion.stockPlaybackFilters(speed), /modestly accelerate/);
});

test('speech reads the prepared output-time shot rather than truncating the original sped source', () => {
  const args = motion.stockSpeechSampleArgs('prepared-shot-1.mp4', 'speech-1.wav', 2.625);
  assert.equal(args[args.indexOf('-i') + 1], 'prepared-shot-1.mp4');
  assert.equal(args[args.indexOf('-t') + 1], '2.625000');
  assert.ok(!args.includes('-ss') && !args.includes('-af'), 'Trim and tempo were applied to the shot before speech sampling');
  assert.equal(args[args.indexOf('-ar') + 1], '16000');
  for (const duration of [0, -1, 106, NaN]) assert.throws(() => motion.stockSpeechSampleArgs('shot', 'sample', duration), /Invalid/);
});
