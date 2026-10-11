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
    . ./scripts/publication-idle.ps1
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

test('both activation guards allow only a proved untouched Story waiting on a stopped Reel', { skip: process.platform !== 'win32' }, () => {
  const code = String.raw`
    $ErrorActionPreference = 'Stop'
    . ./scripts/publication-idle.ps1
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
    function Invoke-RestMethod { param($Uri, $TimeoutSec) return [pscustomobject]@{ resources = [pscustomobject]@{ busy = $false } } }
    function Test-PhoenixRecoveryBusy { param($Root) return $false }
    function Get-PhoenixPublicationUploadSessionIds {
      param($Root)
      if ($script:fixtureSessionFailure) { throw 'Mock unreadable private session state' }
      if ($script:fixtureChangeParent) { $parent.status = 'QUEUED'; [IO.File]::WriteAllText($parentPath, ($parent | ConvertTo-Json -Depth 8)) }
      if ($script:fixtureLateLock) { [IO.File]::WriteAllText(($storyPath + '.operation.lock'), 'fixture-owner') }
      return $script:fixtureSessionIds
    }
    $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('phoenix-stopped-story-fixture-' + [guid]::NewGuid().ToString('N'))
    $publications = Join-Path $fixtureRoot 'storage/private/review-publications'
    New-Item -ItemType Directory -Path $publications -Force | Out-Null
    $phoenixRoot = $fixtureRoot
    $fixtureHealth = Invoke-RestMethod
    $reviewId = '11111111-1111-4111-8111-111111111111'
    $parentId = '22222222-2222-4222-8222-222222222222'
    $storyId = '33333333-3333-4333-8333-333333333333'
    $storyPath = Join-Path $publications ($reviewId + '-instagram-story.json')
    $parentPath = Join-Path $publications ($reviewId + '-instagram.json')
    try {
      $cases = @(
        @{ name = 'untouched dependent Story'; allowed = $true; change = {} },
        @{ name = 'matching large Windows inode'; allowed = $true; change = { $story.fingerprint.ino = 10000000000000000; $parent.fingerprint.ino = 10000000000000000 } },
        @{ name = 'ordinary queue'; change = { $story.Remove('kind'); $story.Remove('parentReelId') } },
        @{ name = 'standalone Story'; change = { $story.standaloneStory = $true } },
        @{ name = 'fresh approval'; change = { $story.queuedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } },
        @{ name = 'future approval'; change = { $story.queuedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 60000 } },
        @{ name = 'parent queued'; change = { $parent.status = 'QUEUED' } },
        @{ name = 'parent uploading'; change = { $parent.status = 'UPLOADING' } },
        @{ name = 'parent processing'; change = { $parent.status = 'PROCESSING' } },
        @{ name = 'parent complete'; change = { $parent.status = 'COMPLETE'; $parent.phase = 'complete' } },
        @{ name = 'parent ambiguous'; change = { $parent.status = 'NEEDS_CHECK'; $parent.phase = 'session_unknown' } },
        @{ name = 'parent wrong identity'; change = { $story.parentReelId = '44444444-4444-4444-8444-444444444444' } },
        @{ name = 'parent approval absent'; change = { $parent.Remove('companionStoryApproved') } },
        @{ name = 'account mismatch'; change = { $parent.accountId = 'other-account' } },
        @{ name = 'revision mismatch'; change = { $parent.connectionRevision = 'other-revision' } },
        @{ name = 'media mismatch'; change = { $parent.fingerprint.ino = 2 } },
        @{ name = 'target mismatch'; change = { $parent.renderTarget = 'youtube' } },
        @{ name = 'Story provider phase'; change = { $story.phase = 'initiating' } },
        @{ name = 'parent provider phase'; change = { $parent.phase = 'session' } },
        @{ name = 'Story bytes sent'; change = { $story.bytesUploaded = 1 } },
        @{ name = 'parent bytes sent'; change = { $parent.bytesUploaded = 1 } },
        @{ name = 'malformed byte count'; change = { $story.bytesUploaded = '0' } },
        @{ name = 'container accepted'; change = { $story.containerId = 'fixture-container' } },
        @{ name = 'remote identity'; change = { $parent.remoteId = 'fixture-remote' } },
        @{ name = 'remote URL'; change = { $story.remoteUrl = 'https://www.instagram.com/p/fixture/' } },
        @{ name = 'Story private session'; change = { $script:fixtureSessionIds = @($storyId) } },
        @{ name = 'parent private session'; change = { $script:fixtureSessionIds = @($parentId) } },
        @{ name = 'unreadable session state'; change = { $script:fixtureSessionFailure = $true } },
        @{ name = 'parent changed during check'; change = { $script:fixtureChangeParent = $true } },
        @{ name = 'operation starts during check'; change = { $script:fixtureLateLock = $true } },
        @{ name = 'Story operation lease'; lock = 'story.operation' },
        @{ name = 'parent operation lease'; lock = 'parent.operation' },
        @{ name = 'Story approval lease'; lock = 'story' },
        @{ name = 'parent approval lease'; lock = 'parent' },
        @{ name = 'global stream lease'; lock = 'stream' },
        @{ name = 'vault mutation lease'; lock = 'vault' }
      )
      foreach ($case in $cases) {
        foreach ($guard in @('packaged', 'launcher')) {
          $script:fixtureSessionIds = @(); $script:fixtureSessionFailure = $false; $script:fixtureChangeParent = $false; $script:fixtureLateLock = $false
          foreach ($file in @(Get-ChildItem -LiteralPath $publications -File -Force)) { Remove-Item -LiteralPath $file.FullName -Force }
          $vaultLock = Join-Path $fixtureRoot 'storage/private/channels.enc.lock'
          if (Test-Path -LiteralPath $vaultLock) { Remove-Item -LiteralPath $vaultLock -Force }
          $story = @{ version = 1; id = $storyId; reviewId = $reviewId; platform = 'instagram'; kind = 'story'; parentReelId = $parentId;
            status = 'QUEUED'; phase = 'created'; bytesUploaded = 0; percent = 0; queuedAt = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 60000);
            accountId = 'fixture-account'; connectionRevision = 'fixture-revision'; renderTarget = 'instagram'; totalBytes = 1024;
            fingerprint = @{ size = 1024; mtimeMs = 1; ctimeMs = 1; ino = 1; dev = 1 } }
          $parent = @{ version = 1; id = $parentId; reviewId = $reviewId; platform = 'instagram'; companionStoryApproved = $true;
            status = 'FAILED'; phase = 'created'; bytesUploaded = 0; percent = 0; accountId = 'fixture-account'; connectionRevision = 'fixture-revision';
            renderTarget = 'instagram'; totalBytes = 1024; fingerprint = @{ size = 1024; mtimeMs = 1; ctimeMs = 1; ino = 1; dev = 1 } }
          if ($case.change) { & $case.change | Out-Null }
          [IO.File]::WriteAllText($storyPath, ($story | ConvertTo-Json -Depth 8))
          [IO.File]::WriteAllText($parentPath, ($parent | ConvertTo-Json -Depth 8))
          if ($case.lock) {
            $lockPath = switch ($case.lock) {
              'story.operation' { $storyPath + '.operation.lock' }
              'parent.operation' { $parentPath + '.operation.lock' }
              'story' { $storyPath + '.lock' }
              'parent' { $parentPath + '.lock' }
              'stream' { Join-Path $publications '.publication-stream.lock' }
              'vault' { $vaultLock }
            }
            [IO.File]::WriteAllText($lockPath, 'fixture-owner')
          }
          $blocked = $false; $blockReason = ''
          try {
            if ($guard -eq 'packaged') { Assert-PhoenixInstallIdle }
            else { Assert-PhoenixReleaseIdle $fixtureRoot $fixtureHealth }
          } catch { $blocked = $true; $blockReason = $_.Exception.Message }
          if ($blocked -eq [bool]$case.allowed) { throw ('Unexpected ' + $guard + ' result for ' + $case.name + ': ' + $blockReason) }
        }
      }
      'stopped Story guard checks passed'
    } finally {
      $resolved = [IO.Path]::GetFullPath($fixtureRoot)
      $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^phoenix-stopped-story-fixture-') { throw 'Unsafe fixture cleanup target' }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code],
    { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /stopped Story guard checks passed/);
});
