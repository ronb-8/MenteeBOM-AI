#!/usr/bin/env python3
"""
Standard Parts RFQ Processor for MenteeBOM Web Application
Exports standard parts (bearings, fasteners, etc.) to Excel format
"""

import os
import pandas as pd
from typing import Dict, List, Optional
from datetime import datetime

class StandardPartsRFQProcessor:
    """Processes Standard Parts RFQ using filtered parts data"""
    
    def __init__(self):
        # Client-side output directory (where user's files are stored)
        self.base_directory = os.path.expanduser("~/Documents/RFQ-PO-BOM")
        
    def process_standard_parts_rfq(self, bom_name: str, part_type: str, filtered_parts: List[Dict], rfq_name: Optional[str] = None) -> Dict:
        """
        Main method to process Standard Parts RFQ
        
        Args:
            bom_name: Name of the BOM
            part_type: Type of parts (e.g., "Fasteners", "Bearings")
            filtered_parts: List of filtered parts with part_number and qty
            rfq_name: Custom RFQ name (if provided, used for file/folder naming)
            
        Returns:
            Dictionary with success status and results
        """
        try:
            if not filtered_parts:
                return {'success': False, 'error': 'No parts provided for export'}
            
            # Use rfq_name for file/folder naming if provided, otherwise use default format
            today_str = datetime.now().strftime('%Y-%m-%d')
            if rfq_name:
                folder_name = f"{rfq_name} - RFQ - {today_str}"
                filename = f"{rfq_name} - RFQ - {today_str}.xlsx"
            else:
                # Default format with part type (for backward compatibility)
                folder_name = f"{bom_name} - {part_type} - {today_str}"
                filename = f"{bom_name} - {part_type} - {today_str}.xlsx"
            
            # Create output directory
            output_dir = os.path.join(self.base_directory, folder_name)
            os.makedirs(output_dir, exist_ok=True)
            
            excel_path = os.path.join(output_dir, filename)
            
            # Create DataFrame with Part Number and QTY columns
            df_data = []
            for part in filtered_parts:
                # Handle both 'name' and 'part_number' keys for compatibility
                part_number = part.get('part_number', '') or part.get('name', '')
                df_data.append({
                    'PART NUMBER': part_number,
                    'QTY.': part.get('qty', 1)
                })
            
            df = pd.DataFrame(df_data)
            
            # Save to Excel
            df.to_excel(excel_path, index=False, engine='openpyxl')
            
            # Format Excel with proper column widths
            self._format_excel(excel_path)
            
            # Upload to Google Drive
            google_drive_result = {}
            try:
                google_drive_result = self._upload_to_google_drive(output_dir, folder_name, rfq_name)
            except Exception as e:
                print(f"Warning: Google Drive upload failed: {e}")
                # Continue even if Drive upload fails
            
            return {
                'success': True,
                'message': f'Standard Parts RFQ exported successfully',
                'output_path': output_dir,
                'filename': filename,
                'excel_path': excel_path,
                'parts_count': len(filtered_parts),
                'part_type': part_type,
                'google_drive': google_drive_result
            }
            
        except Exception as e:
            return {'success': False, 'error': f'Standard Parts RFQ processing failed: {str(e)}'}
    
    def _format_excel(self, excel_path: str):
        """
        Format Excel with proper column widths and alignment
        
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
            print(f"Warning: Could not format Excel: {e}")
    
    def _upload_to_google_drive(self, output_dir: str, folder_name: str, rfq_name: Optional[str] = None) -> Dict:
        """
        Upload Standard Parts RFQ files to Google Drive
        
        Args:
            output_dir: Directory containing the Excel file
            folder_name: Name for the folder
            rfq_name: Custom RFQ name (if provided, used for Google Drive folder)
            
        Returns:
            Dictionary with upload results and Google Drive links
        """
        try:
            from google_sheets.google_drive_upload import upload_output_files
            
            # Get all files in output directory
            existing_files = []
            if os.path.exists(output_dir):
                for file in os.listdir(output_dir):
                    file_path = os.path.join(output_dir, file)
                    if os.path.isfile(file_path):
                        existing_files.append(file_path)
            
            if not existing_files:
                print("No files to upload to Google Drive")
                return {
                    'success': False,
                    'error': 'No files to upload'
                }
            
            print(f"Uploading {len(existing_files)} files to Google Drive...")
            
            # Upload files to Google Drive (use 'rfq' folder)
            # Use rfq_name if provided, otherwise use folder_name with date
            if rfq_name:
                today_str = datetime.now().strftime('%Y-%m-%d')
                drive_folder_name = f"{rfq_name} - RFQ - {today_str}"
            else:
                # Fallback to folder_name (for backward compatibility)
                drive_folder_name = folder_name
            
            upload_result = upload_output_files(existing_files, drive_folder_name, file_type='rfq')
            
            if upload_result:
                print(f"Successfully uploaded files to Google Drive")
                # Handle return format from upload_output_files
                # Returns: {links: {...}, folder_id: ..., folder_url: ...}
                links = upload_result.get('links', {})
                folder_url = upload_result.get('folder_url')
                folder_id = upload_result.get('folder_id')
                
                return {
                    'success': True,
                    'folder_url': folder_url,
                    'folder_id': folder_id,
                    'links': links
                }
            else:
                print("Google Drive upload failed")
                return {
                    'success': False,
                    'error': 'Google Drive upload failed',
                    'details': 'Upload function returned None'
                }
                
        except ImportError:
            print("Warning: Google Drive upload not available")
            return {
                'success': False,
                'error': 'Google Drive upload module not available',
            }
        except Exception as e:
            print(f"Warning: Google Drive upload failed: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': f'Google Drive upload failed: {str(e)}',
            }


# Example usage and testing
if __name__ == "__main__":
    # Test the processor with sample data
    sample_parts = [
        {'name': 'DIN912-M6x20', 'qty': 10},
        {'name': 'DIN934-M8', 'qty': 5},
        {'name': 'SKF-6205', 'qty': 2}
    ]
    
    processor = StandardPartsRFQProcessor()
    result = processor.process_standard_parts_rfq('Test Assembly', 'Fasteners', sample_parts)
    print(f"Test result: {result}")
