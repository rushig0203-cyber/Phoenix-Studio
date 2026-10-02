const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });

// Exercise real library JSX and filter handlers; never start a server or decode media.
let activeHarness;
const originalLoad = Module._load;
Module._load = function (name, parent, ...args) {
  if (name === 'react' && parent?.filename.endsWith(`${path.sep}ReviewLibrary.tsx`)) return {
    ...React,
    useState: initial => activeHarness ? activeHarness.state(initial) : React.useState(initial),
    useRef: initial => activeHarness ? activeHarness.ref(initial) : React.useRef(initial),
  };
  return originalLoad.call(this, name, parent, ...args);
};
let ReviewLibrary;
try { ReviewLibrary = require('../src/components/ReviewLibrary').default; }
finally { Module._load = originalLoad; }

function fixture(id, title, patch = {}) {
  return {
    id, title, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    status: 'READY', targets: ['instagram'], audience: 'general',
    source: { kind: 'upload', filename: 'episode.mp4', licence: 'Owner supplied' },
    outputs: { instagram: { filename: `${id}.mp4`, duration: 45, width: 720, height: 1280 } },
    quality: { audio: 'natural-audio-preserved', captions: [], hashtags: ['#ForestStream'], postCopy: 'A forest stream passes beneath the trees.', checks: [] },
    ...patch,
  };
}
const files = [
  fixture('pexels-reel', 'Pexels sequence', { source: { kind: 'pexels', filename: 'shot-1-pexels-41.mp4', licence: 'Pexels License' } }),
  fixture('pixabay-reel', 'Pixabay sequence', { source: { kind: 'pixabay', filename: 'shot-1-pixabay-41.mp4', licence: 'Pixabay Content License' } }),
  fixture('legacy-reel', 'Legacy stock export', { source: { kind: 'upload', filename: 'stock-legacy.mp4', licence: 'Legacy stock' } }),
  fixture('child-reel', 'Children story', { audience: 'kids-3-6', source: { kind: 'pixabay', filename: 'background.mp4', licence: 'Pixabay Content License' } }),
  fixture('edited-reel', 'Edited stock copy', { editedFrom: 'pexels-reel', source: { kind: 'pexels', filename: 'shot-1-pexels-41.mp4', licence: 'Pexels License' } }),
  fixture('upload-reel', 'Uploaded episode clip'),
];
const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' ? text(value.props?.children) : String(value);
function nodes(value, predicate, result = []) {
  if (Array.isArray(value)) value.forEach(child => nodes(child, predicate, result));
  else if (value && typeof value === 'object') { if (predicate(value)) result.push(value); nodes(value.props?.children, predicate, result); }
  return result;
}
function harness(t, records = files) {
  let position = 0, tree;
  const hooks = [];
  const h = {
    state(initial) {
      const index = position++;
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, value => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value; }];
    },
    ref(initial) { const index = position++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    render() { position = 0; activeHarness = h; tree = ReviewLibrary({ files: records, loading: false, onRefresh: async () => {} }); return tree; },
    filter(value) { const input = nodes(tree, node => node.props?.['aria-label'] === 'Video category')[0]; input.props.onChange({ target: { value } }); h.render(); },
    titles() { return nodes(tree, node => node.type === 'h3').map(text); },
    get tree() { return tree; },
  };
  t.after(() => { activeHarness = undefined; });
  h.render(); return h;
}

test('stock filter includes both provider kinds and legacy stock names without capturing children, edits or uploads', t => {
  const h = harness(t);
  h.filter('stock'); assert.deepEqual(h.titles(), ['Pexels sequence', 'Pixabay sequence', 'Legacy stock export']);
  h.filter('children'); assert.deepEqual(h.titles(), ['Children story']);
  h.filter('edited'); assert.deepEqual(h.titles(), ['Edited stock copy']);
  h.filter('source'); assert.deepEqual(h.titles(), ['Uploaded episode clip']);
});

test('creation-type children and edited children retain precedence over provider stock kind', t => {
  const records = [
    fixture('typed-child', 'Typed children video', { source: files[0].source, delivery: { creationType: 'children-story' } }),
    fixture('edited-child', 'Edited children video', { source: files[1].source, audience: 'kids-3-6', editedFrom: 'typed-child' }),
  ];
  const h = harness(t, records);
  h.filter('children'); assert.deepEqual(h.titles(), ['Typed children video']);
  h.filter('edited'); assert.deepEqual(h.titles(), ['Edited children video']);
  h.filter('stock'); assert.deepEqual(h.titles(), []);
});

test('mixed-provider provenance labels and React keys distinguish equal numeric media IDs', t => {
  const visualSources = ['pexels', 'pixabay'].map(provider => ({ provider, providerMediaId: '41', providerUrl: `https://${provider}.com/41`, creator: 'Fixture creator', licence: `${provider} licence` }));
  const h = harness(t, [fixture('mixed', 'Mixed provider sequence', { source: files[0].source, quality: { ...files[0].quality, visualSources } })]);
  const links = nodes(h.tree, node => node.type === 'a' && visualSources.some(source => source.providerUrl === node.props.href));
  assert.deepEqual(links.map(text), ['Pexels #41', 'Pixabay #41']);
  assert.deepEqual(links.map(node => node.key), ['pexels:41', 'pixabay:41']);
  assert.equal(new Set(links.map(node => node.key)).size, 2);
});

test('SSR retains video-specific posting copy, hashtags, preview, downloads and manual platform handoff', t => {
  activeHarness = undefined;
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error('SSR must not call a provider or a local API'); };
  t.after(() => { global.fetch = originalFetch; });
  const file = fixture('ready-stock', 'Quiet woodland stream', {
    source: { kind: 'pexels', filename: 'shot-1-pexels-41.mp4', licence: 'Pexels License' },
    quality: { ...files[0].quality, captions: [], postingAnalysis: { status: 'COMPLETE', attempts: 1, updatedAt: '2026-10-02T00:00:00.000Z', detail: 'Three sampled frames checked.' } },
  });
  const html = renderToStaticMarkup(React.createElement(ReviewLibrary, { files: [file], loading: false, onRefresh: async () => {} }));
  assert.match(html, /Stock video/);
  assert.match(html, /A forest stream passes beneath the trees\./);
  assert.match(html, /#ForestStream/);
  assert.match(html, /Video-specific copy: Three sampled frames checked\./);
  assert.match(html, /Preview Quiet woodland stream/);
  assert.match(html, /Copy caption \+ hashtags/);
  assert.match(html, /Download for Instagram/); assert.match(html, /Download for YouTube/);
  assert.match(html, /https:\/\/www\.youtube\.com\/upload/); assert.match(html, /https:\/\/www\.instagram\.com\//);
  assert.match(html, /do not upload or publish automatically/);
  assert.match(html, /No on-screen subtitles\./);
});
