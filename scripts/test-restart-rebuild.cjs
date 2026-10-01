const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');

function fixture(env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-restart-fixture-'));
  const scripts = path.join(root, 'scripts'); fs.mkdirSync(scripts);
  fs.mkdirSync(path.join(root, 'storage')); fs.mkdirSync(path.join(root, '.next-verified'));
  fs.writeFileSync(path.join(root, '.next-verified', 'BUILD_ID'), 'fixture-build');
  fs.writeFileSync(path.join(root, 'storage', 'active-build.json'), JSON.stringify({ directory: '.next-verified' }));
  fs.writeFileSync(path.join(root, 'storage', 'worker-heartbeat.json'), JSON.stringify({ pid: 42 }));
  fs.copyFileSync(path.join(project, 'scripts/restart-phoenix.ps1'), path.join(scripts, 'restart-phoenix.ps1'));
  // Every process/network/build operation in this copied script resolves to a
  // fixture function. No real lifecycle helper, startup or build is executed.
  fs.writeFileSync(path.join(scripts, 'desktop-session.ps1'), String.raw`
    $global:fixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $global:fixtureEvents = Join-Path $global:fixtureRoot 'events.txt'
    $global:fixtureHeld = $false
    function Record-Event([string]$Value) { [IO.File]::AppendAllText($global:fixtureEvents, $Value + [Environment]::NewLine) }
    function Get-PhoenixCanonicalRoot([string]$Root) { return [IO.Path]::GetFullPath($Root) }
    function Get-PhoenixLifecycleMutexName([string]$Root) { Record-Event 'mutex-name'; return 'FixtureMutexNeverUsed' }
    function New-Object { param([string]$TypeName, [object[]]$ArgumentList)
      if ($TypeName -ne 'Threading.Mutex') { throw 'Unexpected object construction in fixture' }
      $fake = [pscustomobject]@{}
      $fake | Add-Member -MemberType ScriptMethod -Name WaitOne -Value { param($Timeout) $global:fixtureHeld=$true; Record-Event 'acquire'; return $true }
      $fake | Add-Member -MemberType ScriptMethod -Name ReleaseMutex -Value { $global:fixtureHeld=$false; Record-Event 'release' }
      $fake | Add-Member -MemberType ScriptMethod -Name Dispose -Value { Record-Event 'dispose' }
      return $fake
    }
    function Get-NetTCPConnection { param($LocalPort, $State, $ErrorAction) return [pscustomobject]@{OwningProcess=41} }
    function Invoke-RestMethod { param($Uri, $TimeoutSec) return [pscustomobject]@{resources=[pscustomobject]@{busy=($env:TEST_BUSY -eq '1')}} }
    function Get-CimInstance { param($ClassName, $Filter, $ErrorAction)
      $websiteCommand = $global:fixtureRoot + '\node_modules\next\dist\bin\next start'
      if ($env:TEST_UNKNOWN_WEBSITE -eq '1') { $websiteCommand='C:\unrelated\next start' }
      $snapshot = @(
        [pscustomobject]@{ProcessId=41;CommandLine=$websiteCommand},
        [pscustomobject]@{ProcessId=42;CommandLine=($global:fixtureRoot+'\run-worker.js')},
        [pscustomobject]@{ProcessId=43;CommandLine='Registered renderer'},
        [pscustomobject]@{ProcessId=44;CommandLine='Unregistered shared Ollama'}
      )
      if ($Filter) { $match=[regex]::Match($Filter, 'ProcessId = (\d+)'); return $snapshot | Where-Object {$_.ProcessId -eq [int]$match.Groups[1].Value} }
      return $snapshot
    }
    function Get-PhoenixProcessIdentity($Process, [string]$Role) { return [pscustomobject]@{pid=$Process.ProcessId;role=$Role} }
    function Read-PhoenixOwnedServices([string]$Filename) { Record-Event 'read-ownership'; return [pscustomobject]@{pid=43;role='stock-renderer'} }
    function Add-PhoenixOwnedDescendants([object[]]$Known, [object[]]$Snapshot) { return $Known }
    function Stop-PhoenixOwnedSession([object[]]$Known) { Record-Event ('stop:'+($Known.pid -join ',')) }
    function node { param([Parameter(ValueFromRemainingArguments=$true)]$Arguments)
      Record-Event 'build'
      if ($env:TEST_BUILD_THROW -eq '1') { throw 'Mock build invocation failed' }
      $global:LASTEXITCODE=[int]$env:TEST_BUILD_EXIT
    }
  `);
  fs.writeFileSync(path.join(scripts, 'start-phoenix.ps1'), String.raw`
    param([switch]$NoBrowser)
    Record-Event ('start:held='+$global:fixtureHeld)
    $global:LASTEXITCODE=0
  `);
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'restart-phoenix.ps1'), '-Rebuild', '-NoBrowser', '-NoPause'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 15000, env: { ...process.env, TEST_BUSY: '0', TEST_UNKNOWN_WEBSITE: '0', TEST_BUILD_THROW: '0', TEST_BUILD_EXIT: '0', ...env } });
    const eventsFile = path.join(root, 'events.txt');
    return { ...result, events: fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').split(/\r?\n/).filter(Boolean) : [] };
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('phoenix-restart-fixture-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('guarded build failure starts the previous verified website before reporting the failure', { skip: process.platform !== 'win32' }, () => {
  const result = fixture({ TEST_BUILD_EXIT: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.events.filter(event => /^(build|start|release)/.test(event)), ['build', 'start:held=True', 'release']);
  assert.match(result.stderr, /previous\s+verified\s+website/);
});

test('busy jobs reject rebuild without stopping anything or running startup/build', { skip: process.platform !== 'win32' }, () => {
  const result = fixture({ TEST_BUSY: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(!result.events.some(event => /^(stop|build|start|read-ownership)/.test(event)), result.events.join(','));
  assert.match(result.stderr, /heavy\s+job is active/);
});

test('rebuild holds the lifecycle mutex through replacement startup and preserves unknown shared services', { skip: process.platform !== 'win32' }, () => {
  const result = fixture();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.events.find(event => event.startsWith('stop:')), 'stop:42,41,43');
  assert.ok(result.events.indexOf('acquire') < result.events.indexOf('stop:42,41,43'));
  assert.ok(result.events.indexOf('start:held=True') < result.events.indexOf('release'));
  assert.ok(!result.events.some(event => event.startsWith('stop:') && event.includes('44')));
  const unknown = fixture({ TEST_UNKNOWN_WEBSITE: '1' });
  assert.equal(unknown.status, 1);
  assert.ok(!unknown.events.some(event => /^(stop|build|start)/.test(event)));
});

test('a thrown build invocation restores startup while the lifecycle mutex remains held', { skip: process.platform !== 'win32' }, () => {
  const result = fixture({ TEST_BUILD_THROW: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.events.includes('start:held=True'), result.events.join(','));
  assert.ok(result.events.indexOf('start:held=True') < result.events.indexOf('release'));
});

test('update installer and restart scripts parse and derive the current canonical project root', { skip: process.platform !== 'win32' }, () => {
  const code = String.raw`
    $ErrorActionPreference='Stop'
    foreach ($file in @('scripts/restart-phoenix.ps1','scripts/install-desktop-shortcut.ps1')) {
      $tokens=$null; $errors=$null
      [Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file),[ref]$tokens,[ref]$errors) | Out-Null
      if ($errors.Count) { throw ($errors | Out-String) }
    }
    . ./scripts/desktop-session.ps1
    $canonical=Get-PhoenixCanonicalRoot (Get-Location).Path
    if (-not (Test-Path -LiteralPath (Join-Path $canonical 'scripts/restart-phoenix.ps1'))) { throw 'Canonical root did not identify current project' }
    'parser and canonical root passed'
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const filename of ['restart-phoenix.ps1', 'install-desktop-shortcut.ps1']) assert.match(fs.readFileSync(path.join(project, 'scripts', filename), 'utf8'), /Get-PhoenixCanonicalRoot \(Join-Path \$PSScriptRoot '\.\.'\)/);
});
