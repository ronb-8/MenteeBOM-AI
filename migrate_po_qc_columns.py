#!/usr/bin/env python3
"""
Migration script to add qty_arrived and qty_approved columns to po_qc_item table
"""

from app import app, db
from sqlalchemy import text
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_po_qc_columns():
    """Add qty_arrived and qty_approved columns to po_qc_item table"""
    with app.app_context():
        try:
            # Check if table exists
            inspector = db.inspect(db.engine)
            tables = inspector.get_table_names()
            
            if 'po_qc_item' not in tables:
                logger.warning("Table 'po_qc_item' does not exist. It will be created when the model is initialized.")
                return
            
            # Check if columns already exist
            existing_columns = [col['name'] for col in inspector.get_columns('po_qc_item')]
            
            new_columns = [
                ('qty_arrived', 'FLOAT'),
                ('qty_approved', 'FLOAT')
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
                        db.session.execute(text(f"ALTER TABLE po_qc_item ADD COLUMN {col_name} {col_type}"))
                        logger.info(f"✅ Added column: {col_name}")
                    except Exception as e:
                        logger.error(f"❌ Failed to add column {col_name}: {e}")
                        db.session.rollback()
                        raise
                
                # Commit changes
                db.session.commit()
                logger.info("✅ Migration completed successfully!")
            else:
                logger.info("✅ All columns already exist. No migration needed.")
                
        except Exception as e:
            db.session.rollback()
            logger.error(f"❌ Migration failed: {e}")
            raise

if __name__ == '__main__':
    migrate_po_qc_columns()

