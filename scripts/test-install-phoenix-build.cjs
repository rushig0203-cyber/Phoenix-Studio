'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateManifest}=require('./install-phoenix-build.cjs');
function fixture() {
  const directory='.next-build-gh-123456-1';
  return {version:1,gitHead:'a'.repeat(40),nodeVersion:process.versions.node,platform:'win32',arch:'x64',directory,buildId:'fixture-id',lockfileSha256:'b'.repeat(64),
    archive:{name:'phoenix-build.tar.gz',sha256:'c'.repeat(64),bytes:200,uncompressedBytes:10,fileCount:1},files:[{path:directory+'/server/page.js',size:10,sha256:'d'.repeat(64)}]};
}
test('verified manifest binds exact source, runtime and bounded file hashes',()=>{
  const value=fixture();assert.equal(validateManifest(value,value.gitHead),value);
  for(const edit of [{version:2},{gitHead:'b'.repeat(40)},{nodeVersion:'20.0.0'},{platform:'linux'},{arch:'arm64'},{directory:'../storage'},{buildId:''},{lockfileSha256:'bad'}])assert.throws(()=>validateManifest({...fixture(),...edit},'a'.repeat(40)));
});
test('archive limits and unexpected file counts fail closed',()=>{
  for(const edit of [{name:'other.tar.gz'},{sha256:'bad'},{bytes:0},{bytes:101*1024*1024},{uncompressedBytes:401*1024*1024},{fileCount:2}]) {
    const value=fixture();value.archive={...value.archive,...edit};assert.throws(()=>validateManifest(value,value.gitHead));
  }
});
test('traversal, sensitive files, cache and Windows unsafe names are rejected',()=>{
  for(const suffix of ['../outside','server/.env','server/private/token.json','cache/file.js','server/file.js:stream','server/file?.js','server/file.','server/file ','storage/index.json']) {
    const value=fixture();value.files[0].path=value.directory+'/'+suffix;assert.throws(()=>validateManifest(value,value.gitHead),suffix);
  }
});
test('case-insensitive duplicate files and false size totals are rejected',()=>{
  const value=fixture();value.files.push({...value.files[0],path:value.files[0].path.toUpperCase().replace(value.directory.toUpperCase(),value.directory)});value.archive.fileCount=2;value.archive.uncompressedBytes=20;
  assert.throws(()=>validateManifest(value,value.gitHead));
  const mismatch=fixture();mismatch.files[0].size=11;assert.throws(()=>validateManifest(mismatch,mismatch.gitHead));
});
test('compiled storage route code is allowed but owner storage remains forbidden',()=>{
  const value=fixture();value.files[0].path=value.directory+'/server/app/api/storage/usage/route.js';assert.equal(validateManifest(value,value.gitHead),value);
  value.files[0].path=value.directory+'/storage/index.json';assert.throws(()=>validateManifest(value,value.gitHead));
});
