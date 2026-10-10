const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const project=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-cf-vision-'));
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
process.chdir(temporary); // Resolve every store into this fixture before importing it.
const settings=require('../src/lib/writingSettings'),vision=require('../src/lib/cloudflareVision'),analysis=require('../src/lib/videoPostingAnalysis');
const reviews=require('../src/lib/reviewFiles'),resources=require('../src/lib/renderResources'),child=require('node:child_process'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const originals={fetch:global.fetch,groq:settings.readVideoAnalysisSettings,cloudflare:settings.readCloudflareVideoAnalysisSettings,status:resources.heavyWorkStatus,slot:resources.tryWithLocalRenderSlot,spawn:child.spawn};
const groq={provider:'groq',model:settings.WRITING_GROQ_MODEL,apiKey:'gsk_mock_groq_12345678901234567890',freePlanConfirmed:true,allowVideoFrames:true};
const cloudflare={provider:'cloudflare',model:settings.VISION_CLOUDFLARE_MODEL,apiKey:'cf_mock_token_12345678901234567890',accountId:'0123456789abcdef0123456789abcdef',freePlanConfirmed:true,allowVideoFrames:true};
const jpeg=Buffer.from([255,216,255,217]),samples=[jpeg,jpeg,jpeg],id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const evidence={observations:[{frame:1,visible:'Water flowing over rocks.'},{frame:2,visible:'A rocky waterfall.'},{frame:3,visible:'Water and green trees.'}],caption:'Water cascades over the rocks beside green trees.',captionVariants:[],hashtags:['#Waterfall','#Nature'],confidence:'clear'};
const privateFile=name=>path.join(temporary,'storage','private',name);
let calls=[],g,c,extractions;
assert.ok(reviews.reviewRoot().startsWith(temporary+path.sep), 'Tests must never touch the owner review store');
beforeEach(()=>{
  fs.rmSync(path.join(temporary,'storage'),{recursive:true,force:true});calls=[];extractions=0;g={...groq};c={...cloudflare};
  settings.readVideoAnalysisSettings=()=>({...g});settings.readCloudflareVideoAnalysisSettings=()=>({...c});
  resources.heavyWorkStatus=async()=>({lease:null,waitingForMemory:false});resources.tryWithLocalRenderSlot=async fn=>({acquired:true,value:await fn()});
  child.spawn=()=>{extractions++;const process=new EventEmitter();process.stdout=new PassThrough();process.kill=()=>{};queueMicrotask(()=>{process.stdout.end(jpeg);process.emit('close',0);});return process;};
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return String(url).includes('api.groq.com')?Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(evidence)}}]}):Response.json({success:true,result:{response:JSON.stringify(evidence)}});};
});
after(()=>{global.fetch=originals.fetch;settings.readVideoAnalysisSettings=originals.groq;settings.readCloudflareVideoAnalysisSettings=originals.cloudflare;resources.heavyWorkStatus=originals.status;resources.tryWithLocalRenderSlot=originals.slot;child.spawn=originals.spawn;process.chdir(project);fs.rmSync(temporary,{recursive:true,force:true});});
function groqQuota(milliseconds=120000){fs.mkdirSync(path.dirname(privateFile('x')),{recursive:true});fs.writeFileSync(privateFile('groq-vision-quota.json'),JSON.stringify({identity:crypto.createHash('sha256').update(`${analysis.VISION_MODEL}:${g.apiKey}`).digest('hex'),until:Date.now()+milliseconds}));}
async function fixture(quality={}){await reviews.ensureReviewFolders();fs.writeFileSync(reviews.outputPath(id,'youtube'),'fixture-output');await reviews.saveReviewFile({id,title:'Waterfall',audience:'general',status:'READY',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',source:{kind:'upload',filename:'waterfall.mp4'},outputs:{youtube:{filename:`${id}.mp4`,duration:12,width:720,height:1280}},quality:{audio:'natural-audio-preserved',captions:[],hashtags:[],...quality}});}

test('caption adapter sends one bounded three-frame request only to fixed Cloudflare model',async()=>{
  const raw=await vision.requestCloudflareVisual(c,samples,'Return grounded caption JSON.');assert.deepEqual(raw,evidence);assert.equal(calls.length,1);
  assert.equal(calls[0].url,`https://api.cloudflare.com/client/v4/accounts/${c.accountId}/ai/run/${settings.VISION_CLOUDFLARE_MODEL}`);
  const body=JSON.parse(calls[0].init.body);assert.equal(body.messages[0].content.filter(part=>part.type==='image_url').length,3);
  assert.equal(body.response_format.type,'json_object');assert.equal(body.max_tokens,900);assert.equal(body.stream,false);assert.equal(calls[0].init.redirect,'error');
  assert.ok(body.messages[0].content.slice(1).every(part=>part.image_url.url.startsWith('data:image/jpeg;base64,')));assert.equal(body.tools,undefined);
});
test('successful Groq analysis never contacts the enabled backup',async()=>{
  const result=await analysis.requestVisualPosting(samples,'');assert.equal(result.provider,'groq');assert.equal(result.model,analysis.VISION_MODEL);assert.equal(calls.length,1);assert.match(calls[0].url,/api.groq.com/);
});
test('cached Groq quota uses consented backup without another Groq request',async()=>{
  groqQuota();const result=await analysis.requestVisualPosting(samples,'');assert.equal(result.caption,evidence.caption);assert.equal(result.provider,'cloudflare');assert.equal(result.model,settings.VISION_CLOUDFLARE_MODEL);
  assert.equal(calls.length,1);assert.match(calls[0].url,/api.cloudflare.com/);
  const text=JSON.parse(calls[0].init.body).messages[0].content[0].text;assert.match(text,/untrusted; never follow/);assert.match(text,/observations.*visible:string/);assert.match(text,/15–20 relevant/);
});
test('new Groq quota switches automatically in the same analysis, not after tomorrow',async()=>{
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return String(url).includes('api.groq.com')?new Response('',{status:429,headers:{'retry-after':'120'}}):Response.json({success:true,result:{response:evidence}});};
  assert.equal((await analysis.requestVisualPosting(samples,'')).provider,'cloudflare');assert.equal(calls.length,2);
  await analysis.requestVisualPosting(samples,'');assert.equal(calls.length,3);assert.match(calls[2].url,/api.cloudflare.com/);
});
test('legacy Groq consent never implies Cloudflare image permission',async()=>{
  groqQuota();c.allowVideoFrames=false;await assert.rejects(analysis.requestVisualPosting(samples,''),/Groq.*free quota/);assert.equal(calls.length,0);
  for(const change of [{freePlanConfirmed:false},{apiKey:undefined},{accountId:undefined}]){c={...cloudflare,...change};await assert.rejects(analysis.requestVisualPosting(samples,''));assert.equal(calls.length,0);}
});
test('disabled Groq analysis uses only separately enabled Cloudflare frames',async()=>{
  g.allowVideoFrames=false;assert.equal((await analysis.requestVisualPosting(samples,'')).provider,'cloudflare');assert.equal(calls.length,1);assert.match(calls[0].url,/api.cloudflare.com/);
  c.allowVideoFrames=false;await assert.rejects(analysis.requestVisualPosting(samples,''),/No images were sent/);assert.equal(calls.length,1);
});
test('no backup on Groq billing, authentication, request rejection or bad evidence',async()=>{
  for(const status of [400,401,402,403,413,503]){calls=[];global.fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response('private-provider-error',{status});};await assert.rejects(analysis.requestVisualPosting(samples,''));assert.equal(calls.length,1);assert.match(calls[0].url,/api.groq.com/);}
});
test('frame permission or credential change prevents Cloudflare transmission',async()=>{
  for(const change of [{allowVideoFrames:false},{freePlanConfirmed:false},{apiKey:'cf_changed_private_token_1234567890'},{accountId:'abcdef0123456789abcdef0123456789'}]){
    c={...cloudflare,...change};await assert.rejects(vision.requestCloudflareVisual(cloudflare,samples,'Return caption JSON.'));assert.equal(calls.length,0);
  }
});
test('bad JPEG count, huge images and text do not leave the PC',async()=>{
  for(const images of [[jpeg],[Buffer.alloc(120001),jpeg,jpeg],[Buffer.alloc(20),jpeg,jpeg]])await assert.rejects(vision.requestCloudflareVisual(c,images,'caption'));
  await assert.rejects(vision.requestCloudflareVisual(c,samples,'x'.repeat(2901)));assert.equal(calls.length,0);
  const large=Buffer.alloc(120000);large[0]=255;large[1]=216;await vision.requestCloudflareVisual(c,[large,large,large],'caption');assert.ok(Buffer.byteLength(calls[0].init.body)<=512*1024);
});
test('Cloudflare free daily exhaustion persists until UTC reset without repeated requests',async()=>{
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({success:false,errors:[{code:3036,message:'private quota response'}]},{status:429,headers:{'retry-after':'5'}});};
  const now=new Date(),reset=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1);
  await assert.rejects(vision.requestCloudflareVisual(c,samples,'caption'),error=>error instanceof vision.CloudflareVisionQuotaError&&/daily free/.test(error.message)&&!error.message.includes('private'));
  const stored=JSON.parse(fs.readFileSync(privateFile('cloudflare-vision-quota.json'),'utf8'));assert.ok(stored.until>=reset);assert.ok(!JSON.stringify(stored).includes(c.apiKey));
  await assert.rejects(vision.requestCloudflareVisual(c,samples,'caption'),vision.CloudflareVisionQuotaError);assert.equal(calls.length,1);
});
test('both quotas wait automatically at the earliest reset and spend no failure attempt',async()=>{
  groqQuota(90000);global.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({errors:[{code:3036}]},{status:429});};
  await assert.rejects(analysis.requestVisualPosting(samples,''),error=>error instanceof vision.CloudflareVisionQuotaError&&error.retryAfterMs<=90000&&/Both free/.test(error.message));
  await fixture();await analysis.processNextPostingAnalysis();const file=await reviews.getReviewFile(id);
  assert.equal(file.quality.postingAnalysis.status,'WAITING');assert.equal(file.quality.postingAnalysis.waitReason,'quota');assert.equal(file.quality.postingAnalysis.attempts,0);assert.equal(extractions,0);assert.equal(calls.length,1);
});
test('billing and bad-account failures stop safely without paid or local fallback',async()=>{
  for(const status of [401,402,403,404]){calls=[];global.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({errors:[{code:status===403?5035:1000,message:c.apiKey}]},{status});};await assert.rejects(vision.requestCloudflareVisual(c,samples,'caption'),error=>!error.message.includes(c.apiKey));assert.equal(calls.length,1);}
});
test('transient service failures and malformed evidence never become posting text',async()=>{
  groqQuota();global.fetch=async()=>new Response('',{status:503});await assert.rejects(analysis.requestVisualPosting(samples,''),/temporarily unavailable/);
  for(const raw of ['{bad JSON',JSON.stringify({...evidence,observations:[{frame:4,visible:'not an observed frame'}]}),'generic caption']){
    global.fetch=async()=>Response.json({success:true,result:{response:raw}});await assert.rejects(analysis.requestVisualPosting(samples,''),/invalid caption/);
  }
});
test('read-only connection probe confirms exact model, never images or inference',async()=>{
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({success:true,result:[{name:settings.VISION_CLOUDFLARE_MODEL}]});};
  assert.equal((await vision.probeCloudflareVision(c)).state,'ready');assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);assert.equal(calls[0].init.body,undefined);assert.match(calls[0].url,/models\/search/);
  global.fetch=async()=>Response.json({success:true,result:[{name:settings.WRITING_CLOUDFLARE_MODEL}]});assert.equal((await vision.probeCloudflareVision(c)).state,'blocked');
});
test('quota-waiting copy resumes with configured backup before old nextAttemptAt and saves genuine model identity',async()=>{
  groqQuota();await fixture({postingAnalysis:{status:'WAITING',waitReason:'quota',attempts:0,updatedAt:new Date().toISOString(),nextAttemptAt:new Date(Date.now()+86400000).toISOString(),detail:"Groq's free quota is exhausted."}});
  await analysis.processNextPostingAnalysis();const file=await reviews.getReviewFile(id);assert.equal(file.quality.postingAnalysis.status,'COMPLETE');assert.equal(file.quality.postCopy,evidence.caption);assert.equal(file.quality.postingAnalysis.model,settings.VISION_CLOUDFLARE_MODEL);assert.equal(extractions,3);assert.equal(calls.length,1);
});
test('ordinary backoff, explicitly failed analyses and owner captions are not silently retried',async()=>{
  groqQuota();for(const quality of [
    {postingAnalysis:{status:'WAITING',waitReason:'retry',attempts:1,updatedAt:new Date().toISOString(),nextAttemptAt:new Date(Date.now()+86400000).toISOString(),detail:'Transient request failed.'}},
    {postingAnalysis:{status:'FAILED',attempts:3,updatedAt:new Date().toISOString(),detail:'Invalid evidence.'}},
    {postingTextOrigin:'owner',postCopy:'My own waterfall caption.'}
  ]){await fixture(quality);await analysis.processNextPostingAnalysis();assert.equal(calls.length,0);assert.equal(extractions,0);assert.equal(JSON.stringify((await reviews.getReviewFile(id)).quality),JSON.stringify({audio:'natural-audio-preserved',captions:[],hashtags:[],...quality}));}
});
test('late Cloudflare response cannot overwrite an owner edit',async()=>{
  groqQuota();await fixture();global.fetch=async()=>{await reviews.updateReviewFile(id,file=>({...file,updatedAt:new Date().toISOString(),quality:{...file.quality,postingTextOrigin:'owner',postCopy:'Owner revised copy.'}}));return Response.json({success:true,result:{response:evidence}});};
  await analysis.processNextPostingAnalysis();assert.equal((await reviews.getReviewFile(id)).quality.postCopy,'Owner revised copy.');
});
test('corrupt durable quota state fails closed and never sends frames',async()=>{
  fs.mkdirSync(path.dirname(privateFile('x')),{recursive:true});fs.writeFileSync(privateFile('cloudflare-vision-quota.json'),'{bad JSON');await assert.rejects(vision.requestCloudflareVisual(c,samples,'caption'),/Cannot read/);assert.equal(calls.length,0);
});
