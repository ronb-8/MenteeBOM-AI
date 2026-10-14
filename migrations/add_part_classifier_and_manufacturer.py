#!/usr/bin/env python3
"""
Database Migration Script: Add Part Classifier and Manufacturer Columns
This script:
1. Creates a backup of the database
2. Creates the PartClassificationRule table
3. Adds manufacturer and manufacturer_pn columns to Part table
4. Migrates existing hardcoded classification rules to the database
"""

import os
import sys
import sqlite3
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

def backup_database(db_path):
    """Create a backup of the existing database using the same method as admin backup"""
    try:
        # Get user's Documents folder
        documents_path = Path.home() / "Documents"
        backup_dir = documents_path / "MenteeBOM Data" / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Create backup filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"menteebom_backup_before_migration_{timestamp}.zip"
        backup_path = backup_dir / backup_filename
        
        print(f"Creating backup: {backup_path}")
        
        # Create ZIP archive
        with zipfile.ZipFile(backup_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Backup database
            if os.path.exists(db_path):
                zipf.write(db_path, 'menteebom.db')
                print(f"✓ Database backed up to {backup_path}")
            else:
                print(f"⚠ Warning: Database file not found at {db_path}")
        
        return str(backup_path)
    except Exception as e:
        print(f"⚠ Warning: Could not create backup: {e}")
        return None

def check_table_exists(conn, table_name):
    """Check if a table exists in the database"""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name=?
    """, (table_name,))
    return cursor.fetchone() is not None

def check_column_exists(conn, table_name, column_name):
    """Check if a column exists in a table"""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [row[1] for row in cursor.fetchall()]
    return column_name in columns

def create_part_classification_rule_table(conn):
    """Create the PartClassificationRule table"""
    cursor = conn.cursor()
    
    if check_table_exists(conn, 'part_classification_rule'):
        print("✓ PartClassificationRule table already exists")
        return False
    
    print("Creating PartClassificationRule table...")
    cursor.execute("""
        CREATE TABLE part_classification_rule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            part_type VARCHAR(100) NOT NULL,
            keyword VARCHAR(200) NOT NULL,
            classification_method VARCHAR(50) DEFAULT 'keyword',
            priority INTEGER DEFAULT 100,
            is_active BOOLEAN DEFAULT 1,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES user(id)
        )
    """)
    
    # Create index for faster lookups
    cursor.execute("""
        CREATE INDEX idx_part_classification_rule_part_type 
        ON part_classification_rule(part_type)
    """)
    
    cursor.execute("""
        CREATE INDEX idx_part_classification_rule_keyword 
        ON part_classification_rule(keyword)
    """)
    
    cursor.execute("""
        CREATE INDEX idx_part_classification_rule_active 
        ON part_classification_rule(is_active, priority)
    """)
    
    conn.commit()
    print("✓ PartClassificationRule table created successfully")
    return True

def add_manufacturer_columns(conn):
    """Add manufacturer and manufacturer_pn columns to Part table"""
    cursor = conn.cursor()
    changes_made = False
    
    if not check_table_exists(conn, 'part'):
        print("⚠ Warning: Part table does not exist. Skipping manufacturer columns.")
        return False
    
    if not check_column_exists(conn, 'part', 'manufacturer'):
        print("Adding manufacturer column to Part table...")
        cursor.execute("ALTER TABLE part ADD COLUMN manufacturer VARCHAR(200)")
        changes_made = True
        print("✓ manufacturer column added")
    else:
        print("✓ manufacturer column already exists")
    
    if not check_column_exists(conn, 'part', 'manufacturer_pn'):
        print("Adding manufacturer_pn column to Part table...")
        cursor.execute("ALTER TABLE part ADD COLUMN manufacturer_pn VARCHAR(200)")
        changes_made = True
        print("✓ manufacturer_pn column added")
    else:
        print("✓ manufacturer_pn column already exists")
    
    if changes_made:
        conn.commit()
    
    return changes_made

def migrate_classification_rules(conn):
    """Migrate hardcoded classification rules from part_classifier.py to database"""
    cursor = conn.cursor()
    
    # Check if rules already exist
    cursor.execute("SELECT COUNT(*) FROM part_classification_rule")
    existing_count = cursor.fetchone()[0]
    if existing_count > 0:
        print(f"✓ {existing_count} classification rules already exist in database. Skipping migration.")
        return False
    
    print("Migrating hardcoded classification rules to database...")
    
    # Define rules with priorities (lower = higher priority)
    # Priority order: 3D printing (10), patterns (20), keywords (30+)
    rules = [
        # 3D Printing indicators (highest priority - checked first)
        ('3D Printing part', '3D', '3d_printing', 10, True),
        ('3D Printing part', '3D Print', '3d_printing', 10, True),
        ('3D Printing part', '3D Printing', '3d_printing', 10, True),
        ('3D Printing part', 'Print', '3d_printing', 10, True),
        ('3D Printing part', 'Printed', '3d_printing', 10, True),
        
        # Pattern-based classifications (medium priority)
        ('Assembly', '-AS-', 'pattern', 20, True),
        ('Mechanical part', '-MP-', 'pattern', 20, True),
        ('Inhouse electrical part', 'EL-', 'pattern', 20, True),
        ('External electrical part', 'ES-', 'pattern', 20, True),
        ('Cables', 'CB-', 'pattern', 20, True),
        ('Motors', 'ILM', 'keyword', 25, True),
        ('Gears', 'CSG', 'keyword', 25, True),
        ('Gears', 'CPL', 'keyword', 25, True),
        
        # Cross Roller Bearings (keyword-based)
        ('Cross Roller Bearings', 'SRAU', 'keyword', 30, True),
        ('Cross Roller Bearings', 'SFT', 'keyword', 30, True),
        ('Cross Roller Bearings', 'SRBE', 'keyword', 30, True),
        
        # Bearings (keyword-based)
        ('Bearings', 'SKF', 'keyword', 35, True),
        ('Bearings', 'Bearing', 'keyword', 35, True),
        ('Bearings', 'NSK', 'keyword', 35, True),
        ('Bearings', 'PCM', 'keyword', 35, True),
        ('Bearings', 'PCMF', 'keyword', 35, True),
        ('Bearings', 'bearing', 'keyword', 35, True),
        ('Bearings', 'skf', 'keyword', 35, True),
        ('Bearings', 'PG', 'keyword', 35, True),
        ('Bearings', 'pcmf', 'keyword', 35, True),
        
        # Fasteners (keyword-based)
        ('Fasteners', 'DIN', 'keyword', 40, True),
        ('Fasteners', 'Screw', 'keyword', 40, True),
        ('Fasteners', 'Nut', 'keyword', 40, True),
        ('Fasteners', 'Washer', 'keyword', 40, True),
        ('Fasteners', 'PEM', 'keyword', 40, True),
        ('Fasteners', 'ISO', 'keyword', 40, True),
        ('Fasteners', 'PIN', 'keyword', 40, True),
        ('Fasteners', 'PT-WN', 'keyword', 40, True),
        ('Fasteners', 'Pin', 'keyword', 40, True),
        ('Fasteners', 'Magnet', 'keyword', 40, True),
        ('Fasteners', 'IUTB', 'keyword', 40, True),
        ('Fasteners', 'CLS', 'keyword', 40, True),
        ('Fasteners', 'BN', 'keyword', 40, True),
        ('Fasteners', 'Stand-off', 'keyword', 40, True),
        ('Fasteners', 'Belleville', 'keyword', 40, True),
    ]
    
    cursor.executemany("""
        INSERT INTO part_classification_rule 
        (part_type, keyword, classification_method, priority, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    """, rules)
    
    conn.commit()
    print(f"✓ Migrated {len(rules)} classification rules to database")
    return True

def main():
    """Main migration function"""
    print("=" * 60)
    print("Database Migration: Part Classifier & Manufacturer Columns")
    print("=" * 60)
    print()
    
    # Determine database path
    db_path = os.path.join('instance', 'menteebom.db')
    if not os.path.exists(db_path):
        # Try alternative path
        db_path = 'menteebom.db'
        if not os.path.exists(db_path):
            print(f"❌ Error: Database file not found at {db_path}")
            print("Please run this script from the MenteeBOM-Web directory")
            sys.exit(1)
    
    print(f"Database path: {db_path}")
    print()
    
    # Create backup
    print("Step 1: Creating database backup...")
    backup_path = backup_database(db_path)
    if backup_path:
        print(f"✓ Backup created: {backup_path}")
    else:
        response = input("⚠ Backup failed. Continue anyway? (yes/no): ")
        if response.lower() != 'yes':
            print("Migration cancelled.")
            sys.exit(1)
    print()
    
    # Connect to database
    print("Step 2: Connecting to database...")
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        print("✓ Connected to database")
    except Exception as e:
        print(f"❌ Error connecting to database: {e}")
        sys.exit(1)
    print()
    
    try:
        # Create PartClassificationRule table
        print("Step 3: Creating PartClassificationRule table...")
        table_created = create_part_classification_rule_table(conn)
        print()
        
        # Add manufacturer columns
        print("Step 4: Adding manufacturer columns to Part table...")
        columns_added = add_manufacturer_columns(conn)
        print()
        
        # Migrate classification rules
        print("Step 5: Migrating classification rules...")
        rules_migrated = migrate_classification_rules(conn)
        print()
        
        # Summary
        print("=" * 60)
        print("Migration Summary")
        print("=" * 60)
        print(f"✓ PartClassificationRule table: {'Created' if table_created else 'Already exists'}")
        print(f"✓ Manufacturer columns: {'Added' if columns_added else 'Already exist'}")
        print(f"✓ Classification rules: {'Migrated' if rules_migrated else 'Already exist'}")
        print()
        
        if backup_path:
            print(f"✓ Backup saved to: {backup_path}")
        print()
        print("✅ Migration completed successfully!")
        print()
        print("Next steps:")
        print("1. Restart the MenteeBOM application")
        print("2. The part classifier will now use database rules")
        print("3. You can manage rules in the Admin > Part Classifier tab")
        print()
        
    except Exception as e:
        print(f"❌ Error during migration: {e}")
        import traceback
        traceback.print_exc()
        print()
        print("⚠ Migration failed. You can restore from backup if needed.")
        if backup_path:
            print(f"Backup location: {backup_path}")
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()

if __name__ == '__main__':
    main()

