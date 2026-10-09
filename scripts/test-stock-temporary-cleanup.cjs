const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const project = path.resolve(__dirname, '..');
const filename = path.join(project, 'src/lib/stockTemporaryCleanup.ts');
const output = ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function loadCleanup(fileSystem = fs) {
  const isolatedModule = { exports: {} };
  const context = vm.createContext({ module: isolatedModule, exports: isolatedModule.exports, process,
    require(name) {
      if (name === 'node:fs/promises') return fileSystem;
      if (name === 'node:path') return path;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  new vm.Script(output, { filename }).runInContext(context, { timeout: 1000 });
  return isolatedModule.exports.cleanupStockTemporaries;
}

const jobId = '22222222-2222-4222-8222-222222222222';

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'phoenix-stock-cleanup-'));
  const root = path.join(parent, 'work');
  await fs.mkdir(root);
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return { parent, root, jobDirectory: path.join(root, `source-${jobId}`) };
}

test('removes only enumerated per-shot temporaries and reports bytes in deterministic order', async t => {
  const { root, jobDirectory } = await fixture(t);
  const assembly = path.join(jobDirectory, 'stock-assembly-v1');
  const secondAssembly = path.join(jobDirectory, 'stock-assembly-v2');
  await fs.mkdir(assembly, { recursive: true });
  await fs.mkdir(secondAssembly);
  const contents = new Map([
    ['shot-1.mp4', 'one'], ['speech-1.wav', 'two!'], ['shot-12.mp4', 'three'],
    ['speech-12.wav', 'four!'], ['shots.txt', 'five'],
  ]);
  for (const [name, value] of contents) await fs.writeFile(path.join(assembly, name), value);
  await fs.writeFile(path.join(secondAssembly, 'shot-2.mp4'), 'six');

  const keep = ['editable-master.mp4', 'original-assembly.mp4', 'instrumental.wav', 'motion-cache.json', 'failure-history.json', 'shot-13.mp4', 'speech-13.wav'];
  for (const name of keep) await fs.writeFile(path.join(assembly, name), 'keep');
  await fs.mkdir(path.join(assembly, 'shot-3.mp4'));
  await fs.writeFile(path.join(assembly, 'shot-3.mp4', 'inside'), 'protected');
  await fs.mkdir(path.join(root, `clip-${jobId}`));
  await fs.writeFile(path.join(root, `clip-${jobId}`, 'shot-4.mp4'), 'protected');

  const unlinkOrder = [];
  const observedFs = { ...fs, async unlink(target) { unlinkOrder.push(path.basename(target)); return fs.unlink(target); } };
  const cleanup = loadCleanup(observedFs);
  const result = await cleanup(jobId, root);
  const expected = [...contents.values(), 'six'].reduce((total, value) => total + Buffer.byteLength(value), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { removedFiles: 6, removedBytes: expected, skippedFiles: 1 });
  assert.deepEqual(unlinkOrder, ['shots.txt', 'shot-1.mp4', 'speech-1.wav', 'shot-12.mp4', 'speech-12.wav', 'shot-2.mp4']);
  for (const name of [...contents.keys(), 'shot-2.mp4']) assert.equal(await fs.stat(path.join(name === 'shot-2.mp4' ? secondAssembly : assembly, name)).catch(() => null), null);
  for (const name of keep) assert.equal(await fs.readFile(path.join(assembly, name), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(assembly, 'shot-3.mp4', 'inside'), 'utf8'), 'protected');
  assert.equal(await fs.readFile(path.join(root, `clip-${jobId}`, 'shot-4.mp4'), 'utf8'), 'protected');
});

test('rejects invalid IDs and treats missing work as an empty cleanup', async t => {
  const cleanup = loadCleanup();
  const { root } = await fixture(t);
  await assert.rejects(cleanup('../outside', root), /canonical stock job UUID/);
  assert.deepEqual(JSON.parse(JSON.stringify(await cleanup(jobId, root))), { removedFiles: 0, removedBytes: 0, skippedFiles: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(await cleanup(jobId, path.join(root, 'not-work')))), { removedFiles: 0, removedBytes: 0, skippedFiles: 0 });
});

test('retains multiply-linked scratch files so another saved file is never unlinked', async t => {
  const { root, jobDirectory, parent } = await fixture(t);
  const assembly = path.join(jobDirectory, 'stock-assembly-v2');
  await fs.mkdir(assembly, { recursive: true });
  const original = path.join(parent, 'original.mp4');
  await fs.writeFile(original, 'protected original');
  await fs.link(original, path.join(assembly, 'shot-1.mp4'));
  const result = await loadCleanup()(jobId, root);
  assert.equal(result.removedFiles, 0);
  assert.equal(result.skippedFiles, 1);
  assert.equal(await fs.readFile(path.join(assembly, 'shot-1.mp4'), 'utf8'), 'protected original');
  assert.equal(await fs.readFile(original, 'utf8'), 'protected original');
});

test('skips linked files and assembly-directory links without following them', async t => {
  const { root, jobDirectory, parent } = await fixture(t);
  const assembly = path.join(jobDirectory, 'stock-assembly-v1');
  await fs.mkdir(assembly, { recursive: true });
  const outside = path.join(parent, 'outside.mp4');
  await fs.writeFile(outside, 'must survive');
  let symlinksAvailable = true;
  try {
    await fs.symlink(outside, path.join(assembly, 'shot-1.mp4'), 'file');
    await fs.symlink(parent, path.join(jobDirectory, 'stock-assembly-v2'), 'junction');
  } catch (error) {
    symlinksAvailable = false;
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error.code)) throw error;
  }
  if (!symlinksAvailable) return t.skip('This Windows account does not permit creating the symlink fixture.');
  const result = await loadCleanup()(jobId, root);
  assert.equal(result.removedFiles, 0);
  assert.ok(result.skippedFiles >= 1);
  assert.equal(await fs.readFile(outside, 'utf8'), 'must survive');
  assert.equal((await fs.lstat(path.join(assembly, 'shot-1.mp4'))).isSymbolicLink(), true);
});
