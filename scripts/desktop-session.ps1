# Lifecycle helpers. A PID alone is never proof that a process belongs to Phoenix.
function Get-PhoenixCanonicalRoot([string]$Root) {
    $resolved = [IO.Path]::GetFullPath($Root)
    $seen = @{}
    for ($depth = 0; $depth -lt 20; $depth++) {
        if ($seen.ContainsKey($resolved)) { throw 'Phoenix root contains a link cycle.' }
        $seen[$resolved] = $true
        $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
        if (-not $item.PSIsContainer) { throw 'Phoenix root must be a directory.' }
        if (-not $item.LinkType) { return $resolved }
        $targets = @($item.Target)
        if ($targets.Count -ne 1 -or -not $targets[0]) { throw 'Cannot resolve the Phoenix directory link safely.' }
        $target = [string]$targets[0]
        if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path -Parent $resolved) $target }
        $resolved = [IO.Path]::GetFullPath($target)
    }
    throw 'Phoenix root contains too many directory links.'
}

function Get-PhoenixLifecycleMutexName([string]$Root) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $identity = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root))).Replace('-', '').Substring(0, 16) }
    finally { $hash.Dispose() }
    return "Local\PhoenixStudio-$identity"
}
function Get-PhoenixProcessIdentity($Process, [string]$Role) {
    try {
        $native = Get-Process -Id ([int]$Process.ProcessId) -ErrorAction Stop
        if (-not $Process.ExecutablePath -or -not $Process.CommandLine) { return $null }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $commandHash = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$Process.CommandLine))).Replace('-', '') }
        finally { $hash.Dispose() }
        return [pscustomobject]@{ pid = [int]$Process.ProcessId; startTicks = $native.StartTime.ToUniversalTime().Ticks.ToString(); executable = [string]$Process.ExecutablePath; commandHash = $commandHash; role = $Role }
    } catch { return $null }
}

function Test-PhoenixProcessIdentity($Identity, $Process) {
    if (-not $Identity -or -not $Process -or [int]$Identity.pid -ne [int]$Process.ProcessId) { return $false }
    $current = Get-PhoenixProcessIdentity $Process ([string]$Identity.role)
    return $current -and $current.startTicks -eq $Identity.startTicks -and $current.executable -eq $Identity.executable -and $current.commandHash -eq $Identity.commandHash
}

function Get-PhoenixProcessByIdentity($Identity) {
    if (-not $Identity -or [int]$Identity.pid -le 0) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Identity.pid)" -ErrorAction SilentlyContinue
    if (Test-PhoenixProcessIdentity $Identity $process) { return $process }
    return $null
}

function Read-PhoenixOwnedServices([string]$Filename) {
    if (-not (Test-Path -LiteralPath $Filename)) { return @() }
    try {
        $saved = Get-Content -LiteralPath $Filename -Raw | ConvertFrom-Json
        if ($saved.version -ne 1) { return @() }
        return @($saved.processes | Where-Object { $_.role -in @('website', 'worker', 'stock-renderer', 'ollama') -and (Get-PhoenixProcessByIdentity $_) })
    } catch { return @() }
}

function Write-PhoenixOwnedServices([string]$Filename, [object[]]$Processes) {
    Write-PhoenixSessionJson $Filename @{ version = 1; processes = @($Processes) }
}

function Write-PhoenixSessionJson([string]$Filename, $Value) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Filename) -Force | Out-Null
    $temporary = "$Filename.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $Filename -Force
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Add-PhoenixOwnedDescendants([object[]]$Known, [object[]]$Snapshot) {
    $result = @($Known | Where-Object {
        $knownIdentity = $_
        $observed = @($Snapshot | Where-Object { [int]$_.ProcessId -eq [int]$knownIdentity.pid }) | Select-Object -First 1
        Test-PhoenixProcessIdentity $knownIdentity $observed
    })
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($child in $Snapshot) {
            if (@($result | Where-Object { [int]$_.pid -eq [int]$child.ProcessId }).Count) { continue }
            $parent = @($result | Where-Object { [int]$_.pid -eq [int]$child.ParentProcessId }) | Select-Object -First 1
            if (-not $parent) { continue }
            $liveParent = @($Snapshot | Where-Object { [int]$_.ProcessId -eq [int]$parent.pid }) | Select-Object -First 1
            if (-not (Test-PhoenixProcessIdentity $parent $liveParent)) { continue }
            $identity = Get-PhoenixProcessIdentity $child ("child:" + $parent.role)
            # A stale parent PID must never claim a process created before it.
            if ($identity -and [long]$identity.startTicks -ge [long]$parent.startTicks) { $result += $identity; $changed = $true }
        }
    }
    return @($result)
}

function Stop-PhoenixVerifiedProcess($Identity, [switch]$RetainHandle) {
    $candidate = Get-PhoenixProcessByIdentity $Identity
    if (-not $candidate) { return $false }
    # Hold the process object/handle and recheck start time immediately before stopping.
    try {
        $native = Get-Process -Id ([int]$Identity.pid) -ErrorAction Stop
        if ($native.StartTime.ToUniversalTime().Ticks.ToString() -ne $Identity.startTicks) { return $false }
        $native.Handle | Out-Null
        Stop-Process -InputObject $native -ErrorAction Stop
        if ($RetainHandle) { return [pscustomobject]@{ identity = $Identity; native = $native; stoppedTicks = [DateTime]::UtcNow.Ticks.ToString() } }
        return $true
    } catch { return $false }
}

function Stop-PhoenixOwnedSession([object[]]$Known) {
    # Stop dispatchers first, then every previously observed descendant. No port,
    # executable-name or broad taskkill operation is used to infer ownership.
    $ordered = @($Known | Sort-Object @{Expression={ switch ($_.role) { 'worker' {0} 'website' {1} 'stock-renderer' {2} 'ollama' {3} default {4} } }})
    $held = @()
    try {
        foreach ($identity in @($ordered | Where-Object { $_.role -in @('worker', 'website', 'stock-renderer', 'ollama') })) {
            $stopped = Stop-PhoenixVerifiedProcess $identity -RetainHandle
            if ($stopped -and $stopped.identity) { $held += $stopped }
        }
        # Keep original process handles open across this scan. PID reuse cannot
        # make an unrelated new parent eligible while those handles are held.
        $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        foreach ($child in $snapshot) {
            $parent = @($held | Where-Object { [int]$_.identity.pid -eq [int]$child.ParentProcessId }) | Select-Object -First 1
            if (-not $parent) { continue }
            $identity = Get-PhoenixProcessIdentity $child ("child:" + $parent.identity.role)
            if ($identity -and [long]$identity.startTicks -ge [long]$parent.identity.startTicks -and [long]$identity.startTicks -le [long]$parent.stoppedTicks) {
                if (-not @($Known | Where-Object { $_.pid -eq $identity.pid -and $_.startTicks -eq $identity.startTicks }).Count) { $Known += $identity }
            }
        }
        $remaining = @(Add-PhoenixOwnedDescendants $Known $snapshot)
        foreach ($identity in $remaining) { Stop-PhoenixVerifiedProcess $identity | Out-Null }
    } finally { foreach ($item in $held) { try { $item.native.Dispose() } catch { } } }
}
