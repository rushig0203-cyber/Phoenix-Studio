const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Pure metadata and mocked route fixtures only. No owner storage, credentials,
// real provider traffic, video uploads, rendering or local models.
const project = path.resolve(__dirname, '..');
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(project, relative), mod = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new vm.Script(output, { filename }).runInNewContext({ module: mod, exports: mod.exports,
    URL, URLSearchParams, Request, Response, AbortSignal, Error, Buffer, TextEncoder, ...globals,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; },
  }, { timeout: 1000 });
  return mod.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const manualId = 'a'.repeat(64);
const providers = load('src/lib/stockProviders.ts');
const reuse = load('src/lib/stockReuse.ts', { './stockProviders': providers });
const reel = load('src/lib/stockReel.ts');
const semantics = load('src/lib/footageSemantics.ts');
const automatic = load('src/lib/automaticStockReel.ts', { './stockProviders': providers, './stockReel': reel, './footageSemantics': semantics });
const candidates = load('src/lib/stockFootageCandidates.ts', { './stockProviders': providers });
const posting = load('src/lib/posting.ts', { './stockProviders': providers, './postingCopyPolicy': load('src/lib/postingCopyPolicy.ts') });
const cc = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Mountain footage by Fixture Creator — https://commons.wikimedia.org/wiki/File:Mountain.webm — CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ — edited, cropped and assembled.',
  requiresAttribution: true, verifiedBy: 'provider-metadata' };
const video = (provider, id, changes = {}) => ({ provider, id, title: 'Earth landscape', duration: 20, width: 1280, height: 720,
  previewUrl: 'https://images-assets.nasa.gov/video/fixture/fixture~medium.mp4', sourcePage: 'https://images.nasa.gov/details/fixture',
  image: '', creator: 'Fixture creator', ...changes });
const review = (changes = {}) => ({ id: 'fixture', title: 'Mountain light', source: { kind: 'commons', filename: 'fixture.mp4', stockLicence: cc },
  quality: { audio: 'no-audio', postCopy: 'A little room to breathe.', captions: [], hashtags: ['#Mountains', '#Landscape'], checks: [],
    visualSources: [{ provider: 'commons', providerMediaId: '42', providerUrl: 'https://commons.wikimedia.org/wiki/File:Mountain.webm', creator: 'Fixture Creator', licence: cc.name, stockLicence: cc }] }, ...changes });

test('provider catalogue excludes Coverr and manual-only sources from automatic search', () => {
  assert.deepEqual(plain(providers.AUTOMATIC_STOCK_PROVIDERS), ['pexels', 'pixabay', 'commons', 'nasa']);
  assert.equal(providers.STOCK_PROVIDER_NAMES.mixkit, 'Mixkit'); assert.equal(providers.STOCK_PROVIDER_NAMES.dareful, 'Dareful');
  assert.equal(Object.hasOwn(providers.STOCK_PROVIDER_NAMES, 'coverr'), false);
});

test('identities preserve provider boundaries and opaque NASA/manual IDs while canonicalizing numeric IDs', () => {
  for (const provider of ['pexels', 'pixabay', 'commons']) {
    assert.equal(providers.stockMediaIdentity(provider, '0042'), `${provider}:42`);
    assert.equal(providers.stockMediaIdentity(provider, 42), `${provider}:42`);
    for (const id of [0, -1, ' 42', '42.0', '9007199254740992', 'https://bad.test/a']) assert.equal(providers.stockMediaIdentity(provider, id), null);
  }
  for (const id of ['PIA-00042_fixture', 'Earth From Space - 42']) assert.equal(providers.stockMediaIdentity('nasa', id), `nasa:${id}`);
  for (const provider of ['mixkit', 'dareful']) {
    assert.equal(providers.stockMediaIdentity(provider, manualId), `${provider}:${manualId}`);
    for (const id of ['import-42', 'a'.repeat(63), 'A'.repeat(64), 'x'.repeat(64)]) assert.equal(providers.stockMediaIdentity(provider, id), null);
  }
  for (const id of ['', ' leading', 'trailing ', 'x\n', '../secret', 'x/y', 'x?token=secret', 'https://bad.test/a', 'x'.repeat(241), 42]) assert.equal(providers.stockMediaIdentity('nasa', id), null);
  for (const provider of ['coverr', 'unknown', '__proto__', 'constructor', undefined]) assert.equal(providers.stockMediaIdentity(provider, '42'), null);
});

test('four-use history accepts all added providers without poisoning unrelated stock admission', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const shots = [{ provider: 'commons', mediaId: '00042' }, { provider: 'nasa', mediaId: 'PIA-00042_fixture' },
    { provider: 'mixkit', mediaId: manualId }, { provider: 'dareful', mediaId: manualId }];
  const jobs = Array.from({ length: 4 }, (_, index) => ({ id: `fixture-${index}`, status: 'COMPLETED',
    createdAt: '2026-10-01T00:00:00.000Z', finishedAt: '2026-10-02T00:00:00.000Z', stockSource: { shots } }));
  assert.deepEqual([...reuse.stockReuseBlocked(jobs, now)].sort(), ['commons:42', `dareful:${manualId}`, `mixkit:${manualId}`, 'nasa:PIA-00042_fixture']);
  reuse.assertStockReuseAvailable([{ provider: 'pexels', mediaId: '42' }], jobs, now);
  assert.throws(() => reuse.assertStockReuseAvailable([{ provider: 'commons', mediaId: '42' }], jobs, now), /four uses or reservations/);
  assert.throws(() => reuse.stockReuseBlocked([{ ...jobs[0], stockSource: { shots: [{ provider: 'coverr', mediaId: '42' }] } }], now), /history cannot be verified/);
});

test('new automatic footage cards retain NASA IDs and rights and reject manual-only/invalid sources', () => {
  const nasa = video('nasa', 'PIA-00042_fixture'), commons = video('commons', 42, { licence: cc });
  const found = candidates.stockFootageCandidates([nasa, commons, nasa, video('mixkit', manualId), video('dareful', manualId), video('coverr', 42), video('nasa', '../bad'), video('commons', 0)]);
  assert.deepEqual(Array.from(found, item => `${item.provider}:${item.id}`), ['nasa:PIA-00042_fixture', 'commons:42']);
  assert.equal(found[1].licence, cc);
  assert.equal(candidates.mergeStockFootageCandidates(found, [video('nasa', 'PIA-00043_fixture')]).length, 3);
});

test('automatic choice and diversity checks accept NASA/Commons while keeping native quality and context checks', () => {
  const nasa = video('nasa', 'PIA-00042_fixture'), commons = video('commons', 42);
  assert.deepEqual(Array.from(automatic.automaticStockChoices([nasa, commons, video('nasa', 'low', { width: 540 }), video('nasa', 'slow', { title: 'Earth landscape slow motion' })], 'Earth landscape'), item => `${item.provider}:${item.id}`), ['nasa:PIA-00042_fixture', 'commons:42']);
  const history = [{ status: 'COMPLETED', finishedAt: '2026-10-13T12:00:00Z', stockSource: { shots: [
    { provider: 'nasa', mediaId: 'PIA-00042_fixture' }, { provider: 'commons', mediaId: '00042' }] } }];
  assert.deepEqual([...automatic.recentStockMediaIdentities(history)].sort(), ['commons:42', 'nasa:PIA-00042_fixture']);
});

test('posting text retains mandatory source/creator/licence/edit credits across both destinations without duplicates', () => {
  const file = review();
  assert.deepEqual(plain(providers.stockPostingCredits(file)), [cc.attribution]);
  for (const target of ['instagram', 'youtube']) {
    const copy = posting.postingText(file, target);
    assert.ok(copy.startsWith(file.quality.postCopy)); assert.ok(copy.includes(cc.attribution)); assert.ok(copy.includes('#Mountains'));
    assert.equal(copy.split(cc.attribution).length - 1, 1);
    assert.equal(posting.stripFootageProvenance(copy, file), copy);
  }
  file.quality.postCopy += `\n\n${cc.attribution}`;
  assert.equal(posting.postingText(file).split(cc.attribution).length - 1, 1);
  file.quality.postCopy = 'A new owner-written caption.';
  assert.ok(posting.postingCaption(file).includes(cc.attribution));
});

test('nonmandatory licences keep existing copy unchanged and required Dareful credit is never removed', () => {
  const file = review(); file.source.stockLicence = undefined;
  file.quality.visualSources = [{ stockLicence: { ...cc, requiresAttribution: false } }];
  assert.equal(posting.postingCaption(file), file.quality.postCopy);
  const attribution = 'Dareful clip by Fixture Creator — https://dareful.com/mountain/ — CC BY 4.0 — edited and cropped.';
  file.quality.visualSources = undefined;
  file.source.kind = 'dareful'; file.source.stockLicence = { ...cc, attribution, verifiedBy: 'owner-confirmation' };
  assert.ok(posting.postingCaption(file).endsWith(attribution));
  assert.equal(providers.stockLicenceName('dareful', file.source.stockLicence), 'CC BY 4.0');
});

test('finished rendered-source metadata excludes compulsory credits from an unused starting source', () => {
  const file = review();
  file.quality.visualSources = [{ stockLicence: { ...cc, requiresAttribution: false } }];
  assert.deepEqual(plain(providers.stockPostingCredits(file)), []);
  file.quality.visualSources = [];
  assert.deepEqual(plain(providers.stockPostingCredits(file)), [cc.attribution], 'Single-source and older exports fall back to saved source rights');
});

test('older review cards without source metadata keep their caption and rendered-source credits', () => {
  const file = review(); delete file.source; delete file.quality.visualSources;
  assert.deepEqual(plain(providers.stockPostingCredits(file)), []);
  assert.equal(posting.postingCaption(file), file.quality.postCopy);
  file.quality.visualSources = [{ stockLicence: cc }];
  assert.deepEqual(plain(providers.stockPostingCredits(file)), [cc.attribution]);
  assert.ok(posting.postingCaption(file).endsWith(cc.attribution));
});

function routeHarness(options = {}) {
  const calls = [], queued = [], fetched = [];
  const configured = options.configured || { pexels: false, pixabay: false, commons: true, nasa: true };
  const catalog = { MAX_STOCK_DISCOVERY_PAGES: 3, configuredStock: () => configured, portraitFirstStock: value => value,
    async searchNaturalStockPage(provider, query, page) { calls.push({ provider, query, page }); return options.search ? options.search(provider, query, page) : { videos: [video(provider, provider === 'nasa' ? `PIA-${page}` : page)], hasMore: page < 2 }; },
    async searchNaturalStock(provider, query) { return (await catalog.searchNaturalStockPage(provider, query, 1)).videos; },
    async searchNaturalStockPool(provider, query) { return catalog.searchNaturalStock(provider, query); },
    async resolveNaturalStock(provider, id) { calls.push({ provider, id }); return video(provider, id, { licence: cc }); },
    trustedStockUrl: value => value,
  };
  class JobHistoryConflictError extends Error {}
  const source = { async ffmpegAvailable() { return true; }, async readStockReuseBlocked() { return new Set(); },
    async readSourceJobs() { return []; }, async findStockSourceJob() { return undefined; },
    async createStockReelJob(downloads, input) { queued.push({ downloads, input }); return { id: 'fixture-job', stockSource: { shots: downloads } }; },
    async createSourceJob(...args) { queued.push(args); return { id: 'fixture-job' }; },
  };
  const api = load('src/app/api/stock-reels/route.ts', {
    zod: require('zod'), '@/lib/localRequest': { assertLocalRequest() {} }, '@/lib/naturalStock': catalog,
    '@/lib/sourceProcessing': source, '@/lib/jobHistory': { JobHistoryConflictError }, '@/lib/stockReel': reel,
    '@/lib/automaticStockReel': automatic, '@/lib/stockProviders': providers,
    '@/lib/stockProductionGuidance': { async getStockProductionGuidance() { return { revision: 'fixture', rules: [], historyLimit: 10 }; } },
  }, { async fetch(url, init) { fetched.push({ url, init }); return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1' } }); } });
  return { api, calls, queued, fetched };
}

test('four-provider discovery remains available without keys and advances only selected bounded provider cursors', async () => {
  const h = routeHarness();
  const first = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Earth&browse=true'));
  assert.equal(first.status, 200); const data = await first.json();
  assert.deepEqual(h.calls.map(call => call.provider), ['commons', 'nasa']); assert.equal(data.videos.length, 2);
  const cursor = JSON.parse(data.pagination.cursor);
  assert.deepEqual(cursor, { pexels: null, pixabay: null, commons: 2, nasa: 2, limited: false });
  const second = await h.api.GET(new Request(`http://localhost/api/stock-reels?q=Earth&browse=true&cursor=${encodeURIComponent(data.pagination.cursor)}`));
  assert.equal(second.status, 200); const next = await second.json(); assert.equal(next.pagination.cursor, null);
  assert.deepEqual(h.calls.map(call => call.page), [1, 1, 2, 2]); assert.equal(h.queued.length, 0); assert.equal(h.fetched.length, 0);
});

test('provider-specific discovery skips all others and keeps valid results on a separate provider failure', async () => {
  const h = routeHarness({ search: async provider => { if (provider === 'nasa') throw new Error('Fixture NASA unavailable'); return { videos: [video('commons', 42)], hasMore: false }; } });
  const response = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Earth&browse=true'));
  const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.videos.length, 1);
  assert.match(data.errors[0], /NASA unavailable/); assert.equal(JSON.parse(data.pagination.cursor).nasa, 1);
  const only = routeHarness(); const nasa = await only.api.GET(new Request('http://localhost/api/stock-reels?q=Earth&provider=nasa&browse=true'));
  assert.equal(nasa.status, 200); assert.deepEqual(only.calls.map(call => call.provider), ['nasa']);
  const rejected = await only.api.GET(new Request('http://localhost/api/stock-reels?q=Earth&provider=coverr'));
  assert.equal(rejected.status, 400); assert.equal(only.calls.length, 1);
});

test('selected NASA opaque ID and licence reach a single-source queued request without losing provenance', async () => {
  const h = routeHarness(), id = 'PIA-00042_fixture';
  const response = await h.api.POST(new Request('http://localhost/api/stock-reels', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'nasa', id, requestId: '11111111-1111-4111-8111-111111111111', caption: '', duration: 20 }) }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json())); assert.equal(h.queued.length, 1);
  const stock = h.queued[0][5]; assert.equal(stock.provider, 'nasa'); assert.equal(stock.mediaId, id);
  assert.deepEqual(plain(stock.licence), cc); assert.equal(h.fetched.length, 1); assert.equal(h.fetched[0].init.redirect, 'error');
});
