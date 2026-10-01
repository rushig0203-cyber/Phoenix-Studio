const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FIXTURE, encodeArguments, hasEncoder, parseUsage, verifyProbe } = require('./benchmark-encoders.cjs');

test('inventory requires an exact video encoder record rather than an incidental name', () => {
  assert.equal(hasEncoder(' V..... h264_amf AMD encoder\n V....D libx264 H.264 encoder', 'h264_amf'), true);
  assert.equal(hasEncoder(' A..... h264_amf audio\nnotes mention libx264', 'libx264'), false);
  assert.equal(hasEncoder(' V..... h264_amf_fake other', 'h264_amf'), false);
});

test('both benchmark encoders have bounded threads, input, duration and no overwrite', () => {
  for (const encoder of ['libx264', 'h264_amf']) {
    const args = encodeArguments(encoder, 'fixture.mp4');
    assert.ok(args.includes('-n'));
    assert.equal(args[args.indexOf('-t') + 1], String(FIXTURE.duration));
    assert.equal(args[args.indexOf('-c:v') + 1], encoder);
    for (let index = 0; index < args.length; index++) if (['-threads', '-filter_threads', '-filter_complex_threads'].includes(args[index])) assert.equal(args[index + 1], '1');
  }
  assert.throws(() => encodeArguments('arbitrary', 'fixture.mp4'), /Unsupported/);
});

test('verification rejects empty or truncated output even when encoder returned success', () => {
  const probe = { format: { duration: '3.000000' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, nb_read_frames: '72' }] };
  assert.equal(verifyProbe(probe).frames, 72);
  for (const broken of [{}, { ...probe, format: { duration: '0' } }, { ...probe, streams: [{ ...probe.streams[0], nb_read_frames: '70' }] }]) assert.throws(() => verifyProbe(broken), /unexpected/);
});

test('memory unsupported by FFmpeg stays unknown instead of claiming zero usage', () => {
  assert.equal(parseUsage('bench: maxrss=0kB').peakProcessRssMiB, null);
  assert.equal(parseUsage('').peakProcessRssMiB, null);
  assert.deepEqual(parseUsage('bench: utime=1.200s stime=0.050s rtime=1.400s\nbench: maxrss=65536kB'), { peakProcessRssMiB: 64, cpuSeconds: 1.25, encoderWallSeconds: 1.4 });
});
