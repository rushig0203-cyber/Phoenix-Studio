const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve('unused-storage-fixture');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/reviewStorage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const entry = (name, kind = 'file') => ({ name, isFile: () => kind === 'file', isDirectory: () => kind === 'dir', isSymbolicLink: () => kind === 'link' });
function harness() {
  const dirs = new Map(), sizes = new Map(), errors = new Map(), reads = [];
  let clock = 1_000_000;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const fake = {
    async readdir(directory) { reads.push(directory); if (errors.has(directory)) throw errors.get(directory); return dirs.get(directory) || []; },
    async lstat(filename) { if (errors.has(filename)) throw errors.get(filename); const value = sizes.get(filename); if (value === undefined) throw Object.assign(new Error('gone'), { code: 'ENOENT' }); return { size: value, isFile: () => true, isSymbolicLink: () => false }; },
  };
  const module = { exports: {} };
  new vm.Script(code).runInNewContext({ module, exports: module.exports, Date: Clock, require: name => {
    if (name === 'node:fs/promises') return fake;
    if (name === 'node:path') return path;
    throw new Error(`Unexpected storage import ${name}`);
  } });
  return { api: module.exports, dirs, sizes, errors, reads, tick(ms) { clock += ms; } };
}

test('category totals read sizes only and distinguish originals, finished and retry files', async () => {
  const h = harness();
  h.dirs.set(root, [entry('sources', 'dir'), entry('outputs', 'dir'), entry('work', 'dir'), entry('index.json')]);
  for (const [category, bytes] of [['sources', 400], ['outputs', 200], ['work', 100]]) {
    h.dirs.set(path.join(root, category), [entry('fixture.mp4')]); h.sizes.set(path.join(root, category, 'fixture.mp4'), bytes);
  }
  h.sizes.set(path.join(root, 'index.json'), 20);
  const result = await h.api.reviewStorageUsage(root);
  assert.equal(result.bytes, 720); assert.equal(result.objects, 4); assert.equal(result.partial, false);
  assert.equal(result.kind, 'local'); assert.equal(result.limitBytes, null);
  assert.equal(result.categories.find(c => c.key === 'metadata').bytes, 20);
  assert.equal(result.categories.find(c => c.key === 'work').bytes, 100);
  assert.ok(result.categories.every(c => !Object.hasOwn(c, 'path')));
});

test('concurrent callers share one scan and a minute cache avoids disk traversal on reopen', async () => {
  const h = harness(); h.dirs.set(root, [entry('index.json')]); h.sizes.set(path.join(root, 'index.json'), 10);
  const [one, two] = await Promise.all([h.api.reviewStorageUsage(root), h.api.reviewStorageUsage(root)]);
  assert.equal(one, two); assert.equal(h.reads.length, 1);
  assert.equal(await h.api.reviewStorageUsage(root), one); assert.equal(h.reads.length, 1);
  h.tick(60_001); h.sizes.set(path.join(root, 'index.json'), 20);
  assert.equal((await h.api.reviewStorageUsage(root)).bytes, 20); assert.equal(h.reads.length, 2);
});

test('symbolic links are excluded rather than following outside files or cycles', async () => {
  const h = harness(); h.dirs.set(root, [entry('outside', 'link'), entry('loop', 'link')]);
  const result = await h.api.reviewStorageUsage(root);
  assert.equal(result.skippedLinks, 2); assert.equal(result.objects, 0); assert.equal(h.reads.length, 1);
});

test('unreadable directories are reported as partial, not silently shown as complete', async () => {
  const h = harness(); h.dirs.set(root, [entry('work', 'dir')]); h.errors.set(path.join(root, 'work'), Object.assign(new Error('blocked'), { code: 'EACCES' }));
  assert.equal((await h.api.reviewStorageUsage(root)).partial, true);
});

test('a file removed during the scan does not fail or require touching owner data', async () => {
  const h = harness(); h.dirs.set(root, [entry('gone.mp4'), entry('index.json')]); h.sizes.set(path.join(root, 'index.json'), 7);
  const result = await h.api.reviewStorageUsage(root); assert.equal(result.partial, false); assert.equal(result.bytes, 7);
});

test('deep metadata trees are bounded and reported as partial', async () => {
  const h = harness(); let directory = root;
  for (let i = 0; i < 36; i++) { h.dirs.set(directory, [entry('nested', 'dir')]); directory = path.join(directory, 'nested'); }
  assert.equal((await h.api.reviewStorageUsage(root)).partial, true); assert.equal(h.reads.length, 33);
});

test('storage panel is collapsed, loads on demand and explains Trash without deleting', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../src/components/ReviewStorageSummary.tsx'), 'utf8');
  assert.match(ui, /onToggle=.*currentTarget\.open.*load/);
  assert.doesNotMatch(ui, /useEffect|method:\s*["']DELETE/);
  assert.match(ui, /not RAM/); assert.match(ui, /does not free disk space/); assert.match(ui, /Nothing is deleted automatically/);
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/storage/usage/route.ts'), 'utf8');
  assert.match(route, /assertLocalRequest\(request\)/); assert.match(route, /Cache-Control.*no-store/);
});

function panelHarness() {
  const jsx = require('react/jsx-runtime');
  const panelCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/ReviewStorageSummary.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let position = 0, dirty = true, tree, clock = Date.parse('2026-10-08T10:00:00Z'), mode = 'ok', bytes = 100;
  const slots = [], requests = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const react = {
    useState(initial) { const index = position++; if (!(index in slots)) slots[index] = { value: initial }; return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true; }]; },
    useRef(initial) { const index = position++; return slots[index] ||= { current: initial }; },
  };
  const module = { exports: {} };
  new vm.Script(panelCode).runInNewContext({ module, exports: module.exports, Date: Clock, AbortSignal, require: name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return jsx;
    throw new Error(`Server imports must not enter storage UI: ${name}`);
  }, fetch: async (url, options) => {
    requests.push({ url, ...options });
    if (mode === 'fail') throw new Error('Fixture offline');
    return Response.json({ bytes, objects: 1, measuredAt: new Date(clock).toISOString(), categories: [{ key: 'outputs', label: 'Finished videos', bytes, objects: 1 }] });
  } });
  const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
  function nodes(node, predicate, found = []) {
    if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, found));
    else if (node && typeof node === 'object') { if (predicate(node)) found.push(node); nodes(node.props?.children, predicate, found); }
    return found;
  }
  const h = {
    render() { position = 0; dirty = false; tree = module.exports.default(); },
    async flush() { for (let i = 0; i < 25; i++) { if (dirty) h.render(); await Promise.resolve(); } },
    async toggle(open) { tree.props.onToggle({ currentTarget: { open } }); await h.flush(); },
    tick(ms) { clock += ms; }, setBytes(value) { bytes = value; }, setMode(value) { mode = value; },
    requests, get time() { return nodes(tree, node => node.type === 'time')[0]?.props.dateTime; }, get text() { return text(tree); }, get tree() { return tree; },
  };
  h.render(); return h;
}

test('storage totals show measurement time and refresh only on reopening an estimate older than one minute', async () => {
  const h = panelHarness();
  assert.equal(h.requests.length, 0); assert.equal(h.tree.props.open, undefined);
  await h.toggle(true); assert.equal(h.requests.length, 1); assert.match(h.text, /Measured/);
  const firstTime = h.time;
  await h.toggle(false); h.tick(59_999); await h.toggle(true);
  assert.equal(h.requests.length, 1, 'A fresh saved estimate avoids another disk scan');
  h.tick(2); h.setBytes(200); h.render(); await h.flush();
  assert.equal(h.requests.length, 1, 'Time passing or parent rendering does not start polling');
  await h.toggle(false); await h.toggle(true);
  assert.equal(h.requests.length, 2); assert.notEqual(h.time, firstTime);
  assert.ok(h.requests.every(request => !request.method && request.url === '/api/storage/usage'));
});

test('an unsuccessful storage refresh retains the old dated estimate and can retry on the next reopen', async () => {
  const h = panelHarness(); await h.toggle(true);
  const firstTime = h.time; h.tick(60_001); h.setMode('fail');
  await h.toggle(false); await h.toggle(true);
  assert.equal(h.requests.length, 2); assert.equal(h.time, firstTime);
  assert.match(h.text, /Storage information is unavailable/);
  h.setMode('ok'); await h.toggle(false); await h.toggle(true);
  assert.equal(h.requests.length, 3); assert.notEqual(h.time, firstTime);
  assert.doesNotMatch(h.text, /Storage information is unavailable/);
});
