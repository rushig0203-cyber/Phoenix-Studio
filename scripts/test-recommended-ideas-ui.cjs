const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
function compile(relative) {
  const filename = path.join(project, relative);
  return { filename, code: ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText };
}
function load(source, dependencies = {}, extra = {}) {
  const module = { exports: {} };
  new vm.Script(source.code, { filename: source.filename }).runInNewContext({ module, exports: module.exports, ...extra,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Only pure recommendation/UI dependencies are allowed: ' + name); return dependencies[name]; },
  }, { timeout: 1000 });
  return module.exports;
}
const publishing = load(compile('src/lib/publishingFormats.ts'));
const content = load(compile('src/lib/contentIdeas.ts'));
const recommendations = load(compile('src/lib/creationRecommendations.ts'), { './contentIdeas': content, './publishingFormats': publishing });
const component = compile('src/components/RecommendedIdeas.tsx');
const activityJsx = (type, props, key) => ({ type, props, key });
const Activity = load(compile('src/components/StudioActivity.tsx'), { 'react/jsx-runtime': { jsx: activityJsx, jsxs: activityJsx } }).default;
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' || !tree.props ? [] : [tree, ...nodes(tree.props.children)];
const plain = value => JSON.parse(JSON.stringify(value));
function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
}
const natureContext = () => ({ now: Date.parse('2026-11-15T12:00:00Z'), recent: [
  { reviewId: 'panda', title: 'A panda eating bamboo', workflow: 'stock-reel', observations: ['Giant panda eats bamboo'], createdAt: '2026-11-15', posted: true },
  { reviewId: 'rabbit', title: 'A rabbit in the meadow', workflow: 'stock-reel', observations: [], createdAt: '2026-11-14', posted: true },
  { reviewId: 'waterfall', title: 'Waterfall', workflow: 'stock-reel', observations: ['Water falls into a pool'], createdAt: '2026-11-13', posted: true },
], feedback: [], strongerTopics: [] });

// Exercise the real component and selector against an inert, local API fixture.
// No owner files, providers, jobs, browser, real timers or server are started.
async function harness(options = {}) {
  let index = 0, tree, clock = 0, nextTimer = 0, context = natureContext(), activityAt = options.creationActivityAt, active = options.active ?? true;
  const timers = new Map(), slots = [], effects = [], pending = [], chosen = [], requests = [], signals = [];
  const hooks = {
    useState(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
    useRef(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(callback, dependencies) { const at = index++, previous = effects[at]; if (!previous || dependencies.some((value, offset) => !Object.is(value, previous.dependencies[offset]))) { effects[at] = { dependencies }; pending.push(() => { previous?.cleanup?.(); effects[at].cleanup = callback(); }); } },
  };
  const jsx = (type, props, key) => type === Activity ? Activity(props) : ({ type, props, key });
  const sandbox = { URLSearchParams, AbortController, AbortSignal,
    window: { setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: clock + delay, callback }); return id; }, clearTimeout(id) { timers.delete(id); } },
    async fetch(url, init) {
      const parsed = new URL(url, 'http://local.test');
      assert.equal(parsed.pathname, '/api/content-suggestions'); assert.equal(parsed.searchParams.get('workflow'), 'creation'); assert.equal(init.cache, 'no-store');
      requests.push(parsed);
      signals.push(init.signal);
      const seen = parsed.searchParams.get('seen').split(',').filter(Boolean); assert.ok(seen.length <= 48);
      if (options.fail?.()) return { ok: false };
      const result = recommendations.personalizedCreationRecommendations(context, Number(parsed.searchParams.get('cursor')), seen, parsed.searchParams.get('kind') || undefined);
      const batch = { ...result, ideas: result.ideas.map(idea => options.decorate ? options.decorate(idea) : idea) };
      const response = options.result ? options.result(batch, requests.length) : batch;
      await options.waitForResponse?.(requests.length);
      return { ok: true, async json() { return response; } };
    },
  };
  if (options.propertyDenied) Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('Browser property blocked'); } });
  else sandbox.localStorage = options.storage || memoryStorage();
  const Component = load(component, { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, './StudioActivity': { __esModule: true, default: Activity }, '@/lib/creationRecommendations': recommendations }, sandbox).default;
  function render() { index = 0; tree = Component({ onChoose: idea => chosen.push(idea), kind: options.kind || 'General video', creationActivityAt: activityAt, active }); while (pending.length) pending.shift()(); return tree; }
  async function settle() { for (let count = 0; count < 8; count++) await Promise.resolve(); render(); }
  const cards = () => nodes(tree).filter(node => node.type === 'button' && node.props['aria-label']?.startsWith('Use idea: '));
  const ids = () => cards().map(node => node.props['aria-label']);
  const more = async () => { nodes(tree).find(node => node.type === 'button' && text(node) === 'More ideas').props.onClick(); await settle(); };
  const categories = async () => { nodes(tree).find(node => node.type === 'button' && text(node) === 'Other categories').props.onClick(); await settle(); };
  render(); await settle();
  async function advance(milliseconds) { const target = clock + milliseconds; for (let passes = 0; ; passes++) { assert.ok(passes < 20); const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; clock = next[1].at; timers.delete(next[0]); next[1].callback(); await settle(); } clock = target; }
  return { cards, ids, more, categories, chosen, advance, requests, signals, settle, tree: () => tree, setContext(value) { context = value; }, async setActive(value) { active = value; render(); await settle(); }, async setActivityAt(value) { activityAt = value; await settle(); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}

test('creation fetches local recent subjects on open and remembers them across visits', async () => {
  const storage = memoryStorage(), first = await harness({ storage });
  assert.equal(first.cards().length, 5); assert.equal(first.requests.length, 1);
  assert.equal(first.requests[0].searchParams.get('kind'), 'General video');
  assert.ok(first.cards().every(card => /Nature & places/.test(card.props.title)));
  assert.ok(first.cards().every(card => !/panda|rabbit|waterfall|bamboo/i.test(card.props['aria-label'])));
  await first.more(); const previous = first.ids(); first.unmount();
  const reopened = await harness({ storage });
  assert.ok(reopened.ids().every(id => !previous.includes(id)));
  assert.equal(reopened.chosen.length, 0); assert.match(text(reopened.tree()), /Recently shown subjects are remembered/);
  assert.ok(reopened.requests[0].searchParams.get('seen').split(',').length >= 10);
});

test('blocked browser storage preserves in-session history without replaying stale cards', async () => {
  let reads = 0;
  for (const options of [
    { storage: { getItem() { reads++; return null; }, setItem() { throw new Error('Quota'); } } },
    { propertyDenied: true },
  ]) {
    const ui = await harness(options);
    for (let click = 0; click < 3; click++) { const before = ui.ids(); await ui.more(); assert.ok(ui.ids().every(id => !before.includes(id))); }
    assert.match(text(ui.tree()), /Browser history storage is unavailable/);
    assert.equal(ui.chosen.length, 0); assert.equal(ui.requests.length, 4);
  }
  assert.equal(reads, 1, 'Do not reload stale saved history after a failed write');
});

test('nature cards show their registered short title and one angle', async () => {
  const ui = await harness();
  for (const card of ui.cards()) {
    const title = card.props['aria-label'].slice('Use idea: '.length);
    const spans = nodes(card).filter(node => node.type === 'span');
    const resolved = recommendations.recommendationPool().map(idea => recommendations.resolveCreationRecommendation(idea.id)).find(idea => idea.title === title && idea.visualSubject);
    assert.equal(spans.length, 2); assert.equal(spans[0].props.children, title);
    assert.ok(resolved); assert.equal(spans[1].props.children, resolved.premise);
    card.props.onClick(); assert.equal(ui.chosen.at(-1).title, title);
  }
  assert.equal(ui.chosen.length, 5);
});

test('other categories remain selectable and children stay in the existing 2D workflow', async () => {
  const all = await harness();
  await all.categories();
  assert.equal(all.requests.at(-1).searchParams.get('kind'), null);
  assert.ok(all.cards().length > 0 && all.cards().length <= 6);
  all.cards()[0].props.onClick();
  assert.ok(all.chosen[0].kind);
  const children = await harness({ kind: "Children's short story" });
  assert.equal(children.cards().length, 6);
  assert.ok(children.cards().every(card => /Ages 3–6/.test(card.props.title)));
  assert.equal(nodes(children.tree()).some(node => node.type === 'button' && text(node) === 'Other categories'), false);
  children.cards()[0].props.onClick(); assert.equal(children.chosen[0].kind, "Children's short story");
});

test('More ideas uses newly saved subjects rather than shuffling the previous profile', async () => {
  const ui = await harness(); const previous = ui.ids();
  ui.setContext({ ...natureContext(), recent: [{ reviewId: 'bread', title: 'Bread kneaded by hand', workflow: 'general', observations: [], createdAt: '2026-11-15', posted: true }] });
  await ui.more();
  assert.ok(ui.ids().every(id => !previous.includes(id)));
  assert.ok(ui.cards().every(card => /Nature & places/.test(card.props.title)));
  assert.ok(ui.cards().every(card => !/bread|bakery|kneading/i.test(card.props['aria-label'])));
});

test('automatic refresh checks daily, on finished creation activity and on demand without choosing an idea', async () => {
  assert.equal(recommendations.RECOMMENDATION_REFRESH_MS, 24 * 60 * 60 * 1000);
  const ui = await harness(), before = ui.ids(); await ui.advance(recommendations.RECOMMENDATION_REFRESH_MS - 1);
  assert.deepEqual(plain(ui.ids()), plain(before)); assert.equal(ui.requests.length, 1);
  await ui.advance(1); assert.ok(ui.ids().every(id => !before.includes(id)));
  assert.equal(ui.requests.length, 2); assert.equal(ui.chosen.length, 0);
  await ui.setActivityAt(Date.parse('2026-11-16T12:00:00Z'));
  assert.equal(ui.requests.length, 3, 'A successful draft/render completion timestamp refreshes the list');
  ui.unmount(); await ui.advance(recommendations.RECOMMENDATION_REFRESH_MS); assert.equal(ui.requests.length, 3);
});

test('each return to the mounted video workspace refreshes once and hidden panels do no suggestion work', async () => {
  const ui = await harness({ active: false });
  assert.equal(ui.requests.length, 0);
  await ui.advance(recommendations.RECOMMENDATION_REFRESH_MS); assert.equal(ui.requests.length, 0);
  await ui.setActive(true); const first = ui.ids();
  assert.equal(first.length, 5); assert.equal(ui.requests.length, 1);
  await ui.setActive(true); assert.equal(ui.requests.length, 1, 'An unchanged active flag is not another visit');
  await ui.setActive(false);
  await ui.setActivityAt(Date.parse('2026-11-16T12:00:00Z'));
  await ui.advance(recommendations.RECOMMENDATION_REFRESH_MS * 2);
  assert.equal(ui.requests.length, 1, 'Hidden daily and completion refreshes wait until the next opening');
  await ui.setActive(true);
  assert.equal(ui.requests.length, 2); assert.ok(ui.ids().every(id => !first.includes(id)));
  assert.equal(ui.chosen.length, 0);
  ui.unmount(); await ui.advance(recommendations.RECOMMENDATION_REFRESH_MS); assert.equal(ui.requests.length, 2);
});

test('a late response from the hidden visit cannot overwrite reopened ideas or their stored history', async () => {
  let finishFirst;
  const waiting = new Promise(resolve => { finishFirst = resolve; }), storage = memoryStorage();
  const ui = await harness({ storage, waitForResponse: at => at === 1 ? waiting : undefined,
    result: (result, at) => at === 1 ? { ideas: [], nextCursor: 0 } : result });
  assert.equal(ui.requests.length, 1); assert.equal(ui.cards().length, 0);
  await ui.setActive(false); assert.equal(ui.signals[0].aborted, true);
  await ui.setActive(true); assert.equal(ui.requests.length, 2); assert.equal(ui.cards().length, 5);
  const before = ui.ids(), saved = storage.getItem(recommendations.PERSONALIZED_RECOMMENDATION_STORAGE_KEY);
  finishFirst(); await ui.settle();
  assert.deepEqual(plain(ui.ids()), plain(before));
  assert.equal(storage.getItem(recommendations.PERSONALIZED_RECOMMENDATION_STORAGE_KEY), saved);
  assert.equal(ui.chosen.length, 0); ui.unmount();
});

test('a valid empty batch ends loading and keeps the custom-topic path available after reopening', async () => {
  const ui = await harness({ result: () => ({ ideas: [], nextCursor: 0 }) });
  assert.equal(ui.cards().length, 0); assert.equal(ui.tree().props['aria-busy'], false);
  assert.match(text(ui.tree()), /No matching ideas are available\. You can describe your own video/);
  await ui.setActive(false); await ui.setActive(true);
  assert.equal(ui.requests.length, 2); assert.equal(ui.tree().props['aria-busy'], false);
  assert.equal(ui.chosen.length, 0); ui.unmount();
});

test('a failed refresh retains usable cards and does not record an unseen batch', async () => {
  let fail = false;
  const storage = memoryStorage(), ui = await harness({ storage, fail: () => fail });
  const before = ui.ids(), saved = storage.getItem(recommendations.PERSONALIZED_RECOMMENDATION_STORAGE_KEY);
  fail = true; await ui.more();
  assert.deepEqual(plain(ui.ids()), plain(before)); assert.equal(storage.getItem(recommendations.PERSONALIZED_RECOMMENDATION_STORAGE_KEY), saved);
  assert.match(text(ui.tree()), /Could not refresh ideas/);
  fail = false; await ui.more(); assert.ok(ui.ids().every(id => !before.includes(id))); assert.doesNotMatch(text(ui.tree()), /Could not refresh ideas/);
});

test('a full in-session history preserves newer subjects shown in another open screen', async () => {
  const storage = memoryStorage(), pool = recommendations.recommendationPool();
  const key = recommendations.PERSONALIZED_RECOMMENDATION_STORAGE_KEY;
  storage.setItem(key, JSON.stringify({ shown: pool.slice(0, 48).map(idea => idea.id), cursor: 0 }));
  const ui = await harness({ storage });
  const newer = pool.slice(-48).map(idea => idea.id);
  storage.setItem(key, JSON.stringify({ shown: newer, cursor: 72 }));
  await ui.more();
  const request = ui.requests.at(-1);
  assert.deepEqual(request.searchParams.get('seen').split(','), plain(newer), 'The newer shared browser history wins over a full stale in-session history');
  assert.equal(request.searchParams.get('cursor'), '72');
});
