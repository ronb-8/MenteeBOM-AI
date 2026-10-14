"""
Database migration for MenteeFlow integration features:
- Feature 1: Unpicked parts blocking (repick_history_json on process_stage)
- Feature 2: Embed tokens (embed_token table, embed_url_template on menteeflow_config)
- Feature 3: Stage reversal + Part replacement (reversal columns, part_replacement table)

Run against: instance/menteebom_dev.db
"""
import sqlite3
import sys


def migrate():
    db_path = 'instance/menteebom_dev.db'
    print(f"Migrating {db_path}...")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # ─── Feature 1: Unpicked Parts Blocking ───────────────────────────────

    # Add repick_history_json to process_stage
    ps_columns = [col[1] for col in cursor.execute("PRAGMA table_info('process_stage')").fetchall()]

    if 'repick_history_json' not in ps_columns:
        cursor.execute("ALTER TABLE process_stage ADD COLUMN repick_history_json TEXT")
        print("  + Added repick_history_json to process_stage")
    else:
        print("  ~ repick_history_json already exists on process_stage")

    # ─── Feature 2: Embed Tokens ──────────────────────────────────────────

    # Add embed_url_template to menteeflow_config
    mf_columns = [col[1] for col in cursor.execute("PRAGMA table_info('menteeflow_config')").fetchall()]

    if 'embed_url_template' not in mf_columns:
        cursor.execute("ALTER TABLE menteeflow_config ADD COLUMN embed_url_template VARCHAR(500)")
        print("  + Added embed_url_template to menteeflow_config")
    else:
        print("  ~ embed_url_template already exists on menteeflow_config")

    # Create embed_token table
    tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]

    if 'embed_token' not in tables:
        cursor.execute("""
            CREATE TABLE embed_token (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token VARCHAR(128) NOT NULL UNIQUE,
                process_id INTEGER NOT NULL REFERENCES manufacturing_process(id),
                stage_scope VARCHAR(10),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                used_at DATETIME,
                is_revoked BOOLEAN DEFAULT 0
            )
        """)
        cursor.execute("CREATE INDEX idx_embed_token_token ON embed_token(token)")
        cursor.execute("CREATE INDEX idx_embed_token_process ON embed_token(process_id)")
        print("  + Created embed_token table")
    else:
        print("  ~ embed_token table already exists")

    # ─── Feature 3: Stage Reversal + Part Replacement ─────────────────────

    # Add reversal columns to process_stage
    if 'reverted_at' not in ps_columns:
        cursor.execute("ALTER TABLE process_stage ADD COLUMN reverted_at DATETIME")
        print("  + Added reverted_at to process_stage")
    else:
        print("  ~ reverted_at already exists on process_stage")

    if 'reverted_by' not in ps_columns:
        cursor.execute("ALTER TABLE process_stage ADD COLUMN reverted_by INTEGER REFERENCES user(id)")
        print("  + Added reverted_by to process_stage")
    else:
        print("  ~ reverted_by already exists on process_stage")

    if 'revert_reason' not in ps_columns:
        cursor.execute("ALTER TABLE process_stage ADD COLUMN revert_reason VARCHAR(500)")
        print("  + Added revert_reason to process_stage")
    else:
        print("  ~ revert_reason already exists on process_stage")

    if 'original_completed_at' not in ps_columns:
        cursor.execute("ALTER TABLE process_stage ADD COLUMN original_completed_at DATETIME")
        print("  + Added original_completed_at to process_stage")
    else:
        print("  ~ original_completed_at already exists on process_stage")

    # Add revert_count to manufacturing_process
    mp_columns = [col[1] for col in cursor.execute("PRAGMA table_info('manufacturing_process')").fetchall()]

    if 'revert_count' not in mp_columns:
        cursor.execute("ALTER TABLE manufacturing_process ADD COLUMN revert_count INTEGER DEFAULT 0")
        print("  + Added revert_count to manufacturing_process")
    else:
        print("  ~ revert_count already exists on manufacturing_process")

    # Create part_replacement table
    if 'part_replacement' not in tables:
        cursor.execute("""
            CREATE TABLE part_replacement (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_id INTEGER NOT NULL REFERENCES manufacturing_process(id),
                stage_id INTEGER NOT NULL REFERENCES process_stage(id),
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
        cursor.execute("CREATE INDEX idx_part_replacement_process ON part_replacement(process_id)")
        cursor.execute("CREATE INDEX idx_part_replacement_stage ON part_replacement(stage_id)")
        print("  + Created part_replacement table")
    else:
        print("  ~ part_replacement table already exists")

    conn.commit()
    conn.close()
    print("\nMigration complete!")


if __name__ == '__main__':
    migrate()
