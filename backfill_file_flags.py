"""
One-time backfill: scan PDM directory and populate has_pdf, has_ai_pdf, has_step, has_xt
for all existing Part records.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import json

# Point to prod database
os.environ['DATABASE_URI'] = 'sqlite:///menteebom.db'

from app import app, db, Part
from pdm_bom_parser import PdmBomParser

with app.app_context():
    parts = Part.query.all()
    print(f"Scanning {len(parts)} parts for file availability...")

    scan_input = [(p.part_number, p.revision, p.part_type or '') for p in parts]

    BATCH = 100
    total_updated = 0
    for i in range(0, len(scan_input), BATCH):
        batch = scan_input[i:i+BATCH]
        availability = PdmBomParser.check_file_availability(batch)

        for (pn, rev), flags in availability.items():
            part = Part.query.filter_by(part_number=pn, revision=rev).first()
            if part:
                changed = False
                for key in ('has_pdf', 'has_ai_pdf', 'has_step', 'has_xt'):
                    new_val = flags.get(key, False)
                    if getattr(part, key) != new_val:
                        setattr(part, key, new_val)
                        changed = True
                step_files_json = json.dumps(flags.get('step_files', [])) if flags.get('step_files') else None
                if part.step_files != step_files_json:
                    part.step_files = step_files_json
                    changed = True
                if changed:
                    total_updated += 1

        db.session.commit()
        done = min(i + BATCH, len(scan_input))
        has_any = sum(1 for (pn, rev), f in availability.items()
                      if f.get('has_pdf') or f.get('has_ai_pdf') or f.get('has_step') or f.get('has_xt'))
        print(f"  [{done}/{len(scan_input)}] batch done, {has_any} parts with files in this batch")

    print(f"\nDone! Updated {total_updated} parts with file availability flags.")

    pdf_count = Part.query.filter_by(has_pdf=True).count()
    ai_count = Part.query.filter_by(has_ai_pdf=True).count()
    step_count = Part.query.filter_by(has_step=True).count()
    xt_count = Part.query.filter_by(has_xt=True).count()
    print(f"Summary: {pdf_count} with PDF, {ai_count} with AI PDF, {step_count} with STEP, {xt_count} with XT")
