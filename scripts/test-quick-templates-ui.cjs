const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(project, relative), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new vm.Script(code, { filename }).runInNewContext({ module, exports: module.exports, ...globals,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected template dependency: ${name}`); return dependencies[name]; },
  }, { timeout: 1000 });
  return module.exports;
}
const content = load('src/lib/contentIdeas.ts');
const suggestions = load('src/lib/stockFootageSuggestions.ts', { './contentIdeas': content });
const saved = load('src/lib/quickTemplates.ts');
const activityJsx = (type, props, key) => ({ type, props, key });
const Activity = load('src/components/StudioActivity.tsx', { 'react/jsx-runtime': { jsx: activityJsx, jsxs: activityJsx } }).default;
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' || !tree.props ? [] : [tree, ...nodes(tree.props.children)];
const plain = value => JSON.parse(JSON.stringify(value));
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return value; } });
const uuid = '11111111-1111-4111-8111-111111111111';
const context = { now: Date.parse('2026-11-17T12:00:00Z'), recent: [
  { reviewId: 'panda', title: 'Panda eating bamboo', observations: ['Panda eating bamboo'], workflow: 'stock-reel', posted: true, createdAt: '2026-11-16' },
  { reviewId: 'rabbit', title: 'Rabbit in a meadow', observations: ['Rabbit in a meadow'], workflow: 'stock-reel', posted: true, createdAt: '2026-11-15' },
], feedback: [], strongerTopics: [] };

// Real UI handlers with inert JSX and isolated API fixtures. No server, provider,
// owner job, credential, model, media download or real timers are reachable.
async function harness(options = {}) {
  let index = 0, tree, request = options.request || null, job = options.job, uuids = 0;
  const slots = [], effects = [], pending = [], cleanups = [], requests = [], started = [], states = [], stored = new Map();
  const hooks = {
    useState(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
    useRef(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(callback, dependencies) { const at = index++, previous = effects[at]; if (!previous || dependencies.some((value, offset) => !Object.is(value, previous[offset]))) { effects[at] = [...dependencies]; pending.push(callback); } },
  };
  const jsx = (type, props, key) => type === Activity ? Activity(props) : ({ type, props, key });
  const Component = load('src/components/QuickTemplates.tsx', { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/stockFootageSuggestions': suggestions, './JobProgress': 'JobProgress', './StudioActivity': { default: Activity } }, {
    Error, URLSearchParams, AbortController, AbortSignal,
    localStorage: { getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { stored.set(key, value); } },
    window: { setInterval() { return 1; }, clearInterval() {} },
    crypto: { randomUUID() { uuids++; return uuid; } },
    async fetch(url, init = {}) {
      requests.push({ url, ...init });
      if (url.startsWith('/api/content-suggestions?')) {
        assert.ok(!init.method); const query = new URL(url, 'http://fixture').searchParams;
        assert.equal(query.get('workflow'), 'footage');
        return response(suggestions.personalizedStockSuggestions(context, Number(query.get('cursor')), query.get('seen').split(',').filter(Boolean)));
      }
      assert.equal(url, '/api/stock-reels'); assert.equal(init.method, 'POST');
      return options.post ? options.post(init) : response({ job: { id: 'exact-template-job' } }, 201);
    },
  }).default;
  let retries = 0;
  function render() { index = 0; tree = Component({ request, job, onRequest(value) { request = value; states.push(plain(value)); }, onStarted(message) { started.push(message); }, onRetry() { retries++; } }); while (pending.length) { const cleanup = pending.shift()(); if (cleanup) cleanups.push(cleanup); } }
  async function flush() { for (let count = 0; count < 12; count++) await Promise.resolve(); render(); }
  const cards = () => nodes(tree).filter(node => node.props['data-quick-template'] !== undefined);
  const button = label => nodes(tree).find(node => node.type === 'button' && text(node) === label);
  render(); await flush();
  return { cards, button, render, flush, requests, started, states, get request() { return request; }, get tree() { return tree; }, get uuids() { return uuids; }, get retries() { return retries; }, setJob(value) { job = value; render(); }, unmount() { cleanups.forEach(cleanup => cleanup()); } };
}

test('Create reads saved preferences into six templates without searching providers or starting jobs', async () => {
  const h = await harness();
  assert.equal(h.cards().length, 6); assert.equal(h.requests.length, 1); assert.equal(h.uuids, 0);
  assert.equal(nodes(h.tree).filter(node => node.type === 'input' || node.type === 'select').length, 0);
  const before = h.cards().map(node => node.key); h.button('More templates').props.onClick(); await h.flush();
  assert.equal(h.cards().length, 6); assert.ok(h.cards().every(node => !before.includes(node.key)));
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 0);
});

test('one click submits the exact displayed topic and blocks repeated dispatch before confirmation', async () => {
  let confirm; const gate = new Promise(resolve => { confirm = resolve; });
  const h = await harness({ post: () => gate }), card = h.cards()[0], title = card.props['aria-label'].slice('Make video: '.length);
  card.props.onClick(); card.props.onClick(); h.render();
  const posts = h.requests.filter(request => request.method === 'POST');
  assert.equal(posts.length, 1); assert.deepEqual(JSON.parse(posts[0].body), { automatic: true, query: title, requestId: uuid });
  assert.equal(h.started.length, 0); assert.match(text(h.tree), /Preparing your video/);
  assert.equal(h.states[0].title, title); assert.equal(h.request.jobId, undefined);
  confirm(response({ job: { id: 'exact-template-job' } }, 201)); await h.flush();
  assert.equal(h.request.jobId, 'exact-template-job'); assert.equal(h.started.length, 1);
});

test('failed confirmation and reopening retain the UUID and exact topic without resubmitting on load', async () => {
  let attempt = 0;
  const h = await harness({ post() { if (++attempt === 1) throw new Error('Fixture connection lost'); return response({ job: { id: 'exact-template-job' } }); } });
  h.cards()[0].props.onClick(); await h.flush(); const persisted = plain(h.request);
  assert.equal(h.started.length, 0); assert.equal(h.button('Choose another template'), undefined);
  h.button('Retry confirmation').props.onClick(); await h.flush();
  assert.equal(h.uuids, 1); assert.deepEqual(h.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body).requestId), [uuid, uuid]);
  const reopened = await harness({ request: persisted });
  assert.equal(reopened.requests.filter(request => request.method === 'POST').length, 0); assert.equal(reopened.uuids, 0);
  reopened.button('Retry confirmation').props.onClick(); await reopened.flush();
  assert.equal(JSON.parse(reopened.requests.at(-1).body).query, persisted.query); assert.equal(reopened.request.requestId, persisted.requestId);
});

test('failed saved videos retry their job while a definite unavailable template can be changed', async () => {
  const request = { requestId: uuid, templateId: 'footage-owls', title: 'Owls', query: 'Owls', jobId: 'failed-job' };
  const h = await harness({ request, job: { status: 'FAILED', progress: 20, error: 'Fixture interrupted export' } });
  assert.match(text(h.tree), /Fixture interrupted export/); h.button('Retry video').props.onClick(); assert.equal(h.retries, 1);
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 0);
  const unavailable = await harness({ post: () => response({ error: 'No related eligible footage' }, 400) });
  unavailable.cards()[0].props.onClick(); await unavailable.flush(); unavailable.button('Choose another template').props.onClick(); await unavailable.flush();
  assert.equal(unavailable.request, null); assert.equal(unavailable.cards().length, 6);
});

test('durable requests reject malformed input and completed review selection requires the exact job', () => {
  const request = { requestId: uuid, templateId: 'footage-owls', title: 'Owls', query: 'Owls', jobId: 'exact-job' };
  assert.deepEqual(plain(saved.parseQuickTemplateRequest(JSON.stringify(request))), request);
  for (const value of [null, '{broken', JSON.stringify({ ...request, requestId: 'wrong' }), JSON.stringify({ ...request, jobId: '../wrong' }), JSON.stringify({ ...request, query: '\nOwls' })]) assert.equal(saved.parseQuickTemplateRequest(value), null);
  const files = [{ id: 'unrelated-newest', status: 'READY', processing: { jobId: 'other-job' } },
    { id: 'still-processing', status: 'PROCESSING', processing: { jobId: 'exact-job' } },
    { id: 'exact-output', status: 'READY', processing: { jobId: 'exact-job' } }];
  assert.equal(saved.quickTemplateReview(files, 'exact-job').id, 'exact-output');
  assert.equal(saved.quickTemplateReview(files, 'missing-job'), undefined); assert.equal(saved.quickTemplateReview(files), undefined);
});

test('accepted tracking can return to templates without cancelling, retrying or creating a saved job', async () => {
  const request = { requestId: uuid, templateId: 'footage-owls', title: 'Owls', query: 'Owls', jobId: 'no-longer-in-visible-history' };
  const h = await harness({ request });
  assert.match(text(h.tree), /Checking your video/); assert.doesNotMatch(text(h.tree), /Queued\.|\d+%/);
  assert.equal(nodes(h.tree).filter(node => node.type === 'JobProgress').length, 0, 'Missing job data cannot invent Queued or zero percent progress');
  assert.match(h.button('Back to templates').props.title, /saved job continues/);
  h.button('Back to templates').props.onClick(); await h.flush();
  assert.equal(h.request, null); assert.equal(h.cards().length, 6); assert.equal(h.retries, 0);
  assert.ok(h.requests.every(request => !request.method), 'Dismissal is UI-only and never changes saved work');
});
