// Actual pure synthesis only: no FFmpeg/model/provider/owner-file writes or jobs.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const allocations = [];
const boundedBuffer = Object.create(Buffer);
boundedBuffer.alloc = bytes => { allocations.push(bytes); return Buffer.alloc(bytes); };
const fixture = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../src/lib/stockReel.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: fixture, exports: fixture.exports, Buffer: boundedBuffer });
const music = fixture.exports;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
function statistics(wav, start, end) {
  let square = 0, peak = 0, difference = 0, previous = wav.readInt16LE(44 + Math.floor(start * 24000) * 4), count = 0;
  for (let index = Math.floor(start * 24000); index < Math.floor(end * 24000); index++) {
    const sample = wav.readInt16LE(44 + index * 4);
    square += sample * sample; peak = Math.max(peak, Math.abs(sample));
    difference = Math.max(difference, Math.abs(sample - previous)); previous = sample; count++;
  }
  return { rms: Math.sqrt(square / count), peak, difference };
}

test('old/manual omitted-version recipes retain exact legacy PCM hashes', () => {
  const expected = {
    reflective: '2597a533e0428fa252684e5d7f774b31f5c836f4cb182da18eac42d5c9f02c3e',
    warm: '71e4f0f519d9dcd2d5cb7f5f66d46524315939dc6152cf6046d3662b0d9e48e8',
    journey: 'da459ec667f105834f17254d11500bcac83f56c688a1cc69d1ae1aeefbbd0531',
  };
  for (const mood of Object.keys(expected)) {
    assert.equal(hash(music.stockMusicWav(3, mood, 'legacy-recipe-fixture')), expected[mood]);
    assert.equal(hash(music.stockMusicWav(3, mood, 'legacy-recipe-fixture', 1)), expected[mood]);
  }
  assert.equal(music.DEFAULT_STOCK_REEL_OPTIONS.musicVersion, undefined);
});

test('new version is opt-in and exactly reproducible from saved mood/seed', () => {
  const first = music.stockMusicWav(4, 'reflective', 'saved-reel-one', 2);
  assert.equal(hash(first), hash(music.stockMusicWav(4, 'reflective', 'saved-reel-one', 2)));
  assert.notEqual(hash(first), hash(music.stockMusicWav(4, 'reflective', 'saved-reel-two', 2)));
  assert.notEqual(hash(first), hash(music.stockMusicWav(4, 'reflective', 'saved-reel-one')));
  assert.deepEqual(plain(music.stockMusicArrangement('warm', 'saved-one')), plain(music.stockMusicArrangement('warm', 'saved-one')));
  assert.match(music.stockMusicArrangementDescription('reflective', 'saved-reel-one'), /Music recipe v2 .* BPM; harmonic path .* melody .* rhythm .* accompaniment/);
});

test('same-mood new seeds vary all arrangement choices, not only pitch/volume', () => {
  const profiles = Array.from({ length: 128 }, (_, index) => music.stockMusicArrangement('reflective', `new-reel-${index}`));
  assert.equal(new Set(profiles.map(profile => profile.style)).size, 4);
  assert.equal(new Set(profiles.map(profile => profile.progression)).size, 4);
  assert.equal(new Set(profiles.map(profile => profile.rhythm)).size, 4);
  assert.equal(new Set(profiles.map(profile => profile.accompaniment)).size, 4);
  assert.equal(new Set(profiles.map(profile => profile.melody)).size, 8);
  assert.equal(new Set(profiles.map(profile => profile.tonic)).size, 12);
  assert.ok(new Set(profiles.map(profile => profile.bpm)).size >= 16);
  assert.equal(new Set(profiles.map(profile => profile.id)).size, profiles.length);
});

test('different arrangement families produce different normalized audio at the same key and tempo', () => {
  const seen = new Map();
  let pair;
  for (let index = 0; index < 2500 && !pair; index++) {
    const seed = `same-key-tempo-${index}`, profile = music.stockMusicArrangement('warm', seed), identity = `${profile.tonic}:${profile.bpm}`;
    const previous = seen.get(identity);
    if (previous && previous.profile.style !== profile.style && previous.profile.melody !== profile.melody && previous.profile.rhythm !== profile.rhythm) pair = [previous, { seed, profile }];
    else if (!previous) seen.set(identity, { seed, profile });
  }
  assert.ok(pair, 'Use actual seed recipes matched for key/tempo; no test override of production tables.');
  const left = music.stockMusicWav(8, 'warm', pair[0].seed, 2), right = music.stockMusicWav(8, 'warm', pair[1].seed, 2);
  let product = 0, aSquare = 0, bSquare = 0;
  for (let index = 24000; index < 7 * 24000; index += 4) {
    const a = left.readInt16LE(44 + index * 4), b = right.readInt16LE(44 + index * 4);
    product += a * b; aSquare += a * a; bSquare += b * b;
  }
  assert.ok(Math.abs(product / Math.sqrt(aSquare * bSquare)) < .65, 'Audio differs beyond a constant gain, despite the same pitch centre and tempo.');
});

test('all four arrangements are audible stereo with soft ends, headroom and bounded attacks', () => {
  const styles = new Map();
  for (let index = 0; index < 100 && styles.size < 4; index++) {
    const seed = `audible-family-${index}`, profile = music.stockMusicArrangement('journey', seed);
    if (!styles.has(profile.style)) styles.set(profile.style, seed);
  }
  assert.equal(styles.size, 4);
  for (const [style, seed] of styles) {
    const wav = music.stockMusicWav(12, 'journey', seed, 2), overall = statistics(wav, 0, 12), middle = statistics(wav, 3, 8);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt16LE(22), 2); assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    assert.ok(middle.rms > 120 && overall.peak < 12000, `${style} has audible detail and headroom`);
    assert.ok(overall.difference < 1200, `${style} note boundaries have bounded per-sample changes`);
    assert.ok(statistics(wav, 0, .15).rms < middle.rms, `${style} enters softly`);
    assert.ok(statistics(wav, 11.9, 12).rms < middle.rms * .4, `${style} ends softly`);
    let stereoDifference = 0;
    for (let offset = 44; offset < wav.length; offset += 256) stereoDifference += Math.abs(wav.readInt16LE(offset) - wav.readInt16LE(offset + 2));
    assert.ok(stereoDifference > 1000, `${style} is not duplicated mono`);
  }
});

test('the longest supported new reel allocates only one existing-size PCM buffer', () => {
  allocations.length = 0;
  const wav = music.stockMusicWav(105, 'journey', 'bounded-long-reel', 2);
  assert.equal(wav.length, 44 + 105 * 24000 * 4);
  assert.ok(wav.length < 11 * 1024 * 1024);
  assert.deepEqual(allocations, [wav.length], 'Do not add a second audio-sized arrangement/sample/effects buffer.');
});

test('invalid version, duration and seed fail before allocating new PCM', () => {
  allocations.length = 0;
  for (const duration of [NaN, Infinity, -1, 0, 107]) assert.throws(() => music.stockMusicWav(duration, 'warm', 'seed', 2), /bounded/);
  assert.throws(() => music.stockMusicWav(2, 'unknown', 'seed', 2), /supported/);
  assert.throws(() => music.stockMusicWav(2, 'warm', 'seed', 3), /version/);
  for (const seed of ['', 'x'.repeat(257), undefined]) assert.throws(() => music.stockMusicWav(2, 'warm', seed, 2), /bounded saved reel seed/);
  assert.deepEqual(allocations, []);
});
