const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach, after } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-approval-test-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
process.chdir(temporary);
const drafts = require(path.join(project, 'src/lib/creationDrafts.ts'));
const generation = require(path.join(project, 'src/lib/generation.ts'));
const api = require(path.join(project, 'src/app/api/creation-drafts/route.ts'));
const singing = require(path.join(project, 'src/lib/localSinging.ts'));
const catalog = require(path.join(project, 'src/lib/stockCatalog.ts'));
const { createContent } = require(path.join(project, 'src/lib/kidsRenderer.ts'));
const root = path.join(temporary, 'storage', 'Phoenix Studio Review Files');
const file = path.join(root, 'creation-drafts.json');
const realFetch = global.fetch;
const script = Array(12).fill('Open the curtains and let daylight into your room before you reach for your phone.').join(' ');
const input = () => ({ requestId: crypto.randomUUID(), topic: 'Calm morning', script, visualTerms: ['opening curtains', 'writing morning plan'], language: 'English', duration: 75, aspect: '9:16', voice: 'local-windows-voice', subtitleStyle: 'clear', visualSource: 'stock', targetPlatform: 'YouTube', publishingFormat: 'youtube-short', creationType: 'general' });
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = value => fs.writeFileSync(file, JSON.stringify(value));
const fixture = id => ({ id, duration: 120, image: 'https://images.pexels.com/videos/123/preview.jpeg', url: `https://www.pexels.com/video/${id}/`, user: { name: 'Fixture creator' }, video_files: [{ file_type: 'video/mp4', width: 720, height: 1280, link: `https://videos.pexels.com/video-files/${id}/720.mp4` }] });
beforeEach(() => { fs.mkdirSync(root, { recursive: true }); write([]); fs.writeFileSync(path.join(root, 'ai-creation-jobs.json'), '[]'); global.fetch = async () => { throw new Error('Unexpected network call'); }; });
afterEach(() => { global.fetch = realFetch; delete process.env.PHOENIX_ACE_URL; });
after(() => { process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true }); });

async function ready() { const [draft] = await drafts.createCreationDrafts([input()]); await drafts.processNextCreationDraft(); return read().find(d => d.id === draft.id); }
async function withFootage() {
  process.env.PEXELS_API_KEY = 'fixture-not-a-real-key';
  global.fetch = async url => Response.json(fixture(Number(String(url).split('/').pop())));
  let draft = await ready();
  for (let index = 0; index < draft.scenes.length; index++) draft = await drafts.chooseDraftFootage(draft.id, draft.version, index, index + 100);
  return draft;
}

test('planning persists a complete editable draft without rendering or submitting provider jobs', async () => {
  const draft = await ready();
  assert.equal(draft.status, 'READY');
  assert.equal(draft.scenes.map(s => s.narration).join(' '), script);
  assert.equal((await generation.listGenerationJobs()).length, 0);
});
test('duplicate plan clicks reuse drafts and archive tombstones prevent revival', async () => {
  const item = input();
  const [a] = await drafts.createCreationDrafts([item]);
  const [b] = await drafts.createCreationDrafts([item]);
  assert.equal(a.id, b.id);
  await drafts.changeDraftStatus(a.id, a.version, 'archive');
  await assert.rejects(drafts.createCreationDrafts([item]), /removed/);
  assert.equal(read().length, 1);
});
test('stock approval requires every actual asset and rejects insufficient duration', async () => {
  let draft = await ready();
  await assert.rejects(drafts.approveCreationDraft(draft.id, draft.version), /every section/);
  draft = await withFootage();
  const tooShort = draft.scenes.map(scene => ({ ...scene, footage: { ...scene.footage, duration: 1 } }));
  assert.throws(() => drafts.validateDraftScenes(draft, tooShort, true), /needs footage/);
});
test('edits normalize whitespace, invalidate changed visual choices, and reject stale versions', async () => {
  const draft = await withFootage();
  const scenes = draft.scenes.map(s => ({ ...s }));
  scenes[0].narration = scenes[0].narration.replace(' ', '\n  ');
  scenes[0].query = 'curtains blowing in window';
  const saved = await drafts.saveCreationDraft(draft.id, draft.version, scenes);
  assert.ok(!saved.scenes[0].footage);
  assert.ok(saved.scenes[1].footage);
  assert.ok(!saved.scenes[0].narration.includes('\n'));
  await assert.rejects(drafts.saveCreationDraft(draft.id, draft.version, scenes), /changed/);
  await assert.rejects(drafts.approveCreationDraft(draft.id, draft.version), /changed/);
});
test('concurrent approvals create exactly one immutable render request with exact asset IDs', async () => {
  const draft = await withFootage();
  const results = await Promise.all([drafts.approveCreationDraft(draft.id, draft.version), drafts.approveCreationDraft(draft.id, draft.version)]);
  assert.equal(results[0].approvedJobId, results[1].approvedJobId);
  const jobs = await generation.listGenerationJobs();
  assert.equal(jobs.length, 1);
  const request = JSON.parse(jobs[0].requestJson);
  assert.deepEqual(request.storyboard.map(b => b.assetId), [100, 101]);
  assert.equal(request.script, script);
  assert.equal(request.scriptApproved, true);
  await assert.rejects(drafts.saveCreationDraft(draft.id, results[0].version, draft.scenes), /cannot be changed/);
});
test('interrupted approval resumes without duplicating an already-created job', async () => {
  const draft = await withFootage();
  const approved = await drafts.approveCreationDraft(draft.id, draft.version);
  const store = read(); store[0].status = 'APPROVING'; write(store);
  await drafts.processNextCreationDraft();
  assert.equal(read()[0].approvedJobId, approved.approvedJobId);
  assert.equal((await generation.listGenerationJobs()).length, 1);
});
test('expired planning lease resumes while a live lease prevents concurrent planning', async () => {
  const [draft] = await drafts.createCreationDrafts([input()]);
  write([{ ...draft, status: 'PLANNING', leaseOwner: 'other-worker', leaseUntil: Date.now() + 60_000 }]);
  await drafts.processNextCreationDraft(); assert.equal(read()[0].status, 'PLANNING');
  write([{ ...read()[0], leaseUntil: Date.now() - 1 }]);
  await drafts.processNextCreationDraft(); assert.equal(read()[0].status, 'READY');
});
test('failed planning shows its cause and retains the script without fabricating footage', async () => {
  const item = input(); delete item.visualTerms;
  await drafts.createCreationDrafts([item]); await drafts.processNextCreationDraft();
  assert.equal(read()[0].status, 'FAILED'); assert.match(read()[0].error, /Unexpected network/);
  assert.equal(read()[0].input.script, script); assert.equal((await generation.listGenerationJobs()).length, 0);
});
test('API rejects cross-site mutations and approval without explicit review confirmation', async () => {
  const draft = await withFootage();
  const body = { id: draft.id, version: draft.version, action: 'approve' };
  let result = await api.PATCH(new Request('http://localhost/api/creation-drafts', { method: 'PATCH', headers: { origin: 'https://untrusted.example' }, body: JSON.stringify({ ...body, reviewConfirmed: true }) }));
  assert.equal(result.status, 400);
  result = await api.PATCH(new Request('http://localhost/api/creation-drafts', { method: 'PATCH', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }));
  assert.equal(result.status, 400);
});
test('approved children narration is used exactly, never silently replaced by the model', async () => {
  const supplied = 'Pip paused. Coco listened. Together they untangled the kite.';
  assert.equal(await createContent({ topic: 'A kite', duration: 60, creationType: 'children-story', script: supplied, scriptApproved: true }, {}), supplied);
});
test('singing uses local-only endpoints, single audio output, explicit lyrics and no speech fallback', () => {
  const body = singing.songPayload('Original lyrics here', 150, 'Piano and handclaps');
  assert.equal(body.audio_duration, 150); assert.equal(body.batch_size, 1); assert.equal(body.thinking, false); assert.equal(body.lyrics, 'Original lyrics here');
  assert.match(singing.singingMemoryBlocker(8 * 1024 ** 3, 5 * 1024 ** 3), /less than 12 GB/);
  assert.equal(singing.singingMemoryBlocker(16 * 1024 ** 3, 5 * 1024 ** 3), undefined);
  assert.throws(() => singing.localSongDownload('https://paid.example/song.mp3'), /unsafe/);
  assert.equal(singing.localSongDownload('/v1/audio?path=generated.mp3').hostname, '127.0.0.1');
  process.env.PHOENIX_ACE_URL = 'https://paid.example'; assert.throws(() => singing.singingBase(), /hosted or paid/);
});
test('stock catalog verifies CDN URLs and chooses a laptop-sized MP4 rendition', () => {
  const video = fixture(123); video.video_files.unshift({ file_type: 'video/mp4', width: 2160, height: 3840, link: 'https://videos.pexels.com/4k.mp4' });
  assert.equal(catalog.footageChoice(video).width, 720);
  assert.throws(() => catalog.footageChoice({ ...video, image: 'http://localhost/private' }), /untrusted/);
});

test('singing adapter follows the documented local protocol and stages real audio bytes (mock engine)', async () => {
  const total = os.totalmem, free = os.freemem;
  const audio = require(path.join(project, 'src/lib/songAudio.ts'));
  const originalStage = audio.stageSongAudio;
  const stages = [], calls = [];
  os.totalmem = () => 16 * 1024 ** 3; os.freemem = () => 5 * 1024 ** 3;
  audio.stageSongAudio = async (stream, filename, origin) => { assert.equal(await new Response(stream).text(), 'audio-fixture'); assert.equal(origin, 'local-ace'); assert.match(filename, /mp3$/); return { id: 'fixture-audio', duration: 150 }; };
  global.fetch = async (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'http://127.0.0.1:8001'); calls.push(parsed.pathname); assert.equal(init.redirect, 'error');
    if (parsed.pathname === '/health') return Response.json({ data: { status: 'ok', service: 'ACE-Step API' } });
    if (parsed.pathname === '/v1/models') return Response.json({ data: { models: [{ name: 'acestep-v15-turbo', is_default: true }] } });
    if (parsed.pathname === '/release_task') { assert.equal(JSON.parse(init.body).batch_size, 1); return Response.json({ data: { task_id: 'song-fixture-123' } }); }
    if (parsed.pathname === '/query_result') { assert.deepEqual(JSON.parse(init.body).task_id_list, ['song-fixture-123']); return Response.json({ data: [{ task_id: 'song-fixture-123', status: 1, result: JSON.stringify([{ file: '/v1/audio?path=fixture.mp3' }]) }] }); }
    if (parsed.pathname === '/v1/audio') return new Response('audio-fixture');
    throw new Error('Unknown endpoint');
  };
  try {
    const result = await singing.prepareLocalSong({ lyrics: 'Original words', duration: 150 }, async change => stages.push(change));
    assert.equal(result.id, 'fixture-audio');
    assert.deepEqual(calls, ['/health', '/v1/models', '/release_task', '/query_result', '/v1/audio']);
    assert.equal(stages[0].songSubmissionStarted, true);
    assert.equal(stages[1].songTaskId, 'song-fixture-123');
    await assert.rejects(singing.prepareLocalSong({ lyrics: 'Original words', duration: 150, submissionStarted: true }, async () => undefined), /could not be confirmed/);
    assert.equal(calls.filter(call => call === '/release_task').length, 1);
  } finally { os.totalmem = total; os.freemem = free; audio.stageSongAudio = originalStage; }
});

test('unknown model readiness and explicit engine failures are not presented as finished songs', async () => {
  const total = os.totalmem, free = os.freemem;
  os.totalmem = () => 16 * 1024 ** 3; os.freemem = () => 5 * 1024 ** 3;
  global.fetch = async url => Response.json({ data: new URL(url).pathname === '/health' ? { status: 'ok', service: 'ACE-Step API' } : { models: [{ name: 'acestep-v15-turbo', is_loaded: false }] } });
  try {
    const status = await singing.localSingingStatus(); assert.equal(status.available, false); assert.match(status.reason, /loaded model/);
    global.fetch = async url => {
      const route = new URL(url).pathname;
      if (route === '/health') return Response.json({ data: { status: 'ok', service: 'ACE-Step API' } });
      if (route === '/v1/models') return Response.json({ data: { models: [{ name: 'acestep-v15-turbo' }] } });
      assert.equal(route, '/query_result');
      return Response.json({ data: [{ task_id: 'existing-song', status: 2, error: 'out of memory' }] });
    };
    await assert.rejects(singing.prepareLocalSong({ lyrics: 'Lyrics', duration: 150, taskId: 'existing-song' }, async () => undefined), /out of memory/);
  } finally { os.totalmem = total; os.freemem = free; }
});
