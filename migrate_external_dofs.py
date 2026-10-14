"""
Database migration for external DOFs:
- Recreate dof_mapping table with nullable limb_id (SQLite requires table recreation)
- Seed 4 hardcoded external DOFs (801-804) with limb_id = NULL

Usage:
  python migrate_external_dofs.py          # migrates dev DB
  python migrate_external_dofs.py --prod   # migrates prod DB
  python migrate_external_dofs.py --all    # migrates both
"""
import sqlite3
import sys

EXTERNAL_DOFS = [
    ('801', 'AII', '034-AS-01477'),
    ('802', 'BII', '034-AS-01478'),
    ('803', 'CII', '034-AS-01479'),
    ('804', 'DII', '034-AS-01480'),
]


def migrate(db_path='instance/menteebom_dev.db'):
    print(f"\nMigrating {db_path}...")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check current limb_id nullability
    col_info = cursor.execute("PRAGMA table_info('dof_mapping')").fetchall()
    limb_col = next((c for c in col_info if c[1] == 'limb_id'), None)

    if limb_col and limb_col[3] == 1:  # notnull == 1 means NOT NULL
        print("  ~ dof_mapping.limb_id is NOT NULL — recreating table to make it nullable...")

        cursor.execute("PRAGMA foreign_keys = OFF")

        cursor.execute("""
            CREATE TABLE dof_mapping_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                limb_id INTEGER REFERENCES robot_limb(id) ON DELETE CASCADE,
                dof_number VARCHAR(10) NOT NULL,
                dof_name VARCHAR(200) NOT NULL,
                assembly_description VARCHAR(500) NOT NULL,
                bom_instance_id INTEGER REFERENCES bom_instance(id),
                serial_number_prefix VARCHAR(50),
                display_order INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT 1
            )
        """)

        cursor.execute("""
            INSERT INTO dof_mapping_new
                (id, limb_id, dof_number, dof_name, assembly_description,
                 bom_instance_id, serial_number_prefix, display_order, is_active)
            SELECT
                id, limb_id, dof_number, dof_name, assembly_description,
                bom_instance_id, serial_number_prefix, display_order, is_active
            FROM dof_mapping
        """)

        cursor.execute("DROP TABLE dof_mapping")
        cursor.execute("ALTER TABLE dof_mapping_new RENAME TO dof_mapping")

        cursor.execute("CREATE UNIQUE INDEX _limb_dof_uc ON dof_mapping(limb_id, dof_number)")
        cursor.execute("CREATE INDEX idx_dof_limb ON dof_mapping(limb_id)")
        cursor.execute("CREATE INDEX idx_dof_number ON dof_mapping(dof_number)")

        cursor.execute("PRAGMA foreign_keys = ON")
        print("  + dof_mapping recreated with nullable limb_id")
    else:
        print("  ~ dof_mapping.limb_id already nullable — skipping recreation")

    # Seed external DOFs
    existing_external = {
        row[0] for row in cursor.execute(
            "SELECT dof_number FROM dof_mapping WHERE limb_id IS NULL"
        ).fetchall()
    }

    seeded = 0
    for dof_number, dof_name, assembly_description in EXTERNAL_DOFS:
        if dof_number not in existing_external:
            cursor.execute("""
                INSERT INTO dof_mapping (limb_id, dof_number, dof_name, assembly_description, display_order, is_active)
                VALUES (NULL, ?, ?, ?, ?, 1)
            """, (dof_number, dof_name, assembly_description, int(dof_number) - 801))
            print(f"  + Seeded external DOF {dof_number} ({dof_name})")
            seeded += 1
        else:
            print(f"  ~ External DOF {dof_number} already exists")

    conn.commit()
    conn.close()
    print(f"  Done. {seeded} external DOFs seeded.\n")


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--all' in args:
        migrate('instance/menteebom_dev.db')
        migrate('instance/menteebom.db')
    elif '--prod' in args:
        migrate('instance/menteebom.db')
    else:
        migrate('instance/menteebom_dev.db')
