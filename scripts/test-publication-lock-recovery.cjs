'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFile } = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const project = path.resolve(__dirname, '..'), reviewId = '11111111-1111-4111-8111-111111111111';
const deadPid = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
const deadToken = `${deadPid}-22222222-2222-4222-8222-222222222222`;
const quote = value => "'" + value.replace(/'/g, "''") + "'";
const shells = process.platform === 'win32' ? ['powershell.exe', ...(spawnSync('pwsh.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { windowsHide: true }).status === 0 ? ['pwsh.exe'] : [])] : [];

async function isolated(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phoenix-native-lock-tests-'));
  const publications = path.join(root, 'storage/private/review-publications');
  await fs.mkdir(publications, { recursive: true });
  const story = path.join(publications, reviewId + '-instagram-story.json'), reel = path.join(publications, reviewId + '-instagram.json');
  const locks = [story + '.lock', story + '.operation.lock', reel + '.lock', reel + '.operation.lock', path.join(publications, '.publication-stream.lock'), path.join(root, 'storage/private/channels.enc.lock')];
  try { await run({ root, publications, story, reel, locks }); }
  finally {
    assert.equal(await fs.realpath(path.dirname(root)), await fs.realpath(os.tmpdir()));
    assert.match(path.basename(root), /^phoenix-native-lock-tests-/);
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function oldLock(filename, token = deadToken) {
  await fs.writeFile(filename, token);
  const old = new Date(Date.now() - 120000); await fs.utimes(filename, old, old);
}
async function powershell(shell, code) {
  const { stdout, stderr } = await execute(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference='Stop'; . ./scripts/recover-publication-locks.ps1; " + code], { cwd: project, windowsHide: true, timeout: 20000, maxBuffer: 65536 });
  assert.equal(stderr, ''); return JSON.parse(stdout.trim());
}
async function recover(shell, root, id = reviewId) {
  return powershell(shell, `(Repair-PhoenixAbandonedPublicationLocks ${quote(root)} ${quote(id)}) | ConvertTo-Json -Compress`);
}

for (const shell of shells) {
  test(`${shell}: no-lock startup loads no native type or child runtime`, async () => isolated(async ({ root }) => {
    const result = await powershell(shell, `$ok=Repair-PhoenixAbandonedPublicationLocks ${quote(root)} ${quote(reviewId)}; @{ok=$ok;nativeLoaded=[bool]('Phoenix.SafePostingLockRecovery'-as[type])}|ConvertTo-Json -Compress`);
    assert.deepEqual(result, { nativeLoaded: false, ok: true });
    assert.equal(await recover(shell, root, '../escaped'), false);
  }));

  test(`${shell}: only six old dead-owner locks recover, preserving records and unrelated files`, async () => isolated(async ({ root, locks, story, reel, publications }) => {
    const stores = [story, reel, path.join(root, 'storage/private/channels.enc')];
    const contents = ['{"status":"QUEUED","phase":"created"}', '{"status":"FAILED","phase":"created"}', 'private-fixture-envelope'];
    for (let i = 0; i < stores.length; i++) await fs.writeFile(stores[i], contents[i]);
    for (const filename of locks) await oldLock(filename);
    const unrelated = path.join(publications, 'unrelated.operation.lock'); await oldLock(unrelated);
    assert.equal(await recover(shell, root), true);
    for (const filename of locks) await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
    for (let i = 0; i < stores.length; i++) assert.equal(await fs.readFile(stores[i], 'utf8'), contents[i]);
    assert.equal(await fs.readFile(unrelated, 'utf8'), deadToken);
  }));

  test(`${shell}: live, fresh, malformed, oversized and successor tokens remain unchanged`, async () => isolated(async ({ root, locks }) => {
    const filename = locks[0], live = `${process.pid}-33333333-3333-4333-8333-333333333333`;
    for (const token of [live, 'malformed', 'x'.repeat(65), '2147483648-11111111-1111-4111-8111-111111111111']) {
      await oldLock(filename, token); assert.equal(await recover(shell, root), false); assert.equal(await fs.readFile(filename, 'utf8'), token);
    }
    await oldLock(filename); await fs.utimes(filename, new Date(), new Date());
    assert.equal(await recover(shell, root), false); assert.equal(await fs.readFile(filename, 'utf8'), deadToken);
    await oldLock(filename); await oldLock(filename, live);
    assert.equal(await recover(shell, root), false); assert.equal(await fs.readFile(filename, 'utf8'), live);
    assert.deepEqual((await fs.readdir(path.dirname(filename))).filter(name => name.includes('.stale-')), []);
  }));

  test(`${shell}: only an old untouched Story may wait on a stopped container-backed Reel with its private session`, async () => isolated(async ({ root, story, reel, locks }) => {
    const parentId = '22222222-2222-4222-8222-222222222222', storyId = '33333333-3333-4333-8333-333333333333';
    const shared = { version: 1, reviewId, platform: 'instagram', bytesUploaded: 0, percent: 0, queuedAt: Date.now() - 60000,
      accountId: 'fixture-account', connectionRevision: 'fixture-revision', renderTarget: 'instagram', totalBytes: 1024,
      fingerprint: { size: 1024, mtimeMs: 1, ctimeMs: 1, ino: 1, dev: 1 } };
    const child = { ...shared, id: storyId, kind: 'story', parentReelId: parentId, status: 'QUEUED', phase: 'created' };
    const parent = { ...shared, id: parentId, companionStoryApproved: true, status: 'NEEDS_CHECK', phase: 'sending', containerId: '1234567890' };
    const result = await powershell(shell, String.raw`
      . ./scripts/publication-idle.ps1
      Add-Type -AssemblyName System.Security
      $root = ${quote(root)}; $storyPath = ${quote(story)}; $parentPath = ${quote(reel)}
      $lockPaths = @(${locks.map(quote).join(',')})
      $vaultPath = Join-Path $root 'storage/private/channels.enc'
      $cases = @(
        @{ name = 'stopped sending with parent session'; allowed = $true; change = {} },
        @{ name = 'partial sending'; allowed = $true; change = { $parent.bytesUploaded = 512; $parent.percent = 40 } },
        @{ name = 'saved session'; allowed = $true; change = { $parent.phase = 'session' } },
        @{ name = 'remote processing'; allowed = $true; change = { $parent.phase = 'processing'; $parent.bytesUploaded = 1024; $parent.percent = 96 } },
        @{ name = 'publish request stopped'; allowed = $true; change = { $parent.phase = 'publishing'; $parent.bytesUploaded = 1024; $parent.percent = 98 } },
        @{ name = 'publish result unknown'; allowed = $true; change = { $parent.phase = 'publish_unknown'; $parent.bytesUploaded = 1024; $parent.percent = 98 } },
        @{ name = 'no saved parent session'; allowed = $true; change = { $sessions.Clear() } },
        @{ name = 'Story private session'; change = { $sessions[${quote(storyId)}] = 'fixture-story-session' } },
        @{ name = 'fresh parent'; change = { $parent.queuedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } },
        @{ name = 'future parent'; change = { $parent.queuedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 60000 } },
        @{ name = 'untyped parent age'; change = { $parent.queuedAt = '1' } },
        @{ name = 'missing container'; change = { $parent.containerId = '' } },
        @{ name = 'untyped container'; change = { $parent.containerId = 1234567890 } },
        @{ name = 'non-ASCII container'; change = { $parent.containerId = [string][char]0x0661 } },
        @{ name = 'invalid byte count'; change = { $parent.bytesUploaded = '0' } },
        @{ name = 'negative byte count'; change = { $parent.bytesUploaded = -1 } },
        @{ name = 'bytes beyond saved file'; change = { $parent.bytesUploaded = 1025 } },
        @{ name = 'complete progress'; change = { $parent.percent = 100 } },
        @{ name = 'untyped status'; change = { $parent.status = @('NEEDS_CHECK') } },
        @{ name = 'untyped phase'; change = { $parent.phase = @('sending') } },
        @{ name = 'untyped identity'; change = { $parent.id = @(${quote(parentId)}) } },
        @{ name = 'untyped fingerprint'; change = { $parent.fingerprint = @($parent.fingerprint) } },
        @{ name = 'mismatched media'; change = { $parent.fingerprint.ino = 2 } },
        @{ name = 'mismatched revision'; change = { $parent.connectionRevision = 'another-revision' } },
        @{ name = 'remote identity'; change = { $parent | Add-Member NoteProperty remoteId '1234567890' } },
        @{ name = 'malformed remote metadata'; change = { $parent | Add-Member NoteProperty remoteUrl $false } },
        @{ name = 'corrupt vault'; corruptVault = $true; change = {} },
        @{ name = 'custom store'; customStore = $true; change = {} }
      )
      foreach ($phase in @('created', 'initiating', 'session_unknown', 'complete', 'unknown')) { $cases += @{ name = ('unsafe phase ' + $phase); phase = $phase } }
      foreach ($status in @('QUEUED', 'UPLOADING', 'PROCESSING', 'COMPLETE', 'FAILED')) { $cases += @{ name = ('not stopped ' + $status); status = $status } }
      foreach ($index in 0..5) { $cases += @{ name = ('live owner lock ' + $index); lock = $index } }
      foreach ($case in $cases) {
        $story = ${quote(JSON.stringify(child))} | ConvertFrom-Json
        $parent = ${quote(JSON.stringify(parent))} | ConvertFrom-Json
        $sessions = @{ ${quote(parentId)} = 'fixture-private-parent-session' }
        foreach ($lock in $lockPaths) { if (Test-Path -LiteralPath $lock) { Remove-Item -LiteralPath $lock -Force } }
        if ($case.change) { & $case.change | Out-Null }
        if ($case.phase) { $parent.phase = $case.phase }
        if ($case.status) { $parent.status = $case.status }
        [IO.File]::WriteAllText($storyPath, ($story | ConvertTo-Json -Depth 8))
        [IO.File]::WriteAllText($parentPath, ($parent | ConvertTo-Json -Depth 8))
        $plain = [Text.Encoding]::UTF8.GetBytes((@{ uploadSessions = $sessions } | ConvertTo-Json -Depth 4))
        $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $envelope = @{ kind = 'windows-dpapi'; data = [Convert]::ToBase64String($cipher) } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($vaultPath, $envelope)
        if ($case.corruptVault) { [IO.File]::WriteAllText($vaultPath, '{invalid') }
        if ($case.ContainsKey('lock')) {
          [IO.File]::WriteAllText($lockPaths[$case.lock], ${quote(`${process.pid}-44444444-4444-4444-8444-444444444444`)})
          [IO.File]::SetLastWriteTimeUtc($lockPaths[$case.lock], [DateTime]::UtcNow.AddMinutes(-2))
        }
        $before = @($storyPath, $parentPath, $vaultPath) | ForEach-Object { [Convert]::ToBase64String([IO.File]::ReadAllBytes($_)) }
        $savedStore = $env:PHOENIX_CHANNEL_STORAGE
        try {
          if ($case.customStore) { $env:PHOENIX_CHANNEL_STORAGE = Join-Path $root 'custom-private' }
          $allowed = Test-PhoenixStoppedDependentStory $root $storyPath
        } finally { $env:PHOENIX_CHANNEL_STORAGE = $savedStore }
        if ($allowed -ne [bool]$case.allowed) { throw ('Unexpected guard result: ' + $case.name) }
        $after = @($storyPath, $parentPath, $vaultPath) | ForEach-Object { [Convert]::ToBase64String([IO.File]::ReadAllBytes($_)) }
        if (($before -join '|') -cne ($after -join '|')) { throw ('Saved state changed: ' + $case.name) }
        if ($case.ContainsKey('lock') -and [IO.File]::ReadAllText($lockPaths[$case.lock]) -cne ${quote(`${process.pid}-44444444-4444-4444-8444-444444444444`)}) { throw 'Live owner lock changed' }
      }
      @{ cases = $cases.Count; major = $PSVersionTable.PSVersion.Major } | ConvertTo-Json -Compress
    `);
    assert.equal(result.cases, 44); assert.equal(result.major, shell === 'powershell.exe' ? 5 : 7);
  }));

  test(`${shell}: hard links, reparse locks and redirected publication folders stay untouched`, async () => isolated(async ({ root, publications, locks }) => {
    await oldLock(locks[0]); const alias = path.join(root, 'alias.lock'); await fs.link(locks[0], alias);
    assert.equal(await recover(shell, root), false); assert.equal(await fs.readFile(alias, 'utf8'), deadToken);
    await fs.unlink(alias); await fs.unlink(locks[0]);
    const target = path.join(root, 'other'); await fs.mkdir(target); await fs.symlink(target, locks[0], 'junction');
    assert.equal(await recover(shell, root), false); assert.deepEqual(await fs.readdir(target), []);
    await fs.unlink(locks[0]);
    const moved = path.join(root, 'moved'); await fs.rename(publications, moved); await fs.symlink(moved, publications, 'junction');
    assert.equal(await recover(shell, root), false); assert.deepEqual(await fs.readdir(moved), []);
  }));

  test(`${shell}: a real withFileLock critical section cannot recover or admit a third owner`, async () => isolated(async ({ root, locks }) => {
    require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
    const { withFileLock } = require('../src/lib/fileLock.ts');
    const filename = locks[0]; let thirdEntered = false;
    await withFileLock(filename, async () => {
      const ownerToken = await fs.readFile(filename, 'utf8');
      // Even a convincing old/dead token cannot bypass the real owner's open handle.
      await oldLock(filename);
      try {
        assert.equal(await recover(shell, root), false);
        assert.equal(await fs.readFile(filename, 'utf8'), deadToken);
        await assert.rejects(withFileLock(filename, async () => { thirdEntered = true; }, { staleMs: 600000, timeoutMs: 100, retryMs: 5 }), /Timed out waiting/);
        assert.equal(thirdEntered, false);
        assert.deepEqual((await fs.readdir(path.dirname(filename))).filter(name => name.includes('.stale-')), []);
      } finally { await fs.writeFile(filename, ownerToken); }
    });
    await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  }));
}

test('automatic recovery deletes only the validated native handle, with no path deletion fallback', async () => {
  const helper = await fs.readFile(path.join(__dirname, 'recover-publication-locks.ps1'), 'utf8');
  const guard = await fs.readFile(path.join(__dirname, 'publication-idle.ps1'), 'utf8');
  assert.match(helper, /CreateFileW\(filename, 0x80010000, 0, IntPtr\.Zero, 3, 0x02200000, IntPtr\.Zero\)/);
  assert.match(helper, /SetFileInformationByHandle\(handle, 4, ref disposition/);
  assert.doesNotMatch(helper, /Remove-Item|Move-Item|File\.Delete|File\.Move|Process\.Start|Start-Process|node\.exe|compiledRuntime/);
  assert.match(guard, /if \(-not \(Test-PhoenixPublicationGuardLocksClear \$locks\)\) \{\s*\. \(Join-Path \$PSScriptRoot 'recover-publication-locks.ps1'\)/);
});
