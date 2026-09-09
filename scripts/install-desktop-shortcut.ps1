$ErrorActionPreference = 'Stop'
$phoenixRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$phoenixDesktop = [Environment]::GetFolderPath('Desktop')
$phoenixShortcutPath = Join-Path $phoenixDesktop 'Phoenix Studio.lnk'
$phoenixShell = New-Object -ComObject WScript.Shell
$phoenixShortcut = $phoenixShell.CreateShortcut($phoenixShortcutPath)
$phoenixShortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$phoenixShortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start-phoenix.ps1') + '"'
$phoenixShortcut.WorkingDirectory = $phoenixRoot
$phoenixShortcut.Description = 'Start Phoenix Studio locally and open its app window. No paid cloud services.'
$phoenixShortcut.IconLocation = (Join-Path $phoenixRoot 'src\app\favicon.ico') + ',0'
$phoenixShortcut.WindowStyle = 7
$phoenixShortcut.Save()
Write-Output "Created $phoenixShortcutPath"
