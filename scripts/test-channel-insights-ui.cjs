const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/components/ChannelInsights.tsx');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' || !tree.props ? [] : [tree, ...nodes(tree.props.children)];
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, async json() { return value; } });
const facebook = (extra = {}) => ({ status: 'ready', detail: 'Saved basic Facebook video statistics.', account: { name: 'Fixture Page' }, lastSuccessfulSyncAt: '2026-11-08T10:00:00Z', videos: Array.from({ length: 7 }, (_, index) => ({ id: `${100 + index}`, caption: `Facebook ${index + 1}`, timestamp: `2026-11-${String(index + 1).padStart(2, '0')}T10:00:00Z`, permalink: `https://www.facebook.com/reel/${100 + index}/`, metrics: { views: 100 + index, likes: 0, comments: null, shares: null } })), ...extra });

function harness(fetcher, props = {}) {
  let index = 0, tree;
  const slots = [], effects = [], pending = [], requests = [];
  const hooks = {
    useState(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; }]; },
    useRef(initial) { const at = index++; return slots[at] ||= { current: initial }; },
    useCallback(callback, dependencies) { const at = index++, old = slots[at]; if (!old || dependencies.some((value, offset) => !Object.is(value, old.dependencies[offset]))) slots[at] = { callback, dependencies }; return slots[at].callback; },
    useEffect(callback, dependencies) { const at = index++, old = effects[at]; if (!old || dependencies.some((value, offset) => !Object.is(value, old.dependencies[offset]))) { old?.cleanup?.(); effects[at] = { callback, dependencies }; pending.push(() => { effects[at].cleanup = callback(); }); } },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('Fragment') }, './InstagramPerformance': { default: () => null } };
  const mod = { exports: {} };
  new vm.Script(source, { filename }).runInNewContext({ module: mod, exports: mod.exports, URL, AbortController, setTimeout, clearTimeout,
    async fetch(url, init = {}) { requests.push({ url, ...init }); return fetcher ? fetcher(url, init, requests.length) : response(url === '/api/channels' ? { channels: [{ platform: 'facebook', name: 'Fixture Page', connected: true }, { platform: 'youtube', connected: false }] } : facebook()); },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected UI import: ${name}`); return dependencies[name]; },
  }, { timeout: 1000 });
  function render() { index = 0; tree = mod.exports.default(props); while (pending.length) pending.shift()(); return tree; }
  async function settle() { for (let pass = 0; pass < 15; pass++) { await Promise.resolve(); render(); } return tree; }
  const all = type => nodes(tree).filter(node => node.type === type);
  const find = (type, match) => all(type).find(node => typeof match === 'function' ? match(node) : text(node) === match);
  render();
  return { render, settle, all, find, requests, tree: () => tree, select(name) { find('button', name).props.onClick(); render(); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}

test('Insights has its own screen, and Settings links there while Library stays focused on videos', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/DashboardClient.tsx'), 'utf8');
  const libraryBranch = dashboard.slice(dashboard.indexOf('{section === "library"'), dashboard.indexOf('{section === "insights"', dashboard.indexOf('{section === "library"')));
  assert.ok(libraryBranch.includes('<ReviewLibrary'));
  assert.doesNotMatch(libraryBranch, /<ChannelInsights|<InstagramPerformance/);
  assert.match(dashboard, /section === "insights"[\s\S]*<ChannelInsights/);
  assert.match(dashboard, /<a href="#insights"[^>]*>Channel insights<\/a>/, 'Same-page Settings action must emit the native hashchange');
  const settings = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/settings/page.tsx'), 'utf8');
  assert.match(settings, /href="\/dashboard#insights"/); assert.doesNotMatch(settings, /<ChannelInsights/);
});

test('platform selection reads saved Facebook stats and only refresh explicitly collects new statistics', async () => {
  const ui = harness(); await ui.settle();
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].url, '/api/channels');
  assert.equal(ui.find('button', 'Instagram').props['aria-pressed'], true);
  ui.select('Facebook'); await ui.settle();
  assert.equal(ui.requests[1].url, '/api/facebook-performance'); assert.equal(ui.requests[1].method, undefined);
  const rows = () => ui.all('details').filter(node => node.props['data-facebook-result']);
  assert.equal(rows().length, 5); assert.ok(rows().every(row => row.props.open === undefined));
  assert.match(text(rows()[0]), /^Facebook 7/); assert.equal(ui.all('table').length, 0);
  ui.find('button', 'Next').props.onClick(); ui.render(); assert.equal(rows().length, 2);
  assert.match(text(ui.tree()), /Page 2 of 2/);
  ui.find('button', 'Refresh insights').props.onClick(); await ui.settle();
  assert.equal(ui.requests[2].method, 'POST'); assert.deepEqual(JSON.parse(ui.requests[2].body), { action: 'refresh' });
  assert.ok(ui.requests.every(request => !/publish|generation|render/.test(request.url)));
  ui.unmount();
});

test('Facebook displays real zeroes and unavailable values distinctly and preserves cached results on error', async () => {
  let checks = 0;
  const sample = facebook({ videos: [{ id: '1234', caption: 'Zero views recorded', timestamp: '2026-11-08T10:00:00Z', metrics: { views: 0, likes: null, comments: null, shares: 0 } }] });
  const ui = harness(url => response(url === '/api/channels' ? { channels: [] } : ++checks === 1 ? sample : { error: 'Statistics temporarily unavailable.' }, checks > 1 ? 503 : 200));
  await ui.settle(); ui.select('Facebook'); await ui.settle();
  assert.deepEqual(ui.all('dd').map(text), ['1', '0', '—']); assert.match(text(ui.tree()), /Comments: — · Shares: 0/);
  ui.find('button', 'Refresh insights').props.onClick(); await ui.settle();
  assert.ok(ui.find('p', node => node.props.role === 'alert' && text(node).includes('temporarily unavailable')));
  assert.match(text(ui.tree()), /Zero views recorded/); assert.deepEqual(ui.all('dd').map(text), ['1', '0', '—']);
  ui.unmount();
});

test('YouTube status is verified separately and manual platforms show no invented results or connection badge', async () => {
  const ui = harness(); await ui.settle();
  ui.select('YouTube'); assert.match(text(ui.tree()), /Not connected to Phoenix/);
  assert.equal(ui.find('a', 'Open YouTube Studio ↗').props.href, 'https://studio.youtube.com/');
  for (const platform of ['Rumble', 'Bilibili']) {
    ui.select(platform); assert.match(text(ui.tree()), /Manual analytics/); assert.match(text(ui.tree()), /no verified/);
    assert.equal(ui.all('dd').length, 0); assert.doesNotMatch(text(ui.tree()), /Channel connected|0 views|0 likes/);
  }
  assert.equal(ui.requests.length, 1); ui.unmount();
});

test('Facebook links allow only exact official video URLs and strip unrelated query values', async () => {
  const videos = [
    { id: '11', caption: 'Valid', permalink: 'https://www.facebook.com/reel/12345/?token=private#extra' },
    { id: '12', caption: 'Off-site', permalink: 'https://facebook.com.evil.test/reel/12345/' },
    { id: '13', caption: 'Login', permalink: 'https://www.facebook.com/login/' },
  ].map(video => ({ ...video, timestamp: '2026-11-08T10:00:00Z', metrics: { views: null, likes: null, comments: null, shares: null } }));
  const ui = harness(url => response(url === '/api/channels' ? { channels: [] } : facebook({ videos })));
  await ui.settle(); ui.select('Facebook'); await ui.settle();
  const links = ui.all('a').filter(node => text(node) === 'Open Facebook video');
  assert.equal(links.length, 1); assert.equal(links[0].props.href, 'https://www.facebook.com/reel/12345/'); ui.unmount();
});

test('late Facebook responses cannot replace another platform or install results after unmount', async () => {
  let complete;
  const ui = harness(url => url === '/api/channels' ? response({ channels: [] }) : new Promise(resolve => { complete = resolve; }));
  await ui.settle(); ui.select('Facebook'); ui.select('Rumble');
  complete(response(facebook())); await ui.settle();
  assert.match(text(ui.tree()), /Manual analytics/); assert.equal(ui.all('dd').length, 0);
  ui.select('Facebook'); ui.unmount();
  assert.equal(ui.requests.at(-1).signal.aborted, true);
  complete(response(facebook({ account: { name: 'Late replacement' } }))); await ui.settle();
  assert.doesNotMatch(text(ui.tree()), /Late replacement/);
});

test('posted-video focus matches the saved publication ID and never substitutes other channel videos', async () => {
  const id = 'f0cf5ddf-b713-4c12-a841-284cb07eadf0';
  const review = { id, title: 'Chosen posted reel', publication: { status: 'POSTED', postedTo: [{ platform: 'facebook', remoteId: '106' }] } };
  const ui = harness(undefined, { review, requestedReviewId: id }); await ui.settle();
  assert.equal(ui.find('button', 'Facebook').props['aria-pressed'], true);
  const rows = ui.all('details').filter(node => node.props['data-facebook-result']);
  assert.equal(rows.length, 1); assert.match(text(rows[0]), /^Facebook 7/); assert.equal(rows[0].props.open, true);
  assert.deepEqual(ui.all('dd').map(text), ['1', '106', '0']);
  ui.select('Instagram'); assert.match(text(ui.tree()), /No confirmed Instagram post/); assert.equal(ui.all('dd').length, 0);
  assert.equal(ui.find('a', 'All videos').props.href, '#insights'); ui.unmount();
});

test('a missing posted-video sample remains unavailable rather than showing another Reel', async () => {
  const id = 'f0cf5ddf-b713-4c12-a841-284cb07eadf0';
  const review = { id, title: 'Older posted reel', publication: { status: 'POSTED', postedTo: [{ platform: 'facebook', remoteId: '99999' }] } };
  const ui = harness(undefined, { review, requestedReviewId: id }); await ui.settle();
  assert.equal(ui.all('details').filter(node => node.props['data-facebook-result']).length, 0);
  assert.match(text(ui.tree()), /not in the saved Facebook sample yet/); assert.deepEqual(ui.all('dd').map(text), ['0', '—', '—']); ui.unmount();
});
