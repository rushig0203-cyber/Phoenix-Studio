// Isolated histories only. No owner data, network, media, provider or model calls.
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const project=path.resolve(__dirname,'..'),previous=process.cwd(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-worker-readiness-'));
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
process.chdir(directory);
const {workerHasPendingWork}=require('../src/lib/workerReadiness'),{reviewRoot}=require('../src/lib/reviewFiles'),{writeAtomicJson}=require('../src/lib/atomicJson');
assert.equal(reviewRoot(),path.join(directory,'storage','Phoenix Studio Review Files'));
fs.mkdirSync(reviewRoot(),{recursive:true});
const files={source:'source-processing-jobs.json',generation:'ai-creation-jobs.json',edits:'review-edit-jobs.json',drafts:'creation-drafts.json'};
const filename=key=>path.join(reviewRoot(),files[key]);
const replace=(key,records)=>writeAtomicJson(filename(key),records);
after(()=>{process.chdir(previous);assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));assert.ok(!fs.lstatSync(directory).isSymbolicLink());fs.rmSync(directory,{recursive:true,force:true});});

test('missing and terminal histories skip polling; pending, unknown and retryable jobs keep normal checks',async()=>{
  for(const [key,done] of Object.entries({source:'COMPLETED',generation:'COMPLETED',edits:'COMPLETED',drafts:'APPROVED'})){
    assert.equal(await workerHasPendingWork(key),false);
    await replace(key,[{status:done},{status:'FAILED'}]);assert.equal(await workerHasPendingWork(key),false);
    await replace(key,[{status:'QUEUED',nextAttemptAt:'2999-01-01T00:00:00Z'}]);assert.equal(await workerHasPendingWork(key),true);
    await replace(key,[{status:key==='drafts'?'PLANNING':key==='generation'?'RUNNING':'PROCESSING'}]);assert.equal(await workerHasPendingWork(key),true);
    await replace(key,[{status:'UNKNOWN'}]);assert.equal(await workerHasPendingWork(key),true);
  }
  assert.equal(await workerHasPendingWork('posting'),true,'Changed media still needs fingerprint polling');
});

test('unchanged completed histories are read once, without retaining mutable jobs',async()=>{
  await replace('source',[{status:'COMPLETED',description:'x'.repeat(200_000)}]);
  const original=fs.promises.open;let opens=0;
  fs.promises.open=async(...args)=>{if(args[0]===filename('source'))opens++;return original(...args);};
  try {for(let index=0;index<100;index++)assert.equal(await workerHasPendingWork('source'),false);assert.equal(opens,1);}
  finally {fs.promises.open=original;}
});

test('atomic enqueue/retry is detected even with the same byte size and restored modification time',async()=>{
  const before=[{status:'COMPLETED',padding:''}],after=[{status:'QUEUED',padding:'xxx'}];
  assert.equal(JSON.stringify(before).length,JSON.stringify(after).length);
  await replace('generation',before);assert.equal(await workerHasPendingWork('generation'),false);
  const prior=await fs.promises.stat(filename('generation'));
  await replace('generation',after);await fs.promises.utimes(filename('generation'),prior.atime,prior.mtime);
  assert.equal(await workerHasPendingWork('generation'),true);
  await replace('generation',[{status:'FAILED'}]);assert.equal(await workerHasPendingWork('generation'),false);
  await replace('generation',[{status:'QUEUED'}]);assert.equal(await workerHasPendingWork('generation'),true);
});

test('a concurrent enqueue during inspection cannot be cached as an empty queue',async()=>{
  await replace('edits',[{status:'COMPLETED'}]);const original=fs.promises.open;let injected=false;
  fs.promises.open=async(...args)=>{
    const handle=await original(...args);
    if(args[0]===filename('edits')&&args[1]==='r'&&!injected){const close=handle.close.bind(handle);handle.close=async()=>{await close();injected=true;await replace('edits',[{status:'QUEUED'}]);};}
    return handle;
  };
  try {assert.equal(await workerHasPendingWork('edits'),true);assert.equal(injected,true);assert.equal(await workerHasPendingWork('edits'),true);}
  finally {fs.promises.open=original;}
});

test('corrupt or oversized history is delegated to its processor rather than hidden or cached',async()=>{
  for(const content of ['invalid JSON','{}','[null]']){
    await fs.promises.writeFile(filename('drafts'),content);assert.equal(await workerHasPendingWork('drafts'),true);
  }
  await fs.promises.writeFile(filename('drafts'),Buffer.alloc(8_388_609));
  const original=fs.promises.open;fs.promises.open=async()=>{throw Error('Oversized history must not be opened by readiness inspection');};
  try {assert.equal(await workerHasPendingWork('drafts'),true);}finally{fs.promises.open=original;}
  await replace('drafts',[{status:'READY'}]);assert.equal(await workerHasPendingWork('drafts'),true,'Legacy READY migration must remain eligible');
  await replace('drafts',[{status:'ARCHIVED'}]);assert.equal(await workerHasPendingWork('drafts'),false);
});

test('the existing heartbeat records real bounded heap measurements without changing health identity',async()=>{
  const {writeWorkerHeartbeat}=require('../src/lib/studioHealth');await writeWorkerHeartbeat();
  const raw=fs.readFileSync(path.join(directory,'storage','worker-heartbeat.json'),'utf8'),heartbeat=JSON.parse(raw);
  assert.equal(heartbeat.pid,process.pid);assert.ok(Number.isFinite(Date.parse(heartbeat.at)));assert.ok(raw.length<1024);
  for(const value of Object.values(heartbeat.memory))assert.ok(Number.isFinite(value)&&value>=0);
  assert.ok(heartbeat.memory.heapLimit>heartbeat.memory.heapUsed);assert.ok(heartbeat.memory.rss>=heartbeat.memory.heapUsed);
});
