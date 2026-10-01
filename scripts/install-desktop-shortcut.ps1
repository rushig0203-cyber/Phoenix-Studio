$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-session.ps1')
$phoenixRoot = Get-PhoenixCanonicalRoot (Join-Path $PSScriptRoot '..')
$phoenixDesktop = [Environment]::GetFolderPath('Desktop')
$phoenixShortcutPath = Join-Path $phoenixDesktop 'Phoenix Studio.lnk'
$phoenixShell = New-Object -ComObject WScript.Shell
$phoenixShortcut = $phoenixShell.CreateShortcut($phoenixShortcutPath)
$phoenixShortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$phoenixShortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $phoenixRoot 'scripts\start-phoenix.ps1') + '"'
$phoenixShortcut.WorkingDirectory = $phoenixRoot
$phoenixShortcut.Description = 'Open current Phoenix Studio. Closing its app window stops Phoenix-owned background work.'
$phoenixShortcut.IconLocation = (Join-Path $phoenixRoot 'src\app\favicon.ico') + ',0'
$phoenixShortcut.WindowStyle = 7
$phoenixShortcut.Save()
Write-Output "Created $phoenixShortcutPath"

$phoenixUpdatePath = Join-Path $phoenixDesktop 'Apply Phoenix Update.lnk'
$phoenixUpdate = $phoenixShell.CreateShortcut($phoenixUpdatePath)
$phoenixUpdate.TargetPath = $phoenixShortcut.TargetPath
$phoenixUpdate.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $phoenixRoot 'scripts\restart-phoenix.ps1') + '" -Rebuild'
$phoenixUpdate.WorkingDirectory = $phoenixRoot
$phoenixUpdate.Description = 'Build and activate saved Phoenix changes while idle. Previous verified build is retained on failure.'
$phoenixUpdate.IconLocation = $phoenixShortcut.IconLocation
$phoenixUpdate.WindowStyle = 1
$phoenixUpdate.Save()
Write-Output "Created $phoenixUpdatePath"
