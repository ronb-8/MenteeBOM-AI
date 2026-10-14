#!/usr/bin/env python3
"""
Migration script to add lead_time and parent_po_id columns to PO table
Run this script to add the lead_time and parent_po_id columns to the po table in the database.

Usage:
    python migrate_add_po_lead_time_and_parent.py
"""

import sqlite3
import os
import sys

def migrate_add_po_lead_time_and_parent():
    """Add lead_time and parent_po_id columns to po table"""
    
    # Get database path - check both root and instance folder
    db_paths = ['instance/menteebom.db', 'menteebom.db']
    db_path = None
    
    for path in db_paths:
        if os.path.exists(path):
            db_path = path
            break
    
    if not db_path:
        print(f"Error: Database file not found. Checked:")
        for path in db_paths:
            print(f"  - {path}")
        print("Please run this script from the MenteeBOM-Web directory")
        return False
    
    print(f"Using database: {db_path}")
    
    try:
        # Connect to database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(po)")
        columns = [column[1] for column in cursor.fetchall()]
        
        changes_made = False
        
        # Add lead_time column if it doesn't exist
        if 'lead_time' not in columns:
            print("Adding 'lead_time' column to 'po' table...")
            cursor.execute("ALTER TABLE po ADD COLUMN lead_time INTEGER")
            changes_made = True
        else:
            print("✅ Column 'lead_time' already exists in 'po' table")
        
        # Add parent_po_id column if it doesn't exist
        if 'parent_po_id' not in columns:
            print("Adding 'parent_po_id' column to 'po' table...")
            cursor.execute("ALTER TABLE po ADD COLUMN parent_po_id INTEGER")
            changes_made = True
            
            # Add foreign key constraint (SQLite doesn't support adding FK constraints via ALTER TABLE,
            # but we can create an index for better performance)
            print("Creating index on 'parent_po_id' column...")
            try:
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_po_parent_po_id ON po(parent_po_id)")
            except sqlite3.Error as e:
                print(f"⚠️  Warning: Could not create index (this is okay): {e}")
        else:
            print("✅ Column 'parent_po_id' already exists in 'po' table")
        
        if not changes_made:
            print("Migration not needed - all columns already exist.")
            conn.close()
            return True
        
        # Commit changes
        conn.commit()
        
        # Verify the columns were added
        cursor.execute("PRAGMA table_info(po)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'lead_time' in columns and 'parent_po_id' in columns:
            print(f"✅ Successfully added columns to 'po' table")
            print(f"   - lead_time: INTEGER (nullable)")
            print(f"   - parent_po_id: INTEGER (nullable, foreign key to po.id)")
            conn.close()
            return True
        else:
            print("❌ Error: Columns were not added successfully")
            missing = []
            if 'lead_time' not in columns:
                missing.append('lead_time')
            if 'parent_po_id' not in columns:
                missing.append('parent_po_id')
            print(f"   Missing columns: {', '.join(missing)}")
            conn.rollback()
            conn.close()
            return False
            
    except sqlite3.Error as e:
        print(f"❌ Database error: {e}")
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("Migration: Add lead_time and parent_po_id columns to PO table")
    print("=" * 60)
    print()
    
    success = migrate_add_po_lead_time_and_parent()
    
    print()
    if success:
        print("=" * 60)
        print("✅ Migration completed successfully!")
        print("=" * 60)
        sys.exit(0)
    else:
        print("=" * 60)
        print("❌ Migration failed!")
        print("=" * 60)
        sys.exit(1)
