"""
Template and folder configuration for PO/quotation document generation and uploads.
This file centralizes all Google Drive folder IDs, Google Doc template IDs, and PDF extraction functions.
"""

# Google Drive folder locations for different file types
FOLDER_LOCATIONS = {
    'rfq': '18M6HxYxSURluDkAKS-7sYApcMWiQCud1',
    'po': "1I58EoDX_ZowWz51mrhf6V6GxGcSLiqTj"
}

# Google Doc template IDs for each supported recipient
DOCUMENT_TEMPLATES = {
    "BOLE - Jane": {
        'name': 'PO Template - BOLE',
        'id': '1tkfveJE3LUiee4hUAdn4Rr7bwVBJydO3KiRwz8dFdVE'
    },
    "Mastars Industries Co.LTD": {
        'name': 'Mastars PO Template',
        'id': '1MastarsTemplateIDHere'
    },
    "DH Machining": {
        'name': 'DH Machining PO Template',
        'id': '1DHMachiningTemplateIDHere'
    }
}

# Universal PO Google Docs template
PO_TEMPLATE = {
    'name': 'Mentee PO English format - MenteeBOM',
    'id': '1QOhFqlyn49g6zT1Sg_kG7oC5HtFyfVLC7q_e5uIQuiY',
    'folder_id': '1VLhfvH8vjYHGm7b5-ORY5Dc5ZBg6kEEB'
}
