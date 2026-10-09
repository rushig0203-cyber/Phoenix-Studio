const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {refreshInstalledRelease} = require('../src/lib/releaseRefresh.ts');
function fixture() {
  const data = new Map(); let reloads = 0;
  return {data, count:()=>reloads, options:{loaded:'.next-build-old',serving:'.next-build-new',defer:false,
    storage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},reload:()=>reloads++}};
}
test('refreshes an older dashboard once without another HTTP request',()=>{
  const f=fixture(); assert.equal(refreshInstalledRelease(f.options),'reloaded');
  assert.equal(refreshInstalledRelease(f.options),'blocked'); assert.equal(f.count(),1);
  assert.equal(refreshInstalledRelease({...f.options,serving:'.next-build-newer'}),'reloaded'); assert.equal(f.count(),2);
});
test('open editing/preview defers and resumes when safe',()=>{
  const f=fixture(); assert.equal(refreshInstalledRelease({...f.options,defer:true}),'deferred'); assert.equal(f.count(),0); assert.equal(f.data.size,0);
  assert.equal(refreshInstalledRelease(f.options),'reloaded');
});
test('matching release clears stale guard; dev or missing release never reloads',()=>{
  const f=fixture(); refreshInstalledRelease(f.options);
  assert.equal(refreshInstalledRelease({...f.options,loaded:f.options.serving}),'current'); assert.equal(f.data.size,0);
  for(const loaded of [undefined,'', '.next-dev','../old']) assert.equal(refreshInstalledRelease({...f.options,loaded}),'ignored');
  assert.equal(refreshInstalledRelease({...f.options,serving:undefined}),'ignored'); assert.equal(f.count(),1);
});
test('disabled storage fails closed rather than causing a reload loop',()=>{
  const f=fixture(); const storage={getItem:()=>{throw Error('disabled')},setItem:()=>{throw Error('disabled')},removeItem:()=>{throw Error('disabled')}};
  assert.equal(refreshInstalledRelease({...f.options,storage}),'blocked'); assert.equal(f.count(),0);
});
