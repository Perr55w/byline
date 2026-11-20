<#
  Starts Byline every time you sign in to Windows: a Task Scheduler task, hidden window, restarted if it stops.
  Run once from PowerShell in the Byline folder:
      powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
  Remove it again with uninstall-autostart.ps1.
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'Byline'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Cmd = Join-Path $PSScriptRoot 'start-byline.cmd'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or newer is required: https://nodejs.org (install it, open a new PowerShell, run this again).' }
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required (found $(node --version))." }
if (-not (Test-Path (Join-Path $Root '.env'))) {
  Copy-Item (Join-Path $Root '.env.example') (Join-Path $Root '.env')
  Write-Host 'Created .env from .env.example. Set BYLINE_PASSWORD in it before using Byline from your phone.' -ForegroundColor Yellow
}

# Port from .env (default 3000), for the hints below.
$Port = 3000
$envLine = Select-String -Path (Join-Path $Root '.env') -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($envLine) { $Port = [int]$envLine.Matches[0].Groups[1].Value }

# Hidden: conhost --headless keeps the console window from appearing (Windows 10 1809+); powershell -WindowStyle Hidden as a fallback.
$conhost = Join-Path $env:WINDIR 'System32\conhost.exe'
if (Test-Path $conhost) {
  $action = New-ScheduledTaskAction -Execute $conhost -Argument "--headless cmd.exe /c `"$Cmd`"" -WorkingDirectory $Root
} else {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$Cmd'`"" -WorkingDirectory $Root
}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Byline: personal news briefing (deploy\windows\start-byline.cmd)' | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host "Byline will start at every sign-in. It is starting now: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "Logs: $Root\logs\byline.log    Data: $Root\data    Backups: $Root\backups"
Write-Host ''
Write-Host 'Your bookmarkable HTTPS link (phone and PC), through Tailscale:' -ForegroundColor Cyan
Write-Host "    tailscale serve --bg $Port"
$dns = $null
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  try { $dns = ((tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.') } catch { $dns = $null }
}
if ($dns) {
  Write-Host "    then open https://$dns   (bookmark it; on the phone: Share > Add to Home Screen)"
  Write-Host "    and put BYLINE_PUBLIC_URL=https://$dns in .env so notification links open it."
} else {
  Write-Host '    then open https://<pc-name>.<your-tailnet>.ts.net  (the exact name is in the Tailscale app, or: tailscale status)'
  Write-Host '    Install Tailscale first if needed: https://tailscale.com/download'
}
Write-Host 'Before using it from the phone, set BYLINE_PASSWORD in .env and turn on two-step sign-in (Settings > Security).' -ForegroundColor Yellow
