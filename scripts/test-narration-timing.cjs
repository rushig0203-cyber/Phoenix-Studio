const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { kidsCaptionCues, boundedNarrationTempo, kidsAudioFilter, kidsNarrationTiming } = require('../src/lib/kidsRenderer.ts');

test('song caption estimates begin with recording at zero and retain all lyric text through the ending', () => {
  const lyrics = ['Sing hello, little bear!', 'Wave your paws and share.'];
  const cues = kidsCaptionCues(lyrics, 60);
  assert.equal(cues[0].start, 0);
  assert.equal(cues.at(-1).end, 60);
  assert.deepEqual(cues.map(cue => cue.text), lyrics);
  assert.equal(cues[0].end, cues[1].start);
  assert.ok(cues.every(cue => cue.duration > 0));
});

test('story tempo allows only small corrections and rejects destructive speed changes', () => {
  assert.equal(boundedNarrationTempo(60, 60), 'atempo=1.00000');
  assert.equal(boundedNarrationTempo(64.8, 60), 'atempo=1.08000');
  assert.equal(boundedNarrationTempo(55.2, 60), 'atempo=0.92000');
  for (const seconds of [10, 54, 66, 150]) {
    assert.throws(() => boundedNarrationTempo(seconds, 60), /at most 8%.*script.*retained/);
  }
  for (const [source, target] of [[NaN, 60], [60, 0], [0, 60], [60, Infinity]]) {
    assert.throws(() => boundedNarrationTempo(source, target), /valid measured/);
  }
});

test('song filter never shifts or stretches supplied singing and story filter uses bounded correction', () => {
  const song = kidsAudioFilter(60, 60, true);
  assert.doesNotMatch(song, /adelay|atempo|\[2:a\]/);
  assert.match(song, /^\[1:a\]atrim=duration=60,asetpts/);
  assert.throws(() => kidsAudioFilter(45, 60, true), /songs are not stretched/);
  assert.match(kidsAudioFilter(62, 60, false), /atempo=1\.03333/);
  assert.throws(() => kidsAudioFilter(35, 60, false), /at most 8%/);
});

test('story duration follows measured narration within publishing ranges instead of stretching to a preset', () => {
  const input = { duration: 75, creationType: 'children-story', publishingFormat: 'youtube-short' };
  assert.deepEqual(kidsNarrationTiming(input, 69), { targetSeconds: 69, tempoFactor: 1, decision: 'measured-narration' });
  assert.equal(kidsNarrationTiming(input, 89.5).targetSeconds, 89.5);
  const shortEdge = kidsNarrationTiming(input, 57);
  assert.equal(shortEdge.targetSeconds, 60);
  assert.equal(shortEdge.tempoFactor, 0.95);
  assert.equal(shortEdge.decision, 'bounded-profile-correction');
  assert.equal(kidsNarrationTiming(input, 94.5).targetSeconds, 90);
  assert.equal(kidsNarrationTiming({ ...input, publishingFormat: 'instagram-reel' }, 49).targetSeconds, 49);
  assert.equal(kidsNarrationTiming({ ...input, targetPlatform: 'Instagram', publishingFormat: undefined }, 49).targetSeconds, 49);
  assert.equal(kidsNarrationTiming({ ...input, duration: 180, publishingFormat: 'youtube-full' }, 167).targetSeconds, 167);
  assert.throws(() => kidsNarrationTiming(input, 31), /script.*retained.*60–90/);
  assert.throws(() => kidsNarrationTiming(input, 112), /script.*retained.*60–90/);
  assert.throws(() => kidsNarrationTiming(input, NaN), /valid measured/);
  assert.equal(kidsNarrationTiming({ ...input, creationType: 'children-song' }, 90).targetSeconds, 75);
});

test('captions span the measured narration and direct legacy lengths retain their explicit duration', () => {
  const input = { duration: 75, creationType: 'children-story', publishingFormat: 'youtube-short' };
  const timing = kidsNarrationTiming(input, 69);
  const cues = kidsCaptionCues(['Bear finds his missing kite.', 'Fox helps him fly it home.'], timing.targetSeconds);
  assert.equal(cues.at(-1).end, 69);
  assert.equal(kidsNarrationTiming({ ...input, duration: 20 }, 20.8).targetSeconds, 20);
});

test('actual bundled FFmpeg runs both timing filters without a phantom intro or silent cut-off', () => {
  const ffmpeg = process.env.PHOENIX_FFMPEG_PATH?.trim() || path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  assert.ok(fs.existsSync(ffmpeg), 'Bundled FFmpeg must be available for this timing regression');
  for (const targetSeconds of [1, 4]) for (const song of [true, false]) for (const music of ['silent', 'tone']) {
    // A short tone fixture checks sample timing only, not subjective voice quality.
    const narrationSeconds = song ? targetSeconds : targetSeconds * 1.04;
    const filter = kidsAudioFilter(narrationSeconds, targetSeconds, song);
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
      '-f', 'lavfi', '-i', `sine=frequency=660:sample_rate=48000:duration=${narrationSeconds}`,
      '-f', 'lavfi', '-i', music === 'silent' ? 'anullsrc=r=48000:cl=mono' : `sine=frequency=220:sample_rate=48000:duration=${targetSeconds}`,
      '-filter_complex', filter, '-map', '[a]', '-t', String(targetSeconds), '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1',
    ], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
    const samples = result.stdout.length / 4;
    assert.ok(Math.abs(samples / 48000 - targetSeconds) < 0.03, `Unexpected ${song ? 'song' : 'story'} output duration ${samples / 48000} with ${music} music`);
    function energy(start, length) { let sum = 0; for (let i = start; i < start + length; i++) sum += result.stdout.readFloatLE(i * 4) ** 2; return sum / length; }
    assert.ok(energy(100, 2000) > 0.00001, 'Audio must begin near zero instead of a invented intro gap');
    assert.ok(energy(samples - 3000, 2000) > 0.00001, 'Ending must remain audible');
    if (song) {
      let crossings = 0;
      const start = Math.round(samples * 0.25), count = Math.round(samples * 0.5);
      for (let i = start; i < start + count - 1; i++) if (result.stdout.readFloatLE(i * 4) < 0 && result.stdout.readFloatLE((i + 1) * 4) >= 0) crossings++;
      assert.ok(Math.abs(crossings / (count / 48000) - 660) <= 3, 'The sung recording pitch must be preserved');
    }
  }
});

test('the final distinct narrated sound survives the bounded timing correction', () => {
  const ffmpeg = process.env.PHOENIX_FFMPEG_PATH?.trim() || path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  for (const narrationSeconds of [0.96, 1, 1.04]) {
    // The final 200ms has a distinct pitch, standing in for the last word. A
    // music-only tail or looping the opening would pass a generic energy test.
    const expression = `aevalsrc=if(lt(t\\,${narrationSeconds - 0.2})\\,0.12*sin(2*PI*660*t)\\,0.12*sin(2*PI*1200*t)):s=48000:d=${narrationSeconds}`;
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_complex_threads', '1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
      '-f', 'lavfi', '-i', expression,
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
      '-filter_complex', kidsAudioFilter(narrationSeconds, 1, false), '-map', '[a]', '-t', '1',
      '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1',
    ], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
    assert.equal(result.stdout.length, 48000 * 4);
    let crossings = 0, energy = 0;
    const start = 43200, count = 4000;
    for (let i = start; i < start + count; i++) {
      const value = result.stdout.readFloatLE(i * 4);
      energy += value ** 2;
      if (value < 0 && result.stdout.readFloatLE((i + 1) * 4) >= 0) crossings++;
    }
    assert.ok(energy / count > 0.00001, 'The final narrated sound must remain audible');
    assert.ok(Math.abs(crossings / (count / 48000) - 1200) < 25, `Final narrated sound lost or pitch-shifted for ${narrationSeconds}s source`);
  }
});
