const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { validateVoiceStudioSettings, voiceStudioCues } = require('../src/lib/voiceStudio');
const revision = '724fb5abbf5502583fb520898d45929e62f02c0b';

test('only an approved, pinned local VoiceStudio installation can be selected', () => {
  const settings = { enabled: true, licenseAccepted: true, python: path.resolve('runtime/python.exe'), modelDirectory: path.resolve('models', revision) };
  assert.deepEqual(validateVoiceStudioSettings(settings), settings);
  for (const change of [{ licenseAccepted: false }, { enabled: false }, { python: 'https://example.com/python.exe' }, { python: '//server/python.exe' }, { python: path.resolve('other.exe') }, { modelDirectory: path.resolve('models/main') }]) {
    assert.throws(() => validateVoiceStudioSettings({ ...settings, ...change }), /configuration is invalid/);
  }
});

const fixture = () => ({ source: 'voicestudio-phrase-boundaries', cues: [
  { text: 'Meera planted a seed.', start: 0, end: 2 },
  { text: 'हरी पत्ती निकली।', start: 2.07, end: 4 },
] });
const captions = ['Meera planted a seed.', 'हरी पत्ती निकली।'];

test('English and Hindi captions retain their own measured speech and silence boundaries', () => {
  const cues = voiceStudioCues(fixture(), captions, 4, 4);
  assert.equal(cues[1].start, 2.07);
  assert.equal(cues[0].end, 2);
  assert.deepEqual(cues.map(cue => cue.text), captions);
  assert.equal(voiceStudioCues(fixture(), captions, 4, 3.8)[1].end, 3.8);
});

test('wrong, overlapping, missing and non-finite phrase evidence never becomes caption timing', () => {
  for (const value of [null, {}, { ...fixture(), source: 'invented' }, { ...fixture(), cues: [] },
    { ...fixture(), cues: [{ text: captions[0], start: -1, end: 2 }, fixture().cues[1]] },
    { ...fixture(), cues: [fixture().cues[0], { text: captions[1], start: 1, end: 4 }] },
    { ...fixture(), cues: [fixture().cues[0], { text: 'Unrelated narration', start: 2.07, end: 4 }] },
    { ...fixture(), cues: [fixture().cues[0], { text: captions[1], start: 2.07, end: Infinity }] },
  ]) assert.throws(() => voiceStudioCues(value, captions, 4));
  assert.throws(() => voiceStudioCues(fixture(), captions, 3));
  assert.throws(() => voiceStudioCues(fixture(), captions, 4, NaN));
});

test('the one-shot adapter retains offline, one-thread and parent-exit containment', () => {
  const fs = require('node:fs');
  const adapter = fs.readFileSync(path.join(__dirname, '../src/lib/voiceStudio.ts'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, 'synthesize-voicestudio.py'), 'utf8');
  assert.match(adapter, /HeavyWorkWaitError/);
  assert.match(adapter, /800 \* 1024 \* 1024/);
  assert.match(adapter, /HF_HUB_OFFLINE: "1"/);
  assert.match(adapter, /"--parent-pid", String\(process.pid\)/);
  assert.match(worker, /auto_download=False/);
  assert.match(worker, /intra_op_num_threads=1, inter_op_num_threads=1/);
  assert.match(worker, /psutil\.Process\(os\.getppid\(\)\)/);
  assert.match(worker, /os\._exit\(3\)/);
});
