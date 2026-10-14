"""
Migration script to fix revision format issues in BOMInstance table.
Fixes cases like "REVREV01" -> "REV01"
"""

import sys
import os

# Add the parent directory to the path so we can import app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, BOMInstance
from app import normalize_revision

def fix_revision_format():
    """Fix revision format in BOMInstance table - only fix double REV issues like REVREV01"""
    with app.app_context():
        # Get all BOM instances with potentially bad revisions
        all_boms = BOMInstance.query.all()
        
        fixed_count = 0
        skipped_count = 0
        
        for bom in all_boms:
            original_revision = bom.assembly_revision
            
            # Only fix if it contains "REVREV" (double REV prefix)
            # Don't fix version suffixes like "REV01-v2" as those are valid
            if 'REVREV' in original_revision.upper():
                # Extract version suffix if present (e.g., "-v2")
                version_suffix = ''
                if '-' in original_revision:
                    parts = original_revision.split('-', 1)
                    revision_part = parts[0]
                    version_suffix = '-' + parts[1] if len(parts) > 1 else ''
                else:
                    revision_part = original_revision
                
                # Normalize only the revision part
                normalized_revision_part = normalize_revision(revision_part)
                normalized_revision = normalized_revision_part + version_suffix
                
                if original_revision != normalized_revision:
                    print(f"Fixing BOM {bom.id} ({bom.assembly_part_number}): '{original_revision}' -> '{normalized_revision}'")
                    bom.assembly_revision = normalized_revision
                    fixed_count += 1
            else:
                skipped_count += 1
        
        if fixed_count > 0:
            try:
                db.session.commit()
                print(f"\n[OK] Fixed {fixed_count} BOM instances with bad revision format")
            except Exception as e:
                db.session.rollback()
                print(f"\n[ERROR] Error committing changes: {e}")
                print(f"   Fixed {fixed_count} BOMs but could not commit due to constraint violation")
                print(f"   This may happen if multiple BOMs would have the same (part_number, revision) after normalization")
        else:
            print(f"\n[OK] No BOM instances needed fixing (checked {len(all_boms)}, skipped {skipped_count})")

if __name__ == '__main__':
    fix_revision_format()
