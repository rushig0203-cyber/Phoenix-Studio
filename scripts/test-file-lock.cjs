const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {withFileLock}=require('../src/lib/fileLock.ts');
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
