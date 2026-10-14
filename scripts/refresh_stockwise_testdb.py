"""Refresh the StockWise test database from the production database.

Creates/overwrites instance/menteebom_stockwise_test.db as a consistent snapshot
of instance/menteebom.db (safe while the production server is running — uses the
SQLite online-backup API), and records snapshot metadata that the test server
reports in /api/stockwise/v1/ping.

Usage (from the repo root):
    python scripts/refresh_stockwise_testdb.py

Then serve it with:
    python run.py --stockwise-test        (port 5001 by default)
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTANCE_DIR = os.path.join(REPO_ROOT, 'instance')
PROD_DB = os.path.join(INSTANCE_DIR, 'menteebom.db')
TEST_DB = os.path.join(INSTANCE_DIR, 'menteebom_stockwise_test.db')
META_FILE = os.path.join(INSTANCE_DIR, 'stockwise_test_snapshot.json')


def main():
    if not os.path.exists(PROD_DB):
        print(f"ERROR: production database not found at {PROD_DB}")
        sys.exit(1)

    print(f"Snapshotting {PROD_DB}\n         -> {TEST_DB}")
    src = sqlite3.connect(PROD_DB)
    # Remove stale WAL sidecars from a previous snapshot before overwriting
    for suffix in ('', '-wal', '-shm'):
        try:
            os.remove(TEST_DB + suffix)
        except OSError:
            pass
    dst = sqlite3.connect(TEST_DB)
    with dst:
        src.backup(dst)  # online backup: consistent even if prod is live
    src.close()

    cur = dst.cursor()
    counts = {
        'items': cur.execute("SELECT COUNT(*) FROM part").fetchone()[0],
        'items_with_image': cur.execute(
            "SELECT COUNT(*) FROM part WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ''"
        ).fetchone()[0],
        'bom_instances': cur.execute("SELECT COUNT(*) FROM bom_instance").fetchone()[0],
        'bom_links': cur.execute("SELECT COUNT(*) FROM bom_part").fetchone()[0],
    }
    dst.close()

    meta = {
        'snapshot_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'menteebom.db (production)',
        **counts,
    }
    with open(META_FILE, 'w') as f:
        json.dump(meta, f, indent=2)

    print(json.dumps(meta, indent=2))
    print("Done. Start the test server with: python run.py --stockwise-test")


if __name__ == '__main__':
    main()
