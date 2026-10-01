const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');

test('desktop lifecycle proves ownership, protects reused PIDs, and captures close-boundary children', { skip: process.platform !== 'win32' }, () => {
  const code = String.raw`
    $ErrorActionPreference = 'Stop'
    . ./scripts/desktop-session.ps1
    $script:fakeSnapshot = @()
    $script:fakeNative = @{}
    $script:stopped = @()
    $script:baseTime = [DateTime]::UtcNow.AddMinutes(-10)
    function New-FakeProcess([int]$Id, [int]$Parent, [int]$Offset, [string]$Command) {
      $script:fakeSnapshot += [pscustomobject]@{ ProcessId=$Id; ParentProcessId=$Parent; ExecutablePath='C:\fixture\node.exe'; CommandLine=$Command }
      $native = [pscustomobject]@{ Id=$Id; StartTime=$script:baseTime.AddSeconds($Offset); Handle=[IntPtr]$Id }
      $native | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
      $script:fakeNative[$Id] = $native
    }
    function Get-CimInstance { param($ClassName, $Filter, $ErrorAction)
      if ($Filter) { $match = [regex]::Match($Filter, 'ProcessId = (\d+)'); return @($script:fakeSnapshot | Where-Object {$_.ProcessId -eq [int]$match.Groups[1].Value}) | Select-Object -First 1 }
      return $script:fakeSnapshot
    }
    function Get-Process { param([int]$Id, $ErrorAction)
      if (-not $script:fakeNative.ContainsKey($Id)) { throw 'Fixture exited' }
      return $script:fakeNative[$Id]
    }
    function Stop-Process { param($InputObject, $ErrorAction)
      $script:stopped += $InputObject.Id
      if ($InputObject.Id -eq 201) {
        # A render starts after the final pre-close snapshot but before its
        # dispatcher stops. Its native parent handle is retained during scanning.
        New-FakeProcess 207 201 30 'ffmpeg close-boundary'
        New-FakeProcess 208 207 31 'transcriber child'
      }
      $script:fakeSnapshot = @($script:fakeSnapshot | Where-Object {$_.ProcessId -ne $InputObject.Id})
      $script:fakeNative.Remove($InputObject.Id)
    }
    New-FakeProcess 201 1 0 'Phoenix worker'
    New-FakeProcess 203 201 10 'ffmpeg owned'
    New-FakeProcess 204 203 11 'owned grandchild'
    New-FakeProcess 205 901 12 'unrelated ffmpeg'
    New-FakeProcess 206 201 -1 'older process with a stale parent PID'
    New-FakeProcess 701 1 0 'already running shared Ollama'
    $root = Get-PhoenixProcessIdentity ($script:fakeSnapshot | Where-Object {$_.ProcessId -eq 201}) 'worker'
    $owned = @(Add-PhoenixOwnedDescendants @($root) $script:fakeSnapshot)
    if (($owned.pid -join ',') -ne '201,203,204') { throw 'Process tree admitted an unrelated or older child' }
    $script:fakeNative[201].StartTime = $script:baseTime.AddSeconds(100)
    if (Test-PhoenixProcessIdentity $root ($script:fakeSnapshot | Where-Object {$_.ProcessId -eq 201})) { throw 'Reused PID accepted' }
    if (Stop-PhoenixVerifiedProcess $root) { throw 'Reused PID stopped' }
    if ($script:stopped.Count) { throw 'Unproven process reached Stop-Process' }
    $script:fakeNative[201].StartTime = $script:baseTime
    Stop-PhoenixOwnedSession $owned
    foreach ($expected in @(201,203,204,207,208)) { if ($expected -notin $script:stopped) { throw "Owned process $expected leaked" } }
    foreach ($protected in @(205,206,701)) { if ($protected -in $script:stopped) { throw "Unrelated process $protected stopped" } }
    if (($script:stopped | Select-Object -First 1) -ne 201) { throw 'Dispatcher not stopped before its children' }
    'desktop ownership checks passed'
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /desktop ownership checks passed/);
});

test('desktop aliases resolve to one mutex and cycles fail closed', { skip: process.platform !== 'win32' }, () => {
  const code = String.raw`
    $ErrorActionPreference = 'Stop'
    . ./scripts/desktop-session.ps1
    function Get-Item { param($LiteralPath, [switch]$Force, $ErrorAction)
      switch ($LiteralPath) {
        'C:\fixture\desktop' { return [pscustomobject]@{ PSIsContainer=$true; LinkType='Junction'; Target=@('C:\fixture\canonical') } }
        'C:\fixture\canonical' { return [pscustomobject]@{ PSIsContainer=$true; LinkType=$null } }
        'C:\fixture\cycle' { return [pscustomobject]@{ PSIsContainer=$true; LinkType='Junction'; Target=@('cycle') } }
        default { throw 'Unexpected fixture path' }
      }
    }
    $alias = Get-PhoenixCanonicalRoot 'C:\fixture\desktop'
    $direct = Get-PhoenixCanonicalRoot 'C:\fixture\canonical'
    if ($alias -ne $direct -or (Get-PhoenixLifecycleMutexName $alias) -ne (Get-PhoenixLifecycleMutexName $direct)) { throw 'Alias created a separate lifecycle' }
    $blocked = $false
    try { Get-PhoenixCanonicalRoot 'C:\fixture\cycle' | Out-Null } catch { $blocked = $true }
    if (-not $blocked) { throw 'Link cycle accepted' }
    'canonical lifecycle checks passed'
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /canonical lifecycle checks passed/);
});

test('desktop close is serialized with reopen and headless launches never attach a browser guardian', () => {
  const launcher = fs.readFileSync(path.join(project, 'scripts/start-phoenix.ps1'), 'utf8');
  const guardian = fs.readFileSync(path.join(project, 'scripts/watch-desktop-session.ps1'), 'utf8');
  const helpers = fs.readFileSync(path.join(project, 'scripts/desktop-session.ps1'), 'utf8');
  assert.match(launcher, /if \(-not \$NoBrowser\) \{[\s\S]*--user-data-dir=[\s\S]*watch-desktop-session\.ps1/);
  assert.match(launcher, /desktop-session-.*session\.token/);
  assert.match(guardian, /Get-PhoenixLifecycleMutexName[\s\S]*WaitOne[\s\S]*\$latest\.token -ne \$session\.token[\s\S]*Stop-PhoenixOwnedSession/);
  assert.match(helpers, /Stop-Process -InputObject \$native/);
  assert.doesNotMatch(helpers + guardian, /^\s*taskkill|Stop-Process\s+-Name|Remove-Item[^\n]+-Recurse/m);
});
