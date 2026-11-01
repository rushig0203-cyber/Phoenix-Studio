const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { settings } = require('./launch-config.cjs');
const project = path.resolve(__dirname, '..');
test('launcher loads only allowed settings without secret leakage or inference calls', () => {
  assert.deepEqual(settings({ PHOENIX_MPT_DIR: 'C:/local/renderer', MPT_API_TOKEN: 'private', MOONSHOT_API_KEY: 'private' }), { backendDirectory: 'C:/local/renderer', backendUrl: 'http://127.0.0.1:8080', backendPort: 8080, writerProvider: 'ollama' });
  for (const url of ['https://host.example', 'http://user:secret@localhost:8080', 'http://127.0.0.1:8080/other', 'http://localhost:8080/?secret=private']) assert.throws(() => settings({ MPT_BASE_URL: url }), /plain loopback/);
  assert.equal(settings({}, 'cloudflare').writerProvider, 'cloudflare');
});
test('Windows startup scripts parse and service checks require identity and readiness', { skip: process.platform !== 'win32' }, () => {
  const code = `
    $ErrorActionPreference = 'Stop'
    foreach ($file in @('scripts/start-phoenix.ps1', 'scripts/startup-health.ps1', 'scripts/desktop-session.ps1', 'scripts/watch-desktop-session.ps1', 'scripts/reload-desktop-session.ps1')) {
      $parseErrors = $null; $tokens = $null
      [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file), [ref]$tokens, [ref]$parseErrors) | Out-Null
      if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    }
    . ./scripts/startup-health.ps1
    if (Test-PhoenixNeedsOllama 'cloudflare') { throw 'Cloudflare incorrectly requested local Ollama' }
    if (-not (Test-PhoenixNeedsOllama 'ollama')) { throw 'Local writer no longer requests Ollama' }
    function Invoke-WebRequest { param($Uri, [switch]$UseBasicParsing, $TimeoutSec) return [pscustomobject]@{StatusCode=200; Content=$script:fakeContent} }
    $script:fakeContent = '{}'
    if (Test-PhoenixServiceHttp 'http://localhost' 'website') { throw 'Unrelated website accepted' }
    $script:fakeContent = '<title>Phoenix Studio</title>'
    if (-not (Test-PhoenixServiceHttp 'http://localhost' 'website')) { throw 'Phoenix website rejected' }
    $script:fakeContent = '{}'
    if (Test-PhoenixServiceHttp 'http://localhost' 'renderer') { throw 'Unrelated HTTP service accepted' }
    $script:fakeContent = '{"models":[]}'
    if (-not (Test-PhoenixServiceHttp 'http://localhost' 'ollama')) { throw 'Ollama inventory rejected' }
    $script:fakeContent = '{"components":{"schemas":{"TaskVideoRequest":{"properties":{"phoenix_artifacts_version":{"type":"integer"}}}}}}'
    if (-not (Wait-PhoenixService 'http://localhost' 'renderer' $null 1)) { throw 'Ready compatible renderer rejected' }
    $script:fakeContent = '{}'
    if (Wait-PhoenixService 'http://localhost' 'renderer' $null 0) { throw 'Timeout incorrectly ready' }
    if (Test-PhoenixWorkerHeartbeat 'absent-heartbeat.json' 123) { throw 'Missing worker accepted' }
    'startup checks passed'
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /startup checks passed/);
});
test('normal start and developer start include local dependency startup', () => {
  const pkg = require('../package.json');
  assert.match(pkg.scripts.start, /start-phoenix.ps1 -NoBrowser/);
  assert.match(pkg.scripts.predev, /-ServicesOnly -NoBrowser/);
  assert.match(pkg.scripts.dev, /run-worker.js/);
  const launcher = fs.readFileSync(path.join(project, 'scripts/start-phoenix.ps1'), 'utf8');
  assert.match(launcher, /Test-PhoenixWorkerHeartbeat/); assert.match(launcher, /launch-config.cjs/);
  assert.doesNotMatch(launcher, /Test-PhoenixHttp/);
  assert.equal((launcher.match(/Test-PhoenixServiceHttp \$phoenixUrl 'website'/g) || []).length, 2);
  assert.match(launcher, /PYTHONIOENCODING = 'utf-8'/); assert.match(launcher, /WindowStyle Hidden/);
  assert.match(launcher, /PHOENIX_RENDER_THREADS = '1'/);
  assert.match(launcher, /PHOENIX_TRANSCRIBE_THREADS = '1'/);
  assert.equal((launcher.match(/--max-old-space-size=512/g)||[]).length,1,'The website keeps its existing allowance; the worker uses release-aware selection');
  assert.match(pkg.scripts.worker,/^node --max-old-space-size=192 run-worker\.js$/);
  assert.doesNotMatch(launcher, /^\s*(?:&\s+)?npm(?:\.cmd)?\s+(?:run\s+)?build/m);
});

test('worker readiness preserves UTC for JSON strings and PowerShell DateTime across cultures', {skip:process.platform!=='win32'},()=>{
  const code=`
    $ErrorActionPreference='Stop'
    . ./scripts/startup-health.ps1
    function Get-Content { param($LiteralPath,[switch]$Raw) return $script:heartbeatJson }
    foreach($culture in @('en-US','en-GB','hi-IN')) {
      [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo($culture)
      $script:heartbeatJson=@{pid=123;at=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
      if(-not (Test-PhoenixWorkerHeartbeat 'fixture' 123)){throw "Fresh UTC worker rejected: $culture"}
      if(Test-PhoenixWorkerHeartbeat 'fixture' 124){throw 'Wrong PID accepted'}
      foreach($offset in @(-30,30)) {
        $script:heartbeatJson=@{pid=123;at=[DateTimeOffset]::UtcNow.AddSeconds($offset).ToString('o')}|ConvertTo-Json -Compress
        if(Test-PhoenixWorkerHeartbeat 'fixture' 123){throw 'Stale or future heartbeat accepted'}
      }
      $script:heartbeatJson='{"pid":123,"at":"not a timestamp"}'
      if(Test-PhoenixWorkerHeartbeat 'fixture' 123){throw 'Invalid heartbeat accepted'}
    }
    'UTC readiness checks passed'
  `;
  for(const shell of ['powershell.exe','pwsh.exe']){
    const result=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',code],{cwd:project,windowsHide:true,encoding:'utf8',timeout:15000});
    if(shell==='pwsh.exe'&&result.error?.code==='ENOENT')continue;
    assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/UTC readiness checks passed/);
  }
});

test('cold worker startup waits for a matching ready heartbeat, with bounded timeout and exit detection', { skip: process.platform !== 'win32' }, () => {
  const code = `
    $ErrorActionPreference = 'Stop'
    . ./scripts/startup-health.ps1
    $script:checks = 0
    function Test-PhoenixWorkerHeartbeat { param($Path, $WorkerId)
      if ($Path -ne 'fixture-heartbeat' -or $WorkerId -ne 123) { throw 'Wrong identity checked' }
      $script:checks++
      return $script:checks -ge 4
    }
    function Start-Sleep { param($Milliseconds) }
    if (-not (Wait-PhoenixWorker 'fixture-heartbeat' 123 $null 1)) { throw 'Cold startup not awaited' }
    if ($script:checks -ne 4) { throw 'Readiness was not observed' }
    $script:checks = 0
    if (Wait-PhoenixWorker 'fixture-heartbeat' 123 $null 0) { throw 'Timeout falsely ready' }
    if ($script:checks -ne 0) { throw 'Timeout performed extra work' }
    $exited = [pscustomobject]@{HasExited=$true}
    $exited | Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
    if (Wait-PhoenixWorker 'fixture-heartbeat' 123 $exited 1) { throw 'Exited process falsely ready' }
    if ($script:checks -ne 0) { throw 'Exited worker was accepted from stale heartbeat' }
    'cold startup checks passed'
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /cold startup checks passed/);
  const launcher = fs.readFileSync(path.join(project, 'scripts/start-phoenix.ps1'), 'utf8');
  const startupHealth = fs.readFileSync(path.join(project, 'scripts/startup-health.ps1'), 'utf8');
  assert.match(startupHealth, /function Wait-PhoenixWorker\([^\n]+\[int\]\$Seconds = 90\)/);
  assert.match(launcher, /Wait-PhoenixWorker[^\n]+90/);
});
test('compiled desktop workers use the verified smaller heap while legacy rollback keeps its allowance', {skip:process.platform!=='win32'}, () => {
  const os=require('node:os'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-worker-heap-'));
  fs.mkdirSync(path.join(directory,'.next-heap-test'));
  const code=`
    $ErrorActionPreference='Stop'
    . ./scripts/startup-health.ps1
    $root=$env:PHOENIX_TEST_HEAP_ROOT
    $file=Join-Path $root '.next-heap-test/required-server-files.json'
    @{config=@{env=@{PHOENIX_WORKER_RUNTIME='compiled-cjs-v1'}}}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $file
    if((Get-PhoenixWorkerHeapMiB $root '.next-heap-test') -ne 192){throw 'Compiled worker heap is not bounded'}
    @{config=@{env=@{}}}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $file
    if((Get-PhoenixWorkerHeapMiB $root '.next-heap-test') -ne 512){throw 'Legacy rollback heap changed'}
    foreach($value in @('future-protocol','COMPILED-CJS-V1','',$null,$true)){
      @{config=@{env=@{PHOENIX_WORKER_RUNTIME=$value}}}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $file
      $rejected=$false;try{Get-PhoenixWorkerHeapMiB $root '.next-heap-test'}catch{$rejected=$true}
      if(-not $rejected){throw 'Unknown protocol was accepted'}
    }
    $rejected=$false;try{Get-PhoenixWorkerHeapMiB $root '../outside'}catch{$rejected=$true}
    if(-not $rejected){throw 'Outside build was accepted'}
    Write-Output 'Worker heap selection verified'
  `;
  try {
    for(const shell of ['powershell.exe','pwsh.exe']){
      const result=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',code],{cwd:project,windowsHide:true,encoding:'utf8',timeout:15000,env:{...process.env,PHOENIX_TEST_HEAP_ROOT:directory}});
      if(shell==='pwsh.exe'&&result.error?.code==='ENOENT')continue;
      assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/Worker heap selection verified/);
    }
  } finally {assert.equal(fs.realpathSync(path.dirname(directory)),fs.realpathSync(os.tmpdir()));assert.ok(!fs.lstatSync(directory).isSymbolicLink());fs.rmSync(directory,{recursive:true,force:true});}
});
