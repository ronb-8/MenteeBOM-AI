# ============================================================
#  MenteeBOM off-machine backup - scheduled task setup
#  (run ONCE, self-elevating; safe to re-run, it updates in place)
#
#  Registers two scheduled tasks, both running as your user via
#  S4U logon = "run whether user is logged on or not" WITHOUT
#  storing a password (same mechanism as the prod server task):
#    1. "MenteeBOM Offsite Backup" - daily 02:30 (after the app's
#       own 02:00 backup): scripts\backup_offsite.py
#       -> G:\Shared drives\MenteeBOM backups (or the D: fallback
#       when the Drive volume is not mounted, exit code 2).
#       If the PC was off at 02:30 it runs at the next boot.
#    2. "MenteeBOM Backup Verify" - Sundays 03:30: --verify, i.e.
#       an automatic restore drill of the newest archive.
#  Results: logs\backup_offsite.log, Task Scheduler "Last Run
#  Result" (0 = ok, 2 = written to fallback, 1 = failed) and a
#  BACKUP_OFFSITE line in the admin panel log viewer.
#
#  Usage: right-click this file -> "Run with PowerShell" and
#         accept the UAC prompt.
#  See docs\BACKUP_SETUP.md.
# ============================================================

param(
    [string]$TargetUser = "$env:USERDOMAIN\$env:USERNAME",
    [string]$BackupTime = '02:30',
    [string]$VerifyTime = '03:30'
)

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $AppDir '.venv\Scripts\python.exe'
$Script = Join-Path $AppDir 'scripts\backup_offsite.py'

# --- self-elevate --------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Requesting administrator elevation (needed only to register the tasks)...'
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$($MyInvocation.MyCommand.Path)`"",
        '-TargetUser', "`"$TargetUser`"", '-BackupTime', $BackupTime, '-VerifyTime', $VerifyTime
    )
    exit
}

Write-Host '============================================='
Write-Host ' MenteeBOM off-machine backup task setup'
Write-Host '============================================='
Write-Host "App directory : $AppDir"
Write-Host "Python        : $Python"
Write-Host "Task user     : $TargetUser (S4U - no password stored)"
Write-Host ''

if (-not (Test-Path $Python)) { Write-Host "FAILED: $Python not found (create the .venv first)."; Read-Host 'Press Enter to close'; exit 1 }
if (-not (Test-Path $Script)) { Write-Host "FAILED: $Script not found."; Read-Host 'Press Enter to close'; exit 1 }

$principal = New-ScheduledTaskPrincipal -UserId $TargetUser -LogonType S4U -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$tasks = @(
    @{ Name = 'MenteeBOM Offsite Backup'
       Args = "`"$Script`""
       Trigger = New-ScheduledTaskTrigger -Daily -At $BackupTime
       Desc = "Nightly consistent snapshot of instance\menteebom.db + thumbnails/uploads to the MenteeBOM backups shared drive (fallback D:\MenteeBOM backups). Log: logs\backup_offsite.log" },
    @{ Name = 'MenteeBOM Backup Verify'
       Args = "`"$Script`" --verify"
       Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $VerifyTime
       Desc = 'Weekly automatic restore drill: extracts the newest offsite archive, integrity check + row counts vs manifest. Non-zero result = drill failed.' }
)

foreach ($t in $tasks) {
    Write-Host "Registering task: $($t.Name)..."
    $action = New-ScheduledTaskAction -Execute $Python -Argument $t.Args -WorkingDirectory $AppDir
    try {
        Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $t.Trigger `
            -Principal $principal -Settings $settings -Description $t.Desc -Force -ErrorAction Stop | Out-Null
        Write-Host '  OK'
    } catch {
        Write-Host "  FAILED: $($_.Exception.Message)"
        Write-Host '  If S4U is refused for this account, register with a stored password instead:'
        Write-Host "    schtasks /Create /TN `"$($t.Name)`" /SC DAILY /ST $BackupTime /RU `"$TargetUser`" /RP * /RL LIMITED /F /TR `"\`"$Python\`" \`"$Script\`"`""
        Read-Host 'Press Enter to close'; exit 1
    }
}

# --- let the (non-admin) user read/run the tasks -----------------
# S4U tasks are admin-only by default (even 'Get-ScheduledTaskInfo' is denied);
# grant the user read+execute like setup_autostart.ps1 does for the server tasks.
try {
    $sid  = ([System.Security.Principal.NTAccount]$TargetUser).Translate([System.Security.Principal.SecurityIdentifier]).Value
    $sddl = "D:(A;;FA;;;BA)(A;;FA;;;SY)(A;;GRGX;;;$sid)"
    $svc = New-Object -ComObject 'Schedule.Service'; $svc.Connect()
    $root = $svc.GetFolder('\')
    foreach ($t in $tasks) { $root.GetTask($t.Name).SetSecurityDescriptor($sddl, 0) }
    Write-Host "Granted $TargetUser run/read rights on both tasks."
} catch {
    Write-Host "  (could not grant task rights: $($_.Exception.Message))"
}

Write-Host ''
Write-Host 'Done! Summary:'
Get-ScheduledTask -TaskName 'MenteeBOM Offsite Backup', 'MenteeBOM Backup Verify' | Format-Table TaskName, State -AutoSize
Write-Host "Next: run the backup once by hand to check it reaches the shared drive:"
Write-Host "  Start-ScheduledTask -TaskName 'MenteeBOM Offsite Backup'; Get-Content '$AppDir\logs\backup_offsite.log' -Tail 3"
if ($Host.Name -eq 'ConsoleHost' -and -not $env:MENTEEBOM_SETUP_NOPAUSE) { Read-Host 'Press Enter to close' }
