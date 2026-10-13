const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/components/InstagramPerformance.tsx');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' || !tree.props ? [] : [tree, ...nodes(tree.props.children)];
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, async json() { return value; } });
const video = (number, extra = {}) => ({ id: `video-${number}`, caption: `Video ${number}`, timestamp: `2026-10-${String(number).padStart(2, '0')}T10:00:00Z`, mediaProductType: 'REELS', permalink: `https://www.instagram.com/reel/fixture_${number}/`, metrics: { views: 1000, likes: 50, comments: 2, saves: 4, shares: 5, reach: 900, averageWatchTimeMs: 8500, totalWatchTimeMs: 850000 }, ...extra });
const state = (videos = Array.from({ length: 10 }, (_, index) => video(index + 1)), extra = {}) => ({ version: 1, account: { id: 'fixture-account', name: '@fixture', connectionRevision: 'fixture' }, status: 'ready', detail: 'Saved public results are ready.', lastSuccessfulSyncAt: '2026-10-13T10:00:00Z', nextSyncAt: '2026-10-13T11:00:00Z', videos, scannedVideos: videos.length, historyComplete: true, summary: { revision: 'fixture', evaluatedAt: '2026-10-13T10:00:00Z', eligibleCount: videos.length, assessments: videos.map(item => ({ videoId: item.id, label: 'stronger', reason: 'Above the comparable account baseline; this does not prove a cause.', likeRate: 0.05, engagementRate: 0.06, baselineEngagementRate: 0.02, peerCount: 5 })), rules: ['Use calm coastal topics as an experiment, not a guaranteed winner.'], topicPreferences: [] }, ...extra });

// Inert JSX and mocked cache endpoints only; no credential, Meta request,
// browser, owner data, video decoder or model is loaded.
function harness(options = {}) {
  let index = 0, tree, clock = 0, nextTimer = 1, hidden = false;
  const slots = [], effectSlots = [], pending = [], requests = [], intervals = new Map(), timeouts = new Map(), listeners = new Map();
  const hooks = {
    useState(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
    useRef(initial) { const at = index++; return slots[at] ||= { current: initial }; },
    useCallback(callback, dependencies) { const at = index++, old = slots[at]; if (!old || dependencies.some((value, offset) => !Object.is(value, old.dependencies[offset]))) slots[at] = { callback, dependencies }; return slots[at].callback; },
    useEffect(callback, dependencies) { const at = index++, old = effectSlots[at]; if (!old || dependencies.some((value, offset) => !Object.is(value, old.dependencies[offset]))) { old?.cleanup?.(); effectSlots[at] = { callback, dependencies }; pending.push(() => { effectSlots[at].cleanup = callback(); }); } },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('Fragment') } };
  const compiledModule = { exports: {} };
  class ClockDate extends Date { static now() { return clock; } }
  new vm.Script(source, { filename }).runInNewContext({ module: compiledModule, exports: compiledModule.exports, Date: ClockDate, URL, AbortController,
    document: { get hidden() { return hidden; }, addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); } },
    setInterval(callback, delay) { const id = nextTimer++; intervals.set(id, { callback, delay }); return id; }, clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, delay) { const id = nextTimer++; timeouts.set(id, { callback, delay }); return id; }, clearTimeout(id) { timeouts.delete(id); },
    async fetch(url, init = {}) { assert.equal(url, '/api/instagram-performance'); const request = { url, ...init }; requests.push(request); return options.fetch ? options.fetch(request) : response(state()); },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected UI import: ${name}`); return dependencies[name]; },
  }, { timeout: 1000 });
  function render() { index = 0; tree = compiledModule.exports.default(); while (pending.length) pending.shift()(); return tree; }
  async function settle() { for (let pass = 0; pass < 15; pass++) { await Promise.resolve(); render(); } return tree; }
  const find = (type, match) => nodes(tree).find(node => node.type === type && (typeof match === 'function' ? match(node) : text(node) === match));
  render();
  return { render, settle, find, all: type => nodes(tree).filter(node => node.type === type), requests, intervals, timeouts, tree: () => tree,
    tick(milliseconds) { clock += milliseconds; for (const { callback } of intervals.values()) callback(); },
    visible(value) { hidden = !value; listeners.get('visibilitychange')?.(); },
    unmount() { effectSlots.forEach(slot => slot?.cleanup?.()); },
    replayEffect() { effectSlots.forEach(slot => { if (slot) { slot.cleanup?.(); slot.cleanup = slot.callback(); } }); },
  };
}

test('results remain compact, newest first, with eight rows and working pagination', async () => {
  const ui = harness(); await ui.settle();
  assert.equal(ui.all('details')[0].props.open, undefined);
  assert.equal(ui.all('tbody')[0].props.children.length, 8);
  assert.equal(text(ui.all('tbody')[0].props.children[0]).startsWith('Video 10'), true);
  assert.equal(ui.find('button', 'Previous').props.disabled, true);
  ui.find('button', 'Next').props.onClick(); ui.render();
  assert.equal(ui.all('tbody')[0].props.children.length, 2);
  assert.equal(ui.find('button', 'Next').props.disabled, true);
  assert.match(text(ui.tree()), /Page 2 of 2/);
  ui.find('button', 'Previous').props.onClick(); ui.render();
  assert.match(text(ui.tree()), /Page 1 of 2/);
  assert.match(text(ui.tree()), /What the manager learned/);
  assert.match(text(ui.tree()), /do not prove why a video worked or guarantee growth/);
  assert.equal(ui.all('video').length, 0); assert.equal(ui.all('img').length, 0);
});

test('missing values remain unavailable while real zero is zero and watch time converts milliseconds', async () => {
  const sample = video(1, { metrics: { views: null, likes: 0, comments: null, shares: 0, saves: -1, reach: NaN, averageWatchTimeMs: 8500 } });
  const ui = harness({ fetch: () => response(state([sample])) }); await ui.settle();
  const cells = ui.all('td'); assert.equal(text(cells[0]), '—'); assert.equal(text(cells[1]), '0');
  assert.match(text(ui.tree()), /Average watch time: 8\.5s/);
  assert.match(text(ui.tree()), /Saves: —/); assert.match(text(ui.tree()), /Reach: —/);
  assert.match(text(ui.tree()), /Missing metrics mean unavailable, not zero/);
});

test('missing permission tells the owner exactly what to reconnect without claiming live analytics', async () => {
  const ui = harness({ fetch: () => response(state([], { status: 'permission_required', detail: 'Publishing still works, but account insights permission is missing.', lastSuccessfulSyncAt: undefined, historyComplete: false })) });
  await ui.settle();
  assert.match(text(ui.tree()), /Insights permission needed/); assert.match(text(ui.tree()), /instagram_manage_insights/);
  assert.match(text(ui.tree()), /keeping your existing publishing permissions/);
  assert.equal(ui.find('a', 'Reconnect Instagram in Settings').props.href, '/dashboard#settings');
  assert.match(text(ui.tree()), /Last successful sync: Not yet/);
  assert.match(text(ui.tree()), /available history is not fully collected yet/);
  assert.doesNotMatch(text(ui.tree()), /older available history is still being collected/);
  assert.doesNotMatch(text(ui.tree()), /Results saved/);
});

test('a video outside the bounded comparison set retains its real metrics without an unavailable claim', async () => {
  const data = state([video(1)]); data.summary.assessments = [];
  const ui = harness({ fetch: () => response(data) }); await ui.settle();
  assert.match(text(ui.tree()), /Not compared/); assert.match(text(ui.tree()), /outside the current comparison set/);
  assert.equal(text(ui.all('td')[1]), '50'); assert.doesNotMatch(text(ui.tree()), /Metrics unavailable/);
});

test('only official HTTPS Instagram media permalinks are linked', async () => {
  const invalid = ['https://instagram.com.evil.test/reel/x/', 'https://evil.test/reel/x/', 'javascript:alert(1)', 'http://instagram.com/reel/x/', 'https://user:password@instagram.com/reel/x/', 'https://www.instagram.com/accounts/login/', 'https://www.instagram.com/reel/x/../../accounts/login/'];
  const ui = harness({ fetch: () => response(state([video(1, { permalink: 'https://www.instagram.com/reel/safe/?token=not-real#private' }), ...invalid.map((permalink, index) => video(index + 2, { permalink }))])) });
  await ui.settle();
  const links = ui.all('a'); assert.equal(links.length, 1);
  assert.equal(links[0].props.href, 'https://www.instagram.com/reel/safe/'); assert.equal(links[0].props.rel, 'noreferrer');
});

test('refresh requests only insights collection and blocks overlapping requests', async () => {
  let resolveRefresh;
  const ui = harness({ fetch: request => request.method ? new Promise(resolve => { resolveRefresh = resolve; }) : response(state()) });
  await ui.settle();
  const refresh = ui.find('button', 'Refresh insights'); refresh.props.onClick(); refresh.props.onClick(); ui.render();
  assert.equal(ui.requests.length, 2); assert.equal(ui.requests[1].method, 'POST');
  assert.deepEqual(JSON.parse(ui.requests[1].body), { action: 'refresh' });
  assert.equal(ui.find('button', 'Checking…').props.disabled, true);
  assert.equal(ui.requests.some(request => /publish|render|generation/.test(request.url)), false);
  ui.tick(60_000); assert.equal(ui.requests.length, 2);
  resolveRefresh(response(state())); await ui.settle();
  assert.equal(ui.find('button', 'Refresh insights').props.disabled, false);
});

test('cached reads poll at most once per minute and pause while hidden', async () => {
  const ui = harness(); await ui.settle();
  assert.equal(ui.intervals.size, 1); assert.equal([...ui.intervals.values()][0].delay, 60_000);
  ui.tick(59_000); await ui.settle(); assert.equal(ui.requests.length, 1);
  ui.tick(1_000); await ui.settle(); assert.equal(ui.requests.length, 2);
  ui.visible(false); ui.tick(120_000); await ui.settle(); assert.equal(ui.requests.length, 2);
  ui.visible(true); await ui.settle(); assert.equal(ui.requests.length, 3);
  ui.visible(false); ui.visible(true); await ui.settle(); assert.equal(ui.requests.length, 3);
  assert.ok(ui.requests.every(request => request.method === undefined && request.cache === 'no-store'));
});

test('failed reads keep previously saved results and show an actionable error', async () => {
  let count = 0;
  const ui = harness({ fetch: () => ++count === 1 ? response(state([video(1)])) : response({ error: 'Meta quota is exhausted; the saved results are retained.' }, 429) });
  await ui.settle(); ui.find('button', 'Refresh insights').props.onClick(); await ui.settle();
  assert.equal(ui.find('a', 'Video 1').props.href, 'https://www.instagram.com/reel/fixture_1/');
  const error = ui.find('p', 'Meta quota is exhausted; the saved results are retained.'); assert.equal(error.props.role, 'alert');
  assert.equal(ui.find('button', 'Refresh insights').props.disabled, false);
});

test('unreadable responses are not installed over cached results', async () => {
  let count = 0;
  const ui = harness({ fetch: () => response(++count === 1 ? state([video(1)]) : { videos: [] }) });
  await ui.settle(); ui.find('button', 'Refresh insights').props.onClick(); await ui.settle();
  assert.match(text(ui.tree()), /Instagram returned unreadable results/); assert.ok(ui.find('a', 'Video 1'));
});

test('unmount cancels requests, timers and visible-page listeners without installing late results', async () => {
  let resolve;
  const ui = harness({ fetch: () => new Promise(done => { resolve = done; }) });
  assert.equal(ui.requests.length, 1); const signal = ui.requests[0].signal;
  ui.unmount(); assert.equal(signal.aborted, true); assert.equal(ui.intervals.size, 0);
  ui.visible(false); ui.visible(true); assert.equal(ui.requests.length, 1);
  resolve(response(state([video(1)]))); await ui.settle();
  assert.equal(ui.find('a', 'Video 1'), undefined); assert.equal(ui.timeouts.size, 0);
});

test('strict-effect replay aborts the older read and cannot replace newer results', async () => {
  const resolvers = [];
  const ui = harness({ fetch: () => new Promise(resolve => resolvers.push(resolve)) });
  ui.replayEffect(); assert.equal(ui.requests.length, 2); assert.equal(ui.requests[0].signal.aborted, true);
  resolvers[1](response(state([video(2)]))); await ui.settle();
  resolvers[0](response(state([video(1)]))); await ui.settle();
  assert.ok(ui.find('a', 'Video 2')); assert.equal(ui.find('a', 'Video 1'), undefined);
  assert.equal(ui.intervals.size, 1);
});

test('the 15-second request timeout exposes a cause while allowing another explicit check', async () => {
  const ui = harness({ fetch: request => new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  assert.equal([...ui.timeouts.values()][0].delay, 15_000);
  [...ui.timeouts.values()][0].callback(); await ui.settle();
  assert.match(text(ui.tree()), /results request timed out/); assert.equal(ui.find('button', 'Refresh insights').props.disabled, false);
  ui.find('button', 'Refresh insights').props.onClick(); ui.render(); assert.equal(ui.requests.length, 2);
  ui.unmount(); await ui.settle();
});

test('refresh allows a bounded collection turn and a timeout does not claim the manager stopped', async () => {
  const ui = harness({ fetch: request => request.method === 'POST'
    ? new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    : response(state()) });
  await ui.settle(); ui.find('button', 'Refresh insights').props.onClick(); ui.render();
  assert.equal([...ui.timeouts.values()][0].delay, 120_000);
  [...ui.timeouts.values()][0].callback(); await ui.settle();
  assert.match(text(ui.tree()), /Collection can continue in the manager/);
  assert.match(text(ui.tree()), /saved results remain available/);
  assert.equal(ui.find('button', 'Refresh insights').props.disabled, false);
});
