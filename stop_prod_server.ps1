# ============================================================
#  MenteeBOM prod server stopper
#  Runs as SYSTEM via the on-demand "MenteeBOM Server Stop"
#  scheduled task, so the (non-elevated) tray icon can stop a
#  server that lives in session 0 (started by the boot task) -
#  a normal process has no kill rights there. See AUTOSTART.md.
# ============================================================

$ErrorActionPreference = 'SilentlyContinue'

# 1) End the boot task instance FIRST. Killing the pythons while the task is
#    still "running" makes it exit non-zero, and the task's restart-on-failure
#    (RestartCount 3) would resurrect the server a minute later. Ending it via
#    Task Scheduler records "terminated by user" instead, which never restarts.
$null = schtasks.exe /end /tn 'MenteeBOM Prod Server' 2>&1

# 2) Kill the server pythons. The Flask reloader is a parent+child pair, and
#    the parent respawns the child instantly if only the child dies - so do
#    two passes and take the parent too. Scope: session-0 run.py pythons (the
#    boot task) plus whatever python owns port 80 (tray fallback / manual
#    start). Deliberately NOT "every run.py python": a dev server running in
#    the user's session on port 5000 must survive a prod stop.
foreach ($pass in 1, 2) {
    $pids = New-Object System.Collections.Generic.HashSet[int]

    Get-CimInstance Win32_Process -Filter "Name='python.exe' AND SessionId=0" |
        Where-Object { $_.CommandLine -match 'run\.py' } |
        ForEach-Object { [void]$pids.Add([int]$_.ProcessId) }

    $conn = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
        if ($owner -and $owner.Name -match 'python') {
            [void]$pids.Add([int]$owner.ProcessId)
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.ParentProcessId)"
            if ($parent -and $parent.Name -match 'python' -and $parent.CommandLine -match 'run\.py') {
                [void]$pids.Add([int]$parent.ProcessId)
            }
        }
    }

    if ($pids.Count -eq 0) { break }
    foreach ($p in $pids) { Stop-Process -Id $p -Force -Confirm:$false }
    Start-Sleep -Milliseconds 700
}
