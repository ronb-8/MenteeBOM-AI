#!/usr/bin/env python3
"""
Migration script to add vendor list and currency features
- Creates vendor_list table
- Creates currency_exchange_rate table
- Adds currency and exchange_rate columns to PO table
- Adds currency, original_unit_cost, original_currency columns to POItem table
- Adds source_currency and source_unit_cost columns to Part table

Usage:
    python migrate_vendor_list_and_currency.py
"""

import sqlite3
import os
import sys
from datetime import datetime

def migrate_vendor_list_and_currency():
    """Add vendor list and currency features to database"""
    
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
        
        changes_made = False
        
        # Create vendor_list table
        print("Creating 'vendor_list' table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vendor_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(200) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                FOREIGN KEY (created_by) REFERENCES user(id)
            )
        """)
        print("✅ Created 'vendor_list' table")
        changes_made = True
        
        # Create currency_exchange_rate table
        print("Creating 'currency_exchange_rate' table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS currency_exchange_rate (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                base_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                target_currency VARCHAR(10) NOT NULL,
                rate REAL NOT NULL,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                source VARCHAR(20) DEFAULT 'api',
                UNIQUE(base_currency, target_currency)
            )
        """)
        print("✅ Created 'currency_exchange_rate' table")
        changes_made = True
        
        # Check existing columns in PO table
        cursor.execute("PRAGMA table_info(po)")
        po_columns = [column[1] for column in cursor.fetchall()]
        
        # Add currency column to PO table
        if 'currency' not in po_columns:
            print("Adding 'currency' column to 'po' table...")
            cursor.execute("ALTER TABLE po ADD COLUMN currency VARCHAR(10) DEFAULT 'USD' NOT NULL")
            changes_made = True
        else:
            print("✅ Column 'currency' already exists in 'po' table")
        
        # Add exchange_rate column to PO table
        if 'exchange_rate' not in po_columns:
            print("Adding 'exchange_rate' column to 'po' table...")
            cursor.execute("ALTER TABLE po ADD COLUMN exchange_rate REAL")
            changes_made = True
        else:
            print("✅ Column 'exchange_rate' already exists in 'po' table")
        
        # Check existing columns in POItem table
        cursor.execute("PRAGMA table_info(po_item)")
        po_item_columns = [column[1] for column in cursor.fetchall()]
        
        # Add currency column to POItem table
        if 'currency' not in po_item_columns:
            print("Adding 'currency' column to 'po_item' table...")
            cursor.execute("ALTER TABLE po_item ADD COLUMN currency VARCHAR(10) DEFAULT 'USD' NOT NULL")
            changes_made = True
        else:
            print("✅ Column 'currency' already exists in 'po_item' table")
        
        # Add original_unit_cost column to POItem table
        if 'original_unit_cost' not in po_item_columns:
            print("Adding 'original_unit_cost' column to 'po_item' table...")
            cursor.execute("ALTER TABLE po_item ADD COLUMN original_unit_cost REAL")
            changes_made = True
        else:
            print("✅ Column 'original_unit_cost' already exists in 'po_item' table")
        
        # Add original_currency column to POItem table
        if 'original_currency' not in po_item_columns:
            print("Adding 'original_currency' column to 'po_item' table...")
            cursor.execute("ALTER TABLE po_item ADD COLUMN original_currency VARCHAR(10)")
            changes_made = True
        else:
            print("✅ Column 'original_currency' already exists in 'po_item' table")
        
        # Check existing columns in Part table
        cursor.execute("PRAGMA table_info(part)")
        part_columns = [column[1] for column in cursor.fetchall()]
        
        # Add source_currency column to Part table
        if 'source_currency' not in part_columns:
            print("Adding 'source_currency' column to 'part' table...")
            cursor.execute("ALTER TABLE part ADD COLUMN source_currency VARCHAR(10)")
            changes_made = True
        else:
            print("✅ Column 'source_currency' already exists in 'part' table")
        
        # Add source_unit_cost column to Part table
        if 'source_unit_cost' not in part_columns:
            print("Adding 'source_unit_cost' column to 'part' table...")
            cursor.execute("ALTER TABLE part ADD COLUMN source_unit_cost REAL")
            changes_made = True
        else:
            print("✅ Column 'source_unit_cost' already exists in 'part' table")
        
        # Update existing PO records to have currency='USD' (default)
        print("Updating existing PO records to have currency='USD'...")
        cursor.execute("UPDATE po SET currency = 'USD' WHERE currency IS NULL OR currency = ''")
        updated_count = cursor.rowcount
        if updated_count > 0:
            print(f"✅ Updated {updated_count} existing PO records")
            changes_made = True
        
        # Update existing POItem records to have currency='USD' (default)
        print("Updating existing POItem records to have currency='USD'...")
        cursor.execute("UPDATE po_item SET currency = 'USD' WHERE currency IS NULL OR currency = ''")
        updated_count = cursor.rowcount
        if updated_count > 0:
            print(f"✅ Updated {updated_count} existing POItem records")
            changes_made = True
        
        # Create indexes for better performance
        print("Creating indexes...")
        try:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_vendor_list_name ON vendor_list(name)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_currency_exchange_rate_target ON currency_exchange_rate(target_currency)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_po_currency ON po(currency)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_po_item_currency ON po_item(currency)")
            print("✅ Created indexes")
        except sqlite3.Error as e:
            print(f"⚠️  Warning: Could not create some indexes (this is okay): {e}")
        
        if not changes_made:
            print("Migration not needed - all tables and columns already exist.")
            conn.close()
            return True
        
        # Commit changes
        conn.commit()
        
        # Verify the changes
        print("\nVerifying migration...")
        
        # Check vendor_list table
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='vendor_list'")
        if cursor.fetchone():
            print("✅ vendor_list table exists")
        else:
            print("❌ vendor_list table not found")
            return False
        
        # Check currency_exchange_rate table
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='currency_exchange_rate'")
        if cursor.fetchone():
            print("✅ currency_exchange_rate table exists")
        else:
            print("❌ currency_exchange_rate table not found")
            return False
        
        # Verify PO columns
        cursor.execute("PRAGMA table_info(po)")
        po_columns = [column[1] for column in cursor.fetchall()]
        required_po_columns = ['currency', 'exchange_rate']
        for col in required_po_columns:
            if col in po_columns:
                print(f"✅ PO table has '{col}' column")
            else:
                print(f"❌ PO table missing '{col}' column")
                return False
        
        # Verify POItem columns
        cursor.execute("PRAGMA table_info(po_item)")
        po_item_columns = [column[1] for column in cursor.fetchall()]
        required_po_item_columns = ['currency', 'original_unit_cost', 'original_currency']
        for col in required_po_item_columns:
            if col in po_item_columns:
                print(f"✅ POItem table has '{col}' column")
            else:
                print(f"❌ POItem table missing '{col}' column")
                return False
        
        # Verify Part columns
        cursor.execute("PRAGMA table_info(part)")
        part_columns = [column[1] for column in cursor.fetchall()]
        required_part_columns = ['source_currency', 'source_unit_cost']
        for col in required_part_columns:
            if col in part_columns:
                print(f"✅ Part table has '{col}' column")
            else:
                print(f"❌ Part table missing '{col}' column")
                return False
        
        conn.close()
        return True
            
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
    print("Migration: Add Vendor List and Currency Features")
    print("=" * 60)
    print()
    
    success = migrate_vendor_list_and_currency()
    
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
