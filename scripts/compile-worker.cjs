'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { WORKER_RUNTIME } = require('./worker-runtime.cjs');

async function compileWorker(root, directory) {
  if (!/^\.next-[a-z0-9-]+$/.test(directory)) throw new Error('Invalid worker build directory.');
  const build = path.join(root, directory);
  if (await fs.realpath(build) !== path.join(await fs.realpath(root), directory) || (await fs.lstat(build)).isSymbolicLink()) throw new Error('Worker compilation must stay in the fresh build.');
  const server = path.join(build, 'server');
  if ((await fs.lstat(server)).isSymbolicLink() || await fs.realpath(server) !== path.join(await fs.realpath(build), 'server')) throw new Error('Worker output cannot follow a redirected server directory.');
  try { if (JSON.parse(await fs.readFile(path.join(root, 'storage', 'active-build.json'), 'utf8')).directory === directory) throw new Error('Cannot compile over the active release.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const buildId = (await fs.readFile(path.join(build, 'BUILD_ID'), 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(buildId)) throw new Error('Worker needs a completed Next build.');
  const folder = path.join(build, 'server', 'phoenix-worker');
  await fs.mkdir(folder);
  await fs.mkdir(path.join(folder, 'src', 'lib'), { recursive: true }); await fs.mkdir(path.join(folder, 'scripts'));
  await fs.mkdir(path.join(folder, 'assets', 'music', 'lofi-cc0-v1'), { recursive: true });
  const ts = require('typescript'), files = []; let bytes = 0;
  async function save(relative, code) {
    bytes += Buffer.byteLength(code);
    if (bytes > 8388608 || Buffer.byteLength(code) > 1048576 || files.length >= 256) throw new Error('Compiled worker exceeds its size limit.');
    await fs.writeFile(path.join(folder, ...relative.split('/')), code, { flag: 'wx' });
    files.push({ path: relative, size: Buffer.byteLength(code), sha256: createHash('sha256').update(code).digest('hex') });
  }
  for (const item of (await fs.readdir(path.join(root, 'src', 'lib'), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (!item.isFile() || !/^[A-Za-z][A-Za-z0-9]*\.ts$/.test(item.name)) throw new Error(`Unsupported worker source entry: ${item.name}`);
    const filename = path.join(root, 'src', 'lib', item.name), stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || stat.size > 1048576) throw new Error('Worker source must be an ordinary bounded file.');
    const source = await fs.readFile(filename, 'utf8');
    const result = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
    if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(`Worker compilation failed: ${item.name}`);
    await save(`src/lib/${item.name.replace(/\.ts$/, '.js')}`, result.outputText);
  }
  for (const name of ['worker-main.cjs','worker-workflows.cjs']) await save(`scripts/${name}`, await fs.readFile(path.join(root, 'scripts', name), 'utf8'));
  await save('assets/music/lofi-cc0-v1/manifest.json', await fs.readFile(path.join(root, 'assets', 'music', 'lofi-cc0-v1', 'manifest.json'), 'utf8'));
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ version: WORKER_RUNTIME, buildId, files }, null, 2), { flag: 'wx' });
  return { files: files.length, bytes };
}
module.exports = { compileWorker };
