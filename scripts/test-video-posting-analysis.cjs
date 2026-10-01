const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname,'..');
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-video-copy-'));
process.chdir(temp);
const settings=require('../src/lib/writingSettings');
const originalRead=settings.readWritingSettings, originalFetch=global.fetch;
const selected={provider:'groq',model:settings.WRITING_GROQ_MODEL,apiKey:'gsk_test_not_real_12345678901234',freePlanConfirmed:true,allowVideoFrames:true};
const analysis=require('../src/lib/videoPostingAnalysis');
const source=require('../src/lib/sourceProcessing');
const {WritingWaitError}=require('../src/lib/groqWriter');
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]);
const result={observations:[{frame:1,visible:'Water falling over rocks.'}],caption:'Water cascades over a rocky ledge.',hashtags:['#Waterfall','#Nature'],confidence:'clear'};
let calls=[];
beforeEach(()=>{fs.rmSync(path.join(temp,'storage'),{recursive:true,force:true});calls=[];settings.readWritingSettings=()=>({...selected});global.fetch=async(url,init)=>{calls.push({url,init});return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});};});
after(()=>{settings.readWritingSettings=originalRead;global.fetch=originalFetch;process.chdir(project);fs.rmSync(temp,{recursive:true,force:true});});
test('vision sends only three bounded JPEGs to the explicitly allowed provider',async()=>{
  const value=await analysis.requestVisualPosting([jpeg,jpeg,jpeg],'Actual transcript');assert.equal(value.caption,result.caption);
  const request=JSON.parse(calls[0].init.body);assert.equal(request.model,analysis.VISION_MODEL);assert.equal(request.reasoning_effort,'none');
  assert.equal(request.messages[0].content.filter(item=>item.type==='image_url').length,3);
  assert.match(request.messages[0].content[0].text,/untrusted content/);assert.match(request.messages[0].content[0].text,/Actual transcript/);
  assert.equal(calls[0].url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(calls[0].init.redirect,'error');
});
test('absent consent/free confirmation and oversized inputs never transmit',async()=>{
  for(const override of [{allowVideoFrames:false},{freePlanConfirmed:false},{provider:'ollama'}]){settings.readWritingSettings=()=>({...selected,...override});await assert.rejects(analysis.requestVisualPosting([jpeg,jpeg,jpeg],''));}
  settings.readWritingSettings=()=>selected;await assert.rejects(analysis.requestVisualPosting([Buffer.alloc(250001),jpeg,jpeg],''));assert.equal(calls.length,0);
});
test('429 preserves a durable wait and does not repeatedly hit the provider',async()=>{
  global.fetch=async()=>{calls.push(1);return new Response('',{status:429,headers:{'retry-after':'120'}});};
  await assert.rejects(analysis.requestVisualPosting([jpeg,jpeg,jpeg],''),WritingWaitError);
  await assert.rejects(analysis.requestVisualPosting([jpeg,jpeg,jpeg],''),WritingWaitError);assert.equal(calls.length,1);
});
test('truncated, unsupported and invalid answers never become captions',async()=>{
  for(const payload of [{choices:[{finish_reason:'length',message:{content:JSON.stringify(result)}}]},{choices:[{finish_reason:'stop',message:{content:'{"caption":"generic"}'}}]}]){
    global.fetch=async()=>Response.json(payload);await assert.rejects(analysis.requestVisualPosting([jpeg,jpeg,jpeg],''));
  }
  global.fetch=async()=>new Response('',{status:402});await assert.rejects(analysis.requestVisualPosting([jpeg,jpeg,jpeg],''),/billing/);
});
test('samples are chronological and bounded, evidence validates frame IDs and tags',()=>{
  assert.deepEqual(analysis.sampleTimes(60),[6,30,54]);assert.throws(()=>analysis.sampleTimes(0));
  assert.throws(()=>analysis.parseVisualPosting({...result,hashtags:['not-a-tag']}));
  assert.throws(()=>analysis.parseVisualPosting({...result,observations:[{frame:4,visible:'Invented extra frame'}]}));
});
test('new posting copy retains report citations and footage attribution',()=>{
  const text=analysis.visualPostCopy('A scene-specific caption.',{source:{providerUrl:'https://pixabay.com/videos/fixture/'},quality:{research:{source:'BBC',publishedAt:'2026-10-01',url:'https://www.bbc.com/news/fixture',limitation:'Single report; illustrative visuals.'}}});
  assert.match(text,/A scene-specific caption/);assert.match(text,/pixabay.com/);assert.match(text,/Report source: BBC/);assert.match(text,/Single report/);
});
test('a competing heavy job leaves analysis queued and never transmits frames',async()=>{
  const resources=require('../src/lib/renderResources'); const reviews=require('../src/lib/reviewFiles');
  const originalStatus=resources.heavyWorkStatus, originalAdmission=resources.tryWithLocalRenderSlot;
  resources.heavyWorkStatus=async()=>({lease:null,waitingForMemory:false});
  resources.tryWithLocalRenderSlot=async()=>({acquired:false});
  try{
    const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';await reviews.ensureReviewFolders();fs.writeFileSync(reviews.outputPath(id,'youtube'),'fake-output');
    await reviews.saveReviewFile({id,title:'Fixture',status:'READY',createdAt:'2026-10-01',updatedAt:'2026-10-01',source:{kind:'upload',filename:'fixture.mp4'},outputs:{youtube:{duration:10}},quality:{captions:[],hashtags:[]}});
    await analysis.processNextPostingAnalysis();
    assert.equal((await reviews.getReviewFile(id)).quality.postingAnalysis,undefined);assert.equal(calls.length,0);
  }finally{resources.heavyWorkStatus=originalStatus;resources.tryWithLocalRenderSlot=originalAdmission;}
});
test('subtitles follow reliable audible speech, never stock metadata or replaced audio',()=>{
  const part={start:10,end:30,boundary:'target'};
  const speech={start:12,end:16,text:'The water flows over these rocks.',avgLogprob:-0.2,noSpeechProbability:0.01};
  const yes=source.automaticSubtitles(part,[speech],true);assert.equal(yes.decision,'speech');assert.equal(yes.cues[0].start,2);
  assert.equal(source.automaticSubtitles(part,[],true).decision,'none');
  assert.equal(source.automaticSubtitles(part,[speech],false).cues.length,0);
  assert.equal(source.automaticSubtitles(part,[{...speech,noSpeechProbability:0.9}],true).decision,'uncertain');
  assert.equal(source.automaticSubtitles(part,[{start:12,end:16,text:'stock waterfall title'}],true).cues.length,0);
  assert.equal(source.automaticSubtitles(part,[speech],true,'Speech model unavailable').decision,'uncertain');
  assert.equal(source.automaticSubtitles(part,[{...speech,start:40,end:45}],true).cues.length,0);
});
