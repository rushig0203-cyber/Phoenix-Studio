const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/CreationDrafts.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, found));
  else if (node && typeof node === 'object') { if (predicate(node)) found.push(node); nodes(node.props?.children, predicate, found); }
  return found;
}
function harness() {
  let position = 0, dirty = true, tree, mode = 'ok', requeued = 0, refreshes = 0;
  const slots = [], requests = [], order = [];
  const module = { exports: {} };
  const draft = { id: 'mock-draft', status: 'FAILED', version: 3, stage: 'Preparation failed', input: { topic: 'Local fixture', duration: 75, aspect: '9:16' } };
  const react = {
    useState(initial) { const index = position++; if (!(index in slots)) slots[index] = { value: initial }; return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true; }]; },
    useRef(initial) { const index = position++; return slots[index] ||= { current: initial }; },
  };
  new vm.Script(source).runInNewContext({ module, exports: module.exports, AbortSignal, require: name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === './ui/button') return { Button: 'button' };
    throw new Error(`Unexpected preparation UI import: ${name}`);
  }, fetch: async (url, options) => { requests.push({ url, ...options }); return mode === 'ok' ? Response.json({ status: 'QUEUED' }) : Response.json({ error: 'Saved draft changed; refresh it.' }, { status: 409 }); } });
  const h = {
    render() { position = 0; dirty = false; tree = module.exports.default({ drafts: [draft], failedOnly: true, onRequeued: value => { assert.equal(value.id, draft.id); requeued++; order.push('requeued'); }, onRefresh: async () => { refreshes++; order.push('refresh'); } }); },
    async flush() { for (let i = 0; i < 25; i++) { if (dirty) h.render(); await Promise.resolve(); } },
    button(label) { return nodes(tree, node => typeof node.props?.onClick === 'function' && text(node) === label)[0]; },
    setMode(value) { mode = value; },
    requests, order, get requeued() { return requeued; }, get refreshes() { return refreshes; }, get text() { return text(tree); },
  };
  h.render(); return h;
}

test('explicit preparation retry sends one mocked versioned request and switches view only after acceptance', async () => {
  const h = harness(); h.button('Retry job').props.onClick(); h.button('Retry job').props.onClick(); await h.flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(h.requests[0].body), { id: 'mock-draft', version: 3, action: 'retry' });
  assert.equal(h.requeued, 1); assert.equal(h.refreshes, 1); assert.deepEqual(h.order, ['requeued', 'refresh']);
});

test('failed preparation retry stays in attention view with its cause, and archive does not announce requeue', async () => {
  const h = harness(); h.setMode('conflict'); h.button('Retry job').props.onClick(); await h.flush();
  assert.equal(h.requeued, 0); assert.equal(h.refreshes, 0); assert.match(h.text, /Saved draft changed; refresh it/);
  h.setMode('ok'); h.button('Remove from history').props.onClick(); await h.flush();
  assert.equal(h.requeued, 0); assert.equal(h.refreshes, 1);
  assert.equal(JSON.parse(h.requests[1].body).action, 'archive');
});
