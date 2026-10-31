// Isolated queue state and fake frames/providers; no owner files or account calls.
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const project=path.resolve(__dirname,'..');
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-visual-music-test-'));
fs.cpSync(path.join(project,'assets/music/lofi-cc0-v1'),path.join(directory,'assets/music/lofi-cc0-v1'),{recursive:true});
process.chdir(directory);
const analysis=require('../src/lib/videoPostingAnalysis'),source=require('../src/lib/sourceProcessing'),library=require('../src/lib/stockMusicLibrary'),manifest=require('../assets/music/lofi-cc0-v1/manifest.json');
const originals={enabled:analysis.visualPostingEnabled,frame:analysis.extractPostingFrame,request:analysis.requestVisualPosting};
test('samples follow final cut order, original trim and acceleration rather than the unedited sources',()=>{
  const {stockPostingSamples}=require('../src/lib/stockReel');
  const intervals=[{start:10,end:12,outputStart:0,outputEnd:2},{start:30,end:33,outputStart:2,outputEnd:5},{start:50,end:53.6,outputStart:5,outputEnd:8,speed:1.2},{start:70,end:78,outputStart:8,outputEnd:12,speed:2}];
  const samples=stockPostingSamples(intervals);assert.deepEqual(samples.map(sample=>sample.shotIndex),[0,2,3]);
  for(const [index,seconds] of [11.2,51.2,75.6].entries())assert.ok(Math.abs(samples[index].sourceSeconds-seconds)<.00001);
  assert.throws(()=>stockPostingSamples([]),/duration/);assert.throws(()=>stockPostingSamples([{start:0,end:1,outputStart:2,outputEnd:10}]),/outside/);
});
const frames=[1,2,3].map(seconds=>({filename:'fixture.mp4',seconds,filter:'scale=720:1280'}));
const response={...analysis.parseVisualPosting({observations:[{frame:1,visible:'Dogs resting on the grass.'}],caption:'A little pause in the grass.',captionVariants:[],hashtags:['#Dogs','#Nature'],confidence:'clear',musicBrief:{version:1,mood:'warm',energy:'low',reason:'Relaxed dogs resting on a sunny lawn.',evidenceFrames:[1]}},true),model:analysis.VISION_MODEL,provider:'groq'};
async function job(){const bytes=Buffer.from('isolated stream fixture');return source.createStockReelJob([1,2,3,4].map(mediaId=>({provider:'pexels',mediaId:String(Math.floor(Math.random()*1e9)+mediaId),sourcePage:`https://www.pexels.com/video/${mediaId}/`,creator:'Fixture',title:'Dogs resting',start:0,end:8,trimMode:'auto',open:async()=>({stream:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),expectedBytes:bytes.length})})),{requestId:crypto.randomUUID(),caption:'',theme:'Dogs',maxDuration:20,options:{audio:'music',mood:'reflective',transition:'cut',framing:'auto',pacing:'cinematic',shotCadence:'adaptive-v3',musicLibrary:'cc0-lofi-v1'}});}
after(()=>{Object.assign(analysis,{visualPostingEnabled:originals.enabled,extractPostingFrame:originals.frame,requestVisualPosting:originals.request});process.chdir(project);assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));assert.match(path.basename(directory),/^phoenix-visual-music-test-/);fs.rmSync(directory,{recursive:true,force:true});});
test('visual mood is reserved before rendering, retained on retry and reuses all three caption frames',async()=>{
  let extracted=0,requested=0;analysis.visualPostingEnabled=()=>true;analysis.extractPostingFrame=async()=>{extracted++;return Buffer.from([255,216,255,217]);};analysis.requestVisualPosting=async(images)=>{requested++;assert.equal(images.length,3);return response;};
  const queued=await job();assert.deepEqual(queued.stockSource.visualMusic,{version:1});
  const prepared=await source.prepareStockVisualMusic(queued,frames,'exact-picture-plan',20);
  assert.equal(extracted,3);assert.equal(requested,1);assert.equal(prepared.visualMusic.result.caption,response.caption);
  assert.equal(manifest.recordings.find(track=>track.id===prepared.musicRecording.trackId).moods.includes('warm'),true);
  const retry=await source.prepareStockVisualMusic({...queued,stockSource:prepared},frames,'exact-picture-plan',20);
  assert.deepEqual(retry.musicRecording,prepared.musicRecording);assert.equal(requested,1);
  await assert.rejects(source.prepareStockVisualMusic({...queued,stockSource:prepared},frames,'changed-picture-plan',20),/different cuts/);
});
test('missing consent and free-provider failures retain usable music without blocking the reel',async()=>{
  analysis.visualPostingEnabled=()=>false;analysis.extractPostingFrame=async()=>{throw Error('Frames must not be extracted without consent');};
  const disabled=await job(),retained=await source.prepareStockVisualMusic(disabled,frames,'not-enabled',20);
  assert.deepEqual(retained.musicRecording,disabled.stockSource.musicRecording);assert.match(retained.visualMusic.detail,/not enabled/);
  analysis.visualPostingEnabled=()=>true;analysis.extractPostingFrame=async()=>Buffer.from([255,216,255,217]);analysis.requestVisualPosting=async()=>{throw Error('Free quota reached');};
  const limited=await job(),fallback=await source.prepareStockVisualMusic(limited,frames,'quota-fixture',20);
  assert.deepEqual(fallback.musicRecording,limited.stockSource.musicRecording);assert.equal(fallback.visualMusic.result,undefined);assert.match(fallback.visualMusic.detail,/unavailable/);
  const legacy={...limited,stockSource:{...limited.stockSource,visualMusic:undefined}};
  assert.equal(await source.prepareStockVisualMusic(legacy,frames,'legacy',20),legacy.stockSource);
});
test('uncertain visuals never force a different mood and the library mapping stays explicitly limited',()=>{
  for(const mood of ['calm','reflective','uncertain'])assert.equal(library.stockRecordingMood({...response.musicBrief,mood},'reflective'),'reflective');
  assert.equal(library.stockRecordingMood({...response.musicBrief,mood:'playful'},'reflective'),'warm');
  assert.equal(library.stockRecordingMood({...response.musicBrief,mood:'energetic'},'reflective'),'journey');
});
