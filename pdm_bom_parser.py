#!/usr/bin/env python3
"""
PDM BOM Parser for MenteeBOM Web Application
Uses the updated PdmBomExporter with part name search functionality
"""

import subprocess
import json
import re
import os
import tempfile
import threading
import uuid
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    print("Warning: psutil not available. Child process cleanup will be limited.")
from typing import Dict, List, Optional
from datetime import datetime
from pdm_config import pdm_config

class ProcessCancelledError(Exception):
    """Exception raised when a BOM extraction process is cancelled by the user."""
    pass

class PdmBomParser:
    """Parser for PdmBomExporter console output with part name search support."""
    
    # Class-level dictionary to track active processes
    _active_processes = {}
    _process_lock = threading.RLock()
    
    def __init__(self, exporter_path=None):
        if exporter_path:
            self.exe_path = exporter_path
        else:
            # Default path to the updated PdmBomExporter
            self.exe_path = r"C:\Users\mechanical\Documents\MenteeBom software\PdmBomExporter\bin\Debug\PdmBomExporter.exe"
    
    @staticmethod
    def check_file_availability(parts_list: List[tuple], pdm_base_dir: str = "C:/PDM/Projects/") -> Dict[tuple, Dict[str, bool]]:
        """
        Scan PDM directory for file availability (PDF, AI PDF, STEP, XT) per part.

        Args:
            parts_list: List of (part_number, revision, part_type) tuples
            pdm_base_dir: Base PDM directory to scan

        Returns:
            Dict keyed by (part_number, revision) with boolean flags:
            {has_pdf, has_ai_pdf, has_step, has_xt}
        """
        import glob as glob_module

        results = {}

        if not os.path.exists(pdm_base_dir):
            print(f"Warning: PDM directory not found: {pdm_base_dir}")
            for pn, rev, pt in parts_list:
                results[(pn, rev)] = {'has_pdf': False, 'has_ai_pdf': False, 'has_step': False, 'has_xt': False}
            return results

        for part_number, revision, part_type in parts_list:
            flags = {'has_pdf': False, 'has_ai_pdf': False, 'has_step': False, 'has_xt': False}

            # Normalize revision to zero-padded format (e.g., "2" -> "02", "REV02" -> "02")
            rev_clean = revision.replace('REV', '').replace('rev', '').strip().upper()
            rev_num = rev_clean.lstrip('0') or '0'
            try:
                rev_formatted = f"{int(rev_num):02d}"
            except ValueError:
                rev_formatted = rev_clean

            # --- PDF drawing ---
            pdf_patterns = [
                os.path.join(pdm_base_dir, "**", f"{part_number} REV{rev_formatted}.pdf"),
                os.path.join(pdm_base_dir, "**", f"{part_number} REV{rev_formatted}.PDF"),
                os.path.join(pdm_base_dir, "**", f"{part_number}_REV{rev_formatted}.pdf"),
            ]
            for pattern in pdf_patterns:
                if glob_module.glob(pattern, recursive=True):
                    flags['has_pdf'] = True
                    break

            # --- AI PDF (assembly instructions) - only for assemblies ---
            is_assembly = (part_type and part_type.lower() == 'assembly') or ('-AS-' in part_number.upper())
            if is_assembly:
                ai_patterns = [
                    os.path.join(pdm_base_dir, "**", f"{part_number}-AI REV*.pdf"),
                    os.path.join(pdm_base_dir, "**", f"{part_number}-AI REV*.PDF"),
                    os.path.join(pdm_base_dir, "**", f"{part_number} AI REV*.pdf"),
                    os.path.join(pdm_base_dir, "**", f"{part_number} AI REV*.PDF"),
                ]
                for pattern in ai_patterns:
                    if glob_module.glob(pattern, recursive=True):
                        flags['has_ai_pdf'] = True
                        break

            # --- STEP files - only for 3D Printing parts ---
            # Pattern: XXX-MP-XXXXX_REVXX*.step (wildcard to catch suffixes like _0, -L, -R)
            is_3d_printing = part_type and '3d' in part_type.lower()
            if is_3d_printing:
                step_patterns = [
                    os.path.join(pdm_base_dir, "**", f"{part_number}_REV{rev_formatted}*.step"),
                    os.path.join(pdm_base_dir, "**", f"{part_number}_REV{rev_formatted}*.STEP"),
                ]
                step_matches = []
                for pattern in step_patterns:
                    for match in glob_module.glob(pattern, recursive=True):
                        basename = os.path.basename(match)
                        if basename not in step_matches:
                            step_matches.append(basename)
                flags['has_step'] = len(step_matches) > 0
                flags['step_files'] = step_matches

            # --- XT file ---
            xt_patterns = [
                os.path.join(pdm_base_dir, "**", f"{part_number} REV{rev_formatted}.x_t"),
                os.path.join(pdm_base_dir, "**", f"{part_number} REV{rev_formatted}.X_T"),
            ]
            for pattern in xt_patterns:
                if glob_module.glob(pattern, recursive=True):
                    flags['has_xt'] = True
                    break

            results[(part_number, revision)] = flags

        return results

    def _extract_part_number_from_path(self, assembly_path: str) -> Optional[str]:
        """
        Extract part number from PDM assembly path (no revision in filename).
        
        Args:
            assembly_path: Full path to assembly file (e.g., "C:\\PDM\\Projects\\...\\029-AS-01344.sldasm")
            
        Returns:
            Part number string (e.g., "029-AS-01344") or None if extraction fails
        """
        try:
            # Get filename without extension
            filename = os.path.basename(assembly_path)
            # Remove extension (.sldasm or .SLDASM)
            if filename.lower().endswith('.sldasm'):
                part_number = filename[:-7]  # Remove .sldasm (7 chars)
            else:
                # Try to find extension and remove it
                name_without_ext = os.path.splitext(filename)[0]
                part_number = name_without_ext
            
            # Validate that we got something reasonable
            if part_number and len(part_number) > 0:
                return part_number
            return None
        except Exception as e:
            print(f"Warning: Could not extract part number from path '{assembly_path}': {e}")
            return None
    
    def _ensure_latest_file_by_part_and_revision(self, part_number: str, revision: str, extensions: List[str]) -> bool:
        """
        Ensure the latest version of files (PDF/X_T) are available locally from PDM.
        
        Args:
            part_number: Part number (e.g., "029-MP-03299")
            revision: Revision (e.g., "03")
            extensions: List of extensions to retrieve (e.g., [".pdf", ".x_t"])
            
        Returns:
            True if successful, False otherwise (graceful degradation)
        """
        try:
            if not part_number or not revision:
                print(f"Warning: Part number or revision is empty")
                return False

            print(f"Ensuring latest version of files for {part_number} REV{revision}: {extensions}")

            # ── Native Python path ────────────────────────────────────────────
            if pdm_config.is_native_extractor_enabled():
                try:
                    from pdm_native_extractor import get_latest_files_native
                    res = get_latest_files_native(part_number, revision, extensions)
                    if res["success"]:
                        print(f"[native] Retrieved {len(res['retrieved'])} file(s) for {part_number} REV{revision}")
                        return True
                    print(f"[native] No files retrieved for {part_number} REV{revision}: {res.get('error','')}")
                    return False
                except Exception as ne:
                    print(f"[native] get_latest_files_native failed, falling back to C#: {ne}")
                    # fall through to C# below

            # ── C# subprocess path (fallback / prod without native flag) ──────
            # Create file request for PDF/X_T files (with revision)
            file_request = {
                "part_number": part_number,
                "revision": revision,  # PDF/X_T files have revision in filename
                "extensions": extensions
            }

            input_data = {
                "vault": "PDM",
                "files": [file_request]
            }

            # Create temporary JSON file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(input_data, f, indent=2)
                temp_json_path = f.name

            # Determine path to executable
            exe_dir = os.path.dirname(self.exe_path)
            get_latest_exe = os.path.join(exe_dir, "PdmBomExporter.exe")

            if not os.path.exists(get_latest_exe):
                get_latest_exe = os.path.join(exe_dir, "PdmGetLatestFiles.exe")

            if not os.path.exists(get_latest_exe):
                print(f"Warning: PdmBomExporter.exe or PdmGetLatestFiles.exe not found at: {exe_dir}")
                try:
                    os.unlink(temp_json_path)
                except:
                    pass
                return False

            print(f"Calling get latest files: {get_latest_exe}")

            # Call executable with getlatest command
            if os.path.basename(get_latest_exe).lower() == "pdmbomexporter.exe":
                cmd = [get_latest_exe, "getlatest", temp_json_path]
            else:
                cmd = [get_latest_exe, temp_json_path]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            # Clean up temp file
            try:
                os.unlink(temp_json_path)
            except:
                pass

            # Parse JSON output regardless of exit code
            try:
                stdout_lines = result.stdout.split('\n')
                json_start = -1
                json_end = -1

                for i, line in enumerate(stdout_lines):
                    if '{' in line:
                        json_start = i
                        break

                for i in range(len(stdout_lines) - 1, -1, -1):
                    if '}' in stdout_lines[i]:
                        json_end = i
                        break

                if json_start >= 0 and json_end >= json_start:
                    json_lines = stdout_lines[json_start:json_end + 1]
                    json_text = '\n'.join(json_lines)
                    output_data = json.loads(json_text)
                else:
                    output_data = json.loads(result.stdout)

                retrieved = output_data.get('retrieved', [])
                total_retrieved = 0
                for item in retrieved:
                    if isinstance(item, dict):
                        total_retrieved += len(item.get('retrieved_files', []))

                if total_retrieved > 0:
                    print(f"Successfully retrieved latest version: {part_number} REV{revision} ({total_retrieved} file(s))")
                    return True
                else:
                    print(f"Warning: No files retrieved for {part_number} REV{revision}, but continuing...")
                    return False

            except json.JSONDecodeError:
                print(f"Warning: Invalid JSON output from get latest files: {result.stdout[:200]}")
                return False

        except subprocess.TimeoutExpired:
            print(f"Warning: Get latest files timed out for {part_number} REV{revision}")
            return False
        except Exception as e:
            print(f"Warning: Error ensuring latest files: {e}")
            return False

    def _ensure_latest_ai_file_by_part_and_revision(self, part_number: str, revision: str) -> bool:
        """
        Ensure the latest version of AI files (PDF) are available locally from PDM.
        AI files follow the pattern: {part_number} AI REV{revision}.pdf
        
        Args:
            part_number: Part number (e.g., "026-AS-01001")
            revision: Revision (e.g., "02")
            
        Returns:
            True if successful, False otherwise (graceful degradation)
        """
        try:
            if not part_number or not revision:
                print(f"Warning: Part number or revision is empty for AI file")
                return False
            
            print(f"Ensuring latest version of AI file for {part_number}-AI REV{revision}")

            # ── Native Python path ────────────────────────────────────────────
            if pdm_config.is_native_extractor_enabled():
                try:
                    from pdm_native_extractor import get_latest_files_native
                    # AI files follow "{part_number}-AI REV{revision}.pdf" pattern
                    # Pass part_number as "{part_number}-AI" so the search pattern matches
                    res = get_latest_files_native(f"{part_number}-AI", revision, [".pdf"])
                    if res["success"]:
                        print(f"[native] Retrieved AI file for {part_number}-AI REV{revision}")
                        return True
                    print(f"[native] No AI file retrieved for {part_number}-AI REV{revision}")
                    return False
                except Exception as ne:
                    print(f"[native] get_latest_files_native (AI) failed, falling back to C#: {ne}")

            # ── C# subprocess path ────────────────────────────────────────────
            # For AI files, we need: {part_number}-AI REV{revision}.pdf
            # So we set PartNumber to "{part_number}-AI" to get the correct pattern
            file_request = {
                "part_number": f"{part_number}-AI",  # Add "-AI" to part_number so pattern becomes "{part_number}-AI REV{revision}.pdf"
                "revision": revision,
                "extensions": [".pdf"]
            }
            
            input_data = {
                "vault": "PDM",
                "files": [file_request]
            }
            
            # Create temporary JSON file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(input_data, f, indent=2)
                temp_json_path = f.name
            
            # Determine path to executable
            exe_dir = os.path.dirname(self.exe_path)
            get_latest_exe = os.path.join(exe_dir, "PdmBomExporter.exe")
            
            if not os.path.exists(get_latest_exe):
                get_latest_exe = os.path.join(exe_dir, "PdmGetLatestFiles.exe")
            
            if not os.path.exists(get_latest_exe):
                print(f"Warning: PdmBomExporter.exe or PdmGetLatestFiles.exe not found at: {exe_dir}")
                try:
                    os.unlink(temp_json_path)
                except:
                    pass
                return False
            
            print(f"Calling get latest AI files: {get_latest_exe}")
            
            # Call executable with getlatest command
            if os.path.basename(get_latest_exe).lower() == "pdmbomexporter.exe":
                cmd = [get_latest_exe, "getlatest", temp_json_path]
            else:
                cmd = [get_latest_exe, temp_json_path]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            # Clean up temp file
            try:
                os.unlink(temp_json_path)
            except:
                pass
            
            # Parse JSON output regardless of exit code
            try:
                stdout_lines = result.stdout.split('\n')
                json_start = -1
                json_end = -1
                
                for i, line in enumerate(stdout_lines):
                    if '{' in line:
                        json_start = i
                        break
                
                for i in range(len(stdout_lines) - 1, -1, -1):
                    if '}' in stdout_lines[i]:
                        json_end = i
                        break
                
                if json_start >= 0 and json_end >= json_start:
                    json_lines = stdout_lines[json_start:json_end + 1]
                    json_text = '\n'.join(json_lines)
                    output_data = json.loads(json_text)
                else:
                    output_data = json.loads(result.stdout)
                
                retrieved = output_data.get('retrieved', [])
                total_retrieved = 0
                for item in retrieved:
                    if isinstance(item, dict):
                        total_retrieved += len(item.get('retrieved_files', []))
                
                if total_retrieved > 0:
                    print(f"Successfully retrieved latest AI file: {part_number} AI REV{revision} ({total_retrieved} file(s))")
                    return True
                else:
                    print(f"Warning: No AI files retrieved for {part_number} AI REV{revision}, but continuing...")
                    return False
                    
            except json.JSONDecodeError:
                print(f"Warning: Invalid JSON output from get latest AI files: {result.stdout[:200]}")
                return False
                
        except subprocess.TimeoutExpired:
            print(f"Warning: Get latest AI files timed out for {part_number} AI REV{revision}")
            return False
        except Exception as e:
            print(f"Warning: Error ensuring latest AI files: {e}")
            return False
    
    def _search_ai_files_by_part_name(self, part_number: str) -> List[str]:
        """
        Search PDM for all AI files matching a part number pattern in one call.
        This is much faster than checking revisions sequentially.
        
        The method uses PDM API to search for files matching {part_number}*AI*.pdf pattern.
        Since the C# code searches with wildcards when revision is empty, we pass
        part_number as "{part_number} AI" with empty revision to trigger wildcard search.
        
        Args:
            part_number: Part number (e.g., "026-AS-01001")
            
        Returns:
            List of file paths found in PDM that match the pattern {part_number}*AI*.pdf
        """
        try:
            if not part_number:
                print(f"Warning: Part number is empty for AI file search")
                return []
            
            print(f"Searching PDM for all AI files matching pattern: {part_number}*AI*.pdf")

            # Create file request for searching
            # By setting part_number to "{part_number}-AI" and revision to empty,
            # the C# code will search for patterns like "{part_number}-AI*.pdf" which matches
            # files like "{part_number}-AI REV01.pdf", "{part_number}-AI REV02.pdf", etc.
            file_request = {
                "part_number": f"{part_number}-AI",  # This will make C# search for "{part_number}-AI*.pdf"
                "revision": "",  # Empty revision triggers wildcard search in C# code
                "extensions": [".pdf"]
            }
            
            input_data = {
                "vault": "PDM",
                "files": [file_request]
            }
            
            # Create temporary JSON file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(input_data, f, indent=2)
                temp_json_path = f.name
            
            # Determine path to executable
            exe_dir = os.path.dirname(self.exe_path)
            get_latest_exe = os.path.join(exe_dir, "PdmBomExporter.exe")
            
            if not os.path.exists(get_latest_exe):
                get_latest_exe = os.path.join(exe_dir, "PdmGetLatestFiles.exe")
            
            if not os.path.exists(get_latest_exe):
                print(f"Warning: PdmBomExporter.exe or PdmGetLatestFiles.exe not found at: {exe_dir}")
                try:
                    os.unlink(temp_json_path)
                except:
                    pass
                return []
            
            print(f"Calling PDM search for AI files: {get_latest_exe}")
            
            # Call executable with getlatest command
            if os.path.basename(get_latest_exe).lower() == "pdmbomexporter.exe":
                cmd = [get_latest_exe, "getlatest", temp_json_path]
            else:
                cmd = [get_latest_exe, temp_json_path]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60  # Shorter timeout since we're just searching
            )
            
            # Clean up temp file
            try:
                os.unlink(temp_json_path)
            except:
                pass
            
            # Parse JSON output to get found files
            found_files = []
            try:
                stdout_lines = result.stdout.split('\n')
                json_start = -1
                json_end = -1
                
                for i, line in enumerate(stdout_lines):
                    if '{' in line:
                        json_start = i
                        break
                
                for i in range(len(stdout_lines) - 1, -1, -1):
                    if '}' in stdout_lines[i]:
                        json_end = i
                        break
                
                if json_start >= 0 and json_end >= json_start:
                    json_lines = stdout_lines[json_start:json_end + 1]
                    json_text = '\n'.join(json_lines)
                    output_data = json.loads(json_text)
                else:
                    output_data = json.loads(result.stdout)
                
                # Extract file paths from the output
                # The output structure has 'retrieved' array with file results
                retrieved = output_data.get('retrieved', [])
                for item in retrieved:
                    if isinstance(item, dict):
                        retrieved_files = item.get('retrieved_files', [])
                        for file_info in retrieved_files:
                            if isinstance(file_info, dict):
                                local_path = file_info.get('local_path')
                                if local_path and os.path.exists(local_path):
                                    found_files.append(local_path)
                            elif isinstance(file_info, str):
                                # Sometimes it's just a path string
                                if os.path.exists(file_info):
                                    found_files.append(file_info)
                
                if found_files:
                    print(f"Found {len(found_files)} AI files in PDM for {part_number}")
                else:
                    print(f"No AI files found in PDM for {part_number}")
                    
            except json.JSONDecodeError:
                print(f"Warning: Invalid JSON output from PDM search: {result.stdout[:200]}")
                # Fallback to local search
                return self._search_local_ai_files(part_number)
            except Exception as e:
                print(f"Warning: Error parsing PDM search results: {e}")
                # Fallback to local search
                return self._search_local_ai_files(part_number)
            
            return found_files
                
        except subprocess.TimeoutExpired:
            print(f"Warning: PDM search for AI files timed out for {part_number}")
            # Fallback to local search
            return self._search_local_ai_files(part_number)
        except Exception as e:
            print(f"Warning: Error searching PDM for AI files: {e}")
            # Fallback to local search
            return self._search_local_ai_files(part_number)
    
    def _search_local_ai_files(self, part_number: str) -> List[str]:
        """
        Fallback method to search local PDM directory for AI files.
        
        Args:
            part_number: Part number to search for
            
        Returns:
            List of file paths found locally
        """
        import glob
        found_files = []
        pdm_base_dir = "C:/PDM/Projects/"
        
        if not os.path.exists(pdm_base_dir):
            return []
        
        # Search patterns
        search_patterns = [
            f"{part_number}*AI*.pdf",
            f"{part_number}*AI*.PDF",
        ]
        
        for pattern in search_patterns:
            search_path = os.path.join(pdm_base_dir, "**", pattern)
            matches = glob.glob(search_path, recursive=True)
            found_files.extend(matches)
        
        return list(set(found_files))  # Remove duplicates
    
    def _ensure_latest_assembly_file_by_part_name(self, part_name: str) -> bool:
        """
        Ensure the latest version of the assembly file is available locally from PDM using part name.
        
        Args:
            part_name: Part name/part number (e.g., "029-AS-00819")
            
        Returns:
            True if successful, False otherwise (graceful degradation - will still attempt import)
        """
        try:
            if not part_name:
                print(f"Warning: Part name is empty")
                return False
            
            print(f"Ensuring latest version of assembly file by part name: {part_name}")

            # ── Native Python path ────────────────────────────────────────────
            if pdm_config.is_native_extractor_enabled():
                try:
                    from pdm_native_extractor import get_latest_files_native
                    # Assembly files: no revision in filename, use BatchGet internally
                    res = get_latest_files_native(part_name, None, [".sldasm"])
                    if res["success"]:
                        print(f"[native] Retrieved assembly and all references for {part_name}")
                        return True
                    print(f"[native] No assembly retrieved for {part_name}: {res.get('error','')}")
                    return False
                except Exception as ne:
                    print(f"[native] get_latest_files_native (assembly) failed, falling back to C#: {ne}")

            # ── C# subprocess path ────────────────────────────────────────────
            # Create file request for assembly file (no revision needed)
            file_request = {
                "part_number": part_name,
                "revision": None,  # Assembly files don't have revision in filename
                "extensions": [".sldasm"]
            }
            
            input_data = {
                "vault": "PDM",
                "files": [file_request]
            }
            
            # Create temporary JSON file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(input_data, f, indent=2)
                temp_json_path = f.name
            
            # Determine path to executable (use PdmBomExporter.exe with getlatest command)
            exe_dir = os.path.dirname(self.exe_path)
            # Try PdmBomExporter.exe first (supports getlatest command)
            get_latest_exe = os.path.join(exe_dir, "PdmBomExporter.exe")
            
            # If PdmBomExporter.exe doesn't exist, try PdmGetLatestFiles.exe
            if not os.path.exists(get_latest_exe):
                get_latest_exe = os.path.join(exe_dir, "PdmGetLatestFiles.exe")
            
            if not os.path.exists(get_latest_exe):
                print(f"Warning: PdmBomExporter.exe or PdmGetLatestFiles.exe not found at: {exe_dir}")
                try:
                    os.unlink(temp_json_path)
                except:
                    pass
                return False
            
            print(f"Calling get latest files: {get_latest_exe}")
            
            # Call executable with getlatest command
            # PdmBomExporter.exe getlatest <json_file> OR PdmGetLatestFiles.exe <json_file>
            if os.path.basename(get_latest_exe).lower() == "pdmbomexporter.exe":
                cmd = [get_latest_exe, "getlatest", temp_json_path]
            else:
                cmd = [get_latest_exe, temp_json_path]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            # Clean up temp file
            try:
                os.unlink(temp_json_path)
            except:
                pass
            
            # Parse JSON output regardless of exit code (C# outputs JSON even on failure)
            # Exit codes: 0 = success, 1 = partial success, 2 = complete failure
            # Note: C# code outputs console messages AND JSON, so we need to extract JSON part
            try:
                # Extract JSON from stdout (JSON starts with '{' and ends with '}')
                stdout_lines = result.stdout.split('\n')
                json_start = -1
                json_end = -1
                
                # Find where JSON starts (first line with '{')
                for i, line in enumerate(stdout_lines):
                    if '{' in line:
                        json_start = i
                        break
                
                # Find where JSON ends (last line with '}')
                for i in range(len(stdout_lines) - 1, -1, -1):
                    if '}' in stdout_lines[i]:
                        json_end = i
                        break
                
                if json_start >= 0 and json_end >= json_start:
                    # Extract JSON portion
                    json_lines = stdout_lines[json_start:json_end + 1]
                    json_text = '\n'.join(json_lines)
                    output_data = json.loads(json_text)
                else:
                    # Fallback: try to parse entire stdout as JSON
                    output_data = json.loads(result.stdout)
                
                # Check retrieved files
                retrieved = output_data.get('retrieved', [])
                failed = output_data.get('failed', [])
                
                # Count total retrieved files across all file requests
                total_retrieved = 0
                for item in retrieved:
                    if isinstance(item, dict):
                        total_retrieved += len(item.get('retrieved_files', []))
                
                if total_retrieved > 0:
                    print(f"Successfully retrieved latest version of assembly file: {part_name} ({total_retrieved} file(s))")
                    return True
                else:
                    # Log detailed error information
                    error_msg = output_data.get('error', 'Unknown error')
                    print(f"Warning: No files retrieved for {part_name}")
                    if error_msg and error_msg != 'Unknown error':
                        print(f"  Error: {error_msg}")
                    if failed:
                        for fail_item in failed:
                            if isinstance(fail_item, dict):
                                fail_msg = fail_item.get('message', '')
                                fail_error = fail_item.get('error', '')
                                if fail_msg:
                                    print(f"  Failed: {fail_msg}")
                                if fail_error:
                                    print(f"  Error details: {fail_error}")
                                # Check failed files for more details
                                failed_files = fail_item.get('failed_files', [])
                                for failed_file in failed_files:
                                    if isinstance(failed_file, dict):
                                        file_error = failed_file.get('error', '')
                                        file_name = failed_file.get('file_name', '')
                                        if file_error:
                                            print(f"    File {file_name}: {file_error}")
                    print(f"  Continuing with import anyway...")
                    return False
                    
            except json.JSONDecodeError:
                # If JSON parsing fails, check stderr for error message
                error_output = result.stderr if result.stderr else result.stdout
                print(f"Warning: Invalid JSON output from get latest files")
                print(f"  Exit code: {result.returncode}")
                print(f"  Output: {error_output[:500]}")  # First 500 chars
                return False
                
        except subprocess.TimeoutExpired:
            print(f"Warning: Get latest files timed out for part name: {part_name}")
            return False
        except Exception as e:
            print(f"Warning: Error ensuring latest assembly file by part name: {e}")
            return False
    
    def _ensure_latest_assembly_file(self, assembly_path: str) -> bool:
        """
        Ensure the latest version of the assembly file is available locally from PDM.
        
        Args:
            assembly_path: Full path to assembly file
            
        Returns:
            True if successful, False otherwise (graceful degradation - will still attempt import)
        """
        try:
            # Extract part number from path
            part_number = self._extract_part_number_from_path(assembly_path)
            if not part_number:
                print(f"Warning: Could not extract part number from assembly path: {assembly_path}")
                return False
            
            # Use the part name method
            return self._ensure_latest_assembly_file_by_part_name(part_number)
                
        except Exception as e:
            print(f"Warning: Error ensuring latest assembly file: {e}")
            return False
    
    def _ensure_latest_component_file_by_part_name(self, part_number: str) -> bool:
        """
        Ensure the latest version of a component file (assembly or part) is available locally from PDM.
        This gets the latest revision of the component.
        
        Args:
            part_number: Part number (e.g., "029-AS-01344" or "029-MP-03299")
            
        Returns:
            True if successful, False otherwise (graceful degradation)
        """
        try:
            if not part_number:
                print(f"Warning: Part number is empty")
                return False
            
            print(f"Ensuring latest version of component file: {part_number}")

            # ── Native Python path ────────────────────────────────────────────
            if pdm_config.is_native_extractor_enabled():
                try:
                    from pdm_native_extractor import get_latest_files_native
                    res = get_latest_files_native(part_number, None, [".sldasm", ".sldprt"])
                    if res["success"]:
                        print(f"[native] Retrieved component file for {part_number}")
                        return True
                    print(f"[native] No component file retrieved for {part_number}")
                    return False
                except Exception as ne:
                    print(f"[native] get_latest_files_native (component) failed, falling back to C#: {ne}")

            # ── C# subprocess path ────────────────────────────────────────────
            # Create file request for SolidWorks files (.sldasm or .sldprt)
            # Try both extensions to cover assemblies and parts
            file_request = {
                "part_number": part_number,
                "revision": None,  # Get latest revision
                "extensions": [".sldasm", ".sldprt"]
            }
            
            input_data = {
                "vault": "PDM",
                "files": [file_request]
            }
            
            # Create temporary JSON file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(input_data, f, indent=2)
                temp_json_path = f.name
            
            # Determine path to executable
            exe_dir = os.path.dirname(self.exe_path)
            get_latest_exe = os.path.join(exe_dir, "PdmBomExporter.exe")
            
            if not os.path.exists(get_latest_exe):
                get_latest_exe = os.path.join(exe_dir, "PdmGetLatestFiles.exe")
            
            if not os.path.exists(get_latest_exe):
                print(f"Warning: PdmBomExporter.exe or PdmGetLatestFiles.exe not found at: {exe_dir}")
                try:
                    os.unlink(temp_json_path)
                except:
                    pass
                return False
            
            print(f"Calling get latest component files: {get_latest_exe}")
            
            # Call executable with getlatest command
            if os.path.basename(get_latest_exe).lower() == "pdmbomexporter.exe":
                cmd = [get_latest_exe, "getlatest", temp_json_path]
            else:
                cmd = [get_latest_exe, temp_json_path]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            # Clean up temp file
            try:
                os.unlink(temp_json_path)
            except:
                pass
            
            # Parse JSON output
            try:
                stdout_lines = result.stdout.split('\n')
                json_start = -1
                json_end = -1
                
                for i, line in enumerate(stdout_lines):
                    if '{' in line:
                        json_start = i
                        break
                
                for i in range(len(stdout_lines) - 1, -1, -1):
                    if '}' in stdout_lines[i]:
                        json_end = i
                        break
                
                if json_start >= 0 and json_end >= json_start:
                    json_lines = stdout_lines[json_start:json_end + 1]
                    json_text = '\n'.join(json_lines)
                    output_data = json.loads(json_text)
                else:
                    output_data = json.loads(result.stdout)
                
                retrieved = output_data.get('retrieved', [])
                total_retrieved = 0
                for item in retrieved:
                    if isinstance(item, dict):
                        total_retrieved += len(item.get('retrieved_files', []))
                
                if total_retrieved > 0:
                    print(f"✓ Successfully retrieved latest version of component: {part_number} ({total_retrieved} file(s))")
                    return True
                else:
                    print(f"⚠ Warning: No files retrieved for component {part_number}, but continuing...")
                    return False
                    
            except json.JSONDecodeError:
                print(f"Warning: Invalid JSON output from get latest component files: {result.stdout[:200]}")
                return False
                
        except subprocess.TimeoutExpired:
            print(f"Warning: Get latest component files timed out for {part_number}")
            return False
        except Exception as e:
            print(f"Warning: Error ensuring latest component file: {e}")
            return False
    
    def _ensure_latest_versions_for_children(self, bom_data: Dict) -> Dict[str, bool]:
        """
        Ensure the latest versions of all child components are available locally from PDM.
        
        This method extracts all unique child components from the BOM data and ensures
        their latest versions are retrieved from PDM. It returns a dictionary tracking
        which components were successfully updated.
        
        Args:
            bom_data: Parsed BOM data from initial extraction (must have 'components' list)
            
        Returns:
            Dictionary mapping part_number -> success status (True/False)
        """
        results = {}
        
        if not bom_data or 'components' not in bom_data:
            print("Warning: No BOM data or components found for getting latest versions")
            return results
        
        components = bom_data.get('components', [])
        if not components:
            print("Warning: BOM has no components")
            return results
        
        # Extract unique child components (skip root assembly at level 0)
        unique_components = {}
        for component in components:
            level = component.get('level', 0)
            if level == 0:
                continue  # Skip root assembly
            
            part_number = component.get('part_number', '')
            if not part_number:
                continue
            
            # Use part_number as key to avoid duplicates
            if part_number not in unique_components:
                unique_components[part_number] = component
        
        total_children = len(unique_components)
        if total_children == 0:
            print("No child components found in BOM")
            return results
        
        print(f"\n{'='*60}")
        print(f"Ensuring latest versions for {total_children} child component(s)...")
        print(f"{'='*60}")
        
        # Get latest versions for each unique child component
        success_count = 0
        failed_count = 0
        
        for idx, (part_number, component) in enumerate(unique_components.items(), 1):
            print(f"[{idx}/{total_children}] Getting latest version for: {part_number}")
            
            # Get latest version of the component file
            success = self._ensure_latest_component_file_by_part_name(part_number)
            results[part_number] = success
            
            if success:
                success_count += 1
            else:
                failed_count += 1
        
        print(f"\n{'='*60}")
        print(f"Latest version retrieval complete:")
        print(f"  ✓ Successfully retrieved: {success_count}/{total_children}")
        if failed_count > 0:
            print(f"  ⚠ Failed to retrieve: {failed_count}/{total_children}")
        print(f"{'='*60}\n")
        
        return results
    
    def extract_bom_data(self, assembly_identifier: str, bom_layout: str = "MenteeBOM",
                        configuration: str = "Default", output_mode: str = "console",
                        search_mode: str = "path", ensure_children_latest: bool = True) -> Dict:
        """
        Extract BOM data using the updated C# executable with part name search support.
        
        This method ensures the latest version of the assembly and all child components
        are retrieved from PDM before final extraction.

        Args:
            assembly_identifier: Path to the SolidWorks assembly file OR part name
            bom_layout: Name of the BOM layout
            configuration: Configuration name
            output_mode: "console", "json", or "both"
            search_mode: "path" (default) or "name" (search by part name)
            ensure_children_latest: If True, ensures latest versions for all children (default: True)

        Returns:
            Dictionary containing parsed BOM data
        """
        # Ensure latest version of assembly file BEFORE extraction (for both path and name-based imports)
        # The C# PdmGetLatestFiles.exe now uses IEdmBatchGet for assembly files, which automatically
        # gets the latest versions of all referenced child components, so we only need one extraction
        # Native extractor queries the vault directly — no local file sync needed.
        # Only the C# subprocess path requires ensuring local files are at latest.
        if pdm_config.is_native_extractor_enabled():
            print(f"\n{'='*60}")
            print(f"Native extractor enabled — querying PDM vault directly (no local sync needed)...")
            print(f"{'='*60}")
        else:
            print(f"\n{'='*60}")
            print(f"Ensuring latest version of assembly file (with all child references)...")
            print(f"{'='*60}")
            if search_mode == "path":
                self._ensure_latest_assembly_file(assembly_identifier)
            elif search_mode == "name":
                # For name-based imports, use the part name directly
                # The C# code now uses EdmGet_RefsVerLatest flag to get all child components
                self._ensure_latest_assembly_file_by_part_name(assembly_identifier)

        # Now do a single BOM extraction - all components should already be at latest versions
        print(f"\n{'='*60}")
        print(f"Extracting BOM (all components should be at latest versions)...")
        print(f"{'='*60}")
        return self._extract_bom_data_internal(
            assembly_identifier, bom_layout, configuration, output_mode, search_mode
        )
    
    def _extract_bom_data_internal(self, assembly_identifier: str, bom_layout: str = "MenteeBOM",
                                   configuration: str = "Default", output_mode: str = "console",
                                   search_mode: str = "path") -> Dict:
        """
        Internal method to perform the actual BOM extraction.
        This is separated from extract_bom_data to allow for two-step extraction
        (initial extraction to get component list, then final extraction after getting latest versions).
        
        Args:
            assembly_identifier: Path to the SolidWorks assembly file OR part name
            bom_layout: Name of the BOM layout
            configuration: Configuration name
            output_mode: "console", "json", or "both"
            search_mode: "path" (default) or "name" (search by part name)

        Returns:
            Dictionary containing parsed BOM data
        """
        
        # ── Native Python COM extractor (dev only) ────────────────────────────
        # When use_native_extractor=true in pdm_settings.json, bypass the C#
        # subprocess entirely and query PDM directly via comtypes.
        # Prod machines have this flag False (or absent) and never reach this branch.
        if pdm_config.is_native_extractor_enabled():
            try:
                from pdm_native_extractor import extract_bom_native
                return extract_bom_native(
                    assembly_identifier=assembly_identifier,
                    bom_layout=bom_layout,
                    configuration=configuration,
                    search_mode=search_mode,
                    include_thumbnails=True,
                )
            except Exception as e:
                raise RuntimeError(f"[native extractor] {e}")

        # ── C# subprocess path (prod / default) ───────────────────────────────
        # Validate output_mode parameter
        valid_output_modes = ["console", "json", "both"]
        if output_mode not in valid_output_modes:
            raise ValueError(f"Invalid output_mode: {output_mode}. Must be one of {valid_output_modes}")

        # Validate search_mode parameter
        valid_search_modes = ["path", "name"]
        if search_mode not in valid_search_modes:
            raise ValueError(f"Invalid search_mode: {search_mode}. Must be one of {valid_search_modes}")

        # Validate bom_layout (prevent command injection via special characters)
        if not re.match(r'^[a-zA-Z0-9_\-\s]+$', bom_layout):
            raise ValueError(f"Invalid bom_layout: {bom_layout}. Only alphanumeric, underscore, hyphen, and space characters allowed")

        # Validate configuration (prevent command injection via special characters)
        if not re.match(r'^[a-zA-Z0-9_\-\s]+$', configuration):
            raise ValueError(f"Invalid configuration: {configuration}. Only alphanumeric, underscore, hyphen, and space characters allowed")

        # Build command
        cmd = [
            self.exe_path,
            assembly_identifier,
            bom_layout,
            configuration,
            output_mode,
            search_mode
        ]
        
        # Generate unique process ID
        process_id = str(uuid.uuid4())
        
        try:
            # Start the process with Popen for better control
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            # Track the process
            print(f"DEBUG: extract_bom_data acquiring lock for start...")
            with self._process_lock:
                print(f"DEBUG: extract_bom_data lock acquired (start).")
                self._active_processes[process_id] = {
                    'process': process,
                    'command': ' '.join(cmd),
                    'started_at': datetime.now().isoformat(),
                    'assembly_identifier': assembly_identifier,
                    'cancelled': False  # Flag to track if process was cancelled
                }
            print(f"DEBUG: extract_bom_data lock released (start).")
            
            print(f"Started PDMBOMExporter process {process_id} (PID: {process.pid})")
            
            # Wait for process to complete with timeout
            # Note: We don't remove from active_processes here to allow monitoring
            # The process will be removed when it completes or is explicitly killed
            try:
                stdout, stderr = process.communicate(timeout=2400)  # 25 minute timeout
            except subprocess.TimeoutExpired:
                # Process timed out - only kill if explicitly requested
                # Don't auto-kill as it may interrupt thumbnail extraction
                print(f"Process {process_id} timed out after 2400 seconds")
                # Remove from tracking but don't kill - let user decide
                with self._process_lock:
                    if process_id in self._active_processes:
                        del self._active_processes[process_id]
                raise RuntimeError(f"PDMBOMExporter process timed out after 2400 seconds")
            
            # Check if process was cancelled BEFORE removing from tracking
            was_cancelled = False
            with self._process_lock:
                if process_id in self._active_processes:
                    was_cancelled = self._active_processes[process_id].get('cancelled', False)
                    print(f"DEBUG: Process {process_id} cancelled flag: {was_cancelled}")
                    # Remove from active processes
                    del self._active_processes[process_id]
                else:
                    print(f"DEBUG: Process {process_id} not found in active_processes (may have been removed)")
            
            # If process was cancelled, raise exception immediately (don't try to parse output)
            if was_cancelled:
                print(f"DEBUG: Process {process_id} was cancelled - raising ProcessCancelledError immediately")
                raise ProcessCancelledError("BOM extraction process was cancelled by user")
            
            if process.returncode != 0:
                # Log error but don't raise if we got output (thumbnails might still be in JSON)
                error_msg = stderr if stderr else "Unknown error"
                print(f"Warning: PdmBomExporter returned non-zero exit code: {process.returncode}")
                print(f"Error output: {error_msg[:500]}")
                print(f"DEBUG: stdout length: {len(stdout) if stdout else 0}, was_cancelled: {was_cancelled}")
                
                # If we get here, process returned non-zero but wasn't marked as cancelled
                # This could be a real error, but if output is empty, it might have been cancelled
                if not stdout or len(stdout.strip()) == 0:
                    # Empty output with non-zero exit code - likely cancelled
                    print(f"DEBUG: Empty output with non-zero exit code - treating as cancellation")
                    raise ProcessCancelledError("BOM extraction process was cancelled by user")
                else:
                    raise subprocess.CalledProcessError(process.returncode, cmd, stdout, stderr)
            
            if output_mode == "console" or output_mode == "both":
                return self._parse_console_output(stdout)
            elif output_mode == "json":
                # Extract JSON file path from output
                json_path = self._extract_json_path(stdout)
                if json_path and os.path.exists(json_path):
                    try:
                        with open(json_path, 'r', encoding='utf-8') as f:
                            bom_data = json.load(f)
                        # Verify thumbnails are present in the data
                        if bom_data and 'components' in bom_data:
                            thumbnail_count = sum(1 for comp in bom_data.get('components', []) 
                                                 if comp.get('thumbnail', {}).get('available', False))
                            print(f"Extracted BOM with {len(bom_data.get('components', []))} components, {thumbnail_count} with thumbnails")
                        return bom_data
                    except json.JSONDecodeError as e:
                        print(f"Error parsing JSON file {json_path}: {e}")
                        raise ValueError(f"Could not parse JSON file: {e}")
                    except Exception as e:
                        print(f"Error reading JSON file {json_path}: {e}")
                        raise ValueError(f"Could not read JSON file: {e}")
                else:
                    # Try to extract JSON from stdout directly as fallback
                    print("Warning: JSON file path not found in output, trying to parse stdout directly")
                    try:
                        # Look for JSON in stdout
                        json_start = stdout.find('{')
                        if json_start >= 0:
                            json_text = stdout[json_start:]
                            # Find the last closing brace
                            json_end = json_text.rfind('}')
                            if json_end > 0:
                                json_text = json_text[:json_end + 1]
                                bom_data = json.loads(json_text)
                                print(f"Successfully parsed JSON from stdout with {len(bom_data.get('components', []))} components")
                                return bom_data
                    except Exception as e:
                        print(f"Could not parse JSON from stdout: {e}")
                    
                    # If we have empty or minimal output, treat as cancellation
                    if not stdout or len(stdout.strip()) == 0:
                        print(f"DEBUG: Empty output after JSON parse failure - treating as cancellation")
                        raise ProcessCancelledError("BOM extraction process was cancelled by user")
                    
                    raise ValueError(f"Could not find or read JSON file. Output: {stdout[:500]}")
            else:
                raise ValueError(f"Unknown output mode: {output_mode}")
                
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Executable failed: {e.stderr}")
        except Exception as e:
            raise RuntimeError(f"Error running executable: {str(e)}")
    
    def extract_bom_by_name(self, part_name: str, bom_layout: str = "MenteeBOM", 
                           configuration: str = "Default", output_mode: str = "console") -> Dict:
        """
        Extract BOM data by searching for a file by part name.
        
        Note: For name-based imports, the C# code (PdmBomExtractor) handles the search
        and file retrieval internally. It uses GetFileFromPath which works even if the file
        isn't local, and the PDM system will ensure the latest version is retrieved.
        We don't need to call _ensure_latest_assembly_file here because the C# code
        handles getting the latest version during the search process.
        
        Args:
            part_name: Part name to search for (e.g., "029-AS-00855")
            bom_layout: Name of the BOM layout
            configuration: Configuration name
            output_mode: "console", "json", or "both"
            
        Returns:
            Dictionary containing parsed BOM data
        """
        return self.extract_bom_data(part_name, bom_layout, configuration, output_mode, "name")
    
    def _parse_console_output(self, output: str) -> Dict:
        """Parse console output into structured data."""
        lines = output.strip().split('\n')
        
        bom_data = {
            'metadata': {},
            'components': [],
            'summary': {}
        }
        
        current_section = None
        current_component = None
        in_bom_columns = False
        in_custom_properties = False
        
        # Debug: Print the output to see what we're parsing
        # print("DEBUG: Parsing console output:")
        # print("=" * 50)
        # for i, line in enumerate(lines):
        #     print(f"{i:3d}: {repr(line)}")
        # print("=" * 50)
        
        for i, line in enumerate(lines):
            original_line = line
            line = line.strip()
            
            # Detect sections
            if line == "=== BOM METADATA ===":
                current_section = "metadata"
                continue
            elif line == "=== BOM COMPONENTS ===":
                current_section = "components"
                continue
            elif line == "=== SUMMARY ===":
                current_section = "summary"
                continue
            elif line == "=== END BOM ===":
                break
            
            # Parse metadata
            if current_section == "metadata" and line and not line.startswith("==="):
                if ":" in line:
                    key, value = line.split(":", 1)
                    bom_data['metadata'][key.strip()] = value.strip()
            
            # Parse components
            elif current_section == "components":
                if line.startswith("Component:"):
                    # Save previous component if exists
                    if current_component:
                        bom_data['components'].append(current_component)
                    
                    # Start new component
                    part_number = line.split(":", 1)[1].strip()
                    current_component = {
                        'part_number': part_number,
                        'file': '',
                        'path': '',
                        'level': '',
                        'quantity': '',
                        'state': '',
                        'configuration': '',
                        'bom_columns': {},
                        'custom_properties': {}
                    }
                    in_bom_columns = False
                    in_custom_properties = False
                
                elif current_component and original_line and (original_line[0].isspace() or original_line.startswith("  ")):
                    # Parse component details
                    if ":" in line:
                        key, value = line.split(":", 1)
                        key = key.strip()
                        value = value.strip()
                        # print(f"DEBUG: Processing key='{key}' value='{value}' for component {current_component.get('part_number', 'N/A')}")
                        
                        if key == "File":
                            current_component['file'] = value
                        elif key == "Path":
                            current_component['path'] = value
                        elif key == "Level":
                            current_component['level'] = value
                        elif key == "Quantity":
                            current_component['quantity'] = value
                        elif key == "State":
                            current_component['state'] = value
                        elif key == "Configuration":
                            current_component['configuration'] = value
                        elif key == "BOM Columns":
                            in_bom_columns = True
                            in_custom_properties = False
                            # print(f"DEBUG: Set in_bom_columns=True for component {current_component.get('part_number', 'N/A')}")
                        elif key == "Custom Properties":
                            in_bom_columns = False
                            in_custom_properties = True
                        elif in_bom_columns and key in ['Part Number', 'Revision', 'Description', 'Material', 'FINISH1', 'FINISH2', 'QTY', 'State']:
                            # Handle BOM columns that are processed in the main component section
                            current_component['bom_columns'][key] = value
                            # print(f"DEBUG: Added BOM column {key}={value} to {current_component.get('part_number', 'N/A')}")
                        elif line.startswith("    ") and ":" in line:
                            # Parse BOM columns or custom properties
                            sub_key, sub_value = line.split(":", 1)
                            sub_key = sub_key.strip()
                            sub_value = sub_value.strip()
                            
                            if in_bom_columns:
                                current_component['bom_columns'][sub_key] = sub_value
                                print(f"DEBUG: Added BOM column {sub_key}={sub_value} to {current_component.get('part_number', 'N/A')}")
                            elif in_custom_properties:
                                current_component['custom_properties'][sub_key] = sub_value
                        elif line.startswith("    ") and ":" in line and not in_bom_columns and not in_custom_properties:
                            # Handle case where BOM columns don't have a proper header
                            # This happens when the C# output is malformed
                            sub_key, sub_value = line.split(":", 1)
                            sub_key = sub_key.strip()
                            sub_value = sub_value.strip()
                            
                            # If it looks like a BOM column (common BOM field names), treat it as such
                            if sub_key in ['Part Number', 'Revision', 'Description', 'Material', 'FINISH1', 'FINISH2', 'QTY', 'State']:
                                current_component['bom_columns'][sub_key] = sub_value
                                in_bom_columns = True  # Set flag so subsequent lines are treated as BOM columns
            
            # Parse summary
            elif current_section == "summary" and line and not line.startswith("==="):
                if ":" in line:
                    key, value = line.split(":", 1)
                    bom_data['summary'][key.strip()] = value.strip()
        
        # Add last component
        if current_component:
            bom_data['components'].append(current_component)
        
        # Debug: Print parsed data (uncomment for debugging)
        # print(f"DEBUG: Parsed {len(bom_data['components'])} components")
        # for i, comp in enumerate(bom_data['components']):
        #     print(f"  Component {i+1}: {comp.get('part_number', 'N/A')} - BOM Columns: {comp.get('bom_columns', {})}")
        
        # Debug: Print the raw output to see what we're parsing (uncomment for debugging)
        # print("DEBUG: Raw output lines:")
        # for i, line in enumerate(lines):
        #     if "BOM Columns:" in line or "Part Number:" in line or "Revision:" in line or "Description:" in line:
        #         print(f"  {i:3d}: {repr(line)}")
        
        return bom_data
    
    def _extract_json_path(self, output: str) -> Optional[str]:
        """Extract JSON file path from console output."""
        # Look for JSON file path in the output
        match = re.search(r'C:\\[^\s]+\.json', output)
        return match.group(0) if match else None
    
    def convert_to_tree_format(self, bom_data: Dict) -> Dict:
        """
        Convert the parsed BOM data to tree format for the web UI.
        
        Args:
            bom_data: Parsed BOM data from console output or JSON
            
        Returns:
            Tree-structured BOM data
        """
        if not bom_data:
            return self._create_empty_tree()
        
        # Handle JSON data structure (from JSON output mode)
        if 'components' in bom_data and isinstance(bom_data['components'], list):
            return self._convert_json_to_tree(bom_data)
        
        # Handle console output structure (from console output mode)
        if 'components' in bom_data:
            return self._convert_console_to_tree(bom_data)
        
        return self._create_empty_tree()
    
    def _convert_json_to_tree(self, bom_data: Dict) -> Dict:
        """Convert JSON BOM data to tree format"""
        if not bom_data or 'components' not in bom_data:
            return self._create_empty_tree()
        
        # Get root assembly info
        metadata = bom_data.get('metadata', {})
        root_assembly = metadata.get('root_assembly', 'Unknown')
        root_description = metadata.get('root_assembly_description', 'Assembly')
        root_path = metadata.get('full_path', '')
        
        # Find the root assembly component (Level 0) from the components array
        root_component = None
        for component in bom_data.get('components', []):
            if component.get('level') == 0:
                root_component = component
                break
        
        # Create root node from the actual root component data
        if root_component:
            # Use actual component data
            bom_columns = root_component.get('bom_columns', {})
            thumbnail_data = root_component.get('thumbnail', {})
            
            # Construct info object from C# JSON structure (which has width, height, format, size_bytes)
            thumbnail_info = {}
            if thumbnail_data.get('available', False):
                thumbnail_info = {
                    'width': thumbnail_data.get('width', 0),
                    'height': thumbnail_data.get('height', 0),
                    'format': thumbnail_data.get('format', ''),
                    'size_bytes': thumbnail_data.get('size_bytes', 0)
                }
            
            tree_data = {
                "name": root_component.get('part_number', root_assembly),
                "qty": str(root_component.get('instance_quantity', 1)),
                "file": root_component.get('file_name', root_assembly),
                "path": root_component.get('full_path', root_path),
                "state": root_component.get('state', 'Active'),
                "configuration": root_component.get('configuration', metadata.get('configuration', 'Default')),
                "level": "0",
                "bom_columns": {
                    "Description": bom_columns.get('Description', root_description),
                    "Revision": bom_columns.get('Revision', ''),
                    "Material": bom_columns.get('Material', ''),
                    "FINISH1": bom_columns.get('FINISH1', ''),
                    "FINISH2": bom_columns.get('FINISH2', '')
                },
                "thumbnail": {
                    "available": thumbnail_data.get('available', False),
                    "data_base64": thumbnail_data.get('data_base64', ''),
                    "info": thumbnail_info
                },
                "children": [],
                "columns": ["Description", "Revision", "Material", "FINISH1", "FINISH2"],
                "metadata": {
                    "extraction_date": metadata.get('extraction_time', datetime.now().isoformat()),
                    "parser_type": "PdmBomParser_JSON",
                    "original_path": root_path,
                    "bom_layout": metadata.get('bom_layout', 'MenteeBOM'),
                    "configuration": metadata.get('configuration', 'Default'),
                    "total_components": metadata.get('total_components', '0')
                }
            }
        else:
            # Fallback to metadata if no root component found
            # Check if root_assembly_thumbnail exists in metadata (from C# JSON structure)
            root_thumb_meta = metadata.get('root_assembly_thumbnail', {})
            root_thumb_available = root_thumb_meta.get('available', False) if isinstance(root_thumb_meta, dict) else metadata.get('root_assembly_thumbnail_available', False)
            root_thumb_data = root_thumb_meta.get('data_base64', '') if isinstance(root_thumb_meta, dict) else metadata.get('root_assembly_thumbnail_data', '')
            
            # Construct info from metadata (C# exports width, height, format, size_bytes)
            root_thumb_info = {}
            if root_thumb_available and isinstance(root_thumb_meta, dict):
                root_thumb_info = {
                    'width': root_thumb_meta.get('width', 0),
                    'height': root_thumb_meta.get('height', 0),
                    'format': root_thumb_meta.get('format', ''),
                    'size_bytes': root_thumb_meta.get('size_bytes', 0)
                }
            elif metadata.get('root_assembly_thumbnail_info'):
                root_thumb_info = metadata.get('root_assembly_thumbnail_info', {})
            
            tree_data = {
                "name": root_assembly,
                "qty": "1",
                "file": root_assembly,
                "path": root_path,
                "state": "Active",
                "configuration": metadata.get('configuration', 'Default'),
                "level": "0",
                "bom_columns": {
                    "Description": root_description,
                    "Revision": "",
                    "Material": "",
                    "FINISH1": "",
                    "FINISH2": ""
                },
                "thumbnail": {
                    "available": root_thumb_available,
                    "data_base64": root_thumb_data,
                    "info": root_thumb_info
                },
                "children": [],
                "columns": ["Description", "Revision", "Material", "FINISH1", "FINISH2"],
                "metadata": {
                    "extraction_date": metadata.get('extraction_time', datetime.now().isoformat()),
                    "parser_type": "PdmBomParser_JSON",
                    "original_path": root_path,
                    "bom_layout": metadata.get('bom_layout', 'MenteeBOM'),
                    "configuration": metadata.get('configuration', 'Default'),
                    "total_components": metadata.get('total_components', '0')
                }
            }
        
        # Convert components to tree structure
        def create_component_node(component):
            """Create a tree node from a JSON component"""
            bom_columns = component.get('bom_columns', {})
            thumbnail_data = component.get('thumbnail', {})
            
            # Construct info object from C# JSON structure (which has width, height, format, size_bytes)
            thumbnail_info = {}
            if thumbnail_data.get('available', False):
                thumbnail_info = {
                    'width': thumbnail_data.get('width', 0),
                    'height': thumbnail_data.get('height', 0),
                    'format': thumbnail_data.get('format', ''),
                    'size_bytes': thumbnail_data.get('size_bytes', 0)
                }
            
            # Ensure thumbnail structure matches expected format
            formatted_thumbnail = {
                "available": thumbnail_data.get('available', False),
                "data_base64": thumbnail_data.get('data_base64', ''),
                "info": thumbnail_info
            }
            
            return {
                "name": component.get('part_number', 'Unknown'),
                "qty": str(component.get('instance_quantity', 1)),
                "file": component.get('file_name', ''),
                "path": component.get('full_path', ''),
                "state": component.get('state', 'Active'),
                "configuration": component.get('configuration', 'Default'),
                "level": str(component.get('level', 1)),
                "bom_columns": {
                    "Description": bom_columns.get('Description', ''),
                    "Revision": bom_columns.get('Revision', ''),
                    "Material": bom_columns.get('Material', ''),
                    "FINISH1": bom_columns.get('FINISH1', ''),
                    "FINISH2": bom_columns.get('FINISH2', '')
                },
                "thumbnail": formatted_thumbnail,  # Include properly formatted thumbnail data
                "children": []
            }
        
        # Build tree structure processing components in order, consolidating siblings
        # Components are ordered in the JSON, and hierarchy is determined by level
        stack = [tree_data]  # Stack to track parent nodes at each level

        # Track consolidated siblings at each parent level
        # Key: (parent_node_id, part_number, revision) -> consolidated data
        consolidated_siblings = {}

        # When the same component appears more than once under the same parent we
        # consolidate its quantity into the first occurrence's node.  Its children
        # (listed in the flat output immediately after the duplicate row) must be
        # skipped – they are already represented under the first occurrence.
        # skip_below_level: if set to L, skip every component whose level > L.
        skip_below_level = None

        # Process components in order to maintain hierarchy
        for component in bom_data['components']:
            if component.get('level') == 0:  # Skip root assembly
                continue

            current_level = component.get('level', 1)

            # If we are inside a "skip-duplicate" branch, ignore all deeper levels
            # and only resume when we come back to the same level or above.
            if skip_below_level is not None:
                if current_level > skip_below_level:
                    continue  # skip child of a consolidated duplicate
                else:
                    skip_below_level = None  # back at same level or above – resume

            part_number = component.get('part_number', 'Unknown')
            revision = component.get('bom_columns', {}).get('Revision', '') or ''
            file_name = component.get('file_name', '')
            instance_qty = float(component.get('instance_quantity', 1))

            # Get file extension
            file_ext = ''
            if isinstance(file_name, str) and '.' in file_name:
                file_ext = file_name.lower().split('.')[-1]

            # Adjust stack to match current level (pop if going up levels)
            while len(stack) > current_level:
                stack.pop()

            # Get the parent node (at level - 1)
            parent_node = stack[current_level - 1] if current_level > 0 and len(stack) > current_level - 1 else tree_data

            # Guard against None parent (can happen if an intermediate level component
            # was skipped by the C# exporter, creating a gap in the level sequence)
            if parent_node is None:
                for i in range(current_level - 2, -1, -1):
                    if stack[i] is not None:
                        parent_node = stack[i]
                        break
                if parent_node is None:
                    parent_node = tree_data
            
            # Create a key for consolidation: use parent node reference and part info
            # We consolidate siblings (same parent, same part number and revision)
            consolidation_key = (id(parent_node), part_number, revision)
            
            if consolidation_key in consolidated_siblings:
                # Already have this part under this parent - consolidate
                existing = consolidated_siblings[consolidation_key]
                existing_ext = existing['file_ext']

                # Sum quantities
                existing['total_qty'] += instance_qty

                # Prefer .sldprt over .sldasm when choosing which component data to keep
                if file_ext == 'sldprt' and existing_ext == 'sldasm':
                    # Replace component data with .sldprt version
                    existing['component'] = component
                    existing['file_ext'] = file_ext
                    # Update the node with new component data
                    new_node = create_component_node(component)
                    existing['node'].update({
                        'file': new_node['file'],
                        'path': new_node['path'],
                        'bom_columns': new_node['bom_columns']
                    })
                    # Update quantity to consolidated total
                    existing['node']['qty'] = str(int(existing['total_qty']) if existing['total_qty'].is_integer() else existing['total_qty'])
                    if existing['node'].get('bom_columns'):
                        existing['node']['bom_columns']['QTY.'] = existing['node']['qty']
                else:
                    # Just update quantity of existing node (keep existing component data)
                    existing['node']['qty'] = str(int(existing['total_qty']) if existing['total_qty'].is_integer() else existing['total_qty'])
                    if existing['node'].get('bom_columns'):
                        existing['node']['bom_columns']['QTY.'] = existing['node']['qty']

                # CRITICAL FIX: Mark that all deeper-level components that follow belong
                # to this duplicate occurrence and must be skipped.  They are already
                # represented under the first occurrence's node.  Without this fix the
                # children of duplicate occurrences were misplaced (the stack was not
                # updated at all, causing children to find the wrong parent or root).
                skip_below_level = current_level
            else:
                # First occurrence of this part under this parent - create new node
                node = create_component_node(component)
                
                # Store in consolidated_siblings for potential future consolidation
                consolidated_siblings[consolidation_key] = {
                    'component': component,
                    'total_qty': instance_qty,
                    'file_ext': file_ext,
                    'node': node
                }
                
                # Add node to parent
                parent_node['children'].append(node)
                
                # Push current node to stack for potential children
                # Make sure stack has enough levels
                while len(stack) <= current_level:
                    stack.append(None)
                stack[current_level] = node
        
        # Ensure all components are properly stored in the tree
        # Add a flat list of all components for database storage
        all_components = []
        def extract_all_components(node, level=0):
            """Extract all components from the tree structure"""
            component_data = {
                'PART NUMBER': node.get('name', ''),
                'PART NAME': node.get('file', ''),
                'DESCRIPTION': node.get('bom_columns', {}).get('Description', ''),
                'QTY.': node.get('qty', '1'),
                'Material': node.get('bom_columns', {}).get('Material', ''),
                'FINISH1': node.get('bom_columns', {}).get('FINISH1', ''),
                'FINISH2': node.get('bom_columns', {}).get('FINISH2', ''),
                'Revision': node.get('bom_columns', {}).get('Revision', ''),
                'State': node.get('state', 'Active'),
                'Level': str(level),
                'Configuration': node.get('configuration', 'Default'),
                'Path': node.get('path', ''),
                'Thumbnail': node.get('thumbnail', {})
            }
            all_components.append(component_data)
            
            # Process children
            for child in node.get('children', []):
                extract_all_components(child, level + 1)
        
        # Extract all components from the tree
        extract_all_components(tree_data)
        
        # Add the flat list to the tree data for database storage
        tree_data['items'] = all_components
        
        # Add metadata for better tracking
        tree_data['metadata']['total_items'] = len(all_components)
        tree_data['metadata']['assembly_name'] = tree_data.get('name', 'Unknown')
        tree_data['metadata']['has_assembly'] = '-AS-' in tree_data.get('name', '')
        
        return tree_data
    
    def _convert_console_to_tree(self, bom_data: Dict) -> Dict:
        """Convert console output BOM data to tree format (original method)"""
        if not bom_data or 'components' not in bom_data:
            return self._create_empty_tree()
        
        # Get root assembly info
        root_assembly = bom_data['metadata'].get('Root Assembly', 'Unknown')
        root_path = bom_data['metadata'].get('Full Path', '')
        
        # Get assembly data from BOM data
        assembly_description = "Assembly"
        assembly_state = "Active"
        assembly_revision = ""
        assembly_material = ""
        assembly_finish1 = ""
        assembly_finish2 = ""
        
        # Try to get data from the first component (which should be the root assembly)
        if bom_data['components'] and len(bom_data['components']) > 0:
            root_component = bom_data['components'][0]
            if root_component.get('level') == '0':  # Root assembly
                if 'bom_columns' in root_component:
                    assembly_description = root_component['bom_columns'].get('Description', 'Assembly')
                    assembly_revision = root_component['bom_columns'].get('Revision', '')
                    assembly_material = root_component['bom_columns'].get('Material', '')
                    assembly_finish1 = root_component['bom_columns'].get('FINISH1', '')
                    assembly_finish2 = root_component['bom_columns'].get('FINISH2', '')
                if root_component.get('state'):
                    assembly_state = root_component['state']
        
        # Create root node
        tree_data = {
            "name": root_assembly,
            "qty": "1",
            "file": root_assembly,
            "path": root_path,
            "state": assembly_state,
            "configuration": bom_data['metadata'].get('Configuration', 'Default'),
            "level": "0",
            "bom_columns": {
                "Description": assembly_description,
                "Revision": assembly_revision,
                "Material": assembly_material,
                "FINISH1": assembly_finish1,
                "FINISH2": assembly_finish2
            },
            "children": [],
            "columns": ["Description", "Revision", "Material", "FINISH1", "FINISH2"],
            "metadata": {
                "extraction_date": datetime.now().isoformat(),
                "parser_type": "PdmBomParser",
                "original_path": root_path,
                "bom_layout": bom_data['metadata'].get('BOM Layout', 'MenteeBOM'),
                "configuration": bom_data['metadata'].get('Configuration', 'Default'),
                "total_components": bom_data['summary'].get('Total Components', '0'),
                "total_quantity": bom_data['summary'].get('Total Quantity', '0')
            }
        }
        
        # Convert components to tree structure with proper multi-level support
        def create_component_node(component):
            """Create a tree node from a component"""
            bom_columns = component.get('bom_columns', {})
            
            return {
                "name": component.get('part_number', 'Unknown'),
                "qty": component.get('quantity', '1'),
                "file": component.get('file', ''),
                "path": component.get('path', ''),
                "state": component.get('state', 'Active'),
                "configuration": component.get('configuration', 'Default'),
                "level": component.get('level', '1'),
                "bom_columns": {
                    "Description": bom_columns.get('Description', ''),
                    "Revision": bom_columns.get('Revision', ''),
                    "Material": bom_columns.get('Material', ''),
                    "FINISH1": bom_columns.get('FINISH1', ''),
                    "FINISH2": bom_columns.get('FINISH2', '')
                },
                "children": []
            }
        
        # Build hierarchical tree structure based on component order and levels
        # The BOM components are typically ordered in a way that reflects the hierarchy
        stack = [tree_data]  # Stack to track current parent nodes
        
        for component in bom_data['components']:
            if component.get('level') == '0':  # Skip root assembly
                continue
                
            current_level = int(component.get('level', '1'))
            node = create_component_node(component)
            
            # Adjust stack to match current level
            while len(stack) > current_level:
                stack.pop()
            
            # Add node to current parent
            if stack:  # Should always be true since we start with root
                stack[-1]['children'].append(node)
            
            # Push current node to stack for potential children
            stack.append(node)
        
        # Ensure all components are properly stored in the tree
        # Add a flat list of all components for database storage
        all_components = []
        def extract_all_components(node, level=0):
            """Extract all components from the tree structure"""
            component_data = {
                'PART NUMBER': node.get('name', ''),
                'PART NAME': node.get('file', ''),
                'DESCRIPTION': node.get('bom_columns', {}).get('Description', ''),
                'QTY.': node.get('qty', '1'),
                'Material': node.get('bom_columns', {}).get('Material', ''),
                'FINISH1': node.get('bom_columns', {}).get('FINISH1', ''),
                'FINISH2': node.get('bom_columns', {}).get('FINISH2', ''),
                'Revision': node.get('bom_columns', {}).get('Revision', ''),
                'State': node.get('state', 'Active'),
                'Level': str(level),
                'Configuration': node.get('configuration', 'Default'),
                'Path': node.get('path', ''),
                'Thumbnail': node.get('thumbnail', {})
            }
            all_components.append(component_data)
            
            # Process children
            for child in node.get('children', []):
                extract_all_components(child, level + 1)
        
        # Extract all components from the tree
        extract_all_components(tree_data)
        
        # Add the flat list to the tree data for database storage
        tree_data['items'] = all_components
        
        # Add metadata for better tracking
        tree_data['metadata']['total_items'] = len(all_components)
        tree_data['metadata']['assembly_name'] = tree_data.get('name', 'Unknown')
        tree_data['metadata']['has_assembly'] = '-AS-' in tree_data.get('name', '')
        
        return tree_data
    
    def _create_empty_tree(self) -> Dict:
        """Create an empty tree structure"""
        return {
            "name": "Empty BOM",
            "qty": "1",
            "file": "",
            "path": "",
            "state": "Active",
            "configuration": "Default",
            "level": "0",
            "bom_columns": {
                "Description": "No BOM data available",
                "Revision": "",
                "Material": "",
                "FINISH1": "",
                "FINISH2": ""
            },
            "children": [],
            "columns": ["Description", "Revision", "Material", "FINISH1", "FINISH2"],
            "metadata": {
                "extraction_date": datetime.now().isoformat(),
                "parser_type": "PdmBomParser",
                "original_path": "",
                "bom_layout": "MenteeBOM",
                "configuration": "Default",
                "total_components": "0",
                "total_quantity": "0"
            }
        }
    
    def convert_to_flat_format(self, bom_data: Dict) -> Dict:
        """
        Convert the parsed BOM data to flat format (parts only, aggregated quantities).
        
        Args:
            bom_data: Parsed BOM data from console output or JSON
            
        Returns:
            Flat-structured BOM data with aggregated quantities
        """
        if not bom_data:
            return self._create_empty_flat()
        
        # Handle JSON data structure (from JSON output mode)
        if 'components' in bom_data and isinstance(bom_data['components'], list):
            return self._convert_json_to_flat(bom_data)
        
        # Handle console output structure (from console output mode)
        if 'components' in bom_data:
            return self._convert_console_to_flat(bom_data)
        
        return self._create_empty_flat()
    
    def _convert_json_to_flat(self, bom_data: Dict) -> Dict:
        """Convert JSON BOM data to flat format"""
        if not bom_data or 'components' not in bom_data:
            return self._create_empty_flat()
        
        # Get root assembly info
        metadata = bom_data.get('metadata', {})
        root_assembly = metadata.get('root_assembly', 'Unknown')
        
        # Flatten all components and aggregate quantities
        flat_items = {}
        
        def flatten_component(component, parent_qty=1.0, level=0):
            """Recursively flatten components and aggregate quantities"""
            part_number = component.get('part_number', '')
            instance_qty = float(component.get('instance_quantity', 1))
            total_qty = parent_qty * instance_qty
            
            # Skip root assembly (level 0)
            if level > 0:
                bom_columns = component.get('bom_columns', {})
                thumbnail_data = component.get('thumbnail', {})
                
                # Check if this is an assembly (has children)
                has_children = component.get('children', [])
                is_assembly = '-AS-' in part_number or has_children
                
                # Only include non-assembly parts in flat view
                if not is_assembly:
                    if part_number in flat_items:
                        # Aggregate quantities for duplicate parts
                        flat_items[part_number]['QTY.'] += total_qty
                    else:
                        flat_items[part_number] = {
                            'PART NUMBER': part_number,
                            'PART NAME': component.get('file_name', ''),
                            'DESCRIPTION': bom_columns.get('Description', ''),
                            'QTY.': total_qty,
                            'Material': bom_columns.get('Material', ''),
                            'FINISH1': bom_columns.get('FINISH1', ''),
                            'FINISH2': bom_columns.get('FINISH2', ''),
                            'Revision': bom_columns.get('Revision', ''),
                            'State': component.get('state', 'Active'),
                            'Level': str(level),
                            'Configuration': component.get('configuration', 'Default'),
                            'Path': component.get('full_path', ''),
                            'Thumbnail': thumbnail_data,
                            'Type': self._classify_part_type(part_number, component.get('state', ''), bom_columns.get('Description', ''))
                        }
            
            # Process children recursively
            for child in component.get('children', []):
                flatten_component(child, total_qty, level + 1)
        
        # Start flattening from root
        root_component = None
        for component in bom_data.get('components', []):
            if component.get('level') == 0:
                root_component = component
                break
        
        if root_component:
            flatten_component(root_component, 1.0, 0)
        
        # Create flat structure
        flat_data = {
            "name": root_assembly,
            "items": list(flat_items.values()),
            "metadata": {
                "extraction_date": metadata.get('extraction_time', datetime.now().isoformat()),
                "parser_type": "PdmBomParser_JSON_Flat",
                "original_path": metadata.get('full_path', ''),
                "bom_layout": metadata.get('bom_layout', 'MenteeBOM'),
                "configuration": metadata.get('configuration', 'Default'),
                "total_items": len(flat_items),
                "assembly_name": root_assembly,
                "view_type": "flat"
            }
        }
        
        return flat_data
    
    def _convert_console_to_flat(self, bom_data: Dict) -> Dict:
        """Convert console output BOM data to flat format"""
        if not bom_data or 'components' not in bom_data:
            return self._create_empty_flat()
        
        # Get root assembly info
        root_assembly = bom_data['metadata'].get('Root Assembly', 'Unknown')
        
        # Flatten all components and aggregate quantities
        flat_items = {}
        
        def flatten_component(component, parent_qty=1.0, level=0):
            """Recursively flatten components and aggregate quantities"""
            part_number = component.get('part_number', '')
            instance_qty = float(component.get('quantity', 1))
            total_qty = parent_qty * instance_qty
            
            # Skip root assembly (level 0)
            if level > 0:
                bom_columns = component.get('bom_columns', {})
                
                # Check if this is an assembly (has children or -AS- in name)
                is_assembly = '-AS-' in part_number
                
                # Only include non-assembly parts in flat view
                if not is_assembly:
                    if part_number in flat_items:
                        # Aggregate quantities for duplicate parts
                        flat_items[part_number]['QTY.'] += total_qty
                    else:
                        flat_items[part_number] = {
                            'PART NUMBER': part_number,
                            'PART NAME': component.get('file', ''),
                            'DESCRIPTION': bom_columns.get('Description', ''),
                            'QTY.': total_qty,
                            'Material': bom_columns.get('Material', ''),
                            'FINISH1': bom_columns.get('FINISH1', ''),
                            'FINISH2': bom_columns.get('FINISH2', ''),
                            'Revision': bom_columns.get('Revision', ''),
                            'State': component.get('state', 'Active'),
                            'Level': str(level),
                            'Configuration': component.get('configuration', 'Default'),
                            'Path': component.get('path', ''),
                            'Thumbnail': component.get('thumbnail', {}),
                            'Type': self._classify_part_type(part_number, component.get('state', ''), bom_columns.get('Description', ''))
                        }
        
        # Build hierarchical tree structure and flatten
        stack = []
        for component in bom_data['components']:
            if component.get('level') == '0':  # Skip root assembly
                continue
                
            current_level = int(component.get('level', '1'))
            
            # Adjust stack to match current level
            while len(stack) >= current_level:
                stack.pop()
            
            # Calculate cumulative quantity
            cumulative_qty = 1.0
            for parent in stack:
                cumulative_qty *= float(parent.get('quantity', 1))
            
            # Flatten this component
            flatten_component(component, cumulative_qty, current_level)
            
            # Push current component to stack for potential children
            stack.append(component)
        
        # Create flat structure
        flat_data = {
            "name": root_assembly,
            "items": list(flat_items.values()),
            "metadata": {
                "extraction_date": datetime.now().isoformat(),
                "parser_type": "PdmBomParser_Flat",
                "original_path": bom_data['metadata'].get('Full Path', ''),
                "bom_layout": bom_data['metadata'].get('BOM Layout', 'MenteeBOM'),
                "configuration": bom_data['metadata'].get('Configuration', 'Default'),
                "total_items": len(flat_items),
                "assembly_name": root_assembly,
                "view_type": "flat"
            }
        }
        
        return flat_data
    
    def _classify_part_type(self, part_number: str, state: str, description: str) -> str:
        """Classify part type using existing part classifier"""
        try:
            from part_classifier import part_classifier
            return part_classifier.classify_part(part_number, state, description)
        except ImportError:
            # Fallback classification if part_classifier not available
            if '-AS-' in part_number:
                return 'Assembly'
            elif '-MP-' in part_number:
                return 'Mechanical part'
            elif 'EL-' in part_number:
                return 'Inhouse electrical part'
            elif 'ES-' in part_number:
                return 'External electrical part'
            else:
                return 'Unknown'
    
    def _create_empty_flat(self) -> Dict:
        """Create an empty flat structure"""
        return {
            "name": "Empty BOM",
            "items": [],
            "metadata": {
                "extraction_date": datetime.now().isoformat(),
                "parser_type": "PdmBomParser_Flat",
                "original_path": "",
                "bom_layout": "MenteeBOM",
                "configuration": "Default",
                "total_items": 0,
                "assembly_name": "Empty BOM",
                "view_type": "flat"
            }
        }
    
    def extract_parts_for_library(self, tree_data: Dict) -> List[Dict]:
        """
        Extract all unique parts from parsed BOM for Part table insertion.
        
        Args:
            tree_data: Tree-structured BOM data
            
        Returns:
            List of part dictionaries ready for Part table insertion
        """
        parts = []
        seen_parts = set()  # Track (part_number, revision) combinations
        
        def extract_parts_recursive(node, level=0):
            """Recursively extract parts from tree structure"""
            # Extract part data
            part_number = node.get('name', '')
            revision = node.get('bom_columns', {}).get('Revision', '')
            
            # Create unique key for deduplication
            part_key = (part_number, revision)
            
            if part_key not in seen_parts and part_number:
                seen_parts.add(part_key)
                
                # Extract thumbnail data if available
                thumbnail_data = node.get('thumbnail', {})
                thumbnail_json = json.dumps(thumbnail_data) if thumbnail_data else None
                
                # Classify part type
                part_type = self._classify_part_type(
                    part_number,
                    node.get('state', ''),
                    node.get('bom_columns', {}).get('Description', '')
                )
                
                part_data = {
                    'part_number': part_number,
                    'revision': revision,
                    'part_name': node.get('file', ''),
                    'description': node.get('bom_columns', {}).get('Description', ''),
                    'material': node.get('bom_columns', {}).get('Material', ''),
                    'finish1': node.get('bom_columns', {}).get('FINISH1', ''),
                    'finish2': node.get('bom_columns', {}).get('FINISH2', ''),
                    'state': node.get('state', ''),
                    'part_type': part_type,
                    'thumbnail_data': thumbnail_json,
                    'vendor': None,  # Will be filled by user
                    'manufacturer': None,  # Will be filled by user
                    'manufacturer_pn': None,  # Will be filled by user
                    'unit_cost': None,  # Will be filled by user
                    'lead_time': None,  # Will be filled by user
                    'inventory': None,  # Will be filled by user
                    'warehouse_box_number': None,  # Will be filled by user
                    'order_qty': None,  # Will be auto-updated from PO orders
                    'po_orders': None,  # Will be filled by user
                    'notes': None,  # Will be filled by user
                    'eco_number': None,  # Will be filled during ECO workflow
                    'eco_description': None,  # Will be filled during ECO workflow
                    'backward_compatible': True,  # Default to True
                    'status': 'active'
                }
                
                parts.append(part_data)
            
            # Process children recursively
            for child in node.get('children', []):
                extract_parts_recursive(child, level + 1)
        
        # Start extraction from root
        extract_parts_recursive(tree_data)
        
        print(f"Extracted {len(parts)} unique parts for library")
        return parts
    
    def extract_bom_hierarchy(self, tree_data: Dict, bom_id: int) -> List[Dict]:
        """
        Extract parent-child relationships for BOMPart table insertion.
        
        Args:
            tree_data: Tree-structured BOM data
            bom_id: ID of the BOMInstance this hierarchy belongs to
            
        Returns:
            List of BOMPart dictionaries with hierarchy data
        """
        bom_parts = []
        part_sequence = 0
        
        def extract_hierarchy_recursive(node, parent_bom_part_id=None, level=0):
            """Recursively extract hierarchy from tree structure"""
            nonlocal part_sequence
            
            # Extract part data
            part_number = node.get('name', '')
            # Try to get revision from bom_columns first, then from node.revision, then empty string
            revision = node.get('bom_columns', {}).get('Revision', '') or node.get('revision', '')
            quantity = float(node.get('qty', 1)) if node.get('qty') else 1.0
            
            if part_number:
                print(f"DEBUG extract_bom_hierarchy: Extracting {part_number} with revision '{revision}' (from bom_columns['Revision']='{node.get('bom_columns', {}).get('Revision', '')}' or node.revision='{node.get('revision', '')}')")
                part_sequence += 1
                
                bom_part_data = {
                    'bom_id': bom_id,
                    'part_number': part_number,  # Will be resolved to part_id later
                    'revision': revision,  # Will be resolved to part_id later
                    'quantity': quantity,
                    'parent_bom_part_id': parent_bom_part_id,
                    'level': level,
                    'sequence': part_sequence,
                    'price_per_bom': None,  # Will be calculated after part_id resolution
                    'bom_notes': None  # BOM-specific notes
                }
                
                bom_parts.append(bom_part_data)
                
                # Process children with current bom_part as parent
                # Use the index in the bom_parts list as the temporary ID
                current_bom_part_index = len(bom_parts) - 1  # Index of the current bom_part
                for child in node.get('children', []):
                    extract_hierarchy_recursive(child, current_bom_part_index, level + 1)
        
        # Start extraction from root
        extract_hierarchy_recursive(tree_data)
        
        print(f"Extracted {len(bom_parts)} BOMPart records with hierarchy")
        return bom_parts
    
    def detect_revision_changes(self, old_bom_id: int, new_parts: List[Dict]) -> List[Dict]:
        """
        Compare parts in old BOM vs new parsed parts to detect revision changes.
        Skip parts that already have an ECO for the new revision.
        
        Args:
            old_bom_id: ID of the existing BOMInstance
            new_parts: List of new parts from PDM parsing
            
        Returns:
            List of parts requiring ECO input
        """
        try:
            from app import db, BOMPart, Part, get_thumbnail_dict

            # Get existing parts from old BOM
            existing_parts = db.session.query(Part).join(BOMPart).filter(
                BOMPart.bom_id == old_bom_id
            ).all()
            
            # Create lookup for existing parts
            existing_lookup = {}
            for part in existing_parts:
                key = part.part_number
                if key not in existing_lookup:
                    existing_lookup[key] = []
                existing_lookup[key].append(part)
            
            # Detect changes
            revision_changes = []
            
            for new_part in new_parts:
                part_number = new_part['part_number']
                new_revision = new_part['revision']

                # Only require ECO for mechanical parts (MP) and assemblies (AS)
                if '-MP-' not in part_number and '-AS-' not in part_number:
                    continue

                if part_number in existing_lookup:
                    # Check if revision changed
                    existing_part = existing_lookup[part_number][0]  # Get first occurrence
                    if existing_part.revision != new_revision:
                        # Check if a part with this part_number and new_revision already exists with an ECO
                        existing_part_with_new_rev = Part.query.filter_by(
                            part_number=part_number,
                            revision=new_revision
                        ).first()
                        
                        # Skip if part with new revision already exists and has an ECO
                        if existing_part_with_new_rev and existing_part_with_new_rev.eco_number:
                            print(f"⏭️  Skipping ECO requirement for {part_number} REV{new_revision} - ECO {existing_part_with_new_rev.eco_number} already exists")
                            continue

                        # Thumbnail for visual recognition in the ECO modal — prefer the
                        # new-revision part if it's already in the DB, else the old-revision part.
                        thumb_source = existing_part_with_new_rev or existing_part
                        try:
                            thumbnail = get_thumbnail_dict(thumb_source)
                        except Exception:
                            thumbnail = {}

                        revision_changes.append({
                            'part_number': part_number,
                            'old_revision': existing_part.revision,
                            'new_revision': new_revision,
                            'part_name': new_part['part_name'],
                            'description': new_part['description'],
                            'thumbnail': thumbnail
                        })
            
            print(f"🔍 Detected {len(revision_changes)} parts with revision changes requiring ECO")
            return revision_changes
            
        except ImportError:
            print("⚠️  Cannot detect revision changes - database models not available")
            return []
        except Exception as e:
            print(f"⚠️  Error detecting revision changes: {e}")
            return []
    
    def validate_exporter(self) -> tuple[bool, str]:
        """Validate that the PdmBomExporter executable exists and is accessible"""
        if not os.path.exists(self.exe_path):
            return False, f"PdmBomExporter not found at: {self.exe_path}"
        
        try:
            # Test the executable by running it without arguments
            result = subprocess.run([self.exe_path], capture_output=True, text=True, timeout=10)
            if "Usage:" in result.stdout or result.returncode == 1:
                return True, "PdmBomExporter is accessible"
            else:
                return False, "PdmBomExporter did not respond as expected"
        except subprocess.TimeoutExpired:
            return False, "PdmBomExporter timed out"
        except Exception as e:
            return False, f"Error testing PdmBomExporter: {str(e)}"

    @classmethod
    def kill_process(cls, process_id: str) -> Dict:
        """
        Safely terminate a specific PDMBOMExporter process.
        
        Args:
            process_id: UUID of the process to kill
            
        Returns:
            Dictionary with success status and message
        """
        print(f"DEBUG: kill_process called for {process_id}")
        print("DEBUG: Acquiring lock...")
        with cls._process_lock:
            print("DEBUG: Lock acquired.")
            if process_id not in cls._active_processes:
                print(f"DEBUG: Process {process_id} not found in active processes")
                return {
                    'success': False,
                    'message': f'Process {process_id} not found or already completed'
                }
            
            process_info = cls._active_processes[process_id]
            process = process_info['process']
            print(f"DEBUG: Found process object: {process}, PID: {process.pid}")
            
            try:
                # Check if process is still running
                poll_result = process.poll()
                print(f"DEBUG: Poll result: {poll_result}")
                
                if poll_result is None:
                    # Mark process as cancelled BEFORE terminating
                    if process_id in cls._active_processes:
                        cls._active_processes[process_id]['cancelled'] = True
                    
                    # Try graceful termination first
                    print("DEBUG: Calling terminate()...")
                    process.terminate()
                    try:
                        # Wait up to 5 seconds for graceful termination
                        print("DEBUG: Waiting for process to terminate (timeout=5s)...")
                        process.wait(timeout=5)
                        print(f"Process {process_id} terminated gracefully")
                    except subprocess.TimeoutExpired:
                        # Force kill if graceful termination fails
                        print("DEBUG: Timeout expired. Calling kill()...")
                        process.kill()
                        print("DEBUG: Waiting for process to die after kill()...")
                        process.wait()
                        print(f"Process {process_id} force killed")
                    
                    # Also kill any child processes using psutil (if available)
                    if PSUTIL_AVAILABLE:
                        print("DEBUG: Attempting to kill child processes with psutil...")
                        try:
                            parent = psutil.Process(process.pid)
                            children = parent.children(recursive=True)
                            for child in children:
                                try:
                                    child.kill()
                                except psutil.NoSuchProcess:
                                    pass
                        except psutil.NoSuchProcess:
                            pass  # Process already dead
                        except Exception as e:
                            print(f"Warning: Error killing child processes: {e}")
                    
                    # DON'T remove from active processes here - let extract_bom_data do it
                    # This allows extract_bom_data to detect cancellation
                    # The process will be removed when extract_bom_data completes
                    
                    return {
                        'success': True,
                        'message': f'Process {process_id} killed successfully'
                    }
                else:
                    # Process already completed
                    print("DEBUG: Process already completed (poll is not None).")
                    # Don't remove from dict here - let extract_bom_data handle cleanup
                    # Just mark as cancelled if it wasn't already
                    if process_id in cls._active_processes:
                        cls._active_processes[process_id]['cancelled'] = True
                    return {
                        'success': True,
                        'message': f'Process {process_id} already completed'
                    }
                    
            except Exception as e:
                print(f"DEBUG: Exception in kill_process: {e}")
                return {
                    'success': False,
                    'message': f'Error killing process {process_id}: {str(e)}'
                }
    
    @classmethod
    def kill_all_processes(cls) -> Dict:
        """
        Kill all active PDMBOMExporter processes.
        
        Returns:
            Dictionary with success status, count of killed processes, and any errors
        """
        with cls._process_lock:
            if not cls._active_processes:
                return {
                    'success': True,
                    'message': 'No active processes to kill',
                    'killed_count': 0
                }
            
            killed_count = 0
            errors = []
            process_ids = list(cls._active_processes.keys())
            
            for process_id in process_ids:
                result = cls.kill_process(process_id)
                if result['success']:
                    killed_count += 1
                else:
                    errors.append(result['message'])
            
            return {
                'success': len(errors) == 0,
                'message': f'Killed {killed_count} process(es)',
                'killed_count': killed_count,
                'errors': errors if errors else None
            }
    
    @classmethod
    def get_active_processes(cls) -> List[Dict]:
        """
        Get list of active PDMBOMExporter processes.
        
        Returns:
            List of dictionaries containing process information
        """
        # print("DEBUG: get_active_processes acquiring lock...") # Commented out to reduce noise, enable if needed
        with cls._process_lock:
            # print("DEBUG: get_active_processes lock acquired.")
            active = []
            # Clean up completed processes
            completed_ids = []
            for process_id, info in cls._active_processes.items():
                if info['process'].poll() is not None:
                    completed_ids.append(process_id)
                else:
                    active.append({
                        'process_id': process_id,
                        'command': info['command'],
                        'started_at': info['started_at'],
                        'pid': info['process'].pid
                    })
            
            # Remove completed processes
            for process_id in completed_ids:
                del cls._active_processes[process_id]
            
            return active

# Example usage
if __name__ == "__main__":
    parser = PdmBomParser()
    
    try:
        # Test with part name search
        print("=== Testing part name search ===")
        bom_data = parser.extract_bom_by_name(
            part_name="029-AS-00855",
            bom_layout="MenteeBOM",
            configuration="Default",
            output_mode="console"
        )
        
        print(f"Root Assembly: {bom_data['metadata'].get('Root Assembly', 'N/A')}")
        print(f"Total Components: {bom_data['summary'].get('Total Components', 'N/A')}")
        
        # Convert to tree format
        tree_data = parser.convert_to_tree_format(bom_data)
        print(f"Tree structure created with {len(tree_data['children'])} top-level components")
        
        # Debug: Show tree structure
        def print_tree(node, indent=0):
            prefix = "  " * indent
            print(f"{prefix}- {node['name']} (Level {node['level']}, Qty: {node['qty']})")
            for child in node['children']:
                print_tree(child, indent + 1)
        
        print("\nTree Structure:")
        print_tree(tree_data)
        
    except Exception as e:
        print(f"Error: {e}")

