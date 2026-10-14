"""
Migration: Extract part thumbnails from SQLite TEXT columns to filesystem.
This reduces the database by ~88 MB.

Saves thumbnails to instance/thumbnails/{part_id}_{part_number}_{revision}.png
Each part_number+revision pair gets its own file.

Run: python migrations/migrate_thumbnails_to_files.py
Rollback: python migrations/migrate_thumbnails_to_files.py --rollback
"""
import os
import sys
import json
import base64
import sqlite3
import re
import argparse

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DB_PATH = os.path.join(PROJECT_DIR, 'instance', 'menteebom_dev.db')
THUMBNAIL_DIR = os.path.join(PROJECT_DIR, 'instance', 'thumbnails')


def safe_filename(s):
    """Make a string safe for use as a filename."""
    return re.sub(r'[^\w\-.]', '_', s)


def migrate():
    """Extract thumbnails from DB to filesystem, then NULL the DB column."""
    os.makedirs(THUMBNAIL_DIR, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute(
        "SELECT id, part_number, revision, thumbnail_data FROM part "
        "WHERE thumbnail_data IS NOT NULL AND thumbnail_data != ''"
    )

    extracted = 0
    errors = 0
    total_bytes_saved = 0

    for row in cursor.fetchall():
        part_id, part_number, revision, thumbnail_data = row
        try:
            data = json.loads(thumbnail_data)
            if not data.get('available') or not data.get('data_base64'):
                continue

            b64 = data['data_base64']
            img_bytes = base64.b64decode(b64)

            # Filename: {part_id}_{part_number}_{revision}.png
            safe_pn = safe_filename(part_number)
            safe_rev = safe_filename(revision)
            filename = f"{part_id}_{safe_pn}_{safe_rev}.png"
            filepath = os.path.join(THUMBNAIL_DIR, filename)

            with open(filepath, 'wb') as f:
                f.write(img_bytes)

            # Update DB: set thumbnail_data to NULL, store the relative path
            # We'll add thumbnail_path column if it doesn't exist
            total_bytes_saved += len(thumbnail_data)
            extracted += 1

            if extracted % 100 == 0:
                print(f"  Extracted {extracted} thumbnails...")

        except Exception as e:
            errors += 1
            print(f"  ERROR part {part_id} ({part_number} REV {revision}): {e}")

    # Add thumbnail_path column if it doesn't exist
    try:
        conn.execute("ALTER TABLE part ADD COLUMN thumbnail_path VARCHAR(500)")
        print("Added thumbnail_path column to part table")
    except sqlite3.OperationalError:
        print("thumbnail_path column already exists")

    # Update all parts with their file paths and NULL out thumbnail_data
    cursor2 = conn.execute(
        "SELECT id, part_number, revision FROM part "
        "WHERE thumbnail_data IS NOT NULL AND thumbnail_data != ''"
    )
    updated = 0
    for row in cursor2.fetchall():
        part_id, part_number, revision = row
        safe_pn = safe_filename(part_number)
        safe_rev = safe_filename(revision)
        filename = f"{part_id}_{safe_pn}_{safe_rev}.png"
        filepath = os.path.join(THUMBNAIL_DIR, filename)

        if os.path.exists(filepath):
            rel_path = f"thumbnails/{filename}"
            conn.execute(
                "UPDATE part SET thumbnail_path = ?, thumbnail_data = NULL WHERE id = ?",
                (rel_path, part_id)
            )
            updated += 1

    conn.commit()

    # VACUUM to reclaim space
    print("Running VACUUM to reclaim space...")
    conn.execute("VACUUM")
    conn.close()

    saved_mb = total_bytes_saved / 1024 / 1024
    print(f"\nMigration complete:")
    print(f"  Extracted: {extracted} thumbnails")
    print(f"  Updated:   {updated} DB rows (thumbnail_data → NULL, thumbnail_path set)")
    print(f"  Errors:    {errors}")
    print(f"  Space saved: ~{saved_mb:.1f} MB (TEXT column data)")
    print(f"  Files at:  {THUMBNAIL_DIR}")

    db_size = os.path.getsize(DB_PATH) / 1024 / 1024
    print(f"  New DB size: {db_size:.1f} MB")


def rollback():
    """Restore thumbnails from filesystem back into the DB column."""
    conn = sqlite3.connect(DB_PATH)

    cursor = conn.execute(
        "SELECT id, part_number, revision, thumbnail_path FROM part "
        "WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ''"
    )

    restored = 0
    errors = 0

    for row in cursor.fetchall():
        part_id, part_number, revision, thumbnail_path = row
        filepath = os.path.join(PROJECT_DIR, 'instance', thumbnail_path)

        if not os.path.exists(filepath):
            print(f"  SKIP part {part_id}: file not found at {filepath}")
            errors += 1
            continue

        try:
            with open(filepath, 'rb') as f:
                img_bytes = f.read()

            b64 = base64.b64encode(img_bytes).decode('utf-8')
            thumbnail_json = json.dumps({
                'available': True,
                'data_base64': b64,
                'info': {
                    'width': 0,
                    'height': 0,
                    'format': 'Png',
                    'size_bytes': len(img_bytes)
                }
            })

            conn.execute(
                "UPDATE part SET thumbnail_data = ?, thumbnail_path = NULL WHERE id = ?",
                (thumbnail_json, part_id)
            )
            restored += 1

        except Exception as e:
            errors += 1
            print(f"  ERROR part {part_id}: {e}")

    conn.commit()
    conn.close()

    print(f"\nRollback complete:")
    print(f"  Restored: {restored} thumbnails back to DB")
    print(f"  Errors:   {errors}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Migrate thumbnails between DB and filesystem')
    parser.add_argument('--rollback', action='store_true', help='Restore thumbnails from filesystem back to DB')
    parser.add_argument('--db', default=DB_PATH, help='Path to SQLite database')
    args = parser.parse_args()

    if args.db != DB_PATH:
        DB_PATH = args.db

    print(f"Database: {DB_PATH}")
    print(f"Thumbnail dir: {THUMBNAIL_DIR}")
    print()

    if args.rollback:
        print("=== ROLLBACK MODE ===")
        rollback()
    else:
        print("=== MIGRATION MODE ===")
        migrate()
