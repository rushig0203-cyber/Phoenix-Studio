const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Small, isolated catalog/route fixtures only. No app server, storage, provider,
// credentials, process launch, models, paid fallback or media rendering.
const project = path.resolve(__dirname, '..');
function compile(relative) {
  const filename = path.join(project, relative);
  return { filename, output: ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText };
}
function isolate(source, dependencies, globals = {}) {
  const isolatedModule = { exports: {} };
  const context = vm.createContext({ module: isolatedModule, exports: isolatedModule.exports, Error, URL, Buffer, Promise,
    ...globals, require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected backend dependency: ${name}`);
      return dependencies[name];
    },
  });
  new vm.Script(source.output, { filename: source.filename }).runInContext(context, { timeout: 1000 });
  return isolatedModule.exports;
}
const editing = isolate(compile('src/lib/stockReel.ts'), {});
const semantics = isolate(compile('src/lib/footageSemantics.ts'), {});
const automatic = isolate(compile('src/lib/automaticStockReel.ts'), { './stockReel': editing, './footageSemantics': semantics });
const routeSource = compile('src/app/api/stock-reels/route.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const video = (id, title = 'Sun City skyline', extra = {}) => ({
  provider: 'pexels', id, title, duration: 40, width: 720, height: 1280,
  sourcePage: `https://www.pexels.com/video/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id}/`,
  previewUrl: `https://videos.pexels.com/fixture-${id}.mp4`, image: '', creator: 'Fixture filmmaker', ...extra,
});
const anchor = video(1);
const identities = items => Array.from(items, item => `${item.provider}:${item.id}`);
const automaticPayload = { automatic: true, provider: 'pexels', id: 1, query: 'Sun City videos', requestId: '11111111-1111-4111-8111-111111111111' };
const request = payload => new Request('http://localhost/api/stock-reels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
const baselineGuidance = { revision: 'stock-v1-123456abcdef', feedbackCount: 0, rules: ['Fixed automatic stock policy.'], historyLimit: 10 };

test('new automatic soundtrack uses compact adaptive timing without changing manual/legacy defaults', () => {
  assert.equal(automatic.AUTOMATIC_STOCK_REEL_MAX_DURATION, 40);
  assert.equal(automatic.AUTOMATIC_STOCK_REEL_MIN_SOURCES, 4);
  assert.equal(automatic.AUTOMATIC_STOCK_REEL_MAX_SOURCES, 10);
  for (const [topic, mood] of [['Sunrise over mountains', 'warm'], ['birds in a garden', 'warm'], ['Sun City videos', 'journey'], ['ocean waves', 'journey'], ['misty mountains', 'reflective'], ['moonlit lake', 'reflective']]) {
    assert.deepEqual(plain(automatic.automaticStockReelOptions(topic)), { audio: 'music', mood, transition: 'cut', framing: 'auto', pacing: 'cinematic', musicVersion: 2, shotCadence: 'adaptive-v2', continuity: 'visual-v1', reusePolicy: 'four-in-18-months-v1' });
  }
  const first = automatic.automaticStockReelOptions('sunrise'); first.mood = 'journey';
  assert.equal(automatic.automaticStockReelOptions('sunrise').mood, 'warm', 'A caller cannot mutate later defaults');
  assert.equal(automatic.AUTOMATIC_STOCK_REEL_OPTIONS.mood, 'reflective', 'Legacy constant remains unchanged');
  assert.equal(automatic.AUTOMATIC_STOCK_REEL_OPTIONS.continuity, 'visual-v1');
  assert.equal(editing.DEFAULT_STOCK_REEL_OPTIONS.audio, 'auto', 'Manual/legacy defaults still preserve source-only sound when usable');
  assert.match(automatic.automaticStockReelMessage(8), /one continuous original instrumental across all shots/);
  assert.match(automatic.automaticStockReelMessage(8, true), /saved timing and sound choices are retained/i);
  assert.doesNotMatch(automatic.automaticStockReelMessage(8, true), /continuous original instrumental/, 'Saved recipes can retain their previous soundtrack policy');
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let step = 0; step < 12; step++) await Promise.resolve(); }

test('automatic starting cards share POST subject, animation and duration criteria without padding the list', () => {
  const good = video(2, 'Sun City gardens');
  const choices = automatic.automaticStockChoices([
    anchor, good, good, video(3, 'Another city'), video(4, 'Pexels footage'), video(5, 'Sun City CGI'),
    video(6, 'Sun City skyline', { duration: .5 }), video(7, 'Sun City skyline', { height: 0 }),
  ], 'Sun City videos');
  assert.deepEqual(identities(choices), ['pexels:1', 'pexels:2']);
  assert.deepEqual(identities(automatic.automaticStockChoices([anchor, good], 'cinematic videos')), []);
});

test('automatic cards require a real native720shortedge, not nominal output pixels or portrait shape alone', () => {
  const low = video(2, 'Sun City skyline', { width: 540, height: 960 }), wide = video(3, 'Sun City skyline', { width: 1280, height: 720 });
  assert.deepEqual(identities(automatic.automaticStockChoices([low, anchor, wide, video(4, 'Sun City skyline', { width: Infinity })], 'Sun City')), ['pexels:1', 'pexels:3']);
  assert.equal(automatic.AUTOMATIC_STOCK_MIN_NATIVE_EDGE, 720);
  assert.throws(() => automatic.automaticStockCompanions(low, [anchor], 'Sun City'), /native 720p.*do not upscale/);
});

test('new automatic cards and companions reject explicit slow-motion labels but accept ordinary slow subjects', async () => {
  const slow = ['slow motion', 'slow-motion', 'slow_motion', 'slowmo', 'slow mo', 'slo-mo', 'slomo'].map((label, index) => video(index + 2, `Sun City skyline ${label}`));
  const ordinary = video(20, 'Sun City slow traffic');
  assert.deepEqual(identities(automatic.automaticStockChoices([anchor, ...slow, ordinary], 'Sun City')), ['pexels:1', 'pexels:20']);
  assert.deepEqual(identities(automatic.automaticStockCompanions(anchor, slow, 'Sun City')), []);
  const urlLabel = video(21, 'Sun City skyline', { sourcePage: 'https://www.pexels.com/video/sun-city-slow%20motion-21/' });
  assert.deepEqual(identities(automatic.automaticStockChoices([urlLabel], 'Sun City')), []);
  for (const selected of [...slow, urlLabel]) {
    let searched = 0, resolved = 0;
    await assert.rejects(automatic.automaticStockSources(selected, 'Sun City', ['pexels'], {
      async search() { searched++; return []; }, async resolve() { resolved++; return selected; },
    }), /labelled as slow motion/);
    assert.equal(searched, 0); assert.equal(resolved, 0);
  }
});

test('authoritative slow-motion changes are skipped and selection gathers enough sources for adaptive cuts', async () => {
  const calls = [], sources = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search() { return Array.from({ length: 20 }, (_, at) => video(at + 2)); },
    async resolve(provider, id) { calls.push(id); return video(id, id === 2 ? 'Sun City slow-motion skyline' : 'Sun City skyline'); },
  });
  assert.equal(sources.length, 8); assert.equal(sources[0].id, anchor.id);
  assert.deepEqual(calls, [2, 3, 4, 5, 6, 7, 8, 9]); assert.equal(sources.some(item => item.id === 2), false);
  const plan = editing.planStockIntervals(sources.map(item => ({ duration: item.duration, trimMode: 'auto' })), 40, 'cinematic', undefined, 'adaptive-v2');
  assert.ok(plan.at(-1).outputEnd >= 20 && plan.at(-1).outputEnd <= 32);
  assert.ok(plan.every(item => item.speed === 1), 'Unanalysed windows remain at native playback speed');
});

test('reuse-exhausted clips never appear as automatic anchors or companions even when recently-used fallback is needed', async () => {
  const unavailable=new Set(['pexels:1','pexels:2']);
  assert.deepEqual(identities(automatic.automaticStockChoices([anchor,video(2),video(3)],'Sun City',unavailable)),['pexels:3']);
  let calls=0;
  await assert.rejects(automatic.automaticStockSources(anchor,'Sun City',['pexels'],{async search(){calls++;return[];},async resolve(){calls++;return anchor;}},new Set(),unavailable),/four-use limit within 18 months/);
  assert.equal(calls,0);
  const eligible=video(20);const resolved=[];
  const result=await automatic.automaticStockSources(eligible,'Sun City',['pexels'],{async search(){return Array.from({length:18},(_,i)=>video(i+1));},async resolve(provider,id){resolved.push(id);return video(id);}},new Set(Array.from({length:20},(_,i)=>`pexels:${i+1}`)),unavailable);
  assert.equal(result.some(v=>unavailable.has(`${v.provider}:${v.id}`)),false);assert.ok(!resolved.includes(1)&&!resolved.includes(2));assert.equal(result.length,8);
});

test('catalog matching preserves the complete two-word topic, distinct sources and a shared anchor subject', () => {
  const good = video(2, 'Sun City gardens'), wide = video(3, 'Sun City streets', { width: 1920, height: 1080 });
  const choices = automatic.automaticStockCompanions(anchor, [
    anchor, good, good, wide, video(4, 'Sunset in another city'), video(5, 'Sun over a forest'),
    video(6, 'Pexels footage'), video(7, 'Sun City animation'), video(8, 'Sun City skyline', { duration: NaN }),
    video(9, 'Sun City skyline', { width: 0 }), video(10, 'Sun City skyline', { duration: .5 }),
  ], 'Sun City videos');
  assert.deepEqual(identities(choices), ['pexels:2', 'pexels:3']);
});

test('generic presentation terms cannot establish a subject; animated catalog entries never join filmed sources', () => {
  assert.throws(() => automatic.automaticStockCompanions(anchor, [], 'beautiful aerial videos'), /catalog detail/);
  assert.throws(() => automatic.automaticStockCompanions(video(1, 'Other City skyline'), [video(2)], 'Sun City'), /catalog detail/);
  assert.deepEqual(identities(automatic.automaticStockCompanions(anchor, [
    video(2, 'Sun City cartoon'), video(3, 'Sun City CGI'), video(4, 'Sun City computer generated'), video(5, 'Sun City 3d render'),
  ], 'Sun City')), []);
});

test('longer topics keep their leading subject and place rather than matching incidental words', () => {
  const selected = video(1, 'Sun City resort swimming pool');
  const choices = automatic.automaticStockCompanions(selected, [
    video(2, 'Other City resort swimming pool'), video(3, 'Sun City resort swimming pool detail'), video(4, 'Sun City streets'),
  ], 'Sun City resort swimming pool');
  assert.deepEqual(identities(choices), ['pexels:3']);
});

test('an explicit catalog action mismatch is rejected even when query words overlap', () => {
  const selected = video(1, 'Woman writing repair notes');
  const choices = automatic.automaticStockCompanions(selected, [
    video(2, 'Man writing repair notes'), video(3, 'Woman writing repair notes with a pen'),
  ], 'Woman writing repair notes');
  assert.deepEqual(identities(choices), ['pexels:3']);
});

test('an underwater ocean anchor never admits sky, shore waves or boats through a broad shared ocean word', () => {
  const selected = video(1, 'Underwater coral reef in the ocean');
  const choices = automatic.automaticStockCompanions(selected, [
    video(2, 'Underwater ocean reef with coral'), video(3, 'Ocean waves washing a sunny beach'),
    video(4, 'Birds soaring over the ocean sky'), video(5, 'Ocean boat beside coral reef'),
    video(6, 'Scuba diver explores underwater ocean coral reef'), video(7, 'Ocean sunset behind clouds'),
  ], 'ocean');
  assert.deepEqual(identities(choices), ['pexels:2']);
  assert.equal(automatic.automaticStockCompanionQuery(selected, 'ocean'), 'ocean underwater');
});

test('sky and sun reels cannot jump to water, forest, meadow or city merely through sun metadata', () => {
  const selected = video(1, 'Clouds and sun on sky');
  const choices = automatic.automaticStockCompanions(selected, [
    video(2, 'Moving clouds against sun in sky'), video(3, 'Tree sky and sun'),
    video(4, 'Ocean rocks and sun'), video(5, 'Sun over a field of grass'), video(6, 'Sun over city skyline'),
  ], 'sun');
  assert.deepEqual(identities(choices), ['pexels:2']);
  assert.equal(automatic.automaticStockCompanionQuery(selected, 'sun'), 'sun sky');
});

test('an ocean sunrise keeps both the coast setting and dawn conditions rather than broad sunrise montages', () => {
  const selected = video(1, 'Ocean sunrise over islands');
  assert.deepEqual(identities(automatic.automaticStockCompanions(selected, [
    video(2, 'Ocean sunrise over calm waves'), video(3, 'Sunrise over majestic mountain peaks'),
    video(4, 'Sunrise skyline with birds'), video(5, 'Serene sunrise over misty lake'),
    video(6, 'Ocean sunset over islands'), video(7, 'Ocean waves in daylight'),
  ], 'sunrise')), ['pexels:2']);
  assert.deepEqual(identities(automatic.automaticStockCompanions(selected, [
    video(8, 'Ocean waves under clouds'), video(9, 'Ocean sunrise waves'),
  ], 'ocean')), ['pexels:9'], 'Explicit dawn anchors require phase evidence; unknown phase is not treated as a match');
  assert.equal(automatic.automaticStockCompanionQuery(selected, 'sunrise'), 'sunrise ocean');
});

test('snow mountains retain snow context and reject green mountain hikes or unrelated human scenes', () => {
  const selected = video(1, 'Snow covered mountain peaks in winter');
  assert.deepEqual(identities(automatic.automaticStockCompanions(selected, [
    video(2, 'Snow covered alpine mountain landscape'), video(3, 'Green mountain panorama'),
    video(4, 'Hiker on a snow mountain trail'), video(5, 'Mountain landscape in winter'),
  ], 'mountain')), ['pexels:2', 'pexels:5']);
  assert.equal(automatic.automaticStockCompanionQuery(selected, 'mountain'), 'mountain snow');
});

test('bird nests stay nests while city footage cannot be a book cover or transporter ship', () => {
  const nest = video(1, 'Birds on nest');
  assert.deepEqual(identities(automatic.automaticStockCompanions(nest, [
    video(2, 'Bird nesting in a small woven nest'), video(3, 'Birds soaring in blue sky'),
    video(4, 'Yellow bird perched on branches'), video(5, 'Birds on a boat'),
  ], 'birds')), ['pexels:2']);
  const city = video(1, 'City skyline at night');
  assert.deepEqual(identities(automatic.automaticStockCompanions(city, [
    video(2, 'City skyscrapers at night'), video(3, 'The cover of the book The City of the Night'),
    video(4, 'Transporter ship near city at night'), video(5, 'City streets at sunrise'),
  ], 'city')), ['pexels:2']);
});

test('rain context rejects leaf and flower insertions while matching raindrop water footage', () => {
  const rain = video(1, 'Rain raindrops Bali');
  const choices = automatic.automaticStockCompanions(rain, [
    video(2, 'Rain raindrops on green leaves Bali'),
    video(3, 'Rain raindrops on flowering plants Bali'),
    video(4, 'Rain raindrops water puddle Bali'),
  ], 'rain raindrops Bali');
  assert.deepEqual(identities(choices), ['pexels:4']);

  const incompatibleBuiltScenes = automatic.automaticStockCompanions(rain, [
    video(5, 'Rain raindrops Bali billboard'), video(6, 'Rain falling on a building in Bali'),
    video(7, 'Rain raindrops on a car windshield Bali'),
  ], 'rain raindrops Bali');
  assert.deepEqual(identities(incompatibleBuiltScenes), []);
  assert.deepEqual(identities(automatic.automaticStockCompanions(video(8, 'Rain on a city billboard Bali'), [
    video(9, 'Rain falling on a city billboard Bali'), video(10, 'Rain raindrops water puddle Bali'),
  ], 'rain Bali')), ['pexels:9'], 'A built scene is allowed when the owner-selected anchor establishes it');
});

test('Parks anchor keeps park scenes and rejects parking lots and amusement parks', () => {
  const parkAnchor = video(1, 'people enjoying their day in a park');
  const sources = [
    video(2, 'a large parking lot with a large building in the background'),
    video(3, 'empty parking lot at dusk with trees'),
    video(4, 'city park and skyscrapers'),
    video(5, 'man strolling in lush green park with blossoming trees'),
    video(6, 'empty swing in green park'),
    video(7, 'aerial view of kids playing in city park'),
    video(8, 'ferris wheel · amusement park · fun'),
  ];
  assert.deepEqual(identities(automatic.automaticStockCompanions(parkAnchor, sources, 'Parks')),
    ['pexels:4', 'pexels:5', 'pexels:6', 'pexels:7']);
  assert.deepEqual(identities(automatic.automaticStockChoices([parkAnchor, sources[0], sources[1]], 'Parks')), ['pexels:1']);
});

test('ordinary Parks search excludes parking areas, spaces and bare parking while explicit parking remains available', () => {
  const park = video(1, 'lush green park with trees');
  const parking = [
    video(40115707, 'aerial view of lush park with parking area'),
    video(2, 'car parking spaces beside a city park'),
    video(3, 'parking in a green park'),
  ];
  assert.deepEqual(identities(automatic.automaticStockChoices([park, ...parking], 'Parks')), ['pexels:1']);
  assert.deepEqual(identities(automatic.automaticStockCompanions(park, [...parking, video(4, 'green park walkway')], 'park')), ['pexels:4']);
  assert.deepEqual(identities(automatic.automaticStockChoices([park, ...parking], 'parking')),
    ['pexels:40115707', 'pexels:2', 'pexels:3'], 'A parking request keeps real parking evidence, not an ordinary garden park');
  const parkingAnchor = video(5, 'car park parking spaces');
  assert.deepEqual(identities(automatic.automaticStockCompanions(parkingAnchor, [park, parking[1]], 'parking')), ['pexels:2']);
});

test('ordinary park and broad Nature starting cards do not imply amusement or parking intent', () => {
  const park = video(1, 'lush green park with trees');
  const amusement = video(12145278, 'amusement park on grassland');
  const parking = video(40115707, 'aerial view of lush park with parking area');
  assert.deepEqual(identities(automatic.automaticStockChoices([park, amusement, parking], 'Parks')), ['pexels:1']);
  assert.deepEqual(identities(automatic.automaticStockChoices([park, amusement, parking], 'Nature')), ['pexels:1']);
  assert.deepEqual(identities(automatic.automaticStockChoices([park, amusement, parking], 'amusement park')), ['pexels:12145278']);
});

test('an explicitly lush green park does not become a skyline, roadside or traffic reel', () => {
  const selected = video(1, 'man strolling in lush green park with blossoming trees');
  const choices = automatic.automaticStockCompanions(selected, [
    video(2, 'city park and skyscrapers'),
    video(3, 'tree by roadside in sunny park'),
    video(4, 'green park beside traffic and buildings'),
    video(5, 'man strolling through a green park'),
    video(6, 'empty swing in green park'),
    video(7, 'sunny park walkway among blossoming trees'),
    video(8, 'park in city in birds eye view'),
    video(9, 'green city park walkway'),
  ], 'Parks');
  assert.deepEqual(identities(choices), ['pexels:5', 'pexels:7', 'pexels:6', 'pexels:9']);
  assert.equal(automatic.automaticStockCompanionQuery(selected, 'Parks'), 'Parks green', 'Inflected Parks and park are not duplicated');
  assert.equal(automatic.automaticStockCompanionQuery(selected, 'Nature'), 'park green');
});

test('natural forest and garden anchors reject explicit built settings without globally banning urban vegetation', () => {
  const forest = video(1, 'lush forest canopy of trees');
  assert.deepEqual(identities(automatic.automaticStockCompanions(forest, [
    video(2, 'forest trees beside a road with cars'),
    video(3, 'forest woodland canopy'),
  ], 'forest')), ['pexels:3']);
  const garden = video(4, 'lush flowering garden');
  assert.deepEqual(identities(automatic.automaticStockCompanions(garden, [
    video(5, 'garden alongside traffic on road'),
    video(6, 'flowering garden full of flowers'),
  ], 'garden')), ['pexels:6']);
  const cityPark = video(7, 'lush green city park and skyscrapers');
  assert.deepEqual(identities(automatic.automaticStockCompanions(cityPark, [
    video(8, 'green city park and buildings'),
    video(9, 'city park below skyscrapers'),
  ], 'park')), ['pexels:8', 'pexels:9'], 'The selected anchor explicitly opts into an urban park setting');
  const roadside = video(10, 'green park trees beside a road');
  assert.deepEqual(identities(automatic.automaticStockCompanions(roadside, [video(11, 'green park trees beside traffic on road')], 'park')), ['pexels:11']);
});

test('greenery focus uses explicit natural anchor evidence and excludes urban, road and unknown settings', () => {
  for (const title of ['lush green park with blossoming trees', 'lush green city park', 'lush forest canopy', 'green meadow with grass']) {
    assert.equal(automatic.automaticStockGreeneryFocus(video(1, title)), true, title);
  }
  for (const title of ['city park and skyscrapers', 'green park beside traffic on road', 'green forest next to buildings', 'park walkway', 'snowy forest', 'green ocean waves', 'flowering garden', 'red flowers in garden', 'blossoming park trees']) {
    assert.equal(automatic.automaticStockGreeneryFocus(video(2, title)), false, title);
  }
  assert.equal(automatic.automaticStockGreeneryFocus(video(3, 'park foliage', { sourcePage: 'https://www.pexels.com/video/lush-green-park-3/' })), true,
    'Provider slug evidence is considered consistently with selection');
  assert.equal(automatic.automaticStockCompanionQuery(video(4, 'red flowers in garden'), 'Nature'), 'garden', 'Flowers alone do not imply a green palette');
});

test('authoritative resolution cannot introduce a skyline into a saved natural park selection', async () => {
  const selected = video(1, 'man strolling in lush green park with blossoming trees');
  const sources = await automatic.automaticStockSources(selected, 'Parks', ['pexels'], {
    async search(provider, query) { assert.equal(query, 'Parks green'); return Array.from({ length: 8 }, (_, index) => video(index + 2, 'lush green park with trees')); },
    async resolve(provider, id) { return video(id, id === 2 ? 'city park and skyscrapers' : 'lush green park with trees'); },
  });
  assert.equal(sources[0].id, selected.id); assert.equal(sources.some(source => source.id === 2), false); assert.equal(sources.length, 8);
});

test('explicit day phase stays consistent across companions even when the anchor phase is unlabeled', () => {
  const anchor = video(1, 'city park greenery');
  const choices = automatic.automaticStockCompanions(anchor, [
    video(2, 'city park at night'), video(3, 'city park in daylight'), video(4, 'empty swing in city park'),
  ], 'city park');
  assert.deepEqual(identities(choices), ['pexels:2', 'pexels:4'], 'The first equally represented explicit phase wins; unlabeled context remains unknown');
  const dayAnchor = video(5, 'sunlit city park during the day');
  assert.deepEqual(identities(automatic.automaticStockCompanions(dayAnchor, [
    video(6, 'city park in daylight'), video(7, 'city park after dark'),
  ], 'city park')), ['pexels:6']);
});

test('authoritative resolution cannot change a phase-consistent search result into another explicit phase', async () => {
  const selected = video(1, 'city park greenery');
  const sources = await automatic.automaticStockSources(selected, 'city park', ['pexels'], {
    async search() { return [video(2, 'city park in daylight'), video(3, 'city park daytime trees'), video(4, 'city park daylight path'), video(5, 'city park in daylight') , video(6, 'city park at night')]; },
    async resolve(provider, id) { return id === 2 ? video(id, 'city park at night') : video(id, 'city park in daylight'); },
  });
  assert.deepEqual(identities(sources), ['pexels:1', 'pexels:3', 'pexels:4', 'pexels:5']);
});

test('a natural field anchor does not admit a different animal subject family', () => {
  const field = video(1, 'meadow field at sunrise');
  assert.deepEqual(identities(automatic.automaticStockCompanions(field, [
    video(2, 'horse grazing in a field at sunrise'), video(3, 'empty field of grass at sunrise'),
  ], 'nature')), ['pexels:3']);
});

test('a Nature animal anchor retains its named subject instead of becoming a background montage', () => {
  const horse = video(1, 'horse grazing in a green meadow');
  assert.deepEqual(identities(automatic.automaticStockCompanions(horse, [
    video(2, 'empty meadow field of grass'), video(3, 'horses grazing in green pasture'),
    video(4, 'dog exploring a green meadow'),
  ], 'nature')), ['pexels:3']);
  assert.equal(automatic.automaticStockCompanionQuery(horse, 'nature'), 'meadow horse');
});

test('named anchor animals remain required for ordinary broad topics and authoritative companions', async () => {
  const dog = video(1, 'dog exploring a green park');
  assert.deepEqual(identities(automatic.automaticStockCompanions(dog, [
    video(2, 'empty path in green park'), video(3, 'dog playing in a green park'),
  ], 'park')), ['pexels:3']);
  assert.equal(automatic.automaticStockCompanionQuery(dog, 'park'), 'park green dog');
  const resolved = [];
  const sources = await automatic.automaticStockSources(dog, 'park', ['pexels'], {
    async search(provider, query) { assert.equal(query, 'park green dog'); return Array.from({ length: 8 }, (_, index) => video(index + 2, 'dog playing in green park')); },
    async resolve(provider, id) { resolved.push(id); return video(id, id === 2 ? 'empty path in green park' : 'dog playing in green park'); },
  });
  assert.equal(sources[0].id, dog.id);
  assert.equal(sources.some(source => source.id === 2), false, 'A changed authoritative title cannot lose the selected dog');
  assert.deepEqual(resolved, [2, 3, 4, 5, 6, 7, 8, 9]);
});

test('explicit hiking stays hiking, and coherent subject evidence precedes portrait preference', () => {
  const hiking = video(1, 'hikers hiking through a forest');
  const ordinaryPortrait = video(2, 'people walking through a forest');
  const emptyPortrait = video(3, 'forest trees and woodland');
  const hikingLandscape = video(4, 'hikers hiking through forest woodland', { width: 1920, height: 1080 });
  const hikingPortrait = video(5, 'hiking through woodland forest');
  assert.deepEqual(identities(automatic.automaticStockCompanions(hiking, [ordinaryPortrait, emptyPortrait, hikingLandscape, hikingPortrait], 'nature')),
    ['pexels:5', 'pexels:4'], 'An unrelated portrait cannot beat a matching landscape');
  assert.equal(automatic.automaticStockCompanionQuery(hiking, 'nature'), 'forest hiking');
  const trail = video(6, 'hikers hiking on a mountain trail');
  assert.equal(automatic.automaticStockCompanionQuery(trail, 'mountain trail'), 'mountain trail hiking');
  assert.deepEqual(identities(automatic.automaticStockCompanions(trail, [
    video(7, 'empty mountain trail'), video(8, 'hikers hiking the mountain trail'),
  ], 'mountain trail')), ['pexels:8']);
});

test('activity locks are grounded in the anchor and do not require generic park visitors', () => {
  const park = video(1, 'people enjoying their day in a park');
  assert.deepEqual(identities(automatic.automaticStockCompanions(park, [
    video(2, 'empty swing in green park'), video(3, 'man strolling in green park'),
  ], 'park')), ['pexels:2', 'pexels:3']);
  for (const [activity, first, matching, changed] of [
    ['cycling', 'cyclists cycling through a forest', 'bicycles cycling through forest woodland', 'people walking in a forest'],
    ['climbing', 'climbers climbing a mountain', 'climbers climbing another mountain', 'mountain scenery'],
    ['skating', 'skaters skating in a park', 'skateboarding in a green park', 'empty green park'],
    ['skiing', 'skiers skiing on a snowy mountain', 'skiing on snow covered mountain peaks', 'snow covered mountain panorama'],
  ]) {
    const selected = video(10, first);
    assert.deepEqual(identities(automatic.automaticStockCompanions(selected, [video(11, changed), video(12, matching)], 'nature')), ['pexels:12'], activity);
    assert.match(automatic.automaticStockCompanionQuery(selected, 'nature'), new RegExp(`\\b${activity}\\b`));
  }
});

test("a bird's-eye camera view is not a bird subject in title or URL evidence", () => {
  const park = video(1, "Bird's-eye view of green city park");
  assert.deepEqual(identities(automatic.automaticStockCompanions(park, [
    video(2, 'green city park greenery'),
    video(3, 'green city park aerial view', { sourcePage: 'https://www.pexels.com/video/city-park-bird-s-eye-view-3/' }),
    video(4, 'birds flying over a green city park'),
  ], 'park')), ['pexels:2', 'pexels:3']);
  assert.equal(automatic.automaticStockCompanionQuery(park, 'park'), 'park green');
  const birdEye = video(5, 'closeup bird eye in a forest');
  assert.deepEqual(identities(automatic.automaticStockCompanions(birdEye, [video(6, 'bird perched in a forest')], 'birds')), ['pexels:6'],
    'An actual bird-eye detail is not erased as a camera phrase');
});

test('native full-frame portrait companions outrank landscape candidates after relevance filtering', () => {
  const selected = video(1, 'Sun City skyline');
  const portrait = video(2, 'Sun City skyline at dusk');
  const keywordStuffedLandscape = video(3, 'Sun City skyline city buildings streets urban downtown tower skyline', { width: 1920, height: 1080 });
  assert.deepEqual(identities(automatic.automaticStockCompanions(selected, [keywordStuffedLandscape, portrait], 'Sun City', new Set(['pexels:2']))),
    ['pexels:2', 'pexels:3']);
});

test('nature is a broad discovery topic, but the chosen forest locks the reel to forest scenes', () => {
  const forest = video(1, 'Forest canopy of tall trees');
  const fixtures = [forest, video(2, 'Aerial forest woodland'), video(3, 'Ocean waves'),
    video(4, 'Mountain peaks'), video(5, 'Nature stock video'), video(6, 'City street'), video(7, 'Forest painting')];
  assert.deepEqual(identities(automatic.automaticStockChoices(fixtures, 'nature videos')), ['pexels:1', 'pexels:2', 'pexels:3', 'pexels:4']);
  assert.deepEqual(identities(automatic.automaticStockCompanions(forest, fixtures, 'nature videos')), ['pexels:2']);
  assert.equal(automatic.automaticStockCompanionQuery(forest, 'nature'), 'forest');
  assert.deepEqual(identities(automatic.automaticStockCompanions(video(1, 'Train through a forest'), [
    video(2, 'Train travelling beside trees'), video(3, 'Walking on forest trail'), video(4, 'Birds on forest branch'),
  ], 'train')), ['pexels:2']);
});

test('recent diversity never makes an unused different setting outrank or admit a coherent reused source', () => {
  const selected = video(1, 'Ocean coral reef underwater'), used = video(2, 'Underwater ocean reef');
  assert.deepEqual(identities(automatic.automaticStockCompanions(selected, [video(3, 'Ocean beach and sky'), used], 'ocean', new Set(['pexels:2']))), ['pexels:2']);
});

test('narrow companion queries replace existing searches without extra calls or frame/model work', async () => {
  const selected = video(1, 'Ocean coral reef underwater'), calls = [], resolutions = [];
  const fixtures = Array.from({ length: 8 }, (_, at) => video(at + 2, 'Ocean coral reef underwater'));
  const sources = await automatic.automaticStockSources(selected, 'ocean', ['pexels', 'pixabay', 'pexels'], {
    async search(provider, query) { calls.push([provider, query]); return fixtures; },
    async resolve(provider, id) { resolutions.push(id); return video(id, 'Ocean coral reef underwater'); },
  });
  assert.deepEqual(calls, [['pexels', 'ocean underwater'], ['pixabay', 'ocean underwater']]);
  assert.equal(sources[0].id, selected.id); assert.ok(resolutions.length <= 16); assert.ok(sources.length <= 10);
  const plan = editing.planStockIntervals(sources.map(source => ({ duration: source.duration, trimMode: 'auto' })), 40, 'cinematic', undefined, 'adaptive-v2');
  assert.ok(plan.at(-1).outputEnd >= 12 && plan.at(-1).outputEnd <= 32);
});

test('changed authoritative context and sparse coherent footage fail rather than add unrelated filler', async () => {
  const selected = video(1, 'Clouds and sun in sky'); let resolutions = 0;
  await assert.rejects(automatic.automaticStockSources(selected, 'sun', ['pexels'], {
    async search() { return Array.from({ length: 24 }, (_, at) => video(at + 2, 'Clouds and sun in sky')); },
    async resolve(provider, id) { resolutions++; return video(id, 'Ocean waves under sun'); },
  }), /Not enough related footage/);
  assert.equal(resolutions, 16);
  resolutions = 0;
  await assert.rejects(automatic.automaticStockSources(selected, 'sun', ['pexels'], {
    async search() { return [video(2, 'Clouds and sun in sky'), ...Array.from({ length: 15 }, (_, at) => video(at + 3, 'Ocean waves under sun'))]; },
    async resolve(provider, id) { resolutions++; return video(id, 'Clouds and sun in sky'); },
  }), /Not enough related footage/);
  assert.equal(resolutions, 1, 'Known incoherent candidates never get authoritative resolution or download work');
});

test('automatic composition resolves authoritative companions until its adaptive duration is sufficient', async () => {
  const calls = [], searched = [];
  const sources = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels', 'pixabay', 'pexels'], {
    async search(provider, query) {
      searched.push([provider, query]);
      return provider === 'pexels' ? Array.from({ length: 12 }, (_, index) => video(index + 2)) : [video(14, 'Other city')];
    },
    async resolve(provider, id) {
      calls.push([provider, id]);
      if (id === 2) return video(999);
      if (id === 3) return video(3, 'Sun City animation');
      if (id === 4) throw new Error('Fixture deleted source');
      return video(id);
    },
  });
  assert.deepEqual(searched, [['pexels', 'Sun City'], ['pixabay', 'Sun City']]);
  assert.deepEqual(calls, Array.from({ length: 10 }, (_, index) => ['pexels', index + 2]));
  assert.deepEqual(identities(sources), ['pexels:1', ...Array.from({ length: 7 }, (_, at) => `pexels:${at + 5}`)]);
  const plan = editing.planStockIntervals(sources.map(source => ({ duration: source.duration, trimMode: 'auto' })), 40, 'cinematic', undefined, 'adaptive-v2');
  assert.ok(plan.at(-1).outputEnd >= 20 && plan.at(-1).outputEnd <= 32);
});

test('one catalog can provide a compact reel while too few related shots remain an error', async () => {
  const sources = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels', 'pixabay'], {
    async search(provider) { if (provider === 'pixabay') throw new Error('Fixture unavailable'); return Array.from({ length: 8 }, (_, index) => video(index + 1)); },
    async resolve(provider, id) { return video(id, 'Sun City streets', { provider }); },
  });
  assert.deepEqual(identities(sources), Array.from({ length: 8 }, (_, at) => `pexels:${at + 1}`));
  await assert.rejects(automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search() { return [anchor, video(2, 'Other city')]; }, async resolve() { throw new Error('No candidates should resolve'); },
  }), /Not enough related footage.*another starting video/);
});

test('five related sources are enough when the catalog is sparse and the adaptive plan reaches twelve seconds', async () => {
  const sources = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search() { return Array.from({ length: 4 }, (_, index) => video(index + 2)); },
    async resolve(provider, id) { return video(id, 'Sun City skyline', { provider }); },
  });
  assert.equal(sources.length, 5, 'A sparse but viable catalog does not force eight source clips');
  const plan = editing.planStockIntervals(sources.map(source => ({ duration: source.duration, trimMode: 'auto' })), 40, 'cinematic', undefined, 'adaptive-v2');
  assert.ok(plan.at(-1).outputEnd >= 12 && plan.at(-1).outputEnd <= 32);
});

test('adaptive source windows use native actual duration or only a modest measured speed-up', () => {
  const plan = editing.planStockIntervals([
    { duration: 8, trimMode: 'auto', motionWindows: [{ start: 0, end: 8, motion: 1 }] },
    { duration: 8, trimMode: 'auto', motionWindows: [{ start: 0, end: 8, motion: 40 }] },
    { duration: 8, trimMode: 'auto' },
    { duration: 8, trimMode: 'auto', motionWindows: [{ start: 0, end: 8, motion: 0 }] },
    { duration: 8, trimMode: 'auto', motionWindows: [{ start: 0, end: 8, motion: 50 }] },
  ], 40, 'cinematic', undefined, 'adaptive-v2');
  assert.ok(plan.at(-1).outputEnd >= 12 && plan.at(-1).outputEnd <= 32);
  assert.deepEqual(plan.map(interval => interval.speed), [1.25, 1, 1, 1.25, 1]);
  assert.ok(plan.every(interval => interval.end - interval.start <= interval.frames / 24 * 1.25 + 1e-7));
});

test('catalog resolution work remains bounded when search IDs are all stale', async () => {
  let resolved = 0;
  await assert.rejects(automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search() { return Array.from({ length: 24 }, (_, index) => video(index + 2)); },
    async resolve() { resolved++; throw new Error('Fixture unavailable'); },
  }), /Not enough related footage/);
  assert.equal(resolved, 16);
});

test('local diversity uses only the last10 completed, nonarchived multi-shot reels with provider-scoped identities', () => {
  const history = Array.from({ length: 12 }, (_, at) => ({
    status: 'COMPLETED', finishedAt: new Date(Date.UTC(2026, 9, 1, 0, at)).toISOString(),
    stockSource: { shots: [{ provider: 'pexels', mediaId: String(at + 1) }, { provider: 'pixabay', mediaId: String(at + 1) }] },
  }));
  const ignored = ['QUEUED', 'PROCESSING', 'FAILED', 'BLOCKED', 'CANCELLED'].map(status => ({
    status, finishedAt: '2026-10-08T00:00:00.000Z', stockSource: { shots: [{ provider: 'pexels', mediaId: '999' }, { provider: 'pixabay', mediaId: '999' }] },
  }));
  ignored.push({ status: 'COMPLETED', archivedAt: '2026-10-08T00:00:00.000Z', finishedAt: '2026-10-08T00:00:00.000Z', stockSource: history[0].stockSource });
  ignored.push({ status: 'COMPLETED', finishedAt: '2026-10-08T00:00:00.000Z', stockSource: { shots: [{ provider: 'pexels', mediaId: '888' }] } });
  ignored.push({ status: 'COMPLETED', finishedAt: '2026-10-08T00:00:00.000Z' });
  const before = JSON.stringify(history), recent = automatic.recentStockMediaIdentities([...history, ...ignored]);
  assert.equal(recent.size, 20); assert.equal(JSON.stringify(history), before);
  for (const provider of ['pexels', 'pixabay']) {
    assert.equal(recent.has(provider + ':1'), false); assert.equal(recent.has(provider + ':2'), false);
    assert.equal(recent.has(provider + ':3'), true); assert.equal(recent.has(provider + ':12'), true);
    assert.equal(recent.has(provider + ':999'), false); assert.equal(recent.has(provider + ':888'), false);
  }
});

test('local diversity handles old completion timestamps and malformed media identities without claiming new footage', () => {
  const recent = automatic.recentStockMediaIdentities([{ status: 'COMPLETED', finishedAt: 'invalid', updatedAt: '2026-10-01T00:00:00.000Z', stockSource: {
    shots: [{ provider: 'pexels', mediaId: '001' }, { provider: 'pixabay', mediaId: '1' },
      { provider: 'unknown', mediaId: '2' }, { provider: 'pexels', mediaId: '-2' }, { provider: 'pexels', mediaId: '0' },
      { provider: 'pexels', mediaId: 'https://untrusted.test/123' }, { provider: 'pixabay', mediaId: '9999999999999999999999999' }],
  } }]);
  assert.deepEqual([...recent].sort(), ['pexels:1', 'pixabay:1']);
  assert.doesNotMatch(automatic.automaticStockReelMessage(8), /fresh|unseen|never.used|new footage/i);
});

test('recent diversity remembers rendered sources, not companions rejected during the edit', () => {
  const stockSource = { shots: [{ provider: 'pexels', mediaId: '1' }, { provider: 'pexels', mediaId: '2' }], renderedShots: [{ provider: 'pexels', mediaId: '2' }] };
  assert.deepEqual([...automatic.recentStockMediaIdentities([{ status: 'COMPLETED', finishedAt: '2026-10-09T00:00:00Z', stockSource }])], ['pexels:2']);
  assert.equal(stockSource.shots.length, 2, 'Original download provenance remains unchanged');
});

test('explicit repetition feedback may use twenty recent completed recipes, while default history remains ten and arbitrary windows fail', () => {
  const jobs = Array.from({ length: 25 }, (_, at) => ({ status: 'COMPLETED', finishedAt: new Date(Date.UTC(2026, 9, 1, 0, at)).toISOString(),
    stockSource: { shots: [{ provider: 'pexels', mediaId: String(at + 1) }, { provider: 'pixabay', mediaId: String(at + 1) }] } }));
  const original = JSON.stringify(jobs);
  const normal = automatic.recentStockMediaIdentities(jobs), feedback = automatic.recentStockMediaIdentities(jobs, 20);
  assert.equal(normal.size, 20); assert.equal(feedback.size, 40); assert.equal(normal.has('pexels:15'), false);
  assert.equal(feedback.has('pexels:6'), true); assert.equal(feedback.has('pexels:5'), false); assert.equal(JSON.stringify(jobs), original);
  for (const limit of [0, 9, 11, 21, Infinity, '20']) assert.throws(() => automatic.recentStockMediaIdentities(jobs, limit), /bounded recent reel history/);
});

test('native framing wins before freshness, with unused sources preferred within matching framing', () => {
  const usedPortrait = video(2, 'Sun City skyline'), freshWide = video(3, 'Sun City skyline', { width: 1920, height: 1080 });
  assert.deepEqual(identities(automatic.automaticStockCompanions(anchor, [usedPortrait, freshWide], 'Sun City')), ['pexels:2', 'pexels:3']);
  assert.deepEqual(identities(automatic.automaticStockCompanions(anchor, [usedPortrait, video(4, 'Unrelated beach'), freshWide], 'Sun City', new Set(['pexels:1', 'pexels:2']))), ['pexels:2', 'pexels:3']);
  assert.deepEqual(identities(automatic.automaticStockCompanions(anchor, [usedPortrait, video(5)], 'Sun City', new Set(['pexels:2']))), ['pexels:5', 'pexels:2']);
  assert.deepEqual(identities(automatic.automaticStockCompanions(anchor, [usedPortrait, freshWide], 'Sun City', new Set(['pixabay:2']))), ['pexels:2', 'pexels:3'], 'Provider IDs are independent');
});

test('diverse composition keeps the selected anchor and permits relevant reused shots without extra searches', async () => {
  const calls = [], searched = [], used = new Set(['pexels:1', 'pexels:2', 'pexels:3', 'pexels:4']);
  const sources = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search(provider, query) { searched.push([provider, query]); return Array.from({ length: 8 }, (_, at) => video(at + 2)); },
    async resolve(provider, id) { calls.push([provider, id]); return video(id); },
  }, used);
  assert.deepEqual(searched, [['pexels', 'Sun City']]); assert.equal(sources[0].id, anchor.id);
  assert.deepEqual(calls.slice(0, 5), [5, 6, 7, 8, 9].map(id => ['pexels', id]));
  assert.ok(sources.some(item => used.has(item.provider + ':' + item.id) && item.id !== anchor.id), 'Sparse unused choices still allow matching reused footage');
  assert.equal(new Set(identities(sources)).size, sources.length);
  const plan = editing.planStockIntervals(sources.map(item => ({ duration: item.duration, trimMode: 'auto' })), 40, 'cinematic', undefined, 'adaptive-v2');
  assert.ok(plan.at(-1).outputEnd >= 12 && plan.at(-1).outputEnd <= 32);
});

test('all relevant footage being used recently never hard-blocks a valid native-speed reel', async () => {
  const fixtures = Array.from({ length: 8 }, (_, at) => video(at + 1));
  const sources = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search() { return fixtures; }, async resolve(provider, id) { return video(id); },
  }, new Set(identities(fixtures)));
  assert.equal(sources[0].id, anchor.id); assert.equal(sources.length, 8);
});

test('authoritative low-resolution companion changes are skipped without abandoning topic or adaptive planning', async () => {
  const calls = [], sources = await automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search() { return Array.from({ length: 9 }, (_, at) => video(at + 2)); },
    async resolve(provider, id) { calls.push(id); return video(id, 'Sun City skyline', id === 2 ? { width: 540, height: 960 } : {}); },
  });
  assert.equal(sources[0].id, anchor.id); assert.ok(sources.every(item => Math.min(item.width, item.height) >= 720));
  assert.equal(sources.some(item => item.id === 2), false); assert.equal(new Set(identities(sources)).size, sources.length);
  assert.ok(calls.length <= 16); const plan = editing.planStockIntervals(sources.map(item => ({ duration: item.duration, trimMode: 'auto' })), 40, 'cinematic', undefined, 'adaptive-v2');
  assert.ok(plan.at(-1).outputEnd >= 12 && plan.at(-1).outputEnd <= 32);
});

test('low-resolution anchors and insufficient native companions fail clearly before any media factory is possible', async () => {
  let searched = 0, resolved = 0;
  await assert.rejects(automatic.automaticStockSources(video(1, 'Sun City skyline', { width: 540, height: 960 }), 'Sun City', ['pexels'], {
    async search() { searched++; return []; }, async resolve() { resolved++; return anchor; },
  }), /native 720p/);
  assert.equal(searched, 0); assert.equal(resolved, 0);
  await assert.rejects(automatic.automaticStockSources(anchor, 'Sun City', ['pexels'], {
    async search() { return [video(2), video(3), video(4, 'Sun City skyline', { width: 540, height: 960 })]; },
    async resolve(provider, id) { return video(id, 'Sun City skyline', { provider, width: 540, height: 960 }); },
  }), /Not enough related footage at native 720p/);
});

function harness(options = {}) {
  const calls = [], queued = [], single = [], fetches = [], trusted = [];
  class JobHistoryConflictError extends Error {}
  const sourceProcessing = {
    async findStockSourceJob(id) { calls.push(['existing', id]); if (options.cancelled) throw new JobHistoryConflictError('This request was removed.'); return options.existing; },
    async ffmpegAvailable() { calls.push(['preflight']); return options.ffmpeg !== false; },
    async readSourceJobs() { calls.push(['history']); return options.history || []; },
    async readStockReuseBlocked() { calls.push(['reuse']); if(options.reuseError)throw new Error(options.reuseError); return new Set(options.blocked || []); },
    async createSourceJob(...args) { single.push(args); return { id: 'fixture-single-source' }; },
    async createStockReelJob(downloads, input) {
      queued.push({ downloads, input });
      // Verify stream factories stay lazy until composition and trims are valid.
      calls.push(['queue', downloads.length]);
      if (options.openDownloads) for (const download of downloads) { const opened = await download.open(); await opened.stream.cancel(); }
      const job = { id: 'fixture-reel', stockSource: { shots: downloads.map(shot => ({ ...shot, open: undefined })) } };
      return options.queue ? options.queue(downloads, input, job) : job;
    },
  };
  const catalog = {
    MAX_STOCK_DISCOVERY_PAGES: 3,
    configuredStock() { return options.configured || { pexels: true, pixabay: true }; },
    portraitFirstStock(videos) { return videos; },
    async resolveNaturalStock(provider, id) {
      calls.push(['resolve', provider, id]);
      return options.resolve ? options.resolve(provider, id) : video(id, 'Sun City skyline', { provider,
        previewUrl: provider === 'pixabay' ? `https://cdn.pixabay.com/fixture-${id}.mp4` : `https://videos.pexels.com/fixture-${id}.mp4`,
      });
    },
    async searchNaturalStock(provider, query) {
      calls.push(['search', provider, query]);
      if (options.search) return options.search(provider, query);
      return provider === 'pexels' ? [anchor, video(2), video(3), video(4)] : [5, 6, 7, 8].map(id => video(id, 'Sun City skyline', { provider: 'pixabay' }));
    },
    async searchNaturalStockPool(provider, query, enough) {
      if (options.searchPool) { calls.push(['search', provider, query]); return options.searchPool(provider, query, enough); }
      return catalog.searchNaturalStock(provider, query);
    },
    async searchNaturalStockPage(provider, query, page) {
      calls.push(['page', provider, query, page]);
      if (options.searchPage) return options.searchPage(provider, query, page);
      return { videos: [video(provider === 'pexels' ? page : page + 10, 'Sun City skyline', { provider })], hasMore: true };
    },
    trustedStockUrl(url, provider) { trusted.push([url, provider]); const parsed = new URL(url); assert.equal(parsed.protocol, 'https:'); return url; },
  };
  const api = isolate(routeSource, {
    zod: require('zod'), '@/lib/localRequest': { assertLocalRequest(request, mutating) { assert.equal(request.url.startsWith('http://localhost/'), true); if (request.method === 'POST') assert.equal(mutating, true); } },
    '@/lib/naturalStock': catalog, '@/lib/sourceProcessing': sourceProcessing,
    '@/lib/jobHistory': { JobHistoryConflictError }, '@/lib/stockReel': editing, '@/lib/automaticStockReel': automatic,
    '@/lib/stockProductionGuidance': { async getStockProductionGuidance() { calls.push(['guidance']); if (options.guidanceError) throw new Error(options.guidanceError); return options.guidance || baselineGuidance; } },
  }, { Request, Response, AbortSignal, async fetch(url, init) {
    fetches.push([url, init]);
    return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1' } });
  } });
  return { api, calls, queued, single, fetches, trusted };
}

test('automatic discovery excludes exhausted clips on every page while ordinary/manual browsing remains unchanged', async () => {
  for(const suffix of ['','&browse=true']){
    const h=harness({blocked:['pexels:1','pixabay:11'],searchPage:async provider=>({videos:[video(provider==='pexels'?1:11,'Sun City skyline',{provider}),video(99,'Sun City skyline',{provider})],hasMore:false})});
    const response=await h.api.GET(new Request(`http://localhost/api/stock-reels?q=Sun%20City&automatic=true${suffix}`));const data=await response.json();assert.equal(response.status,200);
    assert.equal(data.videos.some(v=>['pexels:1','pixabay:11'].includes(`${v.provider}:${v.id}`)),false);
    const ordinary=await h.api.GET(new Request(`http://localhost/api/stock-reels?q=Sun%20City${suffix}`));const plainData=await ordinary.json();assert.ok(plainData.videos.some(v=>v.provider==='pexels'&&v.id===1));
  }
});

test('an exhausted selected anchor or unreadable reuse history cannot download or queue, and saved UUIDs retain their recipe', async () => {
  for(const options of [{blocked:['pexels:1']},{reuseError:'Cannot verify footage usage'}]){
    const h=harness(options);const result=await h.api.POST(request(automaticPayload));assert.equal(result.status,400);assert.equal(h.queued.length,0);assert.equal(h.fetches.length,0);assert.equal(h.calls.some(c=>c[0]==='search'),false);
  }
  const h=harness({reuseError:'Cannot verify footage usage',existing:{id:'saved',stockSource:{shots:[{provider:'pexels',mediaId:'1'}]}}});
  const result=await h.api.POST(request(automaticPayload));assert.equal(result.status,200);assert.equal(h.calls.some(c=>c[0]==='reuse'),false);assert.equal(h.queued.length,0);
});

test('manual sequences and single-source requests cannot bypass the four-use limit before provider access',async()=>{
  for(const payload of [
    {...automaticPayload,automatic:false,shots:[{provider:'pexels',id:1,start:0,end:10}],theme:'Sun City'},
    {...automaticPayload,automatic:false},
  ]){const h=harness({blocked:['pexels:1']});const result=await h.api.POST(request(payload));assert.equal(result.status,400);assert.equal(h.queued.length,0);assert.equal(h.single.length,0);assert.equal(h.fetches.length,0);assert.equal(h.calls.some(c=>['resolve','search'].includes(c[0])),false);}
});

test('minimal automatic POST persists adaptive options with eight authoritative sources and no fixed duration minimum', async () => {
  const h = harness(), result = await h.api.POST(request(automaticPayload)), data = await result.json();
  assert.equal(result.status, 201); assert.equal(data.clipCount, 8); assert.match(data.message, /8 related videos.*compact cuts.*modest speed-ups/);
  assert.equal(h.queued.length, 1); assert.equal(h.single.length, 0); assert.equal(h.fetches.length, 0);
  assert.deepEqual(h.calls[0], ['existing', automaticPayload.requestId]);
  assert.deepEqual(plain(h.queued[0].input), { requestId: automaticPayload.requestId, caption: '', theme: 'Sun City videos', maxDuration: 40,
    options: { audio: 'music', mood: 'journey', transition: 'cut', framing: 'auto', pacing: 'cinematic', musicVersion: 2, shotCadence: 'adaptive-v2', continuity: 'visual-v1', reusePolicy: 'four-in-18-months-v1', background: 'soft-v1' },
    managerGuidance: { revision: baselineGuidance.revision, feedbackCount: 0, rules: baselineGuidance.rules },
  });
  assert.deepEqual(plain(h.queued[0].downloads.map(shot => [shot.provider, shot.mediaId, shot.start, shot.end, shot.trimMode])), [
    ...[1, 2, 3, 4].map(id => ['pexels', String(id), 0, 40, 'auto']), ...[5, 6, 7, 8].map(id => ['pixabay', String(id), 0, 40, 'auto']),
  ]);
  const plan = editing.planStockIntervals(h.queued[0].downloads.map(shot => ({ duration: shot.end, ...shot })), 40, 'cinematic', undefined, h.queued[0].input.options.shotCadence);
  assert.ok(plan.at(-1).outputEnd >= 20 && plan.at(-1).outputEnd <= 32);
  assert.ok(plan.every(interval => interval.speed === 1), 'Unmeasured catalog previews do not authorize speed changes');
});

test('greenery focus is derived only from the resolved automatic starting source, not user-forged options', async () => {
  const h = harness({ resolve: async (provider, id) => video(id, 'lush green park path', { provider }),
    search: async provider => Array.from({ length: 8 }, (_, index) => video(index + 2, 'lush green park path', { provider })) });
  const result = await h.api.POST(request({ ...automaticPayload, query: 'Park', options: { sceneFocus: 'sky', background: 'none' } }));
  assert.equal(result.status, 201); assert.equal(h.queued[0].input.options.sceneFocus, 'greenery');
  assert.equal(h.queued[0].input.options.background, 'soft-v1');
  const manual = harness();
  const legacy = await manual.api.POST(request({ requestId: automaticPayload.requestId, theme: 'Sun City',
    shots: [{ provider: 'pexels', id: 1, start: 1, end: 10 }], options: { sceneFocus: 'greenery', background: 'soft-v1' } }));
  assert.equal(legacy.status, 201); assert.equal(manual.queued[0].input.options.sceneFocus, undefined);
  assert.equal(manual.queued[0].input.options.background, undefined, 'Internal automatic recipe markers cannot change a manual render');
});

test('automatic POST page stopping counts coherent usable companions against the resolved anchor, not raw cards', async () => {
  const h = harness({
    configured: { pexels: true, pixabay: false },
    resolve: async (provider, id) => video(id, 'horse grazing in a green meadow', { provider }),
    searchPool: async (provider, query, enough) => {
      assert.equal(provider, 'pexels'); assert.equal(query, 'meadow horse'); assert.equal(typeof enough, 'function');
      const unrelated = Array.from({ length: 12 }, (_, index) => video(index + 10, 'empty green meadow and grass'));
      const small = Array.from({ length: 12 }, (_, index) => video(index + 25, 'horse grazing in a green meadow', { width: 540, height: 960 }));
      const coherent = Array.from({ length: 9 }, (_, index) => video(index + 40, 'horse grazing in a green meadow'));
      assert.equal(enough(unrelated), false, 'Twelve portrait backgrounds cannot stop a horse search');
      assert.equal(enough(small), false, 'Twelve matching SD cards are not usable native720 sources');
      assert.equal(enough([...unrelated, ...small, ...coherent.slice(0, 8)]), false, 'The bounded search may continue until nine coherent companions');
      assert.equal(enough([...unrelated, ...small, ...coherent]), true);
      return [...unrelated, ...small, ...coherent];
    },
  });
  const response = await h.api.POST(request({ ...automaticPayload, query: 'Nature' }));
  assert.equal(response.status, 201); assert.equal(h.queued.length, 1); assert.equal(h.fetches.length, 0);
  assert.equal(h.queued[0].downloads[0].mediaId, '1', 'The resolved selected anchor stays first');
  assert.equal(h.queued[0].downloads.length, 8);
  assert.ok(h.queued[0].downloads.slice(1).every(source => Number(source.mediaId) >= 40));
});

test('automatic companion media stays lazy and uses bounded sequential stream factories in the existing reel queue', async () => {
  const h = harness({ openDownloads: true }), result = await h.api.POST(request(automaticPayload));
  assert.equal(result.status, 201); assert.equal(h.fetches.length, 8);
  assert.deepEqual(h.fetches.map(([url]) => url), [...[1, 2, 3, 4].map(id => `https://videos.pexels.com/fixture-${id}.mp4`), ...[5, 6, 7, 8].map(id => `https://cdn.pixabay.com/fixture-${id}.mp4`)]);
  for (const [, options] of h.fetches) { assert.equal(options.redirect, 'error'); assert.ok(options.signal); }
});

test('idempotent retry retains saved ambience and actual source count before preflight, search, resolution or download', async () => {
  const job = { id: 'already-queued', status: 'QUEUED', stockSource: { shots: [{ mediaId: '1' }, { mediaId: '2' }], options: { audio: 'ambience-music', mood: 'warm', transition: 'cut', framing: 'auto' } } };
  const h = harness({ existing: job, ffmpeg: false }), result = await h.api.POST(request(automaticPayload)), data = await result.json();
  assert.equal(result.status, 200); assert.equal(data.existing, true); assert.equal(data.clipCount, 2); assert.deepEqual(data.job, job);
  assert.match(data.message, /existing reel uses 2 related videos/);
  assert.equal(data.job.stockSource.options.audio, 'ambience-music');
  assert.doesNotMatch(data.message, /continuous original instrumental/);
  assert.deepEqual(h.calls, [['existing', automaticPayload.requestId]]); assert.equal(h.fetches.length, 0); assert.equal(h.queued.length, 0);
});

test('concurrent automatic requests share one lookup, preparation and download; a UUID owns its first recipe', async () => {
  const entered = deferred(), gate = deferred();
  const h = harness({ openDownloads: true, queue(downloads, input, job) { entered.resolve(job); return gate.promise; } });
  const first = h.api.POST(request(automaticPayload)), job = await entered.promise;
  const duplicate = h.api.POST(request(automaticPayload));
  const changedRecipe = h.api.POST(request({ ...automaticPayload, id: 999, query: 'Different City' }));
  await flush();
  assert.equal(h.calls.filter(call => call[0] === 'existing').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'preflight').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'history').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'search').length, 2);
  assert.equal(h.calls.filter(call => call[0] === 'resolve').length, 8);
  assert.equal(h.fetches.length, 8); assert.equal(h.queued.length, 1);
  gate.resolve(job);
  const responses = await Promise.all([first, duplicate, changedRecipe]);
  assert.deepEqual(responses.map(response => response.status), [201, 200, 200]);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(results.map(result => [result.job.id, result.clipCount, result.existing === true]), [
    ['fixture-reel', 8, false], ['fixture-reel', 8, true], ['fixture-reel', 8, true],
  ]);
  assert.equal(h.calls.some(call => call[0] === 'resolve' && call[2] === 999), false);
});

test('failed in-flight work is shared and cleared so the same UUID can retry a transient failure', async () => {
  const entered = deferred(), gate = deferred();
  let attempts = 0;
  const h = harness({ openDownloads: true, queue(downloads, input, job) {
    if (++attempts === 1) { entered.resolve(); return gate.promise; }
    return job;
  } });
  const first = h.api.POST(request(automaticPayload)); await entered.promise;
  const duplicate = h.api.POST(request(automaticPayload)); await flush();
  assert.equal(h.queued.length, 1); assert.equal(h.fetches.length, 8);
  gate.reject(new Error('Fixture interrupted download'));
  const failures = await Promise.all([first, duplicate]);
  assert.deepEqual(failures.map(response => response.status), [400, 400]);
  for (const response of failures) assert.match((await response.json()).error, /Fixture interrupted download/);
  const retry = await h.api.POST(request(automaticPayload)), data = await retry.json();
  assert.equal(retry.status, 201); assert.equal(data.clipCount, 8); assert.equal(attempts, 2);
  assert.equal(h.calls.filter(call => call[0] === 'existing').length, 2);
  assert.equal(h.queued.length, 2); assert.equal(h.fetches.length, 16);
});

test('successful single-flight work clears so later retries use saved-job lookup without downloading again', async () => {
  const options = { openDownloads: true, queue(downloads, input, job) { options.existing = job; return job; } };
  const h = harness(options), first = await h.api.POST(request(automaticPayload)), retry = await h.api.POST(request(automaticPayload));
  assert.equal(first.status, 201); assert.equal(retry.status, 200); assert.equal((await retry.json()).existing, true);
  assert.equal(h.calls.filter(call => call[0] === 'existing').length, 2);
  assert.equal(h.calls.filter(call => call[0] === 'preflight').length, 1);
  assert.equal(h.queued.length, 1); assert.equal(h.fetches.length, 8);
});

test('unrelated or too-short source sets fail before any stream opens or job is queued', async () => {
  for (const options of [
    { search: async () => [anchor, video(2, 'Other city')] },
    { resolve: async (provider, id) => video(id, 'Other city', { provider }) },
    { search: async () => [anchor, video(2), video(3)] },
    { openDownloads: true, search: async () => [video(2), video(3), video(4)],
      resolve: async (provider, id) => video(id, 'Sun City skyline', { provider, duration: 1.5 }) },
  ]) {
    const h = harness(options), result = await h.api.POST(request(automaticPayload)), data = await result.json();
    assert.equal(result.status, 400); assert.match(data.error, /Not enough related footage|meaningful source footage|starting video/);
    assert.equal(h.queued.length, 0); assert.equal(h.fetches.length, 0); assert.equal(h.single.length, 0);
  }
});

test('invalid automatic requests and cancelled IDs cannot bypass validation or revive removed jobs', async () => {
  for (const payload of [
    { ...automaticPayload, query: undefined }, { ...automaticPayload, provider: undefined },
    { ...automaticPayload, id: undefined }, { ...automaticPayload, query: ' ' },
    { ...automaticPayload, shots: [{ provider: 'pexels', id: 2, start: 0, end: 5 }] },
  ]) {
    const h = harness(), result = await h.api.POST(request(payload));
    assert.equal(result.status, 400); assert.equal(h.calls.length, 0); assert.equal(h.fetches.length, 0);
  }
  const h = harness({ cancelled: true }), result = await h.api.POST(request(automaticPayload));
  assert.equal(result.status, 409); assert.equal(h.queued.length, 0); assert.equal(h.calls.length, 1);
});

test('missing FFmpeg stops before catalog or media access', async () => {
  const h = harness({ ffmpeg: false }), result = await h.api.POST(request(automaticPayload));
  assert.equal(result.status, 503); assert.deepEqual(h.calls, [['existing', automaticPayload.requestId], ['preflight']]);
  assert.equal(h.fetches.length, 0); assert.equal(h.queued.length, 0);
});

test('failed preflight clears the in-flight promise before retry', async () => {
  const options = { ffmpeg: false }, h = harness(options);
  assert.equal((await h.api.POST(request(automaticPayload))).status, 503);
  options.ffmpeg = true;
  assert.equal((await h.api.POST(request(automaticPayload))).status, 201);
  assert.equal(h.calls.filter(call => call[0] === 'existing').length, 2);
  assert.equal(h.calls.filter(call => call[0] === 'preflight').length, 2);
  assert.equal(h.queued.length, 1);
});

test('legacy manual sequences retain exact trims, caption, options and endpoint behavior', async () => {
  const h = harness(), options = { audio: 'original', mood: 'warm', transition: 'soft', framing: 'fit', pacing: 'selected' };
  const result = await h.api.POST(request({ requestId: automaticPayload.requestId, caption: 'Owner posting text', theme: 'Sun City', duration: 60, options,
    shots: [{ provider: 'pexels', id: 1, start: 2, end: 8, trimMode: 'manual' }, { provider: 'pixabay', id: 2, start: 3, end: 9, trimMode: 'manual' }],
  }));
  assert.equal(result.status, 201); assert.equal(h.queued.length, 1); assert.equal(h.single.length, 0);
  assert.deepEqual(plain(h.queued[0].input), { requestId: automaticPayload.requestId, caption: 'Owner posting text', theme: 'Sun City', maxDuration: 60, options });
  assert.deepEqual(plain(h.queued[0].downloads.map(shot => [shot.start, shot.end, shot.trimMode])), [[2, 8, 'manual'], [3, 9, 'manual']]);
  assert.equal(h.calls.filter(call => call[0] === 'search').length, 0);
});

test('legacy provider/id requests remain single-source uploads and ordinary GET remains compatible', async () => {
  const h = harness(), result = await h.api.POST(request({ provider: 'pexels', id: 1, requestId: automaticPayload.requestId }));
  assert.equal(result.status, 201); assert.equal(h.queued.length, 0); assert.equal(h.single.length, 1); assert.equal(h.fetches.length, 1);
  const get = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&provider=pexels')), data = await get.json();
  assert.equal(get.status, 200); assert.equal(data.videos.length, 4); assert.equal(data.query, 'Sun City'); assert.deepEqual(data.errors, []);
});

test('GET automatic=true offers only eligible starting sources while ordinary GET stays unchanged', async () => {
  const fixtures = [anchor, video(2, 'Sun City gardens'), video(3, 'Another city'), video(4, 'Pexels footage'),
    video(5, 'Sun City animation'), video(6, 'Sun City skyline', { duration: .5 }), video(7, 'Sun City skyline', { width: 0 }), video(8, 'Sun City slow motion skyline')];
  const h = harness({ search: async () => fixtures });
  const ordinary = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&provider=pexels'));
  assert.equal(ordinary.status, 200); assert.equal((await ordinary.json()).videos.length, fixtures.length);
  const automaticResult = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&provider=pexels&automatic=true'));
  const data = await automaticResult.json();
  assert.equal(automaticResult.status, 200); assert.deepEqual(identities(data.videos), ['pexels:1', 'pexels:2']);
  assert.deepEqual(data.errors, []); assert.equal(data.query, 'Sun City');
  assert.equal(h.queued.length, 0); assert.equal(h.single.length, 0); assert.equal(h.fetches.length, 0);
});

test('new automatic API recipes use local recent-completion history while saved UUID and manual requests bypass it', async () => {
  const history = [{ status: 'COMPLETED', finishedAt: '2026-10-08T00:00:00.000Z', stockSource: { shots: [1, 2, 3, 4].map(id => ({ provider: 'pexels', mediaId: String(id) })) } }];
  const h = harness({ history }), result = await h.api.POST(request(automaticPayload));
  assert.equal(result.status, 201); assert.equal(h.calls.filter(call => call[0] === 'history').length, 1);
  assert.deepEqual(plain(h.queued[0].downloads.slice(0, 5).map(item => [item.provider, item.mediaId])), [['pexels', '1'], ...[5, 6, 7, 8].map(id => ['pixabay', String(id)])]);
  assert.equal(h.queued[0].input.options.audio, 'music');
  assert.equal(h.calls.filter(call => call[0] === 'search').length, 2); assert.equal(h.fetches.length, 0);
  const saved = harness({ existing: { id: 'saved-job', stockSource: { shots: [{}, {}] } }, history });
  assert.equal((await saved.api.POST(request(automaticPayload))).status, 200);
  assert.deepEqual(saved.calls, [['existing', automaticPayload.requestId]]);
  const manual = harness({ history });
  await manual.api.POST(request({ provider: 'pexels', id: 1, requestId: automaticPayload.requestId }));
  assert.equal(manual.calls.filter(call => call[0] === 'history').length, 0);
});

test('structured source feedback expands recent-history preference and snapshots only fixed rules in the new recipe', async () => {
  const history=Array.from({length:11},(_,index)=>({status:'COMPLETED',finishedAt:new Date(Date.UTC(2026,9,8,0,index)).toISOString(),stockSource:{shots:[{provider:'pexels',mediaId:String(index===0?2:100+index)},{provider:'pexels',mediaId:String(200+index)}]}}));
  const actual={revision:'stock-v1-fedcba654321',feedbackCount:1,rules:['Prefer fresh related sources.'],historyLimit:20,shorterPostingCaption:true};
  const h=harness({history,guidance:actual}),result=await h.api.POST(request(automaticPayload));
  assert.equal(result.status,201);
  assert.deepEqual(plain(h.queued[0].input.managerGuidance),{revision:actual.revision,feedbackCount:1,rules:actual.rules});
  assert.equal(h.queued[0].downloads[0].mediaId,'1','The chosen anchor is retained');
  assert.equal(h.queued[0].downloads[1].mediaId,'3','The eleventh recent recipe is considered only with feedback-expanded history');
  const normal=harness({history});await normal.api.POST(request(automaticPayload));
  assert.equal(normal.queued[0].downloads[1].mediaId,'2','Without source feedback the original ten-recipe window remains');
  const saved=harness({existing:{id:'kept',stockSource:{shots:[{},{}]}},guidanceError:'Should not read feedback'});
  assert.equal((await saved.api.POST(request(automaticPayload))).status,200);
  assert.equal(saved.calls.filter(call=>call[0]==='guidance').length,0);
});

test('broken source-feedback storage blocks new automatic planning before catalog/media work, but not saved or manual recipes', async () => {
  const h=harness({guidanceError:'Saved manager feedback is invalid; repair before a new automatic reel.'}),result=await h.api.POST(request(automaticPayload));
  assert.equal(result.status,400);assert.match((await result.json()).error,/repair before/);
  assert.equal(h.calls.filter(call=>['resolve','search','history','queue'].includes(call[0])).length,0);
  assert.equal(h.fetches.length,0);
  const manual=harness({guidanceError:'Must not read manual feedback'});
  const output=await manual.api.POST(request({requestId:automaticPayload.requestId,provider:'pexels',id:1}));
  assert.equal(output.status,201);assert.equal(manual.calls.filter(call=>call[0]==='guidance').length,0);
});

test('automatic API rejects a downgraded native source with an actionable quality error before search, stream download or queue', async () => {
  const h = harness({ resolve: async (provider, id) => video(id, 'Sun City skyline', { provider, width: 540, height: 960 }) });
  const response = await h.api.POST(request(automaticPayload)), data = await response.json();
  assert.equal(response.status, 400); assert.match(data.error, /native 720p/); assert.equal(h.fetches.length, 0); assert.equal(h.queued.length, 0);
  assert.equal(h.calls.filter(call => call[0] === 'search').length, 0);
});

test('paged discovery checks one page per configured provider sequentially and returns only eligible related cards', async () => {
  let active = 0; const seen = [];
  const h = harness({ searchPage: async (provider, query, page) => {
    assert.equal(active++, 0, 'The next provider waits for the previous metadata page'); seen.push([provider, query, page]);
    await Promise.resolve(); active--;
    return { videos: [video(page, 'Sun City skyline', { provider }), video(99, 'Unrelated beach', { provider })], hasMore: true };
  } });
  const response = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&automatic=true&browse=true'));
  const data = await response.json(); assert.equal(response.status, 200);
  assert.deepEqual(seen, [['pexels', 'Sun City', 1], ['pixabay', 'Sun City', 1]]);
  assert.deepEqual(identities(data.videos), ['pexels:1', 'pixabay:1']);
  assert.deepEqual(JSON.parse(data.pagination.cursor), { pexels: 2, pixabay: 2, limited: false });
  assert.equal(data.pagination.partial, false); assert.equal(h.queued.length, 0); assert.equal(h.fetches.length, 0);
});

test('a cursor advances only its available provider and does not refetch exhausted pages', async () => {
  const h = harness(), cursor = JSON.stringify({ pexels: 2, pixabay: null, limited: false });
  const response = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&browse=true&cursor=' + encodeURIComponent(cursor)));
  const data = await response.json();
  assert.deepEqual(h.calls, [['page', 'pexels', 'Sun City', 2]]);
  assert.deepEqual(JSON.parse(data.pagination.cursor), { pexels: 3, pixabay: null, limited: false });
});

test('partial provider failure retains its exact page while successful metadata moves forward', async () => {
  const h = harness({ searchPage: async provider => {
    if (provider === 'pixabay') throw new Error('Pixabay fixture free quota exhausted');
    return { videos: [anchor], hasMore: true };
  } });
  const response = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&browse=true'));
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.pagination.partial, true);
  assert.deepEqual(data.errors, ['Pixabay fixture free quota exhausted']); assert.equal(data.videos.length, 1);
  assert.deepEqual(JSON.parse(data.pagination.cursor), { pexels: 2, pixabay: 1, limited: false });
  assert.equal(h.fetches.length, 0); assert.equal(h.queued.length, 0);
});

test('provider exhaustion and the three-page browsing bound are different, explicit states', async () => {
  for (const hasMore of [true, false]) {
    const h = harness({ searchPage: async () => ({ videos: [anchor], hasMore }) });
    const cursor = JSON.stringify({ pexels: 3, pixabay: null, limited: false });
    const response = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&browse=true&cursor=' + encodeURIComponent(cursor)));
    const data = await response.json(); assert.equal(data.pagination.cursor, null); assert.equal(data.pagination.limited, hasMore);
    assert.deepEqual(h.calls, [['page', 'pexels', 'Sun City', 3]]);
  }
});

test('malformed or out-of-bound cursors are rejected before catalog or media work', async () => {
  for (const cursor of ['{broken', 'x'.repeat(161), JSON.stringify({ pexels: 4, pixabay: 1 }),
    JSON.stringify({ pexels: 0, pixabay: 1 }), JSON.stringify({ pexels: 1.5, pixabay: 1 }),
    JSON.stringify({ pexels: 1, pixabay: 1, url: 'https://evil.test/' })]) {
    const h = harness(), response = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&browse=true&cursor=' + encodeURIComponent(cursor)));
    assert.equal(response.status, 400); assert.equal(h.calls.length, 0); assert.equal(h.fetches.length, 0);
  }
});

test('unconfigured discovery and exhausted cursors remain inert and do not invent choices', async () => {
  const h = harness({ configured: { pexels: false, pixabay: false } });
  const response = await h.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&browse=true'));
  const data = await response.json(); assert.equal(data.videos.length, 0); assert.equal(data.pagination.cursor, null);
  assert.deepEqual(data.configured, { pexels: false, pixabay: false }); assert.equal(h.calls.length, 0);
  const ready = harness(), cursor = JSON.stringify({ pexels: null, pixabay: null, limited: false });
  await ready.api.GET(new Request('http://localhost/api/stock-reels?q=Sun%20City&browse=true&cursor=' + encodeURIComponent(cursor)));
  assert.equal(ready.calls.length, 0); assert.equal(ready.queued.length, 0);
});
