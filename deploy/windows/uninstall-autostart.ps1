<#
  Stops Byline and removes the log-on task created by install-autostart.ps1. Your data, backups and .env stay.
      powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall-autostart.ps1
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'Byline'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host 'Removed the Byline log-on task.'
} else { Write-Host 'No Byline task was registered.' }

# Stop the launcher loop (start-byline.cmd from this folder) and the node process it started.
$launchers = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" | Where-Object { $_.CommandLine -like '*start-byline.cmd*' })
foreach ($l in $launchers) {
  # the launcher first, so its restart loop can't start Byline again
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($l.ProcessId)" | Where-Object { $_.Name -eq 'node.exe' })
  Stop-Process -Id $l.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "Stopped the launcher (pid $($l.ProcessId))"
  foreach ($c in $children) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "Stopped Byline (node, pid $($c.ProcessId))" }
}
if (-not $launchers.Count) { Write-Host 'Byline was not running from the launcher.' }
Write-Host "Data, backups and .env are untouched in $Root. If you used tailscale serve, stop it with: tailscale serve reset"
