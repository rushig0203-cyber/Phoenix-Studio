const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/openStockCatalog.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const field = value => ({ value, source: 'commons-desc-page' });
const commons = (id = 42) => ({ pageid: id, ns: 6, index: id, title: 'File:Cliff sunrise.webm', videoinfo: [{
  duration: 32.407, width: 1920, height: 1080, mime: 'video/webm', size: 1200000,
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cliff_sunrise.webm?utm_source=commons.wikimedia.org',
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cliff_sunrise.webm',
  thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Cliff_sunrise.webm/400px--Cliff_sunrise.webm.jpg',
  extmetadata: { ObjectName: field('Cliff &amp; sunrise'), Artist: field('<a href="//commons.wikimedia.org/wiki/User:Contributor">Fixture contributor</a>'),
    License: field('cc-zero'), LicenseShortName: field('CC0 1.0'), LicenseUrl: field('https://creativecommons.org/publicdomain/zero/1.0/'), Copyrighted: field('False'), Restrictions: field('') },
}] });
const nasa = (id = 'KSC Original Footage') => ({ data: [{ nasa_id: id, media_type: 'video', center: 'KSC', title: 'Earth coast from orbit', photographer: 'NASA', description: 'Original video of the Earth coast.' }],
  links: [{ render: 'image', rel: 'preview', href: `https://images-assets.nasa.gov/video/${id}/${id}~thumb.jpg` }] });
const manifest = (id = 'KSC Original Footage') => ({ collection: { items: [
  { href: `http://images-assets.nasa.gov/video/${id}/${id}~orig.mp4` },
  { href: `http://images-assets.nasa.gov/video/${id}/${id}~mobile.mp4` },
  { href: `http://images-assets.nasa.gov/video/${id}/metadata.json` },
] } });
const metadata = (id = 'KSC Original Footage') => ({ 'AVAIL:NASAID': id, 'AVAIL:Center': 'KSC', 'AVAIL:MediaType': 'video',
  'QuickTime:ImageWidth': 1920, 'QuickTime:ImageHeight': 1080, 'QuickTime:Duration': '0:03:48', 'File:MIMEType': 'video/mp4',
  'XMP:Credit': 'NASA', 'AVAIL:Description': 'Original video of Earth.' });

function harness(handler) {
  const mod = { exports: {} }, calls = [];
  new vm.Script(output, { filename }).runInNewContext({ module: mod, exports: mod.exports, URL, URLSearchParams, Error, AbortSignal, TextDecoder, Uint8Array,
    async fetch(address, options) {
      const url = new URL(address); calls.push({ url, options });
      assert.equal(url.protocol, 'https:'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
      assert.match(options.headers['User-Agent'], /PhoenixStudio.*github\.com/); assert.equal(options.headers.Authorization, undefined);
      const result = await handler(url, calls.length);
      return result instanceof Response ? result : Response.json(result);
    }, require(name) { assert.fail('Open stock adapter has no runtime dependencies: ' + name); },
  }, { timeout: 1000 });
  return { catalog: mod.exports, calls };
}

function nasaHarness({ item = nasa(), asset = manifest(), details = metadata(), total = 7 } = {}) {
  return harness(url => {
    if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/search') return { collection: { items: [item], metadata: { total_hits: total } } };
    if (url.hostname === 'images-api.nasa.gov' && url.pathname.startsWith('/asset/')) return asset;
    if (url.hostname === 'images-assets.nasa.gov' && url.pathname.endsWith('/metadata.json')) return details;
    assert.fail('Unexpected URL: ' + url);
  });
}

test('Commons searches one bounded video-only page and keeps real metadata, credits and thumbnail hosts', async () => {
  const h = harness(() => ({ continue: { gsroffset: 24 }, query: { pages: { 42: commons() } } }));
  const result = await h.catalog.searchOpenStockPage('commons', 'mountain sunrise', 2, 24), v = result.videos[0];
  assert.equal(result.videos.length, 1); assert.equal(result.hasMore, true); assert.equal(h.calls.length, 1);
  const p = h.calls[0].url.searchParams; assert.equal(p.get('gsrsearch'), 'mountain sunrise filetype:video'); assert.equal(p.get('gsrnamespace'), '6'); assert.equal(p.get('gsroffset'), '24'); assert.equal(p.get('gsrlimit'), '24');
  assert.equal(v.id, 42); assert.equal(v.duration, 32.407); assert.equal(v.width, 1920); assert.equal(v.height, 1080); assert.equal(v.creator, 'Fixture contributor');
  assert.equal(v.title, 'Cliff & sunrise'); assert.equal(new URL(v.image).hostname, 'thumb.wikimedia.org');
  assert.equal(v.licence.name, 'CC0 1.0'); assert.equal(v.licence.requiresAttribution, false); assert.equal(v.licence.verifiedBy, 'provider-metadata');
  assert.match(v.licence.attribution, /Fixture contributor.*commons\.wikimedia/);
});

test('Commons resolves only an exact positive page ID and explicit public-domain proof', async () => {
  const file = commons(); file.videoinfo[0].extmetadata.License = field('pd'); file.videoinfo[0].extmetadata.LicenseShortName = field('Public domain');
  const h = harness(() => ({ query: { pages: { 42: file } } }));
  const v = await h.catalog.resolveOpenStock('commons', 42); assert.equal(v.licence.name, 'Public domain'); assert.equal(h.calls[0].url.searchParams.get('pageids'), '42');
  for (const id of [0, -1, '42', 1.5, Infinity]) await assert.rejects(h.catalog.resolveOpenStock('commons', id), /valid Commons/);
  file.pageid = 43; await assert.rejects(h.catalog.resolveOpenStock('commons', 42), /no longer/);
});

test('Commons excludes BY, BY-SA, uncertain public domain, restrictions and generated media rather than inventing permission', async () => {
  for (const mutate of [
    file => { file.videoinfo[0].extmetadata.License = field('cc-by-4.0'); file.videoinfo[0].extmetadata.LicenseShortName = field('CC BY 4.0'); },
    file => { file.videoinfo[0].extmetadata.License = field('cc-by-sa-4.0'); },
    file => { file.videoinfo[0].extmetadata.Copyrighted = field('True'); file.videoinfo[0].extmetadata.License = field('pd'); file.videoinfo[0].extmetadata.LicenseShortName = field('Public domain'); },
    file => { file.videoinfo[0].extmetadata.Restrictions = field('Personality rights'); },
    file => { file.videoinfo[0].extmetadata.Categories = field('Animated maps'); },
    file => { file.videoinfo[0].extmetadata.AttributionRequired = field('true'); },
  ]) {
    const bad = commons(43); mutate(bad); const h = harness(() => ({ query: { pages: { 42: commons(), 43: bad } } }));
    const result = await h.catalog.searchOpenStockPage('commons', 'forest', 1, 24); assert.equal(result.videos.length, 1); assert.equal(result.videos[0].id, 42);
  }
});

test('Commons rejects private/spoofed URLs, redirects, nonvideo and missing dimensions or durations', async () => {
  for (const mutate of [
    info => { info.url = 'https://upload.wikimedia.org.evil.test/video.webm'; },
    info => { info.thumburl = 'http://localhost/private.jpg'; },
    info => { info.descriptionurl = 'https://commons.wikimedia.org/wiki/User:Someone'; },
    info => { info.url = 'https://user:secret@upload.wikimedia.org/wikipedia/commons/x.webm'; },
    info => { info.url = 'https://upload.wikimedia.org:8443/wikipedia/commons/x.webm'; },
    info => { info.mime = 'image/jpeg'; }, info => { delete info.duration; }, info => { info.width = 0; },
  ]) {
    const bad = commons(); mutate(bad.videoinfo[0]); const h = harness(() => ({ query: { pages: { 42: bad } } }));
    assert.equal((await h.catalog.searchOpenStockPage('commons', 'forest', 1, 24)).videos.length, 0);
  }
});

test('NASA resolves opaque IDs with original dimensions/duration and requires NASA credit under actual guidelines', async () => {
  const h = nasaHarness(), v = await h.catalog.resolveOpenStock('nasa', 'KSC Original Footage');
  assert.equal(v.id, 'KSC Original Footage'); assert.equal(v.provider, 'nasa'); assert.equal(v.duration, 228); assert.equal(v.width, 1920); assert.equal(v.height, 1080);
  assert.equal(h.calls.length, 3); assert.equal(h.calls[0].url.searchParams.get('nasa_id'), v.id);
  assert.equal(v.previewUrl, 'https://images-assets.nasa.gov/video/KSC%20Original%20Footage/KSC%20Original%20Footage~orig.mp4');
  assert.equal(v.licence.requiresAttribution, true); assert.match(v.licence.attribution, /NASA.*No NASA endorsement/); assert.match(v.licence.url, /nasa-brand-center\/images-and-media/);
  assert.doesNotMatch(v.licence.name, /public domain/i);
});

test('NASA caps each search at six serial metadata resolutions and does not follow pagination links', async () => {
  let active = 0, maxActive = 0;
  const h = harness(async url => {
    active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--;
    if (url.pathname === '/search') return { collection: { items: Array.from({ length: 30 }, (_, i) => nasa(`KSC Video ${i}`)), metadata: { total_hits: 100 }, links: [{ rel: 'next', href: 'http://localhost/private' }] } };
    const id = url.hostname === 'images-api.nasa.gov' ? decodeURIComponent(url.pathname.split('/').at(-1)) : decodeURIComponent(url.pathname.split('/')[2]);
    return url.hostname === 'images-api.nasa.gov' ? manifest(id) : metadata(id);
  });
  const result = await h.catalog.searchOpenStockPage('nasa', 'earth', 2, 24);
  assert.equal(result.videos.length, 6); assert.equal(result.hasMore, true); assert.equal(h.calls.length, 13); assert.equal(maxActive, 1);
  assert.equal(h.calls[0].url.searchParams.get('page_size'), '6'); assert.equal(h.calls[0].url.searchParams.get('page'), '2');
});

test('NASA filters third-party/music/generated content, absent provenance and wrong-ID metadata', async () => {
  for (const mutate of [
    (item, details) => { details['XMP:Credit'] = 'NASA/ESA/SpaceX'; },
    item => { item.data[0].description = 'Music courtesy of an outside composer.'; },
    item => { item.data[0].description = 'Credit: NASA, Airbus, and SpaceX'; },
    item => { item.data[0].description = 'A computer generated animation of the planet.'; },
    (item, details) => { item.data[0].photographer = ''; delete details['XMP:Credit']; },
    (item, details) => { details['AVAIL:NASAID'] = 'different-video'; },
    (item, details) => { details['XMP:UsageTerms'] = 'All rights reserved'; },
    (item, details) => { details['XMP:Rights'] = ['Copyright an outside company']; },
    (item, details) => { details['XMP:Rights'] = { uncertain: true }; },
    (item, details) => { details['XMP:Creator'] = 'An outside production company'; },
    (item, details) => { details['XMP:Creator'] = { organization: 'Unknown company' }; },
    item => { item.data[0].description = 'x'.repeat(12001) + ' Credit: An outside company'; },
    (item, details) => { details['QuickTime:Duration'] = 'unknown'; },
    (item, details) => { details['QuickTime:ImageWidth'] = 0; },
  ]) {
    const item = nasa(), details = metadata(); mutate(item, details); const h = nasaHarness({ item, details });
    assert.equal((await h.catalog.searchOpenStockPage('nasa', 'earth', 1, 6)).videos.length, 0);
    await assert.rejects(h.catalog.resolveOpenStock('nasa', 'KSC Original Footage'));
  }
});

test('NASA guideline-only original rights notice is accepted without fabricating a named creator', async () => {
  const item = nasa(), details = metadata(); item.data[0].photographer = ''; delete details['XMP:Credit'];
  details['QuickTime:Copyright'] = 'For copyright and restrictions refer to\nhttp://www.nasa.gov/multimedia/guidelines/index.html';
  const v = await nasaHarness({ item, details }).catalog.resolveOpenStock('nasa', 'KSC Original Footage'); assert.equal(v.creator, 'NASA/KSC');
});

test('NASA does not borrow original metadata for a resized rendition or fetch foreign/cross-asset metadata', async () => {
  for (const asset of [
    { collection: { items: [{ href: 'https://images-assets.nasa.gov/video/KSC Original Footage/KSC Original Footage~mobile.mp4' }, { href: 'https://images-assets.nasa.gov/video/KSC Original Footage/metadata.json' }] } },
    { collection: { items: [{ href: 'https://private.test/metadata.json' }] } },
    { collection: { items: [{ href: 'https://images-assets.nasa.gov/video/another/metadata.json' }] } },
  ]) {
    const h = nasaHarness({ asset }); await assert.rejects(h.catalog.resolveOpenStock('nasa', 'KSC Original Footage')); assert.ok(h.calls.every(call => call.url.hostname !== 'private.test'));
  }
});

test('NASA verifies original MOV metadata too, without requiring an extra local probe', async () => {
  const asset = manifest(), details = metadata(); asset.collection.items[0].href = asset.collection.items[0].href.replace('.mp4', '.mov'); details['File:MIMEType'] = 'video/quicktime';
  const v = await nasaHarness({ asset, details }).catalog.resolveOpenStock('nasa', 'KSC Original Footage'); assert.ok(v.previewUrl.endsWith('~orig.mov')); assert.equal(v.duration, 228);
});

test('NASA original MP4 can carry provider M4V container metadata without inventing sizes', async () => {
  const details = metadata(); details['File:MIMEType'] = 'video/x-m4v';
  const v = await nasaHarness({ details }).catalog.resolveOpenStock('nasa', 'KSC Original Footage'); assert.ok(v.previewUrl.endsWith('~orig.mp4')); assert.equal(v.width, 1920);
});

test('NASA reports total metadata outage but retains independently resolved videos', async () => {
  for (const keepGood of [false, true]) {
    const h = harness(url => {
      if (url.pathname === '/search') return { collection: { items: keepGood ? [nasa(), nasa('unavailable')] : [nasa('unavailable')], metadata: { total_hits: 2 } } };
      if (url.pathname.includes('unavailable')) return new Response('', { status: 503 });
      return url.hostname === 'images-api.nasa.gov' ? manifest() : metadata();
    });
    if (keepGood) assert.equal((await h.catalog.searchOpenStockPage('nasa', 'earth', 1, 6)).videos.length, 1);
    else await assert.rejects(h.catalog.searchOpenStockPage('nasa', 'earth', 1, 6), /503/);
  }
});

test('invalid requests and responses stop safely before media downloads or excessive memory', async () => {
  const h = harness(() => ({ query: { pages: {} } }));
  for (const params of [['commons', '', 1, 24], ['commons', 'forest', 4, 24], ['commons', 'forest', 1, 25], ['nasa', 'x'.repeat(121), 1, 6], ['other', 'forest', 1, 24]]) await assert.rejects(h.catalog.searchOpenStockPage(...params));
  for (const id of ['', '../private', 'a/b', 'x?key=secret', 'x'.repeat(241), 42]) await assert.rejects(h.catalog.resolveOpenStock('nasa', id));
  assert.equal(h.calls.length, 0);
  const fail = harness(() => new Response('', { status: 429 })); await assert.rejects(fail.catalog.searchOpenStockPage('commons', 'forest', 1, 24), /429/);
  const huge = harness(() => new Response('x'.repeat(1024 * 1024 + 1))); await assert.rejects(huge.catalog.searchOpenStockPage('commons', 'forest', 1, 24), /safe response limit/);
  const invalid = harness(() => new Response('not JSON')); await assert.rejects(invalid.catalog.searchOpenStockPage('commons', 'forest', 1, 24), /invalid metadata/);
});
