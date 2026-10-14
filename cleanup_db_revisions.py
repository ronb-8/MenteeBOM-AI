#!/usr/bin/env python3
"""
Clean up database to match PDM exports (PDM is source of truth).
Remove any revisions from the database that don't exist in PDM.

For assembly 034-AS-01141:
- PDM has: REV01
- Database has: REV01 and REV02
- Action: Delete REV02 (ID 1010) since it doesn't exist in PDM
"""

import sys
from app import app, db, Part, BOMPart

print("[INFO] Database cleanup to match PDM (PDM is source of truth)")
print("=" * 60)

with app.app_context():
    part_number = "034-AS-01141"

    # Get all versions from database
    parts = Part.query.filter_by(part_number=part_number).order_by(Part.revision.desc()).all()

    print(f"\n[INFO] Current database for {part_number}:")
    for part in parts:
        print(f"  - REV{part.revision} (ID {part.id}, ECO: {part.eco_number})")

    # PDM has REV01
    pdm_revision = "01"
    print(f"\n[INFO] PDM has: REV{pdm_revision}")

    # Find which revisions need to be deleted
    to_delete = [p for p in parts if p.revision != pdm_revision]

    if not to_delete:
        print(f"\n[OK] Database already matches PDM. No cleanup needed.")
        sys.exit(0)

    print(f"\n[WARNING] Found {len(to_delete)} revision(s) in database that don't exist in PDM:")
    for part in to_delete:
        print(f"  - REV{part.revision} (ID {part.id}, ECO: {part.eco_number})")

    # Check for BOMPart references
    print(f"\n[INFO] Checking for BOMPart references...")
    for part in to_delete:
        bom_parts = BOMPart.query.filter_by(part_id=part.id).all()
        if bom_parts:
            print(f"  WARNING: REV{part.revision} (ID {part.id}) is referenced by {len(bom_parts)} BOM(s)")
            for bp in bom_parts:
                print(f"    - BOM ID {bp.bom_id}")

    # Confirm deletion
    print(f"\n[ACTION] Deleting {len(to_delete)} incorrect revision(s)...")
    for part in to_delete:
        # Delete BOMPart references first
        bom_parts = BOMPart.query.filter_by(part_id=part.id).all()
        deleted_bom_count = len(bom_parts)
        for bp in bom_parts:
            db.session.delete(bp)

        # Delete the Part record
        print(f"  Deleting REV{part.revision} (ID {part.id})")
        if deleted_bom_count > 0:
            print(f"    - Removed {deleted_bom_count} BOMPart reference(s)")
        db.session.delete(part)

    # Commit changes
    try:
        db.session.commit()
        print(f"\n[SUCCESS] Database cleanup completed!")
        print(f"\n[INFO] Final state for {part_number}:")

        # Verify final state
        final_parts = Part.query.filter_by(part_number=part_number).all()
        for part in final_parts:
            print(f"  - REV{part.revision} (ID {part.id}, ECO: {part.eco_number})")

    except Exception as e:
        db.session.rollback()
        print(f"\n[ERROR] Failed to commit changes: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

print("\n" + "=" * 60)
