const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
const compile = relative => {
  const filename = path.join(project, relative);
  return { filename, code: ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText };
};
const component = compile('src/components/QualityManager.tsx'), types = compile('src/lib/managerTypes.ts');
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' || !tree.props ? [] : [tree, ...nodes(tree.props.children)];
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, async json() { return value; } });
const assessment = (number, extra = {}) => ({ reviewId: `fixture-${number}`, title: `Video ${number}`, createdAt: '2026-10-13T10:00:00Z', decision: 'AWAITING_REVIEW', blockers: [], checks: ['Watch the complete export.'], ...extra });
const state = (assessments = Array.from({ length: 8 }, (_, index) => assessment(index + 1))) => ({ assessments, queued: 0, running: 0, failed: 0, guidance: { feedbackCount: 0, rules: [], revision: 'fixture' }, capabilities: { learning: 'Structured feedback, no retraining.', animation: 'Limited 2D' } });

// Inert JSX and mocked local endpoints only: no browser, app, owner state,
// credential store, providers, real timers, video decoder or model is loaded.
function harness(options = {}) {
  let index = 0, tree;
  const slots = [], effects = [], pending = [], requests = [];
  const hooks = {
    useState(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
    useCallback(callback, dependencies) { const at = index++, old = slots[at]; if (!old || dependencies.some((value, offset) => !Object.is(value, old.dependencies[offset]))) slots[at] = { callback, dependencies }; return slots[at].callback; },
    useEffect(callback, dependencies) { const at = index++, old = effects[at]; if (!old || dependencies.some((value, offset) => !Object.is(value, old[offset]))) { effects[at] = [...dependencies]; pending.push(callback); } },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = { react: hooks, 'next/link': 'a', 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('Fragment') } };
  const fetch = async (url, init = {}) => {
    assert.ok(['/api/manager/status', '/api/manager/feedback'].includes(url));
    const request = { url, ...init }; requests.push(request);
    return options.fetch ? options.fetch(request) : response(state());
  };
  function load(source, suffix = '') {
    const module = { exports: {} };
    new vm.Script(source.code + suffix, { filename: source.filename }).runInNewContext({ module, exports: module.exports, Date, Error, AbortSignal: { timeout() { return new AbortController().signal; } }, fetch, require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Unexpected manager import: ' + name); return dependencies[name]; } }, { timeout: 1000 });
    return module.exports;
  }
  dependencies['@/lib/managerTypes'] = load(types);
  const exports = load(component, '\nexports.FeedbackForm = FeedbackForm;');
  const Component = options.form ? exports.FeedbackForm : exports.default;
  const props = options.props || {};
  function render() { index = 0; tree = Component(props); while (pending.length) pending.shift()(); return tree; }
  async function settle() { for (let pass = 0; pass < 10; pass++) { await Promise.resolve(); render(); } return tree; }
  const find = (type, match) => nodes(tree).find(node => node.type === type && (typeof match === 'function' ? match(node) : text(node) === match));
  render();
  return { render, settle, find, all: type => nodes(tree).filter(node => node.type === type), requests, tree: () => tree };
}

test('the newest review is selected and the list shows at most six videos with working pagination', async () => {
  const ui = harness(); await ui.settle();
  assert.equal(ui.all('button').filter(node => node.props['aria-pressed'] !== undefined).length, 6);
  assert.equal(ui.find('a', 'Watch / edit').props.href, '/dashboard/edit/fixture-1');
  assert.equal(ui.find('button', 'Previous').props.disabled, true);
  ui.find('button', 'Next').props.onClick(); ui.render();
  assert.equal(ui.all('button').filter(node => node.props['aria-pressed'] !== undefined).length, 2);
  assert.equal(ui.find('button', 'Next').props.disabled, true);
  const seventh = ui.find('button', node => text(node).startsWith('Video 7'));
  seventh.props.onClick(); ui.render();
  assert.equal(ui.find('a', 'Watch / edit').props.href, '/dashboard/edit/fixture-7');
  assert.equal(ui.all('select').length, 0, 'No full-library video dropdown');
  ui.find('button', 'Previous').props.onClick(); ui.render();
  assert.match(text(ui.tree()), /Page 1 of 2/);
});

test('a requested review remains selected and its real blockers are not hidden in details', async () => {
  const selected = assessment(8, { decision: 'BLOCKED', blockers: ['Repair missing audio before posting.'] });
  const ui = harness({ props: { initialReviewId: selected.reviewId }, fetch: () => response(state([assessment(1), selected])) });
  await ui.settle();
  assert.equal(ui.find('a', 'Watch / edit').props.href, '/dashboard/edit/fixture-8');
  const blocker = ui.find('p', 'Repair missing audio before posting.');
  assert.equal(blocker.props.role, 'alert');
  assert.ok(ui.all('details').every(details => !nodes(details).includes(blocker)));
  assert.ok(ui.all('details').every(details => !details.props.open), 'Checks/guidance/limits start collapsed');
});

test('compact feedback controls preserve the saved values and save only the selected video', async () => {
  let saved = 0;
  const review = assessment(3, { feedback: { ratings: { story: 4, visuals: 4, audio: 4, captions: 1 }, decision: 'revise', requests: ['matching-visuals'], note: 'Existing private reference.' } });
  const ui = harness({ form: true, props: { assessment: review, onSaved: async () => { saved++; } }, fetch: request => response(JSON.parse(request.body)) });
  const details = ui.all('details')[0];
  assert.equal(details.props.open, undefined); assert.equal(nodes(details).filter(node => node.type === 'select').length, 4);
  assert.equal(ui.all('textarea')[0].props.rows, 2);
  ui.find('button', 'Remove repeated points and filler').props.onClick(); ui.render();
  ui.find('button', 'Keep — reviewed').props.onClick(); ui.render();
  const selects = ui.all('select'); selects[3].props.onChange({ target: { value: '4' } }); ui.render();
  ui.all('textarea')[0].props.onChange({ target: { value: 'Note stays local; never a prompt.' } }); ui.render();
  await ui.all('form')[0].props.onSubmit({ preventDefault() {} }); ui.render();
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].url, '/api/manager/feedback');
  const payload = JSON.parse(ui.requests[0].body);
  assert.equal(payload.reviewId, 'fixture-3'); assert.equal(payload.decision, 'keep'); assert.equal(payload.ratings.captions, 4);
  assert.deepEqual(payload.requests, ['matching-visuals', 'less-repetition']); assert.equal(payload.note, 'Note stays local; never a prompt.');
  assert.equal(saved, 1); assert.match(text(ui.tree()), /Saved\. New matching work/);
});

test('failed feedback writes report the cause without showing a saved notice', async () => {
  let saved = 0;
  const ui = harness({ form: true, props: { assessment: assessment(1), onSaved: async () => { saved++; } }, fetch: () => response({ error: 'Feedback store is read-only.' }, 400) });
  await ui.all('form')[0].props.onSubmit({ preventDefault() {} }); ui.render();
  assert.equal(saved, 0); assert.match(text(ui.tree()), /Feedback store is read-only/); assert.doesNotMatch(text(ui.tree()), /Saved\. New matching/);
});

test('footage reviews expose only the improvement choices with real non-narrated consumers',()=>{
  const ui=harness({form:true,props:{assessment:assessment(1,{creationType:'source'}),onSaved:async()=>{}}});
  assert.ok(ui.find('button','Remove repeated points and filler'));
  assert.ok(ui.find('button','Describe actions the visuals can show'));
  assert.equal(ui.find('button','Explain the point with concrete details'),undefined);
  assert.equal(ui.find('button','Deliver what the opening promises'),undefined);
  assert.equal(ui.find('button','Use shorter, natural spoken sentences'),undefined);
  assert.match(text(ui.tree()),/Flow/);
});

test('a failed refresh leaves the saved review usable and exposes the request error', async () => {
  let count = 0;
  const ui = harness({ fetch: () => ++count === 1 ? response(state()) : response({ error: 'Manager store unavailable.' }, 400) });
  await ui.settle();
  await ui.find('button', 'Refresh').props.onClick(); await ui.settle();
  assert.equal(ui.find('a', 'Watch / edit').props.href, '/dashboard/edit/fixture-1');
  assert.equal(ui.find('p', 'Manager store unavailable.').props.role, 'alert');
});
