#!/usr/bin/env python3
"""
Standalone PDM COM test script.
Run from command line: python test_pdm_direct.py <assembly_part_number>
Example:            python test_pdm_direct.py 005-AS-01306

This script does NOT touch any MenteeBOM code — it is purely exploratory.
It tests whether Python can talk to the EPDM COM API directly (no C# exporter needed).

Requirements:
  pip install pywin32
  PDM client must be installed on the machine running this script.
"""

import sys
import json

def test_pdm_com(part_name: str):
    try:
        import win32com.client
    except ImportError:
        print("ERROR: pywin32 is not installed.")
        print("Run:  pip install pywin32")
        return

    print(f"\n=== PDM COM Direct Test ===")
    print(f"Target part: {part_name}\n")

    # ── Step 1: Connect to vault ──────────────────────────────────────────────
    print("Step 1: Connecting to PDM vault...")
    try:
        vault = win32com.client.Dispatch("ConisioLib.EdmVault")
    except Exception as e:
        print(f"  ERROR creating vault object: {e}")
        print("  Is PDM client installed on this machine?")
        return

    try:
        # LoginAuto uses the currently logged-in Windows user
        vault.LoginAuto("PDM", 0)
        print(f"  Connected to vault: {vault.Name}")
    except Exception as e:
        print(f"  ERROR logging in: {e}")
        print("  Try vault.Login('username','password','PDM') instead.")
        return

    # ── Step 2: Search for the file by part number ────────────────────────────
    print(f"\nStep 2: Searching for '{part_name}'...")
    try:
        searcher = vault.CreateUtility(22)   # EdmUtility_SearchFiles = 22
        searcher.FileName = f"{part_name}.SLDASM"
        searcher.SetToken(18, "")            # search all folders
        found = searcher.GetFirstResult()
        if not found:
            # try lowercase extension
            searcher.FileName = f"{part_name}.sldasm"
            found = searcher.GetFirstResult()
        if not found:
            print(f"  File not found: {part_name}.SLDASM")
            print("  Tip: the file must be checked in to the vault.")
            return
        file_path = found.GetLocalPath(0)
        print(f"  Found: {file_path}")
    except Exception as e:
        print(f"  Search failed: {e}")
        print("  Falling back to IEdmVault8.GetFileFromPath — provide a full path instead.")
        return

    # ── Step 3: Get the file object ───────────────────────────────────────────
    print("\nStep 3: Getting file object...")
    try:
        folder_pos = None
        file_obj = vault.GetFileFromPath(file_path, folder_pos)
        if not file_obj:
            print("  ERROR: GetFileFromPath returned None")
            return
        print(f"  File ID     : {file_obj.ID}")
        print(f"  File name   : {file_obj.Name}")
    except Exception as e:
        print(f"  ERROR: {e}")
        return

    # ── Step 4: Get BOM manager ───────────────────────────────────────────────
    print("\nStep 4: Getting BOM manager...")
    try:
        bom_mgr = vault.CreateUtility(24)    # EdmUtility_BomMgr = 24
        print(f"  BOM manager created: {type(bom_mgr)}")
    except Exception as e:
        print(f"  ERROR creating BOM manager: {e}")
        return

    # ── Step 5: List available BOM layouts ───────────────────────────────────
    print("\nStep 5: Available BOM layouts...")
    try:
        layouts = bom_mgr.GetBomLayouts()
        if layouts:
            for layout in layouts:
                print(f"  Layout: '{layout}'")
        else:
            print("  No layouts returned (may need different API call)")
    except Exception as e:
        print(f"  Could not list layouts: {e}")

    # ── Step 6: Open BOM view ─────────────────────────────────────────────────
    print("\nStep 6: Opening BOM view (layout='MenteeBOM', config='Default')...")
    bom_view = None
    for layout_name in ["MenteeBOM", "Default", "BOM"]:
        try:
            bom_view = file_obj.GetBomView(bom_mgr, layout_name, "Default", 0)
            if bom_view:
                print(f"  Opened with layout: '{layout_name}'")
                break
        except Exception as e:
            print(f"  Layout '{layout_name}' failed: {e}")

    if not bom_view:
        print("  Could not open any BOM view.")
        return

    # ── Step 7: Read columns ──────────────────────────────────────────────────
    print("\nStep 7: Reading BOM columns...")
    try:
        columns = bom_view.GetColumns()
        col_names = []
        if columns:
            for col in columns:
                print(f"  Column: id={col.mlColumnID}  type={col.meType}  caption='{col.mbsCaption}'")
                col_names.append(col.mbsCaption)
    except Exception as e:
        print(f"  ERROR reading columns: {e}")

    # ── Step 8: Read rows ─────────────────────────────────────────────────────
    print("\nStep 8: Reading BOM rows...")
    try:
        rows = bom_view.GetRows()
        if not rows:
            print("  No rows returned.")
            return
        print(f"  Total rows: {len(rows)}")

        components = []
        for i, row in enumerate(rows):
            try:
                path      = row.GetPathName()
                level     = row.GetTreeLevel()
                # Try to get qty via GetVar
                qty = 1
                try:
                    v = row.GetVar(0, 0)   # column 0, config 0
                    if v:
                        qty = v
                except:
                    pass

                part_num = ""
                try:
                    import os
                    part_num = os.path.splitext(os.path.basename(path))[0] if path else ""
                except:
                    pass

                comp = {"level": level, "part_number": part_num, "path": path, "qty": qty}
                components.append(comp)

                if i < 20:   # print first 20
                    indent = "  " + "  " * level
                    print(f"{indent}[L{level}] {part_num}  qty={qty}")
            except Exception as row_err:
                print(f"  Row {i} error: {row_err}")

        if len(rows) > 20:
            print(f"  ... ({len(rows) - 20} more rows)")

        print(f"\n  SUCCESS: read {len(components)} components from PDM directly via Python COM")

        # Save raw result for inspection
        out_path = f"test_pdm_direct_{part_name}.json"
        with open(out_path, "w") as f:
            json.dump({"components": components}, f, indent=2, default=str)
        print(f"  Saved raw data to: {out_path}")

    except Exception as e:
        print(f"  ERROR reading rows: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_pdm_direct.py <part_number>")
        print("Example: python test_pdm_direct.py 005-AS-01306")
        sys.exit(1)

    test_pdm_com(sys.argv[1])
