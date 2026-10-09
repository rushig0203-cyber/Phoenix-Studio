const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/stockCatalog.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const fixture = id => ({ id, duration: 30, image: `https://images.pexels.com/videos/${id}/preview.jpg`,
  url: `https://www.pexels.com/video/forest-stream-${id}/`, user: { name: 'Fixture contributor' },
  video_files: [{ file_type: 'video/mp4', width: 720, height: 1280, link: `https://videos.pexels.com/video-files/${id}/720.mp4` }] });
function harness(result) {
  const mod = { exports: {} }, calls = [];
  new vm.Script(output, { filename }).runInNewContext({
    module: mod, exports: mod.exports, Error, URL, URLSearchParams,
    process: { env: { PEXELS_API_KEY: 'isolated-fixture-key' } },
    AbortSignal: { timeout(milliseconds) { assert.equal(milliseconds, 15_000); return new AbortController().signal; } },
    async fetch(address, options) {
      const url = new URL(address); assert.equal(url.origin, 'https://api.pexels.com');
      assert.equal(url.pathname, '/v1/videos/search'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'isolated-fixture-key'); calls.push(url);
      return { ok: true, async json() { return result; } };
    },
    require(name) { assert.fail('Catalog fixtures have no runtime dependencies: ' + name); },
  }, { timeout: 1000 });
  return { catalog: mod.exports, calls };
}

test('Pexels discovery forwards a bounded24-item metadata page and native orientation availability', async () => {
  const h = harness({ total_results: 75, videos: [fixture(1), fixture(2)] });
  const data = await h.catalog.searchFootagePage('forest & stream', '9:16', true, 2, 24);
  assert.equal(data.videos.length, 2); assert.equal(data.hasMore, true);
  const params = h.calls[0].searchParams;
  assert.equal(params.get('query'), 'forest & stream'); assert.equal(params.get('page'), '2');
  assert.equal(params.get('per_page'), '24'); assert.equal(params.get('orientation'), null);
  assert.doesNotMatch(JSON.stringify(data), /isolated-fixture-key/);
});

test('Pexels exhaustion uses catalog totals, not the number of metadata entries surviving validation', async () => {
  for (const [total_results, hasMore] of [[48, false], [49, true]]) {
    const h = harness({ total_results, videos: [{ ...fixture(1), duration: 0 }, fixture(2)] });
    const data = await h.catalog.searchFootagePage('forest', '9:16', true, 2, 24);
    assert.equal(data.videos.length, 1); assert.equal(data.hasMore, hasMore);
  }
});

test('Pexels documented next_page is metadata only and never an arbitrary fetch destination', async () => {
  const h = harness({ next_page: 'https://untrusted.example/do-not-follow', videos: [fixture(1)] });
  assert.equal((await h.catalog.searchFootagePage('forest', '9:16', true)).hasMore, true);
  assert.equal(h.calls.length, 1);
  assert.equal((await harness({ videos: [fixture(1)] }).catalog.searchFootagePage('forest', '9:16', true)).hasMore, false);
});

test('legacy planning search preserves its array contract and portrait preference; provider overdelivery stays bounded', async () => {
  const h = harness({ total_results: 500, videos: Array.from({ length: 100 }, (_, at) => fixture(at + 1)) });
  const result = await h.catalog.searchFootage('forest', '9:16', false, 999, 200);
  assert.ok(Array.isArray(result)); assert.equal(result.length, 40);
  assert.equal(h.calls[0].searchParams.get('page'), '3'); assert.equal(h.calls[0].searchParams.get('orientation'), 'portrait');
});

test('Pexels prefers the smallest native720p-or-better file instead of upscaling a closer SD rendition or downloading needless4K', () => {
  const h = harness({}), file = (edge, width = edge) => ({ file_type: 'video/mp4', width, height: edge, link: `https://videos.pexels.com/video-files/1/${edge}.mp4` });
  for (const [edges, expected] of [[[540, 1080, 2160], 1080], [[360, 1080], 1080], [[540, 2160, 720, 1080], 720], [[1080, 960, 2160], 960]]) {
    const selected = h.catalog.footageChoice({ ...fixture(1), video_files: edges.map(edge => file(edge, edge * 16 / 9)) });
    assert.equal(Math.min(selected.width, selected.height), expected); assert.ok(selected.previewUrl.endsWith(`/${expected}.mp4`));
  }
});

test('legacy Pexels search can still resolve the largest valid SD rendition when no native720 file exists', () => {
  const h = harness({}), files = [180, 540, 360].map(edge => ({ file_type: 'video/mp4', width: edge, height: edge * 16 / 9, link: `https://videos.pexels.com/video-files/1/${edge}.mp4` }));
  const selected = h.catalog.footageChoice({ ...fixture(1), video_files: files });
  assert.equal(selected.width, 540); assert.equal(selected.previewUrl, 'https://videos.pexels.com/video-files/1/540.mp4');
});

test('Pexels rejects nonfinite dimensions, missing media addresses and nonMP4 entries before rendition choice', () => {
  const h = harness({}), good = fixture(1).video_files[0];
  const invalid = [{ ...good, width: Infinity }, { ...good, height: NaN }, { ...good, width: 0 }, { ...good, height: -1 },
    { ...good, link: '' }, { ...good, file_type: 'video/webm' }];
  assert.equal(h.catalog.footageChoice({ ...fixture(1), video_files: [...invalid, good] }).width, 720);
  assert.throws(() => h.catalog.footageChoice({ ...fixture(1), video_files: invalid }), /missing playable video metadata/);
});
