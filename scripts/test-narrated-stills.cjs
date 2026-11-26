const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const project = path.resolve(__dirname, '..');
const ts = require(path.join(project, 'node_modules/typescript'));
const filename = path.join(project, 'src/lib/openStockCatalog.ts');
const source = fs.readFileSync(filename, 'utf8');
const output = ts.transpileModule(source, { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const field = value => ({ value });
function page(id = 42) {
  return { pageid: id, ns: 6, index: id, title: 'File:Krishna painting.jpg', imageinfo: [{ mime: 'image/jpeg', width: 6000, height: 4000, size: 20000000,
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Krishna_painting.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Krishna_painting.jpg',
    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Krishna_painting.jpg/960px-Krishna_painting.jpg',
    thumbmime: 'image/jpeg', thumbwidth: 960, thumbheight: 640,
    extmetadata: { ObjectName: field('Krishna &amp; Arjuna painting'), Artist: field('<b>Original artist</b>'), License: field('pd'), LicenseShortName: field('Public domain'), Copyrighted: field('False'), Restrictions: field('') },
  }] };
}
function harness(handler = () => ({ query: { pages: { 42: page() } } })) {
  const mod = { exports: {} }, calls = [];
  new vm.Script(output, { filename }).runInNewContext({ module: mod, exports: mod.exports, URL, URLSearchParams, Error, AbortSignal, TextDecoder, Uint8Array,
    async fetch(address, options) { calls.push({ url: new URL(address), options }); const value = await handler(calls.at(-1).url); return value instanceof Response ? value : Response.json(value); },
    require(name) { assert.fail('No runtime dependencies expected: ' + name); },
  }, { timeout: 1000 });
  return { catalog: mod.exports, calls };
}

test('one bounded anonymous Commons metadata call retains actual downscaled dimensions and readable artwork title', async () => {
  const h = harness(), result = await h.catalog.searchNarratedStills('Krishna Arjuna'), still = result[0];
  assert.equal(h.calls.length, 1); assert.equal(result.length, 1);
  assert.equal(still.width, 960); assert.equal(still.height, 640); assert.equal(still.title, 'Krishna & Arjuna painting');
  assert.equal(still.creator, 'Original artist'); assert.equal(still.licence, 'Public domain');
  assert.equal(h.calls[0].url.hostname, 'commons.wikimedia.org'); assert.equal(h.calls[0].url.searchParams.get('gsrsearch'), 'Krishna Arjuna filetype:bitmap');
  assert.equal(h.calls[0].url.searchParams.get('gsrlimit'), '8'); assert.equal(h.calls[0].url.searchParams.get('prop'), 'imageinfo');
  assert.equal(h.calls[0].options.redirect, 'error'); assert.equal(h.calls[0].options.cache, 'no-store'); assert.equal(h.calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(h.catalog.readNarratedStill(still))), JSON.parse(JSON.stringify(still)));
});

test('CC0 requires an exact waiver URL while BY, SA, NC, uncertain PD and noncopyright restrictions are excluded', async () => {
  const cc = page(); cc.imageinfo[0].extmetadata.License = field('cc-zero'); cc.imageinfo[0].extmetadata.LicenseShortName = field('CC0 1.0'); cc.imageinfo[0].extmetadata.LicenseUrl = field('https://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal((await harness(() => ({ query: { pages: { 42: cc } } })).catalog.searchNarratedStills('Krishna'))[0].licence, 'CC0 1.0');
  for (const mutate of [
    p => { p.imageinfo[0].extmetadata.License = field('cc-by-4.0'); },
    p => { p.imageinfo[0].extmetadata.License = field('cc-by-sa-4.0'); },
    p => { p.imageinfo[0].extmetadata.License = field('cc-by-nc-4.0'); },
    p => { delete p.imageinfo[0].extmetadata.Copyrighted; },
    p => { p.imageinfo[0].extmetadata.Copyrighted = field('True'); },
    p => { p.imageinfo[0].extmetadata.Restrictions = field('personality rights'); },
    p => { p.imageinfo[0].extmetadata.AttributionRequired = field('true'); },
    p => { p.imageinfo[0].extmetadata = cc.imageinfo[0].extmetadata; p.imageinfo[0].extmetadata.LicenseUrl = field('https://creativecommons.org/publicdomain/zero/1.0/?different=true'); },
  ]) { const p = page(); mutate(p); assert.equal((await harness(() => ({ query: { pages: { 42: p } } })).catalog.searchNarratedStills('Krishna')).length, 0); }
});

test('a second bounded search finds the real CC0 license format and drops provider tracking', async () => {
  const cc = page(73646009), file = 'Mallard_drake_preening_(158415201).jpg';
  cc.title = 'File:' + file;
  Object.assign(cc.imageinfo[0], {
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:' + file,
    thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0e/' + file + '/960px-' + file + '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail',
    thumbheight: 643, extmetadata: { Artist: field('Gisle Vanem'), License: field('cc0'), LicenseShortName: field('CC0'),
      LicenseUrl: field('http://creativecommons.org/publicdomain/zero/1.0/deed.en'), AttributionRequired: field('false') },
  });
  const ordinary = page();
  ordinary.imageinfo[0].extmetadata.License = field('cc-by-sa-4.0');
  const h = harness(address => ({ query: { pages: { item: address.searchParams.get('gsrsearch').includes('CC-Zero') ? cc : ordinary } } }));
  const [still] = await h.catalog.searchNarratedStills('duck preening');
  assert.equal(h.calls.length, 2);
  assert.equal(still.id, 73646009);
  assert.equal(still.licence, 'CC0 1.0');
  assert.equal(new URL(still.url).hostname, 'upload.wikimedia.org');
  assert.equal(new URL(still.url).search, '');
});

test('only bounded JPEG files and actual supported thumbnails qualify; no SVG/PNG/GIF or original fallback', async () => {
  for (const mutate of [
    p => { p.imageinfo[0].mime = 'image/svg+xml'; }, p => { p.imageinfo[0].mime = 'image/gif'; }, p => { p.imageinfo[0].mime = 'image/png'; },
    p => { p.imageinfo[0].thumbmime = 'text/html'; }, p => { p.imageinfo[0].thumbwidth = 4000; },
    p => { delete p.imageinfo[0].thumbwidth; }, p => { delete p.imageinfo[0].thumburl; },
    p => { p.imageinfo[0].thumbheight = 12; }, p => { p.imageinfo[0].thumburl = 'https://evil.test/picture.jpg'; },
    p => { p.imageinfo[0].descriptionurl = 'https://commons.wikimedia.org/wiki/User:Example'; },
  ]) { const p = page(); mutate(p); assert.equal((await harness(() => ({ query: { pages: { 42: p } } })).catalog.searchNarratedStills('Krishna')).length, 0); }
  const small = page(); Object.assign(small.imageinfo[0], { width: 960, height: 640, size: 200000 }); delete small.imageinfo[0].thumburl;
  assert.equal((await harness(() => ({ query: { pages: { 42: small } } })).catalog.searchNarratedStills('Krishna')).length, 0);
});

test('saved still validation rejects extra fields, dimensions, mismatched filenames and unsafe URL variants', async () => {
  const h = harness(), still = (await h.catalog.searchNarratedStills('Krishna'))[0];
  for (const change of [
    { prompt: 'new instructions' }, { id: '42' }, { id: 0 }, { width: 960.5 }, { title: '<b>Krishna</b>' }, { creator: 'x'.repeat(161) }, { licence: 'CC BY 4.0' },
    { url: 'http://upload.wikimedia.org/wikipedia/commons/a/ab/Krishna_painting.jpg' },
    { url: 'https://upload.wikimedia.org.evil.test/wikipedia/commons/a/ab/Krishna_painting.jpg' },
    { url: 'https://upload.wikimedia.org:8443/wikipedia/commons/a/ab/Krishna_painting.jpg' },
    { url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Different.jpg' },
    { url: still.url.replace('upload.wikimedia.org', 'thumb.wikimedia.org') },
    { sourcePage: 'https://commons.wikimedia.org/wiki/File:Krishna_painting.svg' },
    { sourcePage: still.sourcePage + '?download=1' }, { url: still.url + '#fragment' }, { url: still.url + '?key=secret' },
  ]) assert.equal(h.catalog.readNarratedStill({ ...still, ...change }), undefined, JSON.stringify(change));
});

test('invalid queries do not fetch, candidate counts remain bounded and provider/network failures stay explicit', async () => {
  const h = harness(); for (const query of ['', ' ', 'x'.repeat(121), 'Krishna\u0000', 'Krishna|other', 42]) await assert.rejects(h.catalog.searchNarratedStills(query)); assert.equal(h.calls.length, 0);
  const many = harness(() => ({ query: { pages: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, page(i + 1)])) } }));
  assert.equal((await many.catalog.searchNarratedStills('Krishna')).length, 8);
  for (const status of [403, 429, 503]) await assert.rejects(harness(() => new Response('', { status })).catalog.searchNarratedStills('Krishna'), new RegExp(String(status)));
  await assert.rejects(harness(() => { throw new Error('offline'); }).catalog.searchNarratedStills('Krishna'), /could not be reached/);
  await assert.rejects(harness(() => new Response('x'.repeat(1024 * 1024 + 1))).catalog.searchNarratedStills('Krishna'), /safe response limit/);
});
