#!/usr/bin/env python3
"""
Migration script to add custom column tables to MenteeBOM database
This script adds the new tables without affecting existing data
"""

import os
import sys
from datetime import datetime

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, CustomBOMColumn, BOMItemCustomData

def migrate_database():
    """Add custom column tables to the database"""
    print("Starting custom columns migration...")
    
    with app.app_context():
        try:
            # Create the new tables
            print("Creating CustomBOMColumn table...")
            db.create_all()
            
            # Check if tables were created successfully
            from sqlalchemy import inspect
            inspector = inspect(db.engine)
            tables = inspector.get_table_names()
            
            if 'custom_bom_column' in tables:
                print("SUCCESS: CustomBOMColumn table created successfully")
            else:
                print("ERROR: Failed to create CustomBOMColumn table")
                return False
                
            if 'bom_item_custom_data' in tables:
                print("SUCCESS: BOMItemCustomData table created successfully")
            else:
                print("ERROR: Failed to create BOMItemCustomData table")
                return False
            
            # Verify the tables have the correct structure
            print("Verifying table structure...")
            
            # Check CustomBOMColumn columns
            custom_columns = inspector.get_columns('custom_bom_column')
            expected_custom_columns = ['id', 'column_name', 'column_type', 'display_order', 'is_active', 'select_options', 'created_by', 'created_at']
            custom_column_names = [col['name'] for col in custom_columns]
            
            for expected_col in expected_custom_columns:
                if expected_col not in custom_column_names:
                    print(f"ERROR: Missing column '{expected_col}' in CustomBOMColumn table")
                    return False
            
            print("SUCCESS: CustomBOMColumn table structure verified")
            
            # Check BOMItemCustomData columns
            data_columns = inspector.get_columns('bom_item_custom_data')
            expected_data_columns = ['id', 'bom_item_id', 'column_id', 'value', 'updated_by', 'updated_at']
            data_column_names = [col['name'] for col in data_columns]
            
            for expected_col in expected_data_columns:
                if expected_col not in data_column_names:
                    print(f"ERROR: Missing column '{expected_col}' in BOMItemCustomData table")
                    return False
            
            print("SUCCESS: BOMItemCustomData table structure verified")
            
            print("Migration completed successfully!")
            print("New tables available:")
            print("   - custom_bom_column: Store custom column definitions")
            print("   - bom_item_custom_data: Store custom column data for BOM items")
            
            return True
            
        except Exception as e:
            print(f"ERROR: Migration failed with error: {str(e)}")
            return False

def rollback_migration():
    """Rollback the migration by dropping the new tables"""
    print("Rolling back custom columns migration...")
    
    with app.app_context():
        try:
            # Drop the new tables
            db.drop_all()
            print("SUCCESS: Custom column tables dropped successfully")
            return True
        except Exception as e:
            print(f"ERROR: Rollback failed with error: {str(e)}")
            return False

if __name__ == "__main__":
    print("=" * 60)
    print("MenteeBOM Custom Columns Migration")
    print("=" * 60)
    
    if len(sys.argv) > 1 and sys.argv[1] == "rollback":
        success = rollback_migration()
    else:
        success = migrate_database()
    
    if success:
        print("\nOperation completed successfully!")
        sys.exit(0)
    else:
        print("\nOperation failed!")
        sys.exit(1)
