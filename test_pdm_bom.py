"""
test_pdm_bom.py
===============
Standalone diagnostic tool — extracts a BOM via the native PDM extractor
and writes output files for comparison against the real PDM BOM.

Usage:
  python test_pdm_bom.py <part_number> [bom_layout] [configuration]
  python test_pdm_bom.py <part_number> --compare <pdm_export.csv>

Output files:
  <part_number>_tree.txt   indented tree view (human-readable)
  <part_number>_flat.csv   flat CSV  (diff against a PDM BOM export)
  <part_number>_raw.json   raw JSON from the extractor (full debug data)

If --compare is given, a diff report is also written:
  <part_number>_diff.txt   line-by-line diff vs the PDM export

Examples:
  python test_pdm_bom.py 039-AS-02033
  python test_pdm_bom.py 039-AS-02033 MenteeBOM Default
  python test_pdm_bom.py 039-AS-02033 --compare pdm_export.csv

Tips:
  In PDM Explorer open the assembly, go to BOM tab, select MenteeBOM layout,
  then File > Save As (or right-click > Save BOM) to export a CSV.
  Pass that file to --compare to see exactly what is different.
"""

import sys
import os
import json
import csv
import traceback
from datetime import datetime
from collections import Counter

# ── Path setup ────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

# ── Argument parsing ──────────────────────────────────────────────────────────
args = sys.argv[1:]
if not args:
    print(__doc__)
    sys.exit(1)

part_number   = args[0].strip()
bom_layout    = "MenteeBOM"
configuration = "Default"
compare_csv   = None

i = 1
while i < len(args):
    if args[i] == "--compare" and i + 1 < len(args):
        compare_csv = args[i + 1]
        i += 2
    elif i == 1 and not args[i].startswith("--"):
        bom_layout = args[i]
        i += 1
    elif i == 2 and not args[i].startswith("--"):
        configuration = args[i]
        i += 1
    else:
        i += 1

print("=" * 70)
print("PDM BOM Extractor - diagnostic test")
print(f"  Part number  : {part_number}")
print(f"  BOM layout   : {bom_layout}")
print(f"  Configuration: {configuration}")
if compare_csv:
    print(f"  Compare CSV  : {compare_csv}")
print(f"  Started      : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 70)

# ── Run extractor ─────────────────────────────────────────────────────────────
try:
    import pythoncom
    pythoncom.CoInitialize()
    from pdm_native_extractor import extract_bom_native
    result = extract_bom_native(
        assembly_identifier=part_number,
        bom_layout=bom_layout,
        configuration=configuration,
        search_mode="name",
        include_thumbnails=False,
    )
except Exception as e:
    print(f"\n[ERROR] Extraction failed: {e}")
    traceback.print_exc()
    sys.exit(2)

metadata   = result.get("metadata", {})
components = result.get("components", [])

print(f"\n[OK] Extraction complete.")
print(f"     Root assembly : {metadata.get('root_assembly', '?')}")
print(f"     Description   : {metadata.get('root_assembly_description', '(empty)')}")
print(f"     Full path     : {metadata.get('full_path', '?')}")
print(f"     Components    : {len(components)}  (including root at level 0)")
print()

safe_pn  = part_number.replace("/", "-").replace("\\", "-")
out_tree = os.path.join(SCRIPT_DIR, f"{safe_pn}_tree.txt")
out_csv  = os.path.join(SCRIPT_DIR, f"{safe_pn}_flat.csv")
out_json = os.path.join(SCRIPT_DIR, f"{safe_pn}_raw.json")
out_diff = os.path.join(SCRIPT_DIR, f"{safe_pn}_diff.txt")

# ── 1. Raw JSON ───────────────────────────────────────────────────────────────
def _strip_thumbnails(obj):
    if isinstance(obj, dict):
        return {k: ({"available": v.get("available", False)} if k == "thumbnail" else _strip_thumbnails(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [_strip_thumbnails(i) for i in obj]
    return obj

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(_strip_thumbnails(result), f, indent=2, ensure_ascii=False)
print(f"[JSON] Written -> {out_json}")

# ── 2. Flat CSV ───────────────────────────────────────────────────────────────
CSV_COLS = ["row", "level", "part_number", "description", "revision",
            "qty", "state", "material", "finish1", "finish2",
            "file_name", "full_path", "desc_empty"]

rows_csv = []
for idx, comp in enumerate(components):
    bc   = comp.get("bom_columns", {})
    desc = bc.get("Description", "")
    rows_csv.append({
        "row":         idx,
        "level":       comp.get("level", 0),
        "part_number": comp.get("part_number", ""),
        "description": desc,
        "revision":    bc.get("Revision", ""),
        "qty":         comp.get("instance_quantity", 1),
        "state":       comp.get("state", ""),
        "material":    bc.get("Material", ""),
        "finish1":     bc.get("FINISH1", ""),
        "finish2":     bc.get("FINISH2", ""),
        "file_name":   comp.get("file_name", ""),
        "full_path":   comp.get("full_path", ""),
        "desc_empty":  "TRUE" if not desc.strip() else "",
    })

with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=CSV_COLS)
    writer.writeheader()
    writer.writerows(rows_csv)
print(f"[CSV] Written -> {out_csv}")

# ── 3. Tree text ──────────────────────────────────────────────────────────────
INDENT = "    "
missing_desc = []
tree_lines = [
    f"BOM TREE: {part_number}  [{bom_layout} / {configuration}]",
    f"Extracted: {metadata.get('extraction_time', datetime.now().isoformat())}",
    f"Total components: {len(components)}",
    "",
    f"{'LVL':<4} {'QTY':>4}  {'PART NUMBER':<22} {'REV':<5} {'DESCRIPTION':<45} {'STATE':<12} FILE",
    "-" * 130,
]
for comp in components:
    level  = comp.get("level", 0)
    pn     = comp.get("part_number", "?")
    qty    = comp.get("instance_quantity", 1)
    state  = comp.get("state", "")
    fname  = comp.get("file_name", "")
    bc     = comp.get("bom_columns", {})
    desc   = bc.get("Description", "")
    rev    = bc.get("Revision", "")
    indent = INDENT * level
    if not desc.strip():
        missing_desc.append((level, pn))
    desc_display = desc if desc.strip() else "<<< NO DESCRIPTION >>>"
    pn_col_width = max(1, 22 - len(indent))
    tree_lines.append(
        f"{level:<4} {qty:>4}  {indent}{pn:<{pn_col_width}} {rev:<5} "
        f"{desc_display:<45} {state:<12} {fname}"
    )
tree_lines += [
    "", "=" * 130, "SUMMARY",
    f"  Total rows (incl. root): {len(components)}",
    f"  Parts with EMPTY description: {len(missing_desc)}",
]
if missing_desc:
    tree_lines.append("\n  Parts missing description:")
    for lv, pn in missing_desc:
        tree_lines.append(f"    Level {lv}: {pn}")
level_counts = Counter(c.get("level", 0) for c in components)
tree_lines.append("\n  Count by level:")
for lv in sorted(level_counts):
    tree_lines.append(f"    Level {lv}: {level_counts[lv]} part(s)")

with open(out_tree, "w", encoding="utf-8") as f:
    f.write("\n".join(tree_lines))
print(f"[TXT] Written -> {out_tree}")

# ── 4. Compare against PDM CSV export ────────────────────────────────────────
if compare_csv:
    print(f"\n[COMPARE] Loading PDM export: {compare_csv}")
    try:
        # Detect encoding: PDM exports can be UTF-16, UTF-8 BOM, or plain UTF-8
        with open(compare_csv, "rb") as f:
            raw_start = f.read(4)
        if raw_start[:2] in (b'\xff\xfe', b'\xfe\xff'):
            csv_encoding = "utf-16"
        elif raw_start[:3] == b'\xef\xbb\xbf':
            csv_encoding = "utf-8-sig"
        else:
            csv_encoding = "utf-8-sig"
        print(f"         Detected encoding: {csv_encoding}")

        # Auto-detect delimiter (PDM exports can be , or ;)
        with open(compare_csv, encoding=csv_encoding, errors="replace") as f:
            sample = f.read(4096)
        delimiter = ";" if sample.count(";") > sample.count(",") else ","

        pdm_rows = []
        with open(compare_csv, encoding=csv_encoding, errors="replace", newline="") as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            for row in reader:
                pdm_rows.append({k.strip(): (v or '').strip() for k, v in row.items() if k is not None})

        print(f"         PDM CSV rows  : {len(pdm_rows)}")
        print(f"         Our extractor : {len(components) - 1} (excl. root)")

        # ── Normalize: build (part_number, qty, level) lists ─────────────────
        # PDM CSV column names vary; try common names.
        def _col(row, *candidates):
            for c in candidates:
                for k in row:
                    if k.strip().lower() == c.lower():
                        return row[k].strip()
            return ""

        pdm_parts = []
        for row in pdm_rows:
            pn   = _col(row, "Part Number", "PartNumber", "PART NUMBER", "Part No", "Component")
            desc = _col(row, "Description", "DESCRIPTION", "Desc")
            qty  = _col(row, "QTY", "Quantity", "QUANTITY", "Qty")
            rev  = _col(row, "Revision", "REVISION", "Rev", "REV")
            lvl  = _col(row, "Level", "LEVEL", "Lvl", "Indent Level")
            if pn:
                pdm_parts.append({"part_number": pn, "description": desc, "qty": qty, "revision": rev, "level": lvl})

        our_parts = [
            {
                "part_number": c.get("part_number", ""),
                "description": c.get("bom_columns", {}).get("Description", ""),
                "qty":         str(c.get("instance_quantity", 1)),
                "revision":    c.get("bom_columns", {}).get("Revision", ""),
                "level":       str(c.get("level", 0)),
            }
            for c in components if c.get("level", 0) > 0  # skip root
        ]

        # ── Build part-number sets for quick comparison ───────────────────────
        pdm_pn_set = Counter(p["part_number"] for p in pdm_parts if p["part_number"])
        our_pn_set = Counter(p["part_number"] for p in our_parts if p["part_number"])

        only_in_pdm  = {pn for pn in pdm_pn_set if pn not in our_pn_set}
        only_in_ours = {pn for pn in our_pn_set if pn not in pdm_pn_set}
        in_both      = {pn for pn in pdm_pn_set if pn in our_pn_set}

        # Description mismatches for parts in both
        desc_diffs = []
        for pn in sorted(in_both):
            pdm_desc  = next((p["description"] for p in pdm_parts if p["part_number"] == pn), "")
            our_desc  = next((p["description"] for p in our_parts  if p["part_number"] == pn), "")
            if pdm_desc.strip().lower() != our_desc.strip().lower():
                desc_diffs.append((pn, pdm_desc, our_desc))

        # ── Write diff report ─────────────────────────────────────────────────
        diff_lines = [
            f"DIFF REPORT: {part_number}",
            f"PDM export  : {compare_csv}  ({len(pdm_parts)} rows)",
            f"Our extract : {len(our_parts)} rows",
            "",
            f"Parts ONLY in PDM (we are MISSING these) : {len(only_in_pdm)}",
        ]
        for pn in sorted(only_in_pdm):
            pdm_desc = next((p["description"] for p in pdm_parts if p["part_number"] == pn), "")
            pdm_qty  = next((p["qty"]         for p in pdm_parts if p["part_number"] == pn), "")
            diff_lines.append(f"  MISSING  pn={pn}  qty={pdm_qty}  desc={pdm_desc!r}")

        diff_lines += ["", f"Parts ONLY in our output (PDM does NOT have these) : {len(only_in_ours)}"]
        for pn in sorted(only_in_ours):
            our_desc = next((p["description"] for p in our_parts if p["part_number"] == pn), "")
            our_qty  = next((p["qty"]         for p in our_parts if p["part_number"] == pn), "")
            diff_lines.append(f"  EXTRA    pn={pn}  qty={our_qty}  desc={our_desc!r}")

        diff_lines += ["", f"Parts in BOTH but description differs : {len(desc_diffs)}"]
        for pn, pdm_d, our_d in desc_diffs:
            diff_lines.append(f"  DIFF_DESC  pn={pn}")
            diff_lines.append(f"    PDM : {pdm_d!r}")
            diff_lines.append(f"    OURS: {our_d!r}")

        diff_lines += [
            "",
            f"Parts in both with matching description: {len(in_both) - len(desc_diffs)}",
            f"Total unique part numbers in PDM       : {len(pdm_pn_set)}",
            f"Total unique part numbers in ours      : {len(our_pn_set)}",
        ]

        with open(out_diff, "w", encoding="utf-8") as f:
            f.write("\n".join(diff_lines))
        print(f"[DIFF] Written -> {out_diff}")

        # Print summary to console
        print(f"\n  MISSING from our output  : {len(only_in_pdm)}")
        print(f"  EXTRA in our output      : {len(only_in_ours)}")
        print(f"  Description mismatches   : {len(desc_diffs)}")
        print(f"  Matching parts           : {len(in_both) - len(desc_diffs)}")
        if only_in_pdm:
            print("\n  Parts we are MISSING:")
            for pn in sorted(only_in_pdm):
                pdm_desc = next((p["description"] for p in pdm_parts if p["part_number"] == pn), "")
                print(f"    {pn}  [{pdm_desc}]")

    except Exception as e:
        print(f"[COMPARE ERROR] {e}")
        traceback.print_exc()

# ── Console summary ───────────────────────────────────────────────────────────
print()
print("=" * 70)
print("QUICK SUMMARY")
print("=" * 70)
print(f"Total components: {len(components)}")
print(f"Parts with empty description: {len(missing_desc)}")
print()
print(f"{'LVL':>3}  {'QTY':>4}  {'PART NUMBER':<22}  {'REV':<5}  DESCRIPTION")
print("-" * 90)
for comp in components:
    level  = comp.get("level", 0)
    pn     = comp.get("part_number", "?")
    qty    = comp.get("instance_quantity", 1)
    bc     = comp.get("bom_columns", {})
    desc   = bc.get("Description", "") or "<<< EMPTY >>>"
    rev    = bc.get("Revision", "")
    indent = "  " * level
    print(f"{level:>3}  {qty:>4}  {indent}{pn:<22}  {rev:<5}  {desc}")

print()
print("Output files:")
print(f"  Tree view : {out_tree}")
print(f"  CSV       : {out_csv}")
print(f"  Raw JSON  : {out_json}")
if compare_csv:
    print(f"  Diff      : {out_diff}")
print()
print("To compare with PDM:")
print("  1. Open assembly in PDM Explorer -> BOM tab -> select MenteeBOM layout")
print("  2. File > Save As / right-click > Save BOM -> export as CSV")
print("  3. Run: python test_pdm_bom.py", part_number, "--compare <exported_file.csv>")
