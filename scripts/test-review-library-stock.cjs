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
    query(value) { const input = nodes(tree, node => node.props?.['aria-label'] === 'Search videos')[0]; input.props.onChange({ target: { value } }); h.render(); },
    button(label) { return nodes(tree, node => typeof node.props?.onClick === 'function' && text(node) === label)[0]; },
    setRecords(value) { records = value; h.render(); },
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

test('SSR retains video-specific copy and preview with one collapsed posting and export entry', t => {
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
  assert.match(html, /Post \/ export/);
  assert.doesNotMatch(html, /Download for Instagram|Download for YouTube|Copy Instagram text|Copy YouTube text/);
  assert.doesNotMatch(html, />Download<\/a>/);
  assert.doesNotMatch(html, /https:\/\/www\.youtube\.com\/upload|https:\/\/www\.instagram\.com\//);
  assert.match(html, /No on-screen subtitles\./);
  assert.match(html, /<details[^>]*><summary[^>]*aria-label="About your video library"/);
  const info = /<details[^>]*><summary[^>]*aria-label="About your video library"[\s\S]*?<\/details>/.exec(html)?.[0];
  assert.ok(info, 'Library guidance sits in the info disclosure beside the count');
  assert.doesNotMatch(info, /^<details[^>]*\bopen(?:\s|=|>)/);
  assert.match(info, /Preview, edit, then post[\s\S]*Videos without a confirmed Phoenix post/);
  assert.equal((html.match(/Preview, edit, then post/g) || []).length, 1);
  assert.match(html, /<details[^>]*><summary[^>]*>Caption &amp; hashtags<\/summary>/);
});

test('footage has no scoring/recommendation controls while source-episode ranking remains', t => {
  const processing = { jobId: 'fixture', start: 0, end: 45, format: '9:16', audioDecision: 'preserved', score: 80, rank: 1, reason: 'Fixture score rationale', subtitleDecision: 'none' };
  const h = harness(t, [fixture('stock-score', 'Footage reel', { source: files[0].source, processing }), fixture('episode-score', 'Episode clip', { processing }), fixture('edited-stock-score', 'Edited footage reel', { source: files[0].source, editedFrom: 'stock-score', processing })]);
  const cards = nodes(h.tree, node => node.type === 'article');
  assert.equal(cards.length, 3);
  assert.doesNotMatch(text(cards[0]), /Manager recommendation|Fixture score rationale|Rate this video/);
  assert.match(text(cards[1]), /Manager recommendation/);
  assert.match(text(cards[1]), /Fixture score rationale/);
  assert.match(text(cards[1]), /Rate this video/);
  assert.match(text(cards[0]), /Posting details & quality notes/);
  assert.doesNotMatch(text(cards[2]), /Manager recommendation|Fixture score rationale|Rate this video/);
});

test('a full library mounts only six lazy poster cards and no eager video players while every page remains reachable', t => {
  const records = Array.from({ length: 101 }, (_, index) => fixture(`video-${index}`, `Saved video ${index}`));
  const h = harness(t, records);
  assert.equal(h.titles().length, 6);
  assert.match(text(h.tree), /Showing 1–6 of 101 videos/);
  assert.equal(nodes(h.tree, node => node.type === 'video').length, 0);
  const posters = () => nodes(h.tree, node => node.type?.name === 'Poster');
  assert.equal(posters().length, 6);
  posters()[0].props.onPlay(); h.render();
  const player = () => nodes(h.tree, node => node.type?.name === 'ReviewPlayer');
  assert.equal(player().length, 1); assert.equal(player()[0].props.file.id, 'video-0');
  h.button('Next').props.onClick(); h.render();
  assert.deepEqual(h.titles(), records.slice(6, 12).map(item => item.title));
  assert.match(text(h.tree), /Showing 7–12 of 101 videos/);
  assert.equal(posters().length, 6); assert.equal(player().length, 1);
  assert.equal(player()[0].props.file.id, 'video-0', 'Paging keeps the currently open preview intact');
  h.setRecords(records.slice(0, 1));
  assert.deepEqual(h.titles(), ['Saved video 0']);
  assert.match(text(h.tree), /Showing 1–1 of 1 videos/);
  assert.equal(player().length, 1, 'A refresh that shrinks page count does not close the preview');
  assert.equal(records.length, 101, 'Only presentation changes; no video removal is requested');
});

test('caption searches are trimmed and clear filters restores saved videos without any fetch or analysis', t => {
  const records = [fixture('stream', 'Nature reel'), fixture('city', 'Travel reel', { quality: { ...files[0].quality, postCopy: 'Trams cross the city at dusk.', hashtags: ['#CityTrams'] } })];
  const h = harness(t, records);
  h.query('  city at dusk  '); assert.deepEqual(h.titles(), ['Travel reel']);
  assert.match(text(h.tree), /of 1 matching videos/);
  h.query('absent topic'); assert.deepEqual(h.titles(), []);
  assert.match(text(h.tree), /No videos match these filters/);
  assert.ok(h.button('Clear filters')); h.button('Clear filters').props.onClick(); h.render();
  assert.deepEqual(h.titles(), ['Nature reel', 'Travel reel']);
  assert.equal(h.button('Clear filters'), undefined);
});

test('Generated and Posted views separate confirmed uploads while category and caption searches still apply', t => {
  const posted = { status: 'POSTED', postedTo: [{ platform: 'instagram', remoteId: '123', remoteUrl: 'https://www.instagram.com/reel/Fixture123/' }] };
  const records = [fixture('new-stock', 'New stock reel', { source: files[0].source }), fixture('posted-stock', 'Posted stock reel', { source: files[1].source, publication: posted }), fixture('posted-upload', 'Posted upload', { publication: { status: 'POSTED', postedTo: [{ platform: 'youtube', remoteId: 'Abcdef_1234' }] } }), fixture('invalid-posted', 'Unconfirmed history', { publication: { status: 'POSTED', postedTo: [], inspectionIssue: true } })];
  const h = harness(t, records);
  assert.deepEqual(h.titles(), ['New stock reel', 'Unconfirmed history']);
  assert.equal(h.button('Generated · 2').props['aria-pressed'], true);
  h.button('Posted · 2').props.onClick(); h.render();
  assert.deepEqual(h.titles(), ['Posted stock reel', 'Posted upload']);
  assert.match(text(h.tree), /Posted to Instagram ↗/); assert.match(text(h.tree), /Posted to YouTube/);
  assert.match(text(h.tree), /Story-only uploads are not counted/);
  h.filter('stock'); assert.deepEqual(h.titles(), ['Posted stock reel']);
  h.query('not present'); assert.deepEqual(h.titles(), []);
  h.button('Clear filters').props.onClick(); h.render();
  assert.deepEqual(h.titles(), ['Posted stock reel', 'Posted upload']);
  h.button('Generated · 2').props.onClick(); h.render();
  assert.deepEqual(h.titles(), ['New stock reel', 'Unconfirmed history']);
  assert.match(text(h.tree), /Posting history could not be confirmed/);
});

test('each posting view has independent bounded paging and switching closes the single preview', t => {
  const posted = { status: 'POSTED', postedTo: [{ platform: 'instagram', remoteId: '123' }] };
  const records = Array.from({ length: 20 }, (_, index) => fixture(`split-${index}`, `Split video ${index}`, index < 8 ? { publication: posted } : {}));
  const h = harness(t, records);
  assert.deepEqual(h.titles(), records.slice(8, 14).map(item => item.title));
  h.button('Next').props.onClick(); h.render();
  assert.deepEqual(h.titles(), records.slice(14, 20).map(item => item.title));
  const firstPoster = nodes(h.tree, node => node.type?.name === 'Poster')[0]; firstPoster.props.onPlay(); h.render();
  assert.equal(nodes(h.tree, node => node.type?.name === 'ReviewPlayer').length, 1);
  h.button('Posted · 8').props.onClick(); h.render();
  assert.deepEqual(h.titles(), records.slice(0, 6).map(item => item.title));
  assert.equal(nodes(h.tree, node => node.type?.name === 'ReviewPlayer').length, 0);
  assert.match(text(h.tree), /Showing 1–6 of 8 videos/);
  h.button('Next').props.onClick(); h.render();
  assert.deepEqual(h.titles(), records.slice(6, 8).map(item => item.title));
});

test('an older posted output stays Generated with clear version wording and Posted has its own empty state', t => {
  const h = harness(t, [fixture('revised-output', 'Revised video', { publication: { status: 'GENERATED', postedTo: [], previouslyPostedTo: [{ platform: 'instagram', remoteId: '123' }] } })]);
  assert.deepEqual(h.titles(), ['Revised video']);
  assert.match(text(h.tree), /An earlier version was posted; this output is new or changed/);
  h.button('Posted · 0').props.onClick(); h.render();
  assert.deepEqual(h.titles(), []); assert.match(text(h.tree), /No confirmed posts yet/);
});
