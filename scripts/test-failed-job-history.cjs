const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test, beforeEach, after } = require('node:test');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { archiveExpiredJobHistory, FAILED_JOB_RETENTION_DAYS } = require('../src/lib/failedJobHistory');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-failed-job-history-'));
const root = path.join(temporary, 'storage', 'Phoenix Studio Review Files');
const now = Date.parse('2026-11-08T12:00:00Z'), day = 86_400_000;
const names = ['source-processing-jobs.json', 'ai-creation-jobs.json', 'creation-drafts.json', 'review-edit-jobs.json'];
const old = (extra = {}) => ({ id: 'fixture-failure', status: 'FAILED', createdAt: new Date(now - 30 * day).toISOString(), updatedAt: new Date(now - 8 * day).toISOString(), error: 'Saved explanation', sourceFile: 'original.mp4', version: 3, input: { topic: 'Fixture topic' }, ...extra });
const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
beforeEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true }); });
after(() => { assert.equal(fs.realpathSync(path.dirname(temporary)), fs.realpathSync(os.tmpdir())); assert.match(path.basename(temporary), /^phoenix-failed-job-history-/); fs.rmSync(temporary, { recursive: true, force: true }); });

test('seven-day cleanup soft archives only local failures, preserving inputs, errors and all saved files', async () => {
  assert.equal(FAILED_JOB_RETENTION_DAYS, 7);
  for (const name of names) write(name, [old()]);
  const untouched = ['index.json', 'original.mp4', 'finished.mp4', 'instagram-upload.json'];
  for (const name of untouched) fs.writeFileSync(path.join(root, name), `${name}: retain these exact bytes`);
  const publications = path.join(temporary, 'storage', 'private', 'review-publications'); fs.mkdirSync(publications, { recursive: true });
  const journal = path.join(publications, 'fixture-instagram.json'); fs.writeFileSync(journal, JSON.stringify({ status: 'NEEDS_CHECK', containerId: 'accepted-container' }));
  const beforeJournal = fs.readFileSync(journal, 'utf8');
  const result = await archiveExpiredJobHistory(now, root); assert.equal(result.archived, 4);
  for (const name of names) {
    const row = read(name)[0]; assert.equal(row.error, 'Saved explanation'); assert.deepEqual(row.input, { topic: 'Fixture topic' }); assert.equal(row.sourceFile, 'original.mp4');
    if (name === 'creation-drafts.json') { assert.equal(row.status, 'ARCHIVED'); assert.equal(row.version, 4); assert.equal(row.updatedAt, new Date(now).toISOString()); }
    else { assert.equal(row.status, 'FAILED'); assert.equal(row.archivedAt, new Date(now).toISOString()); assert.equal(row.updatedAt, old().updatedAt); }
  }
  for (const name of untouched) assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), `${name}: retain these exact bytes`);
  assert.equal(fs.readFileSync(journal, 'utf8'), beforeJournal);
  const first = names.map(name => fs.readFileSync(path.join(root, name), 'utf8'));
  assert.equal((await archiveExpiredJobHistory(now + day, root)).archived, 0);
  assert.deepEqual(names.map(name => fs.readFileSync(path.join(root, name), 'utf8')), first, 'Repeated housekeeping does not rewrite archived records');
});

test('expiry uses the latest finished attempt or updated-at fallback, never the original creation date', async () => {
  const records = [old({ id: 'recent-retry', finishedAt: new Date(now - day).toISOString() }), old({ id: 'recent-fallback', updatedAt: new Date(now - day).toISOString() }), old({ id: 'boundary', finishedAt: new Date(now - 7 * day).toISOString() }), old({ id: 'future', finishedAt: new Date(now + day).toISOString() }), old({ id: 'unknown', finishedAt: 'invalid', updatedAt: undefined })];
  write(names[0], records); assert.equal((await archiveExpiredJobHistory(now, root)).archived, 1);
  assert.deepEqual(read(names[0]).filter(row => row.archivedAt).map(row => row.id), ['boundary']);
});

test('queued, active, complete, uncertain publication and provider tasks are never archived from age alone', async () => {
  const records = ['QUEUED', 'PROCESSING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'NEEDS_CHECK', 'UPLOADING', 'APPROVING'].map(status => old({ id: status, status }));
  records.push(...[
    { platform: 'instagram' }, { platform: 'facebook' }, { platform: 'youtube' }, { submissionUncertainSince: old().updatedAt },
    { providerTaskId: 'accepted-render' }, { providerLeaseOwner: 'active-owner' }, { localRenderLeaseOwner: 'active-owner' },
    { leaseOwner: 'planner' }, { leaseUntil: now + day }, { leaseUntil: 'unknown' }, { nextAttemptAt: new Date(now + day).toISOString() },
    { providerLeaseExpiresAt: 'unknown' }, { approvedJobId: 'accepted-generation' }, { songTaskId: 'accepted-song' }, { songSubmissionStarted: true },
  ].map((extra, at) => old({ id: `protected-${at}`, ...extra })));
  write(names[0], records); const before = fs.readFileSync(path.join(root, names[0]), 'utf8');
  assert.equal((await archiveExpiredJobHistory(now, root)).archived, 0); assert.equal(fs.readFileSync(path.join(root, names[0]), 'utf8'), before);
  write(names[1], [old({ providerTaskId: 'confirmed-terminal', resourceReleasedTaskId: 'confirmed-terminal' })]);
  assert.equal((await archiveExpiredJobHistory(now, root)).archived, 1, 'Confirmed terminal local renderer evidence permits history archival');
});

test('all source Needs-attention statuses expire, but draft archival is versioned and invalid versions are left alone', async () => {
  write(names[0], [old({ status: 'BLOCKED' })]);
  write(names[2], [old({ version: 'invalid' }), old({ id: 'confirmed-song-failure', songTaskId: 'failed-song', songTaskFailed: true })]);
  const result = await archiveExpiredJobHistory(now, root); assert.equal(result.archived, 2); assert.ok(read(names[0])[0].archivedAt);
  assert.equal(read(names[2])[0].status, 'FAILED'); assert.equal(read(names[2])[1].status, 'ARCHIVED');
});

test('busy or stale retry locks and a source processor lease are never stolen or removed', async () => {
  const locks = ['source-processing-jobs.lock', '.ai-creation-jobs.lock', 'creation-drafts.json.lock', 'review-edit-jobs.json.lock'];
  for (const [at, name] of names.entries()) { write(name, [old()]); fs.writeFileSync(path.join(root, locks[at]), 'existing retry owns this lock'); fs.utimesSync(path.join(root, locks[at]), new Date(now - 90 * day), new Date(now - 90 * day)); }
  assert.deepEqual(await archiveExpiredJobHistory(now, root), { archived: 0, skippedStores: 4 });
  for (const name of locks) { assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), 'existing retry owns this lock'); fs.rmSync(path.join(root, name)); }
  fs.writeFileSync(path.join(root, 'source-processing-worker.lock'), 'source processor');
  assert.equal((await archiveExpiredJobHistory(now, root)).archived, 3); assert.equal(read(names[0])[0].archivedAt, undefined);
});

test('an active or unreadable heavy-work reservation pauses housekeeping without changing histories', async () => {
  write(names[0], [old()]);
  for (const value of ['{"external":{"taskId":"accepted"}}', 'invalid JSON', 'x'.repeat(16_385)]) {
    fs.writeFileSync(path.join(root, 'heavy-work-lease.json'), value); assert.equal((await archiveExpiredJobHistory(now, root)).archived, 0);
    assert.equal(read(names[0])[0].archivedAt, undefined);
  }
  write('heavy-work-lease.json', null); assert.equal((await archiveExpiredJobHistory(now, root)).archived, 1);
});

test('bounded passes archive at most 100 rows per store and continue safely in a later hourly turn', async () => {
  write(names[0], Array.from({ length: 105 }, (_, at) => old({ id: `old-${at}` })));
  assert.equal((await archiveExpiredJobHistory(now, root)).archived, 100); assert.equal(read(names[0]).filter(row => !row.archivedAt).length, 5);
  assert.equal((await archiveExpiredJobHistory(now + day, root)).archived, 5);
});

test('invalid, huge or linked histories are retained rather than repaired or followed', async () => {
  for (const value of ['invalid JSON', JSON.stringify([old(), null]), 'x'.repeat(8 * 1024 * 1024 + 1)]) {
    fs.writeFileSync(path.join(root, names[0]), value); assert.equal((await archiveExpiredJobHistory(now, root)).archived, 0);
    assert.equal(fs.readFileSync(path.join(root, names[0]), 'utf8'), value);
  }
  fs.rmSync(path.join(root, names[0]));
  const outside = path.join(temporary, 'outside.json'); fs.writeFileSync(outside, JSON.stringify([old()]));
  fs.linkSync(outside, path.join(root, names[0]));
  assert.equal((await archiveExpiredJobHistory(now, root)).archived, 0); assert.equal(JSON.parse(fs.readFileSync(outside))[0].archivedAt, undefined);
});
