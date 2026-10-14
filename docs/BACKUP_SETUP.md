# Off-machine backups, restore drill and hardening (production PC)

Everything MenteeBOM knows lives on one PC: the live `instance/menteebom.db`, ~110 MB of thumbnails and
quotation PDFs in `instance/`, and the app's own 02:00 zips in `~/Documents/MenteeBOM Data/backups`
(same disk, plain file copy). This document covers the nightly off-machine copy, how to restore it,
and the cheap hardening that goes with it.

## 1. What runs, when

| Task (Task Scheduler)        | When                 | Command                                  | Result |
|------------------------------|----------------------|------------------------------------------|--------|
| app scheduler (`utils/scheduler.py`) | 02:00 daily | built-in zip to `~/Documents/MenteeBOM Data/backups` | same disk, last 30 kept |
| **MenteeBOM Offsite Backup** | **02:30 daily**      | `.venv\Scripts\python.exe scripts\backup_offsite.py` | zip on `G:\Shared drives\MenteeBOM backups` |
| **MenteeBOM Backup Verify**  | Sundays 03:30        | `... scripts\backup_offsite.py --verify` | automatic restore drill of the newest archive |

Both tasks run as the `mechanical` account with S4U logon ("run whether user is logged on or not",
no password stored), start in the repo folder, and run at the next boot if the PC was off at 02:30.
They are registered by **`setup_backup_task.ps1`** (right-click, Run with PowerShell, accept UAC).

**Where to look:** `logs\backup_offsite.log` in the repo, the task's *Last Run Result*
(`0` ok, `2` written to the local fallback, `1` failed), and the admin panel log viewer
(`BACKUP_OFFSITE`, `BACKUP_OFFSITE_FALLBACK`, `BACKUP_OFFSITE_FAILED`, `BACKUP_OFFSITE_VERIFY`).

### The G: fallback
`G:` is the Google Drive for Desktop volume. It only exists while the Drive client is running, i.e.
while somebody is logged in. When `G:` is missing the script writes the archive to
`D:\MenteeBOM backups` instead and exits with code 2. The next run that can see `G:` first copies every
archive that only exists on `D:` to the shared drive ("catch-up"), then takes a fresh backup. If the
task keeps ending with result 2, log in to the PC once so Drive mounts, or leave a user session logged
in (locked) overnight.

## 2. What is in the archive, what is not

`menteebom_YYYYMMDD_HHMM.zip` contains:
- `menteebom.db` – consistent snapshot taken with SQLite's online backup API (safe while the app runs),
  integrity-checked before it is zipped
- `pdm_settings.json`
- `instance/thumbnails/`, `instance/uploads/` (quotation PDFs)
- `manifest.json` – creation time, host, DB size and **row counts** of part, bom_instance, bom_part, po,
  po_item, po_qc_item, rfq, user. The restore drill compares against these.

**Never in any backup** (neither this one nor the app's own 02:00 zip since PR "offsite backup"):
- `.env` (`GEMINI_API_KEY`, `SECRET_KEY`, `MENTEEBOM_LEDGER_READ_KEY`)
- `google_sheets/credentials.json`

Those two files live in the **vault**: the restricted Google Workspace folder
`MenteeBOM backups / vault` (separate access list: Ron, Lior, Guy). Restore them by hand.
Zips in `~/Documents/MenteeBOM Data/backups` created before 2026-09-29 still contain a `.env`; the
values in zips older than 2026-09-14 were revoked, newer ones never left this PC.

## 3. Retention

Last **30 daily** archives plus the **first archive of each month for 12 months**, applied to the
shared drive and to the `D:` fallback after every run. Nothing else is deleted: the manual
`Menteebom-backup-2026-09-10.zip` on the shared drive is untouched because it does not match the
`menteebom_*.zip` pattern.

## 4. Restore drill — mandatory, ~1 hour, every quarter

Do this on **another Windows laptop** (not the prod PC). Put a recurring quarterly event in the
calendar for it (January, April, July, October).

1. `git clone https://github.com/RonEliezer/MenteeBOM-Web.git` and `cd MenteeBOM-Web`
2. `python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt`
3. `cd frontend && npm install && npm run build && cd ..` (the built frontend is not in git)
4. Take the newest `menteebom_*.zip` from `G:\Shared drives\MenteeBOM backups` and unzip it.
   Copy `menteebom.db`, `instance\thumbnails\`, `instance\uploads\` into `instance\`
   and `pdm_settings.json` into the repo root.
5. Recreate `.env` and `google_sheets\credentials.json` from the vault.
6. `python run.py --port 5001` (no `--dev`: that flag would use a different database file).
7. Log in, open the **parts list** and **one PO**; compare the row counts you see with
   `manifest.json` from the archive.
8. Write the result into the vault folder as `restore-drill-YYYY-MM-DD.md` using this template and
   stop the laptop server afterwards:

```
Restore drill — YYYY-MM-DD
Archive:            menteebom_YYYYMMDD_HHMM.zip (size)
Laptop / OS:        
Time taken:         min
Steps that failed:  (none / what and how fixed)
Counts vs manifest: parts ____ / ____   POs ____ / ____   match: yes/no
Login OK / parts list OK / PO opens OK:  yes/no
Next drill:         YYYY-MM-DD
```

PDM import needs a Windows machine with the PDM client; everything else runs on any Windows laptop.
The weekly automatic `--verify` task is a smoke test only (integrity + counts); it does not replace
the quarterly drill on separate hardware.

## 5. Manual use

```powershell
cd "C:\Users\mechanical\Documents\MenteeBOM software\MenteeBOM-Web"
.venv\Scripts\python.exe scripts\backup_offsite.py            # backup now
.venv\Scripts\python.exe scripts\backup_offsite.py --verify   # restore drill on the newest archive
.venv\Scripts\python.exe scripts\backup_offsite.py --dest "\\nas\menteebom-backups"   # other target
Start-ScheduledTask -TaskName 'MenteeBOM Offsite Backup'      # run the task itself
```
`MENTEEBOM_BACKUP_DEST` / `MENTEEBOM_BACKUP_FALLBACK` environment variables override the defaults.

## 6. Hardening that costs nothing — status

| Item | Status |
|------|--------|
| Rotate `GEMINI_API_KEY` and `SECRET_KEY`, remove `.env` from git | done 2026-09-14 (old Gemini key revoked, `.env` untracked in ce65cfa, `.env.example` added) |
| Run with `debug=False` | already the case: debug only when `FLASK_DEBUG=1` (`run.py`, `app.py`); prod never sets it |
| Change the five default passwords | done: no prod account matches any default password (checked 2026-09-28) |
| Remove seeding of defaults on startup | done in this PR: `app.py` / `run.py` no longer create `admin/admin123` and friends; first admin via `python scripts\create_admin.py` (also used by `init_database.py`, `reset_database.py`) |
| Keep secrets out of backups | done in this PR: `.env` removed from the built-in backup and from restore; offsite archive never had it |
| Firewall: ports 80/5000 only from the office networks | `setup_firewall.ps1` (right-click, Run with PowerShell). Allows `192.168.30.0/24`, `192.168.31.0/24`, `192.168.40.0/24` and the VPN pool `10.212.134.0/24`, blocks everything else on TCP 80/5000, disables the two broad `python.exe` rules. If a new network appears, look at the client IPs in `logs\prod_server.log` and re-run with `-Subnet a,b,c`; `-Undo` reverts everything |
