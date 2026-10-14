# Prod server auto-start & tray icon

The prod server (port 80, `instance/menteebom.db`) starts automatically at boot —
even if the PC restarts itself with nobody logged in — and a **system-tray icon**
shows its status and controls it.

## Components

| File | Role |
|------|------|
| `start_prod_server.bat` | Launches `.venv` python `run.py --port 80`, logs to `logs\prod_server.log` |
| `stop_prod_server.ps1` | Stops the server (run as SYSTEM by the "MenteeBOM Server Stop" task) |
| `tray_menteebom.ps1` | Tray icon: green dot = UP, red = DOWN. Right-click menu to control the server |
| `setup_autostart.ps1` | One-time setup — registers the scheduled tasks + grants the tray control rights |

## One-time setup

1. Right-click `setup_autostart.ps1` → **Run with PowerShell**
2. Accept the **UAC** prompt (admin is needed only to register the tasks)

**No password is asked for or stored.** The boot task uses Windows **S4U logon**:
it runs as **your user** (least privilege, not SYSTEM) with nobody logged in,
without saving credentials, and keeps working after you change your password.
(S4U's only limitation — no network-share access under your identity — doesn't
matter for a local server.)

This registers three tasks:

- **MenteeBOM Prod Server** — at boot + 30s, runs whether logged on or not,
  auto-restarts up to 3× on failure.
- **MenteeBOM Server Stop** — no trigger; an on-demand helper that stops the
  server as SYSTEM. Needed because the boot task's server lives in **session 0**,
  where the (non-elevated) tray icon has no kill rights.
- **MenteeBOM Tray** — at logon, shows the tray icon.

Setup also grants your user **read + run** rights on the two server tasks
(S4U/SYSTEM tasks are admin-only by default — even `schtasks /query` gets
"Access denied" — which is what used to make the tray's Stop/Restart do
nothing). The tray's Stop first *ends* the boot task via Task Scheduler, so
the kill isn't counted as a failure that the task's auto-restart would undo.

## The tray icon

- 🟢 green dot — server UP on port 80 (tooltip shows since when)
- 🔴 red dot — server DOWN (balloon notification pops when it goes down)
- Status is polled every 10 seconds.

Right-click menu: **Open MenteeBOM** · **Start server** · **Stop server** ·
**Restart server** · **View log** · **Refresh status** · **Exit tray**
(exiting the tray does *not* stop the server). Double-click opens the app.

## Manual commands

```powershell
schtasks /run /tn 'MenteeBOM Prod Server'    # start server
schtasks /run /tn 'MenteeBOM Server Stop'    # stop server (ends task + kills pythons)
Get-ScheduledTask -TaskName 'MenteeBOM*' | Get-ScheduledTaskInfo   # last run result
Get-Content logs\prod_server.log -Tail 40 -Wait          # tail the server log
```

(Don't `Stop-ScheduledTask 'MenteeBOM Prod Server'` by itself — it only kills
the launcher `cmd`, leaving the python pair running. Use the Stop task.)

## Troubleshooting

- **Server didn't start after reboot** → check `logs\prod_server.log` (a
  `==== boot start ====` banner is written on every launch attempt) and
  Task Scheduler → "MenteeBOM Prod Server" → Last Run Result (`0x0` = OK).
- **Boot task registration failed (S4U)?** Rare, mainly with Microsoft-account
  logins. Fallback: in Task Scheduler open the task → "Run whether user is logged
  on or not" → enter password (stored-credential mode), or run it as SYSTEM.
- **Port 80 conflict** → the launcher passes `--port 80` explicitly, so a conflict
  fails loudly in the log instead of silently moving to port 5000. Don't start a
  second manual instance; use the tray icon's Start/Stop instead.
- **Tray Stop/Restart does nothing?** Re-run `setup_autostart.ps1` — it
  registers the "MenteeBOM Server Stop" helper and grants the tray run rights
  on the tasks (older setups lacked both, so every tray control path was
  access-denied against the session-0 server). If it still fails, the server
  may have been started **as Administrator** from another terminal — close
  that window or re-run setup, which takes over. Avoid starting the server
  from admin terminals; it never needs elevation.
- **Closed the tray icon by accident?** Double-click `launch_tray.bat` (or run
  `Start-ScheduledTask -TaskName 'MenteeBOM Tray'`). It also comes back
  automatically at the next logon. The tray is single-instance — running the
  launcher twice never creates two icons.

## See also

- `docs/BACKUP_SETUP.md` — nightly off-machine backup task ("MenteeBOM Offsite
  Backup", 02:30, registered by `setup_backup_task.ps1`), the restore drill and
  the firewall rule (`setup_firewall.ps1`).
