"""
One-time migration: Replace U+E907 placeholder characters in the PO template
with proper {{VARIABLE}} placeholders that fill_po_template() can match.

Run once: python migrate_po_template.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from google_sheets.google_drive_upload import get_docs_service
from rfq_po_tab.templates import PO_TEMPLATE


def migrate():
    docs_service = get_docs_service()
    template_id = PO_TEMPLATE['id']

    # Read document to find all placeholder positions
    doc = docs_service.documents().get(documentId=template_id).execute()
    body = doc.get('body', {}).get('content', [])

    # Find all U+E907 placeholder groups
    placeholders = []

    def find_placeholders(elements):
        for element in elements:
            if 'paragraph' in element:
                for run in element['paragraph'].get('elements', []):
                    if 'textRun' in run:
                        text = run['textRun']['content']
                        si = run.get('startIndex', 0)
                        idx = 0
                        while idx < len(text):
                            pos = text.find('\ue907', idx)
                            if pos == -1:
                                break
                            end = pos
                            while end < len(text) and text[end] == '\ue907':
                                end += 1
                            placeholders.append({
                                'start': si + pos,
                                'end': si + end,
                                'chars': end - pos
                            })
                            idx = end
            if 'table' in element:
                for row in element['table'].get('tableRows', []):
                    for cell in row.get('tableCells', []):
                        find_placeholders(cell.get('content', []))

    find_placeholders(body)
    print(f"Found {len(placeholders)} placeholder groups")

    if len(placeholders) != 17:
        print(f"ERROR: Expected 17 placeholders, found {len(placeholders)}")
        for i, p in enumerate(placeholders):
            print(f"  #{i}: start={p['start']}, end={p['end']}, chars={p['chars']}")
        return

    # Map each positional placeholder to its variable name
    # Order matches document flow top-to-bottom:
    positional_vars = [
        '{{PO_NUMBER}}',         # #0: "Purchase Order __"
        '{{PO_DATE}}',           # #1: standalone after PO title
        '{{VENDOR_NAME}}',       # #2: "To: __"
        '{{CONTACT_NAME}}',      # #3: "Dear __,"
        '{{QUOTATION_NUMBER}}',  # #4: "number __,"
        '{{QUOTATION_DATE}}',    # #5: "sent on __"
        '{{CURRENCY}}',          # #6: table header "Unit Cost __"
        '{{CURRENCY}}',          # #7: table header "Total Cost __"
        '{{TOTAL_COST}}',        # #8: summary table (4 chars)
        '{{DELIVERY_DATE}}',     # #9: "Delivery Date:__"
        '{{PAYMENT_TERMS}}',     # #10: "Payment Terms: __"
        '{{ORDERER_NAME}}',      # #11: after "Best Regards,"
        '{{ORDERER_EMAIL}}',     # #12: orderer email
        '{{ORDERER_PHONE}}',     # #13: orderer phone
        '{{APPROVER_NAME}}',     # #14: after "Approved By:"
        '{{APPROVER_TITLE}}',    # #15: after "TItle:"
        '{{PO_DATE}}',           # #16: after "Date:"
    ]

    # Build delete+insert requests in REVERSE order to avoid index shifting
    requests = []
    for i in range(len(placeholders) - 1, -1, -1):
        p = placeholders[i]
        var = positional_vars[i]
        # Delete the placeholder chars
        requests.append({
            'deleteContentRange': {
                'range': {
                    'startIndex': p['start'],
                    'endIndex': p['end']
                }
            }
        })
        # Insert the variable name
        requests.append({
            'insertText': {
                'location': {'index': p['start']},
                'text': var
            }
        })

    result = docs_service.documents().batchUpdate(
        documentId=template_id,
        body={'requests': requests}
    ).execute()
    print(f"Replaced all 17 placeholder groups with {{{{VARIABLE}}}} format")

    # Verify
    doc2 = docs_service.documents().get(documentId=template_id).execute()
    import json
    full_text = json.dumps(doc2)
    remaining = full_text.count('\ue907')
    if remaining == 0:
        print("Migration complete! All U+E907 characters replaced.")
    else:
        print(f"WARNING: {remaining} U+E907 characters still remain")

    # Show result
    def show_text(elements, indent=0):
        for element in elements:
            if 'paragraph' in element:
                for run in element['paragraph'].get('elements', []):
                    if 'textRun' in run:
                        text = run['textRun']['content'].strip()
                        if text:
                            print(f"{'  '*indent}{text}")
            if 'table' in element:
                print(f"{'  '*indent}[TABLE]")
                row0 = element['table'].get('tableRows', [{}])[0]
                for ci, cell in enumerate(row0.get('tableCells', [])):
                    for ce in cell.get('content', []):
                        if 'paragraph' in ce:
                            for run in ce['paragraph'].get('elements', []):
                                if 'textRun' in run:
                                    t = run['textRun']['content'].strip()
                                    if t:
                                        print(f"{'  '*indent}  Col{ci}: {t}")

    print("\n=== Template after migration ===")
    show_text(doc2.get('body', {}).get('content', []))


if __name__ == '__main__':
    migrate()
