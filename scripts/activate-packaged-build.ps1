param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-session.ps1')
$phoenixRoot = Get-PhoenixCanonicalRoot (Join-Path $PSScriptRoot '..')
$phoenixMutex = New-Object Threading.Mutex($false, (Get-PhoenixLifecycleMutexName $phoenixRoot))
$phoenixOwnsMutex = $false
$phoenixSelectionChanged = $false
$phoenixPrevious = $null
function Read-PhoenixInstallState([string]$Filename, [switch]$Array) {
    if (-not (Test-Path -LiteralPath $Filename)) { return @() }
    if ((Get-Item -LiteralPath $Filename).Length -gt 8388608) { throw 'Cannot verify oversized saved state; no release was changed.' }
    $content = Get-Content -LiteralPath $Filename -Raw
    if ($Array -and -not $content.TrimStart().StartsWith('[')) { throw 'Invalid saved job state; no release was changed.' }
    if (-not $Array -and -not $content.TrimStart().StartsWith('{')) { throw 'Invalid saved upload state; no release was changed.' }
    return @($content | ConvertFrom-Json)
}
function Assert-PhoenixInstallIdle {
    $health = Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 10
    if ($health.resources.busy -ne $false -or (Test-PhoenixRecoveryBusy $phoenixRoot)) { throw 'Active work must finish before activation; saved work was not interrupted.' }
    $review = Join-Path $phoenixRoot 'storage\Phoenix Studio Review Files'
    foreach ($filename in @('source-processing-jobs.json','ai-creation-jobs.json','review-edit-jobs.json','creation-drafts.json')) {
        $records = @(Read-PhoenixInstallState (Join-Path $review $filename) -Array)
        if (@($records | Where-Object { -not $_.archivedAt -and $_.status -in @('PROCESSING','RUNNING','PLANNING','APPROVING') }).Count) { throw 'A saved job is still active; no release was changed.' }
    }
    $reviews = @(Read-PhoenixInstallState (Join-Path $review 'index.json') -Array)
    if (@($reviews | Where-Object { -not $_.trashedAt -and $_.quality.postingAnalysis.status -eq 'ANALYZING' }).Count) { throw 'Caption analysis is active; no release was changed.' }
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $phoenixRoot 'storage\private\review-publications') -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
        if ($file.Name -in @('instagram-posting-defaults.json','instagram-story-business.json')) { continue }
        $records = @(Read-PhoenixInstallState $file.FullName)
        if ($records.Count -ne 1 -or $records[0].status -isnot [string] -or $records[0].status -notin @('QUEUED','UPLOADING','PROCESSING','COMPLETE','FAILED','NEEDS_CHECK')) { throw 'Cannot safely verify saved upload state; no release was changed.' }
        if ($records[0].status -in @('QUEUED','UPLOADING','PROCESSING')) { throw 'An approved upload is queued or active; no release was changed.' }
    }
}
function Test-PhoenixInstalledRelease([string]$Expected) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 35) {
        try {
            $health = Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 5
            $selected = (Get-Content -LiteralPath (Join-Path $phoenixRoot 'storage\active-build.json') -Raw | ConvertFrom-Json).directory
            if ($selected -eq $Expected -and $health.build -eq $Expected -and $health.worker.state -eq 'healthy' -and $health.manager.state -eq 'healthy') { return $true }
        } catch { }
        Start-Sleep -Milliseconds 1000
    }
    return $false
}
try {
    try { $phoenixOwnsMutex = $phoenixMutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $phoenixOwnsMutex = $true }
    if (-not $phoenixOwnsMutex) { throw 'Another Phoenix lifecycle operation is in progress.' }
    if ($Directory -notmatch '^\.next-build-gh-\d{1,24}-\d{1,8}$') { throw 'Only a staged GitHub Windows build can be activated here.' }
    $phoenixPrevious = (Get-Content -LiteralPath (Join-Path $phoenixRoot 'storage\active-build.json') -Raw | ConvertFrom-Json).directory
    Assert-PhoenixInstallIdle
    & node (Join-Path $PSScriptRoot 'install-phoenix-build.cjs') select $Directory
    if ($LASTEXITCODE -ne 0) { throw 'Verified selection failed.' }
    $phoenixSelectionChanged = $true
    & (Join-Path $PSScriptRoot 'restart-phoenix.ps1') -NoPause -NoBrowser
    # A startup warning is not success: require current selection and live health.
    if (-not (Test-PhoenixInstalledRelease $Directory)) { throw 'Candidate did not become a healthy live release.' }
    Write-Output "Verified live Phoenix release: $Directory"
} catch {
    $failure = $_.Exception.Message
    if ($phoenixSelectionChanged -and $phoenixPrevious) {
        & node (Join-Path $PSScriptRoot 'install-phoenix-build.cjs') select $phoenixPrevious
        if ($LASTEXITCODE -eq 0) {
            & (Join-Path $PSScriptRoot 'restart-phoenix.ps1') -NoPause -NoBrowser
            if (Test-PhoenixInstalledRelease $phoenixPrevious) { Write-Output 'Previous verified release restored; videos and jobs preserved.' }
        }
    }
    Write-Error $failure -ErrorAction Continue
    exit 1
} finally {
    if ($phoenixOwnsMutex) { $phoenixMutex.ReleaseMutex() }
    $phoenixMutex.Dispose()
}
