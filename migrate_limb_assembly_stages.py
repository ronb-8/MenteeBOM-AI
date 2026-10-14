"""
Database migration for post-DOF limb assembly stages:
- Add stage_prefix column to robot_limb
- Create limb_assembly_stage_def table
- Create limb_assembly_process table
- Create limb_assembly_process_stage table
- Add limb_process_id column to embed_token
- Make embed_token.process_id nullable

Usage:
  python migrate_limb_assembly_stages.py          # migrates dev DB
  python migrate_limb_assembly_stages.py --prod   # migrates prod DB
  python migrate_limb_assembly_stages.py --all    # migrates both
"""
import sqlite3
import sys


def migrate(db_path='instance/menteebom_dev.db'):
    print(f"\nMigrating {db_path}...")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]

    # ─── 1. Add stage_prefix to robot_limb ────────────────────────────────

    rl_columns = [col[1] for col in cursor.execute("PRAGMA table_info('robot_limb')").fetchall()]

    if 'stage_prefix' not in rl_columns:
        cursor.execute("ALTER TABLE robot_limb ADD COLUMN stage_prefix VARCHAR(10)")
        print("  + Added stage_prefix to robot_limb")
    else:
        print("  ~ stage_prefix already exists on robot_limb")

    # ─── 2. Create limb_assembly_stage_def table ──────────────────────────

    if 'limb_assembly_stage_def' not in tables:
        cursor.execute("""
            CREATE TABLE limb_assembly_stage_def (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                limb_id INTEGER NOT NULL REFERENCES robot_limb(id) ON DELETE CASCADE,

                stage_prefix VARCHAR(10) NOT NULL,
                stage_number INTEGER NOT NULL,
                stage_sub VARCHAR(10),
                stage_label VARCHAR(20) NOT NULL,
                stage_name VARCHAR(200) NOT NULL,

                bom_part_id INTEGER,
                assembly_part_number VARCHAR(200) NOT NULL,
                bom_instance_id INTEGER REFERENCES bom_instance(id),

                parent_stage_id INTEGER REFERENCES limb_assembly_stage_def(id),
                parallel_group INTEGER,
                display_order INTEGER DEFAULT 0,

                has_drawing BOOLEAN DEFAULT 0,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER REFERENCES user(id),

                UNIQUE(limb_id, stage_label)
            )
        """)
        cursor.execute("CREATE INDEX idx_limb_stage_limb ON limb_assembly_stage_def(limb_id, display_order)")
        print("  + Created limb_assembly_stage_def table")
    else:
        print("  ~ limb_assembly_stage_def table already exists")

    # ─── 3. Create limb_assembly_process table ────────────────────────────

    if 'limb_assembly_process' not in tables:
        cursor.execute("""
            CREATE TABLE limb_assembly_process (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_number VARCHAR(30) NOT NULL UNIQUE,
                badge_id INTEGER NOT NULL REFERENCES project_badge(id),
                limb_id INTEGER NOT NULL REFERENCES robot_limb(id),

                status VARCHAR(30) DEFAULT 'active',
                current_stage_label VARCHAR(20),
                revert_count INTEGER DEFAULT 0,

                menteeflow_ticket_id VARCHAR(100),
                menteeflow_url VARCHAR(500),

                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            )
        """)
        cursor.execute("CREATE INDEX idx_limb_proc_badge ON limb_assembly_process(badge_id, status)")
        cursor.execute("CREATE INDEX idx_limb_proc_limb ON limb_assembly_process(limb_id)")
        print("  + Created limb_assembly_process table")
    else:
        print("  ~ limb_assembly_process table already exists")

    # ─── 4. Create limb_assembly_process_stage table ──────────────────────

    if 'limb_assembly_process_stage' not in tables:
        cursor.execute("""
            CREATE TABLE limb_assembly_process_stage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_id INTEGER NOT NULL REFERENCES limb_assembly_process(id) ON DELETE CASCADE,
                stage_def_id INTEGER NOT NULL REFERENCES limb_assembly_stage_def(id),

                stage_label VARCHAR(20) NOT NULL,
                stage_name VARCHAR(200) NOT NULL,
                assembly_part_number VARCHAR(200) NOT NULL,
                display_order INTEGER DEFAULT 0,
                parallel_group INTEGER,

                phase VARCHAR(20) DEFAULT 'pending',
                status VARCHAR(30) DEFAULT 'pending',

                picked_parts_json TEXT,
                unpicked_parts_json TEXT,
                repick_history_json TEXT,

                started_at DATETIME,
                completed_at DATETIME,
                completed_by INTEGER REFERENCES user(id),

                reverted_at DATETIME,
                reverted_by INTEGER REFERENCES user(id),
                revert_reason VARCHAR(500),
                original_completed_at DATETIME,

                UNIQUE(process_id, stage_def_id)
            )
        """)
        cursor.execute("CREATE INDEX idx_limb_stage_proc ON limb_assembly_process_stage(process_id, display_order)")
        print("  + Created limb_assembly_process_stage table")
    else:
        print("  ~ limb_assembly_process_stage table already exists")

    # ─── 5. Add limb_process_id to embed_token ───────────────────────────

    et_columns = [col[1] for col in cursor.execute("PRAGMA table_info('embed_token')").fetchall()]

    if 'limb_process_id' not in et_columns:
        cursor.execute("ALTER TABLE embed_token ADD COLUMN limb_process_id INTEGER REFERENCES limb_assembly_process(id)")
        print("  + Added limb_process_id to embed_token")
    else:
        print("  ~ limb_process_id already exists on embed_token")

    # ─── 6. Make embed_token.process_id nullable ──────────────────────────
    # SQLite doesn't support ALTER COLUMN, so we need to recreate the table
    # Check if process_id is currently NOT NULL

    et_info = cursor.execute("PRAGMA table_info('embed_token')").fetchall()
    process_id_col = next((col for col in et_info if col[1] == 'process_id'), None)

    if process_id_col and process_id_col[3] == 1:  # notnull flag = 1
        print("  * Recreating embed_token to make process_id nullable...")

        cursor.execute("ALTER TABLE embed_token RENAME TO embed_token_old")

        cursor.execute("""
            CREATE TABLE embed_token (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token VARCHAR(128) NOT NULL UNIQUE,
                process_id INTEGER REFERENCES manufacturing_process(id),
                limb_process_id INTEGER REFERENCES limb_assembly_process(id),
                stage_scope VARCHAR(10),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                used_at DATETIME,
                is_revoked BOOLEAN DEFAULT 0
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_embed_token_token ON embed_token(token)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_embed_token_process ON embed_token(process_id)")

        cursor.execute("""
            INSERT INTO embed_token (id, token, process_id, stage_scope, created_at, expires_at, used_at, is_revoked)
            SELECT id, token, process_id, stage_scope, created_at, expires_at, used_at, is_revoked
            FROM embed_token_old
        """)

        cursor.execute("DROP TABLE embed_token_old")
        print("  + Recreated embed_token with nullable process_id")
    else:
        print("  ~ embed_token.process_id is already nullable (or table was already migrated)")

    # ─── 7. Add limb columns to part_replacement ───────────────────────

    pr_columns = [col[1] for col in cursor.execute("PRAGMA table_info('part_replacement')").fetchall()]

    if 'limb_process_id' not in pr_columns:
        cursor.execute("ALTER TABLE part_replacement ADD COLUMN limb_process_id INTEGER REFERENCES limb_assembly_process(id)")
        print("  + Added limb_process_id to part_replacement")
    else:
        print("  ~ limb_process_id already exists on part_replacement")

    if 'limb_stage_id' not in pr_columns:
        cursor.execute("ALTER TABLE part_replacement ADD COLUMN limb_stage_id INTEGER REFERENCES limb_assembly_process_stage(id)")
        print("  + Added limb_stage_id to part_replacement")
    else:
        print("  ~ limb_stage_id already exists on part_replacement")

    # Make process_id and stage_id nullable on part_replacement (for limb processes)
    pr_info = cursor.execute("PRAGMA table_info('part_replacement')").fetchall()
    process_id_col = next((col for col in pr_info if col[1] == 'process_id'), None)

    if process_id_col and process_id_col[3] == 1:  # notnull flag = 1
        print("  * Recreating part_replacement to make process_id/stage_id nullable...")

        cursor.execute("ALTER TABLE part_replacement RENAME TO part_replacement_old")
        cursor.execute("""
            CREATE TABLE part_replacement (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_id INTEGER REFERENCES manufacturing_process(id),
                stage_id INTEGER REFERENCES process_stage(id),
                limb_process_id INTEGER REFERENCES limb_assembly_process(id),
                limb_stage_id INTEGER REFERENCES limb_assembly_process_stage(id),
                old_part_id INTEGER NOT NULL REFERENCES part(id),
                old_part_number VARCHAR(100) NOT NULL,
                old_revision VARCHAR(50),
                new_part_id INTEGER NOT NULL REFERENCES part(id),
                new_part_number VARCHAR(100) NOT NULL,
                new_revision VARCHAR(50),
                quantity INTEGER DEFAULT 1,
                reason VARCHAR(500),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER REFERENCES user(id)
            )
        """)

        cursor.execute("""
            INSERT INTO part_replacement (id, process_id, stage_id, old_part_id, old_part_number,
                old_revision, new_part_id, new_part_number, new_revision, quantity, reason, created_at, created_by)
            SELECT id, process_id, stage_id, old_part_id, old_part_number,
                old_revision, new_part_id, new_part_number, new_revision, quantity, reason, created_at, created_by
            FROM part_replacement_old
        """)

        cursor.execute("DROP TABLE part_replacement_old")
        print("  + Recreated part_replacement with nullable process_id/stage_id and limb columns")
    else:
        print("  ~ part_replacement.process_id is already nullable")

    # ─── Done ─────────────────────────────────────────────────────────────

    conn.commit()
    conn.close()
    print("\nMigration complete!")


if __name__ == '__main__':
    if '--prod' in sys.argv:
        migrate('instance/menteebom.db')
    elif '--all' in sys.argv:
        migrate('instance/menteebom_dev.db')
        migrate('instance/menteebom.db')
    else:
        migrate('instance/menteebom_dev.db')
