"""
pdm_native_extractor.py
=======================
Pure-Python PDM BOM extractor using comtypes (vtable COM).

Replaces the C# PdmBomExporter.exe subprocess on machines where the flag
  pdm_settings.json → "use_native_extractor": true
is set.  Prod machines keep that flag False and are completely unaffected.

Output format is identical to the JSON file produced by PdmBomExporter.exe so
that all downstream code in pdm_bom_parser.py works without any changes.

Requirements (already present in the dev venv):
    pip install comtypes pywin32 Pillow
"""

import os
import base64
import ctypes
import ctypes.wintypes
import io
import pythoncom
from datetime import datetime

EDM_DLL = r"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS PDM\EdmInterface.dll"

# ── Thumbnail helper ───────────────────────────────────────────────────────────

class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize",          ctypes.c_uint32),
        ("biWidth",         ctypes.c_int32),
        ("biHeight",        ctypes.c_int32),
        ("biPlanes",        ctypes.c_uint16),
        ("biBitCount",      ctypes.c_uint16),
        ("biCompression",   ctypes.c_uint32),
        ("biSizeImage",     ctypes.c_uint32),
        ("biXPelsPerMeter", ctypes.c_int32),
        ("biYPelsPerMeter", ctypes.c_int32),
        ("biClrUsed",       ctypes.c_uint32),
        ("biClrImportant",  ctypes.c_uint32),
    ]

class _BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", _BITMAPINFOHEADER),
                ("bmiColors", ctypes.c_uint32 * 3)]

class _SIZE(ctypes.Structure):
    _fields_ = [("cx", ctypes.c_long), ("cy", ctypes.c_long)]


def _hbitmap_to_png(hbm_int: int) -> bytes | None:
    """
    Convert a Windows HBITMAP (as a Python int) to PNG bytes using
    GDI GetDIBits.  Works correctly on 64-bit Windows where HBITMAP
    values can exceed 32 bits, unlike win32ui.CreateBitmapFromHandle.
    """
    from PIL import Image

    gdi32   = ctypes.windll.gdi32
    user32  = ctypes.windll.user32

    # Use a size_t-wide handle to avoid 32-bit overflow
    HBITMAP = ctypes.c_size_t(hbm_int)

    # Probe dimensions with a BITMAPINFO that has biHeight=0
    bmi = _BITMAPINFO()
    bmi.bmiHeader.biSize = ctypes.sizeof(_BITMAPINFOHEADER)

    hdc = user32.GetDC(0)
    gdi32.GetDIBits.restype = ctypes.c_int
    gdi32.GetDIBits.argtypes = [
        ctypes.c_size_t, ctypes.c_size_t, ctypes.c_uint, ctypes.c_uint,
        ctypes.c_void_p, ctypes.POINTER(_BITMAPINFO), ctypes.c_uint,
    ]
    # First call: fills in dimensions (pass cLines=0, lpvBits=None)
    gdi32.GetDIBits(hdc, HBITMAP, 0, 0, None, ctypes.byref(bmi), 0)

    w = bmi.bmiHeader.biWidth
    h = abs(bmi.bmiHeader.biHeight)
    if w <= 0 or h <= 0:
        user32.ReleaseDC(0, hdc)
        return None

    # Second call: extract pixels as 32-bit BGRA
    bmi.bmiHeader.biBitCount    = 32
    bmi.bmiHeader.biCompression = 0   # BI_RGB
    bmi.bmiHeader.biHeight      = -h  # top-down DIB
    buf = (ctypes.c_uint8 * (w * h * 4))()
    rows = gdi32.GetDIBits(hdc, HBITMAP, 0, h, buf, ctypes.byref(bmi), 0)
    user32.ReleaseDC(0, hdc)

    if rows == 0:
        return None

    img = Image.frombuffer("RGBA", (w, h), bytes(buf), "raw", "BGRA", 0, 1)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _get_thumbnail_base64(file_path: str, size: int = 256) -> dict:
    """
    Extract a thumbnail for a SolidWorks file using the Windows Shell
    IShellItemImageFactory COM interface.  This is the same mechanism Windows
    Explorer uses and works through the SolidWorks thumbnail provider already
    registered on the machine.

    Returns a thumbnail dict compatible with the C# exporter JSON format:
      { available, width, height, format, size_bytes, data_base64 }
    """
    _empty = {"available": False, "width": 0, "height": 0,
               "format": "", "size_bytes": 0, "data_base64": ""}

    if not file_path or not os.path.exists(file_path):
        return _empty

    try:
        import comtypes

        IID_IShellItemImageFactory = comtypes.GUID("{BCC18B79-BA16-442F-80C4-8A59C30C463B}")
        shell32 = ctypes.windll.shell32
        shell32.SHCreateItemFromParsingName.restype = ctypes.HRESULT
        shell32.SHCreateItemFromParsingName.argtypes = [
            ctypes.c_wchar_p, ctypes.c_void_p,
            ctypes.POINTER(comtypes.GUID),
            ctypes.POINTER(ctypes.c_void_p),
        ]

        pitem = ctypes.c_void_p()
        hr = shell32.SHCreateItemFromParsingName(
            file_path, None,
            ctypes.byref(IID_IShellItemImageFactory),
            ctypes.byref(pitem),
        )
        if hr != 0 or not pitem.value:
            return _empty

        iface_ptr  = ctypes.cast(pitem.value, ctypes.POINTER(ctypes.c_void_p))
        vtable_ptr = ctypes.cast(iface_ptr[0], ctypes.POINTER(ctypes.c_void_p))
        GetImage   = ctypes.WINFUNCTYPE(
            ctypes.HRESULT,
            ctypes.c_void_p, _SIZE, ctypes.c_int,
            ctypes.POINTER(ctypes.c_void_p),
        )(vtable_ptr[3])

        hbm = ctypes.c_void_p()
        hr  = GetImage(pitem.value, _SIZE(size, size), 0x1, ctypes.byref(hbm))
        if hr != 0 or not hbm.value:
            return _empty

        png_bytes = _hbitmap_to_png(hbm.value)
        ctypes.windll.gdi32.DeleteObject(ctypes.c_size_t(hbm.value))

        if not png_bytes:
            return _empty

        from PIL import Image
        img = Image.open(io.BytesIO(png_bytes))
        w, h = img.size

        return {
            "available":   True,
            "width":       w,
            "height":      h,
            "format":      "png",
            "size_bytes":  len(png_bytes),
            "data_base64": base64.b64encode(png_bytes).decode("utf-8"),
        }

    except Exception as e:
        print(f"  [thumbnail] {os.path.basename(file_path)}: {e}")
        return _empty


# ── BOM extraction ─────────────────────────────────────────────────────────────

def _get_var(cell, col_id: int, col_type: int) -> str:
    """Call IEdmBomCell.GetVar and return the best available string value."""
    try:
        v, cv, _, _ = cell.GetVar(col_id, col_type)
        val = cv or v
        return str(val).strip() if val is not None else ""
    except Exception:
        return ""


def _build_var_id_map(vault5, var_names: list) -> dict:
    """
    Map PDM variable names to their vault database IDs.

    IEdmBomCell.GetVar(columnID, meType=0) requires the PDM variable DB ID,
    NOT the mlColumnID from the BOM column object (which is just the column
    display order index — 1, 2, 3… — and is NOT the variable ID).

    We query the vault with GetVariableByName() for a dynamic lookup, then
    fall back to IDs discovered by brute-force on this vault if that fails.
    """
    id_map = {}

    # Dynamic lookup — works when IEdmVault5.GetVariableByName is available
    for name in var_names:
        try:
            var_obj = vault5.GetVariableByName(name)
            if var_obj is not None:
                id_map[name] = var_obj.ID
                print(f"[native extractor]   var '{name}' -> ID={var_obj.ID}")
        except Exception as e:
            print(f"[native extractor]   GetVariableByName('{name}') skipped: {e}")

    # Fallback: IDs confirmed by brute-force on this vault.
    # Variable IDs are vault-specific but are stable once assigned.
    _fallbacks = {
        "Revision":    48,
        "Description": 61,
        "Material":    67,
    }
    for name, fid in _fallbacks.items():
        if name not in id_map:
            print(f"[native extractor]   var '{name}' -> ID={fid} (fallback)")
            id_map[name] = fid

    return id_map


def _get_file7_by_path(vault5, edm, path: str):
    """
    Look up a SolidWorks file in the vault by its local path and return
    an IEdmFile7 interface pointer.  Returns None on failure.
    """
    if not path:
        return None

    # NOTE: IEdmVault5.GetFileFromPath has broken [out]-param comtypes bindings
    # and always throws; skip straight to the search fallback below.
    try:
        srch = vault5.CreateSearch()
        srch.Recursive = True
        srch.FileName = os.path.basename(path)
        result = srch.GetFirstResult()
        if result is not None:
            return result.QueryInterface(edm.IEdmFile7)
    except Exception:
        pass

    return None


def _collect_bom_rows_recursive(
    file7,
    edm,
    vault5,
    layout: str,
    configuration: str,
    var_id_map: dict,
    pn_col,
    qty_type: int,
    state_col,
    include_thumbnails: bool,
    base_level: int,
    visited: set,
    bom_col_map: dict = None,
) -> list:
    """
    Build the complete BOM sub-tree for *file7* by:

    1. Calling GetComputedBOM on *file7* and reading ONLY the level-1 rows
       (its direct children).  Deeper rows from the same call are ignored —
       they will be produced by recursive calls below.  This avoids the
       "partial expansion" problem where GetComputedBOM sometimes expands a
       sub-assembly incompletely: by always using each file's OWN BOM for
       its direct children, we guarantee completeness at every level.

    2. For every SLDASM found among the direct children, calling this
       function recursively.  Purchased assemblies (those whose own BOM
       returns 0 direct children) naturally stay as leaves.

    *base_level* — the absolute tree depth for this assembly's direct
    children (1 = direct children of root).

    *visited* — set of vault file IDs already expanded; prevents infinite
    loops on circular references and avoids re-expanding the same
    sub-assembly if it is referenced from multiple branches.
    """
    try:
        file_id = file7.ID
    except Exception:
        return []

    if file_id in visited:
        return []
    visited.add(file_id)

    # Get the BOM for this assembly (versionSpec=0 → use local/current version,
    # which tends to give more complete results than versionSpec=1)
    bom = None
    for vs in (0, 1):
        try:
            bom = file7.GetComputedBOM(layout, 0, configuration, vs)
            if bom is not None:
                break
        except Exception as e:
            print(f"[native extractor]   GetComputedBOM(vs={vs}) failed (id={file_id}): {e}")

    if bom is None:
        return []

    raw_rows = list(bom.GetRows())
    if not raw_rows:
        return []

    # Read every cell — we need level so we can filter to direct children only.
    cell_data = []
    for row_unk in raw_rows:
        try:
            cell = row_unk.QueryInterface(edm.IEdmBomCell)
            cell_data.append({
                "cell":  cell,
                "level": cell.GetTreeLevel(),
                "path":  cell.GetPathName() or "",
            })
        except Exception:
            cell_data.append(None)

    # Build an index: for each level-1 SLDASM row (by position in cell_data),
    # does the BOM contain ANY row at level > 1 immediately after it?
    # This tells us whether the BOM layout chose to EXPAND that assembly
    # (transparent/dissolved) or left it as a LEAF (purchased/non-dissolved).
    #
    # Rule:
    #   EXPANDED in BOM (next row level > 1) → recurse into it so we get its
    #     COMPLETE set of children (the current BOM may partially expand it).
    #   LEAF in BOM (next row level <= 1 or no next row) → purchased assembly;
    #     trust the BOM layout's decision and do NOT recurse into it.
    n = len(cell_data)
    def _next_level(i):
        """Level of the next non-None cell after position i."""
        for j in range(i + 1, n):
            if cell_data[j] is not None:
                return cell_data[j]["level"]
        return -1

    result = []

    for i, cd in enumerate(cell_data):
        if cd is None:
            continue

        # ── Only extract DIRECT children (local level == 1) ───────────────────
        # Higher-level rows are sub-children; they will be produced by recursion
        # into the level-1 SLDASM parent that owns them.  Ignoring them here
        # avoids duplicate entries when the BOM partially expands a sub-assembly.
        if cd["level"] != 1:
            continue

        cell     = cd["cell"]
        path     = cd["path"]
        filename = os.path.basename(path)
        fname_up = filename.upper()

        # ── Part number ────────────────────────────────────────────────────────
        part_number = ""
        if pn_col:
            part_number = _get_var(cell, 0, pn_col.meType)
        if not part_number:
            part_number = os.path.splitext(filename)[0] if filename else ""

        # ── Instance quantity ──────────────────────────────────────────────────
        qty = 1
        try:
            raw = _get_var(cell, 0, qty_type)
            if raw:
                qty = int(float(raw))
        except Exception:
            pass

        # ── Variable columns ───────────────────────────────────────────────────
        if bom_col_map:
            # Use BOM layout column map (correct approach)
            col_values = {}
            for caption, col_info in bom_col_map.items():
                val = ""
                try:
                    val = _get_var(cell, col_info["id"], col_info["type"])
                except Exception:
                    pass
                if not val and path:
                    try:
                        f7 = _get_file7_by_path(vault5, edm, path)
                        if f7:
                            from pdm_native_extractor import _file_var_simple
                            val = _file_var_simple(f7, caption, configuration)
                    except Exception:
                        pass
                col_values[caption] = val
            for key in ("Description", "Revision", "Material", "FINISH1", "FINISH2"):
                if key not in col_values:
                    col_values[key] = ""
        else:
            # Legacy fallback using var_id_map
            col_values = {
                "Description": _get_var(cell, var_id_map["Description"], 0) if "Description" in var_id_map else "",
                "Revision":    _get_var(cell, var_id_map["Revision"],    0) if "Revision"    in var_id_map else "",
                "Material":    _get_var(cell, var_id_map["Material"],    0) if "Material"    in var_id_map else "",
                "FINISH1":     _get_var(cell, var_id_map["FINISH1"],     0) if "FINISH1"     in var_id_map else "",
                "FINISH2":     _get_var(cell, var_id_map["FINISH2"],     0) if "FINISH2"     in var_id_map else "",
            }
        state = _get_var(cell, 0, state_col.meType) if state_col else ""

        # ── Thumbnail ──────────────────────────────────────────────────────────
        thumb = {"available": False}
        if include_thumbnails and path:
            thumb = _get_thumbnail_base64(path)

        result.append({
            "level":             base_level,
            "part_number":       part_number,
            "file_name":         filename,
            "instance_quantity": qty,
            "state":             state,
            "configuration":     configuration,
            "bom_columns":       col_values,
            "thumbnail":         thumb,
            "full_path":         path,
        })

        # ── Recurse only into SLDASMs that the BOM expanded ───────────────────
        # If the BOM returned this SLDASM with children (next row level > 1),
        # the layout treats it as transparent/dissolved → recurse into its own
        # BOM to get the COMPLETE child list (the current BOM may be partial).
        # If the BOM returned it as a LEAF (next row level <= 1), the layout
        # treats it as a purchased/non-dissolved component → keep as single entry.
        if fname_up.endswith(".SLDASM") and path:
            bom_expanded = (_next_level(i) > 1)
            if bom_expanded:
                sub_file7 = _get_file7_by_path(vault5, edm, path)
                if sub_file7 is not None:
                    sub_rows = _collect_bom_rows_recursive(
                        file7=sub_file7,
                        edm=edm,
                        vault5=vault5,
                        layout=layout,
                        configuration=configuration,
                        var_id_map=var_id_map,
                        pn_col=pn_col,
                        qty_type=qty_type,
                        state_col=state_col,
                        include_thumbnails=include_thumbnails,
                        base_level=base_level + 1,
                        visited=visited,
                    )
                    result.extend(sub_rows)

    return result


def get_latest_files_native(
    part_number: str,
    revision: str | None,
    extensions: list,
) -> dict:
    """
    Native Python equivalent of the C# PdmGetLatestFiles.GetLatestVersion logic.

    Searches the PDM vault for files matching the given part number / revision /
    extension combination and downloads them to the local PDM working-folder cache
    via IEdmFile5.GetFileCopy (or IEdmBatchGet for .SLDASM files).

    Mirrors the C# PdmGetLatestFiles.RetrieveFile() pattern:
        - With revision:    search for "{part_number} REV{revision}{ext}"
        - Without revision: search for "{part_number}{ext}"
        - .SLDASM files:    use BatchGet to also sync all sub-assembly references

    Parameters
    ----------
    part_number : str
        Part number, e.g. "029-MP-03299" or "039-AS-01564"
    revision : str | None
        Revision string, e.g. "03".  Pass None for assembly files that have
        no revision in their filename.
    extensions : list[str]
        File extensions to retrieve, e.g. [".pdf", ".x_t"] or [".sldasm"]

    Returns
    -------
    dict with keys:
        success        bool   – True if at least one file was retrieved
        retrieved      list   – [{"filename": str, "local_path": str}]
        failed         list   – [{"filename": str, "error": str}]
        error          str    – top-level error message (empty on success)
    """
    hr = pythoncom.CoInitialize()
    try:
        return _get_latest_files_impl(part_number, revision, extensions)
    finally:
        if hr == 0:
            pythoncom.CoUninitialize()


def get_part_info_native(part_number: str, revision: str | None = None) -> dict:
    """
    Look up a single part in the PDM vault and return its metadata (state,
    description, material, finishes). Tries .SLDASM first then .SLDPRT.

    Parameters
    ----------
    part_number : str
        e.g. "029-MP-03299" or "039-AS-01564"
    revision : str | None
        Revision string, e.g. "03". If provided, searches for
        "{part_number} REV{revision}.{ext}". If None, searches for
        "{part_number}.{ext}" (most recent file wins).

    Returns
    -------
    dict with keys:
        success     : bool
        found       : bool   – True if a matching file was located in the vault
        part_number : str
        revision    : str    – As provided (or extracted from filename when None)
        state       : str    – PDM workflow state (e.g. "Released", "Work in progress")
        description : str
        material    : str
        finish1     : str
        finish2     : str
        file_ext    : str    – Which extension matched (.SLDASM or .SLDPRT)
        path        : str    – Vault path of the matched file
        error       : str    – Top-level error message
    """
    hr = pythoncom.CoInitialize()
    try:
        return _get_part_info_impl(part_number, revision)
    finally:
        if hr == 0:
            pythoncom.CoUninitialize()


def _get_part_info_impl(part_number: str, revision: str | None) -> dict:
    import comtypes.client

    result = {
        "success": False, "found": False, "part_number": part_number,
        "revision": revision or "", "state": "", "description": "",
        "material": "", "finish1": "", "finish2": "",
        "file_ext": "", "path": "", "error": "",
    }

    try:
        edm    = comtypes.client.GetModule(EDM_DLL)
        vault  = comtypes.client.CreateObject("ConisioLib.EdmVault")
        vault5 = vault.QueryInterface(edm.IEdmVault5)
        vault5.LoginAuto("PDM", 0)
    except Exception as e:
        result["error"] = f"Vault connection failed: {e}"
        return result

    rev_clean = ""
    if revision:
        rev_raw = revision.replace("REV", "").replace("rev", "").strip()
        try:
            rev_clean = f"{int(rev_raw):02d}"
        except ValueError:
            rev_clean = rev_raw

    candidates = []
    for ext in [".SLDASM", ".SLDPRT"]:
        if rev_clean:
            candidates.append(f"{part_number} REV{rev_clean}{ext}")
        else:
            candidates.append(f"{part_number}{ext}")

    found_file = None
    matched_ext = ""
    for fname in candidates:
        try:
            srch = vault5.CreateSearch()
            srch.Recursive = True
            srch.FileName = fname
            r = srch.GetFirstResult()
            if r is not None:
                # IEdmSearchResult5 does not expose GetEnumeratorVariable /
                # CurrentState directly; QI to IEdmFile7 (inherits IEdmFile5).
                try:
                    found_file = r.QueryInterface(edm.IEdmFile7)
                except Exception:
                    try:
                        found_file = r.QueryInterface(edm.IEdmFile5)
                    except Exception:
                        found_file = r
                matched_ext = os.path.splitext(fname)[1]
                break
        except Exception:
            continue

    if not found_file:
        result["error"] = f"Part not found in vault: {part_number}" + (f" REV{rev_clean}" if rev_clean else "")
        return result

    result["found"] = True
    result["file_ext"] = matched_ext
    try:
        result["path"] = found_file.Path or ""
    except Exception:
        try:
            result["path"] = found_file._get_Path() or ""
        except Exception:
            pass

    # IEdmFile5::CurrentState in comtypes vtable binding is exposed as a
    # getter method, not a Python property. Try both forms, then fall back to
    # QI'ing IEdmFile5 explicitly.
    state_obj = None
    for accessor in (
        lambda f: f._get_CurrentState(),
        lambda f: f.CurrentState,
        lambda f: f.QueryInterface(edm.IEdmFile5)._get_CurrentState(),
        lambda f: f.QueryInterface(edm.IEdmFile5).CurrentState,
    ):
        try:
            state_obj = accessor(found_file)
            if state_obj is not None:
                break
        except Exception:
            continue
    if state_obj is not None:
        for name_accessor in (
            lambda s: s._get_Name(),
            lambda s: s.Name,
        ):
            try:
                nm = name_accessor(state_obj)
                if nm:
                    result["state"] = str(nm).strip()
                    break
            except Exception:
                continue
    if not result["state"]:
        print(f"[get_part_info]   CurrentState lookup unavailable for {part_number}")

    def _read_var(name: str) -> str:
        try:
            enum_var = found_file.GetEnumeratorVariable()
            if enum_var is None:
                return ""
            for cfg in ["@", "Default", ""]:
                try:
                    res = enum_var.GetVar(name, cfg)
                    val = res[0] if isinstance(res, tuple) else res
                    if val is not None:
                        s = str(val).strip()
                        if s:
                            return s
                except Exception:
                    continue
        except Exception:
            return ""
        return ""

    result["description"] = _read_var("Description")
    result["material"]    = _read_var("Material")
    result["finish1"]     = _read_var("FINISH1")
    result["finish2"]     = _read_var("FINISH2")

    if not result["revision"]:
        rev_from_file = _read_var("Revision")
        if rev_from_file:
            result["revision"] = rev_from_file

    result["success"] = True
    return result


def find_latest_revision_in_pdm(part_number: str, max_revision: int = 50) -> dict:
    """
    Find the highest revision number that exists in the PDM vault for a given
    part number. Brute-forces REV01 .. REV{max_revision} via vault search
    (wildcards in IEdmSearch5.FileName are unreliable for our naming pattern).

    Returns
    -------
    dict:
        success         : bool
        latest_revision : str   – e.g. "03" (zero-padded), empty if nothing found
        file_ext        : str   – ".SLDASM" or ".SLDPRT" (matched extension)
        error           : str
    """
    hr = pythoncom.CoInitialize()
    try:
        return _find_latest_revision_impl(part_number, max_revision)
    finally:
        if hr == 0:
            pythoncom.CoUninitialize()


def _find_latest_revision_impl(part_number: str, max_revision: int) -> dict:
    import comtypes.client

    result = {"success": False, "latest_revision": "", "file_ext": "", "error": ""}

    try:
        edm    = comtypes.client.GetModule(EDM_DLL)
        vault  = comtypes.client.CreateObject("ConisioLib.EdmVault")
        vault5 = vault.QueryInterface(edm.IEdmVault5)
        vault5.LoginAuto("PDM", 0)
    except Exception as e:
        result["error"] = f"Vault connection failed: {e}"
        return result

    best_rev = ""
    matched_ext = ""

    # Scan downwards so the first hit is the highest revision. Try .SLDASM
    # first then .SLDPRT for each candidate revision.
    for rev_num in range(max_revision, 0, -1):
        rev_str = f"{rev_num:02d}"
        hit = False
        for ext in (".SLDASM", ".SLDPRT"):
            fname = f"{part_number} REV{rev_str}{ext}"
            try:
                srch = vault5.CreateSearch()
                srch.Recursive = True
                srch.FileName = fname
                r = srch.GetFirstResult()
                if r is not None:
                    best_rev = rev_str
                    matched_ext = ext
                    hit = True
                    break
            except Exception:
                continue
        if hit:
            break

    result["success"] = True
    result["latest_revision"] = best_rev
    result["file_ext"] = matched_ext
    return result


def find_newer_revisions_batch(
    items: list,
    gap_tolerance: int = 2,
    probe_cap: int = 15,
    deadline: float | None = None,
) -> dict:
    """
    Batch check whether the PDM vault holds a NEWER revision than the one we
    already know for each part. Single COM init + single vault login for the
    whole batch (same pattern as get_latest_files_batch).

    Unlike find_latest_revision_in_pdm (which scans REV50→REV01, ~100 searches
    per part), this probes UPWARD from current_rev+1 — an up-to-date part costs
    only `gap_tolerance` revisions × 2 extensions of searches.

    Parameters
    ----------
    items : list[dict]
        Each dict: {"part_number": str, "current_rev": int}
        current_rev is the highest revision number already known (0 if unknown).
    gap_tolerance : int
        Consecutive missing revision numbers tolerated before concluding there
        is nothing newer (covers occasionally skipped rev numbers).
    probe_cap : int
        Max revisions probed above current_rev per part.
    deadline : float | None
        time.monotonic() value; once exceeded, remaining parts are returned
        with success=False, error='deadline'.

    Returns
    -------
    dict keyed by part_number:
        {"success": bool, "latest_revision": "05" or "", "error": ""}
        latest_revision == "" with success=True means no newer revision found.
        success=False means the lookup failed — caller must treat as unknown.
    """
    hr = pythoncom.CoInitialize()
    try:
        return _find_newer_revisions_batch_impl(items, gap_tolerance, probe_cap, deadline)
    finally:
        if hr == 0:
            pythoncom.CoUninitialize()


def _find_newer_revisions_batch_impl(
    items: list, gap_tolerance: int, probe_cap: int, deadline: float | None
) -> dict:
    import time
    import comtypes.client

    results = {}

    try:
        edm    = comtypes.client.GetModule(EDM_DLL)
        vault  = comtypes.client.CreateObject("ConisioLib.EdmVault")
        vault5 = vault.QueryInterface(edm.IEdmVault5)
        vault5.LoginAuto("PDM", 0)
    except Exception as e:
        err = f"Vault connection failed: {e}"
        for item in items:
            results[item["part_number"]] = {"success": False, "latest_revision": "", "error": err}
        return results

    def _exists(fname: str) -> bool:
        srch = vault5.CreateSearch()
        srch.Recursive = True
        srch.FileName = fname
        return srch.GetFirstResult() is not None

    def _bare_file_revision(pn: str) -> str:
        """Some vault files are named '{pn}.SLDPRT' (no REV suffix) with the
        revision only in the 'Revision' card variable. Return that value
        ('' if no bare-named file exists or the variable is unreadable)."""
        for ext in (".SLDASM", ".SLDPRT"):
            try:
                srch = vault5.CreateSearch()
                srch.Recursive = True
                srch.FileName = f"{pn}{ext}"
                r = srch.GetFirstResult()
                if r is None:
                    continue
                try:
                    fobj = r.QueryInterface(edm.IEdmFile7)
                except Exception:
                    fobj = r.QueryInterface(edm.IEdmFile5)
                enum_var = fobj.GetEnumeratorVariable()
                if enum_var is None:
                    return ""
                for cfg in ["@", "Default", ""]:
                    try:
                        res = enum_var.GetVar("Revision", cfg)
                        val = res[0] if isinstance(res, tuple) else res
                        if val is not None and str(val).strip():
                            return str(val).strip()
                    except Exception:
                        continue
                return ""
            except Exception:
                continue
        return ""

    for item in items:
        pn = item["part_number"]
        current_rev = int(item.get("current_rev") or 0)

        if deadline is not None and time.monotonic() > deadline:
            results[pn] = {"success": False, "latest_revision": "", "error": "deadline"}
            continue

        try:
            best_rev = ""
            misses = 0
            for rev_num in range(current_rev + 1, current_rev + 1 + probe_cap):
                rev_str = f"{rev_num:02d}"
                hit = False
                for ext in (".SLDASM", ".SLDPRT"):
                    try:
                        if _exists(f"{pn} REV{rev_str}{ext}"):
                            hit = True
                            break
                    except Exception:
                        continue
                if hit:
                    best_rev = rev_str
                    misses = 0
                else:
                    misses += 1
                    if misses >= gap_tolerance:
                        break

            if not best_rev:
                # No REV-named file newer than current_rev — check the bare-name
                # convention where the revision lives in the card variable only.
                bare_rev = _bare_file_revision(pn)
                bare_clean = bare_rev.replace("REV", "").replace("rev", "").strip()
                if bare_clean.isdigit() and int(bare_clean) > current_rev:
                    best_rev = f"{int(bare_clean):02d}"

            results[pn] = {"success": True, "latest_revision": best_rev, "error": ""}
        except Exception as e:
            results[pn] = {"success": False, "latest_revision": "", "error": str(e)}

    return results


def get_latest_files_batch(files_list: list) -> dict:
    """
    Batch version of get_latest_files_native — single COM init and vault login
    for all files. Much faster for large BOMs (100+ parts).

    Parameters
    ----------
    files_list : list[dict]
        Each dict has: part_number, revision (optional), extensions (list)

    Returns
    -------
    dict with keys: success, retrieved, failed, error
    """
    hr = pythoncom.CoInitialize()
    try:
        return _get_latest_files_batch_impl(files_list)
    finally:
        if hr == 0:
            pythoncom.CoUninitialize()


def _get_latest_files_batch_impl(files_list: list) -> dict:
    """Inner batch implementation — single vault connection for all files."""
    import comtypes.client

    result = {"success": False, "retrieved": [], "failed": [], "error": ""}

    try:
        edm    = comtypes.client.GetModule(EDM_DLL)
        vault  = comtypes.client.CreateObject("ConisioLib.EdmVault")
        vault5 = vault.QueryInterface(edm.IEdmVault5)
        vault5.LoginAuto("PDM", 0)
    except Exception as e:
        result["error"] = f"Vault connection failed: {e}"
        return result

    for file_req in files_list:
        part_number = file_req['part_number']
        revision = file_req.get('revision')
        extensions = file_req.get('extensions', ['.pdf', '.x_t'])
        has_revision = bool(revision)

        for ext in extensions:
            is_step = ext.lower() in ('.step', '.stp')

            # For STEP files, try common suffixes since vault search doesn't support wildcards
            if is_step and has_revision:
                suffixes = ['', '_0', '_1', '_2', '-L', '-R', '-T', '-B']
                step_exts = ['.step', '.STEP', '.stp', '.STP']
                seen_paths = set()

                for suffix in suffixes:
                    full_name = f"{part_number}_REV{revision}{suffix}"
                    for sext in step_exts:
                        try:
                            srch = vault5.CreateSearch()
                            srch.Recursive = True
                            srch.FileName  = f"{full_name}{sext}"
                            hit = srch.GetFirstResult()
                            if hit:
                                hit_path = hit.Path or ""
                                if hit_path and hit_path not in seen_paths:
                                    seen_paths.add(hit_path)
                                    try:
                                        file7_obj = hit.QueryInterface(edm.IEdmFile7)
                                        _batch_get_latest(vault5, edm, file7_obj, hit_path)
                                        result["retrieved"].append({
                                            "filename": os.path.basename(hit_path),
                                            "local_path": hit_path,
                                        })
                                        print(f"[batch get-latest] Retrieved STEP: {os.path.basename(hit_path)}")
                                    except Exception as dl_err:
                                        result["failed"].append({
                                            "filename": os.path.basename(hit_path),
                                            "error": str(dl_err),
                                        })
                        except Exception:
                            pass
                continue

            # Non-STEP files: standard search
            is_underscore_rev = ext.lower() in ('.step', '.stp', '.easm')
            if has_revision:
                if is_underscore_rev:
                    patterns = [f"{part_number}_REV{revision}{ext}"]
                else:
                    patterns = [f"{part_number} REV{revision}{ext}"]
            else:
                patterns = [
                    f"{part_number}{ext}",
                    f"{part_number}*{ext}",
                ]

            found_file = None
            found_path = ""
            for pattern in patterns:
                try:
                    srch = vault5.CreateSearch()
                    srch.Recursive = True
                    srch.FileName  = pattern
                    hit = srch.GetFirstResult()
                    if hit:
                        found_file = hit
                        found_path = hit.Path or ""
                        break
                except Exception:
                    pass

            if not found_file or not found_path:
                result["failed"].append({
                    "filename": f"{part_number} REV{revision}{ext}" if has_revision else f"{part_number}{ext}",
                    "error": "File not found in PDM vault",
                })
                continue

            try:
                file7_obj = found_file.QueryInterface(edm.IEdmFile7)
                _batch_get_latest(vault5, edm, file7_obj, found_path)
                result["retrieved"].append({
                    "filename": os.path.basename(found_path),
                    "local_path": found_path,
                })
                print(f"[batch get-latest] Retrieved: {os.path.basename(found_path)}")
            except Exception as dl_err:
                result["failed"].append({
                    "filename": os.path.basename(found_path),
                    "error": str(dl_err),
                })

    result["success"] = len(result["retrieved"]) > 0
    return result


def _vault_find_by_fnmatch(vault5, part_number_prefix: str, fnmatch_pattern: str):
    """
    Targeted vault walk: only checks top-level folders whose name starts with
    the part-number prefix (e.g. "034"), then only looks inside "PDF and XT"
    sub-folders.  Returns (file_com_obj, folder_id, local_path) or None.

    This is the correct fallback for revision-unknown lookups because
    IEdmSearch.FileName does NOT support wildcards — it only matches exact names.
    Benchmarked at ~55 ms for a typical vault, so it is fast enough for
    on-demand use.
    """
    import fnmatch as _fnmatch

    _OFF_RIGHT = -2147220984   # "cursor is off-right" — normal PDM end-of-list

    def _iter_files(folder):
        try:
            pos = folder.GetFirstFilePosition()
            while True:
                try:
                    f = folder.GetNextFile(pos)
                    if f is None:
                        break
                    yield f, folder.ID
                except Exception as e:
                    if getattr(e, "args", (None,))[0] == _OFF_RIGHT:
                        break
                    break
        except Exception:
            pass

    def _iter_subfolders(folder):
        try:
            pos = folder.GetFirstSubFolderPosition()
            while True:
                try:
                    sub = folder.GetNextSubFolder(pos)
                    if sub is None:
                        break
                    yield sub
                except Exception as e:
                    if getattr(e, "args", (None,))[0] == _OFF_RIGHT:
                        break
                    break
        except Exception:
            pass

    try:
        root = vault5.GetFolderFromPath("C:\\PDM\\Projects")
    except Exception as e:
        print(f"[vault-walk] GetFolderFromPath failed: {e}")
        return None

    pattern_lower = fnmatch_pattern.lower()

    all_matches = []
    for top_folder in _iter_subfolders(root):
        name = top_folder.Name or ""
        if not name.startswith(part_number_prefix):
            continue
        for sub in _iter_subfolders(top_folder):
            if (sub.Name or "").lower() != "pdf and xt":
                continue
            for f, folder_id in _iter_files(sub):
                fname = f.Name or ""
                if _fnmatch.fnmatch(fname.lower(), pattern_lower):
                    local_path = ""
                    try:
                        local_path = f.GetLocalPath(folder_id)
                    except Exception:
                        pass
                    all_matches.append((f, folder_id, local_path))

    if not all_matches:
        return None

    # Prefer the match with the highest revision number (e.g. REV01 > DRAFT)
    import re as _re
    _rev_pat = _re.compile(r'rev(\d+)', _re.IGNORECASE)

    def _rev_key(m):
        hit = _rev_pat.search(m[2] or "")
        return int(hit.group(1)) if hit else -1

    return max(all_matches, key=_rev_key)


def _get_latest_files_impl(
    part_number: str,
    revision: str | None,
    extensions: list,
) -> dict:
    """Inner implementation — called after CoInitialize."""
    import comtypes.client

    result = {"success": False, "retrieved": [], "failed": [], "error": ""}

    try:
        edm    = comtypes.client.GetModule(EDM_DLL)
        vault  = comtypes.client.CreateObject("ConisioLib.EdmVault")
        vault5 = vault.QueryInterface(edm.IEdmVault5)
        vault5.LoginAuto("PDM", 0)
    except Exception as e:
        result["error"] = f"Vault connection failed: {e}"
        return result

    has_revision = bool(revision)

    for ext in extensions:
        # Build search patterns — same logic as C# PdmGetLatestFiles
        is_step = ext.lower() in ('.step', '.stp')
        is_underscore_rev = ext.lower() in ('.step', '.stp', '.easm')
        if has_revision:
            # STEP/EASM files use underscore before REV (e.g., XXX-MP-XXXXX_REV03.step)
            # PDF/X_T files use space before REV (e.g., XXX-MP-XXXXX REV03.pdf)
            if is_underscore_rev:
                # Wildcard to catch suffixes like _0, -L, -R
                patterns = [f"{part_number}_REV{revision}*{ext}"]
            else:
                patterns = [f"{part_number} REV{revision}{ext}"]
        else:
            patterns = [
                f"{part_number}{ext}",   # exact match (only exact names work in IEdmSearch)
            ]

        # For STEP files, PDM vault search doesn't support wildcards properly.
        # Search for the base file + common suffixes as exact names (no revision param).
        if is_step and has_revision:
            # Common STEP suffixes: base (no suffix), _0, -L, -R, _1, _2, etc.
            suffixes = ['', '_0', '_1', '_2', '-L', '-R', '-T', '-B']
            step_exts = ['.step', '.STEP', '.stp', '.STP']
            all_step_hits = []
            seen_paths = set()

            for suffix in suffixes:
                full_name = f"{part_number}_REV{revision}{suffix}"
                for sext in step_exts:
                    try:
                        srch = vault5.CreateSearch()
                        srch.Recursive = True
                        srch.FileName  = f"{full_name}{sext}"
                        hit = srch.GetFirstResult()
                        if hit:
                            hit_path = hit.Path or ""
                            if hit_path and hit_path not in seen_paths:
                                seen_paths.add(hit_path)
                                all_step_hits.append((hit, hit_path))
                                print(f"[native get-latest] Found STEP: {hit_path}")
                    except Exception as se:
                        pass  # Silently skip failed searches

            if not all_step_hits:
                result["failed"].append({
                    "filename": f"{part_number}_REV{revision}{ext}",
                    "error":    "File not found in PDM vault",
                })
                print(f"[native get-latest] No STEP files found for {part_number}_REV{revision}")
            else:
                for step_hit, step_path in all_step_hits:
                    try:
                        file7_obj = step_hit.QueryInterface(edm.IEdmFile7)
                        _batch_get_latest(vault5, edm, file7_obj, step_path)
                        result["retrieved"].append({
                            "filename":   os.path.basename(step_path),
                            "local_path": step_path,
                        })
                        print(f"[native get-latest] Retrieved: {os.path.basename(step_path)}")
                    except Exception as dl_err:
                        result["failed"].append({
                            "filename": os.path.basename(step_path),
                            "error":    str(dl_err),
                        })
                        print(f"[native get-latest] Download failed for {os.path.basename(step_path)}: {dl_err}")
            continue  # Skip the single-file logic below

        found_file = None
        found_path = ""
        for pattern in patterns:
            try:
                srch = vault5.CreateSearch()
                srch.Recursive = True
                srch.FileName  = pattern
                hit = srch.GetFirstResult()
                if hit:
                    found_file = hit
                    found_path = hit.Path or ""
                    print(f"[native get-latest] Found: {found_path}")
                    break
            except Exception as se:
                print(f"[native get-latest] Search '{pattern}' failed: {se}")

        filename_for_report = (
            f"{part_number} REV{revision}{ext}" if has_revision
            else f"{part_number}{ext}"
        )

        if not found_file or not found_path:
            # IEdmSearch.FileName only matches exact names — wildcards don't work.
            # Fall back to a targeted folder walk when revision is unknown.
            if not has_revision:
                walk_pattern = f"{part_number}*{ext}"
                prefix = part_number[:3]
                print(f"[native get-latest] Exact search missed; trying folder walk "
                      f"(prefix={prefix!r}, pattern={walk_pattern!r})")
                walk_result = _vault_find_by_fnmatch(vault5, prefix, walk_pattern)
                if walk_result:
                    found_file, _folder_id, found_path = walk_result
                    print(f"[native get-latest] Folder walk found: {found_path}")

        if not found_file or not found_path:
            result["failed"].append({
                "filename": filename_for_report,
                "error":    "File not found in PDM vault",
            })
            print(f"[native get-latest] Not found: {filename_for_report}")
            continue

        # Download to local PDM working folder via IEdmBatchGet.
        # IEdmVault5.GetFileFromPath and IEdmFile5.GetFileCopy both have [out]
        # interface-pointer parameters that comtypes does NOT strip from the call
        # signature, making them crash when called with just a path string.
        # IEdmBatchGet (already proven to work for assemblies) handles any file
        # type, so we use it for everything: PDF, X_T, SLDASM, SLDPRT, etc.
        try:
            file7_obj = found_file.QueryInterface(edm.IEdmFile7)
            _batch_get_latest(vault5, edm, file7_obj, found_path)

            result["retrieved"].append({
                "filename":   os.path.basename(found_path),
                "local_path": found_path,
            })
            print(f"[native get-latest] Retrieved: {os.path.basename(found_path)}")

        except Exception as dl_err:
            result["failed"].append({
                "filename": filename_for_report,
                "error":    str(dl_err),
            })
            print(f"[native get-latest] Download failed for {filename_for_report}: {dl_err}")

    result["success"] = len(result["retrieved"]) > 0
    return result


def _batch_get_latest(vault5, edm, file7, root_path: str) -> None:
    """
    Sync the full assembly tree to the local PDM cache using IEdmBatchGet.

    This is equivalent to right-clicking in PDM Explorer -> 'Get Latest Version'
    on the root assembly.  GetComputedBOM only traverses files present in the
    local cache; sub-assemblies that have never been 'gotten' locally are
    silently absent from the BOM.  This function ensures the complete tree is
    locally cached before we call GetComputedBOM.

    Mirrors the C# pattern in PdmGetLatestFiles.cs:
        IEdmBatchGet batchGet = (IEdmBatchGet)vault.CreateUtility(EdmUtil_BatchGet);
        selItems[0].mlDocID  = file.ID;
        selItems[0].mlProjID = folder.ID;
        batchGet.AddSelection(vault5, selItems);
        batchGet.CreateTree(0, 0);
        batchGet.GetFiles(0, null);
    """
    if not root_path:
        print("[native extractor]   BatchGet skipped: root_path is empty")
        return

    try:
        print("[native extractor] Syncing assembly tree to local cache (BatchGet)...")

        # ── Resolve folder that contains the root assembly ─────────────────────
        folder_path = os.path.dirname(root_path)
        folder = None
        try:
            folder = vault5.GetFolderFromPath(folder_path)
        except Exception as fe:
            print(f"[native extractor]   GetFolderFromPath failed: {fe}")
            # NOTE: GetFileFromPath has broken [out]-param comtypes bindings —
            # do NOT use it as a fallback; GetFolderFromPath is the safe path.

        if folder is None:
            print("[native extractor]   BatchGet skipped: could not resolve folder")
            return

        # ── Get EdmUtil_BatchGet enum value ────────────────────────────────────
        # Try to read it from the generated comtypes module; fall back to the
        # known numeric value (16) if the attribute name differs across versions.
        try:
            util_id = edm.EdmUtil_BatchGet
        except AttributeError:
            util_id = 16   # EdmUtil_BatchGet in SOLIDWORKS PDM API EdmUtility enum

        # ── CreateUtility lives on IEdmVault8 (not IEdmVault5) ────────────────
        # QI up to vault8; if not available fall back to vault5.
        try:
            vault_for_util = vault5.QueryInterface(edm.IEdmVault8)
        except Exception:
            vault_for_util = vault5

        # ── Create the batch-get utility and QI to IEdmBatchGet ───────────────
        batch_util = vault_for_util.CreateUtility(util_id)
        if batch_util is None:
            print("[native extractor]   BatchGet skipped: CreateUtility returned None")
            return

        try:
            ibatch = batch_util.QueryInterface(edm.IEdmBatchGet)
        except Exception as qi_err:
            print(f"[native extractor]   QI to IEdmBatchGet failed: {qi_err} — trying direct use")
            ibatch = batch_util   # some comtypes builds return the right interface directly

        # ── Build EdmSelItem struct ────────────────────────────────────────────
        try:
            sel = edm.EdmSelItem()
        except Exception:
            # EdmSelItem may be a ctypes.Structure subclass in the generated module
            import ctypes
            class EdmSelItemFallback(ctypes.Structure):
                _fields_ = [("mlDocID", ctypes.c_int), ("mlProjID", ctypes.c_int)]
            sel = EdmSelItemFallback()

        sel.mlDocID  = file7.ID
        sel.mlProjID = folder.ID

        # ── Queue selection and download ───────────────────────────────────────
        # AddSelection expects the vault coclass (EdmVault5), not just an interface.
        # vault5 (IEdmVault5) is the same underlying COM object so it works in
        # practice; if it raises we retry with a raw CreateObject.
        import comtypes.client
        try:
            ibatch.AddSelection(vault5, [sel])
        except Exception as add_err:
            print(f"[native extractor]   AddSelection(vault5) failed: {add_err} — retrying with vault coclass")
            raw_vault = comtypes.client.CreateObject("ConisioLib.EdmVault")
            raw_vault.LoginAuto("PDM", 0)
            ibatch.AddSelection(raw_vault, [sel])

        # CreateTree(flags, parentWnd): build the recursive get-tree
        ibatch.CreateTree(0, 0)
        # GetFiles(flags, parentWnd): download / refresh all files in tree
        ibatch.GetFiles(0, None)

        print("[native extractor]   BatchGet complete — all assembly references are now locally cached.")

    except Exception as e:
        print(f"[native extractor]   BatchGet failed (BOM may be incomplete): {e}")


def extract_bom_native(
    assembly_identifier: str,
    bom_layout: str = "MenteeBOM",
    configuration: str = "Default",
    search_mode: str = "name",
    include_thumbnails: bool = True,
) -> dict:
    """
    Query PDM directly via Python COM and return a dict in exactly the same
    format as the C# PdmBomExporter.exe JSON output.

    Parameters
    ----------
    assembly_identifier : str
        Part name  (e.g. "005-AS-01306")  when search_mode="name"
        Full local path                   when search_mode="path"
    bom_layout : str
        PDM BOM layout name (default "MenteeBOM")
    configuration : str
        SolidWorks configuration name (default "Default")
    search_mode : str
        "name" – search vault by part name (no local file required)
        "path" – extract part name from the given path and search
    include_thumbnails : bool
        False → skip thumbnail extraction for faster testing
    """
    # COM must be initialized on every thread (Flask runs routes in threads).
    # CoInitialize returns S_OK (0) if we initialized it, S_FALSE (1) if it
    # was already initialized on this thread.  Only call CoUninitialize() when
    # WE were the ones who initialized (hr==0), otherwise we'd decrement the
    # ref-count of an apartment we don't own — which causes COM crashes on RDP.
    hr = pythoncom.CoInitialize()
    try:
        return _extract_bom_native_impl(
            assembly_identifier=assembly_identifier,
            bom_layout=bom_layout,
            configuration=configuration,
            search_mode=search_mode,
            include_thumbnails=include_thumbnails,
        )
    finally:
        if hr == 0:   # S_OK — we owned the CoInitialize, so we uninitialize
            pythoncom.CoUninitialize()


def _extract_bom_native_impl(
    assembly_identifier: str,
    bom_layout: str,
    configuration: str,
    search_mode: str,
    include_thumbnails: bool,
) -> dict:
    """Inner implementation — called after CoInitialize."""
    import comtypes.client

    print(f"\n[native extractor] Loading EDM type library...")
    edm = comtypes.client.GetModule(EDM_DLL)

    # ── Vault connection ───────────────────────────────────────────────────────
    vault   = comtypes.client.CreateObject("ConisioLib.EdmVault")
    vault5  = vault.QueryInterface(edm.IEdmVault5)
    vault5.LoginAuto("PDM", 0)
    print(f"[native extractor] Connected to vault: {vault5.Name}")

    # ── Build variable name → DB ID map ───────────────────────────────────────
    _VAR_NAMES = ["Revision", "Description", "Material", "FINISH1", "FINISH2"]
    var_id_map = _build_var_id_map(vault5, _VAR_NAMES)

    # ── Resolve part name ──────────────────────────────────────────────────────
    if search_mode == "path":
        part_name = os.path.splitext(os.path.basename(assembly_identifier))[0]
    else:
        part_name = assembly_identifier

    # ── Search for assembly in vault ───────────────────────────────────────────
    print(f"[native extractor] Searching for: {part_name}.SLDASM")
    srch = vault5.CreateSearch()
    srch.Recursive = True
    found = None
    for ext in [".SLDASM", ".sldasm"]:
        srch.FileName = f"{part_name}{ext}"
        found = srch.GetFirstResult()
        if found:
            break

    if not found:
        raise FileNotFoundError(
            f"[native extractor] Assembly not found in vault: {part_name}.SLDASM"
        )

    root_path     = found.Path or ""
    root_filename = os.path.basename(root_path)
    print(f"[native extractor] Found: {root_path}")

    # ── Open BOM view on root assembly (column detection only) ───────────────
    file7 = found.QueryInterface(edm.IEdmFile7)

    try:
        bom = file7.GetComputedBOM(bom_layout, 0, configuration, 0)
    except Exception as e:
        bom = None

    if not bom:
        raise RuntimeError(
            f"BOM layout '{bom_layout}' not found or configuration '{configuration}' "
            f"is invalid for assembly '{part_name}'. "
            f"Check the layout name and configuration in PDM Explorer."
        )

    print(f"[native extractor] Opened BOM with layout='{bom_layout}', config='{configuration}'")

    # ── Map columns ────────────────────────────────────────────────────────────
    cols = bom.GetColumns()

    def _find_col(caption_lower=None, me_type=None):
        for c in cols:
            if me_type is not None and c.meType == me_type:
                return c
            if caption_lower and c.mbsCaption.lower() == caption_lower:
                return c
        return None

    pn_col    = _find_col(me_type=24)                  # EdmBomCol_PartNumber
    qty_col   = _find_col(me_type=25) or _find_col(me_type=11)  # RefCountNoBomQty / RefCount
    state_col = _find_col(me_type=6)                   # EdmBomCol_State

    qty_type  = qty_col.meType if qty_col else 25

    # ── Build BOM layout column map (caption → {mlColumnID, meType}) ──────────
    # This mirrors the C# exporter: iterate ALL BOM columns from the layout
    # and use their mlColumnID + meType to read values via cell.GetVar().
    # Special columns (PartNumber, Qty, State) are excluded — handled above.
    _SPECIAL_TYPES = {24, 25, 11, 6}  # PartNumber, RefCount variants, State
    bom_col_map = {}
    for c in cols:
        if c.meType not in _SPECIAL_TYPES and c.mbsCaption:
            bom_col_map[c.mbsCaption] = {"id": c.mlColumnID, "type": c.meType}
    print(f"[native extractor] BOM layout variable columns: {list(bom_col_map.keys())}")

    # ── Helper: read a variable by name from a file object ────────────────────
    def _file_var(file_obj, name: str) -> str:
        """
        Read a PDM variable value from a file object by variable name.

        The correct pattern (from C# PdmBomExtractor.cs):
          IEdmEnumeratorVariable8 enumVar = file.GetEnumeratorVariable();
          enumVar.GetVar(variableName, "@", out object value);

        GetEnumeratorVariable() is a METHOD on IEdmFile5, NOT a QueryInterface.
        That's why QI to IEdmEnumeratorVariable8 fails — it's not an interface
        the file object exposes directly via QI.
        """
        try:
            enum_var = file_obj.GetEnumeratorVariable()
            if enum_var is not None:
                # Try the actual configuration first (e.g. "Default"), then
                # "@" which is PDM's file-level / all-configs scope.
                configs_to_try = list(dict.fromkeys([configuration, "@", ""]))
                for cfg in configs_to_try:
                    try:
                        result = enum_var.GetVar(name, cfg)
                        val = result[0] if isinstance(result, tuple) else result
                        if val is not None:
                            s = str(val).strip()
                            if s:
                                return s
                    except Exception:
                        continue
        except Exception as e:
            print(f"[native extractor]   _file_var '{name}': {e}")
        return ""

    def _authoritative_revision(file_obj, cell_val: str) -> str:
        """
        PDM's revision bump writes the file-level '@' card variable; the
        configuration tab holds a SolidWorks custom property that can lag
        behind (e.g. 034-AS-01141: '@' = 02, 'Default' config = 01, which
        made every re-import record the old revision and the nightly stale
        check flag the BOM forever). Return whichever revision is
        numerically higher; non-numeric values keep the cell value.
        """
        def _num(s):
            s = (s or "").replace("REV", "").replace("rev", "").strip()
            return int(s) if s.isdigit() else None

        at_val = ""
        try:
            enum_var = file_obj.GetEnumeratorVariable()
            if enum_var is not None:
                raw = enum_var.GetVar("Revision", "@")
                v = raw[0] if isinstance(raw, tuple) else raw
                if v is not None:
                    at_val = str(v).strip()
        except Exception:
            pass

        cell_num, at_num = _num(cell_val), _num(at_val)
        if at_num is not None and (cell_num is None or at_num > cell_num):
            return at_val
        return cell_val or at_val

    def _read_bom_columns(cell, file_path: str) -> dict:
        """
        Read all variable columns from a BOM cell using the layout column map.
        Mirrors the C# exporter approach:
          1. Try cell.GetVar(mlColumnID, meType) on the BOM cell
          2. Fallback: read from the file's data card via GetEnumeratorVariable()
        For Description specifically, always prefer the file data card value since
        it is configuration-independent and authoritative. BOM cells can return a
        different (stale/configuration-specific) value for sub-assemblies that do
        not have the parent assembly's active configuration.
        Returns a dict with the column captions as keys.
        """
        result = {}
        # Fetch the file object once for all columns (avoids repeated vault lookups)
        f7 = None
        if file_path:
            try:
                f7 = _get_file7_by_path(vault5, edm, file_path)
            except Exception:
                pass

        for caption, col_info in bom_col_map.items():
            val = ""
            # Method 1: read from BOM cell using layout column ID + type
            try:
                val = _get_var(cell, col_info["id"], col_info["type"])
            except Exception:
                pass

            if caption == "Description" and f7:
                # Description: always read from the file data card with "Default"
                # config first. BOM cells can return a stale or configuration-specific
                # value when the parent assembly uses a configuration (e.g. "0 position")
                # that the sub-assembly doesn't have — in that case the BOM cell falls
                # back to the "@" scope value, which may be older than the Default config
                # custom property. "Default" is the authoritative source.
                try:
                    enum_var = f7.GetEnumeratorVariable()
                    if enum_var:
                        for cfg in ("Default", "@", configuration, ""):
                            try:
                                raw = enum_var.GetVar("Description", cfg)
                                card_val = raw[0] if isinstance(raw, tuple) else raw
                                if card_val is not None:
                                    s = str(card_val).strip()
                                    if s:
                                        val = s
                                        break
                            except Exception:
                                continue
                except Exception:
                    pass
            elif caption == "Revision" and f7:
                # Revision: the file-level '@' card value is authoritative — PDM's
                # revision bump writes there, while the configuration-specific
                # property the BOM cell reads can lag behind (see helper above).
                val = _authoritative_revision(f7, val)
            elif not val and f7:
                # Method 2: fallback to file data card for other fields when BOM cell is empty
                try:
                    val = _file_var(f7, caption)
                except Exception:
                    pass

            result[caption] = val
        return result

    # ── Build root component entry (level 0) ───────────────────────────────────
    root_thumb = _get_thumbnail_base64(root_path) if include_thumbnails else {"available": False}
    # Read root's variable columns from the file data card
    root_bom_cols = {}
    for caption in bom_col_map:
        root_bom_cols[caption] = _file_var(file7, caption)
    # Ensure the standard keys always exist (even if not in this BOM layout)
    for key in ("Description", "Revision", "Material", "FINISH1", "FINISH2"):
        if key not in root_bom_cols:
            root_bom_cols[key] = _file_var(file7, key)
    # Root Revision: prefer the file-level '@' card value (same rule as rows —
    # this is what gets recorded as BOMInstance.assembly_revision)
    root_bom_cols["Revision"] = _authoritative_revision(file7, root_bom_cols.get("Revision", ""))

    root_entry = {
        "level":             0,
        "part_number":       part_name,
        "file_name":         root_filename,
        "instance_quantity": 1,
        "state":             "",
        "configuration":     configuration,
        "bom_columns":       root_bom_cols,
        "thumbnail":         root_thumb,
        "full_path":         root_path,
    }

    # ── Sync assembly tree to local PDM cache ─────────────────────────────────
    # GetComputedBOM only traverses files that are locally cached.  Use
    # IEdmBatchGet to "Get Latest" the root assembly and ALL its references
    # before calling GetComputedBOM, so the full tree is available locally.
    _batch_get_latest(vault5, edm, file7, root_path)

    # ── Re-fetch file object after BatchGet so COM reflects updated local cache ─
    # BatchGet may have updated local files, but the original file7 COM object
    # might hold a stale view. Re-query the vault for a fresh file7 reference.
    try:
        srch2 = vault5.CreateSearch()
        srch2.Recursive = True
        srch2.FileName = f"{part_name}.SLDASM"
        found2 = srch2.GetFirstResult()
        if found2 is not None:
            file7 = found2.QueryInterface(edm.IEdmFile7)
            print(f"[native extractor]   Re-fetched file7 after BatchGet")
    except Exception as rf_err:
        print(f"[native extractor]   Re-fetch skipped: {rf_err}")

    # ── Re-open BOM after BatchGet (now sees the full local cache) ─────────────
    # Mirrors the C# approach: call GetComputedBOM ONCE on root, iterate ALL
    # rows at ALL levels in a single pass — no recursion needed.
    print(f"[native extractor] Reading full BOM tree (single-call, all rows)...")
    try:
        full_bom = file7.GetComputedBOM(bom_layout, 0, configuration, 0)
    except Exception as e:
        full_bom = None

    if not full_bom:
        raise RuntimeError(
            f"BOM layout '{bom_layout}' with configuration '{configuration}' "
            f"returned no data for '{part_name}'. "
            f"Verify the layout name and configuration name in PDM Explorer."
        )

    all_raw_rows = list(full_bom.GetRows())
    print(f"[native extractor]   GetComputedBOM returned {len(all_raw_rows)} raw rows")

    bom_components = []
    for row_unk in all_raw_rows:
        try:
            cell  = row_unk.QueryInterface(edm.IEdmBomCell)
            level = cell.GetTreeLevel()
            path  = cell.GetPathName() or ""
        except Exception:
            continue

        filename = os.path.basename(path)
        fname_up = filename.upper()

        # ── Part number ────────────────────────────────────────────────────────
        part_number = ""
        if pn_col:
            part_number = _get_var(cell, 0, pn_col.meType)
        if not part_number:
            part_number = os.path.splitext(filename)[0] if filename else ""

        # ── Instance quantity ──────────────────────────────────────────────────
        qty = 1
        try:
            raw = _get_var(cell, 0, qty_type)
            if raw:
                qty = int(float(raw))
        except Exception:
            pass

        # ── Variable columns (read from BOM layout columns) ─────────────────
        col_values = _read_bom_columns(cell, path)
        state = _get_var(cell, 0, state_col.meType) if state_col else ""

        # Ensure the standard keys always exist
        for key in ("Description", "Revision", "Material", "FINISH1", "FINISH2"):
            if key not in col_values:
                col_values[key] = ""

        # ── Thumbnail ──────────────────────────────────────────────────────────
        thumb = {"available": False}
        if include_thumbnails and path:
            thumb = _get_thumbnail_base64(path)

        bom_components.append({
            "level":             level,
            "part_number":       part_number,
            "file_name":         filename,
            "instance_quantity": qty,
            "state":             state,
            "configuration":     configuration,
            "bom_columns":       col_values,
            "thumbnail":         thumb,
            "full_path":         path,
        })

    components = [root_entry] + bom_components

    print(f"[native extractor] Done. {len(components)} components extracted "
          f"({len(components) - 1} BOM rows + 1 root).")
    return {
        "metadata": {
            "root_assembly":             part_name,
            "root_assembly_description": root_entry["bom_columns"].get("Description", ""),
            "extraction_time":           datetime.now().isoformat(),
            "configuration":             configuration,
            "bom_layout":                bom_layout,
            "total_components":          str(len(components)),
            "full_path":                 root_path,
        },
        "components": components,
    }
