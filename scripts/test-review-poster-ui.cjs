const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Inert JSX plus a minimal state/effect harness: no React, Next, player, app
// dependency graph, DOM, media decoder, network request or real timer is loaded.
const project = path.resolve(__dirname, '..');
const filename = path.join(project, 'src/components/ReviewLibrary.tsx');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [tree, ...nodes(tree.props.children)];
}
const sampleFile = () => ({
  id: 'mock-review', title: 'Mock review video', updatedAt: '2026-10-03T00:00:00Z',
  audience: 'general', source: { kind: 'local', filename: 'mock-video.mp4' },
  outputs: { source: { duration: 2 } }, quality: { hashtags: [], captions: [] },
});

function uiHarness() {
  let active;
  let nextTimer = 0;
  const timers = new Map(), listeners = new Map(), scheduled = [], cleared = [], removed = [];
  const document = {
    hidden: false,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
      removed.push({ name, callback });
    },
  };
  const window = {
    setTimeout(callback, duration) {
      const id = ++nextTimer;
      timers.set(id, { callback, duration });
      scheduled.push(duration);
      return id;
    },
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
  };
  const hooks = {
    useState(initial) {
      assert.ok(active, 'State hooks require an isolated renderer');
      const renderer = active, index = renderer.index++;
      if (!Object.hasOwn(renderer.slots, index)) renderer.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [renderer.slots[index], next => {
        const value = typeof next === 'function' ? next(renderer.slots[index]) : next;
        if (!Object.is(value, renderer.slots[index])) { renderer.slots[index] = value; renderer.dirty = true; }
      }];
    },
    useRef(initial) {
      assert.ok(active, 'Ref hooks require an isolated renderer');
      const index = active.index++;
      if (!Object.hasOwn(active.slots, index)) active.slots[index] = { current: initial };
      return active.slots[index];
    },
    useEffect(callback, dependencies) {
      assert.ok(active, 'Effect hooks require an isolated renderer');
      const index = active.index++, previous = active.effects[index];
      const deps = dependencies ? Array.from(dependencies) : undefined;
      if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        active.pending.push({ index, callback, deps });
      }
    },
  };
  function MockImage() { throw new Error('Inert image components must never execute'); }
  function MockLink() { throw new Error('Inert link components must never execute'); }
  function MockReviewPlayer() { throw new Error('The media player must never execute in this test'); }
  function MockPostingActions() { throw new Error('Posting must never execute in this test'); }
  function MockIcon() { throw new Error('Inert icon components must never execute'); }
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('MockFragment') },
    'next/image': { __esModule: true, default: MockImage },
    'next/link': { __esModule: true, default: MockLink },
    'lucide-react': { FolderOpen: MockIcon, Play: MockIcon, RotateCcw: MockIcon, Search: MockIcon, Trash2: MockIcon },
    './ReviewPlayer': { __esModule: true, default: MockReviewPlayer, reviewTarget: () => 'source' },
    './PostingActions': { __esModule: true, default: MockPostingActions },
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, window, document,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected isolated review UI import: ${name}`);
      return dependencies[name];
    },
    fetch() { throw new Error('UI regression tests must never fetch'); },
  });
  new vm.Script(output, { filename }).runInContext(context, { timeout: 1000 });

  function render(Component, initialProps) {
    const state = { index: 0, slots: [], effects: [], pending: [], dirty: true, tree: undefined, props: initialProps };
    function flush() {
      for (let pass = 0; state.dirty; pass++) {
        assert.ok(pass < 20, 'Mock effects settle without an update loop');
        state.dirty = false; state.index = 0; state.pending = [];
        active = state;
        try { state.tree = Component(state.props); }
        finally { active = undefined; }
        for (const effect of state.pending) {
          state.effects[effect.index]?.cleanup?.();
          state.effects[effect.index] = { deps: effect.deps, cleanup: effect.callback() };
        }
      }
      return state.tree;
    }
    flush();
    return {
      get tree() { return state.tree; }, flush,
      update(props) { state.props = props; state.dirty = true; return flush(); },
      unmount() { for (const effect of state.effects) effect?.cleanup?.(); },
    };
  }
  const file = sampleFile();
  const library = render(module.exports.default, { files: [file], loading: false, onRefresh: async () => {} });
  // Discover the private component through the real library's inert JSX tree.
  // No source rewriting, private export injection or duplicated Poster logic.
  const posterNode = nodes(library.tree).find(node => typeof node.type === 'function' && node.type.name === 'Poster');
  assert.ok(posterNode, 'ReviewLibrary exposes the actual private Poster in its render tree');
  const poster = render(posterNode.type, posterNode.props);
  return {
    poster, library, file, document, timers, scheduled, cleared, removed,
    image() { return nodes(poster.tree).find(node => node.type === MockImage); },
    preview() { return nodes(library.tree).find(node => node.type === MockReviewPlayer); },
    listenerCount() { return listeners.get('visibilitychange')?.size || 0; },
    failImage() {
      const image = this.image();
      assert.ok(image, 'A visible image is required to simulate failure');
      image.props.onError(); poster.flush();
    },
    fireTimer() {
      assert.equal(timers.size, 1, 'Only one retry timer is active');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback(); poster.flush();
    },
    visibility(hidden) {
      document.hidden = hidden;
      for (const callback of Array.from(listeners.get('visibilitychange') || [])) callback();
      poster.flush();
    },
    updateFile(nextFile) { poster.update({ ...posterNode.props, file: nextFile }); },
  };
}
const attempt = image => new URL(image.props.src, 'http://localhost').searchParams.get('attempt');

test('image failure keeps the preview button usable and creates no hidden video fallback', () => {
  const h = uiHarness();
  assert.equal(h.image().props.loading, 'lazy');
  assert.equal(attempt(h.image()), '0');
  h.failImage();
  assert.equal(h.image(), undefined);
  assert.equal(h.poster.tree.type, 'button');
  assert.equal(h.poster.tree.props['aria-label'], 'Preview Mock review video');
  assert.equal(nodes(h.poster.tree).some(node => node.type === 'video'), false);
  assert.equal(h.preview(), undefined);
  h.poster.tree.props.onClick(); h.library.flush();
  assert.equal(h.preview().props.file.id, h.file.id, 'The original library click opens the selected preview');
  assert.equal(h.preview().type.name, 'MockReviewPlayer');
  h.poster.unmount();
});

test('failed posters retry after 10, 30 and 60 seconds and stop after three attempts', () => {
  const h = uiHarness();
  for (const [index, delay] of [10_000, 30_000, 60_000].entries()) {
    h.failImage();
    assert.equal(h.timers.size, 1);
    assert.equal(h.timers.values().next().value.duration, delay);
    assert.equal(h.listenerCount(), 1);
    h.fireTimer();
    assert.equal(attempt(h.image()), String(index + 1));
    assert.equal(h.timers.size, 0);
    assert.equal(h.listenerCount(), 0);
  }
  h.failImage();
  assert.equal(h.image(), undefined);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
  h.visibility(false);
  assert.equal(h.image(), undefined);
  assert.deepEqual(h.scheduled, [10_000, 30_000, 60_000]);
  assert.equal(nodes(h.poster.tree).some(node => node.type === 'video'), false);
  h.poster.unmount();
});

test('a timer firing on a hidden page waits for visibility before retrying', () => {
  const h = uiHarness();
  h.failImage();
  h.document.hidden = true;
  h.fireTimer();
  assert.equal(h.image(), undefined);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 1);
  h.visibility(true);
  assert.equal(h.image(), undefined);
  h.visibility(false);
  assert.equal(attempt(h.image()), '1');
  assert.equal(h.listenerCount(), 0);
  h.visibility(false);
  assert.equal(attempt(h.image()), '1', 'Repeated visibility events cannot duplicate an attempt');
  h.poster.unmount();
});

test('unmount clears a pending retry timer and its visibility listener', () => {
  const h = uiHarness();
  h.failImage();
  const timerId = h.timers.keys().next().value;
  assert.equal(h.listenerCount(), 1);
  h.poster.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
  assert.ok(h.cleared.includes(timerId));
  assert.equal(h.removed.filter(event => event.name === 'visibilitychange').length, 1);
});

test('unmount also removes visibility waiting after a hidden-page timer has fired', () => {
  const h = uiHarness();
  h.failImage(); h.document.hidden = true; h.fireTimer();
  assert.equal(h.listenerCount(), 1);
  h.poster.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
});

test('updatedAt changes clear failure and reset an exhausted retry budget', () => {
  const h = uiHarness();
  for (let retry = 0; retry < 3; retry++) { h.failImage(); h.fireTimer(); }
  h.failImage();
  assert.equal(h.image(), undefined);
  assert.equal(h.timers.size, 0);
  const updatedAt = '2026-10-03T01:00:00Z';
  h.updateFile({ ...h.file, updatedAt });
  assert.equal(attempt(h.image()), '0');
  assert.equal(new URL(h.image().props.src, 'http://localhost').searchParams.get('v'), updatedAt);
  h.failImage();
  assert.equal(h.timers.values().next().value.duration, 10_000, 'A new file identity receives a fresh retry budget');
  h.poster.unmount();
});

test('updatedAt changes remove the old failure timer and visibility listener', () => {
  const h = uiHarness();
  h.failImage(); h.fireTimer(); h.failImage();
  assert.equal(h.timers.values().next().value.duration, 30_000);
  const oldTimer = h.timers.keys().next().value;
  h.updateFile({ ...h.file, updatedAt: '2026-10-03T02:00:00Z' });
  assert.equal(attempt(h.image()), '0');
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
  assert.ok(h.cleared.includes(oldTimer));
  h.poster.unmount();
});
