#!/usr/bin/env python3
"""Consistent off-machine backup of the MenteeBOM database and files.

Why this exists: the built-in nightly backup (utils/scheduler.py) is a plain file copy of a live WAL-mode
SQLite database, stored on the same disk as the database. This script uses SQLite's online backup API
(safe while the app runs), checks integrity, and writes the archive to an off-machine folder such as a
Google Drive for Desktop shared drive or a NAS share. It never modifies the live database.

Usage (from the repo root, with the same Python the app uses):
    python scripts/backup_offsite.py                       # -> G:\\Shared drives\\MenteeBOM backups
    python scripts/backup_offsite.py --dest "\\\\nas\\menteebom-backups"
    python scripts/backup_offsite.py --verify              # restore drill on the newest archive
Environment variables MENTEEBOM_BACKUP_DEST / MENTEEBOM_BACKUP_FALLBACK override the defaults.

Fallback: the Drive for Desktop volume (G:) only exists while the Google Drive client is running, i.e.
while somebody is logged in. When the destination is unreachable the archive is written to the local
fallback folder (default D:\\MenteeBOM backups) and the script exits with code 2 so Task Scheduler shows
it. The next run that can reach the destination first copies over every archive that only exists in the
fallback folder ("catch-up"), then takes a fresh backup.

Archive contents: menteebom.db (consistent snapshot), pdm_settings.json, instance/thumbnails/,
instance/uploads/, manifest.json (row counts for verification). Secrets (.env,
google_sheets/credentials.json) are deliberately NOT included; they live in the team vault
(see docs/BACKUP_SETUP.md).
Retention: last 30 archives plus the first archive of each month for 12 months, applied to the
destination and the fallback folder.
Logging: logs/backup_offsite.log in the repo, plus one BACKUP_OFFSITE line in the app's daily log so it
shows up in the admin log viewer.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import shutil
import sqlite3
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "instance" / "menteebom.db"
FILES = ["pdm_settings.json"]
FOLDERS = ["instance/thumbnails", "instance/uploads"]
KEEP_DAILY, KEEP_MONTHLY = 30, 12
COUNT_TABLES = ["part", "bom_instance", "bom_part", "po", "po_item", "po_qc_item", "rfq", "user"]
ARCHIVE_GLOB = "menteebom_????????_????.zip"
DEFAULT_DEST = r"G:\Shared drives\MenteeBOM backups"
DEFAULT_FALLBACK = r"D:\MenteeBOM backups"
LOG_FILE = ROOT / "logs" / "backup_offsite.log"

EXIT_OK, EXIT_FAILED, EXIT_FALLBACK = 0, 1, 2


def log(msg: str) -> None:
    line = f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass
    if sys.stdout:
        try:
            print(line, flush=True)
        except OSError:
            pass


def app_log(action: str, details: str) -> None:
    """One line in the app's own daily log (admin panel log viewer). Never fails the backup."""
    try:
        sys.path.insert(0, str(ROOT))
        from utils.logger import log_action  # writes ~/Documents/MenteeBOM Data/logs/menteebom_YYYY-MM-DD.log
        log_action(action, {"username": "system", "role": "system"}, details)
    except Exception as exc:  # noqa: BLE001 - logging must never break the backup
        log(f"app log unavailable: {exc}")


def snapshot(db_path: pathlib.Path, out: pathlib.Path) -> None:
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    dst = sqlite3.connect(out)
    try:
        src.backup(dst)   # online backup API: consistent even while the app writes
    finally:
        dst.close()
        src.close()


def integrity(db_file: pathlib.Path) -> str:
    con = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
    try:
        return con.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        con.close()


def counts(db_file: pathlib.Path) -> dict:
    con = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
    try:
        out = {}
        for t in COUNT_TABLES:
            try:
                out[t] = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            except sqlite3.Error:
                out[t] = None
        return out
    finally:
        con.close()


def reachable(folder: pathlib.Path) -> bool:
    """True when the folder's drive/share is present and the folder exists or can be created."""
    anchor = pathlib.Path(folder.anchor) if folder.anchor else folder
    if not anchor.exists():
        return False
    try:
        folder.mkdir(parents=True, exist_ok=True)
        return folder.is_dir()
    except OSError:
        return False


def make_backup(dest: pathlib.Path) -> tuple[pathlib.Path, dict]:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"database not found: {DB_PATH}")
    dest.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M")
    out = dest / f"menteebom_{stamp}.zip"
    with tempfile.TemporaryDirectory() as tmp:
        snap = pathlib.Path(tmp) / "menteebom.db"
        snapshot(DB_PATH, snap)
        result = integrity(snap)
        if result != "ok":
            raise RuntimeError(f"integrity_check failed on snapshot: {result}")
        manifest = {"created_at": dt.datetime.now().isoformat(), "source_db": str(DB_PATH), "counts": counts(snap),
                    "db_bytes": snap.stat().st_size, "host": os.environ.get("COMPUTERNAME") or os.uname().nodename}
        tmp_zip = out.with_suffix(".part")
        with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(snap, "menteebom.db")
            for rel in FILES:
                p = ROOT / rel
                if p.exists():
                    z.write(p, rel)
            for folder in FOLDERS:
                base = ROOT / folder
                if base.exists():
                    for p in base.rglob("*"):
                        if p.is_file():
                            z.write(p, str(p.relative_to(ROOT)))
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
        tmp_zip.replace(out)   # atomic: a half-written archive never carries the final name
    log(f"backup written: {out} ({out.stat().st_size // 1024} KB) counts={manifest['counts']}")
    return out, manifest


def catch_up(fallback: pathlib.Path, dest: pathlib.Path) -> int:
    """Copy archives that exist only in the fallback folder to the destination."""
    if not fallback.is_dir():
        return 0
    have = {p.name for p in dest.glob(ARCHIVE_GLOB)}
    moved = 0
    for src in sorted(fallback.glob(ARCHIVE_GLOB)):
        if src.name in have:
            continue
        tmp = dest / (src.name + ".part")
        shutil.copyfile(src, tmp)
        tmp.replace(dest / src.name)
        moved += 1
        log(f"catch-up: copied {src.name} from fallback to {dest}")
    return moved


def apply_retention(folder: pathlib.Path) -> None:
    if not folder.is_dir():
        return
    archives = sorted(folder.glob(ARCHIVE_GLOB))
    monthly_kept: dict[str, pathlib.Path] = {}
    for a in archives:                       # first archive of each month is the monthly copy
        month = a.name[10:16]
        monthly_kept.setdefault(month, a)
    monthly = set(list(monthly_kept.values())[-KEEP_MONTHLY:])
    for a in archives[:-KEEP_DAILY]:
        if a not in monthly:
            a.unlink()
            log(f"retention: removed {a}")


def verify_latest(folder: pathlib.Path) -> None:
    archives = sorted(folder.glob(ARCHIVE_GLOB))
    if not archives:
        raise FileNotFoundError(f"no archives to verify in {folder}")
    latest = archives[-1]
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(latest) as z:
        z.extract("menteebom.db", tmp)
        manifest = json.loads(z.read("manifest.json"))
        db_file = pathlib.Path(tmp) / "menteebom.db"
        result = integrity(db_file)
        now = counts(db_file)
        ok = result == "ok" and now == manifest["counts"]
        log(f"verify {latest.name}: integrity={result} counts_match={now == manifest['counts']} counts={now}")
        if not ok:
            raise RuntimeError(f"RESTORE DRILL FAILED on {latest.name}")
    log("restore drill passed: the archive restores to a consistent database with the recorded row counts")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=os.environ.get("MENTEEBOM_BACKUP_DEST", DEFAULT_DEST),
                    help=f"off-machine folder (Drive for Desktop / NAS); default {DEFAULT_DEST}")
    ap.add_argument("--fallback", default=os.environ.get("MENTEEBOM_BACKUP_FALLBACK", DEFAULT_FALLBACK),
                    help=f"local folder used when --dest is unreachable; default {DEFAULT_FALLBACK}")
    ap.add_argument("--verify", action="store_true", help="restore drill on the newest archive instead of backing up")
    a = ap.parse_args()
    dest, fallback = pathlib.Path(a.dest), pathlib.Path(a.fallback)

    if a.verify:
        try:
            verify_latest(dest if reachable(dest) else fallback)
            app_log("BACKUP_OFFSITE_VERIFY", "restore drill passed")
            return EXIT_OK
        except Exception as exc:  # noqa: BLE001
            log(f"VERIFY FAILED: {exc}")
            app_log("BACKUP_OFFSITE_FAILED", f"restore drill failed: {exc}")
            return EXIT_FAILED

    try:
        if reachable(dest):
            moved = catch_up(fallback, dest)
            out, manifest = make_backup(dest)
            apply_retention(dest)
            apply_retention(fallback)
            app_log("BACKUP_OFFSITE", f"{out.name} -> {dest} ({out.stat().st_size // 1024} KB, "
                                      f"catch-up {moved}) counts={manifest['counts']}")
            return EXIT_OK
        if not reachable(fallback):
            raise RuntimeError(f"neither destination {dest} nor fallback {fallback} is reachable")
        out, manifest = make_backup(fallback)
        apply_retention(fallback)
        log(f"WARNING: offsite destination {dest} unavailable; archive kept locally in {fallback}")
        app_log("BACKUP_OFFSITE_FALLBACK", f"{out.name} -> {fallback} (offsite {dest} unavailable) "
                                           f"counts={manifest['counts']}")
        return EXIT_FALLBACK
    except Exception as exc:  # noqa: BLE001
        log(f"BACKUP FAILED: {exc}")
        app_log("BACKUP_OFFSITE_FAILED", str(exc))
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
