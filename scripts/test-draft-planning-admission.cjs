const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-draft-admission-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
// reviewFiles binds its paths on import. Isolate BEFORE loading any app module.
process.chdir(temporary);
const settings = require('../src/lib/writingSettings.ts');
const local = require('../src/lib/localModelSession.ts');
const resources = require('../src/lib/renderResources.ts');
const preparation = require('../src/lib/stockPreparation.ts');
const singing = require('../src/lib/localSinging.ts');
const writer = require('../src/lib/writingModel.ts');
const { WritingWaitError } = require('../src/lib/groqWriter.ts');
const drafts = require('../src/lib/creationDrafts.ts');
const generation = require('../src/lib/generation.ts');
const original = { read: settings.readWritingSettings, slot: resources.withLocalRenderSlot, trySlot: resources.tryWithLocalRenderSlot, session: local.withLocalWritingSession, writingSession: writer.withWritingSession, prepare: preparation.prepareStockCreation, singing: singing.prepareLocalSong, fetch: global.fetch, free: os.freemem, pexels: process.env.PEXELS_API_KEY, spawn: childProcess.spawn, execFile: childProcess.execFile };
const root = path.join(temporary, 'storage', 'Phoenix Studio Review Files');
assert.equal(path.resolve(require('../src/lib/reviewFiles.ts').reviewRoot()), path.resolve(root),
  'Refusing to run fixtures outside the isolated temporary review store');
const file = path.join(root, 'creation-drafts.json');
const leaseFile = path.join(root, 'heavy-work-lease.json');
const script = Array(12).fill('Open the curtains and let daylight into your room before you reach for your phone.').join(' ');
const input = (extra = {}) => ({ reviewMode: 'final', topic: 'Calm morning', script, visualTerms: ['opening curtains', 'writing morning plan'], duration: 75, aspect: '9:16', creationType: 'general', ...extra });
const fixture = id => ({ id, duration: 120, image: 'https://images.pexels.com/videos/123/preview.jpeg', url: `https://www.pexels.com/video/${id}/`, user: { name: 'Fixture creator' }, video_files: [{ file_type: 'video/mp4', width: 720, height: 1280, link: `https://videos.pexels.com/video-files/${id}/720.mp4` }] });
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const remoteSettings = provider => provider === 'cloudflare'
  ? { provider, model: settings.WRITING_CLOUDFLARE_MODEL, apiKey: 'fake_cloudflare_fixture_key_never_sent_123456', accountId: 'a'.repeat(32), freePlanConfirmed: true }
  : { provider, model: settings.WRITING_GROQ_MODEL, apiKey: 'gsk_fake_fixture_key_never_sent_123456', freePlanConfirmed: true };
let active, slotCalls, remoteCalls;
beforeEach(() => {
  fs.rmSync(path.join(temporary, 'storage'), { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  active = remoteSettings('groq');
  settings.readWritingSettings = () => ({ ...active });
  local.withLocalWritingSession = async () => assert.fail('Remote draft must not enter local model session');
  resources.withLocalRenderSlot = async () => { slotCalls++; throw new Error('Unexpected heavy admission for remote text'); };
  resources.tryWithLocalRenderSlot = async () => { slotCalls++; throw new Error('Unexpected heavy admission for remote text'); };
  writer.withWritingSession = original.writingSession;
  childProcess.spawn = () => assert.fail('Planning must not spawn a renderer, decoder or model');
  childProcess.execFile = () => assert.fail('Planning must not execute a renderer, decoder or model');
  preparation.prepareStockCreation = original.prepare;
  singing.prepareLocalSong = async () => assert.fail('No actual song submission is allowed in these tests');
  slotCalls = 0; remoteCalls = 0;
  os.freemem = () => 128 * 1024 * 1024;
  process.env.PEXELS_API_KEY = 'fixture-only';
  global.fetch = async url => {
    remoteCalls++;
    assert.equal(new URL(url).hostname, 'api.pexels.com');
    return Response.json({ videos: [fixture(101), fixture(102)] });
  };
});
after(() => {
  settings.readWritingSettings = original.read; resources.withLocalRenderSlot = original.slot;
  resources.tryWithLocalRenderSlot = original.trySlot; writer.withWritingSession = original.writingSession;
  childProcess.spawn = original.spawn; childProcess.execFile = original.execFile;
  local.withLocalWritingSession = original.session; preparation.prepareStockCreation = original.prepare;
  singing.prepareLocalSong = original.singing; global.fetch = original.fetch; os.freemem = original.free;
  if (original.pexels === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = original.pexels;
  process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true });
});

for (const provider of ['groq', 'cloudflare']) test(`${provider} plans and checkpoints metadata at 128 MiB without taking an existing renderer lease`, async () => {
  active = remoteSettings(provider);
  const now = new Date().toISOString();
  const lease = { version: 1, token: 'fixture-existing-renderer', pid: process.pid, kind: 'Video creation', acquiredAt: now, heartbeatAt: now, external: { jobId: 'fixture-render', taskId: 'fixture-task', submittedAt: now } };
  fs.writeFileSync(leaseFile, JSON.stringify(lease));
  await drafts.createCreationDrafts([input()]);
  await drafts.processNextCreationDraft();
  const [saved] = read();
  assert.equal(saved.status, 'APPROVED', saved.error); assert.equal(saved.input.script, script);
  assert.deepEqual(saved.scenes.map(scene => scene.footage.id), [101, 102]);
  assert.equal(slotCalls, 0); assert.equal(remoteCalls, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(leaseFile, 'utf8')), lease);
  const [render] = await generation.listGenerationJobs(); assert.equal(render.status, 'QUEUED');
  assert.deepEqual(fs.readdirSync(path.join(root, 'outputs')), [], 'No media output may be rendered during planning');
  assert.deepEqual(fs.readdirSync(path.join(root, 'sources')), [], 'No footage may be downloaded during planning');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8')), [], 'No rendered review item may be invented');
  // Dispatch saves a request only; it does not run a local media worker here.
  await drafts.processNextCreationDraft(); assert.equal((await generation.listGenerationJobs()).length, 1);
});

for (const provider of ['groq', 'cloudflare']) test(`${provider} quota wait reaches mocked remote transport below render floor and preserves its cooldown`, async () => {
  active = remoteSettings(provider);
  global.fetch = async url => {
    remoteCalls++;
    assert.equal(String(url), provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : `https://api.cloudflare.com/client/v4/accounts/${active.accountId}/ai/run/${active.model}`);
    return Response.json({ success: false, errors: [{ code: 3000 }] }, { status: 429, headers: { 'retry-after': '120' } });
  };
  await drafts.createCreationDrafts([input({ script: undefined, visualTerms: undefined })]);
  await drafts.processNextCreationDraft();
  const [saved] = read();
  assert.equal(saved.status, 'QUEUED'); assert.match(saved.stage, provider === 'groq' ? /Groq/ : /Cloudflare/);
  assert.equal(saved.error, undefined); assert.equal(saved.leaseOwner, undefined);
  assert.ok(Date.parse(saved.nextAttemptAt) > Date.now()); assert.equal(slotCalls, 0);
  await drafts.processNextCreationDraft(); assert.equal(remoteCalls, 1);
  assert.equal((await generation.listGenerationJobs()).length, 0);
});

test('Ollama still obtains heavy admission before opening its writer session', async () => {
  active = { provider: 'ollama', model: 'fixture:local', freePlanConfirmed: false };
  os.freemem = () => 768 * 1024 * 1024;
  let reserved = false, sessions = 0;
  resources.tryWithLocalRenderSlot = async work => { slotCalls++; reserved = true; try { return { acquired: true, value: await work() }; } finally { reserved = false; } };
  local.withLocalWritingSession = async work => { sessions++; assert.equal(reserved, true); return work(); };
  await drafts.createCreationDrafts([input()]); await drafts.processNextCreationDraft();
  assert.equal(read()[0].status, 'APPROVED', read()[0].error); assert.equal(slotCalls, 1); assert.equal(sessions, 1);
});

for (const provider of ['groq', 'cloudflare']) test(`${provider} lyrics do not exempt actual local song preparation from heavy admission`, async () => {
  active = remoteSettings(provider);
  os.freemem = () => 768 * 1024 * 1024;
  resources.tryWithLocalRenderSlot = async (_work, kind) => { slotCalls++; assert.equal(kind, 'Song audio preparation'); throw new WritingWaitError('Waiting for song memory', 60_000); };
  await drafts.createCreationDrafts([input({ creationType: 'children-song', songMode: 'local-ace' })]);
  await drafts.processNextCreationDraft();
  const [saved] = read();
  assert.equal(saved.status, 'QUEUED'); assert.equal(saved.input.script, script);
  assert.match(saved.stage, /song memory/); assert.equal(slotCalls, 1); assert.equal(remoteCalls, 0);
});

for (const provider of ['groq', 'cloudflare']) test(`switching ${provider} during remote planning aborts before an unreserved local request`, async () => {
  active = remoteSettings(provider);
  preparation.prepareStockCreation = async () => {
    active = { provider: 'ollama', model: 'fixture:local', freePlanConfirmed: false };
    await writer.generateWritingModel({ prompt: 'This must never dispatch locally.' });
    assert.fail('Changed settings should fail closed');
  };
  await drafts.createCreationDrafts([input()]); await drafts.processNextCreationDraft();
  const [saved] = read();
  assert.equal(saved.status, 'FAILED'); assert.match(saved.error, /settings changed/);
  assert.equal(slotCalls, 0); assert.equal(remoteCalls, 0); assert.equal((await generation.listGenerationJobs()).length, 0);
});

for (const provider of ['groq', 'cloudflare']) test(`switching ${provider} to Ollama immediately before session entry never opens a local session`, async () => {
  active = remoteSettings(provider);
  let callbacks = 0;
  writer.withWritingSession = (work, options) => {
    assert.equal(options.expectedIdentity, `${active.provider}:${active.model}`);
    active = { provider: 'ollama', model: 'fixture:local', freePlanConfirmed: false };
    return original.writingSession(async () => { callbacks++; return work(); }, options);
  };
  await drafts.createCreationDrafts([input()]); await drafts.processNextCreationDraft();
  const [saved] = read();
  assert.equal(saved.status, 'FAILED'); assert.match(saved.error, /settings changed before planning/i);
  assert.equal(callbacks, 0); assert.equal(slotCalls, 0); assert.equal(remoteCalls, 0);
  assert.equal((await generation.listGenerationJobs()).length, 0);
});

test('Cloudflare memory exemption excludes songs and does not bypass render/edit/source admission', async () => {
  active = remoteSettings('cloudflare');
  await drafts.createCreationDrafts([input({ creationType: 'children-song', songMode: 'local-ace' })]);
  assert.equal(await drafts.creationDraftWorkflowReady({ waitingForMemory: true }), false);
  await drafts.processNextCreationDraft();
  assert.equal(read()[0].status, 'QUEUED'); assert.equal(slotCalls, 0); assert.equal(remoteCalls, 0);
  assert.equal((await generation.listGenerationJobs()).length, 0);
  const source = require('../src/lib/sourceProcessing.ts');
  const edits = require('../src/lib/reviewEdits.ts');
  const created = new Date().toISOString();
  fs.writeFileSync(path.join(root, 'source-processing-jobs.json'), JSON.stringify([{ id: 'fixture-source', status: 'QUEUED', createdAt: created, attempts: 0 }]));
  fs.writeFileSync(path.join(root, 'review-edit-jobs.json'), JSON.stringify([{ id: 'fixture-edit', status: 'QUEUED', createdAt: created, progress: 0 }]));
  resources.tryWithLocalRenderSlot = async () => { slotCalls++; return { acquired: false }; };
  await source.processNextSourceJob(); await edits.processNextReviewEdit();
  assert.equal(slotCalls, 2); assert.equal(remoteCalls, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'source-processing-jobs.json'), 'utf8'))[0].status, 'QUEUED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'review-edit-jobs.json'), 'utf8'))[0].status, 'QUEUED');
});

test('remote planning remains serialized and existing failed drafts are untouched', async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let count = 0;
  preparation.prepareStockCreation = async (...args) => { count++; entered(); await gate; return original.prepare(...args); };
  const created = await drafts.createCreationDrafts([input(), input(), input()]);
  const stored = read(); stored[2] = { ...stored[2], status: 'FAILED', error: 'Keep this failed job', stage: 'Failed before this update' };
  fs.writeFileSync(file, JSON.stringify(stored));
  const running = drafts.processNextCreationDraft(); await started;
  try {
    await drafts.processNextCreationDraft();
    assert.equal(count, 1); assert.deepEqual(read().map(draft => draft.status), ['PLANNING', 'QUEUED', 'FAILED']);
    assert.ok(read()[0].leaseUntil > Date.now());
  } finally { release(); await running; }
  assert.equal(read().find(draft => draft.id === created[2].id).error, 'Keep this failed job');
  assert.equal(read()[0].status, 'APPROVED', read()[0].error); assert.equal(slotCalls, 0);
});
