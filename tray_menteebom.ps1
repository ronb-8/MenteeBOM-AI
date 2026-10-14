# ============================================================
#  MenteeBOM system tray controller
#  Shows a green/red dot for prod server status (port 80) and a
#  right-click menu: Open app / Start / Stop / Restart / View log.
#  Launched at logon by the "MenteeBOM Tray" scheduled task.
#  See AUTOSTART.md.
# ============================================================

$ErrorActionPreference = 'SilentlyContinue'

# --- single-instance guard -----------------------------------
$script:mutex = New-Object System.Threading.Mutex($false, 'Local\MenteeBOMTrayMutex')
if (-not $script:mutex.WaitOne(0, $false)) { exit }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:AppDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:LogFile  = Join-Path $script:AppDir 'logs\prod_server.log'
$script:TaskName = 'MenteeBOM Prod Server'
$script:StopTask = 'MenteeBOM Server Stop'
$script:Url      = 'http://localhost/'

# --- icons: colored dot drawn in code (no .ico files) --------
function New-DotIcon([System.Drawing.Color]$color) {
    $bmp = New-Object System.Drawing.Bitmap 16, 16
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $brush = New-Object System.Drawing.SolidBrush $color
    $g.FillEllipse($brush, 1, 1, 14, 14)
    $brush.Dispose(); $g.Dispose()
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $bmp.Dispose()
    return $icon
}
$script:IconUp   = New-DotIcon ([System.Drawing.Color]::FromArgb(46, 204, 64))
$script:IconDown = New-DotIcon ([System.Drawing.Color]::FromArgb(220, 53, 53))
$script:IconWait = New-DotIcon ([System.Drawing.Color]::FromArgb(160, 160, 160))

# --- health checks -------------------------------------------
function Test-Server {
    # True if anything answers HTTP on port 80 (any status code counts:
    # a 401/redirect still means the Flask app is alive).
    try {
        $req = [System.Net.WebRequest]::Create($script:Url)
        $req.Timeout = 3000
        $req.Method = 'GET'
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { return $true }
        return $false
    } catch { return $false }
}

function Get-ServerProcess {
    try {
        $conn = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction Stop | Select-Object -First 1
        if ($conn) { return (Get-Process -Id $conn.OwningProcess -ErrorAction Stop) }
    } catch {}
    return $null
}

# --- tray icon + menu ----------------------------------------
$script:Notify = New-Object System.Windows.Forms.NotifyIcon
$script:Notify.Icon = $script:IconWait
$script:Notify.Text = 'MenteeBOM: checking...'
$script:Notify.Visible = $true

$script:LastState = 'unknown'   # 'up' | 'down' | 'unknown'

function Update-Status {
    $up = Test-Server
    if ($up) {
        $script:Notify.Icon = $script:IconUp
        $since = ''
        $proc = Get-ServerProcess
        # StartTime throws Access Denied for the session-0 server (boot task);
        # the tray must not crash over a tooltip nicety.
        if ($proc) { try { if ($proc.StartTime) { $since = ' since ' + $proc.StartTime.ToString('HH:mm') } } catch {} }
        # NotifyIcon.Text max 63 chars
        $script:Notify.Text = ("MenteeBOM prod: UP on port 80$since").Substring(0, [Math]::Min(63, ("MenteeBOM prod: UP on port 80$since").Length))
        if ($script:LastState -ne 'up') {
            $script:Notify.ShowBalloonTip(4000, 'MenteeBOM server', "Prod server is UP on port 80$since", [System.Windows.Forms.ToolTipIcon]::Info)
        }
        $script:LastState = 'up'
    } else {
        $script:Notify.Icon = $script:IconDown
        $script:Notify.Text = 'MenteeBOM prod: DOWN'
        if ($script:LastState -eq 'up') {
            $script:Notify.ShowBalloonTip(6000, 'MenteeBOM server', 'Prod server went DOWN. Right-click the tray icon to restart or view the log.', [System.Windows.Forms.ToolTipIcon]::Error)
        } elseif ($script:LastState -eq 'unknown') {
            $script:Notify.ShowBalloonTip(6000, 'MenteeBOM server', 'Prod server is NOT running.', [System.Windows.Forms.ToolTipIcon]::Warning)
        }
        $script:LastState = 'down'
    }
}

function Stop-ServerNow {
    # Returns $true once the server is confirmed down.
    if (-not (Get-ServerProcess)) {
        $script:Notify.ShowBalloonTip(4000, 'MenteeBOM server', 'Server is not running.', [System.Windows.Forms.ToolTipIcon]::Info)
        return $true
    }
    $script:Notify.Icon = $script:IconWait
    $script:Notify.Text = 'MenteeBOM: stopping server...'

    # Preferred path: the "MenteeBOM Server Stop" helper task (SYSTEM), which
    # setup_autostart.ps1 registers and grants us run rights on. The boot
    # task's server lives in session 0 where this (non-elevated) tray has no
    # kill rights, and the helper also ends the boot task first so its
    # restart-on-failure doesn't resurrect the server a minute later.
    $null = schtasks.exe /run /tn $script:StopTask 2>&1
    if ($LASTEXITCODE -ne 0) {
        # Helper missing or no rights (setup_autostart.ps1 not re-run since it
        # was added) -> best effort from this session. This only reaches
        # servers started here (tray fallback / manual, non-admin).
        $null = schtasks.exe /end /tn $script:TaskName 2>&1
        Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
            Where-Object { $_.CommandLine -match 'run\.py' } |
            ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
        $proc = Get-ServerProcess
        if ($proc -and $proc.Name -match 'python') {
            try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {}
        }
    }

    # Wait for port 80 to actually free (helper task spin-up + kill takes a moment)
    for ($i = 0; $i -lt 40 -and (Get-ServerProcess); $i++) { Start-Sleep -Milliseconds 500 }

    if (Get-ServerProcess) {
        $script:Notify.ShowBalloonTip(8000, 'MenteeBOM server',
            'Could not stop the server - the tray has no rights to reach it. Run setup_autostart.ps1 once (UAC prompt): it registers the stop helper and grants the tray control.',
            [System.Windows.Forms.ToolTipIcon]::Error)
        return $false
    }
    $script:LastState = 'down'   # intentional stop: skip the "went DOWN" alarm
    $script:Notify.ShowBalloonTip(4000, 'MenteeBOM server', 'Server stopped.', [System.Windows.Forms.ToolTipIcon]::Info)
    return $true
}

function Start-ServerNow {
    if (Get-ServerProcess) {
        $script:Notify.ShowBalloonTip(4000, 'MenteeBOM server', 'Server is already running on port 80.', [System.Windows.Forms.ToolTipIcon]::Info)
        return
    }
    # schtasks (not Start-ScheduledTask): reliable exit code, and it works once
    # setup_autostart.ps1 has granted us run rights on the S4U task.
    $null = schtasks.exe /run /tn $script:TaskName 2>&1
    if ($LASTEXITCODE -eq 0) {
        $script:Notify.ShowBalloonTip(4000, 'MenteeBOM server', 'Starting prod server... (takes ~20-60s)', [System.Windows.Forms.ToolTipIcon]::Info)
        return
    }
    # Fallback: boot task not registered or no run rights on it yet
    # (setup_autostart.ps1 not completed) -> launch the server directly.
    # It survives tray exit but NOT a reboot.
    # run_hidden.vbs guarantees no console window (even with Windows Terminal
    # as the default terminal app).
    Start-Process -FilePath 'wscript.exe' -WorkingDirectory $script:AppDir -ArgumentList @(
        (Join-Path $script:AppDir 'run_hidden.vbs'), 'cmd.exe', '/c',
        (Join-Path $script:AppDir 'start_prod_server.bat')
    )
    $script:Notify.ShowBalloonTip(6000, 'MenteeBOM server', 'Starting prod server directly (takes ~20-60s). Note: boot task not set up yet - run setup_autostart.ps1 so it survives reboots.', [System.Windows.Forms.ToolTipIcon]::Info)
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miOpen = $menu.Items.Add('Open MenteeBOM')
$miOpen.Add_Click({ Start-Process $script:Url })

$menu.Items.Add('-') | Out-Null

$miStart = $menu.Items.Add('Start server')
$miStart.Add_Click({ Start-ServerNow })

$miStop = $menu.Items.Add('Stop server')
$miStop.Add_Click({
    $null = Stop-ServerNow
    Update-Status
})

$miRestart = $menu.Items.Add('Restart server')
$miRestart.Add_Click({
    if (Stop-ServerNow) {
        Start-Sleep -Milliseconds 500
        Start-ServerNow
    }
    Update-Status
})

$menu.Items.Add('-') | Out-Null

$miLog = $menu.Items.Add('View log')
$miLog.Add_Click({
    if (Test-Path $script:LogFile) { Start-Process notepad.exe $script:LogFile }
    else { $script:Notify.ShowBalloonTip(4000, 'MenteeBOM server', 'No log file yet (server never started via the task).', [System.Windows.Forms.ToolTipIcon]::Warning) }
})

$miConsole = $menu.Items.Add('Live console (server output)')
$miConsole.Add_Click({
    if (Test-Path $script:LogFile) {
        # Opens a live tail of the server log in its own window.
        # Closing that window does NOT stop the server.
        $cmd = "`$Host.UI.RawUI.WindowTitle = 'MenteeBOM prod server - live output (close anytime, server keeps running)'; Get-Content -LiteralPath '$($script:LogFile)' -Tail 50 -Wait"
        Start-Process powershell.exe -ArgumentList @('-NoProfile', '-NoExit', '-Command', $cmd)
    } else {
        $script:Notify.ShowBalloonTip(4000, 'MenteeBOM server', 'No log file yet - start the server via the tray first.', [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

$miRefresh = $menu.Items.Add('Refresh status now')
$miRefresh.Add_Click({ Update-Status })

$menu.Items.Add('-') | Out-Null

$miExit = $menu.Items.Add('Exit tray (server keeps running)')
$miExit.Add_Click({
    $script:Timer.Stop()
    $script:Notify.Visible = $false
    $script:Notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$script:Notify.ContextMenuStrip = $menu
$script:Notify.Add_DoubleClick({ Start-Process $script:Url })

# --- poll every 10s ------------------------------------------
$script:Timer = New-Object System.Windows.Forms.Timer
$script:Timer.Interval = 10000
$script:Timer.Add_Tick({ Update-Status })
$script:Timer.Start()

Update-Status

$appContext = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($appContext)

$script:mutex.ReleaseMutex()
