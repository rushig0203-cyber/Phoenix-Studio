const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });
const { DASHBOARD_ENDPOINTS, MonitorFailure, dashboardMonitorReport, fetchDashboardSnapshot, startDashboardPolling, dashboardHasPendingWork } = require('../src/lib/dashboardMonitor');

test('idle backoff requires all five work snapshots; saved caption work and ready plans stay active', () => {
  const snapshots = () => [[], { jobs: [] }, [], [], [], {}].map(value => ({ status: 'fulfilled', value }));
  const idle = snapshots();
  idle[0].value = [{ status: 'READY', quality: { postingAnalysis: { status: 'COMPLETE' } } }];
  assert.equal(dashboardHasPendingWork(idle), false);
  for (const status of ['QUEUED', 'ANALYZING', 'WAITING']) {
    const work = snapshots(); work[0].value = [{ status: 'READY', quality: { postingAnalysis: { status } } }];
    assert.equal(dashboardHasPendingWork(work), true);
  }
  for (const [index, status] of [[1, 'PROCESSING'], [2, 'RUNNING'], [3, 'QUEUED'], [4, 'READY'], [4, 'PLANNING']]) {
    const work = snapshots();
    work[index].value = index === 1 ? { jobs: [{ status }] } : [{ status }];
    assert.equal(dashboardHasPendingWork(work), true);
  }
  const missing = snapshots(); missing[3] = { status: 'rejected', reason: new Error('Temporary read failure') };
  assert.equal(dashboardHasPendingWork(missing), true);
  const malformed = snapshots(); malformed[1].value = {};
  assert.equal(dashboardHasPendingWork(malformed), true);
  assert.equal(dashboardHasPendingWork([]), true);
});

test('idle polling uses fifteen seconds; active work and manual wake-up use the existing fast path', async () => {
  let active = false, calls = 0, id = 0;
  const timers = new Map();
  const polling = startDashboardPolling({ refresh: async () => { calls++; }, offline: () => false, visible: () => true, active: () => active,
    schedule: (callback, delay) => { const key = ++id; timers.set(key, { callback, delay }); return key; }, cancel: key => timers.delete(key) });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1); assert.equal([...timers.values()][0].delay, 15000);
  active = true; await polling.retry();
  assert.equal(calls, 2); assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 3000);
  active = false; await polling.retry();
  assert.equal(calls, 3); assert.equal([...timers.values()][0].delay, 15000);
  polling.stop(); assert.equal(timers.size, 0);
});

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
  let sourceJobs = [], drafts = [];
  const hooks = [], timers = new Map(), listeners = new Map(), requests = [], pendingRequests = [];
  const savedVideo = { id: 'fixture-video', title: 'Saved video', status: 'READY' };
  let videos = [savedVideo];
  const h = {
    state(initial) { const index = position++; if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, value => { stateWrites++; const next = typeof value === 'function' ? value(hooks[index].value) : value; if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }]; },
    ref(initial) { const index = position++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    memo(factory, deps) { const index = position++, previous = hooks[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) hooks[index] = { value: factory(), deps }; return hooks[index].value; },
    effect(effect, deps) { const index = position++, previous = hooks[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { hooks[index] = { deps, cleanup: previous?.cleanup }; pending.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); }); } },
    render() { position = 0; dirty = false; currentHarness = h; tree = Dashboard(); const effects = pending; pending = []; effects.forEach(effect => effect()); },
    async flush() { for (let i = 0; i < 40; i++) { if (dirty) h.render(); await Promise.resolve(); } },
    async event(name) { listeners.get(name)?.(); await h.flush(); },
    setMode(value) { mode = value; },
    setJobs(jobs, preparation = []) { sourceJobs = jobs; drafts = preparation; },
    setFiles(value) { videos = value; },
    button(label) { return nodes(tree, node => typeof node.props?.onClick === 'function' && text(node) === label)[0]; },
    filter(label) {
      const select = nodes(tree, node => node.type === 'select' && node.props?.['aria-label'] === 'Job status filter')[0];
      const option = nodes(select, node => node.type === 'option' && text(node) === label)[0];
      assert.ok(option, `Missing status choice: ${label}`);
      return { selected: select.props.value === option.props.value, choose: () => select.props.onChange({ target: { value: option.props.value } }) };
    },
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
    return Response.json(url === '/api/review-files' ? videos : url === '/api/source-processing' ? { jobs: sourceJobs } : url === '/api/creation-drafts' ? drafts : url === '/api/studio-health' ? { worker: { state: 'healthy' }, resources: {} } : []);
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

test('dashboard wakes idle polling immediately for saved caption work and marks hidden upload forms inactive', async t => {
  const h = harness(t); global.window.location.hash = '#create'; await h.flush();
  assert.equal([...h.timers.values()][0].delay, 15000);
  h.button('Choose a video').props.onClick(); await h.flush();
  const processor = () => nodes(h.tree, node => node.type?.name === 'SourceProcessor')[0];
  const identity = processor().type;
  assert.equal(processor().props.active, true);
  global.window.location.hash = '#jobs'; await h.event('hashchange');
  assert.equal(processor().type, identity, 'Keep the mounted form and selected file rather than discarding user input');
  assert.equal(processor().props.active, false);
  global.window.location.hash = '#create'; await h.event('hashchange');
  assert.equal(processor().props.active, true);
  h.setFiles([{ ...h.savedVideo, quality: { postingAnalysis: { status: 'WAITING' } } }]); await h.event('focus');
  assert.equal([...h.timers.values()][0].delay, 3000, 'Pending captions keep the live monitor fast even after video completion');
  assert.equal(h.requests.length, 12); assert.ok(h.requests.every(request => !request.method));
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

const source = (id, status, day = 1) => ({ id, title: `Video ${id}`, status, progress: status === 'COMPLETED' ? 100 : 10, stage: status, createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z` });
const preparation = (id, status) => ({ id, status, createdAt: '2026-10-01T00:00:00Z', input: { topic: id, duration: 75, aspect: '9:16' }, stage: status });
test('one status filter counts and selects preparations as well as renders, with no old failures in Active', async t => {
  const h = harness(t);
  global.window.location.hash = '#jobs';
  h.setJobs([source('processing', 'PROCESSING'), source('failed-render', 'FAILED'), source('finished', 'COMPLETED')], [preparation('writing', 'PLANNING'), preparation('failed-plan', 'FAILED'), preparation('old-plan', 'APPROVED')]);
  await h.flush();
  assert.equal(h.filter('Active · 2').selected, true);
  assert.ok(h.filter('Needs attention · 2')); assert.ok(h.filter('Completed · 1')); assert.ok(h.filter('All jobs · 5'));
  const drafts = () => nodes(h.tree, node => node.props?.drafts)[0].props.drafts;
  assert.deepEqual(drafts().map(item => item.id), ['writing']);
  assert.deepEqual(nodes(h.tree, node => node.type === 'article' && node.key).map(node => node.key), ['source-processing']);
  h.filter('Needs attention · 2').choose(); await h.flush();
  assert.deepEqual(drafts().map(item => item.id), ['failed-plan']);
  assert.deepEqual(nodes(h.tree, node => node.type === 'article' && node.key).map(node => node.key), ['source-failed-render']);
  assert.equal(h.requests.length, 6, 'Tabs are presentation only; no retry or analysis request is sent');
  assert.ok(h.requests.every(request => !request.method));
});

test('empty active view says nothing is processing and long completed history mounts eight cards per page', async t => {
  const h = harness(t);
  global.window.location.hash = '#jobs';
  h.setJobs(Array.from({ length: 23 }, (_, index) => source(`finished-${index}`, 'COMPLETED', index + 1)));
  await h.flush();
  assert.equal(h.filter('Completed · 23').selected, true);
  const cards = () => nodes(h.tree, node => node.type === 'article' && node.key);
  assert.equal(cards().length, 8); assert.match(h.text, /Showing 1–8 of 23 saved jobs/);
  assert.match(text(cards()[0]), /Video finished-22/);
  h.button('Next').props.onClick(); await h.flush();
  assert.equal(cards().length, 8); assert.match(h.text, /Showing 9–16 of 23 saved jobs/);
  h.filter('Active · 0').choose(); await h.flush();
  assert.equal(cards().length, 0); assert.match(h.text, /Nothing is processing or waiting right now/);
  assert.doesNotMatch(h.text, /Showing 9–16/); assert.equal(h.requests.length, 6);
});

test('a completed episode exposes three output controls and the Library link rather than mounting all twenty-four clips', async t => {
  const h = harness(t);
  global.window.location.hash = '#jobs';
  h.setJobs([source('episode', 'COMPLETED')]);
  h.setFiles(Array.from({ length: 24 }, (_, index) => ({ id: `clip-${index}`, title: `Episode clip ${index}`, status: 'READY', processing: { jobId: 'episode' } })));
  await h.flush();
  assert.equal(nodes(h.tree, node => node.type?.name === 'PostingActions').length, 3);
  assert.equal(nodes(h.tree, node => typeof node.props?.onClick === 'function' && /^Watch video/.test(text(node))).length, 3);
  assert.match(h.text, /All 24 clips are in Library/);
  assert.equal(nodes(h.tree, node => node.props?.files)[0], undefined, 'Library is not mounted on the Jobs screen');
  assert.equal(h.requests.length, 6); assert.ok(h.requests.every(request => !request.method));
});

test('successful preparation retry feedback selects Active page one without retrying from the dashboard callback', async t => {
  const h = harness(t);
  global.window.location.hash = '#jobs';
  const failed = preparation('Failed script', 'FAILED');
  h.setJobs([], [failed]); await h.flush();
  assert.equal(h.filter('Needs attention · 1').selected, true);
  const preparationCard = nodes(h.tree, node => node.props?.drafts)[0];
  preparationCard.props.onRequeued(failed); await h.flush();
  assert.equal(h.filter('Active · 0').selected, true);
  assert.match(h.text, /“Failed script” queued again. Follow its progress in Active\./);
  assert.equal(h.requests.length, 6, 'The callback is UI feedback only; CreationDrafts owns the explicit retry request');
  h.setJobs([], [{ ...failed, status: 'QUEUED' }]); await h.event('focus');
  assert.equal(h.filter('Active · 1').selected, true);
  assert.deepEqual(nodes(h.tree, node => node.props?.drafts)[0].props.drafts.map(draft => draft.id), [failed.id]);
  assert.ok(h.requests.every(request => !request.method));
});

for (const [label, componentName, acceptedMessage] of [
  ['Choose a video', 'SourceProcessor', 'Source video queued. Follow preparation and rendering below.'],
  ['Find footage', 'StockReels', 'Footage fixture accepted; rendering queued.'],
  ['Create a video', 'AICreation', 'Creation fixture accepted; writing queued.'],
]) test(`${componentName} acceptance stays on Create, closes its form and exposes Active progress below the creation controls`, async t => {
  const h = harness(t); global.window.location.hash = '#create'; await h.flush();
  assert.ok(nodes(h.tree, node => node.props?.['aria-label'] === 'Jobs and progress')[0]);
  assert.equal(nodes(h.tree, node => node.props?.files)[0], undefined, 'Library remains a separate screen');
  h.button(label).props.onClick(); await h.flush();
  const workflow = nodes(h.tree, node => node.type?.name === componentName)[0]; assert.ok(workflow);
  h.setJobs([source('accepted-fixture', 'QUEUED')]);
  workflow.props.onStarted(acceptedMessage); await h.flush();
  assert.equal(global.window.location.hash, '#create');
  assert.equal(nodes(h.tree, node => node.type?.name === componentName).length, 0);
  assert.equal(nodes(h.tree, node => node.props?.['data-studio-screen'] === 'create')[0].props.hidden, false);
  assert.equal(h.filter('Active · 1').selected, true); assert.match(h.text, /Video accepted-fixture/);
  assert.ok(nodes(h.tree, node => node.type === 'a' && node.props.href === '#jobs').length >= 1, 'Standalone Jobs navigation remains available');
  assert.equal(h.requests.length, 12); assert.ok(h.requests.every(request => !request.method), 'Parent acceptance only refreshes saved state; it cannot create/retry work');
});

test('new completion on Create keeps the owner there with Completed and Watch beside the inline jobs', async t => {
  const h = harness(t); global.window.location.hash = '#create';
  h.setJobs([source('inline-completion', 'PROCESSING')]);
  h.setFiles([{ id: 'finished-inline-file', title: 'Finished inline file', status: 'READY', processing: { jobId: 'inline-completion' } }]);
  await h.flush();
  h.setJobs([source('inline-completion', 'COMPLETED')]); await h.event('focus');
  assert.equal(global.window.location.hash, '#create');
  assert.equal(h.filter('Completed · 1').selected, true);
  assert.match(h.text, /finished\. Choose Watch video below/);
  assert.equal(nodes(h.tree, node => typeof node.props?.onClick === 'function' && /^Watch video/.test(text(node))).length, 1);
  assert.equal(nodes(h.tree, node => node.props?.files)[0], undefined);
  assert.ok(h.requests.every(request => !request.method));
});

test('completed jobs already saved before opening Create never redirect the owner', async t => {
  const h = harness(t); global.window.location.hash = '#create'; h.setJobs([source('older-completion', 'COMPLETED')]);
  await h.flush();
  assert.equal(global.window.location.hash, '#create'); assert.equal(h.filter('Completed · 1').selected, true);
  assert.doesNotMatch(h.text, /finished\. Choose Watch video below/);
});

test('a new completion never interrupts the separate Library but preserves completion navigation from Settings', async t => {
  const h = harness(t); h.setJobs([source('library-completion', 'PROCESSING')]); await h.flush();
  h.setJobs([source('library-completion', 'COMPLETED')]); await h.event('focus');
  assert.equal(global.window.location.hash, '#library'); assert.ok(nodes(h.tree, node => node.props?.files)[0]);
  assert.equal(nodes(h.tree, node => node.props?.['aria-label'] === 'Jobs and progress').length, 0);
  global.window.location.hash = '#settings'; await h.event('hashchange');
  h.setJobs([source('library-completion', 'COMPLETED'), source('settings-completion', 'PROCESSING')]); await h.event('focus');
  h.setJobs([source('library-completion', 'COMPLETED'), source('settings-completion', 'COMPLETED')]); await h.event('focus');
  assert.equal(global.window.location.hash, 'jobs'); assert.equal(h.filter('Completed · 2').selected, true);
});

test('a playing review preview and its selected queue tab are not replaced by another job completing', async t => {
  const h = harness(t); global.window.location.hash = '#create';
  h.setJobs([source('watching', 'COMPLETED'), source('later-completion', 'PROCESSING')]);
  h.setFiles([{ id: 'watching-file', title: 'Watching file', status: 'READY', processing: { jobId: 'watching' } }]);
  await h.flush(); h.filter('Completed · 1').choose(); await h.flush();
  nodes(h.tree, node => typeof node.props?.onClick === 'function' && /^Watch video/.test(text(node)))[0].props.onClick(); await h.flush();
  const preview = nodes(h.tree, node => node.type?.name === 'ReviewPlayer')[0]; assert.equal(preview.props.file.id, 'watching-file');
  h.filter('Active · 1').choose(); await h.flush();
  h.setJobs([source('watching', 'COMPLETED'), source('later-completion', 'COMPLETED')]); await h.event('focus');
  assert.equal(global.window.location.hash, '#create');
  assert.equal(h.filter('Active · 0').selected, true, 'Completion does not switch the background tab beneath an open player');
  assert.equal(nodes(h.tree, node => node.type?.name === 'ReviewPlayer')[0].props.file.id, preview.props.file.id);
});
