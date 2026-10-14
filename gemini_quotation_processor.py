#!/usr/bin/env python3
"""
Google Gemini AI Quotation Processor
Extracts part numbers and costs from quotation PDFs/images/Excel files using Google Gemini AI
Supports Hebrew text and intelligent data extraction
"""

import os
import json
import re
from typing import Dict, Optional, Any, List
from datetime import datetime as dt
from PIL import Image
import PyPDF2
import io

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("Warning: google-generativeai not installed. Install with: pip install google-generativeai")

try:
    import pandas as pd
    EXCEL_AVAILABLE = True
except ImportError:
    EXCEL_AVAILABLE = False
    print("Warning: pandas not installed. Install with: pip install pandas")

# Fallback to existing PDF extraction methods
PDF_EXTRACTION_AVAILABLE = True


class GeminiQuotationProcessor:
    """Process quotations using Google Gemini AI with support for PDF, Excel, and images"""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Gemini AI processor
        
        Args:
            api_key: Google Gemini API key (if None, will try to get from environment)
        """
        self.api_key = api_key or os.environ.get('GEMINI_API_KEY')
        self.model = None
        self.model_name = None
        # Fallback chain: try models in order (each has separate daily quota)
        self._model_fallback_chain = [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
        ]

        if GEMINI_AVAILABLE and self.api_key:
            genai.configure(api_key=self.api_key)
            for model_name in self._model_fallback_chain:
                try:
                    self.model = genai.GenerativeModel(model_name)
                    self.model_name = model_name
                    print(f"Gemini AI initialized with {model_name}")
                    break
                except Exception as e:
                    print(f"Warning: Failed to initialize {model_name}: {e}")
                    continue
            if not self.model:
                print("Warning: All Gemini models failed to initialize")
        else:
            if not GEMINI_AVAILABLE:
                print("Warning: google-generativeai package not available")
            if not self.api_key:
                print("Warning: GEMINI_API_KEY not set")

    def _switch_to_next_model(self):
        """Switch to the next model in the fallback chain when quota is exceeded."""
        if not self.model_name or not self._model_fallback_chain:
            return False
        try:
            current_idx = self._model_fallback_chain.index(self.model_name)
        except ValueError:
            return False
        for model_name in self._model_fallback_chain[current_idx + 1:]:
            try:
                self.model = genai.GenerativeModel(model_name)
                old_name = self.model_name
                self.model_name = model_name
                print(f"Switched from {old_name} (quota exceeded) to {model_name}")
                return True
            except Exception as e:
                print(f"Warning: Failed to initialize fallback {model_name}: {e}")
                continue
        print("Warning: No more fallback models available")
        return False
    
    def _is_quota_error(self, error: Exception) -> bool:
        """Check if an exception is a quota/rate-limit error."""
        error_msg = str(error).lower()
        return ("quota exceeded" in error_msg or "resource exhausted" in error_msg
                or "429" in str(error) or "rate limit" in error_msg)

    def _get_request_options(self, timeout: int = 600) -> dict:
        """
        Get request options with timeout configuration for Gemini API calls
        
        Args:
            timeout: Timeout in seconds (default: 600 = 10 minutes)
            
        Returns:
            Dictionary with request_options for generate_content
        """
        return {"timeout": timeout}
    
    def extract_from_quotation(self, file_path: str, vendor: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        """
        Extract part numbers and costs from quotation PDF/image/Excel file
        
        Args:
            file_path: Path to quotation PDF, image, or Excel file
            vendor: Optional vendor name to use vendor-specific extraction
            
        Returns:
            Dictionary mapping part_number to pricing info:
            {
                "part_number": {
                    "unit_cost": float,
                    "order_qty": int,
                    "total_cost": float (optional)
                }
            }
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Quotation file not found: {file_path}")
        
        file_ext = os.path.splitext(file_path)[1].lower()
        filename = os.path.basename(file_path)
        
        # Check if filename contains "-MP-" for special handling
        has_mp_in_filename = '-MP-' in filename
        
        # Try Gemini AI first if available (preferred method)
        if self.model and file_ext in ['.pdf', '.png', '.jpg', '.jpeg', '.xlsx', '.xls']:
            try:
                print(f"Attempting Gemini AI extraction from {file_ext} file...")
                result = self._extract_with_gemini(file_path, vendor, has_mp_in_filename)
                if result and len(result) > 0:
                    print(f"Gemini extraction successful: found {len(result)} parts")
                    return result
                else:
                    print("Gemini extraction returned empty results")
            except Exception as e:
                print(f"Gemini extraction failed: {e}")
                import traceback
                traceback.print_exc()
                print("Falling back to alternative extraction methods...")
        
        # Fallback to existing PDF extraction methods
        if file_ext == '.pdf' and PDF_EXTRACTION_AVAILABLE:
            return self._extract_with_pdf_methods(file_path, vendor)
        
        # Fallback for Excel files
        if file_ext in ['.xlsx', '.xls'] and EXCEL_AVAILABLE:
            return self._extract_from_excel_fallback(file_path, vendor, has_mp_in_filename)
        
        # Last resort: try to extract manually
        raise ValueError(f"Unable to extract data from {file_path}. Unsupported format or extraction failed.")
    
    def extract_from_multiple_quotations(self, file_paths: List[str], vendor: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
        """
        Extract part numbers and costs from multiple quotation files
        
        Args:
            file_paths: List of paths to quotation PDF/image/Excel files
            vendor: Optional vendor name to use vendor-specific extraction
            
        Returns:
            Dictionary mapping part_number to list of pricing options:
            {
                "part_number": [
                    {
                        "unit_cost": float,
                        "order_qty": int,
                        "total_cost": float (optional),
                        "source_file": "file1.pdf"
                    },
                    {
                        "unit_cost": float,
                        "order_qty": int,
                        "total_cost": float (optional),
                        "source_file": "file2.pdf"
                    }
                ]
            }
        """
        all_results = {}
        
        for file_path in file_paths:
            if not os.path.exists(file_path):
                print(f"Warning: File not found: {file_path}")
                continue
                
            try:
                # Extract from single file
                file_result = self.extract_from_quotation(file_path, vendor)
                
                # Add source file info to each result
                for part_number, pricing_info in file_result.items():
                    pricing_info['source_file'] = os.path.basename(file_path)
                    
                    if part_number not in all_results:
                        all_results[part_number] = []
                    
                    all_results[part_number].append(pricing_info)
                    
            except Exception as e:
                print(f"Error processing {file_path}: {e}")
                continue
        
        return all_results
    
    def _extract_with_gemini(self, file_path: str, vendor: Optional[str] = None, has_mp_in_filename: bool = False) -> Dict[str, Dict[str, Any]]:
        """
        Extract pricing data using Gemini AI with enhanced intelligence
        
        Args:
            file_path: Path to PDF, image, or Excel file
            vendor: Optional vendor name
            has_mp_in_filename: Whether filename contains "-MP-"
            
        Returns:
            Dictionary mapping part_number to pricing info
        """
        if not self.model:
            raise RuntimeError("Gemini model not initialized")
        
        file_ext = os.path.splitext(file_path)[1].lower()
        
        # Build enhanced prompt with context
        base_instructions = """You are an expert at extracting pricing information from quotation documents.
Analyze the document carefully and extract the following information:
- Part numbers / catalog numbers / item codes - these can be in ANY format (alphanumeric codes, codes with dashes, codes with dots, DIN/ISO standards with dimensions, etc.)
- Unit cost/price for each part
- Quantity for each part (if available)
- Total cost for each part (if available)

IMPORTANT INSTRUCTIONS:
1. Be intelligent about finding part numbers - they may appear in various formats and locations
2. Part numbers can be in many formats: "XXX-MP-XXXXX", "DIN 912 M5x10", "ABC-123", "12345", vendor catalog numbers, etc.
3. Look for prices in different formats (with/without currency symbols, with commas/periods as decimal separators)
4. The document may contain Hebrew text - handle it properly and extract data regardless of language
5. Prices may be in different columns or positions - find them intelligently
6. If quantities are not explicitly stated, infer from context or use 1 as default
7. Be precise with numbers - preserve decimal places accurately
8. REVISION HANDLING: If a part number includes a revision suffix (e.g., "ABC-123 REV02", "ABC-123 Rev.A", "ABC-123 R02"), output ONLY the base part number WITHOUT the revision as the JSON key. Strip the revision entirely. For example: "021-MP-03476 REV02" should become "021-MP-03476". If two rows share the same base part number with different revisions, use the pricing from the row with the higher/later revision.
9. DO NOT extract rows that are subtotals, grand totals, shipping costs, tax/VAT lines, discount lines, header/footer text, or any non-part entries. Only extract rows that represent individual purchasable parts/items with a part number and a unit price.
10. MOLD/TOOLING COSTS: If a part has a separate mold, tooling, or setup cost (one-time cost, usually qty 1), extract it as a SEPARATE entry with the suffix "-MOLD" appended to the part number. For example, if part "005-MP-05994" has a prototype unit cost of 5.50 (qty 90) AND a mold cost of 850.00 (qty 1), output TWO entries: "005-MP-05994" with unit_cost 5.50 and "005-MP-05994-MOLD" with unit_cost 850.00. Do NOT skip mold/tooling costs."""

        next_instruction = 11
        # Add "-MP-" specific instructions if filename contains it
        if has_mp_in_filename:
            base_instructions += f"\n{next_instruction}. PRIORITY: Focus on extracting part numbers that contain '-MP-' in them. These are manufacturing parts and are the most important."
            next_instruction += 1

        # Add vendor-specific context if provided
        if vendor:
            base_instructions += f"\n{next_instruction}. Vendor context: {vendor} - adjust extraction logic if needed for vendor-specific formats."

        prompt = f"""{base_instructions}

Return the data as a structured JSON object with this exact format:
{{
  "part_number": {{
    "unit_cost": <float or null>,
    "order_qty": <int or null>,
    "total_cost": <float or null>
  }}
}}

Rules:
- Include ALL parts/items that have a part number, catalog number, or item code with associated pricing
- STRIP all revision suffixes (REV02, Rev.A, R02, etc.) from part numbers. Output ONLY the base part number as the JSON key
- If two rows have the same base part number (different revisions), keep only the one with the higher revision's pricing
- Do NOT include subtotals, totals, tax, VAT, shipping, or discount rows
- If a field is not available, use null
- Be precise with numbers
- Handle Hebrew text properly - part numbers are typically Latin alphanumeric even in Hebrew documents
- Extract ALL actual parts from the document - do not skip any real part entries
- If a part has a separate mold/tooling/setup cost, include it as a separate entry with "-MOLD" suffix on the part number"""
        
        try:
            if file_ext in ['.xlsx', '.xls']:
                # Handle Excel files
                return self._extract_from_excel_with_gemini(file_path, prompt, has_mp_in_filename)
            elif file_ext == '.pdf':
                # Handle PDF files
                return self._extract_from_pdf_with_gemini(file_path, prompt, has_mp_in_filename)
            else:
                # Handle image files
                img = Image.open(file_path)
                print("Processing image with Gemini...")
                request_options = self._get_request_options(timeout=600)  # 10 minutes timeout
                
                response = self.model.generate_content(
                    [prompt, img],
                    request_options=request_options
                )
                return self._parse_gemini_response(response.text, has_mp_in_filename)
                
        except Exception as e:
            print(f"Error in Gemini extraction: {e}")
            raise
    
    def _extract_from_excel_with_gemini(self, file_path: str, prompt: str, has_mp_in_filename: bool) -> Dict[str, Dict[str, Any]]:
        """
        Extract data from Excel file using Gemini AI
        
        Args:
            file_path: Path to Excel file
            prompt: Enhanced prompt for Gemini
            has_mp_in_filename: Whether filename contains "-MP-"
            
        Returns:
            Dictionary mapping part_number to pricing info
        """
        if not EXCEL_AVAILABLE:
            raise ValueError("pandas is required for Excel file processing")
        
        print("Reading Excel file...")
        try:
            # Read Excel file with proper encoding handling
            # Try to read all sheets
            excel_file = pd.ExcelFile(file_path, engine='openpyxl')
            all_sheets_data = {}
            
            for sheet_name in excel_file.sheet_names:
                try:
                    df = pd.read_excel(file_path, sheet_name=sheet_name, engine='openpyxl')
                    # Convert DataFrame to JSON string for Gemini
                    # Replace NaN with None for proper JSON serialization
                    df_cleaned = df.where(pd.notnull(df), None)
                    # Convert to dict format that's easier for Gemini to understand
                    sheet_data = {
                        'sheet_name': sheet_name,
                        'columns': df_cleaned.columns.tolist(),
                        'data': df_cleaned.to_dict('records')
                    }
                    all_sheets_data[sheet_name] = sheet_data
                except Exception as e:
                    print(f"Warning: Could not read sheet '{sheet_name}': {e}")
                    continue
            
            # Create structured text representation for Gemini
            # Send ALL rows, not just a sample
            excel_text = "Excel File Structure:\n\n"
            total_rows = 0
            
            # Custom JSON encoder to handle datetime and other non-serializable types
            def json_serializer(obj):
                if pd.isna(obj):
                    return None
                # Handle pandas Timestamp
                if isinstance(obj, pd.Timestamp):
                    return obj.strftime('%Y-%m-%d %H:%M:%S')
                # Handle Python datetime objects
                if isinstance(obj, dt):
                    return obj.strftime('%Y-%m-%d %H:%M:%S')
                # Handle other datetime-like objects
                if hasattr(obj, 'strftime'):
                    try:
                        return obj.strftime('%Y-%m-%d %H:%M:%S')
                    except:
                        pass
                if hasattr(obj, 'isoformat'):
                    try:
                        return obj.isoformat()
                    except:
                        pass
                # Handle numeric types
                if isinstance(obj, (int, float)):
                    return obj
                # Convert everything else to string
                return str(obj)
            
            for sheet_name, sheet_data in all_sheets_data.items():
                excel_text += f"Sheet: {sheet_name}\n"
                excel_text += f"Columns: {', '.join(sheet_data['columns'])}\n"
                excel_text += f"Total Rows: {len(sheet_data['data'])}\n"
                excel_text += "ALL Data Rows:\n"
                for i, row in enumerate(sheet_data['data']):
                    # Convert row to serializable format
                    serializable_row = {}
                    for key, value in row.items():
                        serializable_row[str(key)] = json_serializer(value)
                    excel_text += f"Row {i+1}: {json.dumps(serializable_row, ensure_ascii=False)}\n"
                    total_rows += 1
                excel_text += "\n"
            
            print(f"DEBUG: Prepared Excel data with {total_rows} total rows")
            
            # Increase character limit significantly for large files
            # Gemini can handle up to ~1M tokens, so we can send much more data
            excel_text_truncated = excel_text[:80000]  # Increased from 15000 to 80000
            if len(excel_text) > 80000:
                print(f"WARNING: Excel data truncated from {len(excel_text)} to 80000 characters")
                excel_text_truncated += "\n... (data continues but was truncated due to size limits)"
            
            # Enhance prompt for Excel with emphasis on extracting ALL parts
            excel_prompt = f"""{prompt}

The following is the COMPLETE Excel file data in structured format:
{excel_text_truncated}

CRITICAL INSTRUCTIONS FOR EXCEL EXTRACTION:
- Extract ALL parts from the Excel file - do not skip any rows
- Find columns that contain part numbers (may be labeled as "Part Number", "Part No", "Item", "Code", "Part", "מספר חלק", etc. - including Hebrew column names)
- Find columns that contain prices (may be labeled as "Price", "Cost", "Unit Price", "Amount", "מחיר", "עלות", etc. - including Hebrew column names)
- Find columns that contain quantities (may be labeled as "Qty", "Quantity", "QTY", "כמות", etc. - including Hebrew column names)
- Match part numbers with their corresponding prices and quantities for EVERY row
- Handle Hebrew text in column names and data properly
- Be smart about identifying the correct columns even if they have different names or are in Hebrew
- IMPORTANT: Extract data from ALL rows, not just a sample. The file contains {total_rows} rows - extract pricing for all of them.
- If a row doesn't have a valid part number, skip it, but if it has a part number, you MUST include it in the output
- Return a JSON object with ALL parts found in the Excel file"""
            
            print("Sending Excel data to Gemini for intelligent extraction...")
            request_options = self._get_request_options(timeout=600)  # 10 minutes timeout
            
            response = self.model.generate_content(
                excel_prompt,
                request_options=request_options
            )
            print(f"DEBUG: Gemini response length: {len(response.text)} characters")
            return self._parse_gemini_response(response.text, has_mp_in_filename)
            
        except Exception as e:
            print(f"Error reading Excel file: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    def _extract_from_pdf_with_gemini(self, file_path: str, prompt: str, has_mp_in_filename: bool) -> Dict[str, Dict[str, Any]]:
        """
        Extract data from PDF file using Gemini AI with enhanced text extraction
        
        Args:
            file_path: Path to PDF file
            prompt: Enhanced prompt for Gemini
            has_mp_in_filename: Whether filename contains "-MP-"
            
        Returns:
            Dictionary mapping part_number to pricing info
        """
        try:
            # Extract text for reference
            import PyPDF2
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                num_pages = len(pdf_reader.pages)
                full_text = ""
                for page in pdf_reader.pages:
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            full_text += page_text + "\n"
                    except Exception as e:
                        print(f"Warning: Could not extract text from page: {e}")
                        continue

            print(f"DEBUG: PDF has {num_pages} pages, text length: {len(full_text)} characters")

            # PRIMARY METHOD: Upload PDF directly to Gemini for visual processing
            # PDF table layouts often jumble text extraction — part numbers and prices
            # get separated and reordered. Gemini's native PDF handling sees the actual layout.
            try:
                print("Uploading PDF to Gemini for visual extraction...")
                uploaded_file = genai.upload_file(file_path, mime_type="application/pdf")

                vision_prompt = f"""{prompt}

IMPORTANT: This is a PDF quotation document. Look at the VISUAL LAYOUT of each page.
Each row in the table has a part number (File name column) and its corresponding price (Single price column) on the SAME row.
Match each part number with the price shown on its row — do NOT mix up prices between rows.
Verify your work: unit_cost * qty should approximately equal total_cost for each part.
Extract pricing information from ALL pages."""

                request_options = self._get_request_options(timeout=600)
                response = self.model.generate_content(
                    [vision_prompt, uploaded_file],
                    request_options=request_options,
                    generation_config={"temperature": 0.1}
                )
                print(f"DEBUG: Gemini vision response length: {len(response.text)} characters")
                result = self._parse_gemini_response(response.text, has_mp_in_filename)

                # Clean up uploaded file
                try:
                    genai.delete_file(uploaded_file.name)
                except Exception:
                    pass

                if result and len(result) > 0:
                    print(f"Vision extraction successful: found {len(result)} parts")
                    return result

            except Exception as e:
                if self._is_quota_error(e):
                    # Try all remaining fallback models
                    while self._switch_to_next_model():
                        try:
                            print(f"Retrying PDF upload with {self.model_name}...")
                            uploaded_file = genai.upload_file(file_path, mime_type="application/pdf")
                            request_options = self._get_request_options(timeout=600)
                            response = self.model.generate_content(
                                [vision_prompt, uploaded_file],
                                request_options=request_options,
                                generation_config={"temperature": 0.1}
                            )
                            result = self._parse_gemini_response(response.text, has_mp_in_filename)
                            try:
                                genai.delete_file(uploaded_file.name)
                            except Exception:
                                pass
                            if result and len(result) > 0:
                                print(f"Vision extraction successful with {self.model_name}: found {len(result)} parts")
                                return result
                        except Exception as e2:
                            if self._is_quota_error(e2):
                                print(f"{self.model_name} also quota exceeded, trying next...")
                                continue
                            print(f"Fallback model {self.model_name} failed: {e2}")
                            break
                    print(f"All models exhausted for vision extraction, falling back to text mode")
                else:
                    print(f"PDF upload/vision extraction failed: {e}, falling back to text mode")

            # SECONDARY METHOD: Image-based extraction via pdf2image (if poppler available)
            try:
                from pdf2image import convert_from_path
                pages_to_convert = min(num_pages, 20)
                print(f"Converting {pages_to_convert} PDF pages to images for vision extraction...")
                images = convert_from_path(file_path, first_page=1, last_page=pages_to_convert)

                if images:
                    print(f"Processing {len(images)} pages with Gemini vision...")
                    all_results = {}

                    BATCH_SIZE = 5
                    for batch_start in range(0, len(images), BATCH_SIZE):
                        batch_images = images[batch_start:batch_start + BATCH_SIZE]
                        batch_end = batch_start + len(batch_images)
                        print(f"Processing pages {batch_start + 1}-{batch_end} with Gemini vision...")

                        batch_prompt = f"""{prompt}

These are pages {batch_start + 1} to {batch_end} of the PDF quotation document.
IMPORTANT: Look at each page visually. Each row in the table has a part number (File name column) and its corresponding price (Single price column) on the SAME row.
Match each part number with the price shown on its row — do NOT mix up prices between rows.
Extract pricing information from ALL pages shown."""

                        content_parts = [batch_prompt] + batch_images
                        request_options = self._get_request_options(timeout=600)

                        try:
                            response = self.model.generate_content(
                                content_parts,
                                request_options=request_options,
                                generation_config={"temperature": 0.1}
                            )
                            batch_result = self._parse_gemini_response(response.text, has_mp_in_filename)
                            print(f"  Pages {batch_start + 1}-{batch_end}: found {len(batch_result)} parts")

                            for part_num, data in batch_result.items():
                                if part_num not in all_results:
                                    all_results[part_num] = data
                                else:
                                    if data.get('unit_cost') and not all_results[part_num].get('unit_cost'):
                                        all_results[part_num] = data
                        except Exception as e:
                            print(f"  Warning: Batch pages {batch_start + 1}-{batch_end} failed: {e}")
                            continue

                    if all_results:
                        print(f"Vision extraction successful: found {len(all_results)} parts total")
                        return all_results

            except ImportError:
                print("pdf2image not available, skipping image-based extraction.")
            except Exception as e:
                print(f"Image-based extraction failed: {e}")

            # FALLBACK: Text-based extraction (when vision mode is unavailable)
            if full_text.strip():
                text_prompt = f"""{prompt}

The following is the extracted text from the PDF document.
WARNING: The text extraction may have reordered rows — part numbers and prices might not be in the correct order in this text.
Be extra careful to match each part number with its CORRECT price by looking at quantities and totals for consistency (unit_cost * qty should equal total_cost).

{full_text[:50000]}"""

                print("Processing PDF with Gemini (text mode fallback)...")

                request_options = self._get_request_options(timeout=600)

                try:
                    response = self.model.generate_content(
                        text_prompt,
                        request_options=request_options,
                        generation_config={"temperature": 0.1}
                    )
                    print(f"DEBUG: Gemini response length: {len(response.text)} characters")
                    result = self._parse_gemini_response(response.text, has_mp_in_filename)
                    if result and len(result) > 0:
                        return result
                except Exception as e:
                    error_msg = str(e).lower()
                    error_str = str(e)
                    is_timeout = "timeout" in error_msg or "deadline" in error_msg or "504" in error_str
                    if self._is_quota_error(e):
                        print(f"⚠️ Gemini API quota exceeded on text mode.")
                        while self._switch_to_next_model():
                            try:
                                print(f"Retrying text extraction with {self.model_name}...")
                                request_options = self._get_request_options(timeout=600)
                                response = self.model.generate_content(
                                    text_prompt,
                                    request_options=request_options,
                                    generation_config={"temperature": 0.1}
                                )
                                result = self._parse_gemini_response(response.text, has_mp_in_filename)
                                if result and len(result) > 0:
                                    return result
                            except Exception as e2:
                                if self._is_quota_error(e2):
                                    print(f"{self.model_name} also quota exceeded, trying next...")
                                    continue
                                print(f"Fallback model {self.model_name} text extraction failed: {e2}")
                                break
                    elif is_timeout:
                        print(f"⚠️ Gemini API timeout.")
                    else:
                        print(f"⚠️ Gemini API error: {error_str}")
                    raise

            raise ValueError("Could not extract data from PDF")
                
        except Exception as e:
            print(f"Error extracting from PDF: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    def _parse_gemini_response(self, response_text: str, has_mp_in_filename: bool = False) -> Dict[str, Dict[str, Any]]:
        """
        Parse Gemini AI response to extract pricing data with enhanced parsing
        
        Args:
            response_text: Text response from Gemini AI
            has_mp_in_filename: Whether to prioritize "-MP-" parts
            
        Returns:
            Dictionary mapping part_number to pricing info
        """
        result = {}
        
        # Try to find JSON in the response (look for JSON code blocks or plain JSON)
        json_patterns = [
            r'```json\s*(\{[\s\S]*?\})\s*```',  # JSON code block
            r'```\s*(\{[\s\S]*?\})\s*```',      # Code block without language
            r'(\{[\s\S]*\})',                    # Plain JSON object
        ]
        
        json_str = None
        for pattern in json_patterns:
            json_match = re.search(pattern, response_text, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
                break
        
        if json_str:
            try:
                # Parse JSON with proper encoding for Hebrew (json.loads automatically handles Unicode)
                result = json.loads(json_str)
                
                # Validate and clean the result
                cleaned_result = {}
                for part_num, data in result.items():
                    if isinstance(data, dict):
                        # Filter by "-MP-" if filename contains it
                        if has_mp_in_filename and '-MP-' not in str(part_num):
                            continue
                        
                        cleaned_result[part_num] = {
                            'unit_cost': float(data.get('unit_cost', 0)) if data.get('unit_cost') is not None else None,
                            'order_qty': int(data.get('order_qty', 0)) if data.get('order_qty') is not None else None,
                            'total_cost': float(data.get('total_cost', 0)) if data.get('total_cost') is not None else None
                        }
                    else:
                        print(f"Warning: Invalid data format for part {part_num}")
                
                cleaned_result = self._post_process_extracted_parts(cleaned_result)
                return cleaned_result

            except json.JSONDecodeError as e:
                print(f"Error parsing JSON from Gemini response: {e}")
                print(f"JSON string (first 500 chars): {json_str[:500]}")
        
        # Try alternative parsing if JSON extraction failed
        # Look for part numbers and prices in the text
        print("JSON parsing failed, trying alternative text parsing...")
        
        # Enhanced part number patterns (generic + specific)
        part_patterns = [
            r'([A-Z0-9-]+-MP-[A-Z0-9-]+)',       # Standard -MP- format
            r'([A-Z0-9-]+-AS-[A-Z0-9-]+)',       # Assembly format
            r'(\d{3}-[A-Z]{2,3}-\d{4,6})',       # NNN-XX-NNNNN format
            r'([A-Z]{2,5}[-\s]?\d{3,7})',        # ABC12345 or ABC-12345 format
            r'(DIN\s*\d{3,5})',                   # DIN standards
            r'(ISO\s*\d{3,5})',                   # ISO standards
            r'([A-Z0-9][A-Z0-9._-]{4,}[A-Z0-9])', # Generic alphanumeric codes (min 6 chars)
        ]
        
        # Try each pattern
        parts = []
        for pattern in part_patterns:
            found_parts = re.findall(pattern, response_text, re.IGNORECASE)
            parts.extend(found_parts)
        
        # Remove duplicates while preserving order
        seen = set()
        unique_parts = []
        for part in parts:
            if part not in seen:
                seen.add(part)
                unique_parts.append(part)
        
        # Enhanced price patterns
        price_patterns = [
            r'[\$£€₪]?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)',  # With thousands separators
            r'[\$£€₪]?\s*(\d+[.,]\d{2})',                        # Standard decimal
            r'unit[_\s]?cost["\']?\s*[:=]\s*[\$£€₪]?\s*(\d+[.,]?\d*)',  # Labeled unit cost
            r'price["\']?\s*[:=]\s*[\$£€₪]?\s*(\d+[.,]?\d*)',    # Labeled price
        ]
        
        prices = []
        for pattern in price_patterns:
            found_prices = re.findall(pattern, response_text, re.IGNORECASE)
            prices.extend(found_prices)
        
        if unique_parts:
            print(f"Found {len(unique_parts)} part numbers using alternative parsing")
            for i, part_num in enumerate(unique_parts):
                # Filter by "-MP-" if filename contains it
                if has_mp_in_filename and '-MP-' not in part_num:
                    continue
                
                # Try to find associated price (look in nearby text)
                part_index = response_text.find(part_num)
                if part_index >= 0:
                    # Look for price near this part number (within 200 characters)
                    nearby_text = response_text[max(0, part_index-100):part_index+300]
                    price_match = re.search(r'[\$£€₪]?\s*(\d+[.,]\d{2,})', nearby_text)
                    if price_match:
                        try:
                            price_str = price_match.group(1).replace(',', '.')
                            # Handle cases where comma is thousands separator
                            if ',' in price_match.group(1) and '.' in price_match.group(1):
                                price_str = price_match.group(1).replace(',', '')
                            price = float(price_str)
                            result[part_num] = {
                                'unit_cost': price,
                                'order_qty': None,
                                'total_cost': None
                            }
                        except ValueError:
                            pass
                    elif i < len(prices):
                        # Fallback: use price from list
                        try:
                            price_str = prices[i].replace(',', '.')
                            if ',' in prices[i] and '.' in prices[i]:
                                price_str = prices[i].replace(',', '')
                            price = float(price_str)
                            result[part_num] = {
                                'unit_cost': price,
                                'order_qty': None,
                                'total_cost': None
                            }
                        except (ValueError, IndexError):
                            pass
        
        return result
    
    def _extract_from_excel_fallback(self, file_path: str, vendor: Optional[str] = None, has_mp_in_filename: bool = False) -> Dict[str, Dict[str, Any]]:
        """
        Fallback Excel extraction method (simple pattern matching)
        
        Args:
            file_path: Path to Excel file
            vendor: Vendor name (not used in simple extraction)
            has_mp_in_filename: Whether filename contains "-MP-"
            
        Returns:
            Dictionary mapping part_number to pricing info
        """
        if not EXCEL_AVAILABLE:
            return {}
        
        try:
            df = pd.read_excel(file_path, engine='openpyxl')
            result = {}
            
            # Try to find part number and price columns
            part_col = None
            price_col = None
            qty_col = None
            
            # Common column name patterns
            part_patterns = ['part', 'number', 'item', 'code', 'sku']
            price_patterns = ['price', 'cost', 'amount', 'unit']
            qty_patterns = ['qty', 'quantity', 'qnty']
            
            for col in df.columns:
                col_lower = str(col).lower()
                if not part_col and any(pattern in col_lower for pattern in part_patterns):
                    part_col = col
                if not price_col and any(pattern in col_lower for pattern in price_patterns):
                    price_col = col
                if not qty_col and any(pattern in col_lower for pattern in qty_patterns):
                    qty_col = col
            
            if part_col and price_col:
                for _, row in df.iterrows():
                    part_num = str(row[part_col]).strip() if pd.notna(row[part_col]) else None
                    if not part_num or part_num == 'nan':
                        continue
                    
                    # Filter by "-MP-" if filename contains it
                    if has_mp_in_filename and '-MP-' not in part_num:
                        continue
                    
                    # Check if part number matches pattern
                    if not re.search(r'[A-Z0-9-]+-[A-Z]{2}-[A-Z0-9-]+', part_num, re.IGNORECASE):
                        continue
                    
                    try:
                        price = float(row[price_col]) if pd.notna(row[price_col]) else None
                        qty = int(row[qty_col]) if qty_col and pd.notna(row[qty_col]) else 1
                        
                        if price:
                            result[part_num] = {
                                'unit_cost': price,
                                'order_qty': qty,
                                'total_cost': price * qty
                            }
                    except (ValueError, TypeError):
                        continue
            
            return result
            
        except Exception as e:
            print(f"Error in Excel fallback extraction: {e}")
            return {}
    
    def _extract_with_pdf_methods(self, file_path: str, vendor: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        """
        Fallback to simple PDF text extraction
        
        Args:
            file_path: Path to PDF file
            vendor: Vendor name (not used in simple extraction)
            
        Returns:
            Dictionary mapping part_number to pricing info
        """
        try:
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                full_text = ""
                for page in pdf_reader.pages:
                    try:
                        full_text += page.extract_text() + "\n"
                    except:
                        continue
        except Exception as e:
            print(f"Error reading PDF: {e}")
            return {}
        
        # Simple extraction: look for part numbers and prices
        result = {}
        
        # Pattern for part numbers (XXX-MP-XXXXX format)
        part_pattern = r'([A-Z0-9-]+-MP-[A-Z0-9-]+)'
        # Pattern for prices (various formats)
        price_pattern = r'[\$£€₪]?\s*(\d+[.,]\d{2})'
        # Pattern for quantities (look for numbers before prices)
        qty_pattern = r'(\d+)\s*[\$£€₪]?\s*\d+[.,]\d{2}'
        
        # Find all part numbers, prices, and quantities
        parts = re.findall(part_pattern, full_text, re.IGNORECASE)
        prices = re.findall(price_pattern, full_text)
        quantities = re.findall(qty_pattern, full_text)
        
        print(f"Found {len(parts)} part numbers, {len(prices)} prices, and {len(quantities)} quantities in PDF")
        
        # Match parts with prices and quantities
        for i, part_num in enumerate(parts):
            if i < len(prices):
                try:
                    total_price = float(prices[i].replace(',', '.'))
                    # Try to get quantity for this part
                    qty = 1  # Default quantity
                    if i < len(quantities):
                        qty = int(quantities[i])
                    
                    # Calculate unit price
                    unit_price = total_price / qty if qty > 0 else total_price
                    
                    result[part_num] = {
                        'unit_cost': unit_price,
                        'order_qty': qty,
                        'total_cost': total_price
                    }
                    print(f"Extracted: {part_num} = ${unit_price:.2f} unit (${total_price:.2f} total for qty {qty})")
                except ValueError:
                    print(f"Could not parse price: {prices[i]}")
        
        return result
    
    def match_parts_intelligently(self, target_parts: List[Dict[str, Any]], extracted_parts: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Use AI to intelligently match target parts with extracted parts from quotation
        
        Args:
            target_parts: List of parts to match (from user selection)
                Each dict should have 'part_number' and optionally 'revision'
            extracted_parts: Dictionary of extracted parts from quotation
                Format: {"part_number": {"unit_cost": float, ...}, ...}
        
        Returns:
            Dictionary mapping target part_number to matched pricing info
        """
        # Validate inputs
        if not target_parts:
            print("No target parts provided for matching")
            return {}
        
        if not extracted_parts:
            print("No extracted parts provided for matching - cannot match")
            return {}
        
        # Use AI matching when model is available, fall back to simple matching otherwise
        use_ai = True

        if not self.model or not use_ai:
            # Use enhanced simple matching (no AI required, no credits needed)
            print(f"Matching {len(target_parts)} target parts with {len(extracted_parts)} extracted parts using enhanced pattern matching (no AI)...")
            return self._simple_part_matching(target_parts, extracted_parts)
        
        print(f"Matching {len(target_parts)} target parts with {len(extracted_parts)} extracted parts using AI...")
        
        # Process in batches to avoid timeout (max 20 parts per batch for better reliability)
        BATCH_SIZE = 20
        all_matched_results = {}
        
        # Split target parts into batches
        for i in range(0, len(target_parts), BATCH_SIZE):
            batch = target_parts[i:i+BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1
            total_batches = (len(target_parts) + BATCH_SIZE - 1) // BATCH_SIZE
            
            print(f"Processing batch {batch_num}/{total_batches} ({len(batch)} parts)...")
            
            try:
                batch_results = self._match_batch(batch, extracted_parts)
                all_matched_results.update(batch_results)
                print(f"Batch {batch_num} completed: {len(batch_results)} matches found")
            except Exception as e:
                print(f"Batch {batch_num} failed: {e}, continuing with next batch...")
                continue
        
        print(f"AI matching completed: {len(all_matched_results)} total matches out of {len(target_parts)} parts")
        return all_matched_results
    
    def _match_batch(self, target_parts: List[Dict[str, Any]], extracted_parts: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Match a batch of target parts with extracted parts
        
        Args:
            target_parts: Batch of parts to match (max 30)
            extracted_parts: Dictionary of extracted parts from quotation
        
        Returns:
            Dictionary mapping target part_number to matched pricing info
        """
        # Prepare data for AI matching
        target_parts_str = json.dumps(target_parts, ensure_ascii=False, indent=2)
        extracted_parts_str = json.dumps(extracted_parts, ensure_ascii=False, indent=2)
        
        matching_prompt = f"""You are an expert at matching parts intelligently. Match the target parts (parts the user wants to find prices for) with the extracted parts (parts found in the quotation document).

TARGET PARTS (parts to match):
{target_parts_str}

EXTRACTED PARTS (parts found in quotation):
{extracted_parts_str}

CRITICAL REVISION RULE: When comparing part numbers, ALWAYS ignore revision suffixes (REV02, Rev.A, R02, etc.). Match by BASE part number only. For example, "021-MP-03476 REV02" and "021-MP-03476" are the SAME part.

CRITICAL MATCHING INSTRUCTIONS - Use MULTIPLE matching strategies:

STRATEGY 1: EXACT/FULL NAME MATCHING
- First try exact match on base part number (ignore revisions): "021-MP-03476" matches "021-MP-03476"
- "021-MP-03476 REV02" matches "021-MP-03476" or "021-MP-03476 REV01" — revisions are irrelevant
- Ignore spaces, case differences, Hebrew text

STRATEGY 2: PARTIAL MATCHING BY KEY CHARACTERISTICS
If exact match fails, analyze the part name/description for key characteristics and match based on:
- SIZE SPECIFICATIONS: Extract and match size patterns like:
  * "M5x10", "M5 x 10", "M5×10" should all match
  * "M2 x 6", "M2x6", "M2X6" should match
  * "Ø01x10", "Ø1x10", "1x10" should match
  * "6x3", "6 x 3", "6X3" should match
- PART TYPE KEYWORDS: Match based on part type:
  * "Socket Head Cap Screw" matches parts with "Socket", "Cap Screw", "DIN 912"
  * "Flat Head Screw" matches "Flat Head", "DIN 7991"
  * "Pin" matches "Pin", "Dowel", "Ø"
  * "Magnet" matches "Magnet", "Magnetic"
  * "Washer" matches "Washer", "DIN 127"
- STANDARDS: Match DIN/ISO standards:
  * "DIN 912" matches "DIN912", "DIN-912", parts with DIN 912
  * "ISO 7380" matches "ISO7380", "ISO-7380"
- DIMENSIONS: Extract and match dimensions:
  * "M2 x 6" should match "M2x6", "M2X6", "2x6", "M2-6"
  * "Ø03x08" should match "3x8", "Ø3x8", "3X8"
- VENDOR PART NUMBERS: If target part has a vendor PN or description, try to find it in extracted parts' descriptions or alternate names

STRATEGY 3: CONTEXTUAL MATCHING
- Look at the full description/name, not just the part number
- A target part "Socket Head Cap Screw DIN 912 - M2 x 6" should match an extracted part that has:
  * The size "M2x6" or "M2 x 6" or "M2X6" in its name/description
  * Keywords like "Socket", "Cap Screw", "DIN 912" in its name/description
- A target part "Pin Ø01x10 (h8)" should match an extracted part with "1x10", "Ø1x10", "Pin", or similar dimensions
- Be flexible with formatting: "M5x10" = "M5 x 10" = "M5X10" = "M5-10"

MATCHING PRIORITY:
1. Exact part number match (highest confidence: "exact")
2. Base part number match (ignoring revision) (confidence: "close")
3. Size + Type match (e.g., "M2x6" + "Socket Head") (confidence: "close")
4. Size match only (e.g., "M2x6" matches) (confidence: "partial")
5. Type match only (e.g., both are "Socket Head Cap Screw") (confidence: "partial")
6. No match (confidence: "none")

IMPORTANT:
- ALWAYS try to find a match - be creative and flexible
- If you find a size match (like M5x10), that's a strong indicator even if other text differs
- Extract dimensions from both target and extracted parts and compare them
- Consider that extracted parts might have vendor part numbers or descriptions that contain the key information
- Return "partial" confidence if you find a reasonable match based on size/type, even if names are different
- Only return "none" if you truly cannot find any reasonable match

CRITICAL: You MUST return ONLY valid JSON. Do not include any explanatory text, markdown formatting, or code blocks. Return ONLY the JSON object.

Return a JSON object mapping each target part_number to the matched pricing information:
{{
  "target_part_number": {{
    "matched_part_number": "extracted_part_number_that_matched",
    "unit_cost": <float or null>,
    "order_qty": <int or null>,
    "total_cost": <float or null>,
    "match_confidence": "exact" | "close" | "partial" | "none",
    "match_reason": "brief explanation of why this match was made"
  }}
}}

For each target part:
- matched_part_number: The extracted part number that was matched (or null if no match)
- unit_cost, order_qty, total_cost: From the matched extracted part (or null if no match)
- match_confidence: "exact" (perfect match), "close" (base part number matches), "partial" (size/type match), "none" (no match)
- match_reason: Brief explanation like "Exact part number match" or "Matched by size M2x6 and Socket Head type" or "No matching size/type found"

IMPORTANT: Return ONLY the JSON object. Do not include any text before or after the JSON. Start with {{ and end with }}.
"""
        
        try:
            # Use timeout for batch processing (longer timeout for matching)
            request_options = self._get_request_options(timeout=300)  # 5 minutes for matching
            
            response = self.model.generate_content(
                matching_prompt,
                request_options=request_options,
                generation_config={
                    "temperature": 0.1,  # Lower temperature for more consistent results
                }
            )
            print(f"DEBUG: AI matching response length: {len(response.text)} characters")
            
            # Parse the response - try multiple strategies to extract JSON
            response_text = response.text
            
            # Strategy 1: Look for JSON code blocks
            json_patterns = [
                r'```json\s*(\{[\s\S]*?\})\s*```',  # JSON code block
                r'```\s*(\{[\s\S]*?\})\s*```',       # Code block without language
            ]
            
            ai_matches = None
            json_str = None
            
            # First try code blocks
            for pattern in json_patterns:
                json_match = re.search(pattern, response_text, re.DOTALL)
                if json_match:
                    json_str = json_match.group(1) if len(json_match.groups()) > 0 else json_match.group(0)
                    try:
                        ai_matches = json.loads(json_str)
                        print(f"Successfully parsed JSON from code block")
                        break
                    except json.JSONDecodeError as e:
                        print(f"JSON parse failed from code block: {e}")
                        continue
            
            # Strategy 2: Try to find the largest JSON object that matches our expected structure
            if not ai_matches:
                # Look for JSON objects that contain our target part numbers
                # First, get a list of target part numbers to look for
                target_part_nums = [part.get('part_number', '') for part in target_parts]
                
                # Try to find JSON objects that contain at least one target part number
                json_objects = re.finditer(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response_text, re.DOTALL)
                candidates = []
                
                for match in json_objects:
                    try:
                        test_json = json.loads(match.group(0))
                        if isinstance(test_json, dict) and len(test_json) > 0:
                            # Check if any keys match target part numbers or if structure matches
                            has_target_part = any(key in target_part_nums for key in test_json.keys())
                            sample_key = next(iter(test_json.keys()))
                            sample_value = test_json[sample_key]
                            has_expected_structure = isinstance(sample_value, dict) and ('unit_cost' in sample_value or 'match_confidence' in sample_value or 'matched_part_number' in sample_value)
                            
                            if has_target_part or has_expected_structure:
                                size = len(match.group(0))
                                candidates.append((size, test_json))
                    except json.JSONDecodeError:
                        continue
                
                # Sort by size (largest first) and take the best candidate
                if candidates:
                    candidates.sort(reverse=True, key=lambda x: x[0])
                    ai_matches = candidates[0][1]
                    print(f"Successfully parsed JSON from largest valid object ({candidates[0][0]} chars, {len(ai_matches)} entries)")
            
            # Strategy 3: Try to extract and fix common JSON issues
            if not ai_matches:
                # Try to find JSON and fix common issues
                json_match = re.search(r'\{[\s\S]*\}', response_text, re.DOTALL)
                if json_match:
                    json_str = json_match.group(0)
                    # Try to fix common issues
                    # Remove trailing commas before closing braces
                    json_str = re.sub(r',\s*}', '}', json_str)
                    json_str = re.sub(r',\s*]', ']', json_str)
                    # Fix single quotes to double quotes (basic)
                    json_str = json_str.replace("'", '"')
                    try:
                        ai_matches = json.loads(json_str)
                        print(f"Successfully parsed JSON after fixing common issues")
                    except json.JSONDecodeError as e:
                        print(f"JSON parse failed even after fixing: {e}")
                        print(f"JSON preview (first 500 chars): {json_str[:500]}")
            
            if ai_matches:
                
                # Convert AI matches to the expected format
                matched_results = {}
                for target_part in target_parts:
                    target_part_num = target_part.get('part_number', '')
                    if target_part_num in ai_matches:
                        match_info = ai_matches[target_part_num]
                        # Accept matches with confidence: exact, close, or partial (but not none)
                        match_confidence = match_info.get('match_confidence', 'none')
                        if match_confidence != 'none' and match_info.get('unit_cost') is not None:
                            matched_results[target_part_num] = {
                                'unit_cost': match_info.get('unit_cost'),
                                'order_qty': match_info.get('order_qty'),
                                'total_cost': match_info.get('total_cost'),
                                'matched_extracted_part': match_info.get('matched_part_number'),
                                'match_confidence': match_confidence,
                                'match_reason': match_info.get('match_reason', '')
                            }
                            if match_confidence == 'partial':
                                print(f"Partial match for {target_part_num}: {match_info.get('match_reason', '')}")
                        else:
                            if match_confidence == 'none':
                                print(f"No match found for {target_part_num}: {match_info.get('match_reason', 'No matching characteristics found')}")
                            else:
                                print(f"No price data for {target_part_num} (confidence: {match_confidence})")
                    else:
                        print(f"Target part {target_part_num} not in AI response")
                
                print(f"AI matching successful: matched {len(matched_results)} out of {len(target_parts)} parts")
                return matched_results
            else:
                print("Could not parse AI matching response, falling back to simple matching")
                return self._simple_part_matching(target_parts, extracted_parts)
                
        except Exception as e:
            error_msg = str(e).lower()
            if self._is_quota_error(e):
                # Try all remaining fallback models
                while self._switch_to_next_model():
                    try:
                        print(f"Retrying AI matching with {self.model_name}...")
                        request_options = self._get_request_options(timeout=300)
                        response = self.model.generate_content(
                            matching_prompt,
                            request_options=request_options,
                            generation_config={"temperature": 0.1}
                        )
                        response_text = response.text
                        json_match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```', response_text, re.DOTALL)
                        if not json_match:
                            json_match = re.search(r'\{[\s\S]*\}', response_text, re.DOTALL)
                        if json_match:
                            json_str = json_match.group(1) if json_match.lastindex else json_match.group(0)
                            json_str = re.sub(r',\s*}', '}', json_str)
                            ai_matches = json.loads(json_str)
                            matched_results = {}
                            for target_part in target_parts:
                                target_part_num = target_part.get('part_number', '')
                                if target_part_num in ai_matches:
                                    match_info = ai_matches[target_part_num]
                                    match_confidence = match_info.get('match_confidence', 'none')
                                    if match_confidence != 'none' and match_info.get('unit_cost') is not None:
                                        matched_results[target_part_num] = {
                                            'unit_cost': match_info.get('unit_cost'),
                                            'order_qty': match_info.get('order_qty'),
                                            'total_cost': match_info.get('total_cost'),
                                            'matched_extracted_part': match_info.get('matched_part_number'),
                                            'match_confidence': match_confidence,
                                            'match_reason': match_info.get('match_reason', '')
                                        }
                            if matched_results:
                                print(f"{self.model_name} matching successful: {len(matched_results)} matches")
                                return matched_results
                    except Exception as e2:
                        if self._is_quota_error(e2):
                            print(f"{self.model_name} also quota exceeded, trying next...")
                            continue
                        print(f"Fallback model {self.model_name} matching failed: {e2}")
                        break
                print("All models exhausted for AI matching, falling back to simple matching")
            elif "timeout" in error_msg or "deadline" in error_msg or "504" in error_msg:
                print(f"AI matching timed out for batch: {e}, falling back to simple matching")
            else:
                print(f"AI matching failed for batch: {e}, falling back to simple matching")
                import traceback
                traceback.print_exc()
            return self._simple_part_matching(target_parts, extracted_parts)

    def _strip_revision_from_key(self, pn: str) -> str:
        """Strip revision suffixes from a part number key."""
        pn = pn.strip()
        # REV02, Rev.A, REV 02, -REV02, _REV02, Rev.02
        pn = re.sub(r'[\s_-]*[Rr][Ee][Vv]\.?\s*[A-Za-z0-9]+\s*$', '', pn).strip()
        # Trailing " R02", " RA" pattern (R + letter/digit at end, preceded by separator)
        pn = re.sub(r'[\s_-]+R[A-Z]?\d+\s*$', '', pn, flags=re.IGNORECASE).strip()
        return pn

    def _post_process_extracted_parts(self, extracted: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Clean extracted parts: strip revisions from keys, remove noise entries,
        merge duplicates (keep entry with most complete data).
        """
        cleaned = {}

        # Noise patterns to skip (totals, tax, shipping, etc.)
        noise_patterns = [
            r'^\s*total', r'^\s*sub\s*total', r'^\s*grand', r'^\s*shipping',
            r'^\s*tax', r'^\s*vat', r'^\s*discount', r'^\s*delivery',
            r'^\s*מע"מ',   # Hebrew VAT
            r'^\s*סה"כ',   # Hebrew total
            r'^\s*הנחה',   # Hebrew discount
            r'^\s*משלוח',  # Hebrew shipping
            r'^\d{1,2}$',  # Just a row number (1-2 digits only)
        ]

        original_count = len(extracted)

        for part_num, data in extracted.items():
            # Skip entries without any pricing
            if data.get('unit_cost') is None and data.get('total_cost') is None:
                continue

            # Skip noise entries
            skip = False
            for pattern in noise_patterns:
                if re.match(pattern, part_num.strip(), re.IGNORECASE):
                    skip = True
                    break
            if skip:
                print(f"Post-processing: skipping noise entry '{part_num}'")
                continue

            # Strip revision from key (but preserve -MOLD/-TOOLING suffixes)
            if part_num.upper().endswith(('-MOLD', '-TOOLING', '-SETUP')):
                # Keep mold/tooling entries as-is, just strip revision from the base part portion
                suffix = part_num[part_num.upper().rfind('-MOLD'):] if '-MOLD' in part_num.upper() else \
                         part_num[part_num.upper().rfind('-TOOLING'):] if '-TOOLING' in part_num.upper() else \
                         part_num[part_num.upper().rfind('-SETUP'):]
                base_part = part_num[:len(part_num) - len(suffix)]
                base = self._strip_revision_from_key(base_part) + suffix
            else:
                base = self._strip_revision_from_key(part_num)
            if base != part_num:
                print(f"Post-processing: stripped revision '{part_num}' -> '{base}'")

            # Merge duplicates: keep entry with more complete data
            if base in cleaned:
                existing = cleaned[base]
                # Prefer entry with unit_cost over one without
                if data.get('unit_cost') and not existing.get('unit_cost'):
                    cleaned[base] = data
                # If both have unit_cost, prefer higher revision (later entry in document)
                elif data.get('unit_cost') and existing.get('unit_cost'):
                    cleaned[base] = data  # Later entry likely has newer revision pricing
            else:
                cleaned[base] = data

        if len(cleaned) != original_count:
            print(f"Post-processing: {original_count} extracted parts -> {len(cleaned)} after cleanup")

        return cleaned

    def _simple_part_matching(self, target_parts: List[Dict[str, Any]], extracted_parts: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Simple fallback matching without AI
        
        Args:
            target_parts: List of parts to match
            extracted_parts: Dictionary of extracted parts
        
        Returns:
            Dictionary mapping target part_number to matched pricing info
        """
        if not extracted_parts:
            print("No extracted parts provided for simple matching")
            return {}
        
        matched_results = {}

        def strip_revision(pn):
            """Strip revision suffixes: REV02, Rev.A, REV 02, -REV02, _REV02, R02, etc."""
            pn = pn.strip()
            # Primary: explicit REV marker (REV02, Rev.A, REV 02, -REV02, _REV02)
            pn = re.sub(r'[\s_-]*REV\.?\s*[A-Za-z0-9]+\s*$', '', pn, flags=re.IGNORECASE).strip()
            # Secondary: " R02" or " RA2" style (R + optional letter + digits, preceded by separator)
            pn = re.sub(r'[\s_-]+R[A-Z]?\d+\s*$', '', pn, flags=re.IGNORECASE).strip()
            return pn

        def normalize_pn(pn):
            """Normalize part number for fuzzy comparison: remove spaces, dashes, dots, underscores and uppercase."""
            return re.sub(r'[\s\-_./]+', '', pn).upper()

        for target_part in target_parts:
            target_part_num = target_part.get('part_number', '').strip()
            target_revision = target_part.get('revision', '').strip()

            # Try exact match first
            if target_part_num in extracted_parts:
                matched_results[target_part_num] = extracted_parts[target_part_num].copy()
                matched_results[target_part_num]['match_confidence'] = 'exact'
                matched_results[target_part_num]['matched_extracted_part'] = target_part_num
                continue

            # Try matching without revision on target
            base_part_num = strip_revision(target_part_num)
            if base_part_num != target_part_num and base_part_num in extracted_parts:
                matched_results[target_part_num] = extracted_parts[base_part_num].copy()
                matched_results[target_part_num]['match_confidence'] = 'close'
                matched_results[target_part_num]['matched_extracted_part'] = base_part_num
                continue

            # Try case-insensitive and revision-stripped matching against all extracted parts
            found = False
            for extracted_part_num, extracted_data in extracted_parts.items():
                # Case-insensitive exact
                if target_part_num.upper() == extracted_part_num.upper():
                    matched_results[target_part_num] = extracted_data.copy()
                    matched_results[target_part_num]['match_confidence'] = 'close'
                    matched_results[target_part_num]['matched_extracted_part'] = extracted_part_num
                    found = True
                    break

                # Strip revision from extracted part number too
                extracted_base = strip_revision(extracted_part_num)
                if base_part_num.upper() == extracted_base.upper():
                    matched_results[target_part_num] = extracted_data.copy()
                    matched_results[target_part_num]['match_confidence'] = 'close'
                    matched_results[target_part_num]['matched_extracted_part'] = extracted_part_num
                    found = True
                    break

                # Normalized matching (ignore dashes, spaces, dots, case)
                if normalize_pn(base_part_num) == normalize_pn(extracted_base):
                    matched_results[target_part_num] = extracted_data.copy()
                    matched_results[target_part_num]['match_confidence'] = 'close'
                    matched_results[target_part_num]['match_reason'] = f'Normalized match: "{base_part_num}" ~ "{extracted_base}"'
                    matched_results[target_part_num]['matched_extracted_part'] = extracted_part_num
                    found = True
                    break

                # Substring/contains matching: extracted PN contains target base, or vice versa
                if len(base_part_num) >= 6:
                    if base_part_num.upper() in extracted_part_num.upper():
                        matched_results[target_part_num] = extracted_data.copy()
                        matched_results[target_part_num]['match_confidence'] = 'close'
                        matched_results[target_part_num]['match_reason'] = f'Target "{base_part_num}" found in extracted "{extracted_part_num}"'
                        matched_results[target_part_num]['matched_extracted_part'] = extracted_part_num
                        found = True
                        break
                    if extracted_base.upper() in target_part_num.upper() and len(extracted_base) >= 6:
                        matched_results[target_part_num] = extracted_data.copy()
                        matched_results[target_part_num]['match_confidence'] = 'close'
                        matched_results[target_part_num]['match_reason'] = f'Extracted "{extracted_base}" found in target "{target_part_num}"'
                        matched_results[target_part_num]['matched_extracted_part'] = extracted_part_num
                        found = True
                        break

                # Normalized substring matching (strip separators then check containment)
                norm_target = normalize_pn(base_part_num)
                norm_extracted = normalize_pn(extracted_base)
                if len(norm_target) >= 6:
                    if norm_target in norm_extracted or (len(norm_extracted) >= 6 and norm_extracted in norm_target):
                        matched_results[target_part_num] = extracted_data.copy()
                        matched_results[target_part_num]['match_confidence'] = 'close'
                        matched_results[target_part_num]['match_reason'] = f'Normalized substring match: "{base_part_num}" ~ "{extracted_base}"'
                        matched_results[target_part_num]['matched_extracted_part'] = extracted_part_num
                        found = True
                        break

            if found:
                continue

            # Strategy 5: Extract size patterns and match (e.g., M2x6, M3x8, etc.)
            target_description = target_part.get('description', '').strip()
            size_patterns = [
                r'M(\d+(?:\.\d+)?)\s*x\s*(\d+)',  # M2x6, M2.5x10
                r'M(\d+(?:\.\d+)?)\s*X\s*(\d+)',  # M2X6
                r'Ø(\d+(?:\.\d+)?)\s*x\s*(\d+)',  # Ø02x06
                r'(\d+(?:\.\d+)?)\s*x\s*(\d+)',   # 2x6, 3x8
            ]

            target_sizes = []
            search_text = target_part_num + " " + target_description
            for pattern in size_patterns:
                matches = re.findall(pattern, search_text, re.IGNORECASE)
                if matches:
                    for match in matches:
                        try:
                            size1 = str(float(match[0])) if '.' in match[0] else str(int(match[0]))
                            size2 = str(int(match[1]))
                            target_sizes.append((size1, size2))
                        except:
                            continue

            # Try to match by size
            if target_sizes:
                for extracted_part_num, extracted_data in extracted_parts.items():
                    for size1, size2 in target_sizes:
                        patterns_to_try = [
                            f"M{size1}x{size2}", f"M{size1} x {size2}", f"M{size1}X{size2}",
                            f"Ø{size1}x{size2}", f"{size1}x{size2}",
                        ]
                        for pattern in patterns_to_try:
                            if re.search(re.escape(pattern), extracted_part_num, re.IGNORECASE):
                                matched_results[target_part_num] = extracted_data.copy()
                                matched_results[target_part_num]['match_confidence'] = 'partial'
                                matched_results[target_part_num]['match_reason'] = f'Matched by size {size1}x{size2}'
                                matched_results[target_part_num]['matched_extracted_part'] = extracted_part_num
                                break
                        if target_part_num in matched_results:
                            break
                    if target_part_num in matched_results:
                        break
        
        return matched_results


    def extract_metadata(self, file_path: str) -> Dict[str, Optional[str]]:
        """
        Extract quotation-level metadata (contact name, date, payment terms, etc.)
        from a quotation file using Gemini AI.

        Args:
            file_path: Path to quotation PDF, image, or Excel file

        Returns:
            Dictionary with metadata fields (all optional/nullable):
            {
                "contact_name": str or None,
                "quotation_number": str or None,
                "quotation_date": str or None,
                "lead_time": str or None,
                "payment_terms": str or None
            }
        """
        if not self.model:
            return {}

        if not os.path.exists(file_path):
            return {}

        file_ext = os.path.splitext(file_path)[1].lower()

        prompt = """Analyze this quotation document and extract the following metadata.
Return ONLY a JSON object with these fields (use null if not found):

{
  "contact_name": "Name of the person who sent/signed the quotation",
  "quotation_number": "The quotation/quote reference number",
  "quotation_date": "Date on the quotation (as written in the document)",
  "lead_time": "Delivery time or lead time mentioned (e.g., '4 weeks', '30 days')",
  "payment_terms": "Payment terms mentioned (e.g., 'Net 30', '50% advance')"
}

IMPORTANT:
- Extract exactly what is written in the document
- Handle Hebrew text properly
- Return ONLY the JSON object, no other text
- Use null for any field you cannot find"""

        try:
            request_options = self._get_request_options(timeout=120)

            if file_ext in ['.xlsx', '.xls'] and EXCEL_AVAILABLE:
                df = pd.read_excel(file_path, engine='openpyxl', nrows=20)
                text = df.to_string()[:5000]
                response = self.model.generate_content(
                    f"{prompt}\n\nDocument content:\n{text}",
                    request_options=request_options
                )
            elif file_ext == '.pdf':
                with open(file_path, 'rb') as f:
                    pdf_reader = PyPDF2.PdfReader(f)
                    text = ""
                    for page in pdf_reader.pages[:3]:
                        try:
                            text += page.extract_text() + "\n"
                        except:
                            continue
                if text.strip():
                    response = self.model.generate_content(
                        f"{prompt}\n\nDocument content:\n{text[:5000]}",
                        request_options=request_options
                    )
                else:
                    return {}
            elif file_ext in ['.png', '.jpg', '.jpeg']:
                img = Image.open(file_path)
                response = self.model.generate_content(
                    [prompt, img],
                    request_options=request_options
                )
            else:
                return {}

            # Parse response
            response_text = response.text
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                metadata = json.loads(json_match.group(0))
                # Clean: only keep expected keys, convert empty strings to None
                valid_keys = {'contact_name', 'quotation_number', 'quotation_date', 'lead_time', 'payment_terms'}
                cleaned = {}
                for key in valid_keys:
                    val = metadata.get(key)
                    cleaned[key] = val if val and str(val).strip() and str(val).lower() != 'null' else None
                return cleaned

            return {}

        except Exception as e:
            print(f"Error extracting quotation metadata: {e}")
            return {}

    def classify_non_parts(self, unmatched_items: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Use AI to classify unmatched extracted items as non-parts (mold, tooling, assembly, labor, etc.)
        IMPORTANT: Skip items that look like regular part numbers (could be matching failures)

        Args:
            unmatched_items: Dictionary of unmatched items from quotation extraction
                Format: {"item_name": {"unit_cost": float, "order_qty": int, "total_cost": float}, ...}

        Returns:
            Dictionary mapping item names to classification info:
            {
                "item_name": {
                    "is_non_part": bool,
                    "cost_type": str,  # "Mold", "Tooling", "Assembly", "Labor", "Delivery", "Other"
                    "base_part_number": str,  # original item name or extracted base number
                    "unit_cost": float,
                    "quantity": int,
                    "total_cost": float,
                    "description": str,
                    "confidence": str  # "high", "medium", "low"
                }
            }
        """
        if not unmatched_items or not self.model:
            return {}

        # Pre-filter: Skip items that look like regular part numbers
        # Regular parts usually have pattern: XXX-YY-NNNNN or similar
        # We only want to classify items that have non-part indicators
        filtered_items = {}
        for item_name, item_data in unmatched_items.items():
            item_upper = item_name.upper()

            # Skip if it looks like a plain part number (MP, AS, EL, etc. parts)
            # But keep items with cost-related suffixes or descriptions
            if any(suffix in item_upper for suffix in ['-MOLD', '-TOOLING', '-SETUP', '-LABOR', '-DELIVERY', '-SHIPPING', 'MOLD', 'TOOL', 'LABOR', 'DELIVERY', 'SHIPPING', 'ASSEMBLY FEE', 'SERVICE']):
                filtered_items[item_name] = item_data
            # Also skip plain part numbers that match the standard pattern (XXX-YY-NNNNN)
            elif '-MP-' in item_upper or '-AS-' in item_upper or '-EL-' in item_upper or '-PU-' in item_upper:
                # This looks like a regular part number, skip it
                continue
            else:
                # Unclear items - let AI classify them
                filtered_items[item_name] = item_data

        if not filtered_items:
            print("No potential non-parts found after filtering (all unmatched items look like regular part numbers)")
            return {}

        try:
            unmatched_str = json.dumps(filtered_items, ensure_ascii=False, indent=2)

            classification_prompt = f"""You are an expert at analyzing quotation documents. Classify the following unmatched items from a manufacturing quotation as non-parts (additional costs like mold, tooling, assembly, labor, delivery, etc.) or as regular parts that couldn't be matched.

UNMATCHED ITEMS FROM QUOTATION:
{unmatched_str}

For each item, determine:
1. Is it a non-part (additional cost)? (yes/no)
2. If yes, what type of non-part? Choose from: "Mold", "Tooling", "Assembly", "Labor", "Delivery", "Packaging", "Engineering", "Testing", "Other"
3. Try to extract a base part number if applicable (e.g., if the item is "Mold for part XYZ", extract "XYZ")
4. Confidence level: "high" (clearly a non-part), "medium" (probably a non-part), "low" (uncertain)

CLASSIFICATION RULES:
- MOLD: Items like "Mold", "Mold Cost", "Die Cost", "Cavity Cost", "Injection mold fee"
- TOOLING: Items like "Tooling", "Setup fee", "Tool cost", "Fixture cost", "Jig cost"
- ASSEMBLY: Items like "Assembly", "Sub-assembly", "Assembly labor", "Final assembly"
- LABOR: Items like "Labor cost", "Manufacturing labor", "Machine time", "Operator cost"
- DELIVERY: Items like "Delivery", "Shipping", "Transportation", "Freight", "Postage"
- PACKAGING: Items like "Packaging", "Box", "Crating", "Wrapping", "Label"
- ENGINEERING: Items like "Engineering", "Design", "CAD", "Drawing fee", "Technical review"
- TESTING: Items like "Testing", "Inspection", "QC", "First article inspection"
- OTHER: Any other additional costs not in the above categories

IMPORTANT:
- Return ONLY valid JSON. No explanations, markdown, or code blocks.
- For items that ARE regular parts (even if unmatched), set "is_non_part": false
- Try to be helpful and classify everything — only return high/medium/low confidence

Return a JSON object mapping each item to its classification:
{{
  "item_name": {{
    "is_non_part": true/false,
    "cost_type": "Mold" | "Tooling" | "Assembly" | "Labor" | "Delivery" | "Packaging" | "Engineering" | "Testing" | "Other",
    "base_part_number": "extracted_base_part_or_original_name",
    "unit_cost": <float or null>,
    "quantity": <int>,
    "total_cost": <float or null>,
    "description": "human readable description",
    "confidence": "high" | "medium" | "low"
  }}
}}

CRITICAL: Return ONLY the JSON object. Do not include any text before or after. Start with {{ and end with }}.
"""

            request_options = self._get_request_options(timeout=120)
            response = self.model.generate_content(
                classification_prompt,
                request_options=request_options,
                generation_config={"temperature": 0.3}
            )

            response_text = response.text
            print(f"DEBUG: AI classification response length: {len(response_text)} characters")

            # Try to parse JSON
            json_patterns = [
                r'```json\s*(\{[\s\S]*?\})\s*```',
                r'```\s*(\{[\s\S]*?\})\s*```',
            ]

            classifications = None
            json_str = None

            # Try code blocks first
            for pattern in json_patterns:
                json_match = re.search(pattern, response_text, re.DOTALL)
                if json_match:
                    json_str = json_match.group(1) if len(json_match.groups()) > 0 else json_match.group(0)
                    try:
                        classifications = json.loads(json_str)
                        print(f"Successfully parsed non-parts classification from code block")
                        break
                    except json.JSONDecodeError as e:
                        print(f"JSON parse failed from code block: {e}")
                        continue

            # Try to find JSON object directly
            if not classifications:
                json_match = re.search(r'\{[\s\S]*\}', response_text, re.DOTALL)
                if json_match:
                    json_str = json_match.group(0)
                    try:
                        classifications = json.loads(json_str)
                        print(f"Successfully parsed non-parts classification from raw JSON")
                    except json.JSONDecodeError as e:
                        print(f"Could not parse non-parts classification: {e}")
                        return {}

            if classifications and isinstance(classifications, dict):
                print(f"Non-parts classification successful: {len(classifications)} items classified")
                return classifications
            else:
                print("Could not parse non-parts classification response")
                return {}

        except Exception as e:
            print(f"Error classifying non-parts: {e}")
            import traceback
            traceback.print_exc()
            return {}


# Example usage
if __name__ == "__main__":
    # Test the processor
    processor = GeminiQuotationProcessor()
    
    # Test with a sample file path
    # result = processor.extract_from_quotation("path/to/quotation.pdf")
    # print(result)
