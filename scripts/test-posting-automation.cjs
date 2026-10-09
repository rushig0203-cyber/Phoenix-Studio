const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-posting-auto-'));
process.chdir(temp);
const settings = require('../src/lib/writingSettings');
const resources = require('../src/lib/renderResources');
const activity = require('../src/lib/instagramHashtagActivity');
const locks = require('../src/lib/fileLock');
const reviews = require('../src/lib/reviewFiles');
const analysis = require('../src/lib/videoPostingAnalysis');
const { editedPostingTextOrigin } = require('../src/lib/reviewEdits');
const originals = { fetch: global.fetch, spawn: childProcess.spawn, settings: settings.readWritingSettings, status: resources.heavyWorkStatus, slot: resources.tryWithLocalRenderSlot, activity: activity.analyzeInstagramHashtagActivity };
const selected = { provider: 'groq', model: settings.WRITING_GROQ_MODEL, apiKey: 'gsk_test_not_real_12345678901234', freePlanConfirmed: true, allowVideoFrames: true };
const evidence = { observations: [{ frame: 1, visible: 'A small stream passes moss-covered stones.' }], caption: 'Follow the water between these moss-covered stones.', captionVariants: ['A closer look at this woodland stream.'], hashtags: ['#ForestStream', '#Moss'], confidence: 'clear' };
let requests, frames;
beforeEach(() => {
  fs.rmSync(path.join(temp, 'storage'), { recursive: true, force: true }); requests = 0; frames = 0;
  settings.readWritingSettings = () => ({ ...selected });
  resources.heavyWorkStatus = async () => ({ lease: null, waitingForMemory: false });
  resources.tryWithLocalRenderSlot = async work => ({ acquired: true, value: await work() });
  activity.analyzeInstagramHashtagActivity = async () => ({ status: 'UNAVAILABLE', checkedAt: new Date().toISOString(), detail: 'No global trend claim.', samples: [] });
  childProcess.spawn = () => {
    frames++; const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => true;
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from([0xff, 0xd8, 0xff, 0xd9])); child.emit('close', 0); });
    return child;
  };
  global.fetch = async () => { requests++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(evidence) } }] }); };
});
after(() => {
  global.fetch = originals.fetch; childProcess.spawn = originals.spawn; settings.readWritingSettings = originals.settings;
  resources.heavyWorkStatus = originals.status; resources.tryWithLocalRenderSlot = originals.slot; activity.analyzeInstagramHashtagActivity = originals.activity;
  process.chdir(project); fs.rmSync(temp, { recursive: true, force: true });
});
async function fixture(overrides = {}) {
  const id = crypto.randomUUID(); await reviews.ensureReviewFolders(); fs.writeFileSync(reviews.outputPath(id, 'instagram'), 'isolated-picture');
  const file = { id, title: 'Woodland stream', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'READY', targets: ['instagram'], source: { kind: 'pexels', filename: 'fixture.mp4', licence: 'Fixture' }, audience: 'general', outputs: { instagram: { filename: `${id}-instagram.mp4`, duration: 45, width: 720, height: 1280 } }, quality: { audio: 'natural-audio-preserved', captions: [], hashtags: ['#Draft'], postCopy: 'Draft stream copy.', checks: [] }, ...overrides };
  await reviews.saveReviewFile(file); return file;
}
async function expire(id) { await reviews.updateReviewFile(id, file => ({ ...file, quality: { ...file.quality, postingAnalysis: { ...file.quality.postingAnalysis, nextAttemptAt: new Date(0).toISOString() } } })); }

test('fresh completed outputs automatically get specific copy and matching saved analysis is not billed again', async () => {
  const file = await fixture(); await analysis.processNextPostingAnalysis();
  const saved = await reviews.getReviewFile(file.id); assert.equal(saved.quality.postingAnalysis.status, 'COMPLETE');
  assert.equal(saved.quality.postCopy, evidence.caption); assert.equal(saved.quality.postingTextOrigin, 'automatic');
  assert.deepEqual(saved.quality.hashtags, evidence.hashtags); assert.equal(frames, 3); assert.equal(requests, 1);
  await analysis.processNextPostingAnalysis(); assert.equal(frames, 3); assert.equal(requests, 1);
});
test('a temporary connection failure recovers automatically after durable backoff, never every worker tick', async () => {
  const file = await fixture(), normal = global.fetch;
  global.fetch = async () => { requests++; throw new Error('Private transport detail must not leak.'); };
  await analysis.processNextPostingAnalysis(); let saved = await reviews.getReviewFile(file.id);
  assert.equal(saved.quality.postingAnalysis.status, 'WAITING'); assert.equal(saved.quality.postingAnalysis.attempts, 1);
  assert.match(saved.quality.postingAnalysis.detail, /Automatic retry 2\/3/); assert.doesNotMatch(saved.quality.postingAnalysis.detail, /Private transport/);
  await analysis.processNextPostingAnalysis(); assert.equal(requests, 1); assert.equal(frames, 3);
  await expire(file.id); global.fetch = normal; await analysis.processNextPostingAnalysis(); saved = await reviews.getReviewFile(file.id);
  assert.equal(saved.quality.postingAnalysis.status, 'COMPLETE'); assert.equal(saved.quality.postingAnalysis.attempts, 2); assert.equal(requests, 2);
});
test('automatic transient recovery stops after three attempts and leaves existing copy intact', async () => {
  const file = await fixture(); global.fetch = async () => { requests++; return new Response('', { status: 503 }); };
  for (let index = 0; index < 3; index++) { await analysis.processNextPostingAnalysis(); await expire(file.id); }
  const saved = await reviews.getReviewFile(file.id); assert.equal(saved.quality.postingAnalysis.status, 'FAILED');
  assert.equal(saved.quality.postingAnalysis.attempts, 3); assert.equal(saved.quality.postCopy, file.quality.postCopy);
  assert.match(saved.quality.postingAnalysis.detail, /stopped after 3 attempts/);
  await analysis.processNextPostingAnalysis(); assert.equal(requests, 3); assert.equal(frames, 9);
});
test('permissions, billing and legacy failed analyses never get automatic failure retries', async () => {
  for (const status of [401, 402, 403, 404]) {
    const file = await fixture(); global.fetch = async () => { requests++; return new Response('', { status }); };
    await analysis.processNextPostingAnalysis(); const saved = await reviews.getReviewFile(file.id);
    assert.equal(saved.quality.postingAnalysis.status, 'FAILED'); assert.equal(saved.quality.postingAnalysis.nextAttemptAt, undefined);
    await analysis.processNextPostingAnalysis(); assert.equal(requests, status === 401 ? 1 : status === 402 ? 2 : status === 403 ? 3 : 4);
  }
  await fixture({ quality: { captions: [], hashtags: ['#Owner'], postCopy: 'Kept failed caption.', checks: [], postingAnalysis: { status: 'FAILED', attempts: 1, updatedAt: new Date().toISOString(), detail: 'Old saved failure.' } } });
  await analysis.processNextPostingAnalysis(); assert.equal(requests, 4);
});
test('a saved free-quota wait does not launch FFmpeg or reset when an owner repeats the queue request', async () => {
  global.fetch = async () => { requests++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); };
  await assert.rejects(analysis.requestVisualPosting(Array(3).fill(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), ''), /free quota/);
  const file = await fixture(); await analysis.processNextPostingAnalysis(); const saved = await reviews.getReviewFile(file.id);
  assert.equal(saved.quality.postingAnalysis.status, 'WAITING'); assert.equal(saved.quality.postingAnalysis.attempts, 0);
  assert.ok(Date.parse(saved.quality.postingAnalysis.nextAttemptAt) > Date.now()); assert.equal(frames, 0); assert.equal(requests, 1);
  const queued = await analysis.queuePostingAnalysis(file.id); assert.deepEqual(queued.quality.postingAnalysis, saved.quality.postingAnalysis);
  await analysis.processNextPostingAnalysis(); assert.equal(frames, 0); assert.equal(requests, 1);
});
test('automatic trim edits are analyzed, but owner posting copy and unknown legacy edits are preserved', async () => {
  const owner = await fixture({ editedFrom: 'owner-edit', quality: { postingTextOrigin: 'owner', captions: [], hashtags: ['#MyChoice'], postCopy: 'My intentional caption.', checks: [] } });
  const legacy = await fixture({ editedFrom: 'legacy-edit' });
  const automatic = await fixture({ editedFrom: 'trim-edit', quality: { postingTextOrigin: 'automatic', captions: [], hashtags: ['#Draft'], postCopy: 'Original draft.', checks: [] } });
  await analysis.processNextPostingAnalysis(); assert.equal((await reviews.getReviewFile(automatic.id)).quality.postingAnalysis.status, 'COMPLETE');
  await analysis.processNextPostingAnalysis(); assert.equal((await reviews.getReviewFile(owner.id)).quality.postCopy, owner.quality.postCopy);
  assert.equal((await reviews.getReviewFile(legacy.id)).quality.postingAnalysis, undefined); assert.equal(requests, 1);
});
test('a replaced output invalidates only its own fingerprint and starts a fresh bounded analysis', async () => {
  const file = await fixture(); await analysis.processNextPostingAnalysis(); const first = await reviews.getReviewFile(file.id);
  fs.writeFileSync(reviews.outputPath(file.id, 'instagram'), 'a-different-isolated-picture');
  await analysis.processNextPostingAnalysis(); const second = await reviews.getReviewFile(file.id);
  assert.notEqual(second.quality.postingAnalysis.fingerprint, first.quality.postingAnalysis.fingerprint);
  assert.equal(second.quality.postingAnalysis.status, 'COMPLETE'); assert.equal(second.quality.postingAnalysis.attempts, 1); assert.equal(requests, 2);
});
test('a picture replaced during analysis never receives stale evidence and is requeued automatically', async () => {
  const file = await fixture(), normal = global.fetch;
  global.fetch = async (...args) => { fs.writeFileSync(reviews.outputPath(file.id, 'instagram'), 'replaced-during-the-provider-call'); return normal(...args); };
  await analysis.processNextPostingAnalysis(); const changed = await reviews.getReviewFile(file.id);
  assert.equal(changed.quality.postingAnalysis.status, 'QUEUED'); assert.equal(changed.quality.postingAnalysis.attempts, 0);
  assert.equal(changed.quality.postCopy, file.quality.postCopy); global.fetch = normal; await analysis.processNextPostingAnalysis();
  assert.equal((await reviews.getReviewFile(file.id)).quality.postingAnalysis.status, 'COMPLETE'); assert.equal(requests, 2);
});
test('a late result cannot overwrite an owner copy change or trash removal', async () => {
  for (const action of ['edit', 'trash']) {
    const file = await fixture(), normal = global.fetch;
    global.fetch = async (...args) => {
      if (action === 'edit') await reviews.updateReviewFile(file.id, latest => ({ ...latest, quality: { ...latest.quality, postingTextOrigin: 'owner', postCopy: 'Owner text kept.' } }));
      else await reviews.removeReviewFile(file.id);
      return normal(...args);
    };
    await analysis.processNextPostingAnalysis(); global.fetch = normal;
    const saved = await reviews.getReviewFile(file.id);
    if (action === 'edit') assert.equal(saved.quality.postCopy, 'Owner text kept.'); else assert.equal(saved, null);
  }
});
test('stale interrupted analysis remains bounded instead of silently making a fourth provider attempt', async () => {
  const file = await fixture(); await analysis.processNextPostingAnalysis(); const saved = await reviews.getReviewFile(file.id);
  await reviews.updateReviewFile(file.id, latest => ({ ...latest, quality: { ...latest.quality, postingAnalysis: { ...saved.quality.postingAnalysis, status: 'ANALYZING', attempts: 3, updatedAt: new Date(Date.now() - 200_000).toISOString() } } }));
  await analysis.processNextPostingAnalysis(); assert.equal((await reviews.getReviewFile(file.id)).quality.postingAnalysis.status, 'FAILED'); assert.equal(requests, 1);
});
test('editor ownership distinguishes picture-only edits from changed copy and conservatively retains legacy owner edits', async () => {
  const file = await fixture(), draft = { postCopy: file.quality.postCopy, hashtags: file.quality.hashtags };
  assert.equal(editedPostingTextOrigin(file, draft), 'automatic');
  assert.equal(editedPostingTextOrigin(file, { ...draft, postCopy: 'A caption I wrote.' }), 'owner');
  assert.equal(editedPostingTextOrigin(file, { ...draft, hashtags: ['#MyTag'] }), 'owner');
  assert.equal(editedPostingTextOrigin({ ...file, editedFrom: 'legacy-parent' }, draft), 'owner');
  assert.equal(editedPostingTextOrigin({ ...file, editedFrom: 'known-picture-edit', quality: { ...file.quality, postingTextOrigin: 'automatic' } }, draft), 'automatic');
  assert.equal(editedPostingTextOrigin({ ...file, quality: { ...file.quality, postingTextOrigin: 'owner' } }, draft), 'owner');
});
test('an owner edit during slot admission prevents frame extraction even without an updated timestamp', async () => {
  const file = await fixture();
  resources.tryWithLocalRenderSlot = async work => {
    await reviews.updateReviewFile(file.id, latest => ({ ...latest, quality: { ...latest.quality, postingTextOrigin: 'owner', postCopy: 'Owner changed this before samples.' } }));
    return { acquired: true, value: await work() };
  };
  await analysis.processNextPostingAnalysis(); const saved = await reviews.getReviewFile(file.id);
  assert.equal(saved.quality.postCopy, 'Owner changed this before samples.'); assert.equal(saved.quality.postingAnalysis, undefined);
  assert.equal(frames, 0); assert.equal(requests, 0);
});
test('temporary provider-lock contention defers without using a failure attempt or sending duplicate requests', async () => {
  const file = await fixture(), original = locks.withFileLock;
  locks.withFileLock = async (filename, ...args) => {
    if (path.basename(filename) === 'groq-vision.lock') throw new Error('Timed out waiting for local store lock: groq-vision.lock');
    return original(filename, ...args);
  };
  try {
    await analysis.processNextPostingAnalysis(); const saved = await reviews.getReviewFile(file.id);
    assert.equal(saved.quality.postingAnalysis.status, 'WAITING'); assert.equal(saved.quality.postingAnalysis.attempts, 0);
    assert.match(saved.quality.postingAnalysis.detail, /Another posting analysis/); assert.equal(requests, 0);
  } finally { locks.withFileLock = original; }
});
