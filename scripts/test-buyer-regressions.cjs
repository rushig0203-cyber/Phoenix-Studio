const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { test, after, mock } = require('node:test');
const Module = require('node:module');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-buyer-regressions-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
process.chdir(temporary);
const realFetch = global.fetch;
const stock = require(path.join(project, 'src/lib/naturalStock.ts'));
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const edits = require(path.join(project, 'src/lib/reviewEdits.ts'));
const { artifactReference } = require(path.join(project, 'src/lib/reviewArtifacts.ts'));
const video = { provider: 'pixabay', id: 10, title: 'A waterfall in a forest', sourcePage: 'https://pixabay.com/videos/waterfall-10/', creator: 'Fixture', previewUrl: 'https://cdn.pixabay.com/video/fixture.mp4', duration: 4, width: 320, height: 180 };

test('stock API accepts an empty optional description while keeping the provider title only as the job title', async t => {
  let staged;
  const mocks = [
    mock.method(source, 'findStockSourceJob', async () => null),
    mock.method(source, 'ffmpegAvailable', async () => true),
    mock.method(stock, 'resolveNaturalStock', async () => video),
    mock.method(source, 'createSourceJob', async (...args) => { staged = args; return { id: 'fixture-job' }; }),
  ];
  global.fetch = async url => { assert.equal(String(url), video.previewUrl); return new Response('fixture video bytes', { headers: { 'content-type': 'video/mp4' } }); };
  t.after(() => { mocks.forEach(item => item.mock.restore()); global.fetch = realFetch; });
  const api = require(path.join(project, 'src/app/api/stock-reels/route.ts'));
  const response = await api.POST(new Request('http://localhost:3000/api/stock-reels', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'pixabay', id: 10, requestId: crypto.randomUUID(), caption: '', duration: 60 }) }));
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
  assert.equal(staged[3], video.title);
  assert.equal(staged[5].caption, '', 'A provider title must not replace the owner’s empty posting description');
});

function nodes(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, found));
  else if (node && typeof node === 'object') { if (predicate(node)) found.push(node); nodes(node.props?.children, predicate, found); }
  return found;
}
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);

test('stock Create remains usable after clearing the optional description and submits it unchanged', async t => {
  const react = require('react');
  const previousLoad = Module._load;
  let index = 0;
  Module._load = function (name, parent, ...args) {
    if (name === 'react' && parent?.filename.endsWith(`${path.sep}StockReels.tsx`)) return {
      ...react,
      useState: initial => { const current = index++; return [current === 4 ? video : current === 5 ? '' : initial, () => undefined]; },
      useRef: value => ({ current: value }), useEffect: () => undefined,
    };
    return previousLoad.call(this, name, parent, ...args);
  };
  let component;
  try { component = require(path.join(project, 'src/components/StockReels.tsx')).default; }
  finally { Module._load = previousLoad; }
  let submitted;
  global.fetch = async (url, init) => { assert.equal(url, '/api/stock-reels'); submitted = JSON.parse(init.body); return Response.json({ job: { id: 'fixture-job' } }, { status: 201 }); };
  t.after(() => { global.fetch = realFetch; });
  const tree = component({ onClose() {}, onStarted() {} });
  const button = nodes(tree, node => typeof node.props?.onClick === 'function' && text(node) === 'Create reel from this footage')[0];
  assert.ok(button); assert.equal(button.props.disabled, false);
  button.props.onClick();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(submitted.caption, '');
});

test('caption-free edited copies retain the off choice, custom style and cues for a later explicit opt-in', async t => {
  // Exercise queue/export/persistence without decoding video, running a model,
  // contacting a provider, or depending on the laptop's available memory.
  const calls = [];
  const spawn = mock.method(require('node:child_process'), 'spawn', (command, args, options = {}) => {
    calls.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => {
      if (args.includes('-show_streams')) child.stdout.end(JSON.stringify({ format: { duration: '2' }, streams: [{ codec_type: 'video', width: 320, height: 180 }] }));
      else { if (options.cwd) fs.writeFileSync(path.join(options.cwd, args.at(-1)), 'isolated rendered fixture'); child.stdout.end(); }
      child.emit('close', 0);
    });
    return child;
  });
  const slot = mock.method(resources, 'withLocalRenderSlot', async operation => operation());
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => { spawn.mock.restore(); slot.mock.restore(); priority.mock.restore(); });
  await reviews.ensureReviewFolders();
  const id = crypto.randomUUID(), directory = path.join(reviews.reviewRoot(), 'work', 'fixture');
  fs.mkdirSync(directory, { recursive: true });
  const clean = path.join(directory, 'clean.mp4'), captions = path.join(directory, 'captions.srt');
  fs.writeFileSync(clean, 'isolated clean master');
  fs.writeFileSync(captions, '1\n00:00:00,000 --> 00:00:02,000\nFirst spoken line\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond spoken line\n');
  const now = new Date().toISOString();
  await reviews.saveReviewFile({ id, title: 'Fixture', createdAt: now, updatedAt: now, status: 'READY', targets: ['youtube'], source: { kind: 'upload', filename: 'fixture.mp4', licence: 'Test only' }, outputs: { youtube: { filename: 'fixture.mp4', duration: 4, width: 320, height: 180 } }, audience: 'general', quality: { audio: 'natural-audio-preserved', captions: ['First spoken line', 'Second spoken line'], hashtags: ['#Fixture'], checks: [] }, artifacts: { version: 1, renderRevision: 'fixture', finalVideo: artifactReference(reviews.outputPath(id, 'youtube')), editing: { video: artifactReference(clean), offsetSeconds: 0, captionsBaked: false }, captions: artifactReference(captions) } });
  const initial = await edits.getReviewEditState(id);
  assert.equal(initial.draft.captionsEnabled, true, 'Existing files without saved editing defaults still use their caption cues');
  const draft = { ...initial.draft, trimStart: 1, trimEnd: 3, captionsEnabled: false, captionPosition: 'top', captionSize: 24, captionColor: '#abc123' };
  const queued = await edits.queueReviewEdit(id, draft); await edits.processNextReviewEdit();
  const job = (await edits.listReviewEdits()).find(item => item.id === queued.id);
  assert.equal(job.status, 'COMPLETED', job.error);
  const output = await reviews.getReviewFile(queued.outputId);
  assert.deepEqual(output.quality.captions, [], 'Caption-free render has no visible subtitle metadata');
  assert.deepEqual(output.captionEditing, { enabled: false, position: 'top', size: 24, color: '#abc123' });
  assert.equal(output.captionCues.length, 2, 'Editable speech timing remains available separately');
  assert.ok(!calls.some(args => args.some(arg => String(arg).includes('subtitles='))), 'Disabling subtitles skips the burn-in step');
  const reopened = await edits.getReviewEditState(output.id);
  assert.equal(reopened.draft.captionsEnabled, false);
  assert.equal(reopened.draft.captionPosition, 'top'); assert.equal(reopened.draft.captionSize, 24); assert.equal(reopened.draft.captionColor, '#abc123');
  assert.deepEqual(reopened.draft.cues, [{ start: 0, end: 1, text: 'First spoken line' }, { start: 1, end: 2, text: 'Second spoken line' }]);
  await edits.saveReviewEditDraft(output.id, { ...reopened.draft, captionsEnabled: true });
  assert.equal((await edits.getReviewEditState(output.id)).draft.captionsEnabled, true, 'The owner can explicitly re-enable the retained captions');
});

after(() => {
  global.fetch = realFetch; mock.restoreAll(); process.chdir(project);
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('phoenix-buyer-regressions-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});
