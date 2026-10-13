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
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' || !tree.props ? [] : [tree, ...nodes(tree.props.children)];
const plain = value => JSON.parse(JSON.stringify(value));
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
}

// The real component and catalogue, inert JSX, local fixture storage. Never
// mounts a browser, imports owner state, starts a timer or calls a provider/job.
function harness(options = {}) {
  let index = 0, tree, networkCalls = 0;
  const slots = [], effects = [], pending = [], chosen = [];
  const hooks = {
    useState(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
    useRef(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(callback, dependencies) { const at = index++, previous = effects[at]; if (!previous || dependencies.some((value, offset) => !Object.is(value, previous[offset]))) { effects[at] = [...dependencies]; pending.push(callback); } },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const decorate = result => options.decorate ? { ...result, ideas: result.ideas.map(options.decorate) } : result;
  const helpers = { ...recommendations,
    creationRecommendations: (...args) => decorate(recommendations.creationRecommendations(...args)),
    nextStoredRecommendations: (...args) => decorate(recommendations.nextStoredRecommendations(...args)),
  };
  const sandbox = { fetch() { networkCalls++; assert.fail('Recommendations must never call a network, job or provider'); } };
  if (options.propertyDenied) Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('Browser property blocked'); } });
  else sandbox.localStorage = options.storage || memoryStorage();
  const Component = load(component, { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/lib/creationRecommendations': helpers }, sandbox).default;
  function render() { index = 0; tree = Component({ onChoose: idea => chosen.push(idea) }); while (pending.length) pending.shift()(); return tree; }
  const cards = () => nodes(tree).filter(node => node.type === 'button' && node.props['aria-label']?.startsWith('Use idea: '));
  const ids = () => cards().map(node => node.key);
  const more = () => { nodes(tree).find(node => node.type === 'button' && text(node) === 'More ideas').props.onClick(); render(); };
  render(); render();
  return { render, cards, ids, more, chosen, tree: () => tree, networkCalls: () => networkCalls };
}

test('readable complete history with blocked writes does not replay stale cards on More ideas', () => {
  const saved = JSON.stringify({ version: 1, cursor: 0, shown: recommendations.recommendationPool().map(idea => idea.id) });
  let reads = 0, writes = 0;
  const ui = harness({ storage: { getItem() { reads++; return saved; }, setItem() { writes++; throw new Error('Storage quota exceeded'); } } });
  assert.equal(ui.cards().length, 6);
  let previous = ui.ids();
  for (let click = 0; click < 3; click++) {
    ui.more(); const current = ui.ids();
    assert.notDeepEqual(plain(current), plain(previous));
    assert.ok(current.every(id => !previous.includes(id)), 'A failed write must not reset the in-session rotation');
    previous = current;
  }
  assert.equal(reads, 1, 'Stop loading the stale saved history after its first failed write');
  assert.equal(writes, 4); assert.match(text(ui.tree()), /Browser history storage is unavailable/);
  assert.equal(ui.chosen.length, 0); assert.equal(ui.networkCalls(), 0);
});

test('healthy storage preserves the latest rotation when the recommendations reopen', () => {
  const storage = memoryStorage(), first = harness({ storage });
  first.more(); const previous = first.ids();
  const reopened = harness({ storage });
  assert.ok(reopened.ids().every(id => !previous.includes(id)));
  assert.equal(reopened.cards().length, 6); assert.match(text(reopened.tree()), /Recently shown topics are remembered/);
  const details = nodes(reopened.tree()).find(node => node.type === 'details');
  assert.equal(details.props.open, undefined); assert.equal(reopened.networkCalls(), 0);
});

test('denied methods or the localStorage property still rotate during this visit without creating work', () => {
  for (const options of [
    { storage: { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } } },
    { propertyDenied: true },
  ]) {
    const ui = harness(options), first = ui.ids(); ui.more();
    assert.ok(ui.ids().every(id => !first.includes(id)));
    const second = ui.ids(); ui.more(); assert.ok(ui.ids().every(id => !second.includes(id)));
    assert.match(text(ui.tree()), /topics may repeat on your next visit/);
    assert.equal(ui.chosen.length, 0); assert.equal(ui.networkCalls(), 0);
  }
});

test('headline and visible brief select the exact complete premise, including a second divider', () => {
  const ui = harness({ decorate: idea => ({ ...idea, title: `Visible topic ${idea.id} — Explain a concrete comparison — keep its full payoff.` }) });
  for (const card of ui.cards()) {
    const premise = card.props['aria-label'].slice('Use idea: '.length);
    const spans = nodes(card).filter(node => node.type === 'span');
    assert.equal(spans[0].props.children, premise.slice(0, premise.indexOf(' — ')));
    assert.equal(text(spans[0]) + text(spans[1]), premise);
    assert.match(spans[1].props.className, /text-xs/);
    card.props.onClick();
    const selected = ui.chosen.at(-1);
    assert.equal(selected.title, premise); assert.equal(selected.id, card.key);
  }
  assert.equal(ui.chosen.length, 6); assert.equal(ui.networkCalls(), 0);
});
