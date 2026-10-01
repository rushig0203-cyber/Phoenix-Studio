param([switch]$NoPause, [switch]$Rebuild, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-session.ps1')
$phoenixRoot = Get-PhoenixCanonicalRoot (Join-Path $PSScriptRoot '..')
$phoenixMutex = $null
$phoenixOwnsMutex = $false
$phoenixStopped = $false
try {
    $marker = Join-Path $phoenixRoot 'storage\active-build.json'
    $build = (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).directory
    if ($build -notmatch '^\.next-[a-z0-9-]+$' -or -not (Test-Path -LiteralPath (Join-Path $phoenixRoot "$build\BUILD_ID"))) { throw 'No verified build is available. Your running website was left alone.' }
    $phoenixMutex = New-Object Threading.Mutex($false, (Get-PhoenixLifecycleMutexName $phoenixRoot))
    try { $phoenixOwnsMutex = $phoenixMutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $phoenixOwnsMutex = $true }
    if (-not $phoenixOwnsMutex) { throw 'Phoenix is opening or closing. Try this update again once that finishes.' }
    $listener = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    $known = @()
    if ($listener.Count) {
        $health = Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 15
        if ($health.resources.busy) { throw 'A video or other heavy job is active. Wait until it finishes, then run this shortcut again.' }
        $websiteId = @($listener.OwningProcess | Select-Object -Unique)
        if ($websiteId.Count -ne 1) { throw 'Cannot safely identify the Phoenix website. No process was stopped.' }
        $website = Get-CimInstance Win32_Process -Filter "ProcessId = $($websiteId[0])"
        if (-not $website.CommandLine.Contains($phoenixRoot) -or $website.CommandLine -notmatch 'next.*start') { throw 'Port 3000 belongs to another process. No process was stopped.' }
        $heartbeat = Join-Path $phoenixRoot 'storage\worker-heartbeat.json'
        $workerId = (Get-Content -LiteralPath $heartbeat -Raw | ConvertFrom-Json).pid
        $worker = Get-CimInstance Win32_Process -Filter "ProcessId = $workerId"
        if ($worker -and (-not $worker.CommandLine.Contains($phoenixRoot) -or -not $worker.CommandLine.Contains('run-worker.js'))) { throw 'Manager identity changed. No process was stopped.' }
        if ($worker) { $known += Get-PhoenixProcessIdentity $worker 'worker' }
        $known += Get-PhoenixProcessIdentity $website 'website'
    }
    if ($Rebuild) {
        # Only registered Phoenix dependencies are stopped to free build memory.
        # Shared or independently started model/renderer servers remain untouched.
        $known += @(Read-PhoenixOwnedServices (Join-Path $phoenixRoot 'storage\private\service-ownership.json'))
    }
    $known = @(Add-PhoenixOwnedDescendants @($known | Where-Object { $_ }) @(Get-CimInstance Win32_Process))
    if ($known.Count) { Stop-PhoenixOwnedSession $known; $phoenixStopped = $true }
    $buildFailure = $null
    if ($Rebuild) {
        Push-Location $phoenixRoot
        try {
            & node (Join-Path $PSScriptRoot 'build-phoenix.cjs')
            if ($LASTEXITCODE -ne 0) { $buildFailure = 'The guarded build could not complete. The previous verified website will be restored; source changes remain saved.' }
        } finally { Pop-Location }
    }
    # Named mutex ownership is reentrant on this PowerShell thread. Keep our hold
    # across startup so an old close guardian cannot clean up replacement services
    # in the gap between stop and launch. Startup releases only its own acquisition.
    & (Join-Path $PSScriptRoot 'start-phoenix.ps1') -NoBrowser:$NoBrowser
    if ($LASTEXITCODE -ne 0) { throw 'Phoenix reported a startup problem. Check its latest storage logs; saved jobs and videos are retained.' }
    $phoenixStopped = $false
    if ($buildFailure) { throw $buildFailure }
    Write-Output 'Updated Phoenix is running at http://localhost:3000/dashboard'
} catch {
    Write-Error $_ -ErrorAction Continue
    if ($phoenixStopped) {
        Write-Output 'Restoring the last verified Phoenix website without retrying failed jobs.'
        & (Join-Path $PSScriptRoot 'start-phoenix.ps1') -NoBrowser
    }
    exit 1
} finally {
    if ($phoenixOwnsMutex) { $phoenixMutex.ReleaseMutex() }
    if ($phoenixMutex) { $phoenixMutex.Dispose() }
    if (-not $NoPause) { Read-Host 'Press Enter to close this window' | Out-Null }
}
