const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'src/app/dashboard/DashboardClient.tsx'), 'utf8');
const cardStart = dashboard.indexOf('{displayedJobs.map((job) => {');
const cardEnd = dashboard.indexOf('\n              })}', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart, 'Job cards have a bounded render block');
const cards = dashboard.slice(cardStart, cardEnd);

test('completed history cards summarize the reel, clip count, duration, and 100 percent', () => {
  assert.match(cards, /const completed = job\.status === "COMPLETED"/);
  assert.match(cards, /completed \? "Completed · 100%"/);
  assert.match(cards, /\{clipCount\} \{clipCount === 1 \? "clip" : "clips"\} · \{durationSeconds > 0 \? formatTime\(durationSeconds\) : "Duration unavailable"\}/);
  assert.match(cards, /Object\.values\(file\.outputs\)/);
  assert.match(cards, /Math\.max\(\.\.\.durations\)/);
  assert.match(cards, /!completed \? <div className="mt-3 h-2/);
});

test('active ETA and progress remain visible, while stage details are collapsed', () => {
  assert.match(cards, /\{!completed && timing\(job\) \? <p/);
  assert.match(cards, /<details className="mt-2 text-xs text-\[#687657\]">\s*<summary[^>]*>Technical details<\/summary>\s*<p className="mt-1">\{job\.detail\}<\/p>/);
});

test('posting tools remain accessible behind a compact disclosure on completed cards', () => {
  assert.match(cards, /<summary[^>]*>Posting tools/);
  assert.match(cards, /<PostingActions file=\{file\} \/><\/details>/);
  assert.match(cards, /Watch video/);
});

test('failed job errors and retry controls remain outside technical details', () => {
  const error = cards.indexOf('{job.error ? <p');
  const details = cards.indexOf('<details className="mt-2');
  assert.ok(error >= 0 && details > error, 'Actionable error appears before collapsed technical details');
  assert.match(cards, /job\.status === "FAILED" \|\| job\.status === "BLOCKED"/);
  assert.match(cards, /failed && job\.kind !== "edit"/);
});
