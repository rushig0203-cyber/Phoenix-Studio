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
test('video acceleration and sound tempo agree; no slowdown or extreme speed is accepted', () => {
  assert.deepEqual(motion.stockPlaybackFilters(1), { video: 'setpts=PTS-STARTPTS', audio: '' });
  assert.deepEqual(motion.stockPlaybackFilters(1.25), { video: 'setpts=(PTS-STARTPTS)/1.25', audio: 'atempo=1.25,' });
  for (const speed of [0, .75, 1.41, NaN, Infinity]) assert.throws(() => motion.stockPlaybackFilters(speed), /modestly accelerate/);
});
