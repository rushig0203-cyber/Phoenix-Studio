param([Parameter(Mandatory=$true)][string]$SessionFile)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-session.ps1')
$phoenixRoot = Get-PhoenixCanonicalRoot (Join-Path $PSScriptRoot '..')
$privateDirectory = Join-Path $phoenixRoot 'storage\private'
$expectedSession = [IO.Path]::GetFullPath((Join-Path $privateDirectory 'desktop-session.json'))
if ([IO.Path]::GetFullPath($SessionFile) -ne $expectedSession) { throw 'Unknown desktop session path; no process was stopped.' }
$session = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
if ($session.version -ne 1 -or -not $session.token -or $session.root -ne $phoenixRoot -or $session.browser.role -ne 'desktop-browser') { throw 'Invalid desktop session; no process was stopped.' }
$owned = @($session.browser)
$seenWindow = $false
$missingSince = $null
$deadline = [DateTime]::UtcNow.AddSeconds(45)
while ($true) {
    # A replaced session belongs to another launcher. Its guardian owns cleanup.
    try { $current = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json } catch { break }
    if ($current.token -ne $session.token) { break }
    $roots = @(Read-PhoenixOwnedServices (Join-Path $privateDirectory 'service-ownership.json'))
    foreach ($root in $roots) { if (-not @($owned | Where-Object { $_.pid -eq $root.pid -and $_.startTicks -eq $root.startTicks }).Count) { $owned += $root } }
    $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $owned = @(Add-PhoenixOwnedDescendants $owned $snapshot)
    $browser = @($snapshot | Where-Object { $_.ProcessId -eq $session.browser.pid }) | Select-Object -First 1
    $browserAlive = Test-PhoenixProcessIdentity $session.browser $browser
    $windowPresent = $false
    if ($browserAlive) {
        try { $windowPresent = (Get-Process -Id ([int]$session.browser.pid) -ErrorAction Stop).MainWindowHandle -ne [IntPtr]::Zero } catch { }
    }
    if ($windowPresent) { $seenWindow = $true; $missingSince = $null }
    elseif (-not $browserAlive -or $seenWindow -or [DateTime]::UtcNow -gt $deadline) {
        if (-not $missingSince) { $missingSince = [DateTime]::UtcNow }
        if ([DateTime]::UtcNow -gt $missingSince.AddSeconds(5)) {
            $mutex = New-Object Threading.Mutex($false, (Get-PhoenixLifecycleMutexName $phoenixRoot))
            $ownsMutex = $false
            try {
                try { $ownsMutex = $mutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
                if (-not $ownsMutex) { continue }
                $latest = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
                if ($latest.token -ne $session.token) { break }
                # Final snapshot captures children started since the previous check.
                $owned = @(Add-PhoenixOwnedDescendants $owned @(Get-CimInstance Win32_Process -ErrorAction Stop))
                Stop-PhoenixOwnedSession $owned
                Write-PhoenixOwnedServices (Join-Path $privateDirectory 'service-ownership.json') @(Read-PhoenixOwnedServices (Join-Path $privateDirectory 'service-ownership.json'))
                Remove-Item -LiteralPath $SessionFile -Force
            } finally {
                if ($ownsMutex) { $mutex.ReleaseMutex() }
                $mutex.Dispose()
            }
            break
        }
    }
    Start-Sleep -Seconds 2
}
