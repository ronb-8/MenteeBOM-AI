#!/usr/bin/env python3
"""
PDM BOM extraction using Python comtypes (typed vtable COM interfaces).

Background: IEdmBomView / IEdmBomCell are NOT IDispatch interfaces — win32com
cannot call their methods. comtypes uses proper vtable-based COM, so it can.

Key discoveries:
  - Vault: CreateObject('ConisioLib.EdmVault') → QI to IEdmVault5/IEdmVault7
  - Search: vault5.CreateSearch() → IEdmSearch5  (NOT CreateUtility(22))
  - File:   searchResult.QueryInterface(IEdmFile7)
  - BOM:    file7.GetComputedBOM(layout, version, config, flags) → IEdmBomView
  - Cols:   bom.GetColumns() → tuple of EdmBomColumn structs
  - Rows:   bom.GetRows() → tuple of IUnknown; each needs QI to IEdmBomCell
  - GetVar: cell.GetVar(mlColumnID, meType) → (varVal, compVal, configVal, found)
            For Part Number (meType=24): GetVar(0, 24) works
            For QTY (meType=25):        GetVar(0, 25) works (or col's mlColumnID)
            For Variable cols (meType=0): mlColumnID is the PDM variable DB ID

Run: python test_pdm_comtypes.py <assembly_part_number>
Example: python test_pdm_comtypes.py 005-AS-01306

Requirements:
  pip install comtypes pywin32
  PDM client installed on this machine.
"""

import sys
import os
import json

EDM_DLL = r"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS PDM\EdmInterface.dll"


def extract_bom(part_name: str, layout: str = "MenteeBOM", config: str = "Default") -> list:
    """
    Extract BOM components from PDM for the given assembly part name.

    Returns a list of dicts:
      { level, part_number, path, qty, revision, description, state }
    """
    import comtypes.client
    edm = comtypes.client.GetModule(EDM_DLL)

    # ── Create vault and login ─────────────────────────────────────────────────
    vault = comtypes.client.CreateObject("ConisioLib.EdmVault")
    vault5 = vault.QueryInterface(edm.IEdmVault5)
    vault5.LoginAuto("PDM", 0)
    vault7 = vault.QueryInterface(edm.IEdmVault7)
    print(f"  Vault: {vault5.Name}")

    # ── Search for assembly file ───────────────────────────────────────────────
    srch = vault5.CreateSearch()
    srch.FileName = f"{part_name}.SLDASM"
    srch.Recursive = True
    res = srch.GetFirstResult()
    if not res:
        srch.FileName = f"{part_name}.sldasm"
        res = srch.GetFirstResult()
    if not res:
        raise FileNotFoundError(f"Assembly not found in vault: {part_name}.SLDASM")
    print(f"  Found: {res.Name}  (ID={res.ID})")

    # ── Get IEdmFile7 and compute BOM ──────────────────────────────────────────
    file7 = res.QueryInterface(edm.IEdmFile7)
    bom_mgr = vault7.CreateUtility(24)  # EdmUtil_BomMgr = 24

    # EdmBf_ShowSelected = 1
    bom = file7.GetComputedBOM(layout, 0, config, 1)
    if not bom:
        raise RuntimeError(f"GetComputedBOM returned None for layout='{layout}'")

    # ── Read columns ───────────────────────────────────────────────────────────
    cols = bom.GetColumns()
    col_map = {c.mbsCaption: c for c in cols}
    print(f"  Columns ({len(cols)}): {[c.mbsCaption for c in cols]}")

    # Find the Part Number column (meType=24) for GetVar calls
    pn_col  = next((c for c in cols if c.meType == 24), None)
    qty_col = next((c for c in cols if c.meType in (25, 11)), None)  # RefCountNoBomQty or RefCount
    rev_col = col_map.get("Revision")
    desc_col = col_map.get("Description")
    state_col = next((c for c in cols if c.meType == 6), None)  # EdmBomCol_State

    # ── Read rows ──────────────────────────────────────────────────────────────
    rows = bom.GetRows()
    print(f"  Total rows: {len(rows)}")

    components = []
    for row_unk in rows:
        cell = row_unk.QueryInterface(edm.IEdmBomCell)
        path  = cell.GetPathName()
        level = cell.GetTreeLevel()

        # Part number: use Part Number column variable (more accurate than filename)
        part_number = ""
        if pn_col is not None:
            try:
                v, cv, _, _ = cell.GetVar(pn_col.mlColumnID, pn_col.meType)
                part_number = cv or v or ""
            except Exception:
                pass
        if not part_number and path:
            part_number = os.path.splitext(os.path.basename(path))[0]

        # Quantity (instance qty at this level)
        qty = 1
        if qty_col is not None:
            try:
                v, cv, _, _ = cell.GetVar(0, qty_col.meType)   # variableID=0 for built-ins
                raw = cv or v
                if raw:
                    qty = int(float(str(raw)))
            except Exception:
                pass

        # Revision
        revision = ""
        if rev_col is not None:
            try:
                v, cv, _, _ = cell.GetVar(rev_col.mlColumnID, rev_col.meType)
                revision = cv or v or ""
            except Exception:
                pass

        # Description
        description = ""
        if desc_col is not None:
            try:
                v, cv, _, _ = cell.GetVar(desc_col.mlColumnID, desc_col.meType)
                description = cv or v or ""
            except Exception:
                pass

        # State
        state = ""
        if state_col is not None:
            try:
                v, cv, _, _ = cell.GetVar(state_col.mlColumnID, state_col.meType)
                state = cv or v or ""
            except Exception:
                pass

        components.append({
            "level":       level,
            "part_number": str(part_number) if part_number else "",
            "path":        path or "",
            "qty":         qty,
            "revision":    str(revision) if revision else "",
            "description": str(description) if description else "",
            "state":       str(state) if state else "",
        })

    return components


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_pdm_comtypes.py <part_number> [layout] [config]")
        print("Example: python test_pdm_comtypes.py 005-AS-01306")
        print("Example: python test_pdm_comtypes.py 005-AS-01306 MenteeBOM Default")
        sys.exit(1)

    part_name = sys.argv[1]
    layout    = sys.argv[2] if len(sys.argv) > 2 else "MenteeBOM"
    config    = sys.argv[3] if len(sys.argv) > 3 else "Default"

    print(f"\n=== PDM comtypes BOM Extraction ===")
    print(f"Part:   {part_name}")
    print(f"Layout: {layout}")
    print(f"Config: {config}\n")

    try:
        components = extract_bom(part_name, layout, config)
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback; traceback.print_exc()
        sys.exit(1)

    # Print first 30 rows
    print("\n=== BOM Tree (first 30) ===")
    for comp in components[:30]:
        indent = "  " * (comp["level"] + 1)
        print(f"{indent}[L{comp['level']}] {comp['part_number']}  qty={comp['qty']}"
              + (f"  rev={comp['revision']}" if comp["revision"] else "")
              + (f"  state={comp['state']}" if comp["state"] else ""))
    if len(components) > 30:
        print(f"  ... ({len(components) - 30} more rows)")

    # Save to JSON
    out_path = f"test_pdm_comtypes_{part_name}.json"
    with open(out_path, "w") as f:
        json.dump({"part_name": part_name, "layout": layout,
                   "config": config, "components": components},
                  f, indent=2, default=str)
    print(f"\nSUCCESS: {len(components)} components saved to {out_path}")


if __name__ == "__main__":
    main()
