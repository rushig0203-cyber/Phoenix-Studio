process.chdir(__dirname);
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const { workerRuntime } = require('./scripts/worker-runtime.cjs');
const preflight = process.argv.includes('--preflight');
const buildIndex = process.argv.indexOf('--build');
if (buildIndex >= 0 && (!preflight || !process.argv[buildIndex + 1])) throw new Error('An explicit worker build is allowed only with read-only preflight and a build name.');
const runtime = workerRuntime({ source: process.argv.includes('--source'), directory: buildIndex >= 0 ? process.argv[buildIndex + 1] : undefined });
console.log(`Phoenix Studio: ${runtime.compiled ? 'Compiled' : 'Source'} worker loader initialized.`);
require(runtime.main)(runtime.load);
if (preflight) {
  const compilerLoaded = Object.keys(require.cache).some(filename => /[\\/]node_modules[\\/](?:typescript|ts-node)[\\/]/.test(filename));
  if (runtime.compiled && compilerLoaded) throw new Error('Compiled worker unexpectedly loaded the TypeScript compiler.');
  console.log(JSON.stringify({ compiled: runtime.compiled, compilerLoaded, memory: process.memoryUsage() }));
}
