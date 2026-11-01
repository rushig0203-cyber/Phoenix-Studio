'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const WORKER_RUNTIME = 'compiled-cjs-v1';
const validDirectory = value => typeof value === 'string' && /^\.next-[a-z0-9-]+$/.test(value);

function compiledRuntime(root, directory) {
  if (!validDirectory(directory)) throw new Error('Invalid compiled worker build.');
  const build = path.join(root, directory), folder = path.join(build, 'server', 'phoenix-worker');
  const physicalBuild = fs.realpathSync.native(build);
  if (physicalBuild !== path.join(fs.realpathSync.native(root), directory) || fs.lstatSync(build).isSymbolicLink()
      || fs.lstatSync(folder).isSymbolicLink() || fs.realpathSync.native(folder) !== path.join(physicalBuild, 'server', 'phoenix-worker')) throw new Error('Compiled worker must stay inside its selected release.');
  const manifestFile = path.join(folder, 'manifest.json');
  if (fs.lstatSync(manifestFile).isSymbolicLink() || fs.statSync(manifestFile).size > 262144) throw new Error('Invalid compiled worker manifest.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.version !== WORKER_RUNTIME || manifest.buildId !== fs.readFileSync(path.join(build, 'BUILD_ID'), 'utf8').trim()
      || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 256) throw new Error('Compiled worker does not match its release.');
  const seen = new Set(); let bytes = 0;
  for (const item of manifest.files) {
    if (!item || typeof item.path !== 'string' || !/^(?:src\/lib\/[A-Za-z][A-Za-z0-9]*\.js|scripts\/worker-(?:main|workflows)\.cjs|assets\/music\/lofi-cc0-v1\/manifest\.json)$/.test(item.path)
        || seen.has(item.path) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 1048576 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid compiled worker file record.');
    seen.add(item.path); bytes += item.size;
    const filename = path.join(folder, ...item.path.split('/')), stat = fs.lstatSync(filename);
    if (bytes > 8388608 || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== item.size
        || !fs.realpathSync.native(filename).startsWith(fs.realpathSync.native(folder) + path.sep)
        || createHash('sha256').update(fs.readFileSync(filename)).digest('hex') !== item.sha256) throw new Error('Compiled worker file verification failed.');
  }
  if (!seen.has('scripts/worker-main.cjs') || !seen.has('scripts/worker-workflows.cjs')) throw new Error('Compiled worker entry points are missing.');
  require('tsconfig-paths').register({ baseUrl: folder, paths: { '@/*': ['src/*'] } });
  return { compiled: true, main: path.join(folder, 'scripts', 'worker-main.cjs'), load(name) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || !seen.has(`src/lib/${name}.js`)) throw new Error('Worker module is not in this release.');
    return require(path.join(folder, 'src', 'lib', `${name}.js`));
  } };
}

function workerRuntime({ root = path.resolve(__dirname, '..'), source = false, directory } = {}) {
  if (directory !== undefined) return compiledRuntime(root, directory);
  if (!source && fs.existsSync(path.join(root, 'storage', 'active-build.json'))) {
    const { selectNextBuild } = require('./next-build-selection.cjs');
    const selected = selectNextBuild(require('next/constants').PHASE_PRODUCTION_SERVER, { root, env: process.env });
    const config = JSON.parse(fs.readFileSync(path.join(root, selected, 'required-server-files.json'), 'utf8'));
    if (config.config?.env?.PHOENIX_WORKER_RUNTIME === WORKER_RUNTIME) return compiledRuntime(root, selected);
    if (config.config?.env?.PHOENIX_WORKER_RUNTIME !== undefined) throw new Error('Unsupported worker release protocol; apply the matching verified update.');
    // shortcut: older verified releases have no compiled worker; preserve their
    // source loader until the first compiled release is activated.
  }
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
  require('tsconfig-paths').register({ baseUrl: root, paths: { '@/*': ['src/*'] } });
  return { compiled: false, main: path.join(root, 'scripts', 'worker-main.cjs'), load: name => require(path.join(root, 'src', 'lib', `${name}.ts`)) };
}
module.exports = { workerRuntime, compiledRuntime, WORKER_RUNTIME };
