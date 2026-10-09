# Isolated helper tests; no real process, network, build or browser operations.
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'start-phoenix.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Get-PhoenixSelectedBuild', 'Read-PhoenixReleaseRecords', 'Assert-PhoenixReleaseIdle', 'Confirm-PhoenixSelectedRelease')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw ('Missing helper ' + $name) }
    . ([ScriptBlock]::Create($definition.Extent.Text))
}
function Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    $global:fixtureHealthCalls++
    if ($global:scenario.HealthFailure) { throw 'Mock unavailable health' }
    $busy = $global:scenario.Busy -or ($global:scenario.BusyLate -and $global:fixtureHealthCalls -ge 2)
    $resources = if ($global:scenario.UnknownIdle) { [pscustomobject]@{} } else { [pscustomobject]@{ busy = [bool]$busy } }
    return [pscustomobject]@{ build = $global:fixtureLiveBuild; resources = $resources }
}
function Test-PhoenixRecoveryBusy { param($Root) return [bool]$global:scenario.LeaseBusy }
function Get-NetTCPConnection {
    param($State, $LocalPort, $ErrorAction)
    if ($global:scenario.TwoListeners) { return @([pscustomobject]@{ OwningProcess = 41 }, [pscustomobject]@{ OwningProcess = 43 }) }
    return [pscustomobject]@{ OwningProcess = 41 }
}
function Get-CimInstance {
    param($ClassName, $Filter, $ErrorAction)
    $website = '"' + (Join-Path $global:fixtureRoot 'node_modules\next\dist\bin\next') + '" start'
    if ($global:scenario.ForeignWebsite) { $website = 'C:\foreign\next start' }
    $worker = '"' + (Join-Path $global:fixtureRoot 'run-worker.js') + '"'
    if ($global:scenario.ForeignWorker) { $worker = 'C:\foreign\run-worker.js' }
    if ($Filter -match 'ProcessId = 41$') { return [pscustomobject]@{ ProcessId = 41; ExecutablePath = 'C:\fixture\node.exe'; CommandLine = $website } }
    if ($Filter -match 'ProcessId = 42$') { return [pscustomobject]@{ ProcessId = 42; ExecutablePath = 'C:\fixture\node.exe'; CommandLine = $worker } }
    throw 'Unexpected mock process lookup'
}
function Get-PhoenixProcessIdentity {
    param($Process, $Role)
    if ($global:scenario.IdentityFailure) { return $null }
    return [pscustomobject]@{ pid = $Process.ProcessId; role = $Role }
}
function Test-PhoenixWorkerHeartbeat { param($Filename, $Id) return -not $global:scenario.StaleWorker }

function Invoke-Fixture([hashtable]$Options = @{}) {
    $global:scenario = $Options
    $global:fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('phoenix-release-fixture-' + [guid]::NewGuid().ToString('N'))
    $global:fixtureEvents = Join-Path $global:fixtureRoot 'events.txt'
    $global:fixtureLiveBuild = if ($Options.SameBuild) { '.next-verified' } else { '.next-old' }
    $global:fixtureHealthCalls = 0
    $storage = Join-Path $global:fixtureRoot 'storage'
    $review = Join-Path $storage 'Phoenix Studio Review Files'
    $scripts = Join-Path $global:fixtureRoot 'scripts'
    foreach ($directory in @($scripts, $review, (Join-Path $global:fixtureRoot '.next-verified'))) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    [IO.File]::WriteAllText((Join-Path $global:fixtureRoot '.next-verified\BUILD_ID'), 'fixture-build')
    if ($Options.EmptyBuild) { [IO.File]::WriteAllText((Join-Path $global:fixtureRoot '.next-verified\BUILD_ID'), ' ') }
    $selected = if ($Options.UnsafeSelection) { '../outside' } elseif ($Options.MissingBundle) { '.next-missing' } else { '.next-verified' }
    if (-not $Options.NoMarker) { [IO.File]::WriteAllText((Join-Path $storage 'active-build.json'), (@{ directory = $selected } | ConvertTo-Json)) }
    [IO.File]::WriteAllText((Join-Path $storage 'worker-heartbeat.json'), '{"pid":42}')
    [IO.File]::WriteAllText((Join-Path $review 'index.json'), '[]')
    if ($Options.ActiveJob) { [IO.File]::WriteAllText((Join-Path $review 'creation-drafts.json'), '[{"id":"fixture","status":"PLANNING"}]') }
    if ($Options.BadState) { [IO.File]::WriteAllText((Join-Path $review 'source-processing-jobs.json'), '{not an array}') }
    if ($Options.Analysis) { [IO.File]::WriteAllText((Join-Path $review 'index.json'), '[{"id":"fixture","quality":{"postingAnalysis":{"status":"ANALYZING"}}}]') }
    if ($Options.Upload) {
        $publications = Join-Path $storage 'private\review-publications'
        New-Item -ItemType Directory -Path $publications -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $publications 'fixture-instagram.json'), '{"status":"UPLOADING"}')
    }
    $restart = @'
param([switch]$NoPause, [switch]$NoBrowser, [switch]$Rebuild)
[IO.File]::AppendAllText($global:fixtureEvents, ('restart:pause=' + $NoPause + ';browser=' + $NoBrowser + ';build=' + $Rebuild + ';guard=' + $env:PHOENIX_BUILD_ACTIVATION) + [Environment]::NewLine)
if (-not $global:scenario.RestartMismatch) { $global:fixtureLiveBuild = '.next-verified' }
$global:LASTEXITCODE = if ($global:scenario.RestartFailed) { 1 } else { 0 }
'@
    [IO.File]::WriteAllText((Join-Path $scripts 'restart-phoenix.ps1'), $restart)
    $env:PHOENIX_BUILD_ACTIVATION = if ($Options.Nested) { '.next-verified' } else { $null }
    $status = 0; $message = ''
    try {
        $verified = Get-PhoenixSelectedBuild $global:fixtureRoot
        Confirm-PhoenixSelectedRelease $global:fixtureRoot 'C:\fixture\node.exe' $verified | Out-Null
        if (-not $Options.Nested -and $env:PHOENIX_BUILD_ACTIVATION) { throw 'Activation guard leaked after request' }
    } catch { $status = 1; $message = $_.Exception.Message }
    try {
        $events = @(if (Test-Path -LiteralPath $global:fixtureEvents) { Get-Content -LiteralPath $global:fixtureEvents })
        return [pscustomobject]@{ status = $status; message = $message; events = $events }
    } finally {
        $env:PHOENIX_BUILD_ACTIVATION = $null
        $resolved = [IO.Path]::GetFullPath($global:fixtureRoot)
        $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^phoenix-release-fixture-') { throw 'Unsafe fixture cleanup target' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

$result = Invoke-Fixture
Require ($result.status -eq 0) ('Idle activation failed: ' + $result.message)
Require ($result.events.Count -eq 1 -and $result.events[0] -eq 'restart:pause=True;browser=True;build=False;guard=.next-verified') 'Activation must be one same-thread no-build/no-browser request'
Write-Output 'idle activation passed'
$result = Invoke-Fixture @{ SameBuild = $true; Busy = $true }
Require ($result.status -eq 0 -and $result.events.Count -eq 0) 'Same-build fast path changed'
Write-Output 'same-build fast path passed'
foreach ($options in @(@{ NoMarker = $true }, @{ UnsafeSelection = $true }, @{ MissingBundle = $true }, @{ EmptyBuild = $true })) {
    $result = Invoke-Fixture $options
    Require ($result.status -eq 1 -and $result.events.Count -eq 0 -and $result.message -match 'no older build was selected automatically') 'Invalid selection fell back or dispatched activation'
}
Write-Output 'required selection passed'
foreach ($options in @(@{ Busy = $true }, @{ UnknownIdle = $true }, @{ LeaseBusy = $true }, @{ BusyLate = $true })) {
    $result = Invoke-Fixture $options
    Require ($result.status -eq 1 -and $result.events.Count -eq 0 -and $result.message -match 'No process was stopped') 'Busy/unknown work dispatched activation'
}
Write-Output 'idle safety passed'
foreach ($options in @(@{ ActiveJob = $true }, @{ Analysis = $true }, @{ Upload = $true }, @{ BadState = $true })) {
    $result = Invoke-Fixture $options
    Require ($result.status -eq 1 -and $result.events.Count -eq 0) 'Active or unreadable saved work was interrupted'
}
Write-Output 'saved work safety passed'
foreach ($options in @(@{ ForeignWebsite = $true }, @{ ForeignWorker = $true }, @{ StaleWorker = $true }, @{ IdentityFailure = $true }, @{ TwoListeners = $true })) {
    $result = Invoke-Fixture $options
    Require ($result.status -eq 1 -and $result.events.Count -eq 0) 'Foreign/stale process dispatched activation'
}
Write-Output 'identity safety passed'
foreach ($options in @(@{ RestartFailed = $true }, @{ RestartMismatch = $true })) {
    $result = Invoke-Fixture $options
    Require ($result.status -eq 1 -and $result.events.Count -eq 1) 'Failed activation was reported ready or repeatedly attempted'
}
foreach ($options in @(@{ Nested = $true }, @{ HealthFailure = $true })) {
    $result = Invoke-Fixture $options
    Require ($result.status -eq 1 -and $result.events.Count -eq 0) 'Nested or unverified activation was attempted'
}
Write-Output 'failure and recursion safety passed'
