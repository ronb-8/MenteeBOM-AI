"""
test_native_extractor.py
========================
Standalone test: run the native PDM extractor on 039-AS-01564 and compare
the result against the ground-truth tree CSV on the Desktop.

Run from the MenteeBOM-Web directory:
    python test_native_extractor.py
"""

import csv
import sys
import os
from collections import defaultdict

ASSEMBLY   = "039-AS-01564"
TREE_CSV   = r"C:\Users\mechanical\Desktop\039-AS-01564 defualt.csv"   # Default config BOM (124 rows)
FLAT_CSV   = r"C:\Users\mechanical\Desktop\039-AS-01564.csv"

# ── Load ground-truth CSVs ─────────────────────────────────────────────────────

def load_tree_csv(path):
    """Return list of dicts from the tree CSV (UTF-16 LE with BOM)."""
    rows = []
    with open(path, encoding="utf-16") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Strip BOM/whitespace from keys and values
            clean = {k.strip().lstrip("\ufeff"): v.strip() for k, v in row.items()}
            rows.append(clean)
    return rows

def load_flat_csv(path):
    rows = []
    try:
        with open(path, encoding="utf-16") as f:
            reader = csv.DictReader(f)
            for row in reader:
                clean = {k.strip().lstrip("\ufeff"): v.strip() for k, v in row.items()}
                rows.append(clean)
    except Exception as e:
        print(f"[warn] Could not load flat CSV: {e}")
    return rows

print("=" * 70)
print(f"Loading ground-truth CSVs...")
tree_rows = load_tree_csv(TREE_CSV)
flat_rows = load_flat_csv(FLAT_CSV)

tree_parts = [r.get("Part Number", r.get("Part  Number", "")).strip() for r in tree_rows]
flat_parts = [r.get("Part Number", r.get("Part  Number", "")).strip() for r in flat_rows]

print(f"  Tree CSV : {len(tree_rows)} rows")
print(f"  Flat CSV : {len(flat_rows)} rows")
print()

# ── Run native extractor ───────────────────────────────────────────────────────

print("Running native extractor (no thumbnails for speed)...")
print("=" * 70)

from pdm_native_extractor import extract_bom_native

result = extract_bom_native(
    assembly_identifier=ASSEMBLY,
    bom_layout="MenteeBOM",
    configuration="Default",
    search_mode="name",
    include_thumbnails=False,
)

components = result["components"]
# Skip level-0 root
bom_rows = [c for c in components if c["level"] > 0]

print("=" * 70)
print(f"\nRESULTS SUMMARY")
print(f"  Total components (incl. root) : {len(components)}")
print(f"  BOM rows (level >= 1)          : {len(bom_rows)}")
print(f"  Expected (tree CSV)            : {len(tree_rows)}")
print(f"  Match                          : {'YES ✓' if len(bom_rows) == len(tree_rows) else 'NO ✗'}")
print()

# ── Level distribution ─────────────────────────────────────────────────────────
level_counts = defaultdict(int)
for c in bom_rows:
    level_counts[c["level"]] += 1

print("Level distribution (extracted):")
for lvl in sorted(level_counts):
    print(f"  Level {lvl:2d} : {level_counts[lvl]:4d} rows")
print()

# ── File type breakdown ────────────────────────────────────────────────────────
sldasm_count = sum(1 for c in bom_rows if c["file_name"].upper().endswith(".SLDASM"))
sldprt_count = sum(1 for c in bom_rows if c["file_name"].upper().endswith(".SLDPRT"))
other_count  = len(bom_rows) - sldasm_count - sldprt_count
print(f"File types in extracted BOM:")
print(f"  .SLDASM : {sldasm_count}")
print(f"  .SLDPRT : {sldprt_count}")
print(f"  Other   : {other_count}")
print()

# ── Part number comparison ────────────────────────────────────────────────────
extracted_pns = set()
for c in bom_rows:
    pn = c["part_number"].strip()
    if pn:
        extracted_pns.add(pn)

tree_pns = set(p for p in tree_parts if p)
flat_pns = set(p for p in flat_parts if p)

in_tree_not_extracted = tree_pns - extracted_pns
in_extracted_not_tree = extracted_pns - tree_pns

print(f"Part number comparison vs tree CSV:")
print(f"  Unique PNs in tree CSV         : {len(tree_pns)}")
print(f"  Unique PNs extracted           : {len(extracted_pns)}")
print(f"  In tree but NOT extracted      : {len(in_tree_not_extracted)}")
print(f"  Extracted but NOT in tree      : {len(in_extracted_not_tree)}")

if in_tree_not_extracted:
    print(f"\n  MISSING from extraction (first 20):")
    for pn in sorted(in_tree_not_extracted)[:20]:
        print(f"    - {pn}")

if in_extracted_not_tree:
    print(f"\n  EXTRA in extraction (first 20):")
    for pn in sorted(in_extracted_not_tree)[:20]:
        print(f"    + {pn}")

print()

# ── Flat CSV part count comparison ────────────────────────────────────────────
# Count unique SLDPRT-like parts at any level (exclude sub-assemblies that
# have children — same logic as "Parts Only" BOM)
if flat_rows:
    print(f"Flat CSV comparison (163 unique parts expected):")
    print(f"  Unique PNs in flat CSV         : {len(flat_pns)}")
    in_flat_not_extracted = flat_pns - extracted_pns
    print(f"  Flat PNs missing from extract  : {len(in_flat_not_extracted)}")
    if in_flat_not_extracted:
        print(f"  Missing:")
        for pn in sorted(in_flat_not_extracted):
            print(f"    - {pn}")
    print()

# ── Show all SLDASMs found ─────────────────────────────────────────────────────
print("All SLDASMs in extraction:")
for c in bom_rows:
    if c["file_name"].upper().endswith(".SLDASM"):
        pn = c["part_number"][:40]
        print(f"  Level {c['level']:>2}  {pn}")
print()

# ── Probe specific missing assemblies ─────────────────────────────────────────
import pythoncom, comtypes.client
probe_targets = ["039-AS-01564", "039-AS-01987", "032-AS-01466"]
EDM_DLL = r"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS PDM\EdmInterface.dll"
print("Probing key assemblies — level-1 children from their own GetComputedBOM:")
hr = pythoncom.CoInitialize()
try:
    edm = comtypes.client.GetModule(EDM_DLL)
    vault = comtypes.client.CreateObject("ConisioLib.EdmVault")
    vault5 = vault.QueryInterface(edm.IEdmVault5)
    vault5.LoginAuto("PDM", 0)
    for target in probe_targets:
        srch = vault5.CreateSearch()
        srch.Recursive = True
        srch.FileName = f"{target}.SLDASM"
        found = srch.GetFirstResult()
        if not found:
            print(f"  {target}: NOT FOUND IN VAULT")
            continue
        file7 = found.QueryInterface(edm.IEdmFile7)
        children_vs = {}
        for vs in (0,):
            try:
                bom = file7.GetComputedBOM("MenteeBOM", 0, "Default", vs)
                if bom:
                    rows = list(bom.GetRows())
                    by_level = {}
                    for r in rows:
                        try:
                            cell = r.QueryInterface(edm.IEdmBomCell)
                            lvl = cell.GetTreeLevel()
                            by_level.setdefault(lvl, 0)
                            by_level[lvl] += 1
                        except Exception:
                            pass
                    children_vs[vs] = by_level
                else:
                    children_vs[vs] = {}
            except Exception as e:
                children_vs[vs] = {"error": str(e)}
        print(f"\n  {target}:")
        for vs, by_level in children_vs.items():
            total = sum(by_level.values()) if isinstance(by_level, dict) else 0
            print(f"    versionSpec={vs}: {total} total rows, by level: {by_level}")
finally:
    if hr == 0:
        pythoncom.CoUninitialize()


# ── Extra probe: try different layouts for 032-AS-01466 ───────────────────────
print("\nExtra probe: 032-AS-01466 with different layouts & reference traversal")
hr2 = pythoncom.CoInitialize()
try:
    edm2 = comtypes.client.GetModule(EDM_DLL)
    vault2 = comtypes.client.CreateObject("ConisioLib.EdmVault")
    vault5b = vault2.QueryInterface(edm2.IEdmVault5)
    vault5b.LoginAuto("PDM", 0)
    srch2 = vault5b.CreateSearch()
    srch2.Recursive = True
    srch2.FileName = "032-AS-01466.SLDASM"
    found2 = srch2.GetFirstResult()
    if found2:
        file7b = found2.QueryInterface(edm2.IEdmFile7)
        # Try various layouts
        for layout in ["MenteeBOM"]:
            for vs in (0,):
                try:
                    bom = file7b.GetComputedBOM(layout, 0, "Default", vs)
                    if bom:
                        rows = list(bom.GetRows())
                        by_level = {}
                        for r in rows:
                            c2 = r.QueryInterface(edm2.IEdmBomCell)
                            lvl = c2.GetTreeLevel()
                            by_level.setdefault(lvl, []).append(os.path.basename(c2.GetPathName() or ""))
                        print(f"  layout='{layout}' vs={vs}: {len(rows)} total rows, levels: {sorted(by_level.keys())}")
                        for lvl in sorted(by_level.keys()):
                            print(f"    Level {lvl}: {by_level[lvl]}")
                    else:
                        print(f"  layout='{layout}' vs={vs}: BOM is None")
                except Exception as e:
                    print(f"  layout='{layout}' vs={vs}: ERROR {e}")

        # Try reference traversal (GetFirstChildPosition5 / GetNextChild5)
        print("\n  Reference traversal (IEdmPos5 / GetNextChild5):")
        try:
            file5b = found2.QueryInterface(edm2.IEdmFile5)
            pos = file5b.GetFirstChildPosition5(vault5b.ID)
            refs = []
            while not pos.IsNull:
                ref = file5b.GetNextChild5(pos)
                if ref:
                    try:
                        fname = ref.GetFileName(True)  # True = full local path
                        refs.append(os.path.basename(fname))
                    except Exception:
                        try:
                            refs.append(str(ref))
                        except Exception:
                            refs.append("?")
            print(f"  {len(refs)} total references (all configs):")
            for r in refs:
                print(f"    - {r}")
        except Exception as e:
            print(f"  Reference traversal failed: {e}")
finally:
    if hr2 == 0:
        pythoncom.CoUninitialize()

print()
# ── Show first 30 extracted rows ──────────────────────────────────────────────
print("First 30 extracted BOM rows:")
print(f"  {'Lvl':>3}  {'Part Number':<35}  {'Rev':>3}  {'Qty':>4}  {'Description'}")
print(f"  {'-'*3}  {'-'*35}  {'-'*3}  {'-'*4}  {'-'*30}")
for c in bom_rows[:30]:
    pn   = c["part_number"][:35]
    rev  = c["bom_columns"].get("Revision", "")[:3]
    qty  = str(c["instance_quantity"])
    desc = c["bom_columns"].get("Description", "")[:40]
    print(f"  {c['level']:>3}  {pn:<35}  {rev:>3}  {qty:>4}  {desc}")
