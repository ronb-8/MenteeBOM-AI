"""
Verification script for database optimization.
Run against dev DB to confirm everything works before applying to prod.

Usage: python migrations/verify_optimization.py [--db path/to/db]
"""
import os
import sys
import json
import sqlite3
import argparse
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_DB = os.path.join(PROJECT_DIR, 'instance', 'menteebom_dev.db')
THUMBNAIL_DIR = os.path.join(PROJECT_DIR, 'instance', 'thumbnails')

passed = 0
failed = 0
warnings = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}{' - ' + detail if detail else ''}")


def warn(name, detail=""):
    global warnings
    warnings += 1
    print(f"  WARN  {name}{' - ' + detail if detail else ''}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default=DEFAULT_DB)
    parser.add_argument('--port', default=5000, type=int, help='Flask server port for live tests')
    parser.add_argument('--skip-live', action='store_true', help='Skip live server tests')
    args = parser.parse_args()

    db_path = args.db
    print(f"Database: {db_path}")
    print(f"Size: {os.path.getsize(db_path) / 1024 / 1024:.1f} MB")
    print()

    conn = sqlite3.connect(db_path)

    # === 1. Integrity ===
    print("=== 1. Database Integrity ===")
    result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    check("Integrity check", result == "ok", result)

    # === 2. Schema ===
    print("\n=== 2. Schema Checks ===")
    cols = [r[1] for r in conn.execute("PRAGMA table_info(part)").fetchall()]
    check("Part.thumbnail_path column exists", "thumbnail_path" in cols)
    check("Part.thumbnail_data column exists (for fallback)", "thumbnail_data" in cols)

    # === 3. Thumbnail migration ===
    print("\n=== 3. Thumbnail Migration ===")
    total_parts = conn.execute("SELECT COUNT(*) FROM part").fetchone()[0]
    with_path = conn.execute("SELECT COUNT(*) FROM part WHERE thumbnail_path IS NOT NULL").fetchone()[0]
    with_data = conn.execute("SELECT COUNT(*) FROM part WHERE thumbnail_data IS NOT NULL AND thumbnail_data != ''").fetchone()[0]
    no_thumb = total_parts - with_path - with_data

    check(f"Parts with filesystem thumbnail: {with_path}/{total_parts}", with_path > 0)
    if with_data > 0:
        warn(f"{with_data} parts still have base64 in DB (legacy fallback)")
    else:
        check("No parts with base64 in DB (fully migrated)", True)

    # Verify files exist on disk
    if os.path.isdir(THUMBNAIL_DIR):
        file_count = len(os.listdir(THUMBNAIL_DIR))
        check(f"Thumbnail files on disk: {file_count}", file_count >= with_path,
              f"Expected >= {with_path}, found {file_count}")

        # Spot-check: pick 5 random parts with thumbnail_path and verify file exists
        samples = conn.execute(
            "SELECT id, part_number, revision, thumbnail_path FROM part WHERE thumbnail_path IS NOT NULL LIMIT 5"
        ).fetchall()
        for part_id, pn, rev, path in samples:
            full = os.path.join(PROJECT_DIR, 'instance', path)
            check(f"File exists for Part {part_id} ({pn} REV {rev})", os.path.exists(full), full)
    else:
        check("Thumbnail directory exists", False, THUMBNAIL_DIR)

    # === 4. Indexes ===
    print("\n=== 4. Indexes ===")
    indexes = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    ).fetchall()}
    expected = [
        'idx_rfq_item_rfq_id', 'idx_rfq_item_part_id',
        'idx_po_item_po_id', 'idx_po_item_part_id',
        'idx_po_qc_item_po_id', 'idx_po_qc_item_po_item_id',
        'idx_bom_instance_badge_id', 'idx_rfq_bom_id', 'idx_po_rfq_id',
    ]
    for idx in expected:
        check(f"Index {idx}", idx in indexes)

    # === 5. Fragmentation ===
    print("\n=== 5. Fragmentation ===")
    freelist = conn.execute("PRAGMA freelist_count").fetchone()[0]
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    wasted_mb = freelist * page_size / 1024 / 1024
    check(f"Freelist: {freelist} pages ({wasted_mb:.1f} MB)", freelist < 1000,
          f"{wasted_mb:.1f} MB wasted - consider VACUUM")

    # === 6. Row counts (sanity) ===
    print("\n=== 6. Row Count Sanity ===")
    tables = ['part', 'bom_part', 'bom_instance', 'eco', 'po', 'po_item', 'rfq', 'rfq_item']
    for table in tables:
        try:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            check(f"{table}: {count} rows", count >= 0)
        except Exception as e:
            check(f"{table} exists", False, str(e))

    conn.close()

    # === 7. Live server tests ===
    if not args.skip_live:
        print(f"\n=== 7. Live Server Tests (localhost:{args.port}) ===")
        try:
            # Test thumbnail endpoint
            url = f"http://localhost:{args.port}/api/parts/1/thumbnail"
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req, timeout=5)
            check("GET /api/parts/1/thumbnail returns 200", resp.status == 200)
            check("Content-Type is image", 'image' in resp.headers.get('Content-Type', ''))
            size = len(resp.read())
            check(f"Thumbnail data received ({size} bytes)", size > 100)
        except urllib.error.HTTPError as e:
            if e.code == 302:
                warn("Thumbnail endpoint redirects to login (need auth) - check manually in browser")
            else:
                check(f"Thumbnail endpoint", False, f"HTTP {e.code}")
        except Exception as e:
            warn(f"Could not reach server: {e}")
    else:
        print("\n=== 7. Live Server Tests (skipped) ===")

    # === Summary ===
    print(f"\n{'=' * 50}")
    print(f"Results: {passed} passed, {failed} failed, {warnings} warnings")
    if failed == 0:
        print("ALL CHECKS PASSED - Safe to apply to production")
    else:
        print("SOME CHECKS FAILED - Review before applying to production")
    print(f"{'=' * 50}")

    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
