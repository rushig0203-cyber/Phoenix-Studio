const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');
const project = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-library-tests-'));
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({ project:path.join(project,'tsconfig.json'), transpileOnly:true, compilerOptions:{module:'commonjs',moduleResolution:'node'} });
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
process.chdir(root);
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const media = require(path.join(project, 'src/lib/reviewMedia.ts'));
const posters = require(path.join(project, 'src/lib/reviewPoster.ts'));
const brief = require(path.join(project, 'src/lib/stockBrief.ts'));
const generation = require(path.join(project, 'src/lib/generation.ts'));
let fixture, filename, originalBytes;

test('media target respects publishing intent and rejects unrendered platforms', async () => {
  await reviews.ensureReviewFolders();
  fixture = reviews.makeReviewFile({title:'Library fixture',targets:['youtube'],source:{kind:'upload',filename:'fixture.mp4',licence:'Test'},audience:'general',quality:{audio:'natural-audio-preserved',captions:['Fixture captions'],hashtags:['#Fixture'],checks:[]}});
  fixture.status='READY'; fixture.outputs.youtube={filename:`${fixture.id}-youtube.mp4`,width:320,height:180,duration:2};
  filename=reviews.outputPath(fixture.id,'youtube');
  const rendered=spawnSync(process.env.PHOENIX_FFMPEG_PATH,['-hide_banner','-loglevel','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=320x180:r=12','-f','lavfi','-i','sine=frequency=440:duration=2','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',filename],{windowsHide:true,encoding:'utf8'});
  assert.equal(rendered.status,0,rendered.stderr);
  await reviews.saveReviewFile(fixture); originalBytes=fs.readFileSync(filename);
  assert.equal(media.reviewMediaPath(fixture),filename);
  assert.equal(media.reviewMediaPath(fixture,'instagram'),null);
  assert.equal(media.selectedReviewTarget({...fixture,outputs:{...fixture.outputs,instagram:{}},delivery:{platform:'youtube'}}),'youtube');
});
test('byte ranges cover seek, suffix, open-ended and invalid requests', () => {
  assert.deepEqual(media.parseByteRange('bytes=0-9',100),{start:0,end:9});
  assert.deepEqual(media.parseByteRange('bytes=90-',100),{start:90,end:99});
  assert.deepEqual(media.parseByteRange('bytes=-20',100),{start:80,end:99});
  assert.deepEqual(media.parseByteRange('bytes=50-500',100),{start:50,end:99});
  for(const header of ['bytes=100-','bytes=20-10','bytes=-0','bytes=0-2,4-5','bytes=-','bytes=999999999999999999999-']) assert.equal(media.parseByteRange(header,100),null);
});
test('real streaming returns exact partial bytes and HEAD without decoding a movie',async()=>{
  const response=await media.streamReviewMedia(new Request('http://localhost:3000/media',{headers:{range:'bytes=5-54'}}),filename);
  assert.equal(response.status,206);assert.equal(response.headers.get('content-length'),'50');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),originalBytes.subarray(5,55));
  const head=await media.streamReviewMedia(new Request('http://localhost:3000/media',{method:'HEAD'}),filename);
  assert.equal(head.status,200);assert.equal(head.body,null);assert.equal(Number(head.headers.get('content-length')),originalBytes.length);
  const invalid=await media.streamReviewMedia(new Request('http://localhost:3000/media',{headers:{range:'bytes=999999999-'}}),filename);
  assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),`bytes */${originalBytes.length}`);
});
test('real poster is a cached JPEG; simultaneous requests share the same result',async()=>{
  const [a,b]=await Promise.all([posters.reviewPoster(filename),posters.reviewPoster(filename)]);
  assert.equal(a[0],255);assert.equal(a[1],216);assert.deepEqual(a,b);
  assert.deepEqual(await posters.reviewPoster(filename),a);
  assert.equal(fs.readdirSync(path.join(reviews.reviewRoot(),'previews')).filter(name=>name.endsWith('.jpg')).length,1);
});
test('one-click Trash is idempotent, recoverable, and keeps video bytes intact',async()=>{
  await Promise.all([reviews.removeReviewFile(fixture.id),reviews.removeReviewFile(fixture.id)]);
  assert.equal((await reviews.readReviewFiles()).length,0);
  assert.equal(await reviews.getReviewFile(fixture.id),null);
  assert.ok((await reviews.readReviewFiles(true))[0].trashedAt);
  await reviews.saveReviewFile({...fixture,title:'Stale worker must not restore this'});
  assert.equal((await reviews.readReviewFiles()).length,0);
  assert.deepEqual(fs.readFileSync(filename),originalBytes);
  await reviews.restoreReviewFile(fixture.id);
  assert.equal((await reviews.readReviewFiles()).length,1);
  assert.equal((await reviews.getReviewFile(fixture.id)).title,'Library fixture');
});
test('visual briefs preserve chosen scene order and avoid unrelated generic office variants',()=>{
  assert.deepEqual(brief.stockVisualBrief('Morning routine','irrelevant',[' opening curtains ','pouring water','writing a plan']),['opening curtains','pouring water','writing a plan']);
  const terms=brief.stockVisualBrief('A calmer morning','Open the curtains to let daylight in. Pour water into a glass. Write down the first task.');
  assert.ok(terms.length);assert.ok(!terms.some(term=>/business team|office meeting|professional workplace/.test(term)));
  assert.equal(brief.checkStockScript('customer support','nothing relevant',75).score,0);
});
test('failed local narration never creates a generic replacement script',async()=>{
  const realFetch=global.fetch;
  global.fetch=async()=>Response.json({response:'Too short.'});
  try {await assert.rejects(generation.createStockScript({topic:'Customer support',duration:75,creationType:'business'}),/No generic replacement script was used/);}
  finally{global.fetch=realFetch;}
});
test('supplied stock narration is preserved; invalid length asks for correction',async()=>{
  const script=Array(12).fill('A customer explains the problem to the helpful shop assistant.').join(' ');
  assert.equal(await generation.createStockScript({topic:'Customer support',duration:45,script}),script);
  await assert.rejects(generation.createStockScript({topic:'Customer support',duration:75,script:'Too short.'}),/will not replace your words/);
});
after(()=>{process.chdir(project);assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('phoenix-library-tests-'));fs.rmSync(root,{recursive:true,force:true});});
