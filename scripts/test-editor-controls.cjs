const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const Module = require('node:module');

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });

// Run the real component handlers with deterministic hooks and network/timers.
// This deliberately avoids a browser, video decoding, a server or model startup.
let currentHarness;
const react = require('react');
const load = Module._load;
Module._load = function (name, parent, ...args) {
  if (name === 'react' && parent?.filename.endsWith(`${path.sep}ReviewEditor.tsx`)) return {
    ...react,
    useState: initial => currentHarness.state(initial),
    useRef: initial => currentHarness.ref(initial),
    useEffect: (effect, deps) => currentHarness.effect(effect, deps),
  };
  return load.call(this, name, parent, ...args);
};
let ReviewEditor;
try { ReviewEditor = require('../src/components/ReviewEditor').default; }
finally { Module._load = load; }

const id = '00000000-0000-4000-8000-000000000001';
const draft = {
  title: 'Caption test', postCopy: '', hashtags: ['#Test'], trimStart: 0, trimEnd: 4,
  format: 'original', framing: 'fit', cropPosition: .5, volume: 1,
  captionsEnabled: true, captionPosition: 'bottom', captionSize: 32, captionColor: '#FFFFFF',
  cues: [{ start: 0, end: 2, text: 'First line' }, { start: 2, end: 4, text: 'Second line' }],
};
const baseState = { draft, duration: 4, width: 320, height: 180, canReplaceCaptions: true, previewIsClean: true, mediaUrl: '/fixture.mp4', jobs: [] };
const makeJob = saved => ({ id: 'job-1', reviewId: id, outputId: 'output-1', title: saved.title, draft: saved, status: 'QUEUED', progress: 0, stage: 'Queued for edited copy', createdAt: new Date().toISOString() });
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(node, predicate, output = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, output));
  else if (node && typeof node === 'object') {
    if (predicate(node)) output.push(node);
    nodes(node.props?.children, predicate, output);
  }
  return output;
}

function harness(t, options = {}) {
  const old = { fetch: global.fetch, document: global.document, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const hooks = [], timers = new Map(), listeners = new Map(), requests = [];
  let position = 0, timerId = 0, tree, dirty = true, pending = [];
  const fixture = structuredClone(options.state || baseState);
  const player = { currentTime: 0, volume: 1, paused: true, pauseCalls: 0, loadCalls: 0, removed: [], pause() { this.paused = true; this.pauseCalls++; }, load() { this.loadCalls++; }, removeAttribute(name) { this.removed.push(name); } };
  const h = {
    state(initial) {
      const index = position++;
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, value => { const next = typeof value === 'function' ? value(hooks[index].value) : value; if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }];
    },
    ref(initial) { const index = position++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    effect(effect, deps) {
      const index = position++, previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks[index] = { deps, cleanup: previous?.cleanup };
        pending.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); });
      }
    },
    render() {
      position = 0; dirty = false; currentHarness = h;
      tree = ReviewEditor({ id });
      for (const video of nodes(tree, node => node.type === 'video')) video.props.ref.current = player;
      const effects = pending; pending = []; effects.forEach(effect => effect());
    },
    async flush() { for (let i = 0; i < 20; i++) { if (dirty) h.render(); await Promise.resolve(); } },
    byLabel(label) { const matches = nodes(tree, node => node.props?.['aria-label'] === label); assert.equal(matches.length, 1, label); return matches[0]; },
    button(label) { const matches = nodes(tree, node => typeof node.props?.onClick === 'function' && text(node) === label); assert.equal(matches.length, 1, label); return matches[0]; },
    field(label) { const match = nodes(tree, node => node.type === 'label' && text(node).startsWith(label))[0]; assert.ok(match, label); return nodes(match, node => ['input', 'textarea', 'select'].includes(node.type))[0]; },
    click(button) { assert.ok(!button.props.disabled, 'the button must be enabled'); button.props.onClick(); },
    change(field, value) { assert.ok(!field.props.disabled, 'the field must be enabled'); field.props.onChange({ target: { value, checked: value } }); },
    async tick(delay) { const chosen = [...timers].filter(([, timer]) => timer.delay === delay); for (const [key, timer] of chosen) { if (timers.delete(key)) timer.callback(); } await h.flush(); },
    async visibility(hidden) { global.document.hidden = hidden; listeners.get('visibilitychange')?.(); await h.flush(); },
    unmount() { hooks.forEach(hook => hook.cleanup?.()); },
    get text() { return text(tree); },
    get tree() { return tree; },
    requests, player, timers,
  };
  global.setTimeout = (callback, delay) => { const key = ++timerId; timers.set(key, { callback, delay }); return key; };
  global.clearTimeout = key => timers.delete(key);
  global.document = { hidden: false, addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: event => listeners.delete(event) };
  global.fetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    if (!init.method && String(url).endsWith('/edit')) return Response.json(fixture);
    if (options.fetch) return options.fetch(url, init);
    if (init.method === 'PATCH') return Response.json({ draft: JSON.parse(init.body) });
    if (init.method === 'POST') return Response.json(makeJob(JSON.parse(init.body)), { status: 202 });
    return Response.json([]);
  };
  t.after(() => { h.unmount(); Object.assign(global, old); currentHarness = undefined; });
  return h;
}

test('caption, trim, frame, volume and posting controls submit the edited draft', async t => {
  const h = harness(t); await h.flush();
  h.change(h.byLabel('Caption 1 text'), 'Corrected line'); await h.flush();
  h.click(h.byLabel('Seek to caption 2')); await h.flush(); assert.equal(h.player.currentTime, 2);
  h.click(h.byLabel('Set trim start to playhead')); await h.flush();
  h.change(h.field('Output shape'), '1:1'); await h.flush();
  h.change(h.field('Framing'), 'crop'); await h.flush();
  h.change(h.byLabel('Crop focus'), '.25'); await h.flush();
  h.change(h.byLabel('Audio volume'), '.5'); await h.flush(); assert.equal(h.player.volume, .5);
  h.change(h.field('Position'), 'top'); await h.flush();
  h.change(h.field('Text size'), '40'); await h.flush();
  h.change(h.field('Color'), '#abcdef'); await h.flush();
  h.change(h.field('Title'), 'Edited title'); await h.flush();
  h.change(h.field('Post copy'), 'Corrected post'); await h.flush();
  h.change(h.field('Hashtags'), '#One #Two'); await h.flush();
  h.click(h.button('Save draft')); await h.flush();
  const saved = JSON.parse(h.requests.find(request => request.method === 'PATCH').body);
  assert.deepEqual(saved, { ...draft, title: 'Edited title', postCopy: 'Corrected post', hashtags: ['#One', '#Two'], trimStart: 2, format: '1:1', framing: 'crop', cropPosition: .25, volume: .5, captionPosition: 'top', captionSize: 40, captionColor: '#abcdef', cues: [{ ...draft.cues[0], text: 'Corrected line' }, draft.cues[1]] });
  assert.match(h.text, /Draft saved on this PC/);
  assert.ok(!h.button('Save draft').props.disabled);
  h.change(h.byLabel('Caption 2 text'), 'Unsaved change'); await h.flush(); assert.doesNotMatch(h.text, /Draft saved on this PC/);
});

test('full caption timeline never creates an invalid zero-length cue; delete and add reuse the gap', async t => {
  const h = harness(t); await h.flush();
  h.click(h.button('Add caption')); await h.flush();
  assert.match(h.text, /There is no free time/); assert.equal(nodes(h.tree, node => node.type === 'textarea' && /^Caption/.test(node.props['aria-label'] || '')).length, 2);
  h.click(h.byLabel('Delete caption 1')); await h.flush();
  h.click(h.button('Add caption')); await h.flush();
  assert.equal(h.byLabel('Caption 1 start').props.value, 0); assert.equal(h.byLabel('Caption 1 end').props.value, 2);
  assert.equal(h.byLabel('Caption 1 text').props.value, 'New caption');
  h.click(h.button('Save draft')); await h.flush(); assert.match(h.text, /Draft saved/);
});

test('playhead and invalid timing errors stay next to Save and do not poison the draft', async t => {
  const h = harness(t); await h.flush();
  h.click(h.byLabel('Set trim end to playhead')); await h.flush();
  assert.equal(h.byLabel('Trim end').props.value, 4); assert.match(h.text, /Keep at least one second/);
  h.change(h.byLabel('Caption 1 end'), '3'); await h.flush();
  h.click(h.button('Save draft')); await h.flush();
  assert.match(h.text, /Caption 2: choose an end/); assert.equal(h.requests.filter(request => request.method).length, 0);
  const sticky = nodes(h.tree, node => node.props?.className?.includes('sticky'))[0];
  assert.match(text(sticky), /Caption 2: choose an end/);
});

test('save has pending feedback, suppresses repeat clicks, preserves newer edits and recovers after failure', async t => {
  let finish;
  const h = harness(t, { fetch: () => new Promise(resolve => { finish = resolve; }) }); await h.flush();
  const button = h.button('Save draft'); h.click(button); h.click(button); await h.flush();
  assert.equal(h.requests.filter(request => request.method === 'PATCH').length, 1);
  assert.ok(h.button('Saving draft…').props.disabled);
  h.change(h.byLabel('Caption 1 text'), 'Typed while saving'); await h.flush();
  finish(Response.json({ draft })); await h.flush();
  assert.equal(h.byLabel('Caption 1 text').props.value, 'Typed while saving'); assert.match(h.text, /Save again to keep your latest changes/);
  h.click(h.button('Save draft')); await h.flush();
  finish(Response.json({ error: 'Disk is full' }, { status: 400 })); await h.flush();
  assert.match(h.text, /Disk is full/); assert.ok(!h.button('Save draft').props.disabled);
});

test('export immediately displays the accepted job and polls only that active review without overlap', async t => {
  let finishPoll;
  const h = harness(t, { fetch: (url, init) => init.method === 'POST' ? Response.json(makeJob(JSON.parse(init.body)), { status: 202 }) : new Promise(resolve => { finishPoll = resolve; }) }); await h.flush();
  await h.tick(3000); assert.equal(h.requests.length, 1, 'idle editor does not fetch job history');
  h.click(h.button('Export edited copy')); await h.flush();
  assert.match(h.text, /QUEUED/); assert.ok(h.button('Export already queued').props.disabled);
  await h.visibility(true); await h.tick(3000); assert.equal(h.requests.length, 2, 'hidden editor does not poll');
  await h.visibility(false); await h.tick(3000);
  const polls = h.requests.filter(request => request.url.includes('/api/review-edits?'));
  assert.equal(polls.length, 1); assert.equal(polls[0].url, `/api/review-edits?reviewId=${id}`);
  finishPoll(Response.json([{ ...makeJob(draft), status: 'COMPLETED', progress: 100 }])); await h.flush();
  assert.match(h.text, /COMPLETED/); assert.ok(!h.button('Export edited copy').props.disabled);
  const count = h.requests.length; await h.tick(3000); assert.equal(h.requests.length, count, 'completed editor stops polling');
});

test('caption limitations are explained while other legacy edit buttons remain usable', async t => {
  const state = { ...baseState, canReplaceCaptions: false, previewIsClean: false, captionNote: 'The original clean master is missing.', draft: { ...draft, captionsEnabled: false } };
  const h = harness(t, { state }); await h.flush();
  assert.match(h.text, /original clean master is missing/); assert.ok(h.button('Add caption').props.disabled);
  assert.ok(h.byLabel('Caption 1 text').props.disabled); assert.ok(!h.byLabel('Seek to caption 1').props.disabled);
  h.change(h.field('Title'), 'Legacy title'); await h.flush(); h.click(h.button('Save draft')); await h.flush();
  assert.match(h.text, /Draft saved/); assert.doesNotMatch(h.text, /corrected captions appear/);
});

test('unmount aborts editor requests and releases the video decoder', async t => {
  const h = harness(t); await h.flush(); h.unmount();
  assert.ok(h.requests[0].signal.aborted); assert.equal(h.player.pauseCalls, 1);
  assert.deepEqual(h.player.removed, ['src']); assert.equal(h.player.loadCalls, 1);
});
