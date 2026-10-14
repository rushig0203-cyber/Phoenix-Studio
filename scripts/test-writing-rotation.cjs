const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const project=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-writer-rotation-'));
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
process.chdir(temporary);
const settings=require('../src/lib/writingSettings'),local=require('../src/lib/localModelSession'),groq=require('../src/lib/groqWriter');
const cloudflare=require('../src/lib/cloudflareWriter'),vision=require('../src/lib/cloudflareVision'),router=require('../src/lib/writingModel');
const drafts=require('../src/lib/creationDrafts'),quota=require('../src/lib/providerQuota');
const originals={fetch:global.fetch,local:local.generateLocalModel,session:local.withLocalWritingSession,groq:groq.generateGroqText};
const privateFile=name=>path.join(temporary,'storage','private',name);
const groqKey='gsk_isolated_rotation_fixture_1234567890',cfKey='cf_isolated_rotation_fixture_1234567890',account='a'.repeat(32);
const prompt={prompt:'Write one complete visible action.',options:{num_predict:500}};
let calls,selected;
function save(extra={}) {
  fs.mkdirSync(path.dirname(privateFile('writer-settings.json')),{recursive:true});
  selected={provider:'cloudflare',groqApiKey:groqKey,groqFreePlanConfirmed:true,cloudflareApiKey:cfKey,cloudflareAccountId:account,
    cloudflareFreePlanConfirmed:true,allowVideoFrames:true,allowCloudflareVideoFrames:true,...extra};
  fs.writeFileSync(privateFile('writer-settings.json'),JSON.stringify(selected));
}
const answer=url=>url.includes('api.groq.com')?Response.json({choices:[{finish_reason:'stop',message:{content:'Complete visible action.'}}]}):Response.json({success:true,result:{response:'Complete visible action.'}});
const exhausted=url=>url.includes('api.groq.com')?new Response('',{status:429,headers:{'retry-after':'120'}}):Response.json({success:false,errors:[{code:3036,message:'private fixture quota'}]},{status:429});
beforeEach(()=>{
  fs.rmSync(path.join(temporary,'storage'),{recursive:true,force:true});save();calls=[];
  local.generateLocalModel=async()=>assert.fail('Cloud quota rotation must never load Ollama');
  local.withLocalWritingSession=async()=>assert.fail('Cloud quota rotation must never bypass the heavy/RAM lease');
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return answer(String(url));};
});
after(()=>{
  global.fetch=originals.fetch;local.generateLocalModel=originals.local;local.withLocalWritingSession=originals.session;groq.generateGroqText=originals.groq;
  process.chdir(project);assert.ok(temporary.startsWith(os.tmpdir()+path.sep));fs.rmSync(temporary,{recursive:true,force:true});
});
test('Cloudflare daily exhaustion switches to Groq in the same stage and persists the depleted account',async()=>{
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return String(url).includes('api.cloudflare.com')?exhausted(String(url)):answer(String(url));};
  const result=await (await router.generateWritingModel(prompt)).json();assert.equal(result.provider,'groq');assert.equal(calls.length,2);
  await router.generateWritingModel(prompt);assert.equal(calls.length,3);assert.match(calls[2].url,/api.groq.com/);
  assert.ok(await vision.cloudflareVisionQuotaDelay(settings.readCloudflareVideoAnalysisSettings())>0);
  assert.doesNotMatch(fs.readFileSync(privateFile('cloudflare-account-quota.json'),'utf8'),/cf_isolated|private fixture/);
});
test('Groq quota switches to Cloudflare and returns to preferred Groq after its reset',async()=>{
  save({provider:'groq'});
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return String(url).includes('api.groq.com')?exhausted(String(url)):answer(String(url));};
  assert.equal((await (await router.generateWritingModel(prompt)).json()).provider,'cloudflare');
  await router.generateWritingModel(prompt);assert.equal(calls.length,3);assert.match(calls[2].url,/api.cloudflare.com/);
  const state=JSON.parse(fs.readFileSync(privateFile('groq-cooldown.json')));state.until=Date.now()-1;fs.writeFileSync(privateFile('groq-cooldown.json'),JSON.stringify(state));
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return answer(String(url));};
  assert.equal((await (await router.generateWritingModel(prompt)).json()).provider,'groq');assert.match(calls[3].url,/api.groq.com/);
});
test('both exhausted writers retain saved work and wait for the earliest reset without repeated requests',async()=>{
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return exhausted(String(url));};
  await assert.rejects(router.generateWritingModel(prompt),error=>error instanceof groq.WritingQuotaWaitError&&error.retryAfterMs<=120000&&/Both configured free/.test(error.message));
  assert.equal(calls.length,2);await assert.rejects(router.generateWritingModel(prompt),groq.WritingQuotaWaitError);assert.equal(calls.length,2);
  const delay=await router.writingQuotaDelay();assert.ok(delay>0&&delay<=120000);
});
test('quota rotation neither replays completed callback stages nor disguises actual response provenance',async()=>{
  let callbacks=0;const identity=router.writingModelIdentity();assert.match(identity,/free-quota-rotation-v1.*groq/);assert.doesNotMatch(identity,/isolated_rotation/);
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return String(url).includes('api.cloudflare.com')?exhausted(String(url)):answer(String(url));};
  await router.withWritingSession(async()=>{callbacks++;for(let stage=0;stage<3;stage++){
    const value=await (await router.generateWritingModel(prompt)).json();assert.equal(value.provider,'groq');assert.equal(value.model,settings.WRITING_GROQ_MODEL);
    assert.equal(router.writingModelIdentity(),identity);
  }},{expectedIdentity:identity});assert.equal(callbacks,1);assert.equal(calls.length,4);
});
test('authentication, billing, malformed responses and ordinary lock waits never rotate',async()=>{
  save({provider:'groq'});
  for(const status of [400,401,402,403,404,500,503]){
    calls=[];global.fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response('private provider body',{status});};
    await assert.rejects(router.generateWritingModel(prompt));assert.equal(calls.length,1);assert.match(calls[0].url,/api.groq.com/);
  }
  calls=[];global.fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response('invalid JSON');};
  await assert.rejects(router.generateWritingModel(prompt));assert.equal(calls.length,1);
  groq.generateGroqText=async()=>{throw new groq.WritingWaitError('Another writing request is finishing.',15000);};
  calls=[];await assert.rejects(router.generateWritingModel(prompt),error=>error instanceof groq.WritingWaitError&&!(error instanceof groq.WritingQuotaWaitError));assert.equal(calls.length,0);
  groq.generateGroqText=originals.groq;
});
test('backup requires its own Free confirmation and never changes private writer selection',async()=>{
  save({groqFreePlanConfirmed:false});const baseline=fs.readFileSync(privateFile('writer-settings.json'),'utf8');
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return exhausted(String(url));};
  await assert.rejects(router.generateWritingModel(prompt),groq.WritingQuotaWaitError);assert.equal(calls.length,1);
  assert.equal(fs.readFileSync(privateFile('writer-settings.json'),'utf8'),baseline);
});
test('revoking backup credentials or cancelling a quota response prevents the second transmission',async()=>{
  save({provider:'groq'});
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});save({provider:'groq',cloudflareFreePlanConfirmed:false});return exhausted(String(url));};
  await assert.rejects(router.generateWritingModel(prompt),/settings changed/);assert.equal(calls.length,1);
  fs.rmSync(privateFile('groq-cooldown.json'),{force:true});save({provider:'groq'});calls=[];const controller=new AbortController();
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});controller.abort();return exhausted(String(url));};
  await assert.rejects(router.generateWritingModel(prompt,{signal:controller.signal}));assert.equal(calls.length,1);
});
test('daily frame-analysis exhaustion is also respected by text writing without contacting Cloudflare',async()=>{
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return exhausted(String(url));};
  const samples=[Buffer.from([255,216,255,217]),Buffer.from([255,216,255,217]),Buffer.from([255,216,255,217])];
  await assert.rejects(vision.requestCloudflareVisual(settings.readCloudflareVideoAnalysisSettings(),samples,'Return grounded evidence.'),vision.CloudflareVisionQuotaError);
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return answer(String(url));};
  assert.equal((await (await router.generateWritingModel(prompt)).json()).provider,'groq');assert.equal(calls.length,2);assert.match(calls[1].url,/api.groq.com/);
});
test('Cloudflare account reset and a replacement credential do not retain an obsolete cooldown',async()=>{
  await quota.saveCloudflareDailyQuota(settings.readCloudflareWriterSettings(),Date.now()-1);assert.equal(await quota.cloudflareDailyQuotaDelay(settings.readCloudflareWriterSettings()),0);
  await quota.saveCloudflareDailyQuota(settings.readCloudflareWriterSettings(),Date.now()+120000);save({cloudflareApiKey:'cf_replaced_fixture_token_12345678901234'});
  assert.equal(await quota.cloudflareDailyQuotaDelay(settings.readCloudflareWriterSettings()),0);
  assert.equal((await (await router.generateWritingModel(prompt)).json()).provider,'cloudflare');
});
test('Lumina notices an available backup before a saved quota timer, but never overrides failure or normal backoff',async()=>{
  const root=path.join(temporary,'storage','Phoenix Studio Review Files');fs.mkdirSync(root,{recursive:true});
  const file=path.join(root,'creation-drafts.json'),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const draft={id,requestKey:'fixture',version:1,status:'QUEUED',stage:"Cloudflare's daily Free allocation is exhausted.",writerQuotaWait:true,
    input:{creationType:'general'},scenes:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),nextAttemptAt:new Date(Date.now()+3600000).toISOString()};
  fs.writeFileSync(file,JSON.stringify([draft]));assert.equal(await drafts.creationDraftWorkflowReady({waitingForMemory:true}),true);assert.equal(calls.length,0);
  for(const change of [{writerQuotaWait:false,stage:'Another writing request is finishing.'},{status:'FAILED'},{writerQuotaWait:false,stage:'Waiting for memory before local writing.'}]){
    fs.writeFileSync(file,JSON.stringify([{...draft,...change}]));assert.equal(await drafts.creationDraftWorkflowReady({waitingForMemory:true}),false);
  }
});
test('explicit local selection remains local and shared quota corruption fails closed',async()=>{
  save({provider:'ollama'});assert.equal(router.writingModelIdentity(),'ollama:qwen2.5:3b');assert.equal(await router.writingQuotaDelay(),0);
  let entered=0;local.withLocalWritingSession=async fn=>{entered++;return fn();};local.generateLocalModel=async()=>Response.json({response:'local',done:true});
  await router.generateWritingModel(prompt);assert.equal(entered,1);assert.equal(calls.length,0);
  save();fs.writeFileSync(privateFile('cloudflare-account-quota.json'),'not JSON');await assert.rejects(router.generateWritingModel(prompt),/quota state/);assert.equal(calls.length,0);
});
