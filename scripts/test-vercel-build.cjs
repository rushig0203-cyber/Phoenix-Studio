const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {vercelBuildOptions}=require('./build-vercel.cjs');
const {MINIMUM_BUILD_FREE_BYTES}=require('./build-phoenix.cjs');
const root=path.resolve(__dirname,'..');
const input={env:{VERCEL:'1'},platform:'linux',freeBytes:MINIMUM_BUILD_FREE_BYTES};

test('cloud command and output agree with the Vercel adapter using locked dependencies',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 assert.equal(config.framework,'nextjs');
 assert.equal(config.outputDirectory,'.next');
 assert.equal(config.buildCommand,'node --max-old-space-size=256 scripts/build-vercel.cjs');
 assert.equal(config.installCommand,'npm ci --legacy-peer-deps --no-audit --no-fund');
 assert.deepEqual(config.crons,[]);
 assert.doesNotMatch(JSON.stringify(config),/git.*enabled|ignoredBuildStep|ignoreCommand/,'deployment checks must not be hidden');
});
test('Vercel uses bounded webpack production build without changing the caller environment',()=>{
 const env={VERCEL:'1',PHOENIX_BUILD_DIR:'.next-old',NODE_OPTIONS:'--max-old-space-size=6000',KEEP_ME:'retained'};
 const plan=vercelBuildOptions({...input,env});
 assert.equal(plan.cwd,root);
 assert.equal(plan.env.PHOENIX_BUILD_DIR,'.next');
 assert.equal(plan.env.NODE_OPTIONS,'--max-old-space-size=896');
 assert.equal(plan.env.NEXT_TELEMETRY_DISABLED,'1');
 assert.equal(plan.env.KEEP_ME,'retained');
 assert.equal(env.PHOENIX_BUILD_DIR,'.next-old');
 assert.equal(env.NODE_OPTIONS,'--max-old-space-size=6000');
 assert.deepEqual(plan.args,[path.join(root,'node_modules/next/dist/bin/next'),'build','--webpack']);
});
test('cloud build refuses local execution and keeps the existing memory floor',()=>{
 for(const env of [{},{VERCEL:'0'},{VERCEL:'true'}]) assert.throws(()=>vercelBuildOptions({...input,env}),/only for Vercel/);
 for(const platform of ['win32','darwin']) assert.throws(()=>vercelBuildOptions({...input,platform}),/only for Vercel/);
 for(const freeBytes of [0,MINIMUM_BUILD_FREE_BYTES-1,NaN,Infinity]) assert.throws(()=>vercelBuildOptions({...input,freeBytes}),/1664 MiB/);
 assert.equal(MINIMUM_BUILD_FREE_BYTES,1664*1024*1024);
});
test('cloud entry never imports local services, writes desktop selection or deletes build cache',()=>{
 const source=fs.readFileSync(path.join(root,'scripts/build-vercel.cjs'),'utf8');
 assert.doesNotMatch(source,/renderResources|tryWithLocalRenderSlot|writeAtomicJson|active-build\.json|fs\.(?:rm|unlink|rmdir)|start-phoenix|run-worker|ollama/i);
});
