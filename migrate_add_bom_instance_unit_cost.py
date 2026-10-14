"""
Migration script to add unit_cost column to BOMInstance table.
This makes BOM costs the single source of truth.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, BOMInstance, BOMPart, Part

def migrate_add_bom_instance_unit_cost():
    """Add unit_cost column to BOMInstance and populate it"""
    with app.app_context():
        try:
            # Check if column already exists
            inspector = db.inspect(db.engine)
            columns = [col['name'] for col in inspector.get_columns('bom_instance')]
            
            if 'unit_cost' in columns:
                print("Column 'unit_cost' already exists in bom_instance table")
                return
            
            # Add the column
            print("Adding unit_cost column to bom_instance table...")
            db.engine.execute('ALTER TABLE bom_instance ADD COLUMN unit_cost REAL')
            db.session.commit()
            print("✓ Column added successfully")
            
            # Populate unit_cost for all BOMInstances
            print("\nPopulating unit_cost for all BOMInstances...")
            all_boms = BOMInstance.query.all()
            updated_count = 0
            
            for bom in all_boms:
                # Get all parts in this BOM
                bom_parts = BOMPart.query.filter_by(bom_id=bom.id).all()
                
                # Get main assembly part to exclude it
                main_assembly_part = Part.query.filter_by(
                    part_number=bom.assembly_part_number,
                    revision=bom.assembly_revision
                ).first()
                main_assembly_part_id = main_assembly_part.id if main_assembly_part else None
                
                # Sum all price_per_bom excluding the main assembly
                total_cost = sum(
                    (bp.price_per_bom or 0) for bp in bom_parts 
                    if main_assembly_part_id is None or bp.part_id != main_assembly_part_id
                )
                
                bom.unit_cost = total_cost
                updated_count += 1
                
                if updated_count % 10 == 0:
                    print(f"  Processed {updated_count} BOMs...")
            
            db.session.commit()
            print(f"✓ Updated unit_cost for {updated_count} BOMInstances")
            
        except Exception as e:
            db.session.rollback()
            print(f"Error during migration: {e}")
            import traceback
            traceback.print_exc()
            raise

if __name__ == '__main__':
    migrate_add_bom_instance_unit_cost()
