#!/usr/bin/env python3
"""
Test script to check PDM extraction for a specific assembly.
This helps diagnose revision extraction issues.
"""

import sys
import json
from pdm_config import pdm_config
from pdm_bom_parser import PdmBomParser

# Check PDM configuration
if not pdm_config.is_enabled():
    print("[ERROR] PDM integration is disabled")
    sys.exit(1)

is_valid, message = pdm_config.validate_exporter_path()
if not is_valid:
    print(f"[ERROR] PDM configuration error: {message}")
    sys.exit(1)

# Initialize parser
parser = PdmBomParser(pdm_config.get_exporter_path())

# Test assembly
assembly_name = "034-AS-01141"

print(f"[INFO] Testing PDM extraction for: {assembly_name}")
print("=" * 60)

try:
    # Extract BOM by name
    print(f"\n[INFO] Extracting BOM data for {assembly_name}...")
    pdm_bom = parser.extract_bom_by_name(
        part_name=assembly_name,
        bom_layout='MenteeBOM',
        configuration='Default',
        output_mode="json"
    )

    if not pdm_bom:
        print("[ERROR] No BOM data extracted")
        sys.exit(1)

    print("[OK] BOM data extracted successfully")

    # Convert to tree format
    print("\n[INFO] Converting to tree format...")
    tree_data = parser.convert_to_tree_format(pdm_bom)

    # Find root assembly info
    root_assembly = tree_data.get('name', 'Unknown')
    root_revision = tree_data.get('bom_columns', {}).get('Revision', 'N/A')
    root_metadata = tree_data.get('metadata', {})

    print(f"[OK] Root Assembly: {root_assembly}")
    print(f"[OK] Root Revision: {root_revision}")
    print(f"[OK] Extraction Date: {root_metadata.get('extraction_time', 'N/A')}")

    # Check if revision is in different format
    print("\n[INFO] Checking all revision-related fields in root node:")
    for key, value in tree_data.items():
        if 'revision' in key.lower() or key == 'bom_columns':
            print(f"   {key}: {value}")

    # Extract parts
    print("\n[INFO] Extracting parts data...")
    parts_data = parser.extract_parts_for_library(tree_data)

    print(f"[OK] Found {len(parts_data)} parts")

    # Find the assembly itself in the parts data
    target_part = None
    for part in parts_data:
        if part.get('part_number') == assembly_name:
            target_part = part
            break

    if target_part:
        print(f"\n[FOUND] Target Assembly Details:")
        print(f"   Part Number: {target_part.get('part_number')}")
        print(f"   Revision: {target_part.get('revision')}")
        print(f"   Part Name: {target_part.get('part_name')}")
        print(f"   State: {target_part.get('state')}")
        print(f"   Backward Compatible: {target_part.get('backward_compatible')}")
    else:
        print(f"\n[WARNING] Assembly {assembly_name} not found in parts data")
        print("Available assemblies:")
        for part in parts_data:
            if '-AS-' in part.get('part_number', ''):
                print(f"   - {part.get('part_number')} REV{part.get('revision')}")

    # Show raw BOM structure for first few components
    print("\n[INFO] Raw BOM Structure (first component):")
    components = pdm_bom.get('components', [])
    if components:
        first_component = components[0]
        print(json.dumps({
            'part_number': first_component.get('part_number'),
            'bom_columns': first_component.get('bom_columns'),
            'name': first_component.get('name'),
            'revision': first_component.get('revision'),
        }, indent=2, default=str))

except Exception as e:
    print(f"\n[ERROR] {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 60)
print("[SUCCESS] Test completed successfully")
