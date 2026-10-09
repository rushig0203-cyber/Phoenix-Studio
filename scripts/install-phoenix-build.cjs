'use strict';
// Downloaded bundles are staged and verified before the active selection changes.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const packaging=require('./package-phoenix-build.cjs');
const root=path.resolve(__dirname,'..');

function validateManifest(value,expectedCommit) {
  const fail=()=>{throw new Error('Installation manifest is invalid or does not match the requested source.');};
  if(!value||value.version!==1||!/^[a-f0-9]{40}$/.test(expectedCommit)||value.gitHead!==expectedCommit
    ||value.platform!=='win32'||value.arch!=='x64'||value.nodeVersion!==process.versions.node
    ||!/^\.next-build-gh-\d{1,24}-\d{1,8}$/.test(value.directory)
    ||!/^[A-Za-z0-9_-]{1,200}$/.test(value.buildId)||!/^[a-f0-9]{64}$/.test(value.lockfileSha256))fail();
  const archive=value.archive;
  if(!archive||archive.name!==packaging.ARCHIVE_NAME||!/^[a-f0-9]{64}$/.test(archive.sha256)
    ||!Number.isSafeInteger(archive.bytes)||archive.bytes<1||archive.bytes>packaging.MAX_ARCHIVE_BYTES
    ||!Number.isSafeInteger(archive.uncompressedBytes)||archive.uncompressedBytes<1||archive.uncompressedBytes>packaging.MAX_BUILD_BYTES
    ||!Array.isArray(value.files)||!value.files.length||value.files.length>packaging.MAX_FILES||archive.fileCount!==value.files.length)fail();
  const seen=new Set();let bytes=0;
  for(const file of value.files) {
    if(!file||typeof file.path!=='string'||!file.path.startsWith(value.directory+'/')
      ||!packaging.allowedBuildPath(file.path.slice(value.directory.length+1))||file.path.includes('/cache/')
      ||file.path.split('/').some(segment=>/[<>"|?*]/.test(segment)||/[. ]$/.test(segment))
      ||!Number.isSafeInteger(file.size)||file.size<0||!/^[a-f0-9]{64}$/.test(file.sha256))fail();
    const identity=file.path.toLowerCase();if(seen.has(identity))fail();seen.add(identity);bytes+=file.size;
  }
  if(bytes!==archive.uncompressedBytes||bytes>packaging.MAX_BUILD_BYTES)fail();
  return value;
}
async function boundedJson(filename,limit=8*1024*1024) {
  const stat=await fs.lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw new Error('State or manifest is oversized or not an ordinary file.');
  return JSON.parse(await fs.readFile(filename,'utf8'));
}
async function verifyLocalSource(manifest) {
  const head=(await execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true,maxBuffer:4096})).stdout.trim();
  const dirty=(await execute('git',['status','--porcelain','--untracked-files=no'],{cwd:root,windowsHide:true,maxBuffer:65536})).stdout.trim();
  if(head!==manifest.gitHead||dirty)throw new Error('Local committed source changed; bundle was not selected.');
  const lockPath=path.join(root,'package-lock.json');
  const lockDigest=await packaging.hashFile(lockPath,10*1024*1024);
  const lock=await boundedJson(lockPath,10*1024*1024);
  if(lockDigest.sha256!==manifest.lockfileSha256) {
    // Windows checkout line endings may differ; only identical committed JSON
    // bytes with LF versus CRLF may be accepted, never changed dependencies.
    const committed=(await execute('git',['show','HEAD:package-lock.json'],{cwd:root,windowsHide:true,maxBuffer:10*1024*1024})).stdout;
    const actual=await fs.readFile(lockPath,'utf8');
    const normalized=committed.replace(/\r\n/g,'\n');
    const hashes=[normalized,normalized.replace(/\n/g,'\r\n')].map(text=>createHash('sha256').update(text).digest('hex'));
    if(actual.replace(/\r\n/g,'\n')!==normalized||!hashes.includes(manifest.lockfileSha256))throw new Error('Dependency lock hash differs from the remote build.');
  }
  const packageJson=await boundedJson(path.join(root,'package.json'),1024*1024);
  for(const name of Object.keys({...packageJson.dependencies,...packageJson.devDependencies})) {
    const expected=lock.packages?.[`node_modules/${name}`]?.version;
    const installed=await boundedJson(path.join(root,'node_modules',name,'package.json'),1024*1024);
    if(!expected||installed.version!==expected)throw new Error(`Installed dependency does not match the build: ${name}.`);
  }
}
async function stageBundle(artifactDirectory,expectedCommit) {
  packaging.assertPlatform(process.platform,process.arch);
  const artifact=path.resolve(artifactDirectory);
  const manifest=validateManifest(await boundedJson(path.join(artifact,packaging.MANIFEST_NAME),4*1024*1024),expectedCommit);
  await verifyLocalSource(manifest);
  const archive=path.join(artifact,packaging.ARCHIVE_NAME),stat=await fs.lstat(archive);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==manifest.archive.bytes)throw new Error('Downloaded archive size is invalid.');
  if((await packaging.hashFile(archive,packaging.MAX_ARCHIVE_BYTES)).sha256!==manifest.archive.sha256)throw new Error('Downloaded archive hash is invalid.');
  const target=path.join(root,manifest.directory);
  try {await fs.lstat(target);throw new Error('Candidate already exists; no build was overwritten.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const tar=path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe');
  const listing=(await execute(tar,['-tzf',archive],{windowsHide:true,maxBuffer:12*1024*1024,timeout:60000})).stdout.trim().split(/\r?\n/);
  if(JSON.stringify(listing.slice().sort())!==JSON.stringify(manifest.files.map(file=>file.path).sort()))throw new Error('Archive contains unexpected paths.');
  const verbose=(await execute(tar,['-tvzf',archive],{windowsHide:true,maxBuffer:12*1024*1024,timeout:60000})).stdout.trim().split(/\r?\n/);
  if(verbose.length!==manifest.files.length||verbose.some(line=>!line.startsWith('-')))throw new Error('Archive contains links or non-file entries.');
  const staging=await fs.mkdtemp(path.join(root,'.next-stage-'));
  await execute(tar,['-xzf',archive,'-C',staging],{windowsHide:true,maxBuffer:65536,timeout:60000});
  const inventory=await packaging.inventoryBuild(staging,manifest.directory);
  const actual=inventory.files.map(({path,size,sha256})=>({path,size,sha256}));
  const expected=manifest.files.slice().sort((a,b)=>a.path.localeCompare(b.path));
  if(inventory.buildId!==manifest.buildId||inventory.bytes!==manifest.archive.uncompressedBytes
    ||JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Extracted bundle does not match its file hashes. Unselected staging files were retained.');
  await fs.rename(path.join(staging,manifest.directory),target);
  await fs.rmdir(staging);
  return {directory:manifest.directory,buildId:manifest.buildId,gitHead:manifest.gitHead};
}
async function selectBuild(directory) {
  if(!/^\.next-[a-z0-9-]+$/.test(directory))throw new Error('Invalid installed build selection.');
  const candidate=path.join(root,directory),stat=await fs.lstat(candidate);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(candidate)!==path.join(await fs.realpath(root),directory))throw new Error('Installed selection must stay in the canonical repository.');
  const id=await fs.readFile(path.join(candidate,'BUILD_ID'),'utf8');
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(id.trim()))throw new Error('Selection lacks a valid BUILD_ID.');
  const marker=path.join(root,'storage','active-build.json'),temporary=marker+`.install-${process.pid}.tmp`;
  await fs.writeFile(temporary,JSON.stringify({directory},null,2)+'\n',{flag:'wx'});
  await fs.rename(temporary,marker);
}
module.exports={validateManifest,stageBundle,selectBuild};
if(require.main===module) {
  const [mode,arg,commit]=process.argv.slice(2);
  const operation=mode==='stage'?stageBundle(arg,commit):mode==='select'?selectBuild(arg):Promise.reject(new Error('Use stage <download-directory> <commit>, or select <verified-directory>.'));
  operation.then(value=>{if(value)console.log(JSON.stringify(value));}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
