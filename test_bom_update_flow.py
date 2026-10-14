"""
Standalone test: simulate the BOM update get-latest + scan flow for 029-AS-00836.
This mirrors what app.py does during import/update Steps 5-6.
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
_base = os.path.dirname(os.path.abspath(__file__))
os.environ['DATABASE_URI'] = f"sqlite:///{os.path.join(_base, 'instance', 'menteebom_dev.db')}"

from app import app, db, Part, BOMInstance, BOMPart
from pdm_bom_parser import PdmBomParser
from mechanical_rfq_processor import MechanicalRFQProcessor

with app.app_context():
    # 1. Find the BOM for 029-AS-00836
    bom = BOMInstance.query.filter_by(
        assembly_part_number='029-AS-00836', is_latest=True
    ).first()
    if not bom:
        print("BOM 029-AS-00836 not found!")
        sys.exit(1)

    print(f"Found BOM: {bom.name} (ID={bom.id}, rev={bom.assembly_revision}, version={bom.version})")

    # 2. Get all parts in this BOM
    bom_parts = (
        db.session.query(BOMPart, Part)
        .join(Part)
        .filter(BOMPart.bom_id == bom.id)
        .all()
    )
    print(f"Total parts in BOM: {len(bom_parts)}")

    # 3. Build parts_for_get_latest — same logic as app.py update flow
    parts_for_get_latest = []
    parts_info = []  # (part_number, revision, part_type) for scanning

    for bp, part in bom_parts:
        pn = part.part_number
        rev_raw = part.revision or ''
        pt = part.part_type or ''

        rev_clean = rev_raw.replace('REV', '').replace('rev', '').strip()
        try:
            rev_fmt = f"{int(rev_clean):02d}"
        except ValueError:
            rev_fmt = rev_clean

        extensions = ['.pdf', '.x_t']
        if pt and '3d' in pt.lower():
            extensions.append('.step')

        parts_for_get_latest.append({
            'part_number': pn,
            'revision': rev_fmt,
            'extensions': extensions,
        })

        # AI PDF for assemblies
        if '-AS-' in pn.upper():
            parts_for_get_latest.append({
                'part_number': f"{pn} AI",
                'revision': rev_fmt,
                'extensions': ['.pdf'],
            })

        parts_info.append((pn, rev_raw, pt))

    print(f"\nTotal get-latest requests: {len(parts_for_get_latest)}")
    print(f"  (includes AI entries for assemblies)")

    # Show breakdown
    assembly_count = sum(1 for pn, _, _ in parts_info if '-AS-' in pn.upper())
    printing_count = sum(1 for _, _, pt in parts_info if pt and '3d' in pt.lower())
    print(f"  Assemblies: {assembly_count}")
    print(f"  3D printing parts: {printing_count}")

    # 4. Call batch get-latest
    print(f"\n{'='*60}")
    print("STEP 1: Batch get-latest from PDM vault")
    print(f"{'='*60}")
    processor = MechanicalRFQProcessor()
    result = processor._call_pdm_get_latest(parts_for_get_latest)

    if result.get('success'):
        retrieved = result.get('retrieved', [])
        failed = result.get('failed', [])
        print(f"\nGet-latest result: {len(retrieved)} retrieved, {len(failed)} failed")
        if retrieved:
            print(f"\nRetrieved files ({len(retrieved)}):")
            for r in retrieved[:20]:
                print(f"  + {r.get('filename', '?')}")
            if len(retrieved) > 20:
                print(f"  ... and {len(retrieved) - 20} more")
        if failed:
            # Count by error type
            not_found = sum(1 for f in failed if 'not found' in f.get('error', '').lower())
            other_errors = len(failed) - not_found
            print(f"\nFailed: {not_found} not found in vault, {other_errors} other errors")
            # Show a few examples of other errors
            other_fails = [f for f in failed if 'not found' not in f.get('error', '').lower()]
            for f in other_fails[:5]:
                print(f"  ! {f.get('filename', '?')}: {f.get('error', '?')}")
    else:
        print(f"\nGet-latest FAILED: {result.get('error', 'unknown')}")

    # 5. Scan file availability
    print(f"\n{'='*60}")
    print("STEP 2: Scan PDM directory for file availability")
    print(f"{'='*60}")

    import time
    time.sleep(2)  # Give PDM cache a moment to settle

    availability = PdmBomParser.check_file_availability(parts_info)
    print(f"Scanned {len(availability)} parts")

    # 6. Count results
    has_pdf = sum(1 for flags in availability.values() if flags.get('has_pdf'))
    has_ai = sum(1 for flags in availability.values() if flags.get('has_ai_pdf'))
    has_step = sum(1 for flags in availability.values() if flags.get('has_step'))
    has_xt = sum(1 for flags in availability.values() if flags.get('has_xt'))
    has_nothing = sum(1 for flags in availability.values()
                      if not any(flags.get(k) for k in ('has_pdf', 'has_ai_pdf', 'has_step', 'has_xt')))

    print(f"\nFile availability summary:")
    print(f"  PDF:  {has_pdf}")
    print(f"  AI:   {has_ai}")
    print(f"  STEP: {has_step}")
    print(f"  XT:   {has_xt}")
    print(f"  None: {has_nothing}")

    # 7. Update DB flags
    updated = 0
    for (pn, rev), flags in availability.items():
        part = Part.query.filter_by(part_number=pn, revision=rev).first()
        if part:
            changed = False
            for key in ('has_pdf', 'has_ai_pdf', 'has_step', 'has_xt'):
                new_val = flags.get(key, False)
                if getattr(part, key) != new_val:
                    setattr(part, key, new_val)
                    changed = True
            step_json = json.dumps(flags.get('step_files', [])) if flags.get('step_files') else None
            if part.step_files != step_json:
                part.step_files = step_json
                changed = True
            if changed:
                updated += 1

    db.session.commit()
    print(f"\nUpdated {updated} parts in database")

    # 8. Verify — show parts that SHOULD have icons but don't
    print(f"\n{'='*60}")
    print("VERIFICATION: Parts with file flags after update")
    print(f"{'='*60}")

    for bp, part in bom_parts:
        icons = []
        if part.has_pdf:
            icons.append('PDF')
        if part.has_ai_pdf:
            icons.append('AI')
        if part.has_step:
            icons.append('STEP')
        if part.has_xt:
            icons.append('XT')
        if icons:
            print(f"  {part.part_number} REV{part.revision}: {', '.join(icons)}")

    # Count parts with at least one icon
    parts_with_icons = sum(1 for bp, p in bom_parts
                          if p.has_pdf or p.has_ai_pdf or p.has_step or p.has_xt)
    print(f"\nTotal: {parts_with_icons}/{len(bom_parts)} parts have at least one file icon")
