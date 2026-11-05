const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {withFileLock,recoverAbandonedFileLock}=require('../src/lib/fileLock.ts');
const temporary=fs.mkdtemp(path.join(os.tmpdir(),'phoenix-lock-tests-'));
after(async()=>fs.rm(await temporary,{recursive:true,force:true}));
const accessError=code=>Object.assign(new Error('simulated Windows sharing violation'),{code});

test('transient Windows lock-open errors retry without entering twice or losing ownership',async()=>{
  const lock=path.join(await temporary,'open.lock'),open=fs.open;let calls=0,entered=0;
  fs.open=async(...args)=>{if(args[0]===lock&&++calls<=2)throw accessError(calls===1?'EPERM':'EACCES');return open(...args);};
  try {assert.equal(await withFileLock(lock,async()=>{entered++;assert.match(await fs.readFile(lock,'utf8'),/^\d+-/);return 42;},{retryMs:1}),42);assert.equal(entered,1);assert.equal(calls,3);}
  finally{fs.open=open;}
  await assert.rejects(fs.stat(lock),{code:'ENOENT'});
});

test('persistent permission failures have a bounded actionable error and never execute work',async()=>{
  const lock=path.join(await temporary,'denied.lock'),open=fs.open;let entered=false;
  fs.open=async(...args)=>{if(args[0]===lock)throw accessError('EPERM');return open(...args);};
  try{await assert.rejects(withFileLock(lock,async()=>{entered=true;},{retryMs:2,timeoutMs:15}),/Timed out accessing.*EPERM.*permissions/);assert.equal(entered,false);}
  finally{fs.open=open;}
});

test('Windows unlock sharing violation retries after verifying the same owner',async()=>{
  const lock=path.join(await temporary,'release.lock'),rm=fs.rm;let attempts=0;
  fs.rm=async(...args)=>{if(args[0]===lock&&++attempts===1)throw accessError('EBUSY');return rm(...args);};
  try{assert.equal(await withFileLock(lock,async()=>7),7);assert.equal(attempts,2);}
  finally{fs.rm=rm;}
  await assert.rejects(fs.stat(lock),{code:'ENOENT'});
});

test('competing callers still serialize the whole read-modify-write section',async()=>{
  const lock=path.join(await temporary,'serial.lock');let active=0,maximum=0,total=0;
  await Promise.all(Array.from({length:8},()=>withFileLock(lock,async()=>{active++;maximum=Math.max(active,maximum);const old=total;await new Promise(resolve=>setTimeout(resolve,3));total=old+1;active--;},{retryMs:2})));
  assert.equal(maximum,1);assert.equal(total,8);
});

const deadToken='2147483647-11111111-1111-4111-8111-111111111111';
async function abandoned(name,token=deadToken){
  const filename=path.join(await temporary,name);
  await fs.writeFile(filename,token);
  const old=new Date(Date.now()-120000);await fs.utimes(filename,old,old);
  return filename;
}
async function exitedOwner(run){
  const kill=process.kill;
  process.kill=(pid,signal)=>{if(pid===2147483647&&signal===0)throw Object.assign(new Error('fixture owner exited'),{code:'ESRCH'});return kill(pid,signal);};
  try{return await run();}finally{process.kill=kill;}
}

test('abandoned recovery reuses normal acquisition and removes only an old exited owner lock',async()=>exitedOwner(async()=>{
  const filename=await abandoned('dead.lock');
  assert.equal(await recoverAbandonedFileLock(filename),true);
  await assert.rejects(fs.stat(filename),{code:'ENOENT'});
  assert.equal(await recoverAbandonedFileLock(filename),true,'Already absent locks do not need a new lock');
}));

test('live, fresh, malformed, oversized and inaccessible owners remain held',async()=>exitedOwner(async()=>{
  for(const [name,token] of [['live',`${process.pid}-11111111-1111-4111-8111-111111111111`],['malformed','fixture-owner'],['oversized','x'.repeat(65)]]){
    const filename=await abandoned(name+'.lock',token);
    assert.equal(await recoverAbandonedFileLock(filename),false,name);
    assert.equal(await fs.readFile(filename,'utf8'),token);
  }
  const fresh=await abandoned('fresh.lock');await fs.utimes(fresh,new Date(),new Date());
  assert.equal(await recoverAbandonedFileLock(fresh),false);assert.equal(await fs.readFile(fresh,'utf8'),deadToken);
  const denied=await abandoned('owner-denied.lock'),kill=process.kill;
  process.kill=()=>{throw Object.assign(new Error('fixture inaccessible owner'),{code:'EPERM'});};
  try{assert.equal(await recoverAbandonedFileLock(denied),false);assert.equal(await fs.readFile(denied,'utf8'),deadToken);}finally{process.kill=kill;}
}));

test('abandoned recovery retains a changed stale successor token during acquisition',async()=>exitedOwner(async()=>{
  const filename=await abandoned('successor.lock'),open=fs.open,successor=`${process.pid}-22222222-2222-4222-8222-222222222222`;let replaced=false;
  fs.open=async(...args)=>{
    if(args[0]===filename&&args[1]==='wx'&&!replaced){replaced=true;await fs.writeFile(filename,successor);const old=new Date(Date.now()-120000);await fs.utimes(filename,old,old);}
    return open(...args);
  };
  try{assert.equal(await recoverAbandonedFileLock(filename),false);assert.equal(replaced,true);assert.equal(await fs.readFile(filename,'utf8'),successor);}
  finally{fs.open=open;}
}));

test('abandoned recovery does not acquire a hard-linked lock',async()=>exitedOwner(async()=>{
  const filename=await abandoned('linked.lock'),alias=path.join(await temporary,'linked-alias.lock');await fs.link(filename,alias);
  assert.equal(await recoverAbandonedFileLock(filename),false);assert.equal(await fs.readFile(alias,'utf8'),deadToken);
}));
