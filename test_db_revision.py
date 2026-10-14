#!/usr/bin/env python3
"""
Check what revision is stored in the database for the assembly.
"""

import sys
from app import app, db, Part

part_number = "034-AS-01141"

print(f"[INFO] Checking database for: {part_number}")
print("=" * 60)

with app.app_context():
    # Get all versions of this part
    parts = Part.query.filter_by(part_number=part_number).all()

    if not parts:
        print(f"[ERROR] No parts found in database for {part_number}")
        sys.exit(1)

    print(f"[OK] Found {len(parts)} version(s) of {part_number}\n")

    for i, part in enumerate(parts, 1):
        print(f"[Version {i}]")
        print(f"   Part ID: {part.id}")
        print(f"   Revision: {part.revision}")
        print(f"   Part Name: {part.part_name}")
        print(f"   Description: {part.description}")
        print(f"   State: {part.state}")
        print(f"   ECO Number: {part.eco_number}")
        print(f"   Backward Compatible: {part.backward_compatible}")
        print(f"   Created: {part.created_at}")
        print(f"   Updated: {part.updated_at}")
        print()

    print("=" * 60)
    print("[SUCCESS] Database check completed")
