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

test('both activation guards skip recognized settings, preserve queued uploads and reject unknown publication state', { skip: process.platform !== 'win32' }, () => {
  const code = String.raw`
    $ErrorActionPreference = 'Stop'
    foreach ($entry in @(
      @{ file = 'scripts/start-phoenix.ps1'; helpers = @('Read-PhoenixReleaseRecords', 'Assert-PhoenixReleaseIdle') },
      @{ file = 'scripts/activate-packaged-build.ps1'; helpers = @('Read-PhoenixInstallState', 'Assert-PhoenixInstallIdle') }
    )) {
      $tokens = $null; $errors = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $entry.file), [ref]$tokens, [ref]$errors)
      if ($errors.Count) { throw ($errors | Out-String) }
      foreach ($name in $entry.helpers) {
        $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        if (-not $definition) { throw ('Missing helper ' + $name) }
        . ([ScriptBlock]::Create($definition.Extent.Text))
      }
    }
    # Load function definitions only. Every health/lease check is inert, and all
    # saved publication data lives in this temporary fixture rather than owner stores.
    function Invoke-RestMethod { param($Uri, $TimeoutSec) return [pscustomobject]@{ resources = [pscustomobject]@{ busy = $false } } }
    function Test-PhoenixRecoveryBusy { param($Root) return $false }
    $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('phoenix-publication-guard-fixture-' + [guid]::NewGuid().ToString('N'))
    $publications = Join-Path $fixtureRoot 'storage/private/review-publications'
    New-Item -ItemType Directory -Path $publications -Force | Out-Null
    $fixtureFile = Join-Path $publications 'fixture.json'
    $phoenixRoot = $fixtureRoot
    $fixtureHealth = Invoke-RestMethod
    try {
      [IO.File]::WriteAllText((Join-Path $publications 'instagram-posting-defaults.json'), '{"version":1,"accountId":"123456789","userTags":["fixture_user"],"locationQuery":"Switzerland"}')
      [IO.File]::WriteAllText((Join-Path $publications 'instagram-story-business.json'), '{"version":1,"accountId":"123456789","connectionRevision":"fixture-revision","accountType":"BUSINESS","confirmedAt":"2026-10-11T00:00:00.000Z"}')
      $cases = @(
        @{ json = '{"status":"QUEUED"}'; blocked = $true },
        @{ json = '{"status":"UPLOADING"}'; blocked = $true },
        @{ json = '{"status":"PROCESSING"}'; blocked = $true },
        @{ json = '{"status":"COMPLETE"}'; blocked = $false },
        @{ json = '{"status":"FAILED"}'; blocked = $false },
        @{ json = '{"status":"NEEDS_CHECK"}'; blocked = $false },
        @{ json = '{"status":"UNKNOWN"}'; blocked = $true },
        @{ json = '{}'; blocked = $true },
        @{ json = '{"status":null}'; blocked = $true },
        @{ json = '[]'; blocked = $true },
        @{ json = '[{"status":"COMPLETE"}]'; blocked = $true },
        @{ json = 'null'; blocked = $true },
        @{ json = '{not valid JSON}'; blocked = $true }
      )
      foreach ($case in $cases) {
        [IO.File]::WriteAllText($fixtureFile, $case.json)
        foreach ($guard in @('packaged', 'launcher')) {
          $blocked = $false
          try {
            if ($guard -eq 'packaged') { Assert-PhoenixInstallIdle }
            else { Assert-PhoenixReleaseIdle $fixtureRoot $fixtureHealth }
          } catch { $blocked = $true }
          if ($blocked -ne $case.blocked) { throw ('Unexpected ' + $guard + ' activation result for ' + $case.json) }
        }
      }
      'publication guard checks passed'
    } finally {
      $resolved = [IO.Path]::GetFullPath($fixtureRoot)
      $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^phoenix-publication-guard-fixture-') { throw 'Unsafe fixture cleanup target' }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code],
    { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /publication guard checks passed/);
});
