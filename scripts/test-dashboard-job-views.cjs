const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { jobGroup, jobQueuePage, JOB_PAGE_SIZE } = require('../src/lib/dashboardJobs');
const entry = (id, status, phase = 'render', day = 1) => ({ id, status, phase, createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z` });

test('preparation and rendering share active and failed status groups, never completed preparation duplicates', () => {
  for (const status of ['QUEUED', 'PLANNING', 'READY', 'APPROVING']) assert.equal(jobGroup(entry(status, status, 'preparation')), 'active');
  for (const status of ['QUEUED', 'RUNNING', 'PROCESSING']) assert.equal(jobGroup(entry(status, status)), 'active');
  for (const status of ['FAILED', 'BLOCKED']) assert.equal(jobGroup(entry(status, status)), 'failed');
  assert.equal(jobGroup(entry('failed-draft', 'FAILED', 'preparation')), 'failed');
  for (const status of ['APPROVED', 'ARCHIVED']) assert.equal(jobGroup(entry(status, status, 'preparation')), 'hidden');
  assert.equal(jobGroup(entry('cancelled', 'CANCELLED')), 'history');
});

test('default opens genuine work first, then attention, then finished files when idle', () => {
  const complete = entry('finished', 'COMPLETED'), failed = entry('failed', 'FAILED'), preparing = entry('writing', 'PLANNING', 'preparation');
  assert.equal(jobQueuePage([complete, failed, preparing], null, 1).filter, 'active');
  assert.equal(jobQueuePage([complete, failed], null, 1).filter, 'failed');
  assert.equal(jobQueuePage([complete], null, 1).filter, 'completed');
  assert.equal(jobQueuePage([], null, 1).filter, 'all');
});

test('counts cover both phases once; approved/archived preparations stay saved but do not inflate history', () => {
  const records = [entry('work', 'PROCESSING'), entry('waiting', 'READY', 'preparation'), entry('failed', 'FAILED', 'preparation'), entry('render-failed', 'BLOCKED'), entry('finished', 'COMPLETED'), entry('old-plan', 'APPROVED', 'preparation'), entry('removed-plan', 'ARCHIVED', 'preparation')];
  assert.deepEqual(jobQueuePage(records, 'all', 1).counts, { all: 5, active: 2, failed: 2, completed: 1 });
  assert.equal(records.length, 7, 'Presentation must not delete or mutate saved jobs');
});

test('explicit empty Active tab stays empty instead of showing successful or failed jobs', () => {
  const view = jobQueuePage([entry('old', 'COMPLETED'), entry('failed', 'FAILED', 'preparation')], 'active', 12);
  assert.equal(view.filter, 'active'); assert.equal(view.total, 0); assert.deepEqual(view.displayed, []);
  assert.equal(view.page, 1); assert.equal(view.pages, 1);
});

test('active queue is oldest first; saved history is newest first with deterministic ties', () => {
  const records = [entry('new', 'QUEUED', 'render', 4), entry('older', 'QUEUED', 'preparation', 2), entry('oldest', 'QUEUED', 'render', 1)];
  assert.deepEqual(jobQueuePage(records, 'active', 1).displayed.map(item => item.id), ['oldest', 'older', 'new']);
  assert.deepEqual(jobQueuePage(records, 'all', 1).displayed.map(item => item.id), ['new', 'older', 'oldest']);
  assert.deepEqual(records.map(item => item.id), ['new', 'older', 'oldest'], 'Sorting must not rewrite queue/FIFO state');
});

test('hundreds of histories mount at most eight jobs, including preparations, while every entry remains reachable', () => {
  const records = Array.from({ length: 103 }, (_, index) => entry(String(index).padStart(3, '0'), index % 2 ? 'FAILED' : 'COMPLETED', index % 3 ? 'render' : 'preparation'));
  const reached = new Set();
  const first = jobQueuePage(records, 'all', 1);
  assert.equal(first.total, records.length); assert.equal(first.displayed.length, JOB_PAGE_SIZE);
  for (let page = 1; page <= first.pages; page++) {
    const view = jobQueuePage(records, 'all', page);
    assert.ok(view.displayed.length <= 8);
    for (const record of view.displayed) reached.add(record.id);
  }
  assert.equal(reached.size, records.length);
});

test('pagination safely clamps after removal, invalid page values and malformed timestamps', () => {
  const records = [entry('safe', 'COMPLETED'), { ...entry('legacy', 'FAILED'), createdAt: 'unknown' }];
  for (const page of [-5, 0, 999, NaN, Infinity]) assert.equal(jobQueuePage(records, 'all', page).page, 1);
  assert.deepEqual(jobQueuePage(records, 'all', 1).displayed.map(item => item.id), ['safe', 'legacy']);
});
