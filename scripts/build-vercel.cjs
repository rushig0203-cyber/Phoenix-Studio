'use strict';
// Vercel packages its own Linux deployment. Never select a desktop release here.
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { MINIMUM_BUILD_FREE_BYTES } = require('./build-phoenix.cjs');
const root = path.resolve(__dirname, '..');

function vercelBuildOptions({ env = process.env, platform = process.platform, freeBytes = os.freemem() } = {}) {
  if (env.VERCEL !== '1' || platform !== 'linux') {
    throw new Error('This build command is only for Vercel Linux builds. Use npm run build / Apply Phoenix Update on the desktop.');
  }
  if (!Number.isFinite(freeBytes) || freeBytes < MINIMUM_BUILD_FREE_BYTES) {
    throw new Error('Vercel build needs at least 1664 MiB free memory. No build started.');
  }
  return {
    cwd: root,
    env: { ...env, PHOENIX_BUILD_DIR: '.next', NODE_OPTIONS: '--max-old-space-size=896', NEXT_TELEMETRY_DISABLED: '1' },
    args: [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'],
  };
}

async function runVercelBuild() {
  const options = vercelBuildOptions();
  console.log('Building .next for Vercel with one Next worker and an 896 MiB Node heap; desktop release selection is unchanged.');
  const code = await new Promise((resolve, reject) => {
    // Existing .next/cache is Vercel's disposable build cache, not an installed
    // local bundle. Let Next manage it; never delete directories or saved media.
    const child = spawn(process.execPath, options.args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => signal ? reject(new Error('Vercel build was interrupted.')) : resolve(code ?? 1));
  });
  if (code !== 0) throw new Error(`Vercel build failed (${code}).`);
  for (const file of ['BUILD_ID', 'routes-manifest.json', 'required-server-files.json']) {
    await fs.access(path.join(root, '.next', file));
  }
  console.log('Vercel .next output is ready for deployment packaging; no local worker or model was started.');
}

module.exports = { vercelBuildOptions };
if (require.main === module) runVercelBuild().catch(error => { console.error(error.message); process.exitCode = 1; });
