// CI-only synthetic history benchmark. No owner stores, jobs, credentials, media or models.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
assert.equal(process.env.CI,'true','Run the idle-memory proof only on an isolated CI runner.');
const project=fs.realpathSync(path.resolve(__dirname,'..')),rounds=100;
const files={source:'source-processing-jobs.json',generation:'ai-creation-jobs.json',edits:'review-edit-jobs.json',drafts:'creation-drafts.json'};
const compilerLoaded=()=>Object.keys(require.cache).some(filename=>/[\\/]node_modules[\\/](?:typescript|ts-node)[\\/]/.test(filename));

async function child(mode){
  const directory=process.env.PHOENIX_MEMORY_FIXTURE;
  assert.ok(directory&&path.isAbsolute(directory));
  assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(directory),/^phoenix-worker-memory-[A-Za-z0-9]+$/);
  assert.equal(String(process.ppid),process.env.PHOENIX_MEMORY_PARENT);
  assert.ok(!fs.lstatSync(directory).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(directory,'proof-only.txt'),'utf8'),'Phoenix synthetic terminal histories; never render or post.');
  process.chdir(directory);
  global.fetch=async()=>{throw Error('Network/provider calls are forbidden in the idle-memory proof');};
  const {load}=require('./worker-runtime.cjs').compiledRuntime(project,process.env.PHOENIX_BUILD_DIR);
  assert.equal(load('reviewFiles').reviewRoot(),path.join(directory,'storage','Phoenix Studio Review Files'));
  const {workerHasPendingWork}=load('workerReadiness');
  let bytesRead=0,opens=0,peakRss=0,peakHeapUsed=0,peakHeapTotal=0;
  const sample=()=>{const memory=process.memoryUsage();peakRss=Math.max(peakRss,memory.rss);peakHeapUsed=Math.max(peakHeapUsed,memory.heapUsed);peakHeapTotal=Math.max(peakHeapTotal,memory.heapTotal);};
  const original=fs.promises.open;
  if(mode==='optimized')fs.promises.open=async(...args)=>{
    const handle=await original(...args),read=handle.read.bind(handle);opens++;
    handle.read=async(...parameters)=>{const result=await read(...parameters);bytesRead+=result.bytesRead;return result;};
    return handle;
  };
  const start=performance.now();
  try {
    for(let index=0;index<rounds;index++)for(const [key,name] of Object.entries(files)){
      if(mode==='baseline'){
        const text=await fs.promises.readFile(path.join(directory,'storage','Phoenix Studio Review Files',name),'utf8');
        bytesRead+=Buffer.byteLength(text);opens++;
        const jobs=JSON.parse(text);assert.equal(jobs.length,1800);assert.ok(jobs.every(job=>['COMPLETED','APPROVED'].includes(job.status)));
      }else assert.equal(await workerHasPendingWork(key),false);
      sample();
    }
  }finally{fs.promises.open=original;}
  assert.equal(compilerLoaded(),false);
  return {mode,rounds,bytesRead,opens,elapsedMs:Math.round(performance.now()-start),peakRss,peakHeapUsed,peakHeapTotal,
    heapLimit:require('node:v8').getHeapStatistics().heap_size_limit,compilerLoaded:false};
}

async function main(){
  if(process.argv.length===3){
    assert.ok(['--baseline','--optimized'].includes(process.argv[2]));
    console.log(JSON.stringify(await child(process.argv[2].slice(2))));return;
  }
  assert.equal(process.argv.length,2);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-worker-memory-'));
  try {
    assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));
    assert.ok(!directory.startsWith(project+path.sep));
    fs.writeFileSync(path.join(directory,'proof-only.txt'),'Phoenix synthetic terminal histories; never render or post.',{flag:'wx'});
    const folder=path.join(directory,'storage','Phoenix Studio Review Files');fs.mkdirSync(folder,{recursive:true});let fixtureBytes=0;
    for(const [key,name] of Object.entries(files)){
      const records=Array.from({length:1800},(_,index)=>({id:`synthetic-${key}-${index}`,status:key==='drafts'?'APPROVED':'COMPLETED',input:{topic:'Synthetic completed history',script:'x'.repeat(4096)}}));
      const text=JSON.stringify(records);assert.ok(Buffer.byteLength(text)<8_388_608);fixtureBytes+=Buffer.byteLength(text);
      fs.writeFileSync(path.join(folder,name),text,{flag:'wx'});
    }
    const results=[];
    for(const [mode,heap] of [['baseline',512],['optimized',192]]){
      const result=spawnSync(process.execPath,[`--max-old-space-size=${heap}`,__filename,`--${mode}`],{cwd:project,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:16000,
        env:{...process.env,PHOENIX_MEMORY_FIXTURE:directory,PHOENIX_MEMORY_PARENT:String(process.pid)}});
      assert.equal(result.status,0,result.stderr||result.error?.message);results.push(JSON.parse(result.stdout.trim()));
    }
    const [baseline,optimized]=results;
    assert.equal(baseline.bytesRead,fixtureBytes*rounds);assert.equal(baseline.opens,4*rounds);
    assert.equal(optimized.bytesRead,fixtureBytes);assert.equal(optimized.opens,4);
    assert.ok(optimized.heapLimit<baseline.heapLimit);
    console.log(JSON.stringify({proof:'idle-worker-synthetic-history-v1',fixtureBytes,rounds,baseline,optimized,ownerJobsRead:0,providerCalls:0,
      note:'Synthetic file scans, not a whole-worker/laptop peak or proof of sustained local memory. Real export is verified separately.'}));
  }finally{
    assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));assert.match(path.basename(directory),/^phoenix-worker-memory-[A-Za-z0-9]+$/);
    assert.ok(!fs.lstatSync(directory).isSymbolicLink());fs.rmSync(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
