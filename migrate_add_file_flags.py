"""
Migration: Add file availability flags to Part table
Columns: has_pdf, has_ai_pdf, has_step, has_xt (all Boolean, default False)
"""
import sqlite3
import os

def migrate(db_path):
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return False

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    columns_to_add = [
        ("has_pdf", "BOOLEAN DEFAULT 0"),
        ("has_ai_pdf", "BOOLEAN DEFAULT 0"),
        ("has_step", "BOOLEAN DEFAULT 0"),
        ("step_files", "TEXT DEFAULT NULL"),
        ("has_xt", "BOOLEAN DEFAULT 0"),
    ]

    for col_name, col_type in columns_to_add:
        try:
            cursor.execute(f"ALTER TABLE part ADD COLUMN {col_name} {col_type}")
            print(f"  Added column: {col_name}")
        except sqlite3.OperationalError as e:
            if "duplicate column" in str(e).lower():
                print(f"  Column already exists: {col_name}")
            else:
                raise

    conn.commit()
    conn.close()
    print(f"Migration complete for {db_path}")
    return True


if __name__ == "__main__":
    # Run against dev DB
    dev_db = os.path.join(os.path.dirname(__file__), "instance", "menteebom_dev.db")
    print(f"Migrating dev DB: {dev_db}")
    migrate(dev_db)
