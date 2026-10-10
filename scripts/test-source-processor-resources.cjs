const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { File } = require('node:buffer');
const { test } = require('node:test');
const ts = require('typescript');

// Execute the real processor and shared poller with persistent isolated hooks.
// No owner store, app dependency graph, DOM, media, upload or provider is loaded.
const project = path.resolve(__dirname, '..');
function compiled(relative, jsx = false) {
  const filename = path.join(project, relative);
  return { filename, source: ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
  }).outputText };
}
const processorSource = compiled('src/components/SourceProcessor.tsx', true);
const monitorSource = compiled('src/lib/dashboardMonitor.ts');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('')
  : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const preflight = { ready: true, summary: 'Fixture tools ready', dependencies: { ffmpeg: true, ffprobe: true, python: true, fasterWhisper: true },
  details: {}, firstModelDownloadRequired: false, whisperModel: { message: 'Fixture' } };
const job = (id, status) => ({ id, title: id, mode: 'coverage', status, progress: status === 'COMPLETED' ? 100 : 10,
  stage: status, completedClips: 0, totalClips: 1, elapsedSeconds: 1, estimatedRemainingSeconds: null });

function harness(t, { active = true, hidden = false, defer = false } = {}) {
  let position = 0, dirty = true, mounted = true, tree, nextTimer = 0, writes = 0, uploads = 0, maximumLive = 0;
  let props = { active, onClose() {}, onStarted() { assert.fail('Polling must never dispatch or complete an upload'); } };
  let payload = { preflight, jobs: [] };
  const slots = [], effects = [], pendingEffects = [], timers = new Map(), listeners = new Map(), requests = [], scheduled = [];
  const document = {
    hidden,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const hooks = {
    useState(initial) {
      const index = position++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        writes++;
        const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = position++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) {
      const index = position++, prior = slots[index];
      if (!prior || deps.length !== prior.deps.length || deps.some((value, i) => !Object.is(value, prior.deps[i]))) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = position++, prior = effects[index];
      if (!prior || deps.length !== prior.deps.length || deps.some((value, i) => !Object.is(value, prior.deps[i]))) pendingEffects.push({ index, callback, deps });
    },
  };
  const fixtureFetch = (url, options = {}) => {
    assert.equal(url, '/api/source-processing', 'Only the source status endpoint may be read');
    assert.equal(options.method, undefined, 'Lifecycle/polling must never create or retry a job');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    const record = { url, options, settled: false };
    requests.push(record);
    maximumLive = Math.max(maximumLive, requests.filter(item => !item.settled && !item.options.signal.aborted).length);
    const response = value => ({ ok: true, json: async () => value });
    if (!defer) { record.settled = true; return Promise.resolve(response(payload)); }
    return new Promise((resolve, reject) => {
      record.resolve = value => { record.settled = true; resolve(response(value)); };
      record.reject = error => { record.settled = true; reject(error); };
    });
  };
  const schedule = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); scheduled.push(delay); return id; };
  const shared = { document, AbortController, AbortSignal: { any: AbortSignal.any, timeout: () => new AbortController().signal },
    setTimeout: schedule, clearTimeout: id => timers.delete(id), fetch: fixtureFetch,
    XMLHttpRequest: class { constructor() { uploads++; assert.fail('No upload may start in processor resource tests'); } } };
  function load(source, dependencies) {
    const module = { exports: {} };
    new vm.Script(source.source, { filename: source.filename }).runInNewContext({ ...shared, module, exports: module.exports,
      require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected isolated import: ${name}`); return dependencies[name]; },
    }, { timeout: 1000 });
    return module.exports;
  }
  const monitor = load(monitorSource, {});
  const jsx = (type, elementProps, key) => ({ type, props: elementProps, key });
  function InertButton() { assert.fail('Inert UI components must not execute'); }
  function InertIcon() { assert.fail('Inert icons must not execute'); }
  const Component = load(processorSource, {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': { Loader2: InertIcon, TriangleAlert: InertIcon, Upload: InertIcon },
    '@/components/ui/button': { Button: InertButton }, '@/lib/dashboardMonitor': monitor,
  }).default;
  const h = {
    async flush() {
      for (let pass = 0; pass < 40; pass++) {
        if (mounted && dirty) {
          dirty = false; position = 0; tree = Component(props);
          for (const effect of pendingEffects.splice(0)) {
            effects[effect.index]?.cleanup?.();
            effects[effect.index] = { deps: effect.deps, cleanup: effect.callback() };
          }
        }
        await Promise.resolve();
      }
    },
    async active(value) { props = { ...props, active: value }; dirty = true; await h.flush(); },
    async visibility(value) { document.hidden = value; for (const callback of listeners.get('visibilitychange') || []) callback(); await h.flush(); },
    async fireTimer() {
      assert.equal(timers.size, 1, 'Only one source poll may be scheduled');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); timer.callback(); await h.flush();
    },
    async select(file, mode = 'highlights') {
      const input = nodes(tree).find(node => node.props.id === 'episode-file');
      input.props.onChange({ target: { files: [file] }, currentTarget: { value: file.name } });
      nodes(tree).filter(node => node.props.name === 'mode')[mode === 'coverage' ? 0 : 1].props.onChange();
      await h.flush();
    },
    setPayload(value) { payload = value; },
    unmount() { if (!mounted) return; mounted = false; for (const effect of effects) effect?.cleanup?.(); },
    get file() { return slots[0]?.value; }, get mode() { return slots[1]?.value; },
    get tree() { return tree; }, get text() { return text(tree); }, get writes() { return writes; },
    get maximumLive() { return maximumLive; }, get uploads() { return uploads; },
    get listenerCount() { return listeners.get('visibilitychange')?.size || 0; },
    timers, scheduled, requests,
  };
  t.after(() => {
    h.unmount();
    assert.equal(uploads, 0, 'Resource changes must never start an upload');
    assert.ok(requests.every(request => !request.options.method));
    assert.equal(h.listenerCount, 0); assert.equal(timers.size, 0);
  });
  return h;
}

test('an inactive mounted processor retains File and mode without polling, then wakes only when activated', async t => {
  const h = harness(t, { active: false }); await h.flush();
  assert.equal(h.requests.length, 0); assert.equal(h.listenerCount, 0);
  const selected = new File(['Fixture footage, not uploaded'], 'episode.mp4', { type: 'video/mp4' });
  await h.select(selected);
  assert.equal(h.file, selected); assert.equal(h.mode, 'highlights');
  await h.active(true);
  assert.equal(h.requests.length, 1); assert.equal(h.listenerCount, 1);
  assert.equal(h.file, selected); assert.equal(h.mode, 'highlights');
  assert.match(h.text, /Ready: episode\.mp4/);
});

test('active to inactive to active preserves the selected File and split mode while suspending reads', async t => {
  const h = harness(t); await h.flush();
  const selected = new File(['Fixture'], 'saved-selection.mkv', { type: 'video/x-matroska' });
  await h.select(selected, 'highlights');
  await h.active(false);
  assert.equal(h.timers.size, 0); assert.equal(h.listenerCount, 0); assert.equal(h.requests.length, 1);
  await h.visibility(true); await h.visibility(false);
  assert.equal(h.requests.length, 1, 'A background panel cannot wake on visibility events');
  await h.active(true);
  assert.equal(h.requests.length, 2); assert.equal(h.file, selected); assert.equal(h.mode, 'highlights');
  const radios = nodes(h.tree).filter(node => node.props.name === 'mode');
  assert.equal(radios[0].props.checked, false); assert.equal(radios[1].props.checked, true);
});

test('the real shared poller uses 3 seconds for active work and 15 seconds for an idle processor', async t => {
  const h = harness(t);
  h.setPayload({ preflight, jobs: [job('working', 'PROCESSING')] }); await h.flush();
  assert.equal(h.timers.values().next().value.delay, 3000);
  h.setPayload({ preflight, jobs: [job('done', 'COMPLETED')] }); await h.fireTimer();
  assert.equal(h.timers.values().next().value.delay, 15000);
  h.setPayload({ preflight, jobs: [job('waiting', 'QUEUED')] }); await h.fireTimer();
  assert.equal(h.timers.values().next().value.delay, 3000);
  assert.equal(h.requests.length, 3); assert.equal(h.maximumLive, 1);
});

test('hidden visibility cancels scheduled reads and visible resumes immediately without losing file selection', async t => {
  const h = harness(t); await h.flush();
  const selected = new File(['Fixture'], 'visible-again.mov', { type: 'video/quicktime' });
  await h.select(selected, 'coverage');
  await h.visibility(true);
  assert.equal(h.timers.size, 0); assert.equal(h.requests.length, 1);
  await h.visibility(false);
  assert.equal(h.requests.length, 2); assert.equal(h.file, selected); assert.equal(h.mode, 'coverage');
  assert.equal(h.timers.size, 1); assert.equal(h.maximumLive, 1);
});

test('a hidden pending GET is aborted and a late result cannot overwrite the visible queue', async t => {
  const h = harness(t, { defer: true }); await h.flush();
  const first = h.requests[0]; assert.equal(h.timers.size, 0);
  await h.visibility(true); assert.equal(first.options.signal.aborted, true);
  const writes = h.writes;
  first.resolve({ preflight, jobs: [job('stale-hidden-result', 'COMPLETED')] }); await h.flush();
  assert.equal(h.writes, writes); assert.doesNotMatch(h.text, /stale-hidden-result/);
  await h.visibility(false); assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ preflight, jobs: [job('fresh-visible-result', 'PROCESSING')] }); await h.flush();
  assert.match(h.text, /fresh-visible-result/); assert.equal(h.timers.values().next().value.delay, 3000);
  assert.equal(h.maximumLive, 1);
});

test('inactive cancellation prevents stale writes and an older completion cannot clear the new request guard', async t => {
  const h = harness(t, { defer: true }); await h.flush();
  const first = h.requests[0];
  await h.active(false); assert.equal(first.options.signal.aborted, true);
  await h.active(true); assert.equal(h.requests.length, 2);
  const second = h.requests[1], writes = h.writes;
  first.resolve({ preflight, jobs: [job('stale-panel-result', 'COMPLETED')] }); await h.flush();
  assert.equal(h.writes, writes); assert.equal(h.timers.size, 0);
  await h.visibility(false); assert.equal(h.requests.length, 2, 'Visibility cannot overlap a pending status request');
  await h.active(false);
  assert.equal(second.options.signal.aborted, true, 'Old completion must not erase the latest abort controller');
  second.reject(new DOMException('Fixture canceled', 'AbortError')); await h.flush();
  assert.equal(h.writes, writes); assert.equal(h.timers.size, 0); assert.equal(h.maximumLive, 1);
});

test('pending GETs do not overlap even through repeated visibility wakeups or form edits', async t => {
  const h = harness(t, { defer: true }); await h.flush();
  await h.visibility(false); await h.visibility(false);
  await h.select(new File(['Fixture'], 'no-upload.mp4', { type: 'video/mp4' }));
  assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0); assert.equal(h.uploads, 0);
  h.requests[0].resolve({ preflight, jobs: [job('running', 'RUNNING')] }); await h.flush();
  await h.fireTimer(); assert.equal(h.requests.length, 2);
  await h.visibility(false); assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ preflight, jobs: [] }); await h.flush();
  assert.equal(h.maximumLive, 1); assert.equal(h.timers.size, 1);
});

test('unmount aborts a pending GET, removes listeners, and rejects stale state updates or scheduled reads', async t => {
  const h = harness(t, { defer: true }); await h.flush();
  const request = h.requests[0]; h.unmount();
  assert.equal(request.options.signal.aborted, true); assert.equal(h.listenerCount, 0);
  const writes = h.writes;
  request.resolve({ preflight, jobs: [job('late-after-unmount', 'COMPLETED')] }); await h.flush();
  assert.equal(h.writes, writes); assert.equal(h.timers.size, 0); assert.equal(h.requests.length, 1);
});

test('unmount removes an idle timer and hidden initial mount sends no status request until visible', async t => {
  const h = harness(t, { hidden: true }); await h.flush();
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
  await h.visibility(false); assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 1);
  h.unmount(); assert.equal(h.timers.size, 0); assert.equal(h.listenerCount, 0);
});
