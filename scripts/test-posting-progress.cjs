const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const project = path.resolve(__dirname, '..');
const compile = relative => ts.transpileModule(fs.readFileSync(path.join(project, relative), 'utf8'), {
  fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function load(source, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  new vm.Script(source).runInNewContext({ module, exports: module.exports, ...globals, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected isolated dependency: ${name}`);
    return dependencies[name];
  } });
  return module.exports;
}
const helpers = load(compile('src/lib/postingProgress.ts'));
const component = compile('src/components/PostingProgress.tsx');
const reviewId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const upload = (extra = {}) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reviewId, platform: 'youtube', status: 'UPLOADING',
  percent: 96, bytesUploaded: 200, totalBytes: 1000, accountName: 'Fixture account', privacy: 'public', canContinue: false,
  detail: 'Fixture transfer', updatedAt: '2026-11-23T00:00:00Z', ...extra });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, async json() { return data; } });
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('')
  : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props
  ? [tree, ...nodes(tree.props.children)] : [];
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('transfer estimates require advancing byte samples and never estimate queueing or platform processing', () => {
  const job = upload();
  assert.equal(helpers.transferPercent(job), 20, 'Stage percent is never presented as measured transfer');
  assert.equal(helpers.transferPercent(upload({ bytesUploaded: NaN })), undefined);
  assert.equal(helpers.transferPercent(upload({ bytesUploaded: 1001 })), undefined);
  let samples = helpers.sampleTransfers([job], new Map(), 1000);
  assert.equal(helpers.transferTime(job, samples.get(job.id), 1000), 'Calculating time…');
  const advanced = upload({ bytesUploaded: 400 });
  samples = helpers.sampleTransfers([advanced], samples, 6000);
  assert.equal(helpers.transferTime(advanced, samples.get(job.id), 6000), 'About 15s transfer left');
  samples = helpers.sampleTransfers([advanced], samples, 11000);
  assert.equal(helpers.transferTime(advanced, samples.get(job.id), 22000), 'Calculating time…', 'A stalled old rate must expire');
  assert.equal(helpers.transferTime(upload({ status: 'PROCESSING' }), samples.get(job.id), 6000), 'Processing on platform');
  assert.equal(helpers.transferTime(upload({ status: 'QUEUED' }), samples.get(job.id), 6000), 'Waiting to upload');
  samples = helpers.sampleTransfers([upload({ bytesUploaded: 100 })], samples, 23000);
  assert.equal(helpers.transferTime(upload({ bytesUploaded: 100 }), samples.get(job.id), 23000), 'Calculating time…', 'A resumed offset resets the sample');
});

test('destination slots deduplicate companion Stories and merge independent reviews/platforms safely', () => {
  const story = upload({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', platform: 'instagram', kind: 'story', status: 'QUEUED', bytesUploaded: 0 });
  const reel = upload({ platform: 'instagram', companionStory: story });
  assert.equal(helpers.postingDestinations([reel, story]).length, 2);
  const youtube = upload({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', platform: 'youtube' });
  const other = upload({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reviewId: secondId });
  let jobs = helpers.mergePostingJob([reel, other], youtube);
  assert.equal(jobs.length, 3);
  jobs = helpers.mergePostingJob(jobs, { ...story, status: 'PROCESSING' });
  assert.equal(jobs.find(job => job.platform === 'instagram').companionStory.status, 'PROCESSING');
  assert.ok(jobs.some(job => job.reviewId === secondId));
  jobs = helpers.mergePostingJob(jobs, { ...story, standaloneStory: true });
  assert.equal(jobs.find(job => job.platform === 'instagram' && !job.kind).companionStory, undefined);
  assert.equal(helpers.postingDestinations(jobs).length, 4);
});

test('stopped destinations do not inflate remaining work or dilute measured transfer progress', () => {
  const live = upload({ bytesUploaded: 400 });
  const failed = upload({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', platform: 'instagram', status: 'FAILED', bytesUploaded: 0 });
  let summary = helpers.postingOverview([live, failed]);
  assert.equal(summary.remaining, 1); assert.equal(summary.attention, 1); assert.equal(summary.percent, 40);
  summary = helpers.postingOverview([failed]);
  assert.equal(summary.remaining, 0); assert.equal(summary.attention, 1); assert.equal(summary.percent, undefined);
});

function harness(options = {}) {
  const slots = [], effects = [], timers = new Map(), listeners = new Map(), requests = [], storage = new Map();
  let index = 0, dirty = true, mounted = true, tree, contextValue, pendingEffects = [], timerId = 0;
  let now = Date.parse('2026-11-23T00:00:00Z');
  const document = { hidden: false, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const react = {
    useState(initial) { const slot = index++; if (!Object.hasOwn(slots, slot)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], next => { const value = typeof next === 'function' ? next(slots[slot]) : next; if (!Object.is(value, slots[slot])) { slots[slot] = value; dirty = true; } }]; },
    useRef(initial) { const slot = index++; if (!Object.hasOwn(slots, slot)) slots[slot] = { current: initial }; return slots[slot]; },
    useCallback(callback, deps) { const slot = index++, old = slots[slot]; if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) slots[slot] = { callback, deps }; return slots[slot].callback; },
    useEffect(callback, deps) { const slot = index++, old = effects[slot]; if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) pendingEffects.push({ slot, callback, deps }); },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const Component = load(component, {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '@/lib/postingProgress': helpers,
    './PlatformIcon': { __esModule: true, default: props => jsx('svg', props) },
    './PostingProgressContext': { PostingContext: { Provider: 'MockProvider' } },
    'next/dynamic': () => props => jsx('dialog', { ...props, 'data-preview': true }),
  }, {
    document, window: { location: { hostname: options.hostname || 'localhost' } },
    Date: class extends Date { static now() { return now; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    AbortController, AbortSignal: { timeout: () => new AbortController().signal, any: signals => {
      const abort = new AbortController();
      for (const signal of signals) { if (signal.aborted) abort.abort(); else signal.addEventListener('abort', () => abort.abort(), { once: true }); }
      return abort.signal;
    } },
    setTimeout: (callback, duration) => { const id = ++timerId; timers.set(id, { callback, duration }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch(url, init = {}) {
      const request = { url, ...init }; requests.push(request);
      assert.equal(init.method, undefined, 'Progress and reopening are read-only');
      const result = options.read?.(request, requests);
      return result === undefined ? Promise.resolve(response(url === '/api/review-publications'
        ? { jobs: options.jobs || [], titles: { [reviewId]: 'Fixture video', [secondId]: 'Second fixture' } }
        : { id: reviewId, title: 'Fixture video', status: 'READY', outputs: { youtube: {} } })) : Promise.resolve(result);
    },
  }).default;
  function resolve(node) {
    if (Array.isArray(node)) return node.map(resolve);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return resolve(node.type(node.props));
    if (node.type === 'MockProvider') contextValue = node.props.value;
    return { ...node, props: { ...node.props, children: resolve(node.props?.children) } };
  }
  function render() {
    if (!mounted) return;
    for (let pass = 0; dirty; pass++) {
      assert.ok(pass < 20, 'Effects settle'); dirty = false; index = 0; pendingEffects = [];
      tree = resolve(Component({ children: jsx('main', { children: 'Dashboard' }) }));
      for (const effect of pendingEffects) { effects[effect.slot]?.cleanup?.(); effects[effect.slot] = { deps: effect.deps, cleanup: effect.callback() }; }
    }
  }
  render();
  return {
    get tree() { return tree; }, get text() { return text(tree); }, get shared() { return contextValue; }, requests, timers, document, storage,
    async flush() { for (let pass = 0; pass < 35; pass++) { render(); await Promise.resolve(); } render(); },
    click(label) { const target = nodes(tree).find(node => node.type === 'button' && (node.props['aria-label'] || text(node)) === label); assert.ok(target, label); target.props.onClick(); render(); },
    expand() { nodes(tree).find(node => node.type === 'button' && node.props['aria-controls'] === 'posting-progress-details').props.onClick(); render(); },
    tick() { assert.equal(timers.size, 1, 'Exactly one scheduled progress read'); const [id, timer] = timers.entries().next().value; timers.delete(id); now += timer.duration; timer.callback(); },
    visible(value) { document.hidden = !value; listeners.get('visibilitychange')?.(); },
    closePreview() { nodes(tree).find(node => node.props['data-preview']).props.onClose(); render(); },
    unmount() { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
  };
}

test('one collapsed dock restores multiple saved destination slots and reopens without uploading', async t => {
  const story = upload({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', platform: 'instagram', kind: 'story', status: 'QUEUED', bytesUploaded: 0 });
  const jobs = [upload(), upload({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', platform: 'instagram', status: 'PROCESSING', companionStory: story }),
    upload({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reviewId: secondId, platform: 'facebook' })];
  const h = harness({ jobs }); t.after(() => h.unmount()); await h.flush();
  assert.match(h.text, /4 destinations remaining/); assert.equal(nodes(h.tree).filter(node => node.props['data-posting-dock-job']).length, 0);
  h.expand(); assert.equal(nodes(h.tree).filter(node => node.props['data-posting-dock-job']).length, 4);
  assert.match(h.text, /Instagram Reel · Processing/); assert.match(h.text, /Instagram Story · Queued/); assert.match(h.text, /Facebook Page/);
  assert.doesNotMatch(h.text, /Rumble|Cancel|About \d/); assert.match(h.text, /Calculating time/);
  assert.ok(nodes(h.tree).some(node => node.props['aria-valuenow'] === 20));
  h.click('Open video'); await h.flush(); assert.ok(nodes(h.tree).some(node => node.props['data-preview']));
  h.closePreview(); assert.match(h.text, /4 destinations remaining/); assert.equal(h.timers.size, 1);
  assert.equal(h.requests.filter(request => request.url === '/api/review-publications').length, 1);
});

test('the progress loop skips hidden pages, prevents overlap, keeps snapshots on failure and aborts on unmount', async () => {
  const pending = deferred(); let reads = 0;
  const h = harness({ jobs: [upload()], read(request) { if (request.url === '/api/review-publications' && ++reads === 2) return pending.promise; } });
  await h.flush(); h.visible(false); h.tick(); await h.flush(); assert.equal(reads, 1); assert.equal(h.timers.size, 0);
  h.visible(true); h.visible(true); await h.flush(); assert.equal(reads, 2); assert.equal(h.timers.size, 0);
  pending.resolve(response({ error: 'Fixture offline' }, 503)); await h.flush();
  assert.match(h.text, /1 destination remaining/); assert.match(h.text, /Status unavailable/);
  assert.equal(h.timers.size, 1); h.tick(); const last = h.requests.at(-1); h.unmount();
  assert.equal(last.signal.aborted, true); assert.equal(h.timers.size, 0);
});

test('a stale snapshot cannot erase a just-approved upload and stopped notices never continue themselves', async t => {
  const pending = deferred();
  const h = harness({ read: () => pending.promise }); t.after(() => h.unmount());
  const accepted = upload({ status: 'QUEUED', bytesUploaded: 0 });
  h.shared.accepted({ id: reviewId, title: 'Approved video' }, accepted); await h.flush();
  pending.resolve(response({ jobs: [], titles: {} })); await h.flush();
  assert.match(h.text, /1 destination remaining/); assert.equal(h.shared.jobs[0].id, accepted.id);
  h.shared.observe({ id: reviewId, title: 'Approved video' }, []); await h.flush();
  assert.equal(h.shared.jobs[0].id, accepted.id, 'A preflight begun before acceptance cannot erase the saved slot either');
  const stopped = { ...accepted, status: 'NEEDS_CHECK', detail: 'Continue explicitly after checking the saved request.' };
  h.shared.observe({ id: reviewId, title: 'Approved video' }, [stopped]); await h.flush(); h.expand();
  assert.match(h.text, /Needs check/); assert.doesNotMatch(h.text, /Continue saved upload|Cancel/);
  h.click('Dismiss notices'); await h.flush();
  assert.equal(nodes(h.tree).some(node => node.props['data-posting-dock']), false);
  assert.equal(h.shared.jobs[0].status, 'NEEDS_CHECK', 'Dismissing changes only the notice, never its saved state');
  assert.equal(h.requests.length, 1);
});

test('hosted dashboards do not read the localhost-only upload store', async t => {
  const h = harness({ hostname: 'example.vercel.app' }); t.after(() => h.unmount()); await h.flush();
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
});

test('historical failures stay in posting history and recent stopped notices never claim completion', async t => {
  const historical = upload({ status: 'FAILED', updatedAt: '2026-11-21T00:00:00Z' });
  const h = harness({ jobs: [historical] }); t.after(() => h.unmount()); await h.flush();
  assert.equal(nodes(h.tree).some(node => node.props['data-posting-dock']), false);
  h.shared.observe({ id: reviewId, title: 'Fixture video' }, [{ ...historical, updatedAt: '2026-11-23T00:00:00Z' }]); await h.flush();
  assert.match(h.text, /1 destination needs attention/); assert.doesNotMatch(h.text, /Posting complete|destination remaining|100%/);
});

test('completed uploads leave the dock while simultaneous platforms and failures remain visible', async t => {
  const completedId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const processingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const failedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const completed = upload({ id: completedId, platform: 'instagram', status: 'COMPLETE', bytesUploaded: 1000, totalBytes: 1000, percent: 100 });
  const done = harness({ jobs: [completed] }); t.after(() => done.unmount()); await done.flush();
  assert.equal(nodes(done.tree).some(node => node.props['data-posting-dock']), false, '100% posted destinations disappear without a dismissal action');
  const awaitingPlatform = harness({ jobs: [upload({ bytesUploaded: 1000 })] }); t.after(() => awaitingPlatform.unmount()); await awaitingPlatform.flush();
  assert.ok(nodes(awaitingPlatform.tree).some(node => node.props['data-posting-dock']), 'All bytes sent is still active until the platform confirms the post.');
  awaitingPlatform.expand(); assert.match(awaitingPlatform.text, /Waiting for platform/); assert.doesNotMatch(awaitingPlatform.text, /YouTube · Posted/);
  awaitingPlatform.shared.observe({ id: reviewId, title: 'Fixture video' }, [upload({ status: 'COMPLETE', bytesUploaded: 1000, percent: 100 })]);
  await awaitingPlatform.flush();
  assert.equal(nodes(awaitingPlatform.tree).some(node => node.props['data-posting-dock']), false, 'The existing dock clears as soon as confirmation arrives');
  const h = harness({ jobs: [upload(), upload({ id: processingId, platform: 'facebook', status: 'PROCESSING' }), completed,
    upload({ id: failedId, reviewId: secondId, platform: 'instagram', status: 'FAILED', detail: 'Check the Instagram account before retrying.' })] });
  t.after(() => h.unmount()); await h.flush();
  assert.match(h.text, /2 destinations remaining/); assert.match(h.text, /1 needs attention/);
  h.expand();
  const visible = nodes(h.tree).filter(node => node.props['data-posting-dock-job']).map(node => node.props['data-posting-dock-job']);
  assert.deepEqual(visible.sort(), [upload().id, processingId, failedId].sort());
  assert.ok(!visible.includes(completedId)); assert.match(h.text, /Check the Instagram account before retrying/);
  assert.match(h.text, /YouTube · Uploading/); assert.match(h.text, /Facebook Page · Processing/);
});
