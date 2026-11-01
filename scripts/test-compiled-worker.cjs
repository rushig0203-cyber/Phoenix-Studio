const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),{compileWorker}=require('./compile-worker.cjs'),{compiledRuntime,WORKER_RUNTIME}=require('./worker-runtime.cjs');
const helper=path.join(__dirname,'worker-runtime.cjs'),directory='.next-worker-fixture';
async function isolated(run,compile=true){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'phoenix-compiled-worker-')),build=path.join(root,directory),folder=path.join(build,'server','phoenix-worker');
  try{
    for(const relative of ['src/lib','scripts','assets/music/lofi-cc0-v1','storage',`${directory}/server`])await fs.mkdir(path.join(root,relative),{recursive:true});
    await fs.writeFile(path.join(build,'BUILD_ID'),'worker-fixture');
    await fs.writeFile(path.join(build,'required-server-files.json'),JSON.stringify({config:{env:{PHOENIX_WORKER_RUNTIME:WORKER_RUNTIME}}}));
    await fs.writeFile(path.join(root,'src/lib/alpha.ts'),'import { value } from "./beta"; import { value as alias } from "@/lib/beta"; import manifest from "../../assets/music/lofi-cc0-v1/manifest.json"; export const result: string = `${value+alias}:${manifest.licence}`;');
    await fs.writeFile(path.join(root,'src/lib/beta.ts'),'export const value: number = 7;');
    await fs.writeFile(path.join(root,'assets/music/lofi-cc0-v1/manifest.json'),'{"licence":"CC0"}');
    await fs.writeFile(path.join(root,'scripts/worker-main.cjs'),'module.exports=load=>load("alpha").result;');
    await fs.writeFile(path.join(root,'scripts/worker-workflows.cjs'),'module.exports={};');
    if(compile)await compileWorker(root,directory);
    await run({root,build,folder});
  }finally{assert.equal(await fs.realpath(path.dirname(root)),await fs.realpath(os.tmpdir()));assert.match(path.basename(root),/^phoenix-compiled-worker-/);await fs.rm(root,{recursive:true,force:true});}
}
async function childRuntime(root,explicit=true){
  const code=`const {workerRuntime}=require(${JSON.stringify(helper)});const r=workerRuntime({root:${JSON.stringify(root)}${explicit?`,directory:${JSON.stringify(directory)}`:''}});const value=require(r.main)(r.load);console.log(JSON.stringify({value,compiled:r.compiled,compilerLoaded:Object.keys(require.cache).some(p=>/[\\\\/]node_modules[\\\\/](?:typescript|ts-node)[\\\\/]/.test(p))}));`;
  const env={...process.env};delete env.PHOENIX_BUILD_DIR;delete env.VERCEL;
  const result=await execute(process.execPath,['--max-old-space-size=160','-e',code],{cwd:root,env,windowsHide:true,timeout:15000,maxBuffer:65536});return JSON.parse(result.stdout.trim());
}
test('compiled worker executes relative imports, project aliases and licensed JSON without a compiler',async()=>isolated(async({root,folder})=>{
  const result=await childRuntime(root);assert.deepEqual(result,{value:'14:CC0',compiled:true,compilerLoaded:false});
  const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));assert.equal(manifest.version,WORKER_RUNTIME);assert.equal(manifest.files.length,5);
  await assert.rejects(compileWorker(root,directory),/EEXIST/);
  await fs.writeFile(path.join(root,'storage/active-build.json'),JSON.stringify({directory}));assert.deepEqual(await childRuntime(root,false),result);
}));
test('wrong release, duplicate or traversal entries and changed compiled bytes fail closed',async()=>isolated(async({root,folder})=>{
  const file=path.join(folder,'manifest.json'),original=JSON.parse(await fs.readFile(file,'utf8'));
  for(const manifest of [{...original,buildId:'wrong'},{...original,files:[...original.files,original.files[0]]},{...original,files:[{...original.files[0],path:'../outside.js'}]}]){
    await fs.writeFile(file,JSON.stringify(manifest));assert.throws(()=>compiledRuntime(root,directory),/match|Invalid/);
  }
  await fs.writeFile(file,JSON.stringify(original));await fs.appendFile(path.join(folder,'src/lib/beta.js'),'\n// changed');assert.throws(()=>compiledRuntime(root,directory),/verification/);
  assert.throws(()=>compiledRuntime(root,'../outside'),/Invalid/);
}));
test('compilation never touches the selected build and runtime rejects escaped module links',async()=>isolated(async({root,folder})=>{
  await fs.writeFile(path.join(root,'storage/active-build.json'),JSON.stringify({directory}));await assert.rejects(compileWorker(root,directory),/active release/);
  const target=path.join(folder,'src/lib'),outside=path.join(root,'outside');assert.ok(target.startsWith(root+path.sep)&&outside.startsWith(root+path.sep));await fs.rename(target,outside);await fs.symlink(outside,target,'junction');
  assert.throws(()=>compiledRuntime(root,directory),/verification/);
}));
test('new releases cannot fall back to source when compiled output is missing; legacy releases still load',async()=>isolated(async({root,build})=>{
  await fs.writeFile(path.join(root,'storage/active-build.json'),JSON.stringify({directory}));await assert.rejects(childRuntime(root,false),/ENOENT/);
  await fs.writeFile(path.join(build,'required-server-files.json'),JSON.stringify({config:{env:{PHOENIX_WORKER_RUNTIME:'unknown-version'}}}));await assert.rejects(childRuntime(root,false),/Unsupported worker release/);
  await fs.writeFile(path.join(build,'required-server-files.json'),JSON.stringify({config:{env:{}}}));
  const result=await childRuntime(root,false);assert.deepEqual(result,{value:'14:CC0',compiled:false,compilerLoaded:true});
},false));
test('compilation refuses an output junction before writing outside its build',async()=>isolated(async({root,build})=>{
  const server=path.join(build,'server'),outside=path.join(root,'outside-server');assert.ok(server.startsWith(root+path.sep)&&outside.startsWith(root+path.sep));await fs.rename(server,outside);await fs.symlink(outside,server,'junction');
  await assert.rejects(compileWorker(root,directory),/redirected server/);assert.deepEqual(await fs.readdir(outside),[]);
},false));
