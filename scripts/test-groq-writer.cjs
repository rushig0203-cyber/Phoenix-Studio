const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-groq-'));
require('ts-node').register({ project:path.join(project,'tsconfig.json'), transpileOnly:true, compilerOptions:{module:'commonjs', moduleResolution:'node'} });
const settings = require('../src/lib/writingSettings.ts');
const local = require('../src/lib/localModelSession.ts');
const transport = require('../src/lib/groqWriter.ts');
const router = require('../src/lib/writingModel.ts');
const original = { fetch:global.fetch, read:settings.readWritingSettings, generate:local.generateLocalModel, session:local.withLocalWritingSession };
const selected = { provider:'groq',model:settings.WRITING_GROQ_MODEL,apiKey:'gsk_test_credential_not_real_12345678',freePlanConfirmed:true };
const answer = value => Response.json({ choices:[{finish_reason:'stop',message:{content:value}}] });
const prompt = { model:'qwen2.5:3b',prompt:'Write one relevant complete line.',options:{num_ctx:4096,num_predict:500} };
let active, calls;
process.chdir(temporary);
beforeEach(() => {
  fs.rmSync(path.join(temporary,'storage'), {recursive:true,force:true});
  active = {...selected}; calls=[];
  settings.readWritingSettings = () => ({...active});
  local.generateLocalModel = async()=>assert.fail('Groq must not load Ollama');
  local.withLocalWritingSession = async()=>assert.fail('Groq must not enter local memory admission');
  global.fetch = async(url,init)=>{calls.push({url,init});return answer('A useful complete line.');};
});
after(()=>{global.fetch=original.fetch;settings.readWritingSettings=original.read;local.generateLocalModel=original.generate;local.withLocalWritingSession=original.session;process.chdir(project);fs.rmSync(temporary,{recursive:true,force:true});});

test('Groq routes all nested writing without local memory admission and allows only fixed text endpoint',async()=>{
  await router.withWritingSession(async()=>{
    for(const step of ['brief','narration','editorial','storyboard'])await router.withWritingSession(()=>router.generateWritingModel({...prompt,prompt:step,images:undefined}));
  });
  assert.equal(calls.length,4);
  for(const {url,init} of calls){
    assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
    const body=JSON.parse(init.body);
    assert.equal(body.model,settings.WRITING_GROQ_MODEL); assert.equal(body.include_reasoning,false);
    assert.equal(body.tools,undefined);assert.equal(body.options,undefined);assert.equal(body.service_tier,undefined);
    assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
    assert.equal(body.messages.length,2);
  }
});
test('JSON stage is constrained to JSON object and preserves downstream validation',async()=>{
  global.fetch=async(url,init)=>{calls.push({url,init});return answer('{"queries":["bag packing"]}');};
  const value=await (await router.generateWritingModel({...prompt,format:{type:'object',properties:{queries:{type:'array'}}}})).json();
  assert.equal(value.provider,'groq');assert.equal(value.done,true);assert.deepEqual(JSON.parse(value.response),{queries:['bag packing']});
  assert.deepEqual(JSON.parse(calls[0].init.body).response_format,{type:'json_object'});
});
test('missing key and missing Free confirmation never contact a provider',async()=>{
  for(const invalid of [{apiKey:''},{freePlanConfirmed:false}]){
    active={...selected,...invalid};await assert.rejects(router.generateWritingModel(prompt),transport.WritingConfigurationError);
  }
  assert.equal(calls.length,0);
});
test('model identity changes with provider and never contains a credential',async()=>{
  assert.equal(router.writingModelIdentity(),`groq:${selected.model}`);
  active={provider:'ollama',model:'fixture:local',freePlanConfirmed:false};
  assert.equal(router.writingModelIdentity(),'ollama:fixture:local');
});
test('local mode retains existing session and request mechanics',async()=>{
  active={provider:'ollama',model:'fixture:local',freePlanConfirmed:false};
  let entered=0,generated=0;
  local.withLocalWritingSession=async(work,options)=>{entered++;assert.equal(options.model,'fixture:local');return work();};
  local.generateLocalModel=async(body)=>{generated++;assert.equal(body.model,'fixture:local');return Response.json({done:true,response:'local'});};
  await router.withWritingSession(()=>router.generateWritingModel(prompt));
  assert.equal(entered,1);assert.equal(generated,1);assert.equal(calls.length,0);
});
test('429 preserves durable cooldown and does not repeatedly send other jobs',async()=>{
  global.fetch=async()=>{calls.push(1);return new Response('sensitive server message',{status:429,headers:{'retry-after':'120'}});};
  let caught;
  try{await router.generateWritingModel(prompt);}catch(error){caught=error;}
  assert.equal(router.isWritingWaitError(caught),true);assert.equal(caught.retryAfterMs,120000);
  assert.doesNotMatch(caught.message,/sensitive/);
  await assert.rejects(router.generateWritingModel(prompt),transport.WritingWaitError);assert.equal(calls.length,1);
  const saved=fs.readFileSync(path.join(temporary,'storage/private/groq-cooldown.json'),'utf8');assert.equal(saved.includes(selected.apiKey),false);
});
test('different newly supplied key does not inherit old account cooldown',async()=>{
  global.fetch=async()=>new Response('',{status:429,headers:{'retry-after':'60'}});
  await assert.rejects(router.generateWritingModel(prompt),transport.WritingWaitError);
  active={...selected,apiKey:'gsk_different_fake_credential_123456'};
  global.fetch=async()=>answer('Complete.');
  assert.equal((await (await router.generateWritingModel(prompt)).json()).response,'Complete.');
});
test('Retry-After dates, seconds, resets and malformed headers are bounded',()=>{
  assert.equal(transport.groqRetryDelay(new Headers({'retry-after':'7'})),7000);
  assert.equal(transport.groqRetryDelay(new Headers({'retry-after':'0'})),5000);
  assert.equal(transport.groqRetryDelay(new Headers({'retry-after':'tomorrow'})),60000);
  assert.equal(transport.groqRetryDelay(new Headers({'retry-after':'9999999'})),86400000);
  assert.equal(transport.groqRetryDelay(new Headers({'retry-after':'1','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'2m3.5s'})),123500);
  const now=Date.UTC(2026,8,27);assert.equal(transport.groqRetryDelay(new Headers({'retry-after':new Date(now+30000).toUTCString()}),now),30000);
});

test('successful response quota headers pace the next stage without another 429 request',async()=>{
  global.fetch=async()=>{calls.push(1);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Complete.'}}]}),{headers:{'x-ratelimit-remaining-tokens':'100','x-ratelimit-reset-tokens':'15s'}});};
  await router.generateWritingModel(prompt);
  await assert.rejects(router.generateWritingModel(prompt),error=>router.isWritingWaitError(error)&&/Pacing/.test(error.message));
  assert.equal(calls.length,1);
  const stored=fs.readFileSync(path.join(temporary,'storage/private/groq-rate-window.json'),'utf8');assert.equal(stored.includes(selected.apiKey),false);
});
test('pacing ignores expired/malformed/missing headers and distinguishes request exhaustion',()=>{
  const now=100000;
  assert.equal(transport.groqPacingDelay(transport.groqRateWindow(new Headers(), 'id', now),2000,now),0);
  const quota=transport.groqRateWindow(new Headers({'x-ratelimit-remaining-tokens':'4000','x-ratelimit-reset-tokens':'30s','x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'1h'}),'id',now);
  assert.equal(transport.groqPacingDelay(quota,1000,now),3601000);
  assert.equal(transport.groqPacingDelay(quota,1000,now+3601000),0);
  assert.equal(transport.groqPacingDelay(transport.groqRateWindow(new Headers({'x-ratelimit-remaining-tokens':'oops','x-ratelimit-reset-tokens':'later'}),'id',now),1000,now),0);
});
test('provider error bodies are never exposed and never cause fallback',async()=>{
  for(const status of [400,401,402,403,404,500,503]){
    global.fetch=async()=>new Response(`secret ${selected.apiKey} private prompt`,{status});
    await assert.rejects(router.generateWritingModel(prompt),error=>!error.message.includes('gsk_')&&!error.message.includes('private prompt')&&!router.isWritingWaitError(error));
  }
});
test('network failure is bounded/actionable with no raw error or fallback',async()=>{
  global.fetch=async()=>{throw new Error(`request ${selected.apiKey}`);};
  await assert.rejects(router.generateWritingModel(prompt),error=>/interrupted or timed out/.test(error.message)&&!error.message.includes(selected.apiKey));
});
test('truncated, refused, non-JSON and oversized outputs are rejected',async()=>{
  for(const response of [Response.json({choices:[{finish_reason:'length',message:{content:'truncated'}}]}),Response.json({choices:[{finish_reason:'stop',message:{content:'text',refusal:'no'}}]}),answer('not JSON'),new Response('x'.repeat(1024*1024+1))]){
    global.fetch=async()=>response;
    await assert.rejects(router.generateWritingModel({...prompt,format:'json'}));
  }
});
test('media/tools/oversized prompts cannot be sent by adapter',async()=>{
  for(const other of [{images:['secret']},{tools:[{}]},{messages:[{}]},{prompt:'x'.repeat(40001)}])await assert.rejects(router.generateWritingModel({...prompt,...other}));
  assert.equal(calls.length,0);
});
test('switching provider mid-session stops before any further external request',async()=>{
  await assert.rejects(router.withWritingSession(async()=>{active={provider:'ollama',model:'fixture:local',freePlanConfirmed:false};await router.generateWritingModel(prompt);}),/settings changed/);
  assert.equal(calls.length,0);
});
test('aborted request never reaches transport',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(router.generateWritingModel(prompt,{signal:controller.signal}));assert.equal(calls.length,0);
});
test('connection test is GET models only and does not claim billing verification',async()=>{
  global.fetch=async(url,init)=>{calls.push({url,init});return Response.json({data:[{id:selected.model}]});};
  const result=await transport.probeGroqWriter(selected);
  assert.equal(result.state,'ready');assert.match(result.detail,/not API-verified/);
  assert.equal(calls[0].url,'https://api.groq.com/openai/v1/models');assert.equal(calls[0].init.body,undefined);
});
test('connection rejection is sanitized and missing model is blocked',async()=>{
  global.fetch=async()=>new Response(selected.apiKey,{status:401});
  const result=await transport.probeGroqWriter(selected);assert.equal(result.state,'blocked');assert.equal(result.detail.includes(selected.apiKey),false);
  global.fetch=async()=>Response.json({data:[]});assert.equal((await transport.probeGroqWriter(selected)).state,'blocked');
});
