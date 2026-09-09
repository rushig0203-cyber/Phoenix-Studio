param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$phoenixRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$phoenixStorage = Join-Path $phoenixRoot 'storage'
$phoenixUrl = 'http://localhost:3000/dashboard'
$phoenixMutex = $null
$phoenixOwnsMutex = $false

function Test-PhoenixHttp([string]$Url) {
    try { $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3; return $response.StatusCode -eq 200 -and $response.Content.Contains('Phoenix Studio') }
    catch { return $false }
}

function Test-PhoenixPort([int]$Port) {
    return @((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)).Count -gt 0
}

function Start-PhoenixService([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$Directory) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $phoenixStorage "$Name-$stamp.log") -RedirectStandardError (Join-Path $phoenixStorage "$Name-$stamp-error.log")
    try { $process.PriorityClass = 'BelowNormal' } catch { }
    Write-Output "$Name started (PID $($process.Id))."
    return $process
}

try {
    # Serialize double-clicks without killing or duplicating running services.
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $identity = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($phoenixRoot))).Replace('-', '').Substring(0, 16) }
    finally { $hash.Dispose() }
    $phoenixMutex = New-Object Threading.Mutex($false, "Local\PhoenixStudio-$identity")
    try { $phoenixOwnsMutex = $phoenixMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $phoenixOwnsMutex = $true }
    if (-not $phoenixOwnsMutex) { exit 0 }

    New-Item -ItemType Directory -Path $phoenixStorage -Force | Out-Null
    $phoenixNode = (Get-Command node.exe -ErrorAction Stop).Source
    $phoenixWarnings = @()

    if (-not (Test-PhoenixPort 11434)) {
        $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
        if ($ollama) { Start-PhoenixService 'ollama' $ollama.Source @('serve') $phoenixRoot | Out-Null }
        else { $phoenixWarnings += 'Ollama was not found. AI writing needs the free local Ollama installation.' }
    }

    if (-not (Test-PhoenixPort 8080)) {
        $backend = if ($env:PHOENIX_MPT_DIR) { $env:PHOENIX_MPT_DIR } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MoneyPrinterTurbo' }
        $python = Join-Path $backend '.venv\Scripts\python.exe'
        $main = Join-Path $backend 'main.py'
        if ((Test-Path -LiteralPath $python) -and (Test-Path -LiteralPath $main)) {
            Start-PhoenixService 'stock-renderer' $python @(('"' + $main + '"')) $backend | Out-Null
        } else { $phoenixWarnings += 'Stock renderer was not found. Set PHOENIX_MPT_DIR to your MoneyPrinterTurbo folder; uploaded-video tools remain available.' }
    }

    if (-not (Test-PhoenixPort 3000)) {
        if (-not (Test-Path -LiteralPath (Join-Path $phoenixRoot '.next-lumina\BUILD_ID'))) {
            throw 'The website has not been built. Run npm run build once in PhoenixStudio, then open this shortcut again.'
        }
        $env:PHOENIX_BUILD_DIR = '.next-lumina'
        $next = Join-Path $phoenixRoot 'node_modules\next\dist\bin\next'
        Start-PhoenixService 'website' $phoenixNode @(('"' + $next + '"'), 'start', '--hostname', '127.0.0.1') $phoenixRoot | Out-Null
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-PhoenixHttp $phoenixUrl) { $ready = $true; break }
        Start-Sleep -Milliseconds 750
    }
    if (-not $ready) { throw "Phoenix did not become ready on port 3000. Check the newest website log in $phoenixStorage. An existing port owner was not stopped." }

    $workerFile = Join-Path $phoenixRoot 'run-worker.js'
    $workers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and ($_.CommandLine.Contains($workerFile) -or $_.CommandLine -match '\s"?run-worker\.js"?\s*$')
    })
    if (-not $workers.Count) {
        Start-PhoenixService 'worker' $phoenixNode @(('"' + $workerFile + '"')) $phoenixRoot | Out-Null
    }
    Write-Output 'Phoenix Studio is ready. Existing services were reused.'

    if (-not $NoBrowser) {
        $browsers = @(
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
            (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
        )
        $browser = $browsers | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$phoenixUrl" -WindowStyle Normal }
        else { Start-Process $phoenixUrl }
        if ($phoenixWarnings.Count) { (New-Object -ComObject WScript.Shell).Popup(($phoenixWarnings -join "`n`n"), 15, 'Phoenix Studio - optional services', 48) | Out-Null }
    }
    $phoenixWarnings | Write-Warning
} catch {
    if (-not $NoBrowser) { (New-Object -ComObject WScript.Shell).Popup($_.Exception.Message, 0, 'Phoenix Studio could not start', 16) | Out-Null }
    Write-Error $_
    exit 1
} finally {
    if ($phoenixOwnsMutex) { $phoenixMutex.ReleaseMutex() }
    if ($phoenixMutex) { $phoenixMutex.Dispose() }
}
