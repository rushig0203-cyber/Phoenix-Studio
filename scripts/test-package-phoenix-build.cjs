'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const packaging=require('./package-phoenix-build.cjs');
const env={GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'123456',GITHUB_RUN_ATTEMPT:'2',PHOENIX_BUILD_DIR:'.next-build-gh-123456-2',SystemRoot:process.env.SystemRoot};
async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'phoenix-package-test-')),build=path.join(root,env.PHOENIX_BUILD_DIR);
  await fs.mkdir(path.join(build,'server','app'),{recursive:true});await fs.mkdir(path.join(build,'static','chunks'),{recursive:true});
  await fs.writeFile(path.join(root,'package-lock.json'),'{}');await fs.writeFile(path.join(build,'BUILD_ID'),'fixture-build');
  for(const name of packaging.REQUIRED_MANIFESTS) await fs.writeFile(path.join(build,name),'{}');
  await fs.writeFile(path.join(build,'server','app','page.js'),'module.exports={};');await fs.writeFile(path.join(build,'static','chunks','main.js'),'console.log("fixture");');
  return {root,build,options:{root,env,gitHead:'a'.repeat(40),outputDirectory:path.join(root,'artifact')}};
}
async function isolated(action) {
  const value=await fixture();try {await action(value);}finally {
    assert.ok(path.resolve(value.root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(value.root).startsWith('phoenix-package-test-'),'Cleanup stays within the exact temporary fixture');
    await fs.rm(value.root,{recursive:true,force:true});
  }
}
test('only a unique current GitHub Actions Windows x64 build may be exported',()=>{
  assert.equal(packaging.buildDirectory(env),env.PHOENIX_BUILD_DIR);
  for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_RUN_ID:'../1'},{GITHUB_RUN_ATTEMPT:''},{PHOENIX_BUILD_DIR:'.next-build-live'}]) assert.throws(()=>packaging.buildDirectory({...env,...change}));
  assert.throws(()=>packaging.assertPlatform('linux','x64'));assert.throws(()=>packaging.assertPlatform('win32','arm64'));packaging.assertPlatform('win32','x64');
});
test('sensitive paths, traversal, dependencies, models and runtime media are forbidden',()=>{
  for(const name of ['../outside','server/.env.local','server/private/key.json','storage/index.json','node_modules/next/index.js','models/model.gguf','static/video.mp4','server/credentials.json','server/token.key','server\\private.txt']) assert.equal(packaging.allowedBuildPath(name),false,name);
  for(const name of ['server/app/api/settings/route.js','server/app/api/storage','server/app/api/storage/usage/route.js','server/app/admin/storage/page.js','server/app/admin/storage.segments/admin/storage/__PAGE__.segment.rsc','static/chunks/app/admin/storage/page.js','types/app/api/admin/storage/route.ts','static/chunks/main.js','static/media/font.woff2','required-server-files.json']) assert.equal(packaging.allowedBuildPath(name),true,name);
});
test('complete bundle inventory hashes files sequentially and excludes the entire build cache',async()=>isolated(async({root,build})=>{
  await fs.mkdir(path.join(build,'cache'),{recursive:true});await fs.writeFile(path.join(build,'cache','.env'),'excluded fixture');
  const result=await packaging.inventoryBuild(root,env.PHOENIX_BUILD_DIR);
  assert.equal(result.buildId,'fixture-build');assert.equal(result.files.length,9);assert.ok(result.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(result.files.every(file=>file.path.startsWith(env.PHOENIX_BUILD_DIR+'/')&&!file.path.includes('/cache/')));
}));
test('missing manifests, sensitive files, size and file count fail closed',async()=>{
  await isolated(async({root,build})=>{await fs.unlink(path.join(build,'routes-manifest.json'));await assert.rejects(packaging.inventoryBuild(root,env.PHOENIX_BUILD_DIR),/missing/);});
  await isolated(async({root,build})=>{await fs.writeFile(path.join(build,'.env'),'fixture');await assert.rejects(packaging.inventoryBuild(root,env.PHOENIX_BUILD_DIR),/forbidden/);});
  await isolated(async({root})=>{await assert.rejects(packaging.inventoryBuild(root,env.PHOENIX_BUILD_DIR,{maximumBytes:1}),/limit/);await assert.rejects(packaging.inventoryBuild(root,env.PHOENIX_BUILD_DIR,{maximumFiles:1}),/limit/);});
});
test('junctions and hardlinked files are rejected',async()=>{
  await isolated(async({root,build})=>{const linked=path.join(root,'linked');await fs.mkdir(linked);await fs.symlink(linked,path.join(build,'linked'),'junction');await assert.rejects(packaging.inventoryBuild(root,env.PHOENIX_BUILD_DIR),/links/);});
  await isolated(async({root,build})=>{await fs.link(path.join(build,'BUILD_ID'),path.join(build,'linked-id'));await assert.rejects(packaging.inventoryBuild(root,env.PHOENIX_BUILD_DIR),/ordinary files/);});
});
test('real Windows tar artifact matches manifest allowlist and hashes without selecting a live bundle',async()=>isolated(async({root,build,options})=>{
  await fs.mkdir(path.join(build,'cache'));await fs.writeFile(path.join(build,'cache','excluded.txt'),'cache');
  const result=await packaging.packageBuild(options),manifest=result.manifest;
  assert.equal(manifest.version,1);assert.equal(manifest.gitHead,'a'.repeat(40));assert.equal(manifest.platform,'win32');assert.equal(manifest.arch,'x64');assert.equal(manifest.nodeVersion,process.versions.node);
  assert.equal(manifest.directory,env.PHOENIX_BUILD_DIR);assert.equal(manifest.archive.fileCount,manifest.files.length);assert.ok(manifest.archive.bytes<=packaging.MAX_ARCHIVE_BYTES);assert.ok(manifest.archive.uncompressedBytes<=packaging.MAX_BUILD_BYTES);
  assert.equal((await packaging.hashFile(path.join(result.outputDirectory,packaging.ARCHIVE_NAME))).sha256,manifest.archive.sha256);
  assert.equal((await packaging.hashFile(path.join(root,'package-lock.json'))).sha256,manifest.lockfileSha256);
  const {stdout}=await execute(path.join(env.SystemRoot,'System32','tar.exe'),['-tzf',path.join(result.outputDirectory,packaging.ARCHIVE_NAME)],{windowsHide:true,maxBuffer:1024*1024});
  assert.deepEqual(stdout.trim().split(/\r?\n/).sort(),manifest.files.map(file=>file.path).sort());
  await assert.rejects(fs.access(path.join(root,'storage','active-build.json')));
  await assert.rejects(packaging.packageBuild(options),/EEXIST/);
}));
test('compressed size failure removes only this fresh incomplete artifact',async()=>isolated(async({options})=>{
  await assert.rejects(packaging.packageBuild({...options,limits:{maximumArchiveBytes:1}}),/size limit/);
  await assert.rejects(fs.access(options.outputDirectory));
}));
