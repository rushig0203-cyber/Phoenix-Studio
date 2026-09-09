const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('the production worker loads all processors without taking a job', () => {
  const result = spawnSync(process.execPath, ['run-worker.js', '--preflight'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=384' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /worker preflight passed/);
});
