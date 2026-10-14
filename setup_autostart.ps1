# ============================================================
#  MenteeBOM auto-start setup (run ONCE, self-elevating)
#
#  Registers three scheduled tasks:
#    1. "MenteeBOM Prod Server" - at boot (before login), runs
#       start_prod_server.bat as your user account via S4U logon:
#       NO password is asked for or stored anywhere, and the task
#       keeps working even if you change your Windows password.
#    2. "MenteeBOM Server Stop" - on-demand helper that kills the
#       server as SYSTEM. The boot task's server lives in session 0
#       where the (non-elevated) tray icon has no kill rights, so
#       the tray triggers this task instead.
#    3. "MenteeBOM Tray" - at logon, shows the green/red status
#       icon in the system tray (tray_menteebom.ps1).
#  It also grants your user run/read rights on tasks 1 and 2 -
#  S4U/SYSTEM tasks are admin-only by default, which is why the
#  tray's Start/Stop/Restart used to fail silently.
#
#  Usage: right-click this file -> "Run with PowerShell" and
#         accept the UAC prompt. That's all.
#  See AUTOSTART.md.
# ============================================================

param([string]$TargetUser = "$env:USERDOMAIN\$env:USERNAME")

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- self-elevate --------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Requesting administrator elevation (needed only to register the tasks)...'
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$($MyInvocation.MyCommand.Path)`"",
        '-TargetUser', "`"$TargetUser`""
    )
    exit
}

Write-Host '============================================='
Write-Host ' MenteeBOM auto-start setup'
Write-Host '============================================='
Write-Host "App directory : $AppDir"
Write-Host "Server user   : $TargetUser"
Write-Host '(No password needed - the boot task uses S4U logon.)'
Write-Host ''

# --- Task 1: prod server at boot ------------------------------
Write-Host 'Registering task: MenteeBOM Prod Server (at boot)...'
$serverAction  = New-ScheduledTaskAction -Execute (Join-Path $AppDir 'start_prod_server.bat') -WorkingDirectory $AppDir
$serverTrigger = New-ScheduledTaskTrigger -AtStartup
$serverTrigger.Delay = 'PT30S'
# S4U: runs as the user with nobody logged in, WITHOUT storing a password.
# (Limitation: no access to network shares under your identity - not needed here.)
$serverPrincipal = New-ScheduledTaskPrincipal -UserId $TargetUser -LogonType S4U -RunLevel Limited
$serverSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
try {
    Register-ScheduledTask -TaskName 'MenteeBOM Prod Server' `
        -Action $serverAction -Trigger $serverTrigger -Principal $serverPrincipal -Settings $serverSettings `
        -Description 'Auto-starts the MenteeBOM prod Flask server (port 80) at boot. Logs to logs\prod_server.log.' `
        -Force -ErrorAction Stop | Out-Null
    Write-Host '  OK - server will start at every boot (30s delay), even with nobody logged in.'
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)"
    Write-Host '  (S4U may be blocked for Microsoft accounts - see AUTOSTART.md troubleshooting.)'
    Read-Host 'Press Enter to close'; exit 1
}

# --- Task 2: elevated stop helper (on-demand only) -------------
Write-Host 'Registering task: MenteeBOM Server Stop (on-demand stop helper)...'
$stopAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AppDir\stop_prod_server.ps1`"" `
    -WorkingDirectory $AppDir
# SYSTEM so it can see and kill the session-0 server pythons; no trigger -
# it only runs when the tray (or you) starts it on demand.
$stopPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$stopSettings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
try {
    Register-ScheduledTask -TaskName 'MenteeBOM Server Stop' `
        -Action $stopAction -Principal $stopPrincipal -Settings $stopSettings `
        -Description 'On-demand helper: stops the MenteeBOM prod server (ends the boot task, kills the session-0 pythons). Triggered by the tray icon.' `
        -Force -ErrorAction Stop | Out-Null
    Write-Host '  OK - tray Stop/Restart will use this helper.'
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)"
    Read-Host 'Press Enter to close'; exit 1
}

# --- let the (non-admin) tray control both server tasks ---------
# By default S4U/SYSTEM tasks are readable/runnable by admins only - even
# 'schtasks /query' gets Access Denied - so the tray's Start/Stop silently
# did nothing. Grant the user read+execute on the task objects.
Write-Host "Granting $TargetUser run/read rights on the server tasks..."
try {
    $sid  = ([System.Security.Principal.NTAccount]$TargetUser).Translate([System.Security.Principal.SecurityIdentifier]).Value
    $sddl = "D:(A;;FA;;;BA)(A;;FA;;;SY)(A;;GRGX;;;$sid)"
    $svc = New-Object -ComObject 'Schedule.Service'
    $svc.Connect()
    $root = $svc.GetFolder('\')
    foreach ($tn in 'MenteeBOM Prod Server', 'MenteeBOM Server Stop') {
        $root.GetTask($tn).SetSecurityDescriptor($sddl, 0)
    }
    Write-Host '  OK - the tray icon can now start/stop the server.'
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)"
    Write-Host '  (Tray Start/Stop will not work until this succeeds.)'
}

# --- Task 3: tray icon at logon --------------------------------
Write-Host 'Registering task: MenteeBOM Tray (at logon)...'
# wscript + run_hidden.vbs launches powershell with NO console window at all
# (powershell -WindowStyle Hidden still shows a window when Windows Terminal
#  is the default terminal app).
$trayAction = New-ScheduledTaskAction -Execute 'wscript.exe' `
    -Argument "`"$AppDir\run_hidden.vbs`" powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$AppDir\tray_menteebom.ps1`"" `
    -WorkingDirectory $AppDir
$trayTrigger   = New-ScheduledTaskTrigger -AtLogOn -User $TargetUser
$trayPrincipal = New-ScheduledTaskPrincipal -UserId $TargetUser -LogonType Interactive -RunLevel Limited
$traySettings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
try {
    Register-ScheduledTask -TaskName 'MenteeBOM Tray' `
        -Action $trayAction -Trigger $trayTrigger -Principal $trayPrincipal -Settings $traySettings `
        -Description 'MenteeBOM system tray status/control icon (green = prod server up).' `
        -Force -ErrorAction Stop | Out-Null
    Write-Host '  OK - tray icon will appear at every logon.'
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)"
    Read-Host 'Press Enter to close'; exit 1
}

# --- start things now so no reboot is needed -------------------
Write-Host ''
Write-Host 'Starting tray icon now...'
Start-ScheduledTask -TaskName 'MenteeBOM Tray'

# Take over from any already-running server instance (including ones started
# as Administrator, which the tray icon is not allowed to stop) - we are
# elevated here, so we can. End the task instance BEFORE killing the pythons,
# otherwise the kill counts as a task failure and RestartCount revives it.
Stop-ScheduledTask -TaskName 'MenteeBOM Prod Server' -ErrorAction SilentlyContinue
$oldPids = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'run\.py' } | ForEach-Object { $_.ProcessId })
$conn = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn -and $oldPids -notcontains $conn.OwningProcess) {
    $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.Name -match 'python') { $oldPids += $p.Id }
}
if ($oldPids.Count -gt 0) {
    Write-Host "Stopping existing server instance(s): $($oldPids -join ', ')..."
    $oldPids | ForEach-Object { Stop-Process -Id $_ -Force -Confirm:$false -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}
Write-Host 'Starting prod server via the new task...'
Start-ScheduledTask -TaskName 'MenteeBOM Prod Server'
Write-Host 'Server starting - the tray icon will turn green in ~20-60s.'

Write-Host ''
Write-Host 'Done! Summary:'
Get-ScheduledTask -TaskName 'MenteeBOM Prod Server', 'MenteeBOM Server Stop', 'MenteeBOM Tray' | Format-Table TaskName, State -AutoSize
Read-Host 'Press Enter to close'
