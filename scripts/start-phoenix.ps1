param([switch]$NoBrowser, [switch]$ServicesOnly)

$ErrorActionPreference = 'Stop'
$phoenixUrl = 'http://localhost:3000/dashboard'
$phoenixMutex = $null
$phoenixOwnsMutex = $false
. (Join-Path $PSScriptRoot 'startup-health.ps1')
. (Join-Path $PSScriptRoot 'desktop-session.ps1')
$phoenixRoot = Get-PhoenixCanonicalRoot (Join-Path $PSScriptRoot '..')
$phoenixStorage = Join-Path $phoenixRoot 'storage'
$phoenixOwnershipFile = Join-Path $phoenixStorage 'private\service-ownership.json'
$phoenixDesktopSession = Join-Path $phoenixStorage 'private\desktop-session.json'
$script:phoenixOwnedServices = @()

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
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction SilentlyContinue
    $owned = Get-PhoenixProcessIdentity $cim $Name
    if ($owned) {
        $script:phoenixOwnedServices = @($script:phoenixOwnedServices | Where-Object { $_.pid -ne $owned.pid }) + @($owned)
        Write-PhoenixOwnedServices $phoenixOwnershipFile $script:phoenixOwnedServices
    }
    Write-Output "$Name started (PID $($process.Id))."
    return $process
}

try {
    # Serialize double-clicks without killing or duplicating running services.
    $phoenixMutex = New-Object Threading.Mutex($false, (Get-PhoenixLifecycleMutexName $phoenixRoot))
    try { $phoenixOwnsMutex = $phoenixMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $phoenixOwnsMutex = $true }
    if (-not $phoenixOwnsMutex) { exit 0 }

    New-Item -ItemType Directory -Path $phoenixStorage -Force | Out-Null
    $script:phoenixOwnedServices = @(Read-PhoenixOwnedServices $phoenixOwnershipFile)
    # A dedicated app session is already open. Double-clicks do not create more
    # browser windows or competing guardians.
    if (-not $NoBrowser -and -not $ServicesOnly -and (Test-Path -LiteralPath $phoenixDesktopSession)) {
        try {
            $existingSession = Get-Content -LiteralPath $phoenixDesktopSession -Raw | ConvertFrom-Json
            if ($existingSession.root -eq $phoenixRoot -and (Get-PhoenixProcessByIdentity $existingSession.browser) -and (Get-PhoenixProcessByIdentity $existingSession.guardian)) {
                Write-Output 'Phoenix Studio is already open in its desktop app window.'
                exit 0
            }
        } catch { }
    }
    $phoenixNode = (Get-Command node.exe -ErrorAction Stop).Source
    $phoenixWarnings = @()
    $phoenixConfigText = & $phoenixNode (Join-Path $PSScriptRoot 'launch-config.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Phoenix launcher settings are invalid. Check the local renderer URL and private writer settings. No fallback writer was selected.' }
    $phoenixConfig = $phoenixConfigText | ConvertFrom-Json
    $phoenixNeedsOllama = Test-PhoenixNeedsOllama $phoenixConfig.writerProvider
    # Preserve Unicode in redirected Python logs on Windows.
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    # The desktop shortcut always uses the installed production build. It never
    # compiles the app or preloads a writing model just to open the dashboard.
    # Keep the default laptop workload small; completed work remains reusable.
    $env:OMP_NUM_THREADS = '1'
    $env:MKL_NUM_THREADS = '1'
    $env:PHOENIX_RENDER_THREADS = '1'
    $env:PHOENIX_TRANSCRIBE_THREADS = '1'

    if ($phoenixNeedsOllama -and -not (Test-PhoenixServiceHttp 'http://127.0.0.1:11434/api/tags' 'ollama')) {
        $ollamaProcess = $null
        $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
        if (-not (Test-PhoenixPort 11434)) {
            if ($ollama) { $ollamaProcess = @(Start-PhoenixService 'ollama' $ollama.Source @('serve') $phoenixRoot) | Where-Object { $_ -is [Diagnostics.Process] } | Select-Object -Last 1 }
            else { $phoenixWarnings += 'Ollama was not found. AI writing needs the free local Ollama installation.' }
        }
        if (-not (Wait-PhoenixService 'http://127.0.0.1:11434/api/tags' 'ollama' $ollamaProcess 30)) { $phoenixWarnings += 'Ollama did not become ready. Check storage/ollama-*-error.log. An existing port owner was not stopped.' }
    }

    $rendererHealth = $phoenixConfig.backendUrl + '/openapi.json'
    if (-not (Test-PhoenixServiceHttp $rendererHealth 'renderer')) {
        $backend = if ($phoenixConfig.backendDirectory) { $phoenixConfig.backendDirectory } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MoneyPrinterTurbo' }
        $python = Join-Path $backend '.venv\Scripts\python.exe'
        $main = Join-Path $backend 'main.py'
        $rendererProcess = $null
        if (Test-PhoenixPort $phoenixConfig.backendPort) {
            $phoenixWarnings += 'The renderer port is occupied but is not a compatible Phoenix renderer. No second server was started and no process was stopped.'
        } elseif ((Test-Path -LiteralPath $python) -and (Test-Path -LiteralPath $main)) {
            $rendererProcess = @(Start-PhoenixService 'stock-renderer' $python @('-X', 'utf8', ('"' + $main + '"')) $backend) | Where-Object { $_ -is [Diagnostics.Process] } | Select-Object -Last 1
        } else { $phoenixWarnings += 'Stock renderer was not found. Set PHOENIX_MPT_DIR to your MoneyPrinterTurbo folder; uploaded-video tools remain available.' }
        if (-not (Wait-PhoenixService $rendererHealth 'renderer' $rendererProcess 45)) { $phoenixWarnings += 'MoneyPrinterTurbo did not become ready with the Phoenix artifact protocol. Check storage/stock-renderer-*-error.log and its configured port. Stock creation is not ready.' }
    }

    # npm run dev uses this before launching its website and Lumina worker.
    if ($ServicesOnly) {
        $phoenixWarnings | Write-Warning
        if ($phoenixWarnings.Count) { exit 1 }
        if ($phoenixNeedsOllama) { Write-Output 'Ollama and MoneyPrinterTurbo are ready.' }
        else { Write-Output 'MoneyPrinterTurbo is ready. Groq writing is selected; verify its setup in Studio health. Ollama is not required.' }
        exit 0
    }

    if (-not (Test-PhoenixPort 3000)) {
        $phoenixBuildName = '.next-lumina'
        $phoenixBuildMarker = Join-Path $phoenixStorage 'active-build.json'
        if (Test-Path -LiteralPath $phoenixBuildMarker) {
            $phoenixBuildName = (Get-Content -Raw -LiteralPath $phoenixBuildMarker | ConvertFrom-Json).directory
            if ($phoenixBuildName -notmatch '^\.next-[a-z0-9-]+$') { throw 'The active-build marker is invalid. Select a verified local build before launching.' }
        }
        if (-not (Test-Path -LiteralPath (Join-Path $phoenixRoot "$phoenixBuildName\BUILD_ID"))) {
            throw 'The website has not been built. Run npm run build once in PhoenixStudio, then open this shortcut again.'
        }
        $env:PHOENIX_BUILD_DIR = $phoenixBuildName
        $next = Join-Path $phoenixRoot 'node_modules\next\dist\bin\next'
        Start-PhoenixService 'website' $phoenixNode @('--max-old-space-size=512', ('"' + $next + '"'), 'start', '--hostname', '127.0.0.1') $phoenixRoot | Out-Null
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-PhoenixHttp $phoenixUrl) { $ready = $true; break }
        Start-Sleep -Milliseconds 750
    }
    if (-not $ready) { throw "Phoenix did not become ready on port 3000. Check the newest website log in $phoenixStorage. An existing port owner was not stopped." }

    # Adopt an older Phoenix launcher only after exact root, executable, command
    # and live website identity are verified. Other port owners remain untouched.
    $phoenixNextFile = Join-Path $phoenixRoot 'node_modules\next\dist\bin\next'
    foreach ($websiteListener in @(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)) {
        $websiteCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($websiteListener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($websiteCim -and $websiteCim.ExecutablePath -eq $phoenixNode -and $websiteCim.CommandLine.IndexOf($phoenixNextFile, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $websiteCim.CommandLine -match '\sstart(?:\s|$)') {
            $websiteIdentity = Get-PhoenixProcessIdentity $websiteCim 'website'
            if ($websiteIdentity) { $script:phoenixOwnedServices = @($script:phoenixOwnedServices | Where-Object { $_.pid -ne $websiteIdentity.pid }) + @($websiteIdentity) }
        }
    }
    Write-PhoenixOwnedServices $phoenixOwnershipFile $script:phoenixOwnedServices
    try {
        $buildMarker = Join-Path $phoenixStorage 'active-build.json'
        $expectedBuild = (Get-Content -LiteralPath $buildMarker -Raw | ConvertFrom-Json).directory
        $runningHealth = Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 8
        if ($expectedBuild -match '^\.next-[a-z0-9-]+$' -and $runningHealth.build -and $runningHealth.build -ne $expectedBuild) {
            $phoenixWarnings += 'A newer verified website build is installed. The running website is an older version; use Apply Phoenix Update to activate the update when no video is processing.'
        }
    } catch { $phoenixWarnings += 'The running website build could not be checked. Open Studio health to verify the installed update.' }

    $workerFile = Join-Path $phoenixRoot 'run-worker.js'
    $knownWorkerId = 0
    try { $knownWorkerId = (Get-Content -LiteralPath (Join-Path $phoenixStorage 'worker-heartbeat.json') -Raw | ConvertFrom-Json).pid } catch { }
    $workers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and ($_.CommandLine.Contains($workerFile) -or ($_.ProcessId -eq $knownWorkerId -and $_.CommandLine -match '\s"?run-worker\.js"?\s*$'))
    })
    if (-not $workers.Count) {
        $workerStart = @(Start-PhoenixService 'worker' $phoenixNode @('--max-old-space-size=512', ('"' + $workerFile + '"')) $phoenixRoot)
        $workerProcess = $workerStart | Where-Object { $_ -is [Diagnostics.Process] } | Select-Object -Last 1
        if ($workerProcess) {
            Write-Output 'Lumina is loading. Waiting for its ready heartbeat; no duplicate worker will be started.'
            $workerReady = Wait-PhoenixWorker (Join-Path $phoenixStorage 'worker-heartbeat.json') $workerProcess.Id $workerProcess 45
            $workerProcess.Refresh()
        }
        if (-not $workerProcess -or $workerProcess.HasExited) {
            throw "The website is running, but the background worker failed to start. Check the newest worker error log in $phoenixStorage; queued work is retained."
        }
    }
    $managerIds = @($workers | ForEach-Object { $_.ProcessId })
    if ($workerProcess) { $managerIds += $workerProcess.Id }
    if (-not @($managerIds | Where-Object { Test-PhoenixWorkerHeartbeat (Join-Path $phoenixStorage 'worker-heartbeat.json') $_ }).Count) {
        $phoenixWarnings += 'Lumina manager has no fresh heartbeat. Queued jobs are saved; check storage/worker-*-error.log. An existing worker was not duplicated or killed.'
    }
    foreach ($existingWorker in $workers) {
        if ($existingWorker.ExecutablePath -eq $phoenixNode -and $existingWorker.CommandLine.IndexOf($workerFile, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and (Test-PhoenixWorkerHeartbeat (Join-Path $phoenixStorage 'worker-heartbeat.json') $existingWorker.ProcessId)) {
            $workerIdentity = Get-PhoenixProcessIdentity $existingWorker 'worker'
            if ($workerIdentity) { $script:phoenixOwnedServices = @($script:phoenixOwnedServices | Where-Object { $_.pid -ne $workerIdentity.pid }) + @($workerIdentity) }
        }
    }
    Write-PhoenixOwnedServices $phoenixOwnershipFile $script:phoenixOwnedServices
    if ($phoenixWarnings.Count) { Write-Output 'Phoenix website is open, but one or more production services need attention.' }
    elseif ($phoenixNeedsOllama) { Write-Output 'Phoenix Studio, Lumina manager, Ollama and MoneyPrinterTurbo are ready. Existing services were reused.' }
    else { Write-Output 'Phoenix Studio, Lumina manager and MoneyPrinterTurbo are ready. Groq writing is selected; verify its setup in Studio health. Existing services were reused.' }

    if (-not $NoBrowser) {
        $browsers = @(
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
            (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
        )
        $browser = $browsers | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if ($browser) {
            # The isolated profile makes closing Phoenix observable without
            # inspecting or stopping any personal Chrome/Edge tabs.
            $profile = Join-Path $phoenixStorage 'desktop-browser-profile'
            $desktop = Start-Process -FilePath $browser -ArgumentList @(("--user-data-dir=`"$profile`""), "--app=$phoenixUrl", '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--disable-extensions', '--disable-session-crashed-bubble') -WindowStyle Normal -PassThru
            $browserIdentity = $null
            for ($browserAttempt = 0; $browserAttempt -lt 20 -and -not $browserIdentity; $browserAttempt++) {
                $browserCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($desktop.Id)" -ErrorAction SilentlyContinue
                if ($browserCim -and $browserCim.CommandLine.Contains($profile)) { $browserIdentity = Get-PhoenixProcessIdentity $browserCim 'desktop-browser' }
                if (-not $browserIdentity) { Start-Sleep -Milliseconds 150 }
            }
            if ($browserIdentity) {
                $session = @{ version = 1; token = [guid]::NewGuid().ToString('N'); root = $phoenixRoot; browser = $browserIdentity }
                New-Item -ItemType Directory -Path (Split-Path -Parent $phoenixDesktopSession) -Force | Out-Null
                Write-PhoenixSessionJson $phoenixDesktopSession $session
                $guardianScript = Join-Path $PSScriptRoot 'watch-desktop-session.ps1'
                $guardian = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $guardianScript + '"'), '-SessionFile', ('"' + $phoenixDesktopSession + '"')) -WorkingDirectory $phoenixRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $phoenixStorage ("desktop-session-" + $session.token + '.log')) -RedirectStandardError (Join-Path $phoenixStorage ("desktop-session-" + $session.token + '-error.log'))
                $guardianCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($guardian.Id)" -ErrorAction SilentlyContinue
                $session.guardian = Get-PhoenixProcessIdentity $guardianCim 'desktop-guardian'
                Write-PhoenixSessionJson $phoenixDesktopSession $session
                Write-Output 'Closing the Phoenix app window stops its owned services and releases memory. Saved jobs resume next time. Previously running services with unknown ownership are preserved.'
            } else { $phoenixWarnings += 'The app browser ownership could not be verified. Automatic shutdown is disabled; services were left running.' }
        } else {
            Start-Process $phoenixUrl
            $phoenixWarnings += 'A supported Chrome/Edge app window was not found. Closing an ordinary browser tab cannot safely stop services; Phoenix remains running.'
        }
        if ($phoenixWarnings.Count) { (New-Object -ComObject WScript.Shell).Popup(($phoenixWarnings -join "`n`n"), 15, 'Phoenix Studio - optional services', 48) | Out-Null }
    }
    $phoenixWarnings | Write-Warning
    if ($phoenixWarnings.Count -and $NoBrowser) { exit 1 }
} catch {
    if (-not $NoBrowser) { (New-Object -ComObject WScript.Shell).Popup($_.Exception.Message, 0, 'Phoenix Studio could not start', 16) | Out-Null }
    Write-Error $_
    exit 1
} finally {
    if ($phoenixOwnsMutex) { $phoenixMutex.ReleaseMutex() }
    if ($phoenixMutex) { $phoenixMutex.Dispose() }
}
