const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {PHASE_DEVELOPMENT_SERVER:dev,PHASE_PRODUCTION_BUILD:build,PHASE_PRODUCTION_SERVER:server,PHASE_EXPORT:exportPhase}=require('next/constants');
const {selectNextBuild}=require('./next-build-selection.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-build-selection-'));
fs.mkdirSync(path.join(root,'storage'));fs.mkdirSync(path.join(root,'.next-current'));
fs.writeFileSync(path.join(root,'.next-current','BUILD_ID'),'verified');
const marker=path.join(root,'storage','active-build.json');
const select=(phase,env={})=>selectNextBuild(phase,{root,env});
const restore=()=>fs.writeFileSync(marker,JSON.stringify({directory:'.next-current'}));restore();
after(()=>{assert.ok(root.startsWith(os.tmpdir()+path.sep));assert.match(path.basename(root),/^phoenix-build-selection-/);fs.rmSync(root,{recursive:true,force:true});});
test('plain next start and launcher env select the identical verified release',()=>{
 assert.equal(select(server),'.next-current');assert.equal(select(server,{PHOENIX_BUILD_DIR:'.next-current'}),'.next-current');
 assert.throws(()=>select(server,{PHOENIX_BUILD_DIR:'.next-old'}),/differs from the installed/);
});
test('development ignores inherited production dir and never overwrites installed output',()=>{
 assert.equal(select(dev,{PHOENIX_BUILD_DIR:'.next-current'}),'.next-dev');
});
test('build requires a separate guarded output and never reuses installed dir',()=>{
 assert.equal(select(build,{PHOENIX_BUILD_DIR:'.next-new'}),'.next-new');
 for(const env of [{},{PHOENIX_BUILD_DIR:'.next-current'},{PHOENIX_BUILD_DIR:'../old'}])assert.throws(()=>select(build,env),/guarded build/);
});
test('missing, corrupt, traversal or incomplete markers never fall back to .next-lumina',()=>{
 fs.unlinkSync(marker);assert.throws(()=>select(server),/marker/);
 assert.equal(select(build,{PHOENIX_BUILD_DIR:'.next-new'}),'.next-new');
 for(const value of ['bad json',JSON.stringify({directory:'../old'}),JSON.stringify({directory:'.next-missing'})]){
   fs.writeFileSync(marker,value);assert.throws(()=>select(server),/marker|incomplete/);
 }restore();
});
test('Vercel build, server and adapter discovery use the same .next without a desktop marker',()=>{
 const cloudRoot=path.join(root,'cloud-checkout-without-storage');
 for(const phase of [build,server,exportPhase,undefined]) {
   assert.equal(selectNextBuild(phase,{root:cloudRoot,env:{VERCEL:'1'}}),'.next');
   assert.equal(selectNextBuild(phase,{root:cloudRoot,env:{VERCEL:'1',PHOENIX_BUILD_DIR:'.next-old'}}),'.next');
 }
 assert.equal(fs.existsSync(cloudRoot),false,'configuration discovery must not write a desktop marker or output');
 fs.writeFileSync(marker,'invalid desktop marker');
 try {
   assert.equal(select(server,{VERCEL:'1'}),'.next','Vercel must not consume even a corrupt desktop marker');
   assert.equal(fs.readFileSync(marker,'utf8'),'invalid desktop marker','cloud config must not repair or change desktop state');
 } finally {restore();}
 assert.equal(select(dev,{VERCEL:'1'}),'.next-dev','development still cannot overwrite production output');
 assert.equal(select(server),'.next-current','cloud config discovery must not change the installed desktop release');
});
test('truthy or inherited non-Vercel flags do not bypass desktop selection guards',()=>{
 for(const VERCEL of ['0','true','yes','',undefined]) {
   assert.throws(()=>select(build,{VERCEL}),/guarded build/);
   assert.equal(select(server,{VERCEL}),'.next-current');
 }
});
