#!/usr/bin/env python3
"""
Migration script to add total_cost column to PO table
Run this script to add the total_cost column to the po table in the database.

Usage:
    python migrate_add_po_total_cost.py
"""

import sqlite3
import os
import sys

def migrate_add_po_total_cost():
    """Add total_cost column to po table"""
    
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
        
        # Check if column already exists
        cursor.execute("PRAGMA table_info(po)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'total_cost' in columns:
            print("✅ Column 'total_cost' already exists in 'po' table")
            print("Migration not needed.")
            conn.close()
            return True
        
        print("Adding 'total_cost' column to 'po' table...")
        
        # Add the column
        cursor.execute("ALTER TABLE po ADD COLUMN total_cost REAL")
        
        # Calculate and set total_cost for existing POs from their items
        print("Calculating total_cost for existing POs from POItems...")
        cursor.execute("""
            UPDATE po 
            SET total_cost = (
                SELECT COALESCE(SUM(po_item.total_cost), 0)
                FROM po_item
                WHERE po_item.po_id = po.id
            )
        """)
        
        # Commit changes
        conn.commit()
        
        # Verify the column was added
        cursor.execute("PRAGMA table_info(po)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'total_cost' in columns:
            # Count how many POs were updated
            cursor.execute("SELECT COUNT(*) FROM po WHERE total_cost IS NOT NULL")
            updated_count = cursor.fetchone()[0]
            print(f"✅ Successfully added 'total_cost' column to 'po' table")
            print(f"✅ Updated total_cost for {updated_count} existing PO(s)")
            conn.close()
            return True
        else:
            print("❌ Error: Column was not added successfully")
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
    print("Migration: Add total_cost column to PO table")
    print("=" * 60)
    print()
    
    success = migrate_add_po_total_cost()
    
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

