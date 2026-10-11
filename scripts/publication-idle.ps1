# Read-only exception for an untouched matching Story whose Reel failed before
# transfer. Ordinary queues, ambiguous provider state and every lease stay busy.
function Get-PhoenixPublicationGuardDigest([byte[]]$Bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($Bytes)).Replace('-', '') }
    finally { $hash.Dispose() }
}

function Read-PhoenixPublicationGuardRecord([string]$Filename) {
    $item = Get-Item -LiteralPath $Filename -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 65536) { throw 'Invalid publication state.' }
    $bytes = [IO.File]::ReadAllBytes($item.FullName)
    if ($bytes.Length -gt 65536) { throw 'Oversized publication state.' }
    $raw = [Text.Encoding]::UTF8.GetString($bytes)
    if (-not $raw.TrimStart().StartsWith('{')) { throw 'Invalid publication state.' }
    $record = $raw | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $record -or $record -is [array]) { throw 'Invalid publication state.' }
    $digest = Get-PhoenixPublicationGuardDigest $bytes
    return [pscustomobject]@{ record = $record; sha256 = $digest; filename = $item.FullName }
}

function Get-PhoenixPublicationGuardVaultHash([string]$Filename) {
    if (-not (Test-Path -LiteralPath $Filename -ErrorAction Stop)) { return 'MISSING' }
    $item = Get-Item -LiteralPath $Filename -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 8388608) { throw 'Invalid vault.' }
    $bytes = [IO.File]::ReadAllBytes($item.FullName)
    if ($bytes.Length -gt 8388608) { throw 'Oversized vault.' }
    return Get-PhoenixPublicationGuardDigest $bytes
}

function Test-PhoenixPublicationGuardLocksClear([string[]]$Filenames) {
    foreach ($filename in $Filenames) {
        if (Test-Path -LiteralPath $filename -ErrorAction Stop) { return $false }
    }
    return $true
}

function Test-PhoenixPublicationGuardNumber($Value, [switch]$Integer) {
    if ($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) { return $false }
    $number = [double]$Value
    return -not [double]::IsNaN($number) -and -not [double]::IsInfinity($number) -and $number -ge 0 -and (-not $Integer -or [Math]::Floor($number) -eq $number)
}

function Get-PhoenixPublicationUploadSessionIds([string]$Root) {
    # Unlock only locally, and return only job IDs with saved sessions. Neither
    # credential values nor provider URLs leave this function or reach logs.
    $filename = Join-Path $Root 'storage\private\channels.enc'
    if (-not (Test-Path -LiteralPath $filename -ErrorAction Stop)) { return @() }
    $cipherBytes = $null; $plainBytes = $null
    try {
        $item = Get-Item -LiteralPath $filename -Force -ErrorAction Stop
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 8388608) { throw 'Invalid vault.' }
        $envelope = Get-Content -LiteralPath $filename -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if ($envelope.kind -ne 'windows-dpapi' -or $envelope.data -isnot [string] -or -not $envelope.data) { throw 'Unsupported vault.' }
        Add-Type -AssemblyName System.Security -ErrorAction Stop
        $cipherBytes = [Convert]::FromBase64String($envelope.data)
        $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect($cipherBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        if ($plainBytes.Length -gt 8388608) { throw 'Oversized vault.' }
        $vault = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $vault -or $vault -isnot [pscustomobject]) { throw 'Invalid vault.' }
        if ($null -eq $vault.uploadSessions) { return @() }
        if ($vault.uploadSessions -isnot [pscustomobject]) { throw 'Invalid sessions.' }
        $ids = @($vault.uploadSessions.PSObject.Properties | ForEach-Object {
            if ($_.Name -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'Invalid session identity.' }
            $_.Name
        })
        return $ids
    } catch { throw 'Cannot safely verify private upload sessions; activation remains blocked.' }
    finally {
        if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
        if ($cipherBytes) { [Array]::Clear($cipherBytes, 0, $cipherBytes.Length) }
    }
}

function Test-PhoenixStoppedDependentStory([string]$Root, [string]$Filename) {
    try {
        # These guards inspect canonical owner stores. A custom runtime store
        # cannot be inferred safely from this launcher's environment.
        if ($env:PHOENIX_PUBLISH_STORAGE -or $env:PHOENIX_CHANNEL_STORAGE) { return $false }
        $snapshot = Read-PhoenixPublicationGuardRecord $Filename
        $story = $snapshot.record
        $uuid = '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        if ($story.version -ne 1 -or $story.id -isnot [string] -or $story.id -notmatch $uuid -or $story.reviewId -isnot [string] -or $story.reviewId -notmatch $uuid -or
            $story.parentReelId -isnot [string] -or $story.parentReelId -notmatch $uuid -or $story.id -eq $story.parentReelId -or
            $story.platform -cne 'instagram' -or $story.kind -cne 'story' -or $null -ne $story.standaloneStory -or $null -ne $story.detachedFromReelId -or
            $null -ne $story.companionStoryApproved -or $story.status -cne 'QUEUED' -or $story.phase -cne 'created' -or
            $story.bytesUploaded -ne 0 -or $story.percent -ne 0 -or $story.containerId -or $story.remoteId -or $story.remoteUrl) { return $false }
        if (-not (Test-PhoenixPublicationGuardNumber $story.version -Integer) -or -not (Test-PhoenixPublicationGuardNumber $story.bytesUploaded -Integer) -or
            -not (Test-PhoenixPublicationGuardNumber $story.percent -Integer)) { return $false }
        if ($story.queuedAt -isnot [long] -and $story.queuedAt -isnot [int]) { return $false }
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($story.queuedAt -le 0 -or $now - $story.queuedAt -lt 30000) { return $false }
        $publications = Join-Path $Root 'storage\private\review-publications'
        $storyPath = Join-Path $publications ($story.reviewId + '-instagram-story.json')
        if (-not [string]::Equals([IO.Path]::GetFullPath($Filename), [IO.Path]::GetFullPath($storyPath), [StringComparison]::OrdinalIgnoreCase)) { return $false }
        $parentPath = Join-Path $publications ($story.reviewId + '-instagram.json')
        $parentSnapshot = Read-PhoenixPublicationGuardRecord $parentPath
        $parent = $parentSnapshot.record
        if ($parent.version -ne 1 -or $parent.id -cne $story.parentReelId -or $parent.reviewId -cne $story.reviewId -or $parent.platform -cne 'instagram' -or
            $null -ne $parent.kind -or $null -ne $parent.parentReelId -or $null -ne $parent.standaloneStory -or $null -ne $parent.detachedFromReelId -or
            $parent.companionStoryApproved -ne $true -or $parent.status -cne 'FAILED' -or $parent.phase -cne 'created' -or
            $parent.bytesUploaded -ne 0 -or $parent.percent -ne 0 -or $parent.containerId -or $parent.remoteId -or $parent.remoteUrl) { return $false }
        if (-not (Test-PhoenixPublicationGuardNumber $parent.version -Integer) -or -not (Test-PhoenixPublicationGuardNumber $parent.bytesUploaded -Integer) -or
            -not (Test-PhoenixPublicationGuardNumber $parent.percent -Integer) -or $parent.companionStoryApproved -isnot [bool]) { return $false }
        if ($story.accountId -isnot [string] -or -not $story.accountId -or $story.accountId.Length -gt 200 -or $parent.accountId -cne $story.accountId -or
            $story.connectionRevision -isnot [string] -or -not $story.connectionRevision -or $story.connectionRevision.Length -gt 200 -or $parent.connectionRevision -cne $story.connectionRevision -or
            $story.renderTarget -cnotin @('instagram', 'youtube') -or $parent.renderTarget -cne $story.renderTarget) { return $false }
        foreach ($name in @('size', 'mtimeMs', 'ctimeMs', 'ino', 'dev')) {
            $value = $story.fingerprint.$name
            $integer = $name -in @('size', 'ino', 'dev')
            if (-not (Test-PhoenixPublicationGuardNumber $value -Integer:$integer) -or -not (Test-PhoenixPublicationGuardNumber $parent.fingerprint.$name -Integer:$integer) -or
                $parent.fingerprint.$name -ne $value) { return $false }
        }
        if ($story.fingerprint.size -le 0 -or $story.totalBytes -gt 9007199254740991 -or -not (Test-PhoenixPublicationGuardNumber $story.totalBytes -Integer) -or
            -not (Test-PhoenixPublicationGuardNumber $parent.totalBytes -Integer) -or $story.totalBytes -ne $story.fingerprint.size -or $parent.totalBytes -ne $story.totalBytes) { return $false }
        $vaultPath = Join-Path $Root 'storage\private\channels.enc'
        $locks = @(($storyPath + '.lock'), ($storyPath + '.operation.lock'), ($parentPath + '.lock'), ($parentPath + '.operation.lock'),
            (Join-Path $publications '.publication-stream.lock'), ($vaultPath + '.lock'))
        if (-not (Test-PhoenixPublicationGuardLocksClear $locks)) { return $false }
        $vaultBefore = Get-PhoenixPublicationGuardVaultHash $vaultPath
        $sessionIds = @(Get-PhoenixPublicationUploadSessionIds $Root)
        if ($story.id -in $sessionIds -or $parent.id -in $sessionIds) { return $false }
        $vaultAfter = Get-PhoenixPublicationGuardVaultHash $vaultPath
        if ($vaultBefore -ne $vaultAfter -or (Read-PhoenixPublicationGuardRecord $storyPath).sha256 -ne $snapshot.sha256 -or
            (Read-PhoenixPublicationGuardRecord $parentPath).sha256 -ne $parentSnapshot.sha256 -or
            -not (Test-PhoenixPublicationGuardLocksClear $locks)) { return $false }
        return $true
    } catch { return $false }
}
