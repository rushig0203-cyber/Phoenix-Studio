const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('sharp');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { kidsAnimationSvg, planKidsAnimationScene } = require('../src/lib/kidsAnimation');
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 16 });

test('all seven character designs rasterize in both publishing formats', async () => {
  for (const kind of ['bunny', 'bird', 'bear', 'fox', 'dog', 'cat', 'fish']) {
    for (const aspect of ['16:9', '9:16']) {
      const svg = kidsAnimationSvg({ topic: kind === 'fish' ? 'Ocean friends' : 'Garden friends', caption: 'Wave hello to a friend.', index: 0, frame: 7, cast: [kind, kind], aspect });
      assert.doesNotMatch(svg, /NaN|undefined|<image|https?:\/\/(?!www\.w3\.org)/);
      const result = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
      assert.equal(result.info.width, aspect === '9:16' ? 540 : 960);
      assert.equal(result.info.height, aspect === '9:16' ? 960 : 540);
      assert.ok(result.data.length > 15000);
    }
  }
});
test('motion changes actual pixels, and reaction scenes retain their object', async () => {
  const options = { topic: 'Bunny and Bear rescue their kite', caption: 'The kite is tangled, and Bunny looks worried.', index: 2, cast: ['bunny', 'bear'], aspect: '16:9' };
  assert.equal(planKidsAnimationScene(options.topic, options.caption).emotion, 'worried');
  assert.equal(planKidsAnimationScene(options.topic, 'They wonder how to help.').prop, 'kite');
  assert.equal(planKidsAnimationScene(options.topic, 'Bunny flies the kite.').action, 'reach');
  const a = await sharp(Buffer.from(kidsAnimationSvg({ ...options, frame: 0 }))).raw().toBuffer();
  const b = await sharp(Buffer.from(kidsAnimationSvg({ ...options, frame: 13 }))).raw().toBuffer();
  assert.notDeepEqual(a, b);
});
test('all four settings contain usable original vector detail', async () => {
  for (const topic of ['Garden friends', 'Bedtime stars', 'Ocean friends', 'Tidy the playroom']) {
    const svg = kidsAnimationSvg({ topic, caption: 'Hello, friend!', index: 0, frame: 0, cast: ['bunny', 'bird'], aspect: '16:9' });
    await sharp(Buffer.from(svg)).png().toBuffer();
    assert.ok((svg.match(/<path/g) || []).length > 35);
  }
});

// Execute the real component's click handler with browser/state stubs. This
// covers double clicks without React/browser processes or touching user files.
function deleteHarness(confirmed = true, response) {
  const source = ts.createSourceFile('ReviewLibrary.tsx', fs.readFileSync(path.join(__dirname, '../src/components/ReviewLibrary.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'move') handler = node; ts.forEachChild(node, visit); }
  visit(source);
  assert.ok(handler);
  const calls = { confirmations: 0, requests: 0 };
  const noop = () => {};
  const sandbox = { inFlight: { current: false }, setBusy: noop, setError: noop, setLocallyTrashed: noop, setTrash: noop, setUndoId: noop, setPreviewId: noop, setNotice: noop, onRefresh: async () => {}, window: { confirm: () => { calls.confirmations++; return confirmed; } }, fetch: async () => { calls.requests++; return response ? await response : { ok: true, json: async () => ({}) }; } };
  const compiled = ts.transpileModule(`(${handler.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { move: vm.runInNewContext(compiled, sandbox), calls };
}
test('delete asks exactly once and ignores a second click while saving', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { move, calls } = deleteHarness(true, waiting);
  const first = move({ id: 'test', title: 'Test video' });
  await move({ id: 'test', title: 'Test video' });
  assert.equal(calls.confirmations, 1);
  assert.equal(calls.requests, 1);
  release({ ok: true, json: async () => ({}) });
  await first;
});
test('cancelling the one confirmation sends no delete request', async () => {
  const { move, calls } = deleteHarness(false);
  await move({ id: 'test', title: 'Test video' });
  assert.deepEqual(calls, { confirmations: 1, requests: 0 });
});
test('restoring does not ask for another deletion confirmation', async () => {
  const { move, calls } = deleteHarness();
  await move({ id: 'test', title: 'Test video' }, true);
  assert.deepEqual(calls, { confirmations: 0, requests: 1 });
});
