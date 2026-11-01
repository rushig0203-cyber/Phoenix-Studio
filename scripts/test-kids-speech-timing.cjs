const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });
const { kidsVoicePlan, parseSpeechTiming, measuredKidsCaptionCues, regroupKidsPhraseCues, kidsSpeechPerformance, mergeBriefKidsCaptions } = require('../src/lib/kidsSpeechTiming');

test('visual scenes retain whole measured phrase boundaries instead of word-weighted durations', () => {
  const cue=(text,start,end)=>({text,start,end,duration:end-start});
  const scenes=['Bunny clapped once.','Bear waited.'], phrases=[cue(scenes[0],0,1),cue(scenes[1],1,10)];
  assert.deepEqual(regroupKidsPhraseCues(scenes,phrases),phrases);
  const grouped=regroupKidsPhraseCues(['The bunny held the bright kite.','भालू ने इंतज़ार किया।'],[
    cue('The bunny held',.2,.8),cue('the bright kite.',1.1,2.3),cue('भालू ने इंतज़ार किया।',4.2,8),
  ]);
  assert.deepEqual(grouped,[cue('The bunny held the bright kite.',.2,2.3),cue('भालू ने इंतज़ार किया।',4.2,8)]);
  assert.equal(phrases[0].end,1,'Measured phrase evidence is not mutated');
});

test('scene regrouping rejects changed text, partial phrases, invalid timing and incomplete evidence', () => {
  const cue=(text,start,end)=>({text,start,end,duration:end-start});
  const scenes=['Bunny clapped.','Bear waited.'],phrases=[cue(scenes[0],0,1),cue(scenes[1],2,10)];
  for(const invalid of [[],[null],[cue('Changed text.',0,1),phrases[1]],[cue(scenes[0],-1,1),phrases[1]],
    [phrases[0],cue(scenes[1],.5,10)],[phrases[0],cue(scenes[1],2,Infinity)],[...phrases,cue('Extra line.',10,11)]]){
    assert.equal(regroupKidsPhraseCues(scenes,invalid),null);
  }
  assert.equal(regroupKidsPhraseCues(['Bunny','clapped. Bear waited.'],phrases),null,'No word onset is invented inside a measured phrase');
  assert.equal(regroupKidsPhraseCues(['Bunny clapped. Bear waited.'],[phrases[0]]),null);
  assert.equal(regroupKidsPhraseCues([],phrases),null);
  assert.equal(regroupKidsPhraseCues(Array(251).fill('Bunny clapped.'),phrases),null);
});

test('the real render workflow keeps quoted scene boundaries and uses VoiceStudio phrase evidence', {skip:process.platform!=='win32'}, async () => {
  const fs=require('node:fs'),os=require('node:os');
  const previous=process.cwd(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-scene-timing-test-'));
  const savedFetch=global.fetch,environment=Object.fromEntries(['PHOENIX_KIDS_STOCK_BACKGROUNDS','PHOENIX_FFMPEG_PATH','PHOENIX_FFPROBE_PATH'].map(key=>[key,process.env[key]]));
  let studio,animation,savedVoice,savedAnimation;
  const scenes=['Bunny said, “Look!”','Bear waited.'];let captured;
  try {
    process.chdir(directory);process.env.PHOENIX_KIDS_STOCK_BACKGROUNDS='0';
    process.env.PHOENIX_FFMPEG_PATH=path.join(previous,'node_modules','@ffmpeg-installer','win32-x64','ffmpeg.exe');
    process.env.PHOENIX_FFPROBE_PATH=path.join(previous,'node_modules','@ffprobe-installer','win32-x64','ffprobe.exe');
    fs.mkdirSync(path.join(directory,'scripts'));fs.copyFileSync(path.join(previous,'scripts','synthesize-local-voice.ps1'),path.join(directory,'scripts','synthesize-local-voice.ps1'));
    global.fetch=async()=>{throw Error('Provider/network access is forbidden in the scene timing fixture');};
    studio=require('../src/lib/voiceStudio');animation=require('../src/lib/kidsAnimation');
    const {renderKidsVideo}=require('../src/lib/kidsRenderer');
    assert.equal(require('../src/lib/reviewFiles').reviewRoot(),path.join(directory,'storage','Phoenix Studio Review Files'),'The fixture must never use project or owner stores');
    savedVoice=studio.synthesizeVoiceStudio;savedAnimation=animation.prepareKidsAnimation;
    studio.synthesizeVoiceStudio=async(captions,output)=>{
      assert.deepEqual(captions,scenes,'Caption synthesis must not combine two approved scenes across a quotation mark');
      const pcm=Buffer.alloc(16000*2*20),header=Buffer.alloc(44);
      header.write('RIFF',0);header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);
      header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);
      header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
      fs.writeFileSync(output,Buffer.concat([header,pcm]));
      return {voice:'isolated-silent-timing-fixture',cues:[{text:captions[0],start:0,end:1,duration:1},{text:captions[1],start:1,end:20,duration:19}]};
    };
    animation.prepareKidsAnimation=async options=>{captured=options;throw Error('Captured visual scene timing fixture');};
    const renderDirectory=path.join(directory,'storage','Phoenix Studio Review Files','work','kids-scene-timing-fixture');
    await assert.rejects(renderKidsVideo('scene-timing-fixture',{topic:'Bunny and Bear in the garden',creationType:'children-story',duration:20,script:scenes.join(' '),scriptApproved:true,sceneNarration:scenes},async()=>{}),/Captured visual scene timing fixture/);
    assert.deepEqual(captured.cues.map(cue=>[cue.text,cue.start,cue.end]),[[scenes[0],0,1],[scenes[1],1,20]]);
    const timing=JSON.parse(fs.readFileSync(path.join(renderDirectory,'audio-timing.json'),'utf8'));
    assert.equal(timing.visualSceneTiming,'voicestudio-phrase-boundaries');
    assert.equal(timing.captionTiming,'voicestudio-phrase-boundaries');
  } finally {
    if(savedVoice)studio.synthesizeVoiceStudio=savedVoice;if(savedAnimation)animation.prepareKidsAnimation=savedAnimation;global.fetch=savedFetch;
    for(const [key,value] of Object.entries(environment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    process.chdir(previous);assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));assert.ok(!fs.lstatSync(directory).isSymbolicLink());
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

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
