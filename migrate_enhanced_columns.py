#!/usr/bin/env python3
"""
Migration script to add enhanced columns to BOMItem table
"""

from app import app, db
from sqlalchemy import text
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_enhanced_columns():
    """Add new columns to BOMItem table"""
    with app.app_context():
        try:
            # Check if columns already exist
            inspector = db.inspect(db.engine)
            existing_columns = [col['name'] for col in inspector.get_columns('bom_item')]
            
            new_columns = [
                ('vendor', 'VARCHAR(200)'),
                ('order_qty', 'FLOAT'),
                ('price_per_robot', 'FLOAT'),
                ('po_orders', 'TEXT'),
                ('inventory', 'INTEGER'),
                ('warehouse_box_number', 'VARCHAR(50)')
            ]
            
            columns_to_add = []
            for col_name, col_type in new_columns:
                if col_name not in existing_columns:
                    columns_to_add.append((col_name, col_type))
                    logger.info(f"Will add column: {col_name}")
                else:
                    logger.info(f"Column {col_name} already exists, skipping")
            
            if columns_to_add:
                # Add new columns
                for col_name, col_type in columns_to_add:
                    try:
                        db.engine.execute(text(f"ALTER TABLE bom_item ADD COLUMN {col_name} {col_type}"))
                        logger.info(f"✅ Added column: {col_name}")
                    except Exception as e:
                        logger.error(f"❌ Failed to add column {col_name}: {e}")
                
                # Commit changes
                db.session.commit()
                logger.info("✅ Migration completed successfully!")
                
                # Update existing BOM items with default values
                logger.info("Updating existing BOM items with default values...")
                db.engine.execute(text("""
                    UPDATE bom_item 
                    SET vendor = NULL,
                        order_qty = NULL,
                        price_per_robot = NULL,
                        po_orders = NULL,
                        inventory = NULL,
                        warehouse_box_number = NULL
                    WHERE vendor IS NULL
                """))
                db.session.commit()
                logger.info("✅ Updated existing BOM items")
                
            else:
                logger.info("ℹ️  No new columns to add - all columns already exist")
                
        except Exception as e:
            logger.error(f"❌ Migration failed: {e}")
            db.session.rollback()
            raise

def verify_migration():
    """Verify that all new columns exist"""
    with app.app_context():
        try:
            inspector = db.inspect(db.engine)
            columns = [col['name'] for col in inspector.get_columns('bom_item')]
            
            required_columns = [
                'vendor', 'order_qty', 'price_per_robot', 
                'po_orders', 'inventory', 'warehouse_box_number'
            ]
            
            missing_columns = [col for col in required_columns if col not in columns]
            
            if missing_columns:
                logger.error(f"❌ Missing columns: {missing_columns}")
                return False
            else:
                logger.info("✅ All required columns exist")
                return True
                
        except Exception as e:
            logger.error(f"❌ Verification failed: {e}")
            return False

if __name__ == '__main__':
    print("🔄 Starting enhanced columns migration...")
    migrate_enhanced_columns()
    
    print("🔍 Verifying migration...")
    if verify_migration():
        print("🎉 Migration completed successfully!")
        print("New columns added:")
        print("  - vendor (VARCHAR(200))")
        print("  - order_qty (FLOAT)")
        print("  - price_per_robot (FLOAT)")
        print("  - po_orders (TEXT)")
        print("  - inventory (INTEGER)")
        print("  - warehouse_box_number (VARCHAR(50))")
    else:
        print("❌ Migration verification failed!")
