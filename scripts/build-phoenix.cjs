// A build is heavy work too. Keep it separate from the live bundle and do not
// compete with a render/model request on the owner's small Windows laptop.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const MINIMUM_BUILD_FREE_BYTES = 1664 * 1024 * 1024;

function currentBuildTypes(config, directory) {
  if (!Array.isArray(config.include)) throw new Error('TypeScript include configuration is missing. Build stopped without changing it.');
  return { ...config, include: [...config.include.filter(value => typeof value !== 'string' || !/^\.next(?:-[a-z0-9-]+)?\/(?:dev\/)?types\/\*\*\/\*\.ts$/.test(value)), `${directory}/types/**/*.ts`, `${directory}/dev/types/**/*.ts`] };
}

function buildDirectory(value) {
  const selected = value || `.next-build-${new Date().toISOString().replace(/[^0-9]/g, '')}`;
  if (!/^\.next-[a-z0-9-]+$/.test(selected)) throw new Error('Build directory must be a new .next-* folder inside PhoenixStudio.');
  return selected;
}

async function runBuild() {
  process.chdir(root);
  require('@next/env').loadEnvConfig(root);
  require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
  const { tryWithLocalRenderSlot, heavyWorkStatus, lowerChildProcessPriority } = require('../src/lib/renderResources.ts');
  const { writeAtomicJson } = require('../src/lib/atomicJson.ts');
  const directory = buildDirectory(process.env.PHOENIX_BUILD_DIR);
  try { await fs.access(path.join(root, directory)); throw new Error('Build output already exists. Choose a fresh PHOENIX_BUILD_DIR; the previous bundle is retained.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await tryWithLocalRenderSlot(async () => {
    if (os.freemem() < MINIMUM_BUILD_FREE_BYTES) throw new Error(`Build waiting for memory: at least 1664 MiB free is recommended; ${Math.floor(os.freemem()/1048576)} MiB available. No build started; the website and saved jobs are unchanged.`);
    const configPath = path.join(root, 'tsconfig.json');
    // Next adds its generated route types on each build. Keep only this build's
    // generated entries, while preserving all owner source includes/options.
    await writeAtomicJson(configPath, currentBuildTypes(JSON.parse(await fs.readFile(configPath, 'utf8')), directory));
    console.log(`Building ${directory} with one Next worker and an 896 MiB Node heap. The current website bundle is retained.`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
        cwd:root, windowsHide:true, stdio:'inherit',
        env:{...process.env, PHOENIX_BUILD_DIR:directory, NODE_OPTIONS:'--max-old-space-size=896', NEXT_TELEMETRY_DISABLED:'1'},
      });
      lowerChildProcessPriority(child.pid);
      child.once('error', reject);
      child.once('close', (code, signal) => signal ? reject(new Error(`Build interrupted by ${signal}; active bundle unchanged.`)) : resolve(code ?? 1));
    });
    if (code !== 0) throw new Error(`Build failed (${code}); active bundle unchanged.`);
    await fs.access(path.join(root, directory, 'BUILD_ID'));
    await writeAtomicJson(path.join(root, 'storage/active-build.json'), {directory});
    console.log(`Verified build selected: ${directory}. Restart Phoenix to load it; no service was stopped by this build.`);
  }, 'Building Phoenix update');
  if (!result.acquired) throw new Error(`Build not started: ${(await heavyWorkStatus()).reason}. Retry after the active operation finishes.`);
}

module.exports = {buildDirectory, currentBuildTypes, MINIMUM_BUILD_FREE_BYTES};
if(require.main===module)runBuild().catch(error=>{console.error(error.message);process.exitCode=1;});
