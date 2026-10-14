#!/usr/bin/env python3
"""
Migration script to update BOMItemCustomData schema
Changes bom_item_id from Integer to String to support part numbers
"""

import sys
import os
from sqlalchemy import text

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import app, db

def migrate_custom_data_schema():
    """Update BOMItemCustomData schema to use string bom_item_id"""
    
    with app.app_context():
        try:
            print("Starting custom data schema migration...")
            
            # Check if the table exists
            result = db.engine.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='bom_item_custom_data'"))
            if not result.fetchone():
                print("ERROR: Table 'bom_item_custom_data' does not exist. Run the initial migration first.")
                return False
            
            # Check current schema
            result = db.engine.execute(text("PRAGMA table_info(bom_item_custom_data)"))
            columns = result.fetchall()
            
            print("Current table schema:")
            for col in columns:
                print(f"  - {col[1]} ({col[2]})")
            
            # Check if bom_item_id is already a string
            bom_item_id_col = next((col for col in columns if col[1] == 'bom_item_id'), None)
            if bom_item_id_col and bom_item_id_col[2] == 'VARCHAR(200)':
                print("SUCCESS: Schema is already up to date. No migration needed.")
                return True
            
            print("Updating schema...")
            
            # Create a new table with the updated schema
            db.engine.execute(text("""
                CREATE TABLE bom_item_custom_data_new (
                    id INTEGER PRIMARY KEY,
                    bom_item_id VARCHAR(200) NOT NULL,
                    column_id INTEGER NOT NULL,
                    value TEXT,
                    updated_by INTEGER,
                    updated_at DATETIME,
                    FOREIGN KEY (column_id) REFERENCES custom_bom_column (id) ON DELETE CASCADE,
                    FOREIGN KEY (updated_by) REFERENCES user (id)
                )
            """))
            
            # Copy data from old table to new table
            # Convert integer IDs to string format
            db.engine.execute(text("""
                INSERT INTO bom_item_custom_data_new (id, bom_item_id, column_id, value, updated_by, updated_at)
                SELECT id, 'item_' || CAST(bom_item_id AS TEXT), column_id, value, updated_by, updated_at
                FROM bom_item_custom_data
            """))
            
            # Drop the old table
            db.engine.execute(text("DROP TABLE bom_item_custom_data"))
            
            # Rename the new table
            db.engine.execute(text("ALTER TABLE bom_item_custom_data_new RENAME TO bom_item_custom_data"))
            
            # Verify the new schema
            result = db.engine.execute(text("PRAGMA table_info(bom_item_custom_data)"))
            columns = result.fetchall()
            
            print("SUCCESS: Migration completed successfully!")
            print("New table schema:")
            for col in columns:
                print(f"  - {col[1]} ({col[2]})")
            
            return True
            
        except Exception as e:
            print(f"ERROR: Migration failed: {str(e)}")
            return False

def rollback_migration():
    """Rollback the migration (revert to integer bom_item_id)"""
    
    with app.app_context():
        try:
            print("Rolling back custom data schema migration...")
            
            # This is a destructive operation - only do it if really needed
            print("WARNING: This will delete all custom data!")
            response = input("Are you sure you want to continue? (yes/no): ")
            if response.lower() != 'yes':
                print("Rollback cancelled.")
                return False
            
            # Drop the current table
            db.engine.execute(text("DROP TABLE IF EXISTS bom_item_custom_data"))
            
            # Recreate with integer bom_item_id
            db.engine.execute(text("""
                CREATE TABLE bom_item_custom_data (
                    id INTEGER PRIMARY KEY,
                    bom_item_id INTEGER,
                    column_id INTEGER NOT NULL,
                    value TEXT,
                    updated_by INTEGER,
                    updated_at DATETIME,
                    FOREIGN KEY (bom_item_id) REFERENCES bom_item (id) ON DELETE CASCADE,
                    FOREIGN KEY (column_id) REFERENCES custom_bom_column (id) ON DELETE CASCADE,
                    FOREIGN KEY (updated_by) REFERENCES user (id)
                )
            """))
            
            print("SUCCESS: Rollback completed successfully!")
            return True
            
        except Exception as e:
            print(f"ERROR: Rollback failed: {str(e)}")
            return False

if __name__ == "__main__":
    print("=" * 60)
    print("Custom Data Schema Migration")
    print("=" * 60)
    
    if len(sys.argv) > 1 and sys.argv[1] == 'rollback':
        success = rollback_migration()
    else:
        success = migrate_custom_data_schema()
    
    if success:
        print("\nSUCCESS: Migration completed successfully!")
    else:
        print("\nERROR: Migration failed!")
        sys.exit(1)
