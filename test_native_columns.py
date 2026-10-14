"""
Quick test: verify the native extractor reads ALL BOM layout columns
(especially FINISH1, FINISH2) correctly.

Run from the MenteeBOM-Web directory:
    python test_native_columns.py "ASSEMBLY_NAME_HERE"

Example:
    python test_native_columns.py "RMD-X12-320 Modified"
"""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(__file__))

def test_native_columns(assembly_name):
    from pdm_native_extractor import extract_bom_native

    print(f"\n{'='*70}")
    print(f"Testing native extractor with assembly: {assembly_name}")
    print(f"{'='*70}\n")

    result = extract_bom_native(
        assembly_identifier=assembly_name,
        bom_layout="MenteeBOM",
        configuration="Default",
        search_mode="name",
        include_thumbnails=False,  # Skip thumbnails for speed
    )

    components = result.get("components", [])
    print(f"\n{'='*70}")
    print(f"RESULTS: {len(components)} components extracted")
    print(f"{'='*70}\n")

    # Print header
    print(f"{'Part Number':<25} {'Rev':<6} {'Material':<25} {'FINISH1':<20} {'FINISH2':<20} {'Description':<30}")
    print("-" * 130)

    missing_finish = 0
    for comp in components[:30]:  # Show first 30
        bc = comp.get("bom_columns", {})
        pn = comp.get("part_number", "")
        rev = bc.get("Revision", "")
        mat = bc.get("Material", "")
        f1 = bc.get("FINISH1", "")
        f2 = bc.get("FINISH2", "")
        desc = bc.get("Description", "")[:30]

        # Flag parts missing finish
        flag = ""
        if not f1 and not f2 and mat:  # Has material but no finish
            flag = " <-- NO FINISH"
            missing_finish += 1

        print(f"{pn:<25} {rev:<6} {mat:<25} {f1:<20} {f2:<20} {desc}{flag}")

    # Also print ALL bom_columns keys from first component to show what columns are available
    if components:
        print(f"\n{'='*70}")
        print(f"All bom_columns keys from first component:")
        print(f"  {list(components[0].get('bom_columns', {}).keys())}")
        print(f"\nParts with material but no finish: {missing_finish}/{len(components)}")
        print(f"{'='*70}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_native_columns.py <ASSEMBLY_NAME>")
        print('Example: python test_native_columns.py "RMD-X12-320 Modified"')
        sys.exit(1)

    test_native_columns(sys.argv[1])
