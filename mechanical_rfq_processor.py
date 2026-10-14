#!/usr/bin/env python3
"""
Mechanical RFQ Processor for MenteeBOM Web Application
Converts imported BOM data to Excel format and processes RFQ using existing workflow
"""

import os
import sys
import json
import pandas as pd
import tempfile
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

# Add parent directory to path to import existing RFQ functionality
parent_dir = os.path.join(os.path.dirname(__file__), '..')
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Import existing RFQ functionality (optional for web environment)
try:
    from rfq_po_tab.check_revisions import run as check_revisions_run  # type: ignore
    from utils import rfq  # type: ignore
    RFQ_MODULES_AVAILABLE = True
except ImportError:
    # This is expected in web environment - desktop modules not available
    RFQ_MODULES_AVAILABLE = False
    check_revisions_run = None
    rfq = None

class MechanicalRFQProcessor:
    """Processes Mechanical RFQ using imported BOM data"""

    def _sanitize_for_path(self, name: str, max_len: int = 40) -> str:
        """Sanitize a string for safe use in file/directory names (Windows-safe)."""
        import re
        s = re.sub(r'[^\w\-]', '_', name)
        s = re.sub(r'_+', '_', s).strip('_')
        return s[:max_len]

    def __init__(self):
        self.temp_dir = None
        # Use temp directory for RFQ staging — files go directly to Google Drive
        self._rfq_temp_dirs = []  # Track temp dirs for cleanup
        self.base_directory = tempfile.mkdtemp(prefix="rfq_staging_")
        self._rfq_temp_dirs.append(self.base_directory)
        # Server-side PDM directory (where files are searched)
        self.pdm_directory = "C:/PDM/Projects/"
        #self.bom_main_folder = "c:/PDM/BOMs/"  # For thumbnails

    def _cleanup_temp_dirs(self):
        """Clean up temporary staging directories after Google Drive upload"""
        import shutil
        for temp_dir in self._rfq_temp_dirs:
            try:
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    print(f"Cleaned up temp RFQ directory: {temp_dir}")
            except Exception as e:
                print(f"Warning: Failed to clean up temp directory {temp_dir}: {e}")
        self._rfq_temp_dirs.clear()

    def process_rfq(self, bom_data: Dict, bom_name: str, custom_rfq_name: str = None,
                   quantity_multiplier: int = 1, custom_quantities: Dict = None, removed_parts: List = None) -> Dict:
        """
        Main method to process RFQ from imported BOM data
        
        Args:
            bom_data: Imported BOM data (from web interface)
            bom_name: Name for the BOM
            custom_rfq_name: Custom RFQ name provided by user (optional)
            quantity_multiplier: Global multiplier for all quantities (default: 1)
            custom_quantities: Dict of part_number -> custom_quantity for individual adjustments
            removed_parts: List of part keys like "PART123_REV01" to exclude from RFQ (optional)
            
        Returns:
            Dictionary with success status and results
        """
        try:
            # Determine RFQ name based on the new logic
            rfq_name = self._determine_rfq_name(bom_name, custom_rfq_name)
            
            # Create temporary directory for processing
            safe_name = self._sanitize_for_path(rfq_name)
            self.temp_dir = tempfile.mkdtemp(prefix=f"rfq_{safe_name}_")
            
            # Convert BOM data to Excel format with quantity adjustments
            excel_path, df_with_state = self._convert_bom_to_excel(bom_data, rfq_name, quantity_multiplier, custom_quantities)
            if not excel_path or df_with_state is None:
                return {'success': False, 'error': 'Failed to convert BOM data to Excel'}
            
            # Filter removed parts from DataFrame if provided
            if removed_parts:
                removed_parts_set = set()
                for part_key in removed_parts:
                    if '_REV' in part_key:
                        part_number, revision = part_key.split('_REV', 1)
                        removed_parts_set.add((part_number, revision))
                    elif ' REV' in part_key:
                        part_number, revision = part_key.split(' REV', 1)
                        removed_parts_set.add((part_number, revision))
                    else:
                        removed_parts_set.add((part_key, None))
                
                # Filter DataFrame to exclude removed parts
                if not df_with_state.empty and 'PART NUMBER' in df_with_state.columns:
                    mask = df_with_state.apply(
                        lambda row: (str(row.get('PART NUMBER', '')), str(row.get('Revision', ''))) not in removed_parts_set
                        and (str(row.get('PART NUMBER', '')), None) not in removed_parts_set,
                        axis=1
                    )
                    df_with_state = df_with_state[mask].copy()
                    print(f"DEBUG: Filtered removed parts, DataFrame now has {len(df_with_state)} rows")
            
            # Process RFQ using existing workflow with DataFrame that has State column
            result = self._process_rfq_workflow_with_df(excel_path, df_with_state, rfq_name)
            
            return result
            
        except Exception as e:
            return {'success': False, 'error': f'RFQ processing failed: {str(e)}'}
        finally:
            # Clean up temporary directory
            if self.temp_dir and os.path.exists(self.temp_dir):
                import shutil
                try:
                    shutil.rmtree(self.temp_dir)
                except Exception as e:
                    print(f"Warning: Could not clean up temp directory: {e}")
    
    def _convert_bom_to_excel(self, bom_data: Dict, bom_name: str, quantity_multiplier: int = 1, custom_quantities: Dict = None) -> tuple:
        """
        Convert imported BOM data to Excel format compatible with existing RFQ workflow
        
        Args:
            bom_data: Imported BOM data
            bom_name: Name for the BOM
            quantity_multiplier: Global multiplier for all quantities (default: 1)
            custom_quantities: Dict of part_number -> custom_quantity for individual adjustments
            
        Returns:
            Path to created Excel file or None if failed
        """
        try:
            
            # Parse the BOM data structure with better error handling
            if isinstance(bom_data.get('data'), str):
                # Data is stored as JSON string
                try:
                    bom_tree = json.loads(bom_data['data'])
                except json.JSONDecodeError as e:
                    print(f"Error parsing JSON data: {e}")
                    return None, None
            else:
                # Data is already parsed
                bom_tree = bom_data.get('data', bom_data)
            
            # Validate that we have a valid tree structure
            if not isinstance(bom_tree, dict):
                print(f"Invalid BOM tree structure: {type(bom_tree)}")
                return None, None
            
            # Check if this is a flat structure (items array) instead of tree structure
            if 'items' in bom_tree and isinstance(bom_tree['items'], list) and len(bom_tree['items']) > 0:
                # Handle flat structure directly
                components = []
                for item in bom_tree['items']:
                    if isinstance(item, dict):
                        # Skip if this is a removed part (should already be filtered, but double-check)
                        part_number = item.get('PART NUMBER', '')
                        revision = item.get('Revision', '')
                        # Note: removed_parts filtering should happen before this, but we check anyway
                        component = self._extract_component_data(item, 0, 1, quantity_multiplier, custom_quantities)
                        if component:
                            components.append(component)
            else:
                # Convert tree structure to flat list for Excel
                components = self._flatten_bom_tree(bom_tree, quantity_multiplier, custom_quantities)
            
            
            if not components:
                raise ValueError("No components found in BOM data")
            
            # Create DataFrame
            df = pd.DataFrame(components)
            
            # Ensure required columns exist
            df = self._ensure_required_columns(df)
            
            # Consolidate parts by part number and revision (summing quantities)
            # This ensures the Excel export matches the consolidated BOM table
            df = self._consolidate_parts_dataframe(df)
            print(f"DEBUG: Consolidated DataFrame shape: {df.shape}")

            # Apply custom quantities AFTER consolidation so they are added once per unique part,
            # not once per occurrence in the BOM tree
            if custom_quantities and 'PART NUMBER' in df.columns and 'QTY.' in df.columns:
                for idx, row in df.iterrows():
                    part_number = str(row.get('PART NUMBER', '')).strip()
                    if part_number and part_number in custom_quantities:
                        try:
                            custom_qty_add = float(custom_quantities[part_number]) if custom_quantities[part_number] else 0
                            if custom_qty_add:
                                current_qty = float(row['QTY.']) if row['QTY.'] else 0
                                new_qty = max(0, current_qty + custom_qty_add)  # Ensure qty never goes below 0
                                df.at[idx, 'QTY.'] = new_qty
                                print(f"DEBUG: Applied custom qty to {part_number}: {current_qty} + {custom_qty_add} = {new_qty}")
                        except (ValueError, TypeError):
                            pass
            
            # Remove State column from Excel output (keep for internal processing)
            df_for_excel = df.drop(columns=['State'], errors='ignore')
            
            # Create Excel file (temporary for processing only)
            safe_bom = self._sanitize_for_path(bom_name)
            excel_filename = f"{safe_bom}_temp.xlsx"
            excel_path = os.path.join(self.temp_dir, excel_filename)
            
            # Save to Excel
            df_for_excel.to_excel(excel_path, index=False, engine='openpyxl')
            
            print(f"Created temporary Excel file: {excel_path}")
            print(f"Components processed: {len(components)}")
            
            return excel_path, df  # Return both Excel path and DataFrame with State column
            
        except Exception as e:
            print(f"Error converting BOM to Excel: {e}")
            return None, None
    
    def _flatten_bom_tree(self, bom_tree: Dict, quantity_multiplier: int = 1, custom_quantities: Dict = None, level: int = 0, parent_qty: int = 1) -> List[Dict]:
        """
        Flatten the tree structure into a list of components
        
        Args:
            bom_tree: Tree-structured BOM data
            quantity_multiplier: Global multiplier for all quantities
            custom_quantities: Dict of part_number -> custom_quantity for individual adjustments
            level: Current level in the tree
            parent_qty: Quantity from parent component
            
        Returns:
            List of flattened components
        """
        components = []
        
        # Extract component data
        component_data = self._extract_component_data(bom_tree, level, parent_qty, quantity_multiplier, custom_quantities)
        if component_data:
            components.append(component_data)
        
        # Process children - handle both 'children' and 'items' keys
        children = bom_tree.get('children', [])
        if not children and 'items' in bom_tree:
            # Handle flat structure with items
            children = bom_tree.get('items', [])
        
        # For child components in hierarchical BOMs, we need to pass the parent's BASE quantity
        # (before multiplier is applied), because the multiplier will be applied to the child's
        # base_qty (child_qty * parent_base_qty) in _extract_component_data.
        # If we pass the final QTY (which already includes multiplier), it would cause double multiplication.
        node_qty = bom_tree.get('qty', 1)
        try:
            node_qty_int = int(float(str(node_qty))) if str(node_qty).replace('.', '', 1).isdigit() else 1
            parent_qty_int = int(float(str(parent_qty))) if str(parent_qty).replace('.', '', 1).isdigit() else 1
            # Calculate base quantity for children: node_qty * parent_qty (before multiplier)
            base_qty_for_children = node_qty_int * parent_qty_int
        except (ValueError, TypeError):
            # Fallback: use parent_qty as-is if calculation fails
            base_qty_for_children = parent_qty
        
        for child in children:
            if isinstance(child, dict):
                # Pass base quantity (before multiplier) to children
                # The multiplier will be applied once in _extract_component_data
                child_components = self._flatten_bom_tree(child, quantity_multiplier, custom_quantities, level + 1, base_qty_for_children)
                components.extend(child_components)
        
        return components
    
    def _extract_component_data(self, node: Dict, level: int, parent_qty: int, quantity_multiplier: int = 1, custom_quantities: Dict = None) -> Optional[Dict]:
        """
        Extract component data from a tree node
        
        Args:
            node: Tree node
            level: Current level
            parent_qty: Parent quantity
            quantity_multiplier: Global multiplier for all quantities
            custom_quantities: Dict of part_number -> custom_quantity for individual adjustments
            
        Returns:
            Component data dictionary or None
        """
        try:
            
            # Get basic component info with safe defaults
            name = node.get('name', '')
            
            # Get BOM columns if available
            bom_columns = node.get('bom_columns', {})
            
            # Get quantity - check bom_columns first (QTY.), then node.qty, then default to 1
            qty = bom_columns.get('QTY.', None)
            if qty is None:
                qty = node.get('QTY.', None)
            if qty is None:
                qty = node.get('qty', 1)
            
            # Try to find part number in different possible fields
            # For flat structure, PART NUMBER is directly in the node, not in bom_columns
            part_number = node.get('PART NUMBER', '')
            if not part_number:
                part_number = bom_columns.get('PART NUMBER', '')
            if not part_number:
                part_number = node.get('Part Number', '')
            if not part_number:
                part_number = bom_columns.get('Part Number', '')
            if not part_number:
                part_number = node.get('PartNumber', '')
            if not part_number:
                part_number = bom_columns.get('PartNumber', '')
            if not part_number:
                part_number = node.get('part_number', '')
            if not part_number:
                part_number = node.get('partNumber', '')
            if not part_number:
                part_number = name  # Fallback to name field
            
            # If still no part number, try to extract from the node structure
            # This handles the case where the API returns a different structure
            if not part_number and isinstance(node, dict):
                # Look for any field that might contain the part number
                for key, value in node.items():
                    if isinstance(value, str) and len(value) > 3 and ('-' in value or '_' in value):
                        # This looks like a part number
                        part_number = value
                        break
            
            # Try to extract revision and state from the node structure
            revision = bom_columns.get('Revision', '')
            state = node.get('state', '')
            
            # If revision and state are still empty, try to find them in the node
            if not revision and isinstance(node, dict):
                for key, value in node.items():
                    if isinstance(value, str) and key.lower() in ['revision', 'rev', 'version']:
                        revision = value
                        break
            
            if not state and isinstance(node, dict):
                for key, value in node.items():
                    if isinstance(value, str) and key.lower() in ['state', 'status', 'lifecycle']:
                        state = value
                        break
            
            
            # Safe quantity calculation with validation and custom adjustments
            # IMPORTANT: If quantity_multiplier is 1 and custom_quantities is empty,
            # it means the frontend has already calculated the final quantities.
            # In this case, use the quantity as-is (it's already the total from the modal).
            try:
                # Convert qty to number
                qty_int = int(float(str(qty))) if str(qty).replace('.', '', 1).isdigit() else 1
                
                # If multiplier is 1 and no custom quantities, use quantity directly
                # This means frontend already calculated: (originalQty * multiplier) + customQty
                if quantity_multiplier == 1 and (not custom_quantities or part_number not in custom_quantities):
                    # Quantity is already the final total from modal - use it directly
                    effective_qty = qty_int
                    # Debug log for first few parts
                    if level == 0 or (level <= 1 and part_number and '-MP-' in part_number):
                        print(f"DEBUG: Part {part_number} - Using quantity directly (already calculated by frontend): {qty_int}")
                else:
                    # Need to calculate: (qty * parent_qty) * multiplier
                    # NOTE: Custom quantities are applied AFTER consolidation in _convert_bom_to_excel
                    # to avoid adding them once per occurrence of the same part
                    parent_qty_int = int(float(str(parent_qty))) if str(parent_qty).replace('.', '', 1).isdigit() else 1
                    base_qty = qty_int * parent_qty_int
                    effective_qty = base_qty * quantity_multiplier

                    # Debug log for first few parts
                    if level == 0 or (level <= 1 and part_number and '-MP-' in part_number):
                        print(f"DEBUG: Part {part_number} - Calculated: qty={qty_int}, parent_qty={parent_qty_int}, base={base_qty}, mult={quantity_multiplier}, result={effective_qty}")
                    
            except (ValueError, TypeError):
                effective_qty = 1
                print(f"Warning: Invalid quantity values - qty: {qty}, parent_qty: {parent_qty}")
            
            # Create component data (ITEM NO. will be set later based on row position)
            # Try to get data from both node and bom_columns with multiple field name variations
            component = {
                'PART NUMBER': part_number,
                'Revision': revision,
                'Description': (node.get('Description', '') or 
                               node.get('DESCRIPTION', '') or 
                               bom_columns.get('Description', '') or 
                               bom_columns.get('DESCRIPTION', '')),
                'Material': (node.get('Material', '') or 
                            node.get('MATERIAL', '') or 
                            bom_columns.get('Material', '') or 
                            bom_columns.get('MATERIAL', '')),
                'FINISH1': (node.get('FINISH1', '') or 
                           node.get('finish1', '') or 
                           bom_columns.get('FINISH1', '') or 
                           bom_columns.get('finish1', '')),
                'FINISH2': (node.get('FINISH2', '') or 
                           node.get('finish2', '') or 
                           bom_columns.get('FINISH2', '') or 
                           bom_columns.get('finish2', '')),
                'QTY.': effective_qty,
                'State': state,  # Keep State for internal processing
            }
            
            return component
            
        except Exception as e:
            print(f"Error extracting component data: {e}")
            return None
    
    def _ensure_required_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Ensure all required columns exist in the DataFrame
        
        Args:
            df: Input DataFrame
            
        Returns:
            DataFrame with all required columns
        """
        required_columns = [
            'ITEM NO.', 'PART NUMBER', 'Revision', 'Description', 
            'Material', 'FINISH1', 'FINISH2', 'QTY.', 'State'
        ]
        
        # Add missing columns with default values
        for col in required_columns:
             if col not in df.columns:
                 if col == 'QTY.':
                     df[col] = 1
                 else:
                     df[col] = ''
         
        # Set ITEM NO. based on row position (sequential numbering)
        df['ITEM NO.'] = range(1, len(df) + 1)
        
        # Reorder columns
        df = df[required_columns]
        
        return df
    
    def _consolidate_parts_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Consolidate parts by part number and revision (summing quantities) so the
        RFQ export matches the consolidated BOM table.
        
        Args:
            df: Input DataFrame with parts
            
        Returns:
            Consolidated DataFrame with unique parts and summed quantities
        """
        if df.empty or 'PART NUMBER' not in df.columns:
            return df
        
        consolidated = {}
        
        def to_qty(value):
            try:
                return float(value) if value is not None and value != '' else 0
            except (ValueError, TypeError):
                return 0
        
        def pick(existing_val, new_val):
            if existing_val is None or existing_val == '' or pd.isna(existing_val):
                return new_val
            return existing_val
        
        for _, row in df.iterrows():
            part_number = str(row.get('PART NUMBER', '')).strip()
            if not part_number:
                continue
            
            revision = str(row.get('Revision', '') or '').strip()
            key = (part_number, revision)
            
            qty = to_qty(row.get('QTY.', 0))
            
            if key not in consolidated:
                consolidated_row = row.copy()
                consolidated_row['QTY.'] = qty
                consolidated[key] = consolidated_row
            else:
                existing = consolidated[key]
                existing['QTY.'] = to_qty(existing.get('QTY.', 0)) + qty
                
                # Fill empty descriptive fields with the first non-empty value we see
                for field in ['Description', 'DESCRIPTION', 'Material', 'FINISH1', 'FINISH2', 'State', 'state']:
                    if field in row:
                        existing[field] = pick(existing.get(field), row.get(field))
                
                # Preserve bom_columns if present and existing is empty/non-dict
                if 'bom_columns' in row and isinstance(row.get('bom_columns'), dict):
                    if not isinstance(existing.get('bom_columns'), dict) or not existing.get('bom_columns'):
                        existing['bom_columns'] = row.get('bom_columns')
        
        consolidated_df = pd.DataFrame(consolidated.values()).reset_index(drop=True)
        return consolidated_df
    
    def _determine_rfq_name(self, bom_name: str, custom_rfq_name: str = None) -> str:
        """
        Determine RFQ name based on the new logic:
        - If no file is chosen, use BOM name + date
        - If custom RFQ name is provided, use it + date
        - Always add date to the name
        - Avoid duplicate dates in the name
        
        Args:
            bom_name: Original BOM name
            custom_rfq_name: Custom RFQ name provided by user (optional)
            
        Returns:
            Final RFQ name with date
        """
        from datetime import datetime
        
        # Get current date
        today_str = datetime.now().strftime('%Y-%m-%d')
        
        # Determine base name
        if custom_rfq_name and custom_rfq_name.strip():
            # Use custom name if provided
            base_name = custom_rfq_name.strip()
        else:
            # Use BOM name if no custom name provided
            base_name = bom_name
        
        # Clean up base name to avoid duplicate dates
        # Remove any existing date patterns and "RFQ" from the base name
        import re
        base_name = re.sub(r'\s*-\s*RFQ\s*-\s*\d{4}-\d{2}-\d{2}', '', base_name)
        base_name = re.sub(r'\s*RFQ\s*-\s*\d{4}-\d{2}-\d{2}', '', base_name)
        base_name = base_name.strip()
        
        # Add date to the name (only once)
        rfq_name = f"{base_name} - RFQ - {today_str}"
        
        return rfq_name
    
    def _process_rfq_workflow_with_df(self, excel_path: str, df: pd.DataFrame, bom_name: str) -> Dict:
        """
        Process RFQ using existing workflow with DataFrame that has State column
        
        Args:
            excel_path: Path to Excel BOM file (for reference)
            df: DataFrame with State column for validation
            bom_name: Name of the BOM
            
        Returns:
            Result dictionary with detailed status information
        """
        try:
            # Create output directory
            output_dir = os.path.join(self.base_directory, bom_name)
            os.makedirs(output_dir, exist_ok=True)
            
            print(f"DEBUG: Using DataFrame with {len(df)} rows and columns: {list(df.columns)}")
            
            # Step 1: Analyze BOM and check for manufacturing parts
            analysis_result = self._analyze_bom_for_rfq(df, bom_name)
            print(f"DEBUG: Analysis result: {analysis_result}")
            
            if not analysis_result['has_manufacturing_parts']:
                return {
                    'success': False,
                    'error': 'No manufacturing parts (-MP-) found in BOM',
                    'analysis': analysis_result
                }
            
            # Step 2: Generate search terms for file checking
            search_terms = self._generate_search_terms(df)
            
            # Step 3: Real file search and revision checking
            file_search_result = self._search_files_real(search_terms, output_dir)
            
            # Step 4: Check for missing files and provide status
            missing_files_analysis = self._analyze_missing_files(file_search_result)
            
            # Step 5: Check if we can proceed with RFQ (all files found and in Released state)
            can_proceed = file_search_result.get('can_proceed', False)
            state_issues = file_search_result.get('state_issues', [])
            
            if not can_proceed:
                return {
                    'success': False,
                    'error': 'Cannot proceed with RFQ due to file state or missing file issues',
                    'output_path': output_dir,
                    'analysis': analysis_result,
                    'file_search': file_search_result,
                    'missing_files': missing_files_analysis,
                    'state_issues': state_issues,
                    'message': 'RFQ process stopped due to file state or missing file issues'
                }
            
            # Step 6: Process RFQ for parts with complete files and correct state
            rfq_result = self._process_rfq_with_status(
                df, bom_name, output_dir, file_search_result, missing_files_analysis
            )
            
            # Step 7: Upload to Google Drive (if RFQ was successful)
            google_drive_result = {}
            if rfq_result.get('success', False):
                google_drive_result = self._upload_to_google_drive(output_dir, bom_name)

            # Clean up temp directory after upload
            self._cleanup_temp_dirs()

            return {
                'success': True,
                'message': 'RFQ processed successfully',
                'output_path': None,  # No permanent local path — files are on Google Drive
                'analysis': analysis_result,
                'file_search': file_search_result,
                'missing_files': missing_files_analysis,
                'rfq_result': rfq_result,
                'google_drive': google_drive_result,
                'files_created': rfq_result.get('files_created', [])
            }
            
        except Exception as e:
            print(f"Error in RFQ workflow: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': f'RFQ workflow failed: {str(e)}',
                'output_path': output_dir if 'output_dir' in locals() else None
            }

    def _process_rfq_workflow(self, excel_path: str, bom_name: str) -> Dict:
        """
        Process RFQ using existing workflow with interactive features
        
        Args:
            excel_path: Path to Excel BOM file
            bom_name: Name of the BOM
            
        Returns:
            Result dictionary with detailed status information
        """
        try:
            # Create output directory
            output_dir = os.path.join(self.base_directory, bom_name)
            os.makedirs(output_dir, exist_ok=True)
            
            # Load BOM data for analysis (from temporary file)
            df = pd.read_excel(excel_path, engine='openpyxl')
            print(f"DEBUG: Loaded DataFrame with {len(df)} rows and columns: {list(df.columns)}")
            
            # Step 1: Analyze BOM and check for manufacturing parts
            analysis_result = self._analyze_bom_for_rfq(df, bom_name)
            print(f"DEBUG: Analysis result: {analysis_result}")
            
            if not analysis_result['has_manufacturing_parts']:
                return {
                    'success': False,
                    'error': 'No manufacturing parts (-MP-) found in BOM',
                    'analysis': analysis_result
                }
            
            # Step 2: Generate search terms for file checking
            search_terms = self._generate_search_terms(df)
            
            # Step 3: Real file search and revision checking
            file_search_result = self._search_files_real(search_terms, output_dir)
            
            # Step 4: Check for missing files and provide status
            missing_files_analysis = self._analyze_missing_files(file_search_result)
            
            # Step 5: Check if we can proceed with RFQ (all files found and in Released state)
            can_proceed = file_search_result.get('can_proceed', False)
            state_issues = file_search_result.get('state_issues', [])
            
            if not can_proceed:
                return {
                    'success': False,
                    'error': 'Cannot proceed with RFQ due to file state or missing file issues',
                    'output_path': output_dir,
                    'analysis': analysis_result,
                    'file_search': file_search_result,
                    'missing_files': missing_files_analysis,
                    'state_issues': state_issues,
                    'message': 'RFQ process stopped due to file state or missing file issues'
                }
            
            # Step 6: Process RFQ for parts with complete files and correct state
            rfq_result = self._process_rfq_with_status(
                df, bom_name, output_dir, file_search_result, missing_files_analysis
            )
            
            # Step 7: Upload to Google Drive (if RFQ was successful)
            google_drive_result = {}
            if rfq_result.get('success', False):
                google_drive_result = self._upload_to_google_drive(output_dir, bom_name)

            # Clean up temp directory after upload
            self._cleanup_temp_dirs()

            return {
                'success': True,
                'output_path': None,  # No permanent local path — files are on Google Drive
                'files_created': rfq_result.get('files_created', []),
                'analysis': analysis_result,
                'file_search': file_search_result,
                'missing_files': missing_files_analysis,
                'rfq_summary': rfq_result.get('summary', {}),
                'google_drive': google_drive_result,
                'message': 'RFQ process completed with detailed analysis'
            }
            
        except Exception as e:
            return {'success': False, 'error': f'RFQ workflow failed: {str(e)}'}
    
    def _simulate_rfq_process(self, excel_path: str, bom_name: str, output_dir: str) -> Dict:
        """
        Simulate the RFQ process (placeholder for full implementation)
        
        Args:
            excel_path: Path to Excel BOM file
            bom_name: Name of the BOM
            output_dir: Output directory
            
        Returns:
            Result dictionary
        """
        try:
            # Load the BOM data
            df = pd.read_excel(excel_path, engine='openpyxl')
            
            # Filter for manufacturing parts (-MP-)
            manufacturing_parts = df[df['PART NUMBER'].str.contains('-MP-', na=False)]
            
            if manufacturing_parts.empty:
                return {
                    'success': False,
                    'error': 'No manufacturing parts (-MP-) found in BOM'
                }
            
            # Create RFQ Excel file (bom_name already includes "RFQ" and date from _determine_rfq_name)
            rfq_excel_name = f"{bom_name}.xlsx"
            rfq_excel_path = os.path.join(output_dir, rfq_excel_name)
            
            # Save RFQ Excel
            manufacturing_parts.to_excel(rfq_excel_path, index=False, engine='openpyxl')
            
            return {
                'success': True,
                'files_created': [rfq_excel_name],
                'manufacturing_parts_count': len(manufacturing_parts)
            }
            
        except Exception as e:
            return {'success': False, 'error': f'RFQ simulation failed: {str(e)}'}
    
    def _analyze_bom_for_rfq(self, df: pd.DataFrame, bom_name: str) -> Dict:
        """
        Analyze BOM for RFQ processing
        
        Args:
            df: BOM DataFrame
            bom_name: Name of the BOM
            
        Returns:
            Analysis results dictionary
        """
        try:
            total_parts = len(df)
            print(f"DEBUG: Analyzing BOM with {total_parts} parts")
            print(f"DEBUG: DataFrame columns: {list(df.columns)}")
            print(f"DEBUG: PART NUMBER column values: {df['PART NUMBER'].tolist()}")
            
            # Filter for manufacturing parts (-MP-) and exclude 3D Print parts
            manufacturing_parts = df[df['PART NUMBER'].str.contains('-MP-', na=False)]
            
            # Exclude 3D Print state parts (they shouldn't be in RFQ)
            if 'State' in manufacturing_parts.columns:
                manufacturing_parts = manufacturing_parts[manufacturing_parts['State'].str.lower() != '3d print']
            
            manufacturing_count = len(manufacturing_parts)
            print(f"DEBUG: Found {manufacturing_count} manufacturing parts (excluding 3D Print)")
            print(f"DEBUG: Manufacturing parts: {manufacturing_parts['PART NUMBER'].tolist()}")
            
            # Analyze revisions
            revisions = manufacturing_parts['Revision'].value_counts().to_dict()
            
            # Analyze materials
            materials = manufacturing_parts['Material'].value_counts().to_dict()
            
            return {
                'bom_name': bom_name,
                'total_parts': total_parts,
                'manufacturing_parts_count': manufacturing_count,
                'has_manufacturing_parts': manufacturing_count > 0,
                'revisions': revisions,
                'materials': materials,
                'manufacturing_parts_list': manufacturing_parts['PART NUMBER'].tolist()
            }
            
        except Exception as e:
            print(f"DEBUG: Error in BOM analysis: {e}")
            return {
                'error': f'BOM analysis failed: {str(e)}',
                'has_manufacturing_parts': False
            }
    
    def _generate_search_terms(self, df: pd.DataFrame) -> List[Dict]:
        """
        Generate search terms for file checking with state validation
        
        Args:
            df: BOM DataFrame
            
        Returns:
            List of search term dictionaries with state info
        """
        search_terms = []
        manufacturing_parts = df[df['PART NUMBER'].str.contains('-MP-', na=False)]
        
        for _, row in manufacturing_parts.iterrows():
                part_num = str(row.get('PART NUMBER', ''))
                rev = str(row.get('Revision', ''))
                state = str(row.get('State', '')).strip()
                
                # Skip 3D Print state files entirely
                if state.lower() == '3d print':
                    print(f"Skipping 3D Print part: {part_num}")
                    continue
                
                if pd.notna(part_num) and part_num and pd.notna(rev) and rev:
                    # Format revision consistently with safe conversion
                    try:
                        if str(rev).replace('.','',1).isdigit() and float(rev) < 10:
                            rev_str = f"0{int(float(rev))}"
                        else:
                            rev_str = str(rev).split('.')[0]
                    except (ValueError, TypeError):
                        rev_str = str(rev)
                    search_term = f"{part_num} REV{rev_str}"
                    
                    search_terms.append({
                        'search_term': search_term,
                        'part_number': part_num,
                        'revision': rev,
                        'state': state,
                        'skip_revision_check': state.lower() == '3d print'
                    })
        
        return search_terms
    
    def _attempt_pdm_retrieval(self, search_terms: List[Dict]) -> None:
        """
        Attempt to retrieve files from PDM vault before searching locally.
        Uses get_latest_files_batch for a single vault login across all parts.

        Args:
            search_terms: List of search term dictionaries with state info
        """
        if not search_terms:
            return

        try:
            from pdm_native_extractor import get_latest_files_batch

            files_list = [
                {
                    'part_number': term['part_number'],
                    'revision': term.get('revision'),
                    'extensions': ['.pdf', '.x_t'],
                }
                for term in search_terms
            ]

            print(f"[RFQ PDM] Pulling {len(files_list)} part(s) from vault...")
            result = get_latest_files_batch(files_list)

            retrieved = result.get('retrieved', [])
            failed = result.get('failed', [])
            print(f"[RFQ PDM] Retrieved: {len(retrieved)}, Failed: {len(failed)}")
            if failed:
                print(f"[RFQ PDM] Failed parts: {[f.get('part_number') for f in failed]}")

        except ImportError:
            print("Warning: pdm_native_extractor not available — skipping PDM pull, using local files only")
        except Exception as e:
            print(f"Warning: PDM batch pull failed ({e}) — proceeding with local files only")
    
    def _prepare_missing_files_list(self, missing_files_analysis: Dict) -> List[Dict]:
        """
        Prepare missing files list for C# executable
        
        Args:
            missing_files_analysis: Analysis of missing files
            
        Returns:
            List of file requests for C# exe
        """
        missing_files = []
        missing_parts = missing_files_analysis.get('missing_parts', [])
        
        for part_info in missing_parts:
            # Extract part number and revision from search term
            search_term = part_info['part']
            if ' REV' in search_term:
                part_number, revision = search_term.split(' REV', 1)
                missing_files.append({
                    'part_number': part_number,
                    'revision': revision,
                    'extensions': ['.x_t', '.pdf']
                })
        
        return missing_files
    
    def _call_pdm_get_latest(self, missing_files_list: List[Dict]) -> Dict:
        """
        Call C# executable to retrieve missing files from PDM vault
        
        Args:
            missing_files_list: List of missing files to retrieve
            
        Returns:
            Dictionary with retrieval results
        """
        try:
            import subprocess
            import tempfile
            
            if not missing_files_list:
                return {
                    'success': True,
                    'message': 'No missing files to retrieve',
                    'retrieved': [],
                    'failed': []
                }
            
            # Create temporary JSON file with missing files
            input_data = {
                'vault': 'PDM',
                'files': missing_files_list
            }
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(input_data, f, indent=2)
                temp_json_path = f.name
            
            # Path to C# executable
            csharp_exe_path = os.path.join(
                os.path.dirname(__file__), 
                '..', 
                'PdmBomExporter', 
                'bin', 
                'Debug', 
                'PdmGetLatestFiles.exe'
            )
            
            if not os.path.exists(csharp_exe_path):
                return {
                    'success': False,
                    'error': f'C# executable not found at: {csharp_exe_path}',
                    'retrieved': [],
                    'failed': []
                }
            
            print(f"Calling C# executable: {csharp_exe_path}")
            print(f"Input JSON: {temp_json_path}")
            
            # Call C# executable
            result = subprocess.run(
                [csharp_exe_path, temp_json_path],
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            # Clean up temp file
            try:
                os.unlink(temp_json_path)
            except:
                pass
            
            # Parse output
            if result.returncode == 0:
                try:
                    output_data = json.loads(result.stdout)
                    return {
                        'success': True,
                        'message': 'Files retrieved successfully',
                        'retrieved': output_data.get('retrieved', []),
                        'failed': output_data.get('failed', [])
                    }
                except json.JSONDecodeError:
                    return {
                        'success': False,
                        'error': f'Invalid JSON output from C# exe: {result.stdout}',
                        'retrieved': [],
                        'failed': []
                    }
            else:
                return {
                    'success': False,
                    'error': f'C# executable failed with code {result.returncode}: {result.stderr}',
                    'retrieved': [],
                    'failed': []
                }
                
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': 'C# executable timed out after 5 minutes',
                'retrieved': [],
                'failed': []
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Error calling C# executable: {str(e)}',
                'retrieved': [],
                'failed': []
            }
    
    def _search_files_real(self, search_terms: List[Dict], output_dir: str) -> Dict:
        """
        Real file search using MenteeBOM search_files function with state validation
        
        Args:
            search_terms: List of search term dictionaries with state info
            output_dir: Output directory
            
        Returns:
            File search results with state validation
        """
        try:
            # Extract search term strings for the search function
            search_term_strings = [term['search_term'] for term in search_terms]
            
            # Attempt PDM file retrieval before searching
            self._attempt_pdm_retrieval(search_terms)
            
            # Create status DataFrame (same format as MenteeBOM)
            status_df = pd.DataFrame({
                'search_term': search_term_strings,
                'x_t_found': False,
                'pdf_found': False
            })
            
            # Use the real search_files function from MenteeBOM
            if RFQ_MODULES_AVAILABLE:
                # Import the search_files function from utils
                from utils import search_files  # type: ignore
                found_files, status_df = search_files(self.pdm_directory, status_df)
            else:
                # Fallback: implement basic search functionality
                found_files, status_df = self._basic_file_search(search_term_strings, status_df)
            
            # Create PDF & XT folder and copy files
            pdf_xt_folder = os.path.join(output_dir, f"PDF & XT")
            os.makedirs(pdf_xt_folder, exist_ok=True)
            
            files_copied = 0
            if found_files:
                import shutil
                for file_path in found_files:
                    if os.path.exists(file_path):
                        # Always copy/overwrite to ensure we have the latest files from PDM
                        # This prevents stale files when running the same RFQ process multiple times in the same day
                        shutil.copy2(file_path, pdf_xt_folder)
                        files_copied += 1
                print(f"Copied {files_copied} files to {pdf_xt_folder} (overwritten if existed)")
            
            # Convert status_df to search_results format with state validation
            search_results = []
            state_issues = []
            
            for i, (_, row) in enumerate(status_df.iterrows()):
                term_info = search_terms[i]
                state = term_info['state']
                
                # Check file state validation (only if state exists and is not empty)
                if state and state.lower() == 'editing':
                    state_issues.append({
                        'part': term_info['part_number'],
                        'issue': f'File "{term_info["part_number"]}" is in Editing state - cannot proceed with RFQ. Please release the file in PDM.',
                        'state': state,
                        'file_path': f'PDM: {term_info["part_number"]} REV{term_info["revision"]}'
                    })
                    search_results.append({
                        'search_term': row['search_term'],
                        'x_t_found': False,
                        'pdf_found': False,
                        'status': 'Editing State - Cannot Proceed',
                        'state': state,
                        'part_number': term_info['part_number'],
                        'revision': term_info['revision']
                    })
                elif state and state.lower() not in ['released', '']:
                    # Only validate non-empty states that are not 'released'
                    state_issues.append({
                        'part': term_info['part_number'],
                        'issue': f'File "{term_info["part_number"]}" is in {state} state - must be Released for RFQ. Please release the file in PDM.',
                        'state': state,
                        'file_path': f'PDM: {term_info["part_number"]} REV{term_info["revision"]}'
                    })
                    search_results.append({
                        'search_term': row['search_term'],
                        'x_t_found': False,
                        'pdf_found': False,
                        'status': f'{state} State - Must be Released',
                        'state': state,
                        'part_number': term_info['part_number'],
                        'revision': term_info['revision']
                    })
                else:
                    # File is in Released state or no state specified, check if files were found
                    search_results.append({
                        'search_term': row['search_term'],
                        'x_t_found': bool(row['x_t_found']),
                        'pdf_found': bool(row['pdf_found']),
                        'status': 'Complete' if row['x_t_found'] and row['pdf_found'] else 'Missing Files',
                        'state': state or 'No State',
                        'part_number': term_info['part_number'],
                        'revision': term_info['revision']
                    })
            
            # Create search results Excel file with formatting (like MenteeBOM)
            search_result_path = os.path.join(output_dir, f"Search Results.xlsx")
            status_df.to_excel(search_result_path, index=False, engine='openpyxl')
            
            # Format the Excel file with red highlighting for missing files
            self._format_search_results_excel(search_result_path, status_df)
            
            # Check if we can proceed with RFQ
            # Can proceed if: no state issues AND all files found AND (Released state OR no state specified)
            print(f"DEBUG: State issues count: {len(state_issues)}")
            print(f"DEBUG: Search results count: {len(search_results)}")
            for r in search_results:
                state_val = r.get('state', '')
                state_lower = str(state_val).lower()
                is_valid_state = state_lower in ['released', 'no state', '']
                files_ok = r['x_t_found'] and r['pdf_found']
                print(f"DEBUG: Part {r.get('part_number', 'unknown')} - x_t: {r['x_t_found']}, pdf: {r['pdf_found']}, state: '{state_val}' (valid: {is_valid_state}), files_ok: {files_ok}")
            
            # Check can_proceed: no state issues + all files found + valid states (Released or empty/No State)
            can_proceed = (
                len(state_issues) == 0 and 
                all(r['x_t_found'] and r['pdf_found'] for r in search_results) and
                all(
                    str(r.get('state', '')).lower() in ['released', 'no state', ''] 
                    for r in search_results
                )
            )
            print(f"DEBUG: Can proceed result: {can_proceed}")
            
            return {
                'search_terms_count': len(search_terms),
                'search_results': search_results,
                'search_result_file': search_result_path,
                'pdf_xt_folder': pdf_xt_folder,
                'files_copied': files_copied,
                'all_files_found': can_proceed,
                'state_issues': state_issues,
                'can_proceed': can_proceed
            }
            
        except Exception as e:
            return {
                'error': f'File search failed: {str(e)}',
                'search_terms_count': 0,
                'all_files_found': False,
                'can_proceed': False
            }
    
    def _basic_file_search(self, search_terms: List[str], status_df: pd.DataFrame) -> Tuple[List[str], pd.DataFrame]:
         """
         Basic file search implementation (fallback when MenteeBOM modules not available)
         
         Args:
             search_terms: List of search terms
             status_df: Status DataFrame to update
             
         Returns:
             Tuple of (found_files, updated_status_df)
         """
         found_files = []
         
         for root, _, files in os.walk(self.pdm_directory):
             for file in files:
                 _, ext = os.path.splitext(file)
                 if ext.lower() in ['.x_t', '.pdf']:
                     for idx, search_term in enumerate(search_terms):
                         if pd.notna(search_term) and search_term in file:
                             found_files.append(os.path.join(root, file))
                             if ext.lower() == '.x_t':
                                 status_df.loc[idx, 'x_t_found'] = True
                             elif ext.lower() == '.pdf':
                                 status_df.loc[idx, 'pdf_found'] = True
         
         return found_files, status_df
     
    def _format_search_results_excel(self, excel_path: str, status_df: pd.DataFrame):
         """
         Format search results Excel with red highlighting for missing files (like MenteeBOM)
         
         Args:
             excel_path: Path to Excel file
             status_df: Status DataFrame
         """
         try:
             from openpyxl import load_workbook
             from openpyxl.styles import PatternFill
             
             wb = load_workbook(excel_path)
             ws = wb.active
             if ws is not None:
                 red_fill = PatternFill(start_color="FFFF0000", end_color="FFFF0000", fill_type="solid")
                 
                 for i, (index, row) in enumerate(status_df.iterrows()):
                     if not bool(row['x_t_found']) or not bool(row['pdf_found']):
                         row_idx = i + 2  # +2 for 1-based index and header
                         for cell in ws[row_idx]:
                             cell.fill = red_fill
             
             wb.save(excel_path)
         except Exception as e:
             print(f"Warning: Could not format search results Excel: {e}")
    
    def _format_rfq_excel(self, excel_path: str):
        """
        Format RFQ Excel with proper column widths and alignment
        
        Args:
            excel_path: Path to Excel file
        """
        try:
            from openpyxl import load_workbook
            from openpyxl.styles import Alignment
            
            wb = load_workbook(excel_path)
            ws = wb.active
            if ws is not None:
                # Adjust column widths based on content
                for col in ws.columns:
                    max_length = 0
                    column_letter = col[0].column_letter
                    for cell in col:
                        try:
                            if cell.value is not None:
                                cell_str_len = len(str(cell.value))
                                if cell_str_len > max_length:
                                    max_length = cell_str_len
                        except:
                            pass
                    adjusted_width = max(10, max_length + 4)
                    ws.column_dimensions[column_letter].width = adjusted_width
                
                # Set alignment for all cells
                for row in ws.iter_rows(min_row=1):
                    for cell in row:
                        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=False)
            
            wb.save(excel_path)
        except Exception as e:
            print(f"Warning: Could not format RFQ Excel: {e}")
    
    def _analyze_missing_files(self, file_search_result: Dict) -> Dict:
        """
        Analyze missing files and provide detailed status
        
        Args:
            file_search_result: Results from file search
            
        Returns:
            Missing files analysis
        """
        try:
            search_results = file_search_result.get('search_results', [])
            
            missing_parts = []
            complete_parts = []
            
            for result in search_results:
                if not result['x_t_found'] or not result['pdf_found']:
                    missing_details = []
                    if not result['x_t_found']:
                        missing_details.append("XT file")
                    if not result['pdf_found']:
                        missing_details.append("PDF file")
                    
                    missing_parts.append({
                        'part': result['search_term'],
                        'missing_files': missing_details
                    })
                else:
                    complete_parts.append(result['search_term'])
            
            return {
                'total_parts': len(search_results),
                'complete_parts_count': len(complete_parts),
                'missing_parts_count': len(missing_parts),
                'missing_parts': missing_parts,
                'complete_parts': complete_parts,
                'can_proceed': len(complete_parts) > 0,
                'all_files_found': len(missing_parts) == 0
            }
            
        except Exception as e:
            return {
                'error': f'Missing files analysis failed: {str(e)}',
                'can_proceed': False
            }
    
    def _process_rfq_with_status(self, df: pd.DataFrame, bom_name: str, output_dir: str, 
                                file_search_result: Dict, missing_files_analysis: Dict) -> Dict:
        """
        Process RFQ with detailed status information
        
        Args:
            df: BOM DataFrame
            bom_name: Name of the BOM
            output_dir: Output directory
            file_search_result: File search results
            missing_files_analysis: Missing files analysis
            
        Returns:
            RFQ processing results
        """
        try:
            # Get parts that have complete files
            complete_parts = missing_files_analysis.get('complete_parts', [])
            
            if not complete_parts:
                return {
                    'success': False,
                    'error': 'No parts have complete files for RFQ',
                    'summary': missing_files_analysis
                }
            
            # Filter BOM for parts with complete files and exclude 3D Print parts
            part_numbers = [part.split(' REV')[0] for part in complete_parts]
            df_filtered = df[df['PART NUMBER'].isin(part_numbers)]
            
            # Exclude 3D Print state parts from RFQ
            df_filtered = df_filtered[df_filtered['State'].str.lower() != '3d print']
            
            # Reset ITEM NO. to be sequential from 1 to number of rows in RFQ
            df_filtered = df_filtered.reset_index(drop=True)
            df_filtered['ITEM NO.'] = range(1, len(df_filtered) + 1)
            
            # Create RFQ files (bom_name already includes "RFQ" and date from _determine_rfq_name)
            rfq_excel_name = f"{bom_name}.xlsx"
            rfq_excel_path = os.path.join(output_dir, rfq_excel_name)
            
            # Remove State column from final Excel export (keep for internal processing)
            df_for_excel = df_filtered.drop(columns=['State'], errors='ignore')
            
            # Save RFQ Excel with proper formatting
            df_for_excel.to_excel(rfq_excel_path, index=False, engine='openpyxl')
            
            # Format Excel with proper column widths
            self._format_rfq_excel(rfq_excel_path)
            
            # Create ZIP file with PDF and XT files (like MenteeBOM)
            rfq_zip_name = f"{bom_name}.zip"
            rfq_zip_path = os.path.join(output_dir, rfq_zip_name)
             
            # Get PDF & XT folder from file search result
            pdf_xt_folder = file_search_result.get('pdf_xt_folder', '')
            
            import zipfile
            with zipfile.ZipFile(rfq_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                # Add PDF and XT files for parts with complete files
                if pdf_xt_folder and os.path.exists(pdf_xt_folder):
                    files_added_to_zip = set()
                    
                    for idx, row in df_filtered.iterrows():
                        part_number = row['PART NUMBER']
                        revision = row['Revision']
                        
                        # Search for files matching this part with safe revision handling
                        try:
                            # Format revision safely
                            if pd.notna(revision) and str(revision).replace('.','',1).isdigit() and float(revision) < 10:
                                rev_str = f"0{int(float(revision))}"
                            else:
                                rev_str = str(revision).split('.')[0] if pd.notna(revision) else ""
                            
                            search_pattern = f"{part_number} REV{rev_str}"
                        except (ValueError, TypeError):
                            search_pattern = f"{part_number} REV{revision}"
                        
                        for root, _, files in os.walk(pdf_xt_folder):
                            for file in files:
                                if search_pattern in file and file not in files_added_to_zip:
                                    file_path = os.path.join(root, file)
                                    arcname = os.path.relpath(file_path, pdf_xt_folder)
                                    zipf.write(file_path, arcname)
                                    files_added_to_zip.add(file)
            
            return {
                'success': True,
                'files_created': [rfq_excel_name, rfq_zip_name],
                'summary': {
                    'total_parts_in_bom': len(df),
                    'manufacturing_parts_found': len(df[df['PART NUMBER'].str.contains('-MP-', na=False)]),
                    'parts_with_complete_files': len(complete_parts),
                    'parts_missing_files': missing_files_analysis.get('missing_parts_count', 0),
                    'rfq_parts_included': len(df_filtered)
                }
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'RFQ processing failed: {str(e)}'
            }
    
    def _upload_to_google_drive(self, output_dir: str, rfq_name: str) -> Dict:
        """
        Upload RFQ files to Google Drive
        
        Args:
            output_dir: Directory containing RFQ files
            rfq_name: Name of the RFQ (used as folder name)
            
        Returns:
            Dictionary with upload results and Google Drive links
        """
        try:
            from google_sheets.google_drive_upload import upload_output_files
            
            # Prepare files to upload
            files_to_upload = [
                os.path.join(output_dir, f"{rfq_name}.xlsx"),
                os.path.join(output_dir, f"{rfq_name}.zip")
            ]
            
            # Filter to only existing files
            existing_files = [f for f in files_to_upload if os.path.exists(f)]
            
            if not existing_files:
                return {
                    'success': False,
                    'error': 'No RFQ files found to upload',
                    'links': {}
                }
            
            print(f"Uploading {len(existing_files)} files to Google Drive...")
            
            # Upload files to Google Drive
            links = upload_output_files(existing_files, rfq_name, file_type='rfq')
            
            if links:
                print(f"Successfully uploaded {len(links)} files to Google Drive")
                # Handle new return format from upload_output_files
                if isinstance(links, dict) and 'links' in links:
                    # New format: {links: {...}, folder_id: ..., folder_url: ...}
                    return {
                        'success': True,
                        'links': links.get('links', {}),
                        'uploaded_files': list(links.get('links', {}).keys()),
                        'folder_id': links.get('folder_id'),
                        'folder_url': links.get('folder_url')
                    }
                else:
                    # Legacy format or direct links dict
                    return {
                        'success': True,
                        'links': links if isinstance(links, dict) else {},
                        'uploaded_files': list(links.keys()) if isinstance(links, dict) else [],
                        'folder_id': None,
                        'folder_url': None
                    }
            else:
                print("Google Drive upload failed")
                return {
                    'success': False,
                    'error': 'Google Drive upload failed',
                    'links': {}
                }
                
        except ImportError:
            print("Warning: Google Drive upload not available")
            return {
                'success': False,
                'error': 'Google Drive upload module not available',
                'links': {}
            }
        except Exception as e:
            print(f"Warning: Google Drive upload failed: {e}")
            return {
                'success': False,
                'error': f'Google Drive upload failed: {str(e)}',
                'links': {}
            }

    def _prepare_missing_files_list(self, missing_files_analysis: Dict) -> List[Dict]:
        """
        Prepare missing files list for C# PDM executable
        
        Args:
            missing_files_analysis: Analysis result containing missing files
            
        Returns:
            List of dictionaries with part numbers and revisions
        """
        missing_files_list = []
        
        try:
            missing_parts = missing_files_analysis.get('missing_parts', [])
            
            for part_info in missing_parts:
                if isinstance(part_info, dict):
                    part_number = part_info.get('part_number', '')
                    revision = part_info.get('revision', '01')
                    # _analyze_missing_files produces {'part': 'PN REVxx', ...} entries
                    if not part_number and part_info.get('part'):
                        part_str = str(part_info['part'])
                        if ' REV' in part_str:
                            part_number, revision = part_str.split(' REV', 1)
                        else:
                            part_number = part_str
                else:
                    # Handle string format like "029-MP-03221 REV01"
                    part_str = str(part_info)
                    if ' REV' in part_str:
                        part_number, revision = part_str.split(' REV')
                    else:
                        part_number = part_str
                        revision = '01'
                
                if part_number:
                    missing_files_list.append({
                        'part_number': part_number,
                        'revision': revision,
                        'extensions': ['.x_t', '.pdf']
                    })
            
            return missing_files_list
            
        except Exception as e:
            print(f"Error preparing missing files list: {e}")
            return []

    def _call_pdm_get_latest(self, missing_files_list: List[Dict]) -> Dict:
        """
        Call C# PDM executable to retrieve missing files
        
        Args:
            missing_files_list: List of missing files to retrieve
            
        Returns:
            Dictionary with retrieval results
        """
        try:
            import json
            import subprocess
            import tempfile
            
            if not missing_files_list:
                return {
                    'success': False,
                    'error': 'No missing files to retrieve'
                }
            
            # Create temporary JSON file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as temp_file:
                json.dump({
                    'vault': 'PDM',
                    'files': missing_files_list
                }, temp_file, indent=2)
                temp_file_path = temp_file.name
            
            print(f"Calling PDM executable with {len(missing_files_list)} files...")

            # ── Native Python path ────────────────────────────────────────────
            try:
                from pdm_config import pdm_config
                if pdm_config.is_native_extractor_enabled():
                    from pdm_native_extractor import get_latest_files_batch
                    print(f"[native] Batch get-latest for {len(missing_files_list)} file requests...")
                    res = get_latest_files_batch(missing_files_list)
                    all_retrieved = res.get('retrieved', [])
                    all_failed = res.get('failed', [])
                    if all_retrieved:
                        try:
                            os.unlink(temp_file_path)
                        except:
                            pass
                        return {
                            'success': True,
                            'message': f'Retrieved {len(all_retrieved)} file(s) via native extractor'
                                       + (f' ({len(all_failed)} failed)' if all_failed else ''),
                            'retrieved': all_retrieved,
                            'failed':    all_failed,
                            'retrieved_count': len(all_retrieved),
                        }
                    else:
                        print(f"[native] Batch get-latest retrieved 0 files, falling back to C#")
            except Exception as ne:
                print(f"[native] Batch get-latest failed, falling back to C#: {ne}")

            # ── C# subprocess path (fallback) ─────────────────────────────────
            csharp_exe_path = r"C:\Users\mechanical\Documents\MenteeBOM software\PdmBomExporter\bin\Debug\PdmBomExporter.exe"

            if not os.path.exists(csharp_exe_path):
                return {
                    'success': False,
                    'error': f'C# executable not found at: {csharp_exe_path}'
                }

            result = subprocess.run([
                csharp_exe_path, 'getlatest', temp_file_path
            ], capture_output=True, text=True, timeout=300)

            # Clean up temp file
            try:
                os.unlink(temp_file_path)
            except:
                pass

            # Parse result
            if result.returncode == 0:
                return {
                    'success': True,
                    'message': 'Files retrieved successfully',
                    'retrieved_count': len(missing_files_list)
                }
            elif result.returncode == 1:
                return {
                    'success': True,
                    'message': 'Partial success - some files retrieved',
                    'retrieved_count': len(missing_files_list) // 2  # Estimate
                }
            else:
                return {
                    'success': False,
                    'error': f'PDM retrieval failed with code {result.returncode}',
                    'stderr': result.stderr
                }
                
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': 'PDM retrieval timed out'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Error calling PDM executable: {str(e)}'
            }

    def collect_files_for_parts(self, parts_data: List[Dict]) -> Dict[str, Any]:
        """
        Collect PDF and XT files for specific parts with revisions
        
        Args:
            parts_data: List of part dictionaries with 'part_number' and 'revision' keys
            
        Returns:
            Dictionary with collection results:
            {
                'success': bool,
                'collected_files': [list of file paths],
                'missing_files': [list of missing files],
                'error': str (if failed)
            }
        """
        try:
            collected_files = []
            missing_files = []
            
            print(f"Collecting files for {len(parts_data)} parts")
            
            # Search for files in PDM directory
            for part_data in parts_data:
                part_number = part_data['part_number']
                requested_revision = part_data['revision']
                part_files_found = []
                
                # Try to find files with the requested revision first, then fall back to previous revisions
                # Parse revision number (e.g., "02" from "02" or "REV02")
                try:
                    # Extract numeric revision (handle formats like "02", "2", "REV02", etc.)
                    rev_num = int(requested_revision.replace('REV', '').replace('rev', '').strip().lstrip('0') or '0')
                except (ValueError, AttributeError):
                    rev_num = 0
                
                # Try revisions from requested down to 0
                revision_found = False
                for attempt_rev in range(rev_num, -1, -1):
                    revision_str = f"{attempt_rev:02d}"  # Format as "02", "01", "00"
                    
                    # Search for PDF and XT files with this revision
                    for root, dirs, files in os.walk(self.pdm_directory):
                        for file in files:
                            if (file.startswith(part_number) and 
                                f"REV{revision_str}" in file and 
                                (file.endswith('.pdf') or file.endswith('.x_t'))):
                                file_path = os.path.join(root, file)
                                if file_path not in part_files_found:  # Avoid duplicates
                                    part_files_found.append(file_path)
                                    collected_files.append(file_path)
                                    if attempt_rev == rev_num:
                                        print(f"Found file: {file_path} (requested revision REV{revision_str})")
                                    else:
                                        print(f"Found file: {file_path} (fallback to REV{revision_str}, requested was REV{requested_revision})")
                    
                    # If we found files for this revision, stop searching
                    if part_files_found:
                        revision_found = True
                        break
                
                if not part_files_found:
                    missing_files.append(f"{part_number} REV{requested_revision}")
                    print(f"No files found for part: {part_number} REV{requested_revision} (tried revisions down to REV00)")
            
            return {
                'success': True,
                'collected_files': collected_files,
                'missing_files': missing_files,
                'message': f"Collected {len(collected_files)} files, {len(missing_files)} parts missing files"
            }
            
        except Exception as e:
            print(f"Error in collect_files_for_parts: {e}")
            return {
                'success': False,
                'error': str(e),
                'collected_files': [],
                'missing_files': [f"{p['part_number']} REV{p['revision']}" for p in parts_data]
            }


# Example usage and testing
if __name__ == "__main__":
    # Test the processor with sample data
    sample_bom_data = {
        'name': 'Test_BOM',
        'data': {
            'name': '029-AS-00855',
            'qty': 1,
            'bom_columns': {
                'Revision': '01',
                'Description': 'Test Assembly',
                'Material': 'Steel',
                'FINISH1': 'Anodized',
                'FINISH2': ''
            },
            'state': 'Released',
            'children': [
                {
                    'name': '029-MP-00123',
                    'qty': 2,
                    'bom_columns': {
                        'Revision': '02',
                        'Description': 'Test Part',
                        'Material': 'Aluminum',
                        'FINISH1': 'Machined',
                        'FINISH2': 'Anodized'
                    },
                    'state': 'Released',
                    'children': []
                }
            ]
        }
    }
    
    processor = MechanicalRFQProcessor()
    result = processor.process_rfq(sample_bom_data, 'Test_BOM')
    print(f"Test result: {result}")
