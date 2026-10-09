const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, after } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });

// These fixtures never read a key or request either provider.
const originalFetch = global.fetch;
let providerCalls = 0;
global.fetch = async () => { providerCalls += 1; throw new Error('Provider calls are forbidden in these fixtures.'); };
const { portraitFirstStock, pixabayChoice } = require(path.join(project, 'src/lib/naturalStock.ts'));
after(() => { global.fetch = originalFetch; assert.equal(providerCalls, 0); });

const video = (id, title, portrait = true, provider = 'pexels') => ({
  id, title, provider, duration: 12, width: portrait ? 720 : 1920, height: portrait ? 1280 : 1080,
  previewUrl: 'https://videos.pexels.com/video-files/1/720.mp4', image: '',
  sourcePage: 'https://www.pexels.com/video/fixture-1/', creator: 'Fixture contributor',
});
const ids = results => results.map(result => result.id);

test('matching landscape ranks above unrelated portrait and does not mutate input', () => {
  const inputs = [video(1, 'City traffic at night'), video(2, 'Forest stream water', false), video(3, 'Forest stream in sunlight')];
  assert.deepEqual(ids(portraitFirstStock(inputs, 'forest stream')), [3, 2, 1]);
  assert.deepEqual(ids(inputs), [1, 2, 3]);
});

test('native portrait is preferred within the same catalog relevance class', () => {
  const inputs = [video(1, 'Beach waves at sunset', false), video(2, 'Beach waves at sunset')];
  assert.deepEqual(ids(portraitFirstStock(inputs, 'beach waves')), [2, 1]);
});

test('stronger word evidence outranks partial matches, then unknown and explicit nonmatches', () => {
  const inputs = [video(1, 'Pexels footage'), video(2, 'City skyline'), video(3, 'Mountain valley', false), video(4, 'Snowy mountains', false)];
  assert.deepEqual(ids(portraitFirstStock(inputs, 'snow mountain')), [4, 3, 1, 2]);
});

test('simple plurals and actions match without confusing forest with unrelated formatting', () => {
  assert.deepEqual(ids(portraitFirstStock([video(1, 'City buses'), video(2, 'Ocean wave beach', false)], 'beaches waves')), [2, 1]);
  assert.deepEqual(ids(portraitFirstStock([video(1, 'Running through a park', false), video(2, 'Park fountain')], 'run park')), [1, 2]);
  assert.deepEqual(ids(portraitFirstStock([video(1, 'Formatting documents'), video(2, 'Forest stream', false)], 'forest')), [2, 1]);
});

test('explicit catalog action mismatch cannot become a better match because of a shared noun', () => {
  const inputs = [video(1, 'Cutting wood logs'), video(2, 'Writing repair notes', false)];
  assert.deepEqual(ids(portraitFirstStock(inputs, 'log repair steps')), [2, 1]);
});

test('difficult or ambiguous searches retain every usable candidate rather than failing closed', () => {
  const inputs = [video(1, 'Pexels footage'), video(2, 'Quiet clouds', false)];
  assert.deepEqual(ids(portraitFirstStock(inputs, 'Oslo harbour at midnight')), [1, 2]);
  assert.equal(portraitFirstStock(inputs, 'contradictory unavailable rare subject').length, 2);
});

test('omitted, blank and generic queries retain legacy portrait order and deduplicate per provider', () => {
  const inputs = [video(1, 'Forest stream', false), video(2, 'City traffic'), video(2, 'City traffic'), video(2, 'Forest stream', false, 'pixabay')];
  for (const query of [undefined, '', '   ', 'vertical stock footage']) {
    assert.deepEqual(portraitFirstStock(inputs, query).map(result => `${result.provider}:${result.id}`), ['pexels:2', 'pexels:1', 'pixabay:2']);
  }
});

test('query-aware ranking safely drops invalid finite-metadata candidates', () => {
  const good = video(1, 'Forest stream');
  for (const field of ['width', 'height', 'duration']) {
    for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
      assert.deepEqual(ids(portraitFirstStock([{ ...good, id: 2, [field]: value }, good], 'forest stream')), [1]);
    }
  }
});

const pixabay = changes => ({
  id: 4, duration: 12, tags: 'forest, stream, water', pageURL: 'https://pixabay.com/videos/forest-stream-4/', user: 'Fixture',
  videos: { medium: { url: 'https://cdn.pixabay.com/video/4.mp4', width: 720, height: 1280 } }, ...changes,
});

test('Pixabay rejects nonfinite duration and rendition dimensions', () => {
  assert.equal(pixabayChoice(pixabay()).title, 'forest · stream · water');
  for (const duration of [NaN, Infinity, -Infinity, 0, -1]) assert.throws(() => pixabayChoice(pixabay({ duration })), /usable rendition/);
  for (const field of ['width', 'height']) {
    for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
      assert.throws(() => pixabayChoice(pixabay({ videos: { medium: { url: 'https://cdn.pixabay.com/video/4.mp4', width: 720, height: 1280, [field]: value } } })), /usable rendition/);
    }
  }
});

test('Pixabay can use a valid rendition when another rendition has invalid metadata', () => {
  const result = pixabayChoice(pixabay({ videos: {
    bad: { url: 'https://cdn.pixabay.com/video/bad.mp4', width: Infinity, height: 1280 },
    medium: { url: 'https://cdn.pixabay.com/video/4.mp4', width: 720, height: 1280 },
  } }));
  assert.equal(result.width, 720);
  assert.equal(result.previewUrl, 'https://cdn.pixabay.com/video/4.mp4');
});

test('Pixabay prefers the smallest native720-or-better file over closer SD and unnecessary4K', () => {
  for (const [edges, expected] of [[[540, 1080, 2160], 1080], [[360, 1080], 1080], [[540, 2160, 720, 1080], 720], [[1080, 960, 2160], 960]]) {
    const videos = Object.fromEntries(edges.map(edge => [String(edge), { width: edge * 16 / 9, height: edge, url: `https://cdn.pixabay.com/video/${edge}.mp4` }]));
    const chosen = pixabayChoice(pixabay({ videos }));
    assert.equal(Math.min(chosen.width, chosen.height), expected); assert.equal(chosen.previewUrl, `https://cdn.pixabay.com/video/${expected}.mp4`);
  }
});

test('Pixabay legacy/manual resolution retains the largest valid SD rendition if720native is unavailable', () => {
  const videos = Object.fromEntries([180, 540, 360].map(edge => [String(edge), { width: edge, height: edge * 16 / 9, url: `https://cdn.pixabay.com/video/${edge}.mp4` }]));
  const chosen = pixabayChoice(pixabay({ videos })); assert.equal(chosen.width, 540); assert.equal(chosen.previewUrl, 'https://cdn.pixabay.com/video/540.mp4');
});

test('Pixabay ignores missing media addresses instead of overlooking a sufficient valid rendition', () => {
  const chosen = pixabayChoice(pixabay({ videos: { invalid: { width: 720, height: 1280, url: '' },
    valid: { width: 1080, height: 1920, url: 'https://cdn.pixabay.com/video/1080.mp4' } } }));
  assert.equal(chosen.width, 1080);
});

test('Pixabay rejects explicitly marked animation while retaining film and missing-type compatibility', () => {
  assert.throws(() => pixabayChoice(pixabay({ type: 'animation' })), /marked as animation/);
  assert.equal(pixabayChoice(pixabay({ type: 'film' })).id, 4);
  assert.equal(pixabayChoice(pixabay()).id, 4);
});

function isolatedPixabay(fetchFixture) {
  const filename = path.join(project, 'src/lib/naturalStock.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const isolatedModule = { exports: {} }, deadlines = [];
  const dependencies = {
    './stockCatalog': {
      async searchFootage() { throw new Error('Pexels search is forbidden in this fixture.'); },
      async searchFootagePage() { throw new Error('Pexels discovery is forbidden in this fixture.'); },
      async selectedFootage() { throw new Error('Pexels resolution is forbidden in this fixture.'); },
    },
    './stockReel': require(path.join(project, 'src/lib/stockReel.ts')),
    './stockBrief': require(path.join(project, 'src/lib/stockBrief.ts')),
    './footageSemantics': require(path.join(project, 'src/lib/footageSemantics.ts')),
  };
  const context = vm.createContext({
    module: isolatedModule, exports: isolatedModule.exports, Error, URL, URLSearchParams,
    // This is a sandbox-only fake key, never the owner's process environment.
    process: { env: { PIXABAY_API_KEY: 'fixture-pixabay-free-key' } },
    AbortSignal: { timeout(milliseconds) { deadlines.push(milliseconds); return new AbortController().signal; } },
    fetch: fetchFixture,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Only pure stock helpers may be imported'); return dependencies[name]; },
  });
  new vm.Script(source, { filename }).runInContext(context, { timeout: 1000 });
  return { stock: isolatedModule.exports, deadlines };
}

test('Pixabay search requests film category and excludes mislabeled animation responses without provider access', async () => {
  const calls = [];
  const { stock, deadlines } = isolatedPixabay(async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://pixabay.com'); assert.equal(url.pathname, '/api/videos/');
    assert.equal(url.searchParams.get('q'), 'forest & stream');
    assert.equal(url.searchParams.get('video_type'), 'film');
    assert.equal(url.searchParams.get('safesearch'), 'true');
    assert.equal(url.searchParams.get('per_page'), '12'); assert.equal(url.searchParams.get('page'), '1');
    assert.equal(url.searchParams.get('key'), 'fixture-pixabay-free-key');
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    calls.push({ type: url.searchParams.get('video_type') });
    return { ok: true, async json() { return { hits: [pixabay({ type: 'film' }), pixabay({ id: 5, type: 'animation' }), pixabay({ id: 6 })] }; } };
  });
  const result = await stock.searchNaturalStock('pixabay', 'forest & stream');
  assert.deepEqual(Array.from(result, item => item.id), [4, 6]);
  assert.deepEqual(calls, [{ type: 'film' }]); assert.deepEqual(deadlines, [15_000]);
});

test('resolving a selected Pixabay ID independently rejects animation and retains missing-type footage', async () => {
  const calls = [];
  const { stock } = isolatedPixabay(async address => {
    const url = new URL(address), id = Number(url.searchParams.get('id'));
    assert.equal(url.origin, 'https://pixabay.com'); assert.equal(url.searchParams.get('q'), null);
    calls.push(id);
    return { ok: true, async json() { return { hits: [pixabay({ id, ...(id === 5 ? { type: 'animation' } : {}) })] }; } };
  });
  await assert.rejects(stock.resolveNaturalStock('pixabay', 5), /marked as animation/);
  assert.equal((await stock.resolveNaturalStock('pixabay', 6)).id, 6);
  assert.deepEqual(calls, [5, 6]);
});

test('Pixabay discovery requests one24-result filmed page and reports actual catalog continuation', async () => {
  const calls = [];
  const { stock } = isolatedPixabay(async address => {
    const url = new URL(address), page = Number(url.searchParams.get('page')); calls.push(page);
    assert.equal(url.searchParams.get('per_page'), '24'); assert.equal(url.searchParams.get('video_type'), 'film');
    assert.equal(url.searchParams.get('q'), 'forest'); assert.equal(url.searchParams.get('safesearch'), 'true');
    return { ok: true, async json() { return { totalHits: 57, hits: [pixabay({ id: page, type: 'film' }), pixabay({ id: 99, type: 'animation' })] }; } };
  });
  const second = await stock.searchNaturalStockPage('pixabay', 'forest', 2);
  assert.deepEqual(Array.from(second.videos, item => item.id), [2]); assert.equal(second.hasMore, true);
  const third = await stock.searchNaturalStockPage('pixabay', 'forest', 3); assert.equal(third.hasMore, false);
  assert.deepEqual(calls, [2, 3]);
});

test('Pixabay discovery rejects out-of-range pages before any provider access', async () => {
  const { stock } = isolatedPixabay(async () => { assert.fail('Invalid pages must not reach a provider'); });
  for (const page of [0, 4, -1, 1.1, Infinity, NaN]) await assert.rejects(stock.searchNaturalStockPage('pixabay', 'forest', page), /browsing limit/);
});
