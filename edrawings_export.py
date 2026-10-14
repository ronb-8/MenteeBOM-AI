"""
Export a SOLIDWORKS assembly to eDrawings WebHTML (.htm)
using the eDrawings Office Automator COM API.

Usage:
    python edrawings_export.py                          # default assembly
    python edrawings_export.py <part_number> [revision]  # specific part
"""
import os
import sys
import glob
import pythoncom
import win32com.client

# --- Configuration ---
DEFAULT_PART = "040-AS-01735"
PDM_BASE = "C:/PDM/Projects"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "3d_viewer_output")


def find_sldasm(part_number: str, revision: str = None) -> str:
    """Find a .SLDASM file in the PDM cache for the given part number."""
    patterns = [
        os.path.join(PDM_BASE, "**", f"{part_number}.SLDASM"),
        os.path.join(PDM_BASE, "**", f"{part_number}.sldasm"),
    ]
    for pattern in patterns:
        matches = glob.glob(pattern, recursive=True)
        if matches:
            return matches[0]
    return None


def export_to_webhtml(input_path: str, output_path: str) -> bool:
    """
    Export a SOLIDWORKS file to eDrawings WebHTML (.htm).

    Uses EDrawingOfficeAutomator.Document COM object — works headlessly.
    """
    if not os.path.exists(input_path):
        print(f"Error: Input file not found: {input_path}")
        return False

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    pythoncom.CoInitialize()
    try:
        print(f"Opening: {os.path.basename(input_path)}")
        doc = win32com.client.Dispatch("EDrawingOfficeAutomator.Document")
        doc.OpenDoc(input_path, False, False, False, "")

        print(f"Exporting to: {os.path.basename(output_path)}")
        doc.Save(output_path, False, "")

        # Save is async — wait for the file to appear and stabilize
        import time
        for _ in range(30):
            time.sleep(1)
            if os.path.exists(output_path) and os.path.getsize(output_path) > 1024:
                # Wait a bit more for file to finish writing
                time.sleep(2)
                size_mb = os.path.getsize(output_path) / (1024 * 1024)
                print(f"Success! {output_path} ({size_mb:.1f} MB)")
                return True

        if os.path.exists(output_path):
            size_mb = os.path.getsize(output_path) / (1024 * 1024)
            print(f"File created but may be incomplete: {size_mb:.1f} MB")
            return True
        else:
            print("Error: Output file was not created")
            return False

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    part_number = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PART
    revision = sys.argv[2] if len(sys.argv) > 2 else None

    # Find the SLDASM in PDM cache
    input_path = find_sldasm(part_number, revision)
    if not input_path:
        print(f"SLDASM not found locally for {part_number}. Pulling from PDM...")
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from pdm_native_extractor import get_latest_files_native
        result = get_latest_files_native(part_number, revision, [".SLDASM"])
        if result.get("retrieved"):
            input_path = find_sldasm(part_number, revision)

    if not input_path:
        print(f"Could not find {part_number}.SLDASM")
        sys.exit(1)

    output_path = os.path.join(OUTPUT_DIR, f"{part_number}.htm")
    success = export_to_webhtml(input_path, output_path)
    sys.exit(0 if success else 1)
