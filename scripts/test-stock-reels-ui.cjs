const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Actual component handlers, inert JSX and a controlled clock: no browser,
// server, provider, credentials, model, decoder, playback or real timer waits.
const project = path.resolve(__dirname, '..');
function compile(relative) {
  const filename = path.join(project, relative);
  return { filename, source: ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText };
}
const componentSource = compile('src/components/StockReels.tsx');
const planningSource = compile('src/lib/stockReel.ts');
const ideasSource = compile('src/lib/contentIdeas.ts');
const suggestionsSource = compile('src/lib/stockFootageSuggestions.ts');
const candidatesSource = compile('src/lib/stockFootageCandidates.ts');
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return !tree || typeof tree !== 'object' || !tree.props ? [] : [tree, ...nodes(tree.props.children)];
}
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, async json() { return value; } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const video = (id, title = 'Forest stream ' + id) => ({
  id, title, provider: id % 2 ? 'pexels' : 'pixabay', duration: 40, width: 720, height: 1280,
  previewUrl: 'https://videos.pexels.com/video-files/fixture/720.mp4', image: '',
  sourcePage: 'https://www.pexels.com/video/fixture-1/', creator: 'Fixture contributor',
});
const fixtures = [video(1, 'Forest opening'), video(2, 'Stream reveal'), video(3, 'Moss detail')];
const successfulSearch = (videos = fixtures, extra = {}) => response({ videos, configured: { pexels: true, pixabay: true }, errors: [], ...extra });
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, String(value)); } };
}
function harness(options = {}) {
  let active, uuid = 0, time = 0, timerId = 0, mounted = true, closed = 0;
  const requests = [], deadlines = [], started = [], timers = new Map();
  const renderer = { index: 0, slots: [], effects: [], pending: [], dirty: true, tree: undefined };
  const hooks = {
    useState(initial) {
      assert.ok(active);
      const index = active.index++;
      if (!Object.hasOwn(renderer.slots, index)) renderer.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [renderer.slots[index], next => {
        const value = typeof next === 'function' ? next(renderer.slots[index]) : next;
        if (!Object.is(value, renderer.slots[index])) { renderer.slots[index] = value; renderer.dirty = true; }
      }];
    },
    useRef(initial) {
      assert.ok(active);
      const index = active.index++;
      if (!Object.hasOwn(renderer.slots, index)) renderer.slots[index] = { current: initial };
      return renderer.slots[index];
    },
    useEffect(callback, dependencies) {
      assert.ok(active);
      const index = active.index++, previous = renderer.effects[index];
      if (!previous || !dependencies || dependencies.some((value, at) => !Object.is(value, previous.dependencies?.[at]))) {
        renderer.pending.push({ index, callback, dependencies: dependencies && [...dependencies] });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('FixtureFragment') },
    'next/image': 'img', './ui/button': { Button: 'button' } };
  const clock = {
    setTimeout(callback, milliseconds = 0) { const id = ++timerId; timers.set(id, { at: time + milliseconds, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const shared = {
    Error, AbortController, localStorage: options.storage || memoryStorage(),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, window: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    crypto: { randomUUID() { return 'fixture-request-' + ++uuid; } },
    AbortSignal: {
      timeout(milliseconds) { deadlines.push(milliseconds); return new AbortController().signal; },
      any(signals) { return AbortSignal.any(signals); },
    },
    fetch(url, init = {}) {
      assert.ok(typeof url === 'string' && (url === '/api/stock-reels' || url.startsWith('/api/stock-reels?')), 'Only the mocked stock endpoint is allowed');
      const request = { url, ...init, method: init.method || 'GET' }; requests.push(request);
      if (request.method === 'GET') return Promise.resolve(options.search ? options.search(request) : successfulSearch(options.videos || fixtures));
      assert.equal(request.method, 'POST'); assert.equal(url, '/api/stock-reels');
      return Promise.resolve(options.post ? options.post(request) : response({ job: { id: 'fixture-queued-job' }, message: 'Automatic related-footage reel queued.' }, 201));
    },
  };
  function load(source) {
    const mod = { exports: {} };
    new vm.Script(source.source, { filename: source.filename }).runInNewContext({
      ...shared, module: mod, exports: mod.exports,
      require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Unexpected stock UI import: ' + name); return dependencies[name]; },
    }, { timeout: 1000 });
    return mod.exports;
  }
  dependencies['@/lib/stockReel'] = load(planningSource);
  dependencies['./contentIdeas'] = load(ideasSource);
  dependencies['@/lib/stockFootageSuggestions'] = load(suggestionsSource);
  dependencies['@/lib/stockFootageCandidates'] = load(candidatesSource);
  const Component = load(componentSource).default;
  function render() {
    if (!mounted) return renderer.tree;
    for (let pass = 0; renderer.dirty; pass++) {
      assert.ok(pass < 30, 'Effects settle without a render loop');
      renderer.dirty = false; renderer.index = 0; renderer.pending = []; active = renderer;
      try { renderer.tree = Component({ initialQuery: options.initialQuery ?? '', onClose() { closed++; }, onStarted(message) { started.push(message); } }); }
      finally { active = undefined; }
      for (const effect of renderer.pending) {
        renderer.effects[effect.index]?.cleanup?.();
        renderer.effects[effect.index] = { ...effect, cleanup: effect.callback() };
      }
    }
    return renderer.tree;
  }
  async function flush() { for (let count = 0; count < 16; count++) { await Promise.resolve(); render(); } }
  function find(predicate, description) {
    const matches = nodes(renderer.tree).filter(predicate);
    assert.equal(matches.length, 1, description + ' matches exactly one control'); return matches[0];
  }
  function button(label) { return find(node => node.type === 'button' && text(node) === label, 'Button ' + label); }
  function input() { return find(node => node.type === 'input', 'Topic input'); }
  const h = {
    requests, deadlines, started, render, flush, button, input,
    get tree() { return renderer.tree; }, get closed() { return closed; },
    get gets() { return requests.filter(request => request.method === 'GET'); },
    get posts() { return requests.filter(request => request.method === 'POST'); },
    get payload() { return JSON.parse(h.posts.at(-1).body); },
    get pendingTimers() { return timers.size; },
    changeTopic(value) { input().props.onChange({ target: { value: String(value) } }); render(); },
    click(label) { button(label).props.onClick(); render(); },
    async enter() { find(node => node.type === 'form', 'Topic form').props.onSubmit({ preventDefault() {} }); render(); await flush(); },
    candidates() { return nodes(renderer.tree).filter(node => node.type === 'button' && /^(pexels|pixabay):\d+$/.test(node.key)); },
    choose(id) { const key = (id % 2 ? 'pexels' : 'pixabay') + ':' + id; find(node => node.type === 'button' && node.key === key, 'Candidate ' + id).props.onClick(); render(); },
    async advance(milliseconds) {
      const target = time + milliseconds;
      for (let pass = 0; ; pass++) {
        assert.ok(pass < 100, 'Mock timers are bounded');
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback(); render(); await flush();
      }
      time = target; await flush();
    },
    unmount() { if (!mounted) return; mounted = false; for (const effect of renderer.effects) effect?.cleanup?.(); },
  };
  render(); return h;
}
const plain = value => JSON.parse(JSON.stringify(value));
async function results(h, topic = 'forest stream') { h.changeTopic(topic); await h.advance(600); }

test('opening is idle; typing waits 600ms and only a meaningful topic starts one free-library search', async () => {
  const h = harness(); await h.advance(1000); assert.equal(h.requests.length, 0);
  h.changeTopic('a'); await h.advance(1000); assert.equal(h.requests.length, 0);
  h.changeTopic('forest'); await h.advance(599); assert.equal(h.requests.length, 0);
  h.changeTopic('forest stream & moss'); await h.advance(599); assert.equal(h.requests.length, 0);
  await h.advance(1);
  assert.equal(h.gets.length, 1);
  assert.equal(h.gets[0].url, '/api/stock-reels?q=forest%20stream%20%26%20moss&provider=all&automatic=true&browse=true');
  assert.equal(h.posts.length, 0); assert.equal(h.started.length, 0);
});

test('automatic footage explains adaptive timing without new controls or padded playback', async () => {
  const gate = deferred(), h = harness({ post: () => gate.promise });
  assert.match(text(h.tree), /tighter cuts and a natural length/);
  assert.match(text(h.tree), /not a fixed timer/);
  assert.doesNotMatch(text(h.tree), /40–45|for 40 seconds/);
  assert.doesNotMatch(text(h.tree), /two or three related clips/);
  await results(h); h.choose(1); await h.flush();
  assert.match(text(h.tree), /choosing the reel’s length and pacing/);
  assert.deepEqual(Object.keys(h.payload).sort(), ['automatic', 'id', 'provider', 'query', 'requestId']);
  gate.resolve(response({ error: 'Not enough related footage for a coherent reel. Try another starting video.' }, 400)); await h.flush();
  assert.match(text(h.tree), /Not enough related footage for a coherent reel/);
  assert.equal(h.started.length, 0);
  assert.equal(nodes(h.tree).filter(node => node.type === 'select').length, 0);
});

test('Enter searches immediately and cancels its debounce without duplicate requests', async () => {
  const gate = deferred(), h = harness({ search: () => gate.promise });
  h.changeTopic('coastal waves');
  const form = nodes(h.tree).find(node => node.type === 'form');
  form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); h.render();
  assert.equal(h.gets.length, 1); await h.advance(600); assert.equal(h.gets.length, 1);
  gate.resolve(successfulSearch()); await h.flush(); assert.equal(h.gets.length, 1);
});

test('an explicitly supplied initial topic also receives automatic suggestions after the debounce', async () => {
  const h = harness({ initialQuery: 'misty mountains' });
  await h.advance(599); assert.equal(h.requests.length, 0);
  await h.advance(1); assert.equal(h.gets.length, 1);
  assert.equal(h.gets[0].url, '/api/stock-reels?q=misty%20mountains&provider=all&automatic=true&browse=true');
  assert.equal(h.posts.length, 0);
});

test('twenty unique provider thumbnails are shown at a time without playback or manual edit controls', async () => {
  const many = Array.from({ length: 24 }, (_, index) => video(index + 1));
  const h = harness({ videos: [many[0], { ...many[0], provider: 'pixabay' }, ...many, many[2]] }); await results(h);
  assert.equal(h.candidates().length, 20); assert.equal(new Set(h.candidates().map(node => node.key)).size, 20);
  assert.ok(h.candidates().some(node => node.key === 'pexels:1'));
  assert.ok(h.candidates().some(node => node.key === 'pixabay:1'), 'Same numeric ID from different libraries identifies different footage');
  assert.equal(nodes(h.tree).filter(node => ['video', 'audio', 'select', 'textarea'].includes(node.type)).length, 0);
  assert.doesNotMatch(text(h.tree), /Start \(seconds\)|End \(seconds\)|Add this moment|Create reel from this|Edit rhythm|Instrumental mood/);
  assert.equal(h.posts.length, 0);
  h.click('More videos'); await h.flush();
  assert.equal(h.candidates().length, 5); assert.equal(h.gets.length, 1, 'Loaded thumbnails page locally without consuming provider quota');
  h.click('Previous videos'); await h.flush(); assert.equal(h.candidates().length, 20);
});

test('More videos follows the cursor once, deduplicates libraries and presents new choices without creating work', async () => {
  const cursor = JSON.stringify({ pexels: 2, pixabay: 1, limited: false }); let count = 0;
  const h = harness({ search: () => ++count === 1 ? successfulSearch(fixtures, { pagination: { cursor, partial: true } })
    : successfulSearch([fixtures[0], video(4), video(5)], { pagination: { cursor: null, limited: false } }) });
  await results(h); const oldClick = h.candidates()[0].props.onClick;
  const more = h.button('More videos').props.onClick; more(); more(); h.render(); await h.flush();
  assert.equal(h.gets.length, 2); assert.ok(h.gets[1].url.endsWith('&cursor=' + encodeURIComponent(cursor)));
  assert.deepEqual(plain(h.candidates().map(node => node.key)), ['pixabay:4', 'pexels:5']);
  assert.match(text(h.tree), /4–5 of 5 loaded/); assert.match(text(h.tree), /All matching pages are checked/);
  oldClick(); h.render(); await h.flush(); assert.equal(h.posts.length, 0, 'An old retained page handler is no longer authoritative');
  h.click('Previous videos'); await h.flush(); h.choose(1); await h.flush(); assert.equal(h.posts.length, 1);
});

test('a failed next page retains usable choices and retries exactly its cursor', async () => {
  const cursor = '{"pexels":2,"pixabay":null,"limited":false}'; let count = 0;
  const h = harness({ search: () => ++count === 1 ? successfulSearch(fixtures, { pagination: { cursor } })
    : count === 2 ? Promise.reject(new Error('Fixture next page offline')) : successfulSearch([video(7)], { pagination: { cursor: null } }) });
  await results(h); const keys = h.candidates().map(node => node.key);
  h.click('More videos'); await h.flush(); assert.match(text(h.tree), /next page offline/);
  assert.deepEqual(plain(h.candidates().map(node => node.key)), plain(keys));
  h.click('Retry more videos'); await h.flush();
  assert.equal(h.gets[1].url, h.gets[2].url); assert.equal(h.candidates()[0].key, 'pexels:7'); assert.equal(h.posts.length, 0);
});

test('Previous returns to the actual last page after appending a sparse provider page', async () => {
  let calls = 0;
  const h = harness({ search: () => ++calls === 1
    ? successfulSearch(Array.from({length:48}, (_, at) => video(at + 1)), { pagination: {cursor:'next'} })
    : successfulSearch(Array.from({length:20}, (_, at) => video(at + 49)), {pagination:{cursor:null}}) });
  await results(h);
  h.click('More videos'); await h.flush(); h.click('More videos'); await h.flush();
  assert.match(text(h.tree), /41–48 of 48 loaded/);
  h.click('More videos'); await h.flush(); assert.match(text(h.tree), /49–68 of 68 loaded/);
  h.click('Previous videos'); await h.flush(); assert.match(text(h.tree), /41–60 of 68 loaded/);
  h.click('Previous videos'); await h.flush(); assert.match(text(h.tree), /21–40 of 68 loaded/);
  h.click('Previous videos'); await h.flush(); assert.match(text(h.tree), /1–20 of 68 loaded/);
  assert.equal(h.gets.length,2); assert.equal(h.posts.length,0);
});

test('changing topic during a next page aborts and never inserts its late choices', async () => {
  const gate = deferred(); let count = 0;
  const h = harness({ search: () => ++count === 1 ? successfulSearch(fixtures, { pagination: { cursor: 'fixture-cursor' } })
    : count === 2 ? gate.promise : successfulSearch([video(8, 'New coastline')]) });
  await results(h); h.click('More videos'); await h.flush(); h.changeTopic('coastline');
  assert.equal(h.gets[1].signal.aborted, true); await h.advance(600);
  gate.resolve(successfulSearch([video(9, 'Old forest')])); await h.flush();
  assert.deepEqual(plain(h.candidates().map(node => node.key)), ['pixabay:8']); assert.equal(h.posts.length, 0);
});

test('a sparse matching page can continue but exhaustion and hard limits are explicit with at most20 mounted thumbnails', async () => {
  let count = 0;
  const h = harness({ search: () => ++count === 1 ? successfulSearch([], { pagination: { cursor: 'fixture-next' } })
    : successfulSearch(Array.from({ length: 140 }, (_, at) => video(at + 1)), { pagination: { cursor: 'fixture-next' } }) });
  await results(h); assert.equal(h.candidates().length, 0); h.click('More videos'); await h.flush();
  assert.equal(h.candidates().length, 20); assert.match(text(h.tree), /120 distinct/);
  for (let at = 0; at < 5; at++) h.click('More videos'); await h.flush();
  assert.equal(h.candidates().length, 20); assert.match(text(h.tree), /laptop-safe browsing limit/);
  assert.equal(h.gets.length, 2); assert.equal(h.posts.length, 0);
});

test('topic change aborts old search and ignores a late response even if the provider ignores abort', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const h = harness({ search: () => ++count === 1 ? first.promise : second.promise });
  h.changeTopic('old forest'); await h.advance(600); h.changeTopic('new beach');
  assert.equal(h.candidates().length, 0); assert.equal(h.gets[0].signal.aborted, true);
  await h.advance(600); second.resolve(successfulSearch([video(7, 'Current beach')])); await h.flush();
  assert.equal(h.candidates()[0].key, 'pexels:7');
  first.resolve(successfulSearch([video(1, 'Old forest')])); await h.flush();
  assert.deepEqual(plain(h.candidates().map(node => node.key)), ['pexels:7']); assert.equal(h.posts.length, 0);
});

test('a retained old candidate handler cannot queue footage after the topic changes', async () => {
  const h = harness(); await results(h);
  const oldClick = h.candidates()[0].props.onClick; h.changeTopic('mountain mist');
  assert.equal(h.candidates().length, 0); oldClick(); h.render(); await h.flush(); assert.equal(h.posts.length, 0);
});

test('one candidate click queues only the five automatic-mode fields', async () => {
  const h = harness(); await results(h); h.choose(2); await h.flush();
  assert.equal(h.posts.length, 1);
  assert.deepEqual(Object.keys(h.payload).sort(), ['automatic', 'id', 'provider', 'query', 'requestId']);
  assert.deepEqual(plain({ ...h.payload, requestId: 'fixture' }), { automatic: true, provider: 'pixabay', id: 2, query: 'forest stream', requestId: 'fixture' });
  assert.ok(h.payload.requestId.startsWith('fixture-request-')); assert.equal(h.started.length, 1);
  h.choose(1); await h.flush();
  assert.equal(h.posts.length, 1, 'A confirmed submission cannot queue a second result from retained handlers');
});

test('double clicks are single-flight and an ambiguous failure retries the same request ID', async () => {
  const gate = deferred(); let attempt = 0;
  const h = harness({ post: () => ++attempt === 1 ? gate.promise : response({ job: { id: 'fixture-job' } }, 201) });
  await results(h); const click = h.candidates()[0].props.onClick; click(); click(); h.render(); await h.flush();
  assert.equal(h.posts.length, 1); const first = h.payload.requestId;
  assert.ok(h.candidates().every(node => node.props.disabled));
  gate.resolve(response({ error: 'Fixture temporary download failure' }, 503)); await h.flush();
  assert.match(text(h.tree), /temporary download failure/);
  h.choose(1); await h.flush(); assert.equal(h.posts.length, 2);
  assert.equal(h.payload.requestId, first); assert.equal(h.started.length, 1);
});

test('partial library failure keeps real candidates usable and shows the warning', async () => {
  const h = harness({ search: () => successfulSearch([video(1)], { configured: { pexels: true, pixabay: false }, errors: ['Pixabay is unavailable; Pexels results are usable.'] }) });
  await results(h); assert.equal(h.candidates().length, 1); assert.match(text(h.tree), /Pixabay is unavailable/);
  h.choose(1); await h.flush(); assert.equal(h.posts.length, 1);
});

test('search failures never queue and Enter can retry the same topic explicitly', async () => {
  let attempt = 0;
  const h = harness({ search: () => ++attempt === 1 ? response({ error: 'Fixture stock library unavailable' }, 503) : successfulSearch() });
  await results(h); assert.match(text(h.tree), /stock library unavailable/);
  assert.equal(h.candidates().length, 0); assert.equal(h.posts.length, 0);
  await h.enter(); assert.equal(h.gets.length, 2); assert.equal(h.candidates().length, 3);
});

test('network failure has an explicit retry that retrieves suggestions but never queues by itself', async () => {
  let attempt = 0;
  const h = harness({ search: () => ++attempt === 1 ? Promise.reject(new Error('Fixture network offline')) : successfulSearch() });
  await results(h); assert.match(text(h.tree), /network offline/);
  h.click('Retry suggestions'); await h.flush();
  assert.equal(h.gets.length, 2); assert.equal(h.candidates().length, 3); assert.equal(h.posts.length, 0);
});

test('missing both free library keys is actionable and never produces fabricated choices', async () => {
  const h = harness({ search: () => successfulSearch([], { configured: { pexels: false, pixabay: false } }) });
  await results(h); assert.match(text(h.tree), /Add a free Pexels or Pixabay key in Settings/);
  assert.equal(h.candidates().length, 0); assert.equal(h.posts.length, 0);
});

test('an unconfirmed success response is not called queued and Retry reel retains its request ID', async () => {
  let attempt = 0;
  const h = harness({ post: () => ++attempt === 1 ? response({ message: 'Unconfirmed fixture' }, 201) : response({ job: { id: 'fixture-job' } }, 201) });
  await results(h); h.choose(1); await h.flush();
  const first = h.payload.requestId; assert.equal(h.started.length, 0);
  assert.match(text(h.tree), /Could not confirm the queued job/);
  h.click('Retry reel'); await h.flush();
  assert.equal(h.payload.requestId, first); assert.equal(h.posts.length, 2); assert.equal(h.started.length, 1);
});

test('leaving during a dispatched creation does not abort possibly accepted work or notify an unmounted UI', async () => {
  const gate = deferred(), h = harness({ post: () => gate.promise });
  await results(h); h.choose(1); await h.flush();
  assert.equal(h.button('Close footage').props.disabled, true);
  h.unmount(); assert.equal(h.posts[0].signal.aborted, false);
  gate.resolve(response({ job: { id: 'fixture-job' } }, 201)); await h.flush();
  assert.equal(h.posts.length, 1); assert.equal(h.started.length, 0);
});

test('close/unmount clears debounce and aborts search without queuing late work', async () => {
  const pending = harness(); pending.changeTopic('unfinished topic'); pending.unmount(); await pending.advance(600);
  assert.equal(pending.requests.length, 0);
  const gate = deferred(), h = harness({ search: () => gate.promise }); await results(h);
  h.click('Close footage'); assert.equal(h.closed, 1); h.unmount(); assert.equal(h.gets[0].signal.aborted, true);
  gate.resolve(successfulSearch()); await h.flush(); assert.equal(h.posts.length, 0); assert.equal(h.started.length, 0);
});
