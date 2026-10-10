param([switch]$NoBrowser, [switch]$ServicesOnly, [string]$DesktopSessionToken)

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

function Get-PhoenixSelectedBuild([string]$Root) {
    $marker = Join-Path $Root 'storage\active-build.json'
    try { $selected = (Get-Content -LiteralPath $marker -Raw -ErrorAction Stop | ConvertFrom-Json).directory }
    catch { throw 'No valid installed-build selection exists. Run Apply Phoenix Update successfully before opening Phoenix; no older build was selected automatically.' }
    if ($selected -isnot [string] -or $selected -notmatch '^\.next-[a-z0-9-]+$' -or -not (Test-Path -LiteralPath (Join-Path $Root "$selected\BUILD_ID") -PathType Leaf)) {
        throw 'The installed-build selection is invalid or incomplete. Run Apply Phoenix Update successfully; no older build was selected automatically.'
    }
    if (-not (Get-Content -LiteralPath (Join-Path $Root "$selected\BUILD_ID") -Raw -ErrorAction Stop).Trim()) {
        throw 'The installed-build selection is invalid or incomplete. Run Apply Phoenix Update successfully; no older build was selected automatically.'
    }
    return $selected
}

function Read-PhoenixReleaseRecords([string]$Path, [switch]$Single) {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    try {
        if ((Get-Item -LiteralPath $Path -ErrorAction Stop).Length -gt 8388608) { throw 'Oversized state.' }
        $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        if (-not $Single -and -not $raw.TrimStart().StartsWith('[')) { throw 'Unexpected state.' }
        if ($Single -and -not $raw.TrimStart().StartsWith('{')) { throw 'Unexpected upload state.' }
        return @($raw | ConvertFrom-Json)
    } catch { throw 'Cannot safely verify saved job state for activation. Check Jobs and local logs; the running website was left alone.' }
}

function Assert-PhoenixReleaseIdle([string]$Root, $Health) {
    if ($null -eq $Health.resources -or $Health.resources.busy -ne $false -or (Test-PhoenixRecoveryBusy $Root)) {
        throw 'Phoenix is processing work, or its idle state cannot be verified. Wait until Jobs are idle, then open Phoenix again to load the installed update. No process was stopped.'
    }
    $review = Join-Path $Root 'storage\Phoenix Studio Review Files'
    foreach ($name in @('source-processing-jobs.json', 'ai-creation-jobs.json', 'review-edit-jobs.json', 'creation-drafts.json')) {
        $jobs = @(Read-PhoenixReleaseRecords (Join-Path $review $name))
        if (@($jobs | Where-Object { -not $_.archivedAt -and $_.status -in @('PROCESSING', 'RUNNING', 'PLANNING', 'APPROVING') }).Count) {
            throw 'A saved video job is active or awaiting safe recovery. Wait for the manager to finish or reconcile it, then open Phoenix again. The installed update is not active yet; no process was stopped.'
        }
    }
    $reviews = @(Read-PhoenixReleaseRecords (Join-Path $review 'index.json'))
    if (@($reviews | Where-Object { -not $_.trashedAt -and $_.quality.postingAnalysis.status -eq 'ANALYZING' }).Count) {
        throw 'Posting-copy analysis is active or awaiting safe recovery. Wait for it to finish before activating the installed update; no process was stopped.'
    }
    $publications = Join-Path $Root 'storage\private\review-publications'
    foreach ($file in @(Get-ChildItem -LiteralPath $publications -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
        if ($file.Name -in @('instagram-posting-defaults.json', 'instagram-story-business.json')) { continue }
        $uploads = @(Read-PhoenixReleaseRecords $file.FullName -Single)
        if ($uploads.Count -ne 1 -or $uploads[0].status -isnot [string] -or $uploads[0].status -notin @('QUEUED', 'UPLOADING', 'PROCESSING', 'COMPLETE', 'FAILED', 'NEEDS_CHECK')) {
            throw 'Cannot safely verify saved upload state for activation. Check its posting status; no process was stopped.'
        }
        if ($uploads[0].status -in @('QUEUED', 'UPLOADING', 'PROCESSING')) {
            throw 'An approved channel upload is queued, active or awaiting confirmation. Check its posting status before activating the installed update; no process was stopped.'
        }
    }
}

function Confirm-PhoenixSelectedRelease([string]$Root, [string]$Node, [string]$Selected) {
    try { $health = Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 8 }
    catch { throw 'The running Phoenix release could not be verified. Check Studio health or local logs; no process was stopped and no older version was opened automatically.' }
    if ($health.build -eq $Selected) { return }
    if ($health.build -isnot [string] -or $health.build -notmatch '^\.next-[a-z0-9-]+$') {
        throw 'The running website did not identify a verified Phoenix build. No process was stopped; check the owner of port 3000.'
    }
    if ($env:PHOENIX_BUILD_ACTIVATION) { throw 'The installed release did not become active after restart. Check the latest website/worker logs; saved jobs are retained. No repeated activation was attempted.' }
    Assert-PhoenixReleaseIdle $Root $health
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)
    $websiteIds = @($listeners.OwningProcess | Select-Object -Unique)
    if ($websiteIds.Count -ne 1) { throw 'Cannot safely identify the running website for activation. No process was stopped.' }
    $nextFile = Join-Path $Root 'node_modules\next\dist\bin\next'
    $website = Get-CimInstance Win32_Process -Filter "ProcessId = $($websiteIds[0])" -ErrorAction SilentlyContinue
    $nextArgument = '(?:^|\s)"?' + [regex]::Escape($nextFile) + '"?(?:\s|$)'
    if (-not $website -or $website.ExecutablePath -ne $Node -or -not $website.CommandLine -or $website.CommandLine -notmatch $nextArgument -or $website.CommandLine -notmatch '\sstart(?:\s|$)' -or -not (Get-PhoenixProcessIdentity $website 'website')) {
        throw 'Port 3000 is not a verified website from this Phoenix folder. No foreign process was stopped.'
    }
    $heartbeat = Join-Path $Root 'storage\worker-heartbeat.json'
    try { $workerId = [int](Get-Content -LiteralPath $heartbeat -Raw -ErrorAction Stop | ConvertFrom-Json).pid }
    catch { throw 'The manager identity is unavailable. Wait for recovery or check the worker log; activation did not stop any process.' }
    $workerFile = Join-Path $Root 'run-worker.js'
    $workerArgument = '(?:^|\s)"?' + [regex]::Escape($workerFile) + '"?(?:\s|$)'
    $worker = Get-CimInstance Win32_Process -Filter "ProcessId = $workerId" -ErrorAction SilentlyContinue
    if ($workerId -le 0 -or -not $worker -or $worker.ExecutablePath -ne $Node -or -not $worker.CommandLine -or $worker.CommandLine -notmatch $workerArgument -or -not (Test-PhoenixWorkerHeartbeat $heartbeat $workerId) -or -not (Get-PhoenixProcessIdentity $worker 'worker')) {
        throw 'The manager is stale or belongs to a different Phoenix folder. Wait for safe recovery; activation did not stop any process.'
    }
    # Identity checks can take time on Windows. Re-check idle metadata just
    # before the existing restarter performs its own final heavy-work check.
    try { $health = Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 8 }
    catch { throw 'Phoenix health changed during activation checks. No process was stopped; try again when Studio health is available.' }
    Assert-PhoenixReleaseIdle $Root $health
    Write-Output 'An installed verified release is newer than the running website. Activating it while idle; no build or failed-job retry is requested.'
    $previousActivation = $env:PHOENIX_BUILD_ACTIVATION
    try {
        $env:PHOENIX_BUILD_ACTIVATION = $Selected
        # Same-thread invocation preserves reentrant lifecycle mutex ownership.
        # The nested launcher must match the selection; it cannot recurse here.
        & (Join-Path $Root 'scripts\restart-phoenix.ps1') -NoPause -NoBrowser
        if ($LASTEXITCODE -ne 0) { throw 'Installed-release activation failed. Check the latest Phoenix logs; saved jobs remain intact.' }
    } finally { $env:PHOENIX_BUILD_ACTIVATION = $previousActivation }
    $currentSelection = Get-PhoenixSelectedBuild $Root
    try { $currentHealth = Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 8 }
    catch { throw 'Restart finished, but the served release could not be verified. Phoenix is not being reported as up to date; check local logs.' }
    if ($currentSelection -ne $Selected -or $currentHealth.build -ne $currentSelection) { throw 'The installed and running release still differ. Reopen Phoenix after the current update finishes; no older release is being reported as latest.' }
}

function Start-PhoenixService([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$Directory) {
    if ($DesktopSessionToken -and -not (Test-PhoenixDesktopSessionActive $phoenixRoot $DesktopSessionToken)) { throw 'Desktop recovery cancelled because the app window closed or its session changed.' }
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

    $phoenixSelectedBuild = $null
    if (-not $ServicesOnly) { $phoenixSelectedBuild = Get-PhoenixSelectedBuild $phoenixRoot }

    New-Item -ItemType Directory -Path $phoenixStorage -Force | Out-Null
    $script:phoenixOwnedServices = @(Read-PhoenixOwnedServices $phoenixOwnershipFile)
    $phoenixNode = (Get-Command node.exe -ErrorAction Stop).Source
    $phoenixWarnings = @()
    $phoenixConfigText = & $phoenixNode (Join-Path $PSScriptRoot 'launch-config.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Phoenix launcher settings are invalid. Check the local renderer URL and private writer settings. No fallback writer was selected.' }
    $phoenixConfig = $phoenixConfigText | ConvertFrom-Json
    $phoenixNeedsOllama = Test-PhoenixNeedsOllama $phoenixConfig.writerProvider
    $phoenixReuseBrowser = $null
    if ($DesktopSessionToken -and -not (Test-PhoenixDesktopSessionActive $phoenixRoot $DesktopSessionToken)) { throw 'Desktop recovery cancelled because its app window is no longer open.' }
    # A dedicated app session is already open. Double-clicks do not create more
    # browser windows or competing guardians.
    if (-not $NoBrowser -and -not $ServicesOnly -and (Test-Path -LiteralPath $phoenixDesktopSession)) {
        try {
            $existingSession = Get-Content -LiteralPath $phoenixDesktopSession -Raw | ConvertFrom-Json
            if ($existingSession.root -eq $phoenixRoot -and (Get-PhoenixProcessByIdentity $existingSession.browser) -and (Test-PhoenixDesktopWindow $existingSession.browser)) {
                $phoenixReuseBrowser = $existingSession.browser
                $heartbeatFile = Join-Path $phoenixStorage 'worker-heartbeat.json'
                $workerId = 0
                try { $workerId = (Get-Content -LiteralPath $heartbeatFile -Raw | ConvertFrom-Json).pid } catch { }
                $existingWorker = @($script:phoenixOwnedServices | Where-Object { $_.role -eq 'worker' -and $_.pid -eq $workerId }) | Select-Object -First 1
                $allReady = (Test-PhoenixHttp $phoenixUrl) -and $existingWorker -and (Test-PhoenixWorkerHeartbeat $heartbeatFile $workerId) -and (Test-PhoenixServiceHttp ($phoenixConfig.backendUrl + '/openapi.json') 'renderer')
                if ($phoenixNeedsOllama) { $allReady = $allReady -and (Test-PhoenixServiceHttp 'http://127.0.0.1:11434/api/tags' 'ollama') }
                $currentBuildMatches = $false
                try {
                    $installedBuild = Get-PhoenixSelectedBuild $phoenixRoot
                    $liveBuild = (Invoke-RestMethod 'http://localhost:3000/api/studio-health' -TimeoutSec 8).build
                    $currentBuildMatches = $installedBuild -eq $liveBuild
                } catch { }
                if ($allReady -and $currentBuildMatches -and $existingSession.guardianRevision -eq 'desktop-session-v2' -and (Get-PhoenixProcessByIdentity $existingSession.guardian)) {
                    Write-Output 'Phoenix Studio is already open and its website, manager and renderer are ready.'
                    exit 0
                }
                Write-Output 'The Phoenix app window is open. Checking and repairing its missing services before reusing it.'
            }
        } catch { }
    }
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
        else { Write-Output "MoneyPrinterTurbo is ready. $($phoenixConfig.writerProvider) writing is selected; verify its setup in Studio health. Ollama is not required." }
        exit 0
    }

    if (-not (Test-PhoenixPort 3000)) {
        $phoenixBuildName = Get-PhoenixSelectedBuild $phoenixRoot
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
    Confirm-PhoenixSelectedRelease $phoenixRoot $phoenixNode (Get-PhoenixSelectedBuild $phoenixRoot)
    # An idle replacement starter has its own fresh process ownership records.
    # Do not overwrite them with this launcher's pre-activation process list.
    $script:phoenixOwnedServices = @(Read-PhoenixOwnedServices $phoenixOwnershipFile)

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
            $workerReady = Wait-PhoenixWorker (Join-Path $phoenixStorage 'worker-heartbeat.json') $workerProcess.Id $workerProcess 90
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
    else { Write-Output "Phoenix Studio, Lumina manager and MoneyPrinterTurbo are ready. $($phoenixConfig.writerProvider) writing is selected; verify its setup in Studio health. Existing services were reused." }

    if (-not $NoBrowser -and $phoenixReuseBrowser) {
        Start-PhoenixDesktopGuardian $phoenixRoot $phoenixReuseBrowser | Out-Null
        Write-Output 'Phoenix services are ready in the existing app window. Its desktop guardian was refreshed.'
    } elseif (-not $NoBrowser) {
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
                Start-PhoenixDesktopGuardian $phoenixRoot $browserIdentity | Out-Null
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
