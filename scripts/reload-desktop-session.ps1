param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-session.ps1')
$phoenixRoot = Get-PhoenixCanonicalRoot (Join-Path $PSScriptRoot '..')
$mutex = New-Object Threading.Mutex($false, (Get-PhoenixLifecycleMutexName $phoenixRoot))
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Phoenix is opening or closing. Its existing guardian was left unchanged.' }
    $current = Get-Content -LiteralPath (Join-Path $phoenixRoot 'storage\private\desktop-session.json') -Raw | ConvertFrom-Json
    if ($current.root -ne $phoenixRoot -or -not (Get-PhoenixProcessByIdentity $current.browser) -or -not (Test-PhoenixDesktopWindow $current.browser)) { throw 'No verified open Phoenix app window exists. No process or service was changed.' }
    $updated = Start-PhoenixDesktopGuardian $phoenixRoot $current.browser
    Write-Output ("Desktop guardian refreshed (PID " + $updated.guardian.pid + '). The app window and services were retained; its old guardian exits when it observes the replacement token.')
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
