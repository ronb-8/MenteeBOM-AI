import os
from google.oauth2.service_account import Credentials
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import gspread

# Import folder and template configs from rfq_po_tab/templates.py
from rfq_po_tab.templates import FOLDER_LOCATIONS, DOCUMENT_TEMPLATES, PO_TEMPLATE

# Update scopes to include everything needed for Docs and Sheets operations
SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets'
]

CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), 'credentials.json')


def escape_drive_query_value(value):
    """Escape a value for interpolation into a Drive API query string.
    Apostrophes in names (e.g. O'Ring) otherwise break the query."""
    return str(value).replace("\\", "\\\\").replace("'", "\\'")

def get_drive_service():
    """Create and return Google Drive service instance."""
    try:
        creds = service_account.Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
        service = build('drive', 'v3', credentials=creds)
        return service
    except Exception as e:
        print(f"Error connecting to Google Drive: {e}")
        return None

def create_folder_if_not_exists(service, folder_name, parent_id=None):
    """Create a folder in Google Drive if it doesn't exist."""
    try:
        # Search for existing folder
        query = f"name='{escape_drive_query_value(folder_name)}' and mimeType='application/vnd.google-apps.folder'"
        if parent_id:
            query += f" and '{parent_id}' in parents"
        
        results = service.files().list(
            q=query, 
            spaces='drive', 
            fields='files(id, name)',
            supportsAllDrives=True,
            includeItemsFromAllDrives=True
        ).execute()
        items = results.get('files', [])

        if items:
            return items[0]['id']
        
        # Create new folder
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder'
        }
        if parent_id:
            file_metadata['parents'] = [parent_id]
        
        folder = service.files().create(
            body=file_metadata, 
            fields='id',
            supportsAllDrives=True
        ).execute()
        return folder.get('id')
    except Exception as e:
        print(f"Error creating/finding folder: {e}")
        return None
    
def upload_file(service, file_path, folder_id=None):
    """Upload a file to Google Drive, replacing existing file if it exists."""
    try:
        file_name = os.path.basename(file_path)
        
        # Check if file already exists in the folder
        existing_file_id = None
        if folder_id:
            query = f"name='{escape_drive_query_value(file_name)}' and '{folder_id}' in parents and trashed=false"
            results = service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name)',
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            items = results.get('files', [])
            if items:
                existing_file_id = items[0]['id']
        
        file_metadata = {'name': file_name}
        if folder_id:
            file_metadata['parents'] = [folder_id]

        media = MediaFileUpload(file_path, resumable=True)
        
        if existing_file_id:
            # Update existing file (replace content)
            print(f"Replacing existing file in Google Drive: {file_name} (ID: {existing_file_id})")
            file = service.files().update(
                fileId=existing_file_id,
                media_body=media,
                fields='id, webViewLink',
                supportsAllDrives=True
            ).execute()
        else:
            # Create new file
            print(f"Uploading new file to Google Drive: {file_name}")
            file = service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id, webViewLink',
                supportsAllDrives=True
            ).execute()
        
        return file.get('webViewLink')
    except Exception as e:
        print(f"Error uploading file {file_path}: {e}")
        return None

def get_file_from_folder(service, file_name=None, file_id=None, folder_id=None):
    """
    Get a file from Google Drive, optionally filtering by folder.
    
    Args:
        service: The Google Drive service instance
        file_name: The name of the file to find (optional)
        file_id: The ID of the file to find (optional)
        folder_id: The ID of the folder to search in (optional)
    
    Returns:
        The file ID if found, None otherwise
    """
    try:
        # Build the query based on provided parameters
        query_parts = []
        
        # Filter by MIME type for Google Docs
        query_parts.append("mimeType='application/vnd.google-apps.document'")
        
        # Add name filter if provided
        if file_name:
            query_parts.append(f"name='{escape_drive_query_value(file_name)}'")
            
        # Add file ID filter if provided
        if file_id:
            query_parts.append(f"id='{file_id}'")
            
        # Add folder filter if provided
        if folder_id:
            query_parts.append(f"'{folder_id}' in parents")
            
        # Join query parts with AND
        query = " and ".join(query_parts)
        
        # Execute the search
        results = service.files().list(
            q=query,
            spaces='drive',
            fields='files(id, name)',
            supportsAllDrives=True,
            includeItemsFromAllDrives=True
        ).execute()
        
        items = results.get('files', [])
        
        if not items:
            print(f"No files found matching the criteria.")
            return None
            
        print(f"Found {len(items)} matching files.")
        # Return the first file that matches
        return items[0]['id']
        
    except Exception as e:
        print(f"Error searching for file: {e}")
        return None

def upload_output_files(files_to_upload, base_folder_name, file_type='po'):
    """Upload multiple files to a folder structure in Google Drive.
    
    Returns:
        Dictionary with uploaded file links and folder information:
        {
            'links': {filename: url, ...},
            'folder_id': folder_id,
            'folder_url': folder_url
        }
    """
    service = get_drive_service()
    if not service:
        return None

    try:
        # Get the specific parent folder ID based on file type
        parent_folder_id = FOLDER_LOCATIONS.get(file_type)
        if not parent_folder_id:
            print(f"Warning: No specific folder ID configured for {file_type} files")
            return None

        # Create a subfolder with the BOM name under the specific folder type
        bom_folder_id = create_folder_if_not_exists(service, base_folder_name, parent_folder_id)
        if not bom_folder_id:
            return None

        # Get folder URL
        folder_info = service.files().get(
            fileId=bom_folder_id,
            fields='webViewLink',
            supportsAllDrives=True
        ).execute()
        folder_url = folder_info.get('webViewLink')

        uploaded_links = {}
        print(f"DEBUG: files_to_upload type: {type(files_to_upload)}")
        print(f"DEBUG: files_to_upload content: {files_to_upload}")
        for file_path in files_to_upload:
            print(f"DEBUG: Processing file_path: {file_path}, type: {type(file_path)}")
            if isinstance(file_path, str) and os.path.exists(file_path):
                link = upload_file(service, file_path, bom_folder_id)
                if link:
                    uploaded_links[os.path.basename(file_path)] = link
            else:
                print(f"DEBUG: Skipping invalid file_path: {file_path}")

        return {
            'links': uploaded_links,
            'folder_id': bom_folder_id,
            'folder_url': folder_url
        }
    except Exception as e:
        print(f"Error in upload process: {e}")
        return None

def get_sheets_client():
    """Create and return Google Sheets client using gspread."""
    try:
        creds = service_account.Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
        client = gspread.authorize(creds)
        return client
    except Exception as e:
        print(f"Error connecting to Google Sheets: {e}")
        return None

def create_sheets_from_data(flat_data, spreadsheet_name, folder_id):
    """Create a Google Sheets spreadsheet from flat data and place it in the specified folder.
    
    Args:
        flat_data: Dictionary with 'items' list containing BOM data
        spreadsheet_name: Name for the new spreadsheet
        folder_id: Google Drive folder ID where to create the spreadsheet
        
    Returns:
        Dictionary with spreadsheet_id and spreadsheet_url, or None on error
    """
    try:
        client = get_sheets_client()
        if not client:
            return None
        
        # Create new spreadsheet
        spreadsheet = client.create(spreadsheet_name)
        spreadsheet_id = spreadsheet.id
        
        # Move spreadsheet to the specified folder
        drive_service = get_drive_service()
        if drive_service and folder_id:
            # Get the current parents
            file = drive_service.files().get(
                fileId=spreadsheet_id,
                fields='parents',
                supportsAllDrives=True
            ).execute()
            
            previous_parents = ",".join(file.get('parents', []))
            
            # Move the file to the new folder
            drive_service.files().update(
                fileId=spreadsheet_id,
                addParents=folder_id,
                removeParents=previous_parents,
                fields='id, parents',
                supportsAllDrives=True
            ).execute()
        
        # Get the first worksheet
        worksheet = spreadsheet.sheet1
        
        # Headers without Thumbnail column
        headers = [
            '#', 'Type', 'Part Number', 'Revision', 'ECO',
            'Description', 'Material', 'Finish 1', 'Finish 2', 'QTY',
            'Vendor', 'Order Qty', 'Unit Cost', 'Price/BOM', 'PO Orders',
            'Inventory', 'Warehouse Box', 'State'
        ]
        
        # Prepare all rows in memory first (batch write to avoid quota issues)
        all_rows = [headers]  # Start with headers
        
        # Prepare data rows
        items = flat_data.get('items', [])
        for idx, item in enumerate(items, start=1):
            revision = item.get('Revision') or item.get('revision') or ''
            
            row = [
                idx,
                item.get('Type') or item.get('part_type') or '',
                item.get('PART NUMBER') or item.get('part_number') or '',
                revision,
                item.get('ECO Number') or item.get('eco_number') or '',
                item.get('DESCRIPTION') or item.get('description') or '',
                item.get('Material') or '',
                item.get('FINISH1') or '',
                item.get('FINISH2') or '',
                item.get('QTY.') or item.get('qty') or '',
                item.get('Vendor') or item.get('vendor') or '',
                item.get('Order Qty') or item.get('order_qty') or '',
                item.get('Unit Cost') or item.get('unit_cost') or '',
                item.get('Price/BOM') or item.get('price_per_bom') or '',
                item.get('PO Orders') or item.get('po_orders') or '',
                item.get('Inventory') if item.get('Inventory') is not None else '',
                item.get('Warehouse Box') or '',
                item.get('State') or item.get('state') or ''
            ]
            all_rows.append(row)
        
        # Write all rows in a single batch operation to avoid quota limits
        if all_rows:
            worksheet.update('A1', all_rows, value_input_option='USER_ENTERED')
        
        # Format header row (row 1) - this is a separate API call but necessary
        worksheet.format('1:1', {
            'textFormat': {'bold': True},
            'backgroundColor': {'red': 0.95, 'green': 0.95, 'blue': 0.95},
            'horizontalAlignment': 'CENTER',
            'verticalAlignment': 'MIDDLE'
        })
        
        # Set column widths (gspread doesn't have direct column width control via API)
        # Column widths will be auto-sized by Google Sheets
        
        # Get spreadsheet URL
        spreadsheet_url = spreadsheet.url
        
        return {
            'spreadsheet_id': spreadsheet_id,
            'spreadsheet_url': spreadsheet_url
        }
    except Exception as e:
        print(f"Error creating Google Sheets: {e}")
        return None


def get_docs_service():
    """Create and return Google Docs service instance."""
    try:
        creds = service_account.Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
        service = build('docs', 'v1', credentials=creds)
        return service
    except Exception as e:
        print(f"Error connecting to Google Docs: {e}")
        return None


def fill_po_template(po_data, parts_data, template_vars, target_folder_id=None, doc_name=None):
    """
    Copy the PO Google Docs template, fill placeholders and parts table.

    Args:
        po_data: dict with keys: po_number, vendor, currency, total_cost, po_date
        parts_data: list of dicts with: part_number, description, quantity, unit_cost, total_cost
        template_vars: dict with user-filled variables (contact_name, quotation_number, etc.)
        target_folder_id: Google Drive folder ID to place the generated doc in
        doc_name: optional override for the generated doc's file name (defaults to the PO number)

    Returns:
        dict with 'doc_id' and 'doc_url', or None on error
    """
    drive_service = get_drive_service()
    docs_service = get_docs_service()
    if not drive_service or not docs_service:
        print("Error: Could not initialize Google Drive/Docs services")
        return None

    template_id = PO_TEMPLATE['id']
    po_number = po_data.get('po_number', 'PO')
    vendor = po_data.get('vendor', '')
    doc_name = doc_name or f"{po_number}"

    try:
        # 1. Copy the template
        copy_body = {'name': doc_name}
        if target_folder_id:
            copy_body['parents'] = [target_folder_id]
        copied = drive_service.files().copy(
            fileId=template_id,
            body=copy_body,
            fields='id, webViewLink',
            supportsAllDrives=True
        ).execute()
        doc_id = copied['id']
        doc_url = copied.get('webViewLink', f'https://docs.google.com/document/d/{doc_id}/edit')
        print(f"Copied template to: {doc_name} (ID: {doc_id})")

        # 2. Build replaceAllText requests for placeholders
        po_date = po_data.get('po_date', '')
        currency = po_data.get('currency', 'USD')
        total_cost = po_data.get('total_cost', 0)

        discount_percent = po_data.get('discount_percent', None)
        original_total_cost = po_data.get('original_total_cost', None)

        # Format total cost
        try:
            total_cost_formatted = f"{float(total_cost):,.2f}"
        except (ValueError, TypeError):
            total_cost_formatted = str(total_cost)

        replacements = {
            '{{PO_NUMBER}}': str(po_number),
            '{{PO_DATE}}': str(po_date),
            '{{VENDOR_NAME}}': str(vendor),
            '{{TOTAL_COST}}': total_cost_formatted,
            '{{CURRENCY}}': str(currency),
        }

        # Add user-filled template vars
        if template_vars:
            var_map = {
                'contact_name': '{{CONTACT_NAME}}',
                'quotation_number': '{{QUOTATION_NUMBER}}',
                'quotation_date': '{{QUOTATION_DATE}}',
                'delivery_date': '{{DELIVERY_DATE}}',
                'payment_terms': '{{PAYMENT_TERMS}}',
                'orderer_name': '{{ORDERER_NAME}}',
                'orderer_email': '{{ORDERER_EMAIL}}',
                'orderer_phone': '{{ORDERER_PHONE}}',
                'approver_name': '{{APPROVER_NAME}}',
                'approver_title': '{{APPROVER_TITLE}}',
            }
            for key, placeholder in var_map.items():
                val = template_vars.get(key, '')
                replacements[placeholder] = str(val) if val else ''

        replace_requests = []
        for placeholder, value in replacements.items():
            replace_requests.append({
                'replaceAllText': {
                    'containsText': {
                        'text': placeholder,
                        'matchCase': True
                    },
                    'replaceText': value
                }
            })

        # Execute placeholder replacements
        if replace_requests:
            docs_service.documents().batchUpdate(
                documentId=doc_id,
                body={'requests': replace_requests}
            ).execute()
            print(f"Replaced {len(replace_requests)} placeholders")

        # 3. Fill the parts table
        _fill_po_table(docs_service, doc_id, parts_data, currency, discount_percent, original_total_cost)

        return {
            'doc_id': doc_id,
            'doc_url': doc_url
        }

    except Exception as e:
        print(f"Error filling PO template: {e}")
        import traceback
        traceback.print_exc()
        return None


def _fill_po_table(docs_service, doc_id, parts_data, currency='USD', discount_percent=None, original_total_cost=None):
    """
    Fill the parts table in the PO document.

    The template table structure:
    - Row 0: Header row (column titles: #, Description, Article #, QTY., Unit Cost, Total Cost)
    - Rows 1-10: Data rows (10 rows)
    Total: 11 rows (1 header + 10 data)

    Table columns: #, Description, Article #, Revision, QTY., Unit Cost, Total Cost
    """
    try:
        # Get document structure to find the table
        doc = docs_service.documents().get(documentId=doc_id).execute()
        body = doc.get('body', {}).get('content', [])

        # Find the first table in the document
        table_element = None
        for element in body:
            if 'table' in element:
                table_element = element
                break

        if not table_element:
            print("Warning: No table found in PO template")
            return

        table = table_element['table']
        table_rows = table.get('tableRows', [])
        num_template_rows = len(table_rows)
        num_header_rows = 1  # 1 header row (column titles)
        num_data_rows = num_template_rows - num_header_rows
        num_parts = len(parts_data)

        print(f"Table has {num_template_rows} rows ({num_header_rows} header + {num_data_rows} data). Need {num_parts} data rows.")

        # Strategy:
        # 1. If we need more rows than available, insert additional rows
        # 2. Fill data rows
        # 3. If we have fewer parts than rows, delete extra rows

        requests = []

        # Insert additional rows if needed (insert BEFORE filling to avoid index issues)
        if num_parts > num_data_rows:
            rows_to_add = num_parts - num_data_rows
            # Get the end index of the last row in the table to insert after it
            last_row = table_rows[-1]
            # Insert rows at the end of the table (after the last existing row)
            for _ in range(rows_to_add):
                # We need the table start index
                table_start = table_element.get('startIndex', 0)
                last_row_cells = last_row.get('tableCells', [])
                if last_row_cells:
                    last_cell = last_row_cells[-1]
                    last_cell_content = last_cell.get('content', [])
                    if last_cell_content:
                        insert_below_index = last_cell_content[-1].get('endIndex', table_start) - 1
                        requests.append({
                            'insertTableRow': {
                                'tableCellLocation': {
                                    'tableStartLocation': {'index': table_start},
                                    'rowIndex': num_template_rows - 1,
                                    'columnIndex': 0
                                },
                                'insertBelow': True
                            }
                        })
            if requests:
                docs_service.documents().batchUpdate(
                    documentId=doc_id,
                    body={'requests': requests}
                ).execute()
                print(f"Inserted {rows_to_add} additional table rows")
                requests = []

                # Re-fetch document after inserting rows
                doc = docs_service.documents().get(documentId=doc_id).execute()
                body = doc.get('body', {}).get('content', [])
                for element in body:
                    if 'table' in element:
                        table_element = element
                        break
                table = table_element['table']
                table_rows = table.get('tableRows', [])

        # Now fill data rows with part data
        # We need to work in reverse order to avoid index shifting
        fill_requests = []

        for i in range(num_parts):
            row_index = num_header_rows + i
            if row_index >= len(table_rows):
                break

            row = table_rows[row_index]
            cells = row.get('tableCells', [])
            part = parts_data[i]

            # Column data: #, Description, Article #, Revision, QTY., Unit Cost, Total Cost
            item_num = str(i + 1)
            description = str(part.get('description', '') or '')
            part_number = str(part.get('part_number', '') or '')
            revision = str(part.get('revision', '') or '')
            qty = str(part.get('quantity', 1))
            try:
                unit_cost = f"{float(part.get('unit_cost', 0)):,.2f}"
            except (ValueError, TypeError):
                unit_cost = str(part.get('unit_cost', ''))
            try:
                total_cost = f"{float(part.get('total_cost', 0)):,.2f}"
            except (ValueError, TypeError):
                total_cost = str(part.get('total_cost', ''))

            cell_values = [item_num, description, part_number, revision, qty, unit_cost, total_cost]

            for col_idx, value in enumerate(cell_values):
                if col_idx >= len(cells):
                    break
                cell = cells[col_idx]
                cell_content = cell.get('content', [])
                if not cell_content:
                    continue

                # Get the paragraph in this cell
                paragraph = cell_content[0]
                para_start = paragraph.get('startIndex', 0)
                para_end = paragraph.get('endIndex', para_start + 1)

                # Calculate the text range to replace (excluding the trailing newline)
                # Each cell paragraph has at least a newline char
                text_start = para_start
                text_end = para_end - 1  # exclude trailing newline

                if text_end > text_start:
                    # Delete existing content first
                    fill_requests.append({
                        'deleteContentRange': {
                            'range': {
                                'startIndex': text_start,
                                'endIndex': text_end
                            }
                        }
                    })

                # Insert new text
                if value:
                    fill_requests.append({
                        'insertText': {
                            'location': {'index': text_start},
                            'text': value
                        }
                    })

        # Process fill requests in reverse index order to avoid shifting
        # Sort by the index used in each request (descending)
        def get_request_index(req):
            if 'deleteContentRange' in req:
                return req['deleteContentRange']['range']['startIndex']
            if 'insertText' in req:
                return req['insertText']['location']['index']
            return 0

        fill_requests.sort(key=get_request_index, reverse=True)

        if fill_requests:
            # Process in batches to avoid hitting API limits
            batch_size = 50
            for batch_start in range(0, len(fill_requests), batch_size):
                batch = fill_requests[batch_start:batch_start + batch_size]
                docs_service.documents().batchUpdate(
                    documentId=doc_id,
                    body={'requests': batch}
                ).execute()
            print(f"Filled {num_parts} data rows in table")

        # Delete unused rows (if fewer parts than template rows)
        if num_parts < num_data_rows:
            # Re-fetch document after fills
            doc = docs_service.documents().get(documentId=doc_id).execute()
            body = doc.get('body', {}).get('content', [])
            for element in body:
                if 'table' in element:
                    table_element = element
                    break
            table = table_element['table']
            table_rows = table.get('tableRows', [])
            table_start = table_element.get('startIndex', 0)

            # Delete rows from bottom to avoid index shifting
            delete_requests = []
            for row_idx in range(len(table_rows) - 1, num_header_rows + num_parts - 1, -1):
                delete_requests.append({
                    'deleteTableRow': {
                        'tableCellLocation': {
                            'tableStartLocation': {'index': table_start},
                            'rowIndex': row_idx,
                            'columnIndex': 0
                        }
                    }
                })

            if delete_requests:
                docs_service.documents().batchUpdate(
                    documentId=doc_id,
                    body={'requests': delete_requests}
                ).execute()
                print(f"Deleted {len(delete_requests)} unused table rows")

        # Add discount summary rows to the table if discount was applied
        if discount_percent and original_total_cost:
            try:
                discounted_total = sum(float(p.get('total_cost', 0)) for p in parts_data)
                try:
                    orig_formatted = f"{float(original_total_cost):,.2f}"
                    disc_formatted = f"-{discount_percent}%"
                    after_formatted = f"{discounted_total:,.2f}"
                except (ValueError, TypeError):
                    orig_formatted = str(original_total_cost)
                    disc_formatted = f"-{discount_percent}%"
                    after_formatted = str(discounted_total)

                # Re-fetch document to get current table state
                doc = docs_service.documents().get(documentId=doc_id).execute()
                body_content = doc.get('body', {}).get('content', [])
                for element in body_content:
                    if 'table' in element:
                        table_element = element
                        break
                table = table_element['table']
                table_rows = table.get('tableRows', [])
                table_start = table_element.get('startIndex', 0)
                current_row_count = len(table_rows)

                # Insert 3 rows at the bottom for: Total Cost, Discount, Total After Discount
                insert_requests = []
                for _ in range(3):
                    insert_requests.append({
                        'insertTableRow': {
                            'tableCellLocation': {
                                'tableStartLocation': {'index': table_start},
                                'rowIndex': current_row_count - 1,
                                'columnIndex': 0
                            },
                            'insertBelow': True
                        }
                    })
                docs_service.documents().batchUpdate(
                    documentId=doc_id,
                    body={'requests': insert_requests}
                ).execute()
                print("Inserted 3 discount summary rows")

                # Re-fetch to fill the new rows
                doc = docs_service.documents().get(documentId=doc_id).execute()
                body_content = doc.get('body', {}).get('content', [])
                for element in body_content:
                    if 'table' in element:
                        table_element = element
                        break
                table = table_element['table']
                table_rows = table.get('tableRows', [])

                # The 3 new rows are at the bottom
                summary_rows = [
                    {'label': 'Total Cost:', 'value': orig_formatted},
                    {'label': 'Discount:', 'value': disc_formatted},
                    {'label': 'Total After Discount:', 'value': after_formatted},
                ]

                summary_requests = []
                for i, row_data in enumerate(summary_rows):
                    row_idx = len(table_rows) - 3 + i
                    if row_idx >= len(table_rows):
                        break
                    row = table_rows[row_idx]
                    cells = row.get('tableCells', [])

                    # Put label in second-to-last column, value in last column
                    # Table has 7 columns: #, Description, Article #, Revision, QTY., Unit Cost, Total Cost
                    label_col = len(cells) - 2 if len(cells) >= 2 else 0
                    value_col = len(cells) - 1 if len(cells) >= 1 else 0

                    for col_idx, value in [(label_col, row_data['label']), (value_col, row_data['value'])]:
                        if col_idx >= len(cells):
                            continue
                        cell = cells[col_idx]
                        cell_content = cell.get('content', [])
                        if not cell_content:
                            continue
                        paragraph = cell_content[0]
                        para_start = paragraph.get('startIndex', 0)
                        if value:
                            summary_requests.append({
                                'insertText': {
                                    'location': {'index': para_start},
                                    'text': value
                                }
                            })

                # Process in reverse order
                summary_requests.sort(
                    key=lambda r: r.get('insertText', {}).get('location', {}).get('index', 0)
                             if 'insertText' in r else 0,
                    reverse=True
                )
                if summary_requests:
                    docs_service.documents().batchUpdate(
                        documentId=doc_id,
                        body={'requests': summary_requests}
                    ).execute()
                    print("Filled discount summary rows in table")
            except Exception as disc_err:
                print(f"Warning: Failed to add discount rows to table: {disc_err}")
                import traceback
                traceback.print_exc()

    except Exception as e:
        print(f"Error filling PO table: {e}")
        import traceback
        traceback.print_exc()
