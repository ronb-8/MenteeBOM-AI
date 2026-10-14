#!/usr/bin/env python3
"""
Database Migration Script for BOM Version Control System
This script handles the migration from the old database schema to the new version control schema.
"""

import os
import sys
import sqlite3
from datetime import datetime

def backup_database(db_path):
    """Create a backup of the existing database"""
    backup_path = f"{db_path}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    print(f"Creating backup: {backup_path}")
    
    # Copy the database file
    import shutil
    shutil.copy2(db_path, backup_path)
    print(f"Backup created successfully: {backup_path}")
    return backup_path

def check_database_exists(db_path):
    """Check if the database file exists"""
    return os.path.exists(db_path)

def get_database_version(conn):
    """Get the current database version"""
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT version FROM schema_version ORDER BY id DESC LIMIT 1")
        result = cursor.fetchone()
        return result[0] if result else "0.0"
    except:
        return "0.0"

def set_database_version(conn, version):
    """Set the database version"""
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            id INTEGER PRIMARY KEY,
            version TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
    conn.commit()

def migrate_to_version_1_1(conn):
    """Migrate to version 1.1 - Add version control fields"""
    print("Migrating to version 1.1 - Adding version control fields...")
    
    cursor = conn.cursor()
    
    # Add new columns to BOMVersion table
    try:
        cursor.execute("ALTER TABLE bom_version ADD COLUMN is_latest BOOLEAN DEFAULT TRUE")
        print("Added is_latest column to bom_version table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("is_latest column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_version ADD COLUMN assembly_path TEXT")
        print("Added assembly_path column to bom_version table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("assembly_path column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_version ADD COLUMN bom_layout TEXT")
        print("Added bom_layout column to bom_version table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("bom_layout column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_version ADD COLUMN configuration TEXT")
        print("Added configuration column to bom_version table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("configuration column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_version ADD COLUMN total_changes INTEGER DEFAULT 0")
        print("Added total_changes column to bom_version table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("total_changes column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_version ADD COLUMN bom_data_snapshot TEXT")
        print("Added bom_data_snapshot column to bom_version table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("bom_data_snapshot column already exists")
        else:
            raise
    
    # Add new columns to BOMChange table
    try:
        cursor.execute("ALTER TABLE bom_change ADD COLUMN part_number TEXT")
        print("Added part_number column to bom_change table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("part_number column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_change ADD COLUMN change_summary TEXT")
        print("Added change_summary column to bom_change table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("change_summary column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_change ADD COLUMN priority TEXT DEFAULT 'normal'")
        print("Added priority column to bom_change table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("priority column already exists")
        else:
            raise
    
    try:
        cursor.execute("ALTER TABLE bom_change ADD COLUMN is_breaking_change BOOLEAN DEFAULT FALSE")
        print("Added is_breaking_change column to bom_change table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("is_breaking_change column already exists")
        else:
            raise
    
    # Update existing records to have is_latest = TRUE for the most recent version of each BOM
    cursor.execute("""
        UPDATE bom_version 
        SET is_latest = TRUE 
        WHERE id IN (
            SELECT MAX(id) 
            FROM bom_version 
            GROUP BY bom_id
        )
    """)
    
    # Set is_latest = FALSE for all other versions
    cursor.execute("""
        UPDATE bom_version 
        SET is_latest = FALSE 
        WHERE id NOT IN (
            SELECT MAX(id) 
            FROM bom_version 
            GROUP BY bom_id
        )
    """)
    
    conn.commit()
    print("Version 1.1 migration completed successfully")

def migrate_to_version_1_2(conn):
    """Migrate to version 1.2 - Add changes column to BOMItem"""
    print("Migrating to version 1.2 - Adding changes column to BOMItem...")
    
    cursor = conn.cursor()
    
    try:
        cursor.execute("ALTER TABLE bom_item ADD COLUMN changes TEXT")
        print("Added changes column to bom_item table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("changes column already exists")
        else:
            raise
    
    conn.commit()
    print("Version 1.2 migration completed successfully")

def migrate_to_version_1_3(conn):
    """Migrate to version 1.3 - Add BOM data snapshot field"""
    print("Migrating to version 1.3 - Adding BOM data snapshot field...")
    
    cursor = conn.cursor()
    
    try:
        cursor.execute("ALTER TABLE bom_version ADD COLUMN bom_data_snapshot TEXT")
        print("Added bom_data_snapshot column to bom_version table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("bom_data_snapshot column already exists")
        else:
            raise
    
    conn.commit()
    print("Version 1.3 migration completed successfully")

def run_migration():
    """Run the database migration"""
    db_path = "instance/menteebom.db"
    
    if not check_database_exists(db_path):
        print(f"Database not found at {db_path}")
        print("Please run the application first to create the initial database")
        return False
    
    # Create backup
    backup_path = backup_database(db_path)
    
    try:
        # Connect to database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get current version
        current_version = get_database_version(conn)
        print(f"Current database version: {current_version}")
        
        # Run migrations based on current version
        if current_version == "0.0":
            # Fresh database, set up version control
            migrate_to_version_1_1(conn)
            set_database_version(conn, "1.1")
            
            migrate_to_version_1_2(conn)
            set_database_version(conn, "1.2")
            
        elif current_version == "1.0":
            # Upgrade from 1.0 to 1.2
            migrate_to_version_1_1(conn)
            set_database_version(conn, "1.1")
            
            migrate_to_version_1_2(conn)
            set_database_version(conn, "1.2")
            
        elif current_version == "1.1":
            # Upgrade from 1.1 to 1.2
            migrate_to_version_1_2(conn)
            set_database_version(conn, "1.2")
            
        elif current_version == "1.2":
            # Upgrade from 1.2 to 1.3
            migrate_to_version_1_3(conn)
            set_database_version(conn, "1.3")
            
        elif current_version == "1.3":
            print("Database is already at version 1.3 - no migration needed")
            
        else:
            print(f"Unknown database version: {current_version}")
            print("Please check the database manually")
            return False
        
        # Verify migration
        final_version = get_database_version(conn)
        print(f"Migration completed successfully. Database version: {final_version}")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"Migration failed: {e}")
        print(f"Database backup is available at: {backup_path}")
        return False

if __name__ == "__main__":
    print("BOM Version Control Database Migration")
    print("=====================================")
    
    success = run_migration()
    
    if success:
        print("\n✅ Migration completed successfully!")
        print("You can now use the enhanced BOM version control features.")
    else:
        print("\n❌ Migration failed!")
        print("Please check the error messages above and try again.")
        sys.exit(1)