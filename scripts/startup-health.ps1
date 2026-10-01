function Test-PhoenixNeedsOllama([ValidateSet('ollama', 'groq')][string]$WriterProvider = 'ollama') {
    return $WriterProvider -eq 'ollama'
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
        $age = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($heartbeat.at)).TotalSeconds
        return $heartbeat.pid -eq $WorkerId -and $age -ge -5 -and $age -lt 20
    } catch { return $false }
}

function Wait-PhoenixWorker([string]$Path, [int]$WorkerId, $Process = $null, [int]$Seconds = 45) {
    # Cold TypeScript imports can take longer than the former 15-second check on
    # a busy laptop. Wait for real readiness, never create a second worker.
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt $Seconds) {
        if ($null -ne $Process) { $Process.Refresh(); if ($Process.HasExited) { return $false } }
        if (Test-PhoenixWorkerHeartbeat $Path $WorkerId) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
