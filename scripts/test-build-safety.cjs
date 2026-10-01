const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildDirectory,currentBuildTypes,MINIMUM_BUILD_FREE_BYTES}=require('./build-phoenix.cjs');
test('build output stays inside a dedicated Phoenix folder, separate from live media',()=>{
  assert.match(buildDirectory(),/^\.next-build-\d+$/);
  assert.equal(buildDirectory('.next-client-verified'),'.next-client-verified');
  for(const name of ['../.next-test','C:\\Windows','.next','storage','.next-test/../storage'])assert.throws(()=>buildDirectory(name),/inside PhoenixStudio/);
  assert.equal(MINIMUM_BUILD_FREE_BYTES,1664*1024*1024);
});
test('repeated builds replace only generated Next type includes, not owner source settings',()=>{
  const config={compilerOptions:{strict:true},include:['src/**/*.ts','custom/types/**/*.ts','.next/types/**/*.ts','.next-old/dev/types/**/*.ts']};
  const first=currentBuildTypes(config,'.next-one');
  const second=currentBuildTypes(first,'.next-two');
  assert.deepEqual(second.include,['src/**/*.ts','custom/types/**/*.ts','.next-two/types/**/*.ts','.next-two/dev/types/**/*.ts']);
  assert.deepEqual(second.compilerOptions,config.compilerOptions);
  assert.equal(config.include.length,4);
  assert.throws(()=>currentBuildTypes({},'.next-test'),/configuration/);
});
