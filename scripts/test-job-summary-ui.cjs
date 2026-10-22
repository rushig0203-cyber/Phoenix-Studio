const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'src/app/dashboard/DashboardClient.tsx'), 'utf8');
const cardStart = dashboard.indexOf('{queue.displayed.map((entry) => {');
const cardEnd = dashboard.indexOf('\n              })}', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart, 'Job cards have a bounded render block');
const cards = dashboard.slice(cardStart, cardEnd);

test('completed history cards summarize the reel, clip count, duration, and 100 percent', () => {
  assert.match(cards, /const completed = job\.status === "COMPLETED"/);
  assert.match(cards, /completed \? "Completed · 100%"/);
  assert.match(cards, /\{clipCount\} \{clipCount === 1 \? "clip" : "clips"\} · \{durationSeconds > 0 \? formatTime\(durationSeconds\) : "Duration unavailable"\}/);
  assert.match(cards, /Object\.values\(file\.outputs \|\| \{\}\)/);
  assert.match(cards, /Math\.max\(\.\.\.durations\)/);
  assert.match(cards, /!completed \? <div className="mt-3 h-2/);
});

test('compact job names and dates reveal progress, ETA, stage and errors only inside a closed disclosure', () => {
  assert.match(cards, /\{!completed && timing\(job\) \? <p/);
  assert.match(cards, /!completed && !failed && job\.stage \? <p/);
  assert.match(cards, /<details className="min-w-0">\s*<summary title="Show job details"/);
  assert.match(cards, /<time dateTime=\{dated \? job\.createdAt : undefined\}/);
  assert.match(cards, /dateStyle: "medium", timeStyle: "short"/);
  assert.ok(cards.indexOf('<details className="min-w-0">') < cards.indexOf('{job.error ? <p'));
  assert.doesNotMatch(cards, /<details[^>]*\bopen(?:\s|=|>)/);
});

test('Create uses short workflow cards without the removed editing essay or a fixed duration claim', () => {
  const start = dashboard.indexOf('<section aria-label="Creation workflows"');
  const end = dashboard.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start);
  const workflows = dashboard.slice(start, end);
  for (const title of ['Clip a Video', 'Create a Video', 'Make a Reel']) assert.ok(workflows.includes(`>${title}</h2>`));
  assert.doesNotMatch(workflows, /<p(?:\s|>)/);
  assert.doesNotMatch(dashboard, /40–45 second reel/);
});

test('posting tools remain accessible behind a compact disclosure on completed cards', () => {
  assert.match(cards, /<summary[^>]*>Posting tools/);
  assert.match(cards, /<PostingActions file=\{file\} \/><\/details>/);
  assert.match(cards, /Watch video/);
});

test('Delete and explicit failed-job Recover stay outside details, while both phases share one ordered list', () => {
  assert.match(cards, /job\.status === "FAILED" \|\| job\.status === "BLOCKED"/);
  assert.match(cards, /failed && job\.kind !== "edit"/);
  assert.ok(cards.indexOf('Recover failed job:') > cards.lastIndexOf('</details>'));
  assert.match(cards, /Delete job history/);
  assert.match(cards, /disabled=\{offline \|\| active \|\| removingJob !== null \|\| retrying !== null\}/);
  assert.doesNotMatch(dashboard, /displayedDrafts|displayedJobs|grouped separately/);
  assert.match(cards, /if \("draft" in entry\)/);
});
