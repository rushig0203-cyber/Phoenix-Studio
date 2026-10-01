param([Parameter(Mandatory=$true)][string]$SessionFile)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-session.ps1')
. (Join-Path $PSScriptRoot 'startup-health.ps1')
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
$nextInventory = [DateTime]::MinValue
$nextRepair = [DateTime]::MinValue
$repairAttempts = 0
$repairProcess = $null
$repairIdentity = $null
$lastProblem = ''
$expectedRoles = @()
$exhaustionLogged = $false
$phoenixNode = (Get-Command node.exe -ErrorAction Stop).Source
$configText = & $phoenixNode (Join-Path $PSScriptRoot 'launch-config.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop guardian could not read launcher configuration; no recovery request was made.' }
$config = $configText | ConvertFrom-Json
function Write-DesktopEvent([string]$Message) { Write-Output (('[{0:o}] ' -f [DateTime]::UtcNow) + $Message) }
Write-DesktopEvent 'Guardian v2 ready. Monitoring this app window; descendant inventory every 10 seconds.'
while ($true) {
    # A replaced session belongs to another launcher. Its guardian owns cleanup.
    try { $current = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json } catch { Write-DesktopEvent 'Session record unavailable; no cleanup performed.'; break }
    if ($current.token -ne $session.token) { Write-DesktopEvent 'Session replaced; this guardian exits without stopping services.'; break }
    $roots = @(Read-PhoenixServiceRecords (Join-Path $privateDirectory 'service-ownership.json'))
    foreach ($root in $roots) { if ($root.role -notin $expectedRoles) { $expectedRoles += $root.role } }
    foreach ($root in $roots) { if (-not @($owned | Where-Object { $_.pid -eq $root.pid -and $_.startTicks -eq $root.startTicks }).Count) { $owned += $root } }
    $browserAlive = Test-PhoenixProcessLifetime $session.browser
    $windowPresent = Test-PhoenixDesktopWindow $session.browser
    if ([DateTime]::UtcNow -ge $nextInventory) {
        $snapshot = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath,CommandLine -ErrorAction Stop)
        $owned = @(Add-PhoenixOwnedDescendants $owned $snapshot)
        $nextInventory = [DateTime]::UtcNow.AddSeconds(10)
    }
    if ($repairProcess) {
        $repairProcess.Refresh()
        if ($repairProcess.HasExited) {
            Write-DesktopEvent ("Recovery attempt $repairAttempts exited with code " + $repairProcess.ExitCode + '. See its desktop-recovery log if services remain unavailable.')
            $repairProcess.Dispose(); $repairProcess = $null; $repairIdentity = $null
        }
    }
    if ($windowPresent) {
        $seenWindow = $true; $missingSince = $null
        $problem = @()
        foreach ($role in $expectedRoles) {
            $entries = @($roots | Where-Object { $_.role -eq $role })
            if (@($entries | Where-Object { Test-PhoenixProcessLifetime $_ }).Count) { continue }
            $available = switch ($role) {
                'website' { Test-PhoenixServiceHttp 'http://localhost:3000/dashboard' 'website' }
                'stock-renderer' { Test-PhoenixServiceHttp ($config.backendUrl + '/openapi.json') 'renderer' }
                'ollama' { -not (Test-PhoenixNeedsOllama $config.writerProvider) -or (Test-PhoenixServiceHttp 'http://127.0.0.1:11434/api/tags' 'ollama') }
                'worker' {
                    try {
                        $heartbeatFile = Join-Path $phoenixRoot 'storage\worker-heartbeat.json'
                        $workerId = (Get-Content -LiteralPath $heartbeatFile -Raw | ConvertFrom-Json).pid
                        (Test-PhoenixWorkerHeartbeat $heartbeatFile $workerId) -and [bool](Get-Process -Id ([int]$workerId) -ErrorAction SilentlyContinue)
                    } catch { $false }
                }
            }
            if (-not $available) { $problem += $role }
        }
        $problemKey = (($problem | Select-Object -Unique) -join ', ')
        if ($problemKey -and $problemKey -ne $lastProblem) { Write-DesktopEvent ("Unexpected service exit while app remains open: $problemKey. No crash cause is inferred.") }
        if (-not $problemKey -and $lastProblem) { Write-DesktopEvent 'Registered services are available again.' }
        $lastProblem = $problemKey
        if ($problemKey -and -not $repairProcess -and [DateTime]::UtcNow -ge $nextRepair) {
            if ($repairAttempts -ge 3) {
                if (-not $exhaustionLogged) { Write-DesktopEvent 'Automatic recovery stopped after three attempts. Reopen Phoenix Studio or inspect the desktop-recovery error logs.'; $exhaustionLogged = $true }
            } else {
                $freeMiB = (Get-CimInstance Win32_OperatingSystem -Property FreePhysicalMemory).FreePhysicalMemory / 1024
                $busy = Test-PhoenixRecoveryBusy $phoenixRoot
                if ($freeMiB -lt 768 -or $busy) {
                    Write-DesktopEvent 'Recovery waits for safe RAM headroom or existing heavy work to finish. Saved jobs remain untouched.'
                    $nextRepair = [DateTime]::UtcNow.AddSeconds(30)
                } elseif (Test-PhoenixDesktopSessionActive $phoenixRoot $session.token) {
                    $repairAttempts++
                    $nextRepair = [DateTime]::UtcNow.AddSeconds(@(10,30,60)[$repairAttempts - 1])
                    $recoveryName = "desktop-recovery-$($session.token)-$repairAttempts"
                    Write-DesktopEvent ("Starting bounded recovery attempt $repairAttempts for $problemKey. No failed-job retry, model preload or build is requested.")
                    $repairProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $phoenixRoot 'scripts\start-phoenix.ps1') + '"'),'-NoBrowser','-DesktopSessionToken',$session.token) -WorkingDirectory $phoenixRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $phoenixRoot ("storage\$recoveryName.log")) -RedirectStandardError (Join-Path $phoenixRoot ("storage\$recoveryName-error.log"))
                    $repairCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($repairProcess.Id)" -ErrorAction SilentlyContinue
                    $repairIdentity = Get-PhoenixProcessIdentity $repairCim 'desktop-recovery'
                }
            }
        }
    }
    elseif (-not $browserAlive -or $seenWindow -or [DateTime]::UtcNow -gt $deadline) {
        if (-not $missingSince) { $missingSince = [DateTime]::UtcNow; Write-DesktopEvent 'App window absent; recovery disabled and close cleanup pending.' }
        if ($repairIdentity) { Stop-PhoenixVerifiedProcess $repairIdentity | Out-Null; $repairIdentity = $null }
        if ([DateTime]::UtcNow -gt $missingSince.AddSeconds(5)) {
            $mutex = New-Object Threading.Mutex($false, (Get-PhoenixLifecycleMutexName $phoenixRoot))
            $ownsMutex = $false
            try {
                try { $ownsMutex = $mutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
                if (-not $ownsMutex) { continue }
                $latest = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
                if ($latest.token -ne $session.token) { Write-DesktopEvent 'Session changed before cleanup; services preserved.'; break }
                if (Test-PhoenixDesktopWindow $session.browser) { $missingSince = $null; continue }
                foreach ($root in @(Read-PhoenixOwnedServices (Join-Path $privateDirectory 'service-ownership.json'))) { if (-not @($owned | Where-Object { $_.pid -eq $root.pid -and $_.startTicks -eq $root.startTicks }).Count) { $owned += $root } }
                # Final snapshot captures children started since the previous check.
                $owned = @(Add-PhoenixOwnedDescendants $owned @(Get-CimInstance Win32_Process -ErrorAction Stop))
                Write-DesktopEvent ("Confirmed app close. Stopping " + $owned.Count + ' verified owned processes; saved files and queues retained.')
                Stop-PhoenixOwnedSession $owned
                Write-PhoenixOwnedServices (Join-Path $privateDirectory 'service-ownership.json') @(Read-PhoenixOwnedServices (Join-Path $privateDirectory 'service-ownership.json'))
                Remove-Item -LiteralPath $SessionFile -Force
                Write-DesktopEvent 'Close cleanup finished.'
            } finally {
                if ($ownsMutex) { $mutex.ReleaseMutex() }
                $mutex.Dispose()
            }
            break
        }
    }
    Start-Sleep -Seconds 2
}
