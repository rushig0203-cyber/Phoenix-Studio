const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');
const project = path.resolve(__dirname,'..');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-review-tests-'));
process.env.PHOENIX_FFMPEG_PATH = path.join(project,'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project,'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
process.env.PHOENIX_CHANNEL_STORAGE = path.join(root,'private');
delete process.env.YOUTUBE_CLIENT_ID; delete process.env.YOUTUBE_CLIENT_SECRET;
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
process.chdir(root);
const edits = require(path.join(project,'src/lib/reviewEdits.ts'));
const reviews = require(path.join(project,'src/lib/reviewFiles.ts'));
const channels = require(path.join(project,'src/lib/channelConnections.ts'));
const audio = require(path.join(project,'src/lib/songAudio.ts'));
const jobId = crypto.randomUUID();
const reviewDirectory = reviews.reviewRoot();
const work = path.join(reviewDirectory,'work',`kids-${jobId}`);
let draft, originalHash;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function ff(args) { const result=spawnSync(process.env.PHOENIX_FFMPEG_PATH,['-hide_banner','-loglevel','error','-filter_threads','1','-filter_complex_threads','1',...args],{windowsHide:true,encoding:'utf8'}); assert.equal(result.status,0,result.stderr); }
test('editor reads real caption timings and clean master without changing original',async()=>{
  await reviews.ensureReviewFolders();fs.mkdirSync(work,{recursive:true});
  ff(['-f','lavfi','-i','color=c=blue:s=320x180:r=12','-f','lavfi','-i','sine=frequency=440:duration=4','-t','4','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',path.join(work,'clean.mp4')]);
  fs.copyFileSync(path.join(work,'clean.mp4'),reviews.outputPath(jobId,'youtube'));
  fs.writeFileSync(path.join(work,'captions.srt'),'1\n00:00:00,000 --> 00:00:02,000\nOriginal line one\n\n2\n00:00:02,000 --> 00:00:04,000\nOriginal line two\n');
  await reviews.saveReviewFile({id:jobId,title:'Test original',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'READY',targets:['youtube'],source:{kind:'upload',filename:`local-cartoon-${jobId}.mp4`,licence:'Test fixture'},outputs:{youtube:{filename:`${jobId}-youtube.mp4`,duration:4,width:320,height:180}},audience:'general',quality:{audio:'local-narration-music',captions:['Original line one','Original line two'],hashtags:['#Test'],checks:[]},processing:{jobId,start:0,end:4,format:'16:9',score:0,rank:0,reason:'Test',status:'COMPLETED'}});
  originalHash=hash(reviews.outputPath(jobId,'youtube'));
  const state=await edits.getReviewEditState(jobId);
  assert.equal(state.canReplaceCaptions,true);assert.equal(state.previewIsClean,true);assert.equal(state.draft.cues.length,2);assert.equal(state.duration,4);
  draft={...state.draft,title:'Edited test',trimStart:1,trimEnd:3,format:'1:1',volume:.5,cues:[{start:0,end:2,text:'Corrected first line'},{start:2,end:4,text:'Corrected second line'}]};
});
test('invalid trim and overlapping captions are rejected before queue writes',()=>{
  assert.throws(()=>edits.validateEdit({...draft,trimEnd:9},4),/trim/);
  assert.throws(()=>edits.validateEdit({...draft,cues:[{start:0,end:3,text:'x'},{start:2,end:4,text:'y'}]},4),/Caption times/);
  assert.deepEqual(edits.trimmedCues(draft),[{start:0,end:1,text:'Corrected first line'},{start:1,end:2,text:'Corrected second line'}]);
});
test('episode preview does not stack edited captions on its existing burned captions',async()=>{
  const id=crypto.randomUUID(),sourceId=crypto.randomUUID();
  const original=await reviews.getReviewFile(jobId);
  const source=reviews.sourcePath(sourceId,'episode.mp4');fs.mkdirSync(path.dirname(source),{recursive:true});
  fs.copyFileSync(path.join(work,'clean.mp4'),source);
  fs.copyFileSync(path.join(work,'clean.mp4'),reviews.outputPath(id,'youtube'));
  fs.writeFileSync(path.join(reviewDirectory,'source-processing-jobs.json'),JSON.stringify([{id:sourceId,sourceFile:'episode.mp4',reviewIds:[id]}]));
  await reviews.saveReviewFile({...original,id,source:{kind:'upload',filename:'episode.mp4',licence:'Test fixture'},processing:{...original.processing,jobId:sourceId,start:0}});
  const state=await edits.getReviewEditState(id);
  assert.equal(state.canReplaceCaptions,true);assert.equal(state.previewIsClean,false);assert.equal(await edits.getEditorMedia(id),null);
});
test('manual export is idempotent, playable, captioned, and retains original',async()=>{
  const job=await edits.queueReviewEdit(jobId,draft);
  assert.deepEqual((await edits.getReviewEditState(jobId)).draft,draft,'Export also persists the draft for reopening');
  assert.equal((await edits.queueReviewEdit(jobId,draft)).id,job.id);
  await assert.rejects(edits.queueReviewEdit(jobId,{...draft,title:'Different pending edit'}), edits.EditConflict);
  assert.equal((await edits.listReviewEdits(jobId))[0].draft.title,draft.title);
  const route=require(path.join(project,'src/app/api/review-edits/route.ts'));
  const scoped=await route.GET(new Request(`http://localhost/api/review-edits?reviewId=${jobId}`));
  assert.deepEqual((await scoped.json()).map(item=>item.id),[job.id]);
  assert.deepEqual(await (await route.GET(new Request(`http://localhost/api/review-edits?reviewId=${crypto.randomUUID()}`))).json(),[]);
  assert.equal((await route.GET(new Request('http://localhost/api/review-edits?reviewId=invalid'))).status,400);
  await edits.processNextReviewEdit();
  const finished=(await edits.listReviewEdits())[0];assert.equal(finished.status,'COMPLETED',finished.error);assert.equal(finished.progress,100);
  const file=await reviews.getReviewFile(job.outputId);assert.ok(file);assert.equal(file.editedFrom,jobId);assert.equal(file.outputs.youtube.width,720);assert.equal(file.outputs.youtube.height,720);assert.ok(Math.abs(file.outputs.youtube.duration-2)<.15);
  assert.equal(file.quality.captions[0],'Corrected first line');assert.equal(hash(reviews.outputPath(jobId,'youtube')),originalHash);
  const newState=await edits.getReviewEditState(file.id);assert.equal(newState.canReplaceCaptions,true);assert.equal(newState.draft.cues[0].start,0);
  await edits.removeReviewEdit(job.id);assert.equal((await edits.listReviewEdits()).length,0);assert.ok(fs.existsSync(reviews.outputPath(file.id,'youtube')));
});
test('completed legacy highlight rank order never selects another clip captions or music',async()=>{
  const sourceId=crypto.randomUUID(), firstId=crypto.randomUUID(), secondId=crypto.randomUUID();
  const original=await reviews.getReviewFile(jobId);
  const source=reviews.sourcePath(sourceId,'ranked.mp4');fs.copyFileSync(path.join(work,'clean.mp4'),source);
  for(const [index,id] of [firstId,secondId].entries()) {
    const directory=path.join(reviewDirectory,'work',`source-${sourceId}`,`clip-${index+1}`); fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'captions.srt'),`1\n00:00:00,000 --> 00:00:01,500\nCaption for ${id}\n`);
    fs.copyFileSync(path.join(work,'clean.mp4'),reviews.outputPath(id,'youtube'));
    await reviews.saveReviewFile({...original,id,source:{kind:'upload',filename:'ranked.mp4',licence:'fixture'},processing:{...original.processing,jobId:sourceId,start:index*2,end:(index+1)*2}});
  }
  fs.writeFileSync(path.join(reviewDirectory,'source-processing-jobs.json'),JSON.stringify([{id:sourceId,sourceFile:'ranked.mp4',mode:'highlights',status:'COMPLETED',reviewIds:[secondId,firstId]}]));
  assert.equal((await edits.getReviewEditState(firstId)).draft.cues[0].text,`Caption for ${firstId}`);
  assert.equal((await edits.getReviewEditState(secondId)).draft.cues[0].text,`Caption for ${secondId}`);
});
test('explicit stock editing artifacts remain independent of display order and enforce path containment',async()=>{
  const {artifactReference}=require(path.join(project,'src/lib/reviewArtifacts.ts'));
  const id=crypto.randomUUID(), original=await reviews.getReviewFile(jobId);
  const file={...original,id,source:{kind:'pexels',filename:'stock.mp4',licence:'fixture'},artifacts:{version:1,renderRevision:'fixture',finalVideo:artifactReference(reviews.outputPath(id,'youtube')),editing:{video:artifactReference(path.join(work,'clean.mp4')),offsetSeconds:0,captionsBaked:false},captions:artifactReference(path.join(work,'captions.srt'))}};
  await reviews.saveReviewFile(file);
  const state=await edits.getReviewEditState(id);assert.equal(state.canReplaceCaptions,true);assert.equal(state.previewIsClean,true);assert.equal(state.draft.cues[0].text,'Original line one');
  await reviews.saveReviewFile({...file,artifacts:{...file.artifacts,editing:{...file.artifacts.editing,video:'../private.mp4'}}});
  await assert.rejects(edits.getReviewEditState(id),/Invalid saved artifact/);
});
test('square edited copy stores square delivery metadata and a reusable clean master',async()=>{
  const original=await reviews.getReviewFile(jobId);
  await reviews.saveReviewFile({...original,delivery:{publishingFormat:'youtube-short',platform:'youtube',aspect:'16:9',requestedDuration:4,actualDuration:4,creationType:'general'}});
  const job=await edits.queueReviewEdit(jobId,{...draft,title:'Square metadata proof'});await edits.processNextReviewEdit();
  const file=await reviews.getReviewFile(job.outputId);assert.equal(file.delivery.aspect,'1:1');assert.equal(file.artifacts.editing.captionsBaked,false);
  assert.ok(file.artifacts.captions.endsWith('/captions.srt'));await edits.removeReviewEdit(job.id);
});
test('stock artifacts are streamed, probed, caption-validated and opened by the editor',async()=>{
  const generation=require(path.join(project,'src/lib/generation.ts'));
  const id=crypto.randomUUID(), directory=path.join(root,'stock-proof');fs.mkdirSync(directory);
  const clean=path.join(directory,'clean.mp4'), narration=path.join(directory,'voice.mp3');
  ff(['-f','lavfi','-i','color=c=green:s=320x180:r=12','-f','lavfi','-i','sine=frequency=440:duration=6','-t','6','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',clean]);
  ff(['-i',clean,'-vn','-threads','1',narration]);
  const payload={version:1,clean_video:'/tasks/fixture/clean.mp4',caption_file:'/tasks/fixture/captions.srt',narration_file:'/tasks/fixture/voice.mp3',music_present:false,caption_count:1};
  const original=await reviews.getReviewFile(jobId), realFetch=global.fetch, oldBase=process.env.MPT_BASE_URL;
  process.env.MPT_BASE_URL='http://127.0.0.1:8080';
  let calls=0;
  global.fetch=async url=>{calls++;assert.equal(new URL(url).hostname,'127.0.0.1');return new Response(String(url).endsWith('.mp4')?fs.readFileSync(clean):String(url).endsWith('.mp3')?fs.readFileSync(narration):'1\n00:00:00,000 --> 00:00:05,900\nWords actually timed by the renderer.\n');};
  try {
    await assert.rejects(generation.retainStockArtifacts(id,reviews.outputPath(id,'youtube'),{duration:6,width:320,height:180,hasAudio:true},undefined),/required clean-video/);assert.equal(calls,0);
    const result=await generation.retainStockArtifacts(id,reviews.outputPath(id,'youtube'),{duration:6,width:320,height:180,hasAudio:true},payload);
    assert.equal(result.musicPresent,false);assert.equal(result.cues[0].end,5.9);assert.equal(calls,3);
    await reviews.saveReviewFile({...original,id,source:{kind:'pexels',filename:'stock.mp4',licence:'fixture'},outputs:{youtube:{filename:`${id}-youtube.mp4`,duration:6,width:320,height:180}},artifacts:result.artifacts});
    const state=await edits.getReviewEditState(id);assert.equal(state.canReplaceCaptions,true);assert.equal(state.draft.cues[0].text,'Words actually timed by the renderer.');
    await assert.rejects(generation.retainStockArtifacts(id,reviews.outputPath(id,'youtube'),{duration:6,width:320,height:180,hasAudio:true},{...payload,caption_count:2}),/reported caption artifact/);
    const before=calls;await assert.rejects(generation.retainStockArtifacts(id,reviews.outputPath(id,'youtube'),{duration:6,width:320,height:180,hasAudio:true},{...payload,clean_video:'https://evil.example/clean.mp4'}),/non-local/);assert.equal(calls,before);
  } finally {global.fetch=realFetch;if(oldBase===undefined)delete process.env.MPT_BASE_URL;else process.env.MPT_BASE_URL=oldBase;}
});
test('cancelled edited job stays cancelled and old baked captions are not declared editable',async()=>{
  const job=await edits.queueReviewEdit(jobId,draft);await edits.removeReviewEdit(job.id);await edits.processNextReviewEdit();assert.ok(!fs.existsSync(reviews.outputPath(job.outputId,'youtube')));
  fs.renameSync(path.join(work,'clean.mp4'),path.join(work,'legacy-source.mp4'));
  const state=await edits.getReviewEditState(jobId);assert.equal(state.canReplaceCaptions,false);
  await assert.rejects(edits.saveReviewEditDraft(jobId,{...draft,captionsEnabled:true}),/baked-in captions/);
});
test('channel connections are truthful, encrypted and reject unbound OAuth callbacks',async()=>{
  let status=await channels.listChannels('http://localhost:3000');assert.equal(status.every(c=>!c.connected),true);
  await channels.saveChannelCredentials('youtube','test-client.apps.googleusercontent.com','test-secret-never-real');
  const pending=await channels.beginChannelOAuth('youtube','http://localhost:3000');const url=new URL(pending.url);
  assert.match(url.searchParams.get('scope'),/youtube.readonly/);assert.ok(url.searchParams.get('code_challenge'));assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:3000/api/channels/youtube/callback');
  assert.ok(!fs.readFileSync(path.join(root,'private/channels.enc'),'utf8').includes('test-secret-never-real'));
  await assert.rejects(channels.finishChannelOAuth('youtube','http://localhost:3000',url.searchParams.get('state'),'wrong-browser','fake-code'),/different browser/);
  assert.throws(()=>channels.assertLocalChannelRequest(new Request('http://localhost:3000/api/channels',{method:'POST',headers:{origin:'https://evil.example'}}),true),/directly/);
  const realFetch=global.fetch;
  global.fetch=async url=>{assert.match(String(url),/^https:\/\/graph.instagram.com\/me/);return Response.json({user_id:'fixture-user',username:'test_channel'});};
  try{await channels.connectInstagramToken('fixture-token-not-real-123456789');}finally{global.fetch=realFetch;}
  status=await channels.listChannels('http://localhost:3000');assert.equal(status.find(c=>c.platform==='instagram').connected,true);assert.ok(!JSON.stringify(status).includes('fixture-token'));
  await channels.disconnectChannel('instagram');assert.equal((await channels.listChannels('http://localhost:3000')).find(c=>c.platform==='instagram').connected,false);
});
test('song uploads require an actual audio track and never fall back to narration',async()=>{
  await assert.rejects(audio.requireSongAudio(undefined,150),/real sung recording/);
  const file=path.join(root,'test-audio.wav');ff(['-f','lavfi','-i','sine=frequency=440:duration=21','-threads','1',file]);
  const staged=await audio.stageSongAudio(new Response(fs.readFileSync(file)).body,'diagnostic-tone.wav');assert.ok(staged.duration>=21);
  assert.equal((await audio.requireSongAudio(staged.id,20)).id,staged.id);await assert.rejects(audio.requireSongAudio(staged.id,150),/no longer/);
  assert.throws(()=>audio.songAudioPath('../escape'),/Invalid/);
});
after(()=>{process.chdir(project);const exact=path.resolve(root);assert.ok(exact.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(exact).startsWith('phoenix-review-tests-'));fs.rmSync(exact,{recursive:true,force:true});});
