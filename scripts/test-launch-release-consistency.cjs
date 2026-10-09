const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');

test('normal launcher requires installed selection before services and never silently falls back or builds', () => {
  const source = fs.readFileSync(path.join(project, 'scripts/start-phoenix.ps1'), 'utf8');
  assert.doesNotMatch(source, /\.next-lumina/);
  assert.doesNotMatch(source, /restart-phoenix\.ps1'\)[^\r\n]*-Rebuild/);
  assert.ok(source.indexOf('if (-not $ServicesOnly) { $phoenixSelectedBuild = Get-PhoenixSelectedBuild') < source.indexOf('$phoenixConfigText ='));
  assert.match(source, /Confirm-PhoenixSelectedRelease \$phoenixRoot/);
  assert.match(source, /\$script:phoenixOwnedServices = @\(Read-PhoenixOwnedServices \$phoenixOwnershipFile\)/);
});
test('release consistency helpers preserve idle canonical activation, active jobs and foreign processes', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'test-launch-release-consistency.ps1')],
    { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const label of ['idle activation', 'same-build fast path', 'required selection', 'idle safety', 'saved work safety', 'identity safety', 'failure and recursion safety']) {
    assert.ok(result.stdout.includes(label + ' passed'), result.stdout);
  }
});
