"""
Migration script to propagate PO data across revisions of the same part number.

This script:
1. Finds all parts with the same part_number
2. Identifies which revision has the most complete PO data
3. Propagates unit_cost, po_orders, order_qty, and vendor to all other revisions
4. Updates BOMPart.price_per_bom for affected parts
"""

import sys
import os
import json

# Add the parent directory to the path so we can import app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, Part, BOMPart

def propagate_po_data_across_revisions():
    """
    Propagate PO data (unit_cost, po_orders, order_qty, vendor) from one revision
    to all other revisions of the same part number.
    """
    with app.app_context():
        try:
            # Get all unique part numbers
            part_numbers = db.session.query(Part.part_number).distinct().all()
            part_numbers = [pn[0] for pn in part_numbers if pn[0]]
            
            total_updated = 0
            total_parts_affected = 0
            
            print(f"Processing {len(part_numbers)} unique part numbers...")
            
            for part_number in part_numbers:
                # Get all revisions of this part
                all_revisions = Part.query.filter_by(part_number=part_number).all()
                
                if len(all_revisions) <= 1:
                    continue  # Only one revision, nothing to propagate
                
                # Find the revision with the most complete PO data
                best_revision = None
                best_score = 0
                
                for part in all_revisions:
                    score = 0
                    # Score based on completeness of PO data
                    if part.unit_cost and part.unit_cost > 0:
                        score += 4
                    if part.po_orders:
                        try:
                            po_data = json.loads(part.po_orders) if isinstance(part.po_orders, str) else part.po_orders
                            if po_data and len(po_data) > 0:
                                score += 3
                        except:
                            pass
                    if part.order_qty and part.order_qty > 0:
                        score += 2
                    if part.vendor:
                        score += 1
                    
                    if score > best_score:
                        best_score = score
                        best_revision = part
                
                # If we found a revision with PO data, propagate it
                if best_revision and best_score > 0:
                    propagated_count = 0
                    
                    for part in all_revisions:
                        if part.id == best_revision.id:
                            continue  # Skip the source revision
                        
                        updated = False
                        
                        # Propagate unit_cost if target doesn't have it
                        if not part.unit_cost or part.unit_cost == 0:
                            if best_revision.unit_cost and best_revision.unit_cost > 0:
                                part.unit_cost = best_revision.unit_cost
                                updated = True
                        
                        # Propagate po_orders if target doesn't have it
                        if not part.po_orders:
                            if best_revision.po_orders:
                                part.po_orders = best_revision.po_orders
                                updated = True
                        
                        # Propagate order_qty if target doesn't have it
                        if not part.order_qty or part.order_qty == 0:
                            if best_revision.order_qty and best_revision.order_qty > 0:
                                part.order_qty = best_revision.order_qty
                                updated = True
                        
                        # Propagate vendor if target doesn't have it
                        if not part.vendor:
                            if best_revision.vendor:
                                part.vendor = best_revision.vendor
                                updated = True
                        
                        if updated:
                            propagated_count += 1
                            total_parts_affected += 1
                            
                            # Update BOMPart.price_per_bom for this part
                            bom_parts = BOMPart.query.filter_by(part_id=part.id).all()
                            for bom_part in bom_parts:
                                if part.unit_cost and bom_part.quantity:
                                    bom_part.price_per_bom = float(part.unit_cost) * float(bom_part.quantity)
                    
                    if propagated_count > 0:
                        total_updated += 1
                        print(f"  {part_number}: Propagated data to {propagated_count} revision(s)")
            
            # Commit all changes
            db.session.commit()
            
            print(f"\nMigration completed!")
            print(f"  - {total_updated} part numbers updated")
            print(f"  - {total_parts_affected} individual parts updated")
            
            return {
                'success': True,
                'part_numbers_updated': total_updated,
                'parts_affected': total_parts_affected
            }
            
        except Exception as e:
            db.session.rollback()
            print(f"Error during migration: {str(e)}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': str(e)
            }

if __name__ == '__main__':
    print("Starting PO data propagation migration...")
    result = propagate_po_data_across_revisions()
    
    if result['success']:
        print(f"\n✓ Migration successful!")
        sys.exit(0)
    else:
        print(f"\n✗ Migration failed: {result.get('error', 'Unknown error')}")
        sys.exit(1)
