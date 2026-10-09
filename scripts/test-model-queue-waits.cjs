const {test,beforeEach,after,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const project=path.resolve(__dirname,'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-model-queue-'));
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
process.chdir(temporary);
const drafts=require(path.join(project,'src/lib/creationDrafts.ts'));
const ai=require(path.join(project,'src/lib/generation.ts'));
const resources=require(path.join(project,'src/lib/renderResources.ts'));
const {createContent}=require(path.join(project,'src/lib/kidsRenderer.ts'));
const {guidanceFromFeedback}=require(path.join(project,'src/lib/qualityManager.ts'));
const root=path.join(temporary,'storage','Phoenix Studio Review Files');
const realFetch=global.fetch,realFree=os.freemem,originalModel=process.env.OLLAMA_MODEL;
const input=()=>({reviewMode:'final',topic:'Compare hand whisking with an electric mixer',language:'English',duration:75,aspect:'9:16',voice:'local-windows-voice',subtitleStyle:'clear',visualSource:'stock',targetPlatform:'YouTube',publishingFormat:'youtube-short',creationType:'general'});
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
let probes;
beforeEach(()=>{
  fs.mkdirSync(root,{recursive:true});
  for(const name of ['creation-drafts.json','ai-creation-jobs.json'])fs.writeFileSync(path.join(root,name),'[]');
  process.env.OLLAMA_MODEL='fixture:local';
  os.freemem=()=>1024*1024*1024;
  probes=0;
  global.fetch=async(url,init)=>{
    assert.equal(init.method,'GET','Low-memory work must never submit generation or rendering');
    probes++;
    if(new URL(url).pathname==='/api/tags')return Response.json({models:[{name:'fixture:local',size:2*1024**3}]});
    if(new URL(url).pathname==='/api/ps')return Response.json({models:[]});
    assert.fail(`Unexpected network request ${url}`);
  };
});
afterEach(()=>{global.fetch=realFetch;os.freemem=realFree;});
after(()=>{if(originalModel===undefined)delete process.env.OLLAMA_MODEL;else process.env.OLLAMA_MODEL=originalModel;process.chdir(project);fs.rmSync(temporary,{recursive:true,force:true});});

test('preparation waits for RAM, retains input, releases slot and does not poll before backoff',async()=>{
  await drafts.createCreationDrafts([input()]);
  await drafts.processNextCreationDraft();
  const saved=read('creation-drafts.json')[0];
  assert.equal(saved.status,'QUEUED');assert.match(saved.stage,/Waiting for memory/);
  assert.equal(saved.error,undefined);assert.equal(saved.leaseOwner,undefined);
  assert.ok(Date.parse(saved.nextAttemptAt)>Date.now());
  assert.equal(saved.input.topic,input().topic);assert.equal(await resources.readHeavyLease(),null);
  assert.equal(probes,2);
  await drafts.processNextCreationDraft();assert.equal(probes,2);
  await drafts.changeDraftStatus(saved.id,saved.version,'archive');
  assert.equal(read('creation-drafts.json')[0].status,'ARCHIVED');
});

test('generation memory wait does not consume retries or attempt history',async()=>{
  const id=crypto.randomUUID(),now=new Date().toISOString();
  fs.writeFileSync(path.join(root,'ai-creation-jobs.json'),JSON.stringify([{id,projectId:id,project:{title:'Fixture'},status:'QUEUED',stage:'Queued',progress:0,requestJson:JSON.stringify(input()),duration:75,retryCount:1,attempts:[{at:now,attempt:1,error:'Earlier unrelated failure'}],queuedAt:now,createdAt:now,updatedAt:now}]));
  // Renderer configuration probing precedes preparation; provide its read-only
  // contract while preserving the strict no-POST check above.
  const oldBase=process.env.MPT_BASE_URL;process.env.MPT_BASE_URL='http://127.0.0.1:8080';
  const memoryFetch=global.fetch;
  global.fetch=async(url,init)=>{
    if(new URL(url).port==='8080') {
      assert.ok(!init.method || init.method==='GET');
      if(new URL(url).pathname==='/api/v1/tasks')return Response.json({data:{tasks:[]}});
      assert.equal(new URL(url).pathname,'/openapi.json');
      return Response.json({components:{schemas:{TaskVideoRequest:{properties:{phoenix_artifacts_version:{},phoenix_storyboard:{},phoenix_playback_policy:{const:'native-speed-v1'}}}}}});
    }
    return memoryFetch(url,init);
  };
  try {
    await ai.processNextGenerationJob();
    const saved=read('ai-creation-jobs.json')[0];
    assert.equal(saved.status,'QUEUED');assert.match(saved.stage,/Waiting for memory/);
    assert.equal(saved.retryCount,1);assert.equal(saved.attempts.length,1);
    assert.ok(Date.parse(saved.nextAttemptAt)>Date.now());assert.equal(saved.error,undefined);
    assert.equal(await resources.readHeavyLease(),null);
    const before=probes;await ai.processNextGenerationJob();assert.equal(probes,before);
  } finally {if(oldBase===undefined)delete process.env.MPT_BASE_URL;else process.env.MPT_BASE_URL=oldBase;}
});

test('children writing propagates a memory wait instead of substituting a template story',async()=>{
  await assert.rejects(createContent({...input(),topic:'A bunny plants a seed',creationType:'children-story'},guidanceFromFeedback([])),error=>error.code==='PHOENIX_LOCAL_MODEL_WAIT');
  assert.equal(probes,2);
});
