"""
Quick test: try GetFileCopy(0, 0, None) on a known PDM file path.
Run this directly: python test_getfilecopy.py
"""
import sys
import pythoncom

EDM_DLL = r"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS PDM\EdmInterface.dll"

# Use the first argument as path, or fall back to a known PDF from the logs
TEST_PATH = sys.argv[1] if len(sys.argv) > 1 else (
    r"C:\PDM\Projects\029-HappyBot V3.1\PDF and XT\029-MP-03205 REV04.pdf"
)

def test():
    import comtypes.client

    edm    = comtypes.client.GetModule(EDM_DLL)
    vault  = comtypes.client.CreateObject("ConisioLib.EdmVault")
    vault5 = vault.QueryInterface(edm.IEdmVault5)
    vault5.LoginAuto("PDM", 0)
    print(f"Connected to vault: {vault5.Name}")

    print(f"Looking up: {TEST_PATH}")
    file5_obj, folder_obj = vault5.GetFileFromPath(TEST_PATH)

    if file5_obj is None or folder_obj is None:
        print("ERROR: GetFileFromPath returned None — file not in vault")
        return

    print(f"  File ID   : {file5_obj.ID}")
    print(f"  Folder ID : {folder_obj.ID}")
    print(f"  Folder path: {folder_obj.LocalPath}")

    print("Calling GetFileCopy(0, 0, None)...")
    try:
        file5_obj.GetFileCopy(0, 0, None)
        print("SUCCESS — GetFileCopy completed without error")
    except Exception as e:
        print(f"FAILED — {e}")

        # Try alternative: pass folder object directly
        print("Trying GetFileCopy(0, 0, folder_obj)...")
        try:
            file5_obj.GetFileCopy(0, 0, folder_obj)
            print("SUCCESS with folder_obj")
        except Exception as e2:
            print(f"FAILED — {e2}")

        # Try with folder ID as ctypes c_int
        import ctypes
        print("Trying GetFileCopy(0, folder_obj.ID, None) — maybe arg order differs...")
        try:
            file5_obj.GetFileCopy(folder_obj.ID, 0, None)
            print("SUCCESS with folder_id in arg0")
        except Exception as e3:
            print(f"FAILED — {e3}")

        # Try with just 2 args
        print("Trying GetFileCopy(0, 0) — maybe 2 args only...")
        try:
            file5_obj.GetFileCopy(0, 0)
            print("SUCCESS with 2 args")
        except Exception as e4:
            print(f"FAILED — {e4}")


pythoncom.CoInitialize()
try:
    test()
finally:
    pythoncom.CoUninitialize()
