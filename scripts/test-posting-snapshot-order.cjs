const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const Module = require('node:module');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });

// Isolated real-component handler tests. No local server, media, provider or timer runs.
let currentHarness;
const react = require('react'), originalLoad = Module._load;
Module._load = function (name, parent, ...args) {
  if (name === 'react' && parent?.filename.endsWith(`${path.sep}PostingActions.tsx`)) return {
    ...react, useState: initial => currentHarness.state(initial),
    useRef: initial => currentHarness.ref(initial), useEffect: (effect, deps) => currentHarness.effect(effect, deps),
  };
  return originalLoad.call(this, name, parent, ...args);
};
let PostingActions;
try { PostingActions = require('../src/components/PostingActions').default; }
finally { Module._load = originalLoad; }

const epoch = Date.now() - 60_000, stamp = offset => new Date(epoch + offset * 1000).toISOString();
function fixture(fileTime = 0, status, analysisTime = fileTime, copy = 'Draft stream caption', tags = ['#Stream']) {
  return {
    id: 'output-1', title: 'Woodland stream', createdAt: stamp(0), updatedAt: stamp(fileTime), status: 'READY', audience: 'general',
    source: { kind: 'pexels', filename: 'shot-1-pexels-41.mp4', licence: 'Pexels License' }, targets: ['instagram'],
    outputs: { instagram: { filename: 'output-1.mp4', duration: 45, width: 720, height: 1280 } },
    quality: { audio: 'natural-audio-preserved', captions: [], checks: [], postCopy: copy, hashtags: tags,
      postingAnalysis: status ? { status, updatedAt: stamp(analysisTime), attempts: 1, detail: `${status} evidence` } : undefined },
  };
}
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(node, predicate, result = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, result));
  else if (node && typeof node === 'object') { if (predicate(node)) result.push(node); nodes(node.props?.children, predicate, result); }
  return result;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(t, initial, fetchResponse = async () => { throw new Error('Unexpected isolated request'); }) {
  const old = { fetch: global.fetch, document: global.document, setInterval: global.setInterval, clearInterval: global.clearInterval };
  const hooks = [], intervals = new Map(), requests = [];
  let position = 0, timerId = 0, tree, dirty = true, pending = [], supplied = initial;
  const h = {
    state(initial) {
      const index = position++;
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, update => { const next = typeof update === 'function' ? update(hooks[index].value) : update; if (next !== hooks[index].value) { hooks[index].value = next; dirty = true; } }];
    },
    ref(initial) { const index = position++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    effect(effect, deps) {
      const index = position++, previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks[index] = { deps, cleanup: previous?.cleanup };
        pending.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); });
      }
    },
    render() { position = 0; dirty = false; currentHarness = h; tree = PostingActions({ file: supplied }); const effects = pending; pending = []; effects.forEach(effect => effect()); },
    async flush() { for (let i = 0; i < 30; i++) { if (dirty) h.render(); await Promise.resolve(); } },
    async supply(file) { supplied = file; dirty = true; await h.flush(); },
    async tick() { for (const interval of [...intervals.values()]) interval(); await h.flush(); },
    button(label) { const found = nodes(tree, node => node.type === 'button' && text(node) === label); assert.equal(found.length, 1, label); return found[0]; },
    async click(label) { const button = h.button(label); assert.equal(!!button.props.disabled, false); button.props.onClick(); await h.flush(); },
    get text() { return text(tree); }, get tree() { return tree; }, requests,
  };
  global.document = { hidden: false };
  global.setInterval = callback => { const key = ++timerId; intervals.set(key, callback); return key; };
  global.clearInterval = key => intervals.delete(key);
  global.fetch = (url, init = {}) => { requests.push({ url, ...init }); return fetchResponse(url, init); };
  t.after(() => { hooks.forEach(hook => hook.cleanup?.()); Object.assign(global, old); currentHarness = undefined; });
  return h;
}

test('queued POST survives an older dashboard snapshot and keeps polling enabled', async t => {
  const baseline = fixture(), queued = fixture(0, 'QUEUED', 2);
  const h = harness(t, baseline, async (_url, init) => { assert.equal(init.method, 'POST'); return Response.json(queued); });
  await h.flush(); await h.click('Analyze video for posting copy');
  assert.match(h.text, /QUEUED: QUEUED evidence/);
  await h.supply(structuredClone(baseline));
  assert.match(h.text, /QUEUED: QUEUED evidence/);
  assert.equal(h.button('Analyze video for posting copy').props.disabled, true);
});

test('delayed GET cannot downgrade a newer queued snapshot with the same file timestamp', async t => {
  const response = deferred(), h = harness(t, fixture(0, 'QUEUED', 1), () => response.promise);
  await h.flush(); await h.tick(); assert.equal(h.requests.length, 1);
  await h.supply(fixture(0, 'QUEUED', 3, 'Current caption', ['#CurrentStream']));
  response.resolve(Response.json(fixture(0, 'QUEUED', 1, 'Obsolete caption', ['#Obsolete']))); await h.flush();
  assert.match(h.text, /Current caption/); assert.match(h.text, /#CurrentStream/);
  assert.doesNotMatch(h.text, /Obsolete/);
});

test('completed copy and hashtags survive older dashboard data and are copied together', async t => {
  const h = harness(t, fixture(0, 'ANALYZING', 1)); await h.flush();
  const completed = fixture(3, 'COMPLETE', 3, 'Water flows between moss-covered stones.', ['#ForestStream', '#Moss']);
  completed.quality.postingAnalysis.hashtagActivity={status:'LIMITED',checkedAt:stamp(3),detail:'No verified global trends.',samples:[]};
  await h.supply(completed); await h.supply(fixture(0, 'WAITING', 2));
  assert.match(h.text, /Video-specific copy: COMPLETE evidence/);
  assert.match(h.text, /Water flows between moss-covered stones\./); assert.match(h.text, /#ForestStream #Moss/);
  assert.match(h.text, /No verified global trends/);
  assert.equal(h.button('Re-analyze this video').props.disabled, false);
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator'); let copied;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  t.after(() => { if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor); else delete global.navigator; });
  await h.click('Copy caption + hashtags');
  assert.equal(copied, 'Water flows between moss-covered stones.\n\n#ForestStream #Moss');
});

test('the main copy action keeps the complete bank while platform-specific controls move to the publisher',async t=>{
  const tags=Array.from({length:20},(_,index)=>`#Stream${index}`);
  const h=harness(t,fixture(0,'COMPLETE',0,'A stream flows over rocks.',tags));await h.flush();
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(global,'navigator'),copies=[];
  Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>copies.push(value)}}});
  t.after(()=>{if(navigatorDescriptor)Object.defineProperty(global,'navigator',navigatorDescriptor);else delete global.navigator;});
  assert.equal(nodes(h.tree,node=>node.type==='button'&&/Copy (Instagram|YouTube) text/.test(text(node))).length,0);
  await h.click('Copy caption + hashtags');assert.equal((copies[0].match(/#Stream\d+/g)||[]).length,20);
  await h.supply(fixture(5,undefined,5,'Owner caption #one #two #three #four #five ＃six',tags));
  await h.click('Copy caption + hashtags');assert.equal(copies.length,2);
  assert.match(copies[1],/Owner caption #one #two #three #four #five ＃six/);
  assert.match(h.text,/Owner caption #one #two #three #four #five ＃six/);
});

test('newer owner copy/reset overrides old analysis and cannot be undone by a delayed snapshot', async t => {
  const complete = fixture(3, 'COMPLETE', 3, 'Automatic caption', ['#Automatic']);
  const owner = fixture(5, undefined, 5, 'My revised posting caption', ['#OwnerChoice']);
  const h = harness(t, complete); await h.flush(); await h.supply(owner); await h.supply(structuredClone(complete));
  assert.match(h.text, /My revised posting caption/); assert.match(h.text, /#OwnerChoice/);
  assert.match(h.text, /Draft posting text/); assert.doesNotMatch(h.text, /Automatic caption/);
  assert.equal(h.button('Analyze video for posting copy').props.disabled, false);
});

test('new analysis updates posting fields without reverting newer file metadata', async t => {
  const owner = fixture(2, 'QUEUED', 1); owner.title = 'Owner corrected title';
  const h = harness(t, owner); await h.flush();
  await h.supply(fixture(0, 'COMPLETE', 4, 'Specific verified stream caption', ['#StreamEvidence']));
  assert.match(h.tree.props['aria-label'], /Owner corrected title/);
  assert.match(h.text, /Specific verified stream caption/); assert.match(h.text, /#StreamEvidence/);
});

test('invalid and far-future dates cannot pin stale posting data', async t => {
  const h = harness(t, fixture(3, 'COMPLETE', 3, 'Current verified caption', ['#Current'])); await h.flush();
  for (const date of ['not-a-date', new Date(Date.now() + 86400000).toISOString()]) {
    const stale = fixture(0, 'QUEUED', 0, 'Corrupt stale caption', ['#Stale']); stale.updatedAt = date; stale.quality.postingAnalysis.updatedAt = date;
    await h.supply(stale); assert.match(h.text, /Current verified caption/); assert.doesNotMatch(h.text, /Corrupt stale caption/);
  }
});

test('switching output IDs accepts the new file and ignores the old pending poll', async t => {
  const response = deferred(), h = harness(t, fixture(0, 'QUEUED', 1), () => response.promise);
  await h.flush(); await h.tick();
  const replacement = fixture(0, undefined, 0, 'Caption for another output', ['#Another']); replacement.id = 'output-2'; replacement.title = 'Another output';
  await h.supply(replacement); response.resolve(Response.json(fixture(5, 'COMPLETE', 5, 'Wrong old output', ['#Wrong']))); await h.flush();
  assert.match(h.tree.props['aria-label'], /Another output/); assert.match(h.text, /Caption for another output/);
  assert.doesNotMatch(h.text, /Wrong old output/);
});

test('missing automatic analysis polls saved results without submitting a reanalysis request', async t => {
  const completed = fixture(3, 'COMPLETE', 3, 'Light catches the moss beside this stream.', ['#MossyStream']);
  const h = harness(t, fixture(), async (_url, init) => { assert.equal(init.method, undefined); return Response.json(completed); });
  await h.flush(); assert.match(h.text, /prepared automatically/); assert.equal(h.requests.length, 0);
  await h.tick(); assert.equal(h.requests.length, 1); assert.match(h.text, /Light catches the moss/);
  await h.tick(); assert.equal(h.requests.length, 1, 'Completed evidence stops polling');
});

test('owner text and conservatively retained legacy edits do not poll or requeue automatically', async t => {
  const owner = fixture(); owner.quality.postingTextOrigin = 'owner';
  const h = harness(t, owner); await h.flush(); await h.tick(); assert.equal(h.requests.length, 0);
  assert.match(h.text, /Owner-edited posting text is retained/);
  const legacy = fixture(); legacy.editedFrom = 'legacy-parent'; await h.supply(legacy); await h.tick(); assert.equal(h.requests.length, 0);
});
