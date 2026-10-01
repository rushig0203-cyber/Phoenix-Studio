const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });
const { DASHBOARD_ENDPOINTS, MonitorFailure, dashboardMonitorReport, fetchDashboardSnapshot, startDashboardPolling } = require('../src/lib/dashboardMonitor');

test('six network failures produce one offline report while HTTP failures remain a partial service error', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const report = dashboardMonitorReport(await fetchDashboardSnapshot(new AbortController().signal));
  assert.equal(report.offline, true); assert.equal(report.message, 'Phoenix connection is unavailable.');
  assert.doesNotMatch(report.message, /Failed to fetch/);
  global.fetch = async endpoint => endpoint === '/api/review-edits' ? new Response('', { status: 503 }) : Response.json([]);
  const partial = dashboardMonitorReport(await fetchDashboardSnapshot(new AbortController().signal));
  assert.equal(partial.offline, false); assert.match(partial.message, /Edited exports \(HTTP 503\)/);
  assert.doesNotMatch(partial.message, /connection is unavailable|remain usable/);
  const httpOnly = dashboardMonitorReport(DASHBOARD_ENDPOINTS.map(() => ({ status: 'rejected', reason: new MonitorFailure('http', 500) })));
  assert.equal(httpOnly.offline, false, 'A responding HTTP server is not classified as unreachable');
});

test('polling backs off offline, avoids overlapping work, pauses hidden pages, resumes immediately and cleans up', async () => {
  let finish, calls = 0, offline = false, visible = true, nextId = 0;
  const timers = new Map();
  const polling = startDashboardPolling({
    refresh: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, offline: () => offline, visible: () => visible,
    schedule: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; }, cancel: id => timers.delete(id),
  });
  assert.equal(calls, 1); await polling.retry(); assert.equal(calls, 1, 'Focus cannot start overlapping polling');
  offline = true; finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal([...timers.values()][0].delay, 15000);
  visible = false; [...timers.values()][0].callback(); await Promise.resolve();
  assert.equal(calls, 1); assert.equal(timers.size, 0, 'No hidden-window polling timer remains');
  visible = true; void polling.retry(); assert.equal(calls, 2, 'Visibility resumes without waiting for backoff');
  offline = false; finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal([...timers.values()][0].delay, 3000);
  polling.stop(); assert.equal(timers.size, 0); await polling.retry(); assert.equal(calls, 2);
});

let currentHarness;
const react = require('react'), originalLoad = Module._load;
Module._load = function (name, parent, ...args) {
  if (name === 'react' && parent?.filename.endsWith(`${path.sep}DashboardClient.tsx`)) return {
    ...react, useState: initial => currentHarness.state(initial), useRef: initial => currentHarness.ref(initial),
    useEffect: (effect, deps) => currentHarness.effect(effect, deps), useCallback: (value, deps) => currentHarness.memo(() => value, deps), useMemo: (factory, deps) => currentHarness.memo(factory, deps),
  };
  return originalLoad.call(this, name, parent, ...args);
};
let Dashboard;
try { Dashboard = require('../src/app/dashboard/DashboardClient').default; }
finally { Module._load = originalLoad; }
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(node, predicate, result = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, result));
  else if (node && typeof node === 'object') { if (predicate(node)) result.push(node); nodes(node.props?.children, predicate, result); }
  return result;
}
function harness(t) {
  const previous = { fetch: global.fetch, window: global.window, document: global.document, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let position = 0, dirty = true, pending = [], tree, timerId = 0, mode = 'ready', stateWrites = 0;
  const hooks = [], timers = new Map(), listeners = new Map(), requests = [], pendingRequests = [];
  const savedVideo = { id: 'fixture-video', title: 'Saved video', status: 'READY' };
  const h = {
    state(initial) { const index = position++; if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, value => { stateWrites++; const next = typeof value === 'function' ? value(hooks[index].value) : value; if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }]; },
    ref(initial) { const index = position++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    memo(factory, deps) { const index = position++, previous = hooks[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) hooks[index] = { value: factory(), deps }; return hooks[index].value; },
    effect(effect, deps) { const index = position++, previous = hooks[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { hooks[index] = { deps, cleanup: previous?.cleanup }; pending.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); }); } },
    render() { position = 0; dirty = false; currentHarness = h; tree = Dashboard(); const effects = pending; pending = []; effects.forEach(effect => effect()); },
    async flush() { for (let i = 0; i < 40; i++) { if (dirty) h.render(); await Promise.resolve(); } },
    async event(name) { listeners.get(name)?.(); await h.flush(); },
    setMode(value) { mode = value; },
    button(label) { return nodes(tree, node => typeof node.props?.onClick === 'function' && text(node) === label)[0]; },
    unmount() { hooks.forEach(hook => hook.cleanup?.()); },
    get tree() { return tree; }, get text() { return text(tree); }, get stateWrites() { return stateWrites; }, requests, timers, listeners, savedVideo, pendingRequests,
  };
  global.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  global.clearTimeout = id => timers.delete(id);
  global.window = { location: { hash: '#library', search: '' }, scrollTo() {}, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  global.document = { hidden: false, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  global.fetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    if (mode === 'pending') return new Promise((resolve, reject) => pendingRequests.push({ resolve, reject }));
    if (mode === 'offline') throw new TypeError('Failed to fetch');
    return Response.json(url === '/api/review-files' ? [savedVideo] : url === '/api/source-processing' ? { jobs: [] } : url === '/api/studio-health' ? { worker: { state: 'healthy' }, resources: {} } : []);
  };
  t.after(() => { h.unmount(); Object.assign(global, previous); currentHarness = undefined; });
  return h;
}

test('dashboard retains snapshots, shows one actionable offline banner, and Retry performs reads only', async t => {
  const h = harness(t); await h.flush();
  const library = () => nodes(h.tree, node => node.props?.files)[0];
  assert.equal(library().props.files[0].id, h.savedVideo.id);
  h.setMode('offline'); await h.event('focus');
  assert.equal(nodes(h.tree, node => node.props?.role === 'alert').length, 1);
  assert.match(h.text, /Phoenix is disconnected/); assert.match(h.text, /shortcut on your Desktop/);
  assert.match(h.text, /last received snapshots/); assert.doesNotMatch(h.text, /Failed to fetch|Available videos remain usable/);
  assert.equal(library().props.files[0].id, h.savedVideo.id, 'Connection loss does not erase saved snapshots');
  assert.equal(nodes(h.tree, node => node.type === 'fieldset')[0].props.disabled, true);
  global.window.location.hash = '#jobs'; await h.event('hashchange');
  const preparationControls = nodes(h.tree, node => node.type === 'fieldset' && node.props['aria-label'] === 'Video preparation controls')[0];
  assert.equal(preparationControls.props.disabled, true, 'Preparation retry/cancel/history controls cannot mutate queues offline');
  h.setMode('ready'); h.button('Retry connection').props.onClick(); await h.flush();
  assert.equal(nodes(h.tree, node => node.props?.role === 'alert').length, 0);
  assert.equal(nodes(h.tree, node => node.type === 'fieldset')[0].props.disabled, false);
  assert.equal(h.requests.length, 18); assert.ok(h.requests.every(request => !request.method));
  h.unmount(); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});

test('initial loading is visible and unmount abort cannot update state, show offline or schedule another poll', async t => {
  const h = harness(t); h.setMode('pending'); await h.flush();
  const library = nodes(h.tree, node => node.props?.files)[0];
  assert.equal(library.props.loading, true, 'The first load displays the loading state');
  assert.equal(h.requests.length, 6);
  h.unmount();
  assert.ok(h.requests.every(request => request.signal.aborted), 'All pending endpoint requests share the aborted component lifetime');
  const writes = h.stateWrites;
  h.pendingRequests.forEach(request => request.reject(new DOMException('Unmounted', 'AbortError')));
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.equal(h.stateWrites, writes, 'Cleanup abort does not set connection errors or loading state');
  assert.equal(h.requests.length, 6); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
  assert.doesNotMatch(h.text, /Phoenix is disconnected/);
});
