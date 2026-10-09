const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const project=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-writer-settings-'));
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
const settings=require('../src/lib/writingSettings.ts'),route=require('../src/app/api/writing-provider/route.ts');
const key='gsk_fake_for_settings_test_123456789',originalFetch=global.fetch,realFree=os.freemem;
const file=path.join(temporary,'storage/private/writer-settings.json');
process.chdir(temporary);
beforeEach(()=>{fs.rmSync(path.join(temporary,'storage'),{recursive:true,force:true});global.fetch=async()=>Response.json({data:[{id:settings.WRITING_GROQ_MODEL}]});});
after(()=>{global.fetch=originalFetch;os.freemem=realFree;process.chdir(project);fs.rmSync(temporary,{recursive:true,force:true});});
const request=body=>new Request('http://localhost:3000/api/writing-provider',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(body)});
test('default local is preserved, Groq needs explicit free confirmation and key',async()=>{
  assert.equal(settings.readWritingSettings().provider,'ollama');
  await assert.rejects(settings.saveWritingSettings({provider:'groq',apiKey:key}),/Confirm/);
  await assert.rejects(settings.saveWritingSettings({provider:'groq',freePlanConfirmed:true}),/key/);
  assert.equal(fs.existsSync(file),false);
});
test('saved key is never returned; blank retains it and local switch is explicit',async()=>{
  const value=await settings.saveWritingSettings({provider:'groq',apiKey:key,freePlanConfirmed:true});
  assert.equal(value.hasKey,true);assert.equal(JSON.stringify(value).includes(key),false);assert.equal(value.apiKey,undefined);
  await settings.saveWritingSettings({provider:'groq',apiKey:'',freePlanConfirmed:true});assert.equal(settings.readWritingSettings().apiKey,key);
  await settings.saveWritingSettings({provider:'ollama'});assert.equal(settings.readWritingSettings().provider,'ollama');
  assert.equal(settings.publicWritingSettings().apiKey,undefined);
});
test('Cloudflare credentials are provider-scoped and never replace Groq vision credentials or frame consent',async()=>{
  const groq='gsk_preserved_groq_key_for_test_123456789',cloudflare='cf_token_for_isolated_mock_test_123456789';
  await settings.saveWritingSettings({provider:'groq',apiKey:groq,freePlanConfirmed:true,allowVideoFrames:true});
  const accountId='0123456789abcdef0123456789abcdef';
  const saved=await settings.saveWritingSettings({provider:'cloudflare',apiKey:cloudflare,accountId,freePlanConfirmed:true});
  assert.equal(saved.provider,'cloudflare');assert.equal(saved.hasKey,true);assert.equal(saved.hasGroqVisionKey,true);
  assert.equal(JSON.stringify(saved).includes(groq),false);assert.equal(JSON.stringify(saved).includes(cloudflare),false);
  const writing=settings.readWritingSettings();assert.equal(writing.apiKey,cloudflare);assert.equal(writing.accountId,accountId);
  const vision=settings.readVideoAnalysisSettings();assert.equal(vision.provider,'groq');assert.equal(vision.apiKey,groq);assert.equal(vision.freePlanConfirmed,true);assert.equal(vision.allowVideoFrames,true);
  await settings.saveWritingSettings({provider:'cloudflare',freePlanConfirmed:true,allowVideoFrames:false});
  assert.equal(settings.readWritingSettings().apiKey,cloudflare);assert.equal(settings.readVideoAnalysisSettings().apiKey,groq);assert.equal(settings.readVideoAnalysisSettings().allowVideoFrames,false);
});
test('Cloudflare is not selected without separate credentials and free confirmation',async()=>{
  await assert.rejects(settings.saveWritingSettings({provider:'cloudflare',apiKey:'cf_token_for_isolated_mock_test_123456789',accountId:'0123456789abcdef0123456789abcdef'}),/Confirm/);
  await assert.rejects(settings.saveWritingSettings({provider:'cloudflare',freePlanConfirmed:true}),/token and Account ID/);
  assert.equal(settings.readWritingSettings().provider,'ollama');
});
test('corrupt settings fail closed without exposing file content or switching local',()=>{
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`{"apiKey":"${key}`);
  assert.throws(settings.readWritingSettings,error=>error.code==='PHOENIX_WRITING_SETTINGS'&&!error.message.includes(key));
});
test('cross-origin save and oversized body never persist credentials',async()=>{
  const cross=new Request('http://localhost:3000/api/writing-provider',{method:'POST',headers:{Origin:'https://attacker.example'},body:JSON.stringify({provider:'groq',apiKey:key,freePlanConfirmed:true,action:'save'})});
  assert.equal((await route.POST(cross)).status,403);
  assert.equal((await route.POST(request({action:'save',apiKey:'x'.repeat(9000)}))).status,400);
  assert.equal(fs.existsSync(file),false);
});
test('saving tests key and model first, rejection leaves provider unchanged',async()=>{
  global.fetch=async()=>new Response(key,{status:401});
  const failed=await route.POST(request({action:'save',provider:'groq',apiKey:key,freePlanConfirmed:true}));
  assert.equal(failed.status,400);assert.equal((await failed.text()).includes(key),false);assert.equal(fs.existsSync(file),false);
  let calls=0;global.fetch=async url=>{calls++;assert.equal(String(url),'https://api.groq.com/openai/v1/models');return Response.json({data:[{id:settings.WRITING_GROQ_MODEL}]});};
  assert.equal((await route.POST(request({action:'save',provider:'groq',apiKey:key,freePlanConfirmed:true}))).status,200);assert.equal(calls,1);
  const get=await route.GET(new Request('http://localhost:3000/api/writing-provider'));assert.equal((await get.text()).includes(key),false);
});
test('Cloudflare selection runs only an exact-model read-only probe before saving scoped credentials',async()=>{
  const token='cf_token_for_isolated_mock_test_123456789',accountId='0123456789abcdef0123456789abcdef';let calls=0;
  global.fetch=async(url,init)=>{calls++;assert.equal(String(url),`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?search=${encodeURIComponent(settings.WRITING_CLOUDFLARE_MODEL)}`);assert.equal(init.method,undefined);return Response.json({success:true,result:[{name:settings.WRITING_CLOUDFLARE_MODEL}]});};
  const response=await route.POST(request({action:'save',provider:'cloudflare',apiKey:token,accountId,freePlanConfirmed:true}));
  assert.equal(response.status,200);assert.equal(calls,1);const publicValue=await response.json();assert.equal(publicValue.provider,'cloudflare');assert.equal(publicValue.configured,true);assert.equal(JSON.stringify(publicValue).includes(token),false);
  assert.equal(settings.readWritingSettings().apiKey,token);assert.equal(settings.readWritingSettings().model,settings.WRITING_CLOUDFLARE_MODEL);
});
test('Groq dashboard health does not call Ollama or external providers',async()=>{
  await settings.saveWritingSettings({provider:'groq',apiKey:key,freePlanConfirmed:true});
  const previous=process.env.MPT_BASE_URL;process.env.MPT_BASE_URL='http://localhost:8080';
  global.fetch=async url=>{assert.equal(new URL(url).port,'8080');return Response.json({components:{schemas:{TaskVideoRequest:{properties:{phoenix_artifacts_version:{},phoenix_storyboard:{},phoenix_playback_policy:{const:'native-speed-v1'}}}}}});};
  try{const state=await require('../src/lib/localServiceHealth.ts').probeLocalServices();assert.equal(state.writerProvider,'groq');assert.equal(state.writer.state,'configured');assert.equal(state.renderer.state,'ready');assert.equal(JSON.stringify(state).includes(key),false);}
  finally{if(previous===undefined)delete process.env.MPT_BASE_URL;else process.env.MPT_BASE_URL=previous;}
});
test('actual preparation rate limit releases heavy slot and preserves queued work with 700 MiB free',async()=>{
  await settings.saveWritingSettings({provider:'groq',apiKey:key,freePlanConfirmed:true});os.freemem=()=>700*1024*1024;
  let calls=0;global.fetch=async url=>{calls++;assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');return new Response('',{status:429,headers:{'retry-after':'120'}});};
  const drafts=require('../src/lib/creationDrafts.ts');
  await drafts.createCreationDrafts([{reviewMode:'final',topic:'Track a week of photography practice',duration:75,creationType:'general',aspect:'9:16'}]);
  await drafts.processNextCreationDraft();
  const [saved]=await drafts.listCreationDrafts();assert.equal(saved.status,'QUEUED');assert.match(saved.stage,/Groq/);assert.equal(saved.error,undefined);assert.ok(Date.parse(saved.nextAttemptAt)>Date.now());
  assert.equal(await require('../src/lib/renderResources.ts').readHeavyLease(),null);
  await drafts.processNextCreationDraft();assert.equal(calls,1);
});
test('Groq children failures never silently substitute local template story',async()=>{
  await settings.saveWritingSettings({provider:'groq',apiKey:key,freePlanConfirmed:true});
  global.fetch=async()=>new Response('',{status:503});
  const kids=require('../src/lib/kidsRenderer.ts');
  await assert.rejects(kids.createContent({topic:'A bunny plants a seed',duration:75,creationType:'children-story',aspect:'9:16'}, {rules:[],revision:'test',feedbackCount:0}),/503/);
});
