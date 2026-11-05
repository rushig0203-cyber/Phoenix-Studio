const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const lockModule=require('../src/lib/fileLock.ts'),reviewId='11111111-1111-4111-8111-111111111111',token='2147483647-22222222-2222-4222-8222-222222222222';
const source=sync.readFileSync(path.join(__dirname,'recover-publication-locks.cjs'),'utf8');
function recovery(runtime){
  const fixtureModule={exports:{}};
  const localRequire=name=>name==='./worker-runtime.cjs'?runtime:require(name);
  new Function('require','module','exports',source)(localRequire,fixtureModule,fixtureModule.exports);
  return fixtureModule.exports.recoverPublicationLocks;
}
async function isolated(run){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'phoenix-publication-recovery-')),publications=path.join(root,'storage/private/review-publications');
  await fs.mkdir(publications,{recursive:true});
  const story=path.join(publications,reviewId+'-instagram-story.json'),reel=path.join(publications,reviewId+'-instagram.json');
  const locks=[story+'.lock',story+'.operation.lock',reel+'.lock',reel+'.operation.lock',path.join(publications,'.publication-stream.lock'),path.join(root,'storage/private/channels.enc.lock')];
  try{await run({root,publications,story,reel,locks});}
  finally{assert.equal(await fs.realpath(path.dirname(root)),await fs.realpath(os.tmpdir()));assert.match(path.basename(root),/^phoenix-publication-recovery-/);await fs.rm(root,{recursive:true,force:true});}
}
async function lock(filename){await fs.writeFile(filename,token);const old=new Date(Date.now()-120000);await fs.utimes(filename,old,old);}

test('clean/no-lock startup needs no new compiled capability or selected build',async()=>isolated(async({root})=>{
  let loaded=0;const run=recovery({compiledRuntime(){loaded++;throw new Error('Unexpected runtime load');}});
  assert.equal(await run(root,reviewId),true);assert.equal(loaded,0);
  assert.equal(await run(root,'../escaped'),false);assert.equal(loaded,0);
}));

test('recovery is limited to six known paths and never changes saved records or credentials',async()=>isolated(async({root,story,reel,locks,publications})=>{
  const stores=[story,reel,path.join(root,'storage/private/channels.enc')],contents=['{"status":"QUEUED","phase":"created"}','{"status":"FAILED","phase":"created"}','private-fixture-envelope'];
  for(let i=0;i<stores.length;i++)await fs.writeFile(stores[i],contents[i]);
  for(const filename of locks)await lock(filename);
  const unrelated=path.join(publications,'unrelated.operation.lock');await lock(unrelated);
  await fs.writeFile(path.join(root,'storage/active-build.json'),'{"directory":".next-fixture"}');
  const loaded=[],run=recovery({compiledRuntime(actualRoot,directory){assert.equal(actualRoot,root);assert.equal(directory,'.next-fixture');return {load(name){loaded.push(name);return lockModule;}};}});
  const kill=process.kill;process.kill=(pid,signal)=>{assert.equal(pid,2147483647);assert.equal(signal,0);throw Object.assign(new Error('fixture exited'),{code:'ESRCH'});};
  try{assert.equal(await run(root,reviewId),true);}finally{process.kill=kill;}
  assert.deepEqual(loaded,['fileLock']);for(const filename of locks)await assert.rejects(fs.stat(filename),{code:'ENOENT'});
  for(let i=0;i<stores.length;i++)assert.equal(await fs.readFile(stores[i],'utf8'),contents[i]);
  assert.equal(await fs.readFile(unrelated,'utf8'),token);
}));

test('older compiled releases fail closed for abandoned recovery',async()=>isolated(async({root,locks})=>{
  await lock(locks[0]);await fs.writeFile(path.join(root,'storage/active-build.json'),'{"directory":".next-fixture"}');
  const run=recovery({compiledRuntime(){return {load(){return {withFileLock:lockModule.withFileLock};}};}});
  assert.equal(await run(root,reviewId),false);assert.equal(await fs.readFile(locks[0],'utf8'),token);
}));

test('a redirected publication folder is rejected before loading a runtime',async()=>isolated(async({root,publications})=>{
  const outside=path.join(root,'other');await fs.rename(publications,outside);await fs.symlink(outside,publications,'junction');
  const run=recovery({compiledRuntime(){throw new Error('Unexpected runtime load');}});
  assert.equal(await run(root,reviewId),false);assert.deepEqual(await fs.readdir(outside),[]);
}));

test('a reparse lock stays busy',async()=>isolated(async({root,locks})=>{
  const target=path.join(root,'other');await fs.mkdir(target);await fs.symlink(target,locks[0],'junction');
  const run=recovery({compiledRuntime(){throw new Error('Unexpected runtime load');}});
  assert.equal(await run(root,reviewId),false);assert.deepEqual(await fs.readdir(target),[]);
}));
