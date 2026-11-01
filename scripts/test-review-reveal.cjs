// Real isolated review files, mocked Explorer only. No owner files, GUI, uploads or network.
const {test,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),child=require('node:child_process'),{EventEmitter}=require('node:events');
const project=path.resolve(__dirname,'..'),previous=process.cwd(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-reveal-test-'));
process.chdir(directory);
require(path.join(project,'node_modules/ts-node')).register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require(path.join(project,'node_modules/tsconfig-paths')).register({baseUrl:project,paths:{'@/*':['src/*']}});
const reviews=require('../src/lib/reviewFiles'),route=require('../src/app/api/review-files/[id]/reveal/route');
const originalSpawn=child.spawn,platform=Object.getOwnPropertyDescriptor(process,'platform'),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
assert.ok(reviews.reviewRoot().startsWith(directory+path.sep));
let launches=[];
beforeEach(async()=>{
  fs.rmSync(path.join(directory,'storage'),{recursive:true,force:true});await reviews.ensureReviewFolders();launches=[];
  child.spawn=(executable,args,options)=>{launches.push({executable,args,options});const process=new EventEmitter();process.unref=()=>{};queueMicrotask(()=>process.emit('spawn'));return process;};
  await reviews.saveReviewFile({id,title:'Fixture',status:'READY',createdAt:'2026-11-01',updatedAt:'2026-11-01',source:{kind:'upload',filename:'fixture.mp4'},outputs:{instagram:{filename:`${id}-instagram.mp4`,duration:10,width:720,height:1280}},quality:{audio:'natural-audio-preserved',captions:[],hashtags:[],checks:[]}});
  fs.writeFileSync(reviews.outputPath(id,'instagram'),'isolated MP4 identity fixture');
});
after(()=>{child.spawn=originalSpawn;Object.defineProperty(process,'platform',platform);process.chdir(previous);assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));assert.match(path.basename(directory),/^phoenix-reveal-test-/);fs.rmSync(directory,{recursive:true,force:true});});
const call=(options={})=>route.POST(new Request(`http://localhost:3000/api/review-files/${id}/reveal?target=${options.target||'instagram'}`,{method:'POST',headers:{origin:options.origin||'http://localhost:3000'},...(options.body?{body:options.body}:{})}),{params:Promise.resolve({id:options.id||id})});
test('reveals exactly the existing selected MP4 with no shell, file copy or private path in its response',async()=>{
  const before=fs.readFileSync(reviews.outputPath(id,'instagram')),result=await call();assert.equal(result.status,200);assert.deepEqual(await result.json(),{revealed:true});
  assert.equal(launches.length,1);assert.equal(path.basename(launches[0].executable).toLowerCase(),'explorer.exe');
  assert.deepEqual(launches[0].args,['/select,',fs.realpathSync(reviews.outputPath(id,'instagram'))]);assert.equal(launches[0].options.shell,undefined);assert.equal(launches[0].options.stdio,'ignore');
  assert.deepEqual(fs.readFileSync(reviews.outputPath(id,'instagram')),before);assert.equal(fs.readdirSync(path.join(reviews.reviewRoot(),'outputs')).length,1);
});
test('cross-origin requests, arbitrary IDs, arbitrary formats and request bodies never launch a process',async()=>{
  for(const [options,status] of [[{origin:'https://evil.example'},403],[{id:'../../private'},404],[{target:'../../private'},400],[{body:'x'.repeat(10000)},400]])assert.equal((await call(options)).status,status);
  assert.equal(launches.length,0);
});
test('missing, trashed, unfinished and absent-format outputs cannot reveal another file',async()=>{
  assert.equal((await call({target:'youtube'})).status,404);assert.equal((await call({id:'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'})).status,404);
  await reviews.updateReviewFile(id,file=>({...file,status:'FAILED'}));assert.equal((await call()).status,404);
  await reviews.updateReviewFile(id,file=>({...file,status:'READY'}));fs.unlinkSync(reviews.outputPath(id,'instagram'));assert.equal((await call()).status,500);assert.equal(launches.length,0);
  await reviews.updateReviewFile(id,file=>({...file,trashedAt:new Date().toISOString()}));assert.equal((await call()).status,404);assert.equal(launches.length,0);
});
test('a review-folder junction cannot reveal a file outside its allowed media root',async()=>{
  const outputs=path.join(reviews.reviewRoot(),'outputs'),outside=path.join(directory,'outside');fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,`${id}-instagram.mp4`),'outside');
  assert.ok(outputs.startsWith(directory+path.sep));fs.rmSync(outputs,{recursive:true,force:true});fs.symlinkSync(outside,outputs,'junction');
  try{const result=await call();assert.equal(result.status,500);assert.ok(!JSON.stringify(await result.json()).includes(outside));assert.equal(launches.length,0);}finally{fs.unlinkSync(outputs);}
});
test('Explorer launch failures remain actionable and non-Windows hosts do not launch anything',async()=>{
  child.spawn=()=>{throw Error('private process diagnostic');};const failed=await call();assert.equal(failed.status,500);assert.ok(!JSON.stringify(await failed.json()).includes('private process diagnostic'));
  child.spawn=()=>{const p=new EventEmitter();p.unref=()=>{};queueMicrotask(()=>p.emit('error',Error('private launch error')));return p;};assert.equal((await call()).status,500);
  try{Object.defineProperty(process,'platform',{...platform,value:'linux'});assert.equal((await call()).status,409);}finally{Object.defineProperty(process,'platform',platform);}
});
