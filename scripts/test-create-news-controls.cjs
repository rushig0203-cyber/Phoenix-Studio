const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : node == null ? '' : String(node);
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [];
function harness(name, fetch) {
  const slots = [], effects = [], pending = [], requests = [], started = [];
  let at, tree;
  const hooks = {
    useState(initial) { const i = at++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = at++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(work, deps) { const i = at++, old = effects[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: work() }; }); },
  };
  const dependencies = { react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': {}, '@/components/ui/button': { Button: 'button' }, '@/components/RecommendedIdeas': { default: 'Recommendations' },
    '@/components/NewsIdeas': { default: 'NewsIdeas' }, '@/components/InstagramTopicSuggestions': { default: 'InstagramTopics' },
    '@/lib/creationRecommendations': {}, '@/lib/creationIntent': { creationIntent: () => 'General video' },
    '@/lib/publishingFormats': { publishingProfile: () => ({ defaultDuration: 75 }) } };
  const mod = { exports: {} }, filename = path.join(root, `src/components/${name}.tsx`);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new vm.Script(code, { filename }).runInNewContext({ module: mod, exports: mod.exports, crypto: require('node:crypto').webcrypto,
    AbortController, AbortSignal, Error, fetch: async (url, init) => { requests.push({ url, ...init }); return fetch(url, init); },
    require(key) { assert.ok(Object.hasOwn(dependencies, key), key); return dependencies[key]; },
  });
  const h = { requests, started, get tree() { return tree; }, get text() { return text(tree); },
    render() { at = 0; tree = mod.exports.default({ onClose() {}, onStarted: value => started.push(value), onChoose() {} }); for (const fn of pending.splice(0)) fn(); },
    async flush() { for (let i = 0; i < 30; i++) { await Promise.resolve(); h.render(); } },
    submit() { nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  }; h.render(); return h;
}
test('empty Create gives an actionable inline message instead of silently failing native form validation', async () => {
  const h = harness('AICreation', () => assert.fail('Invalid input must not reach the server'));
  h.submit(); await h.flush();
  assert.match(h.text, /Describe your video or choose an idea\/report first/); assert.equal(h.requests.length, 0);
  assert.equal(nodes(h.tree).find(n => n.type === 'form').props.noValidate, true);
});
test('selected news submits the displayed report once and only accepts a real durable draft confirmation', async () => {
  const h = harness('AICreation', async () => Response.json({ draftIds: ['12345678-1234-4234-8234-123456789abc'], count: 1 }));
  nodes(h.tree).find(n => n.type === 'details' && text(n).includes('Explore suggestions')).props.onToggle({ currentTarget: { open: true } }); h.render();
  nodes(h.tree).find(n => n.type === 'NewsIdeas').props.onChoose({ id: 'a'.repeat(32), title: 'A selected report', url: 'https://www.bbc.co.uk/news/articles/example', publishedAt: '2026-10-30', source: 'BBC News' }); h.render();
  h.submit(); h.submit(); await h.flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, '/api/generations');
  assert.equal(JSON.parse(h.requests[0].body).newsId, 'a'.repeat(32)); assert.ok(h.requests[0].signal);
  assert.equal(h.started.length, 1);
});
test('creation failures keep the idea visible and never invent a queued job', async () => {
  for (const response of [Response.json({}), Response.json({ error: 'Renderer unavailable' }, { status: 503 })]) {
    const h = harness('AICreation', async () => response);
    nodes(h.tree).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Dogs playing in the garden' } }); h.render();
    h.submit(); await h.flush();
    assert.equal(h.started.length, 0); assert.match(h.text, /confirmation was unreadable|Renderer unavailable/);
    assert.ok(nodes(h.tree).some(n => n.type === 'textarea' && n.props.value === 'Dogs playing in the garden'));
  }
});
test('news failures are visible and retryable, without losing earlier valid reports', async () => {
  let calls = 0;
  const item = { id: 'a', title: 'Verified fixture report', summary: 'Fixture', url: 'https://www.bbc.co.uk/news/articles/example', publishedAt: '2026-10-30' };
  const h = harness('NewsIdeas', async () => ++calls === 1 ? Response.json({ items: [item] }) : Response.json({ items: [] }));
  const click = () => nodes(h.tree).find(n => n.type === 'button').props.onClick();
  click(); click(); await h.flush(); assert.equal(calls, 1); assert.match(h.text, /Verified fixture report/);
  click(); await h.flush(); assert.equal(calls, 2); assert.match(h.text, /No recent usable reports/); assert.match(h.text, /Verified fixture report/);
  assert.equal(nodes(h.tree).find(n => n.type === 'button').props.disabled, false); h.unmount();
});
