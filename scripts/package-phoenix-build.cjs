'use strict';
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const MAX_ARCHIVE_BYTES=100*1024*1024;
const MAX_BUILD_BYTES=400*1024*1024;
const MAX_FILES=10000;
const ARCHIVE_NAME='phoenix-build.tar.gz';
const MANIFEST_NAME='phoenix-build-manifest.json';
const REQUIRED_MANIFESTS=['build-manifest.json','prerender-manifest.json','routes-manifest.json','required-server-files.json','server/app-paths-manifest.json','server/pages-manifest.json'];

function buildDirectory(env) {
  if(env.GITHUB_ACTIONS!=='true'||!/^\d{1,24}$/.test(env.GITHUB_RUN_ID||'')||!/^\d{1,8}$/.test(env.GITHUB_RUN_ATTEMPT||'')) throw new Error('Packaging requires a GitHub Actions run identity.');
  const directory=`.next-build-gh-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  if(env.PHOENIX_BUILD_DIR!==directory) throw new Error('PHOENIX_BUILD_DIR must match this unique GitHub Actions build directory.');
  return directory;
}
function assertPlatform(platform,arch) {
  if(platform!=='win32'||arch!=='x64') throw new Error('Phoenix build artifacts must be packaged on Windows x64.');
}
function allowedBuildPath(relative) {
  const parts=relative.split('/');
  if(!relative||relative.length>1024||/[\u0000-\u001f\u007f\\:]/.test(relative)||parts.some(part=>!part||part==='.'||part==='..')) return false;
  // This is compiled route code, not the owner's storage directory. Keep the
  // exact application API subtree while rejecting storage anywhere else.
  const compiledStorage=/^(?:(?:server|types)\/app|static\/chunks\/app)\/(?:api\/(?:admin\/)?storage|admin\/storage)(?:[./]|$)/.test(relative);
  if(parts.some((part,index)=>/^(?:\.env.*|\.git|node_modules|storage|private|models?|credentials?|secrets?)$/i.test(part)
    &&!(part==='storage'&&index>=3&&compiledStorage))) return false;
  if(/^(?:credentials?|secrets?|tokens?|private-settings)(?:[._-].*)?$/i.test(parts.at(-1))) return false;
  return !/\.(?:pem|key|pfx|p12|db|sqlite|sqlite3|mp4|mov|mkv|webm|avi|mp3|wav|flac|ogg|m4a|safetensors|gguf|onnx|pt|pth)$/i.test(relative);
}
async function hashFile(filename,maximum=MAX_BUILD_BYTES) {
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(filename,{highWaterMark:64*1024})) {
    bytes+=chunk.length;if(bytes>maximum) throw new Error('File exceeds its packaging size limit.');hash.update(chunk);
  }
  return {sha256:hash.digest('hex'),bytes};
}
async function plainDirectory(filename) {
  const stat=await fs.lstat(filename);
  if(!stat.isDirectory()||stat.isSymbolicLink()) throw new Error('Build directories must be real directories, not links.');
  return stat;
}
async function inventoryBuild(root,directory,limits={}) {
  const maximumBytes=Math.min(limits.maximumBytes??MAX_BUILD_BYTES,MAX_BUILD_BYTES),maximumFiles=Math.min(limits.maximumFiles??MAX_FILES,MAX_FILES);
  const build=path.join(root,directory);
  await plainDirectory(root);await plainDirectory(build);
  if(await fs.realpath(build)!==path.join(await fs.realpath(root),directory)) throw new Error('Build directory resolves outside the repository.');
  const files=[];let bytes=0,directories=0;
  async function walk(folder,relative='',depth=0) {
    if(depth>24||++directories>10000) throw new Error('Build directory nesting or entry count exceeds the packaging limit.');
    for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
      const name=relative?`${relative}/${entry.name}`:entry.name;
      if(name==='cache') continue;
      if(!allowedBuildPath(name)) throw new Error(`Build contains a forbidden sensitive or runtime-media path: ${name}`);
      const filename=path.join(folder,entry.name),stat=await fs.lstat(filename);
      if(stat.isSymbolicLink()) throw new Error('Build links cannot be included in an artifact.');
      if(stat.isDirectory()) {await walk(filename,name,depth+1);continue;}
      if(!stat.isFile()||stat.nlink!==1||!Number.isSafeInteger(stat.size)) throw new Error('Build artifacts may contain only ordinary files.');
      bytes+=stat.size;if(bytes>maximumBytes||files.length>=maximumFiles) throw new Error('Build exceeds the uncompressed size or file-count limit.');
      const digest=await hashFile(filename,maximumBytes);
      if(digest.bytes!==stat.size) throw new Error('Build changed while being inventoried.');
      files.push({path:`${directory}/${name}`,size:stat.size,sha256:digest.sha256,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
    }
  }
  await walk(build);files.sort((a,b)=>a.path.localeCompare(b.path));
  const names=new Set(files.map(file=>file.path.slice(directory.length+1)));
  if(!names.has('BUILD_ID')||!REQUIRED_MANIFESTS.every(name=>names.has(name))||!files.some(file=>file.path.startsWith(`${directory}/static/`))||!files.some(file=>file.path.startsWith(`${directory}/server/`)&&file.path.endsWith('.js'))) throw new Error('Build is missing its required Next manifests, server or static files.');
  for(const name of REQUIRED_MANIFESTS) {
    const manifest=files.find(file=>file.path===`${directory}/${name}`);
    if(manifest.size>5*1024*1024) throw new Error('Required Next manifest is too large.');
    JSON.parse(await fs.readFile(path.join(build,name),'utf8'));
  }
  const buildIdFile=files.find(file=>file.path===`${directory}/BUILD_ID`);
  if(buildIdFile.size>256) throw new Error('Invalid BUILD_ID.');
  const buildId=(await fs.readFile(path.join(build,'BUILD_ID'),'utf8')).trim();
  if(!/^[a-zA-Z0-9_-]{1,200}$/.test(buildId)) throw new Error('Invalid BUILD_ID.');
  return {files,bytes,buildId};
}
async function packageBuild(options={}) {
  const root=path.resolve(options.root||path.join(__dirname,'..')),env=options.env||process.env;
  const platform=options.platform||process.platform,arch=options.arch||process.arch;
  assertPlatform(platform,arch);const directory=buildDirectory(env);
  const inventory=await inventoryBuild(root,directory,options.limits);
  const gitHead=options.gitHead||(await execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true,maxBuffer:4096})).stdout.trim();
  if(!/^[a-f0-9]{40}$/.test(gitHead)) throw new Error('A full Git HEAD commit is required.');
  const lockfile=path.join(root,'package-lock.json'),lockStat=await fs.lstat(lockfile);
  if(!lockStat.isFile()||lockStat.isSymbolicLink()||lockStat.nlink!==1) throw new Error('Lockfile must be an ordinary file.');
  const lockfileSha256=(await hashFile(lockfile,10*1024*1024)).sha256;
  const output=path.resolve(options.outputDirectory||env.PHOENIX_ARTIFACT_DIR||path.join(root,`phoenix-artifact-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`));
  if(output===root||output===path.parse(output).root||output===path.join(root,directory)||output.startsWith(path.join(root,directory)+path.sep)) throw new Error('Artifact output must be a fresh directory separate from the build.');
  await fs.mkdir(output); // Exclusive creation: never overwrite an artifact or owner directory.
  const archive=path.join(output,ARCHIVE_NAME),list=path.join(output,'build-files.txt'),manifestPath=path.join(output,MANIFEST_NAME);
  try {
    await fs.writeFile(list,inventory.files.map(file=>file.path).join('\n')+'\n',{flag:'wx'});
    const tar=options.tarExecutable||path.join(env.SystemRoot||'C:\\Windows','System32','tar.exe');
    await execute(tar,['-czf',archive,'-C',root,'--no-recursion','-T',list],{windowsHide:true,maxBuffer:1024*1024,timeout:120000});
    const archiveHash=await hashFile(archive,Math.min(options.limits?.maximumArchiveBytes??MAX_ARCHIVE_BYTES,MAX_ARCHIVE_BYTES));
    for(const file of inventory.files) {
      const stat=await fs.lstat(path.join(root,file.path));
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.size||stat.mtimeMs!==file.mtimeMs||stat.ctimeMs!==file.ctimeMs) throw new Error('Build changed during packaging.');
    }
    const manifest={version:1,gitHead,nodeVersion:process.versions.node,platform,arch,directory,buildId:inventory.buildId,lockfileSha256,
      archive:{name:ARCHIVE_NAME,sha256:archiveHash.sha256,bytes:archiveHash.bytes,uncompressedBytes:inventory.bytes,fileCount:inventory.files.length},
      files:inventory.files.map(({path,size,sha256})=>({path,size,sha256}))};
    await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});await fs.unlink(list);
    return {outputDirectory:output,manifest};
  } catch(error) {
    // Remove only files this invocation created; no recursive deletion.
    for(const filename of [manifestPath,archive,list]) await fs.unlink(filename).catch(()=>{});
    await fs.rmdir(output).catch(()=>{});throw error;
  }
}
module.exports={packageBuild,inventoryBuild,allowedBuildPath,buildDirectory,assertPlatform,hashFile,MAX_ARCHIVE_BYTES,MAX_BUILD_BYTES,MAX_FILES,ARCHIVE_NAME,MANIFEST_NAME,REQUIRED_MANIFESTS};
if(require.main===module) packageBuild({outputDirectory:process.argv[2]}).then(result=>console.log(`Packaged ${result.manifest.directory}: ${result.manifest.archive.fileCount} files, ${result.manifest.archive.bytes} compressed bytes.`)).catch(error=>{console.error(error.message);process.exitCode=1;});
