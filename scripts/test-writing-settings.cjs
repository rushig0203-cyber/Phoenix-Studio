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
test('Groq dashboard health does not call Ollama or external providers',async()=>{
  await settings.saveWritingSettings({provider:'groq',apiKey:key,freePlanConfirmed:true});
  const previous=process.env.MPT_BASE_URL;process.env.MPT_BASE_URL='http://localhost:8080';
  global.fetch=async url=>{assert.equal(new URL(url).port,'8080');return Response.json({components:{schemas:{TaskVideoRequest:{properties:{phoenix_artifacts_version:{},phoenix_storyboard:{}}}}}});};
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
