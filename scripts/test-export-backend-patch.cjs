'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'export-backend-patch.cjs'), 'utf8');
const base = '3ade9fbc40e18db32a5edb340d49e31ea0dd5528';
const patch = 'diff --git a/main.py b/main.py\n--- a/main.py\n+++ b/main.py\n@@ -1 +1 @@\n-old\n+new\n';

function verify(saved, options = {}) {
  const calls = [], writes = [];
  let error;
  try {
    vm.runInNewContext(source, {
      __dirname, process: { env: {}, platform: 'win32', argv: options.write ? ['--write'] : [] },
      console: { log() {} },
      require(name) {
        if (name === 'node:path') return path;
        if (name === 'node:fs') return {
          readFileSync() { return saved; },
          writeFileSync(...args) { writes.push(args); },
        };
        assert.equal(name, 'node:child_process');
        return { spawnSync(command, args, spawnOptions) {
          assert.equal(command, 'git');
          calls.push({ args, options: spawnOptions });
          if (args[0] === 'rev-parse') return { status: 0, stdout: options.base || base };
          if (args[0] === 'diff') return { status: 0, stdout: args.includes('--no-index') ? '' : (options.generated || patch) };
          assert.deepEqual(Array.from(args), ['apply', '--reverse', '--check', '-']);
          return { status: options.applyFails ? 1 : 0, stdout: '', stderr: 'fixture apply failure' };
        } };
      },
    });
  } catch (caught) { error = caught; }
  return { calls, writes, error };
}

test('CRLF checkout and Git output use the same exact LF patch for reverse checking', () => {
  for (const saved of [patch, patch.replace(/\n/g, '\r\n')]) {
    for (const generated of [patch, patch.replace(/\n/g, '\r\n')]) {
      const result = verify(saved, { generated });
      assert.ifError(result.error);
      assert.equal(result.calls.at(-1).options.input, patch);
      assert.equal(result.writes.length, 0);
      assert.equal(result.calls.filter(call => call.args.includes('--no-index')).length, 5);
      assert.deepEqual(Array.from(result.calls[1].args).slice(4), ['.gitignore', 'app/controllers/v1/video.py', 'app/models/schema.py', 'app/services/task.py', 'app/services/video.py', 'config.example.toml', 'docker-compose.release.yml', 'main.py', 'test/services/test_schema.py', 'test/services/test_video.py']);
    }
  }
});

test('content and whitespace differences still fail without writing or applying anything', () => {
  for (const saved of [patch.replace('+new', '+different'), patch.replace('+new', '+new '), patch.replace('+new', '+\tnew'), patch.replace('+new', '+\rnew')]) {
    const result = verify(saved);
    assert.match(result.error?.message || '', /differs from the current reviewed files/);
    assert.equal(result.calls.some(call => call.args[0] === 'apply'), false);
    assert.equal(result.writes.length, 0);
  }
});

test('base mismatch and reverse apply failures retain their blockers', () => {
  const wrongBase = verify(patch, { base: 'f'.repeat(40) });
  assert.match(wrongBase.error?.message || '', /base commit differs/);
  assert.equal(wrongBase.calls.length, 1);
  assert.match(verify(patch, { applyFails: true }).error?.message || '', /command failed/);
});

test('explicit export writes the normalized reviewed patch and still reverse-checks it', () => {
  const result = verify('previous patch', { write: true, generated: patch.replace(/\n/g, '\r\n') });
  assert.ifError(result.error);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0][1], patch);
  assert.equal(result.calls.at(-1).options.input, patch);
});
