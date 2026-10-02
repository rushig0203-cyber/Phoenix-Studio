const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });
const { kidsVoicePlan, parseSpeechTiming, measuredKidsCaptionCues, kidsSpeechPerformance, mergeBriefKidsCaptions } = require('../src/lib/kidsSpeechTiming');

test('voice plan preserves all spoken tokens and identifies only explicitly named dialogue', () => {
  const script = 'Pip picked up the kite. Pip said, “I can reach it!” Coco asked, “Can I help?” “Nobody named this speaker.”';
  const plan = kidsVoicePlan(script, ['Pip', 'Coco']);
  const quoted = plan.utterances.filter(part => part.speaker !== -1);
  assert.deepEqual(quoted.map(part => part.speaker), [0, 1]);
  assert.equal(plan.utterances.at(-1).speaker, -1);
  const normalize = value => value.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(plan.utterances.map(part => part.text).join(' ')), normalize(script));
  assert.equal(kidsVoicePlan('A quiet story without dialogue.', ['Pip', 'Coco']).utterances[0].speaker, -1);
  assert.equal(kidsVoicePlan('“Wait,” Pip said.', ['Pip','Coco']).utterances[0].speaker, 0);
  assert.equal(kidsVoicePlan('Coco answered, “Of course!”', ['Pip','Coco']).utterances.at(-1).speaker, 1);
  assert.equal(kidsVoicePlan('Pip said, “Wait,” said Coco.', ['Pip','Coco']).utterances.find(part => part.text==='Wait,').speaker, -1);
});

const fixture = () => ({ version: 1, source: 'windows-speech-events', words: [
  { text: 'Pip', seconds: .15, characterPosition: 12, speaker: -1 },
  { text: 'said', seconds: .4, characterPosition: 16, speaker: -1 },
  { text: 'Hello', seconds: 1.1, characterPosition: 72, speaker: 0 },
  { text: 'Coco', seconds: 1.5, characterPosition: 78, speaker: 0 },
], visemes: [
  { seconds: 1.1, duration: .2, viseme: 3, speaker: 0 },
  { seconds: 1.3, duration: .2, viseme: 0, speaker: 0 },
  { seconds: 1.5, duration: .3, viseme: 6, speaker: 0 },
], bookmarks: [{name:'role-0', seconds:1}] });

test('captions follow engine onsets and bounded tempo rather than proportional guesses', () => {
  const cues = measuredKidsCaptionCues(['Pip said,', '“Hello Coco!”'], fixture(), 2, 1.9);
  assert.ok(cues); assert.ok(Math.abs(cues[1].start - 1.045) < 1e-6);
  assert.equal(cues[1].end, 1.9);
  assert.equal(measuredKidsCaptionCues(['An unrelated invented line'], fixture(), 2, 2), null);
  assert.equal(measuredKidsCaptionCues(['Pip said hello Coco'], {...fixture(), words:[]}, 2, 2), null);
});

test('measured mouth events close through silence and never animate the narrator as a cast member', () => {
  const frames = kidsSpeechPerformance(fixture(), 2, 2, 12);
  assert.equal(frames.length, 24);
  assert.equal(frames[0].mouthOpen, 0);
  assert.equal(frames[14].speaker, 0); assert.ok(frames[14].mouthOpen > 0);
  assert.equal(frames[17].mouthOpen, 0); assert.equal(frames[23].mouthOpen, 0);
  const narrator = {...fixture(),visemes:fixture().visemes.map(event=>({...event,speaker:-1}))};
  assert.ok(kidsSpeechPerformance(narrator,2,2).every(frame=>frame.mouthOpen === 0));
  assert.throws(()=>kidsSpeechPerformance(fixture(),2,Infinity),/bounded/);
});

test('malformed or unbounded speech metadata is rejected without fabricating timing', () => {
  assert.ok(parseSpeechTiming(fixture()));
  assert.equal(parseSpeechTiming({...fixture(),source:'invented'}),null);
  assert.equal(parseSpeechTiming({...fixture(),visemes:[{seconds:-1,duration:1,viseme:3}]}),null);
  assert.equal(parseSpeechTiming({...fixture(),words:Array.from({length:6001},()=>fixture().words[0])}),null);
  for (const field of ['words','visemes','bookmarks']) assert.equal(parseSpeechTiming({...fixture(),[field]:[null]}),null);
  assert.equal(parseSpeechTiming({...fixture(),words:[{text:'test',seconds:1,speaker:4}]}),null);
  assert.equal(parseSpeechTiming({...fixture(),words:[...fixture().words].reverse()}),null);
  assert.equal(parseSpeechTiming({...fixture(),voices:'private-invalid-data'}),null);
});

test('brief spoken interjections merge without losing wording, onsets or visual scene boundaries', () => {
  const cue = (text,start,end) => ({text,start,end,duration:end-start});
  const source = [cue('Look!',0,.25),cue('The kite is flying.',.25,3),cue('Hooray!',3,3.3)];
  const merged = mergeBriefKidsCaptions(source);
  assert.equal(merged.map(item=>item.text).join(' '),source.map(item=>item.text).join(' '));
  assert.equal(merged.length,1); assert.equal(merged[0].start,0); assert.equal(merged[0].end,3.3);
  assert.equal(source.length,3,'visual timing cues are not mutated');
  const dense=[cue('One two three four five six seven eight nine ten eleven twelve.',0,4),cue('Go!',4,4.2)];
  assert.equal(mergeBriefKidsCaptions(dense).length,2,'overlong merged caption is not forced');
});
