function Test-PhoenixNeedsOllama([ValidateSet('ollama', 'groq', 'cloudflare')][string]$WriterProvider = 'ollama') {
    return $WriterProvider -eq 'ollama'
}

function Get-PhoenixWorkerHeapMiB([string]$Root, [string]$Directory) {
    if ($Directory -cnotmatch '^\.next-[a-z0-9-]+$') { throw 'Invalid worker build directory.' }
    $filename = Join-Path $Root "$Directory\required-server-files.json"
    if ((Get-Item -LiteralPath $filename -ErrorAction Stop).Length -gt 1048576) { throw 'Oversized worker build configuration.' }
    $configuration = Get-Content -LiteralPath $filename -Raw -ErrorAction Stop | ConvertFrom-Json
    $config = $configuration.PSObject.Properties['config']
    $environment = if ($config -and $config.Value) { $config.Value.PSObject.Properties['env'] }
    $protocol = if ($environment -and $environment.Value) { $environment.Value.PSObject.Properties['PHOENIX_WORKER_RUNTIME'] }
    if ($protocol -and $protocol.Value -is [string] -and $protocol.Value -ceq 'compiled-cjs-v1') { return 192 }
    if ($protocol) { throw 'Unsupported worker release protocol; apply the matching verified update.' }
    return 512 # Older source releases still load the TypeScript compiler.
}

function Test-PhoenixServiceHttp([string]$Url, [string]$Kind) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -ne 200) { return $false }
        if ($Kind -eq 'website') { return $response.Content.Contains('Phoenix Studio') }
        $data = $response.Content | ConvertFrom-Json
        if ($Kind -eq 'ollama') { return $null -ne $data.models }
        if ($Kind -eq 'renderer') { return $null -ne $data.components.schemas.TaskVideoRequest.properties.phoenix_artifacts_version }
        return $false
    } catch { return $false }
}

function Wait-PhoenixService([string]$Url, [string]$Kind, $Process = $null, [int]$Seconds = 45) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt $Seconds) {
        if (Test-PhoenixServiceHttp $Url $Kind) { return $true }
        if ($null -ne $Process) { $Process.Refresh(); if ($Process.HasExited) { return $false } }
        Start-Sleep -Milliseconds 750
    }
    return $false
}

function Test-PhoenixWorkerHeartbeat([string]$Path, [int]$WorkerId) {
    try {
        $heartbeat = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        # PS 7 converts ISO JSON to DateTime; parsing its display text loses UTC/culture.
        $age = ([DateTimeOffset]::UtcNow - [DateTimeOffset]$heartbeat.at).TotalSeconds
        return $heartbeat.pid -eq $WorkerId -and $age -ge -5 -and $age -lt 20
    } catch { return $false }
}

function Wait-PhoenixWorker([string]$Path, [int]$WorkerId, $Process = $null, [int]$Seconds = 90) {
    # Cold TypeScript imports can take longer than the former 45-second check on
    # a busy laptop. Wait for real readiness, never create a second worker.
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt $Seconds) {
        if ($null -ne $Process) { $Process.Refresh(); if ($Process.HasExited) { return $false } }
        if (Test-PhoenixWorkerHeartbeat $Path $WorkerId) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
