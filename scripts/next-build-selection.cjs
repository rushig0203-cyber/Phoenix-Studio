const fs = require('node:fs');
const path = require('node:path');
const { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } = require('next/constants');
const valid = value => typeof value === 'string' && /^\.next-[a-z0-9-]+$/.test(value);
function marker(root, optional = false) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, 'storage', 'active-build.json'), 'utf8')).directory;
    if (!valid(value)) throw new Error('invalid marker');
    return value;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw new Error('Phoenix installed-build marker is missing or invalid. Use the canonical Phoenix project and its guarded update; no older build was selected.');
  }
}
function selectNextBuild(phase, { root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  // Development must never overwrite a verified production bundle.
  if (phase === PHASE_DEVELOPMENT_SERVER) return '.next-dev';
  // Vercel's adapter discovers the output outside our build child process. A
  // cloud checkout has no desktop selection marker, and must use one stable
  // directory for compilation, adapter discovery and server configuration.
  if (env.VERCEL === '1') return '.next';
  if (phase === PHASE_PRODUCTION_BUILD) {
    const selected = env.PHOENIX_BUILD_DIR;
    if (!valid(selected) || selected === marker(root, true)) throw new Error('Use npm run build / Apply Phoenix Update to create a separate guarded build. The installed bundle was not overwritten.');
    return selected;
  }
  const installed = marker(root);
  if (env.PHOENIX_BUILD_DIR && env.PHOENIX_BUILD_DIR !== installed) throw new Error('Requested Phoenix build differs from the installed release. Use the Desktop launcher; no old release was selected.');
  try {
    if (!fs.readFileSync(path.join(root, installed, 'BUILD_ID'), 'utf8').trim()) throw new Error('empty build');
  } catch { throw new Error('The selected Phoenix build is incomplete. Apply the guarded update; no old bundle was selected.'); }
  return installed;
}
module.exports = { selectNextBuild };
