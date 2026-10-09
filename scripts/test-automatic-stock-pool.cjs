const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
function compile(relative, dependencies, globals = {}) {
  const filename = path.join(project, relative), mod = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new vm.Script(output, { filename }).runInNewContext({ module: mod, exports: mod.exports, Error, URL, URLSearchParams,
    ...globals, require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; },
  }, { timeout: 1000 });
  return mod.exports;
}
const reel = compile('src/lib/stockReel.ts', {});
const semantics = compile('src/lib/footageSemantics.ts', {});
const brief = compile('src/lib/stockBrief.ts', {});
const automatic = compile('src/lib/automaticStockReel.ts', { './stockReel': reel, './footageSemantics': semantics });
const video = (id, subject = 'horse grazing in meadow', changes = {}) => ({ id, duration: 20, width: 720, height: 1280,
  previewUrl: `https://videos.pexels.com/video-files/${id}/720.mp4`, image: '', creator: 'Fixture only',
  sourcePage: `https://www.pexels.com/video/${subject.replace(/ /g, '-')}-${id}/`, ...changes });
function harness(pages) {
  const calls = [];
  const stock = compile('src/lib/naturalStock.ts', {
    './stockReel': reel, './stockBrief': brief, './footageSemantics': semantics,
    './stockCatalog': {
      async searchFootagePage(query, aspect, anyOrientation, page, size) {
        calls.push({ query, aspect, anyOrientation, page, size });
        const result = pages[page - 1];
        if (result instanceof Error) throw result;
        return result || { videos: [], hasMore: false };
      },
      searchFootage() { assert.fail('Automatic discovery must not use the narrow legacy search'); },
      selectedFootage() { assert.fail('Pool search must not resolve or download media'); },
    },
  }, { process: { env: {} }, fetch() { assert.fail('Fixtures must not call a provider'); } });
  return { stock, calls };
}

test('automatic discovery proceeds past a full page with too few coherent native720 sources', async () => {
  const anchor = { ...video(1), provider: 'pexels', title: 'horse grazing in meadow' };
  const first = Array.from({ length: 12 }, (_, at) => video(at + 2, at < 8 ? 'dog in meadow' : 'horse grazing in meadow', { width: at < 8 ? 720 : 540 }));
  const next = Array.from({ length: 10 }, (_, at) => video(at + 20));
  const h = harness([{ videos: first, hasMore: true }, { videos: next, hasMore: true }]);
  const enough = pool => automatic.automaticStockCompanions(anchor, pool, 'Nature').length >= 9;
  const pool = await h.stock.searchNaturalStockPool('pexels', 'horse meadow', enough);
  assert.deepEqual(h.calls.map(call => call.page), [1, 1, 2]);
  assert.equal(h.calls[0].anyOrientation, false);
  assert.ok(h.calls.slice(1).every(call => call.anyOrientation && call.size === 24 && call.query === 'horse meadow'));
  assert.equal(automatic.automaticStockCompanions(anchor, pool, 'Nature').length, 10);
  assert.ok(pool.every(item => !Object.hasOwn(item, 'key')));
});

test('usable coherent count can stop early without fetching every discovery page', async () => {
  const h = harness([{ videos: Array.from({ length: 10 }, (_, at) => video(at + 1)), hasMore: true }]);
  const pool = await h.stock.searchNaturalStockPool('pexels', 'horse meadow', items => items.length >= 9);
  assert.equal(pool.length, 10); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].anyOrientation, false);
});

test('automatic discovery remains bounded to one portrait lookup plus three metadata pages and deduplicates sources', async () => {
  const first = Array.from({ length: 24 }, (_, at) => video(at + 1));
  const h = harness(Array.from({ length: 5 }, () => ({ videos: first, hasMore: true })));
  const pool = await h.stock.searchNaturalStockPool('pexels', 'horse meadow', () => false);
  assert.deepEqual(h.calls.map(call => call.page), [1, 1, 2, 3]); assert.equal(pool.length, 24);
});

test('catalogue exhaustion stops even when valid source count is sparse', async () => {
  const h = harness([{ videos: [video(1)], hasMore: false }]);
  assert.equal((await h.stock.searchNaturalStockPool('pexels', 'horse meadow', () => false)).length, 1);
  assert.equal(h.calls.length, 2);
});

test('later free-provider failure retains successful metadata without retry; first-page failure is explicit', async () => {
  const h = harness([{ videos: [video(1)], hasMore: true }, new Error('Free catalogue quota reached')]);
  assert.equal((await h.stock.searchNaturalStockPool('pexels', 'horse meadow', () => false)).length, 1);
  assert.deepEqual(h.calls.map(call => call.page), [1, 1, 2]);
  const failed = harness([new Error('Free catalogue quota reached')]);
  await assert.rejects(failed.stock.searchNaturalStockPool('pexels', 'horse meadow', () => false), /quota/);
  assert.equal(failed.calls.length, 1);
});
