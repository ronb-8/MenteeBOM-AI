// Enhanced BOM Table Functions
// This file contains the updated BOM table creation functions with Type and Changes columns

function createEnhancedBOMTreeHTML(data) {
    // Handle tree structure from the web BOM parser
    let html = '<style>' +
        '.bom-table-container { position: relative; overflow: auto; width: 100%; max-width: 100%; height: 45vh; border: 1px solid #dee2e6; }' +
        '#bomTable { width: max-content; min-width: 2000px; table-layout: fixed; border-collapse: separate; border-spacing: 0; border: 1px solid #dee2e6; }' +
        '#bomTable th, #bomTable td { border: 1px solid #dee2e6; padding: 8px; text-align: left; vertical-align: top; }' +
        '#bomTable th { background-color: #f8f9fa; font-weight: bold; }' +
        '#bomTable tbody tr:nth-child(even) { background-color: #f8f9fa; }' +
        '#bomTable tbody tr:hover { background-color: #e9ecef; }' +
        '#bomTable thead th { position: sticky; top: 0; z-index: 20; background: white !important; }' +
        '.inventory-cell-with-arrows { position: relative !important; }' +
        '.inventory-arrows { position: absolute !important; right: 5px !important; top: 50% !important; transform: translateY(-50%) !important; display: flex !important; flex-direction: column !important; gap: 2px !important; z-index: 100 !important; pointer-events: auto !important; }' +
        '.inventory-arrow-btn { width: 20px !important; height: 16px !important; padding: 0 !important; border: 1px solid #ccc !important; background: #fff !important; cursor: pointer !important; font-size: 10px !important; line-height: 1 !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 101 !important; }' +
        '.inventory-arrow-btn:hover { background: #e9ecef !important; border-color: #007bff !important; }' +
        '.inventory-arrow-btn:active { background: #dee2e6 !important; }' +
        '.inventory-value { display: inline-block !important; min-width: 30px !important; }' +

        // Frozen columns: 1 (checkbox), 2 (Type), 3 (Part Number), 4 (Revision), 5 (ECO), 6 (Description)
        '#bomTable th:nth-child(1), #bomTable td:nth-child(1) { position: sticky !important; left: 0px !important; background: white !important; z-index: 30 !important; border-right: 2px solid #dee2e6 !important; width: 40px !important; min-width: 40px !important; max-width: 30px !important; }' +
        '#bomTable th:nth-child(2), #bomTable td:nth-child(2) { position: sticky !important; left: 40px !important; background: white !important; z-index: 29 !important; border-right: 2px solid #dee2e6 !important; width: 130px !important; min-width: 130px !important; max-width: 130px !important; }' +
        '#bomTable th:nth-child(3), #bomTable td:nth-child(3) { position: sticky !important; left: 170px !important; background: white !important; z-index: 28 !important; border-right: 2px solid #dee2e6 !important; width: 400px !important; min-width: 400px !important; max-width: 400px !important; }' +
        '#bomTable th:nth-child(4), #bomTable td:nth-child(4) { position: sticky !important; left: 570px !important; background: white !important; z-index: 27 !important; border-right: 2px solid #dee2e6 !important; width: 100px !important; min-width: 100px !important; max-width: 100px !important; }' +
        '#bomTable th:nth-child(5), #bomTable td:nth-child(5) { position: sticky !important; left: 670px !important; background: white !important; z-index: 26 !important; border-right: 2px solid #dee2e6 !important; width: 130px !important; min-width: 130px !important; max-width: 130px !important; }' +
        '#bomTable th:nth-child(6), #bomTable td:nth-child(6) { position: sticky !important; left: 800px !important; background: white !important; z-index: 25 !important; border-right: 2px solid #dee2e6 !important; width: 250px !important; min-width: 250px !important; max-width: 250px !important; }' +

        // Adjust header z-index for all sticky columns
        '#bomTable thead th:nth-child(1) { z-index: 40 !important; }' +
        '#bomTable thead th:nth-child(2) { z-index: 39 !important; }' +
        '#bomTable thead th:nth-child(3) { z-index: 38 !important; }' +
        '#bomTable thead th:nth-child(4) { z-index: 37 !important; }' +
        '#bomTable thead th:nth-child(5) { z-index: 36 !important; }' +
        '#bomTable thead th:nth-child(6) { z-index: 35 !important; }' +

        // All other columns (start at 7) are not sticky, just give standard width
        'th, td { white-space: normal; word-wrap: break-word; overflow-wrap: break-word; hyphens: auto; }' +
        '</style>';
    
    html += '<div class="bom-table-container">';
    html += '<table id="bomTable" style="border-collapse: separate; border-spacing: 0;">';
    html += '<thead><tr>' +
        '<th style="width: 40px; min-width: 40px;"><input type="checkbox" id="selectAllCheckbox" onchange="toggleAllCheckboxes()"></th>' +
        '<th onclick="sortTable(1)" style="cursor: pointer; width: 130px; min-width: 130px;"><i class="fas fa-sort me-1"></i>Type</th>' +
        '<th onclick="sortTable(2)" style="cursor: pointer; width: 400px; min-width: 400px;"><i class="fas fa-sort me-1"></i>Part Number</th>' +
        '<th onclick="sortTable(3)" style="cursor: pointer; width: 100px; min-width: 100px;"><i class="fas fa-sort me-1"></i>Revision</th>' +
        '<th onclick="sortTable(4)" style="cursor: pointer; width: 130px; min-width: 130px;"><i class="fas fa-sort me-1"></i>ECO</th>' +
        '<th onclick="sortTable(5)" style="cursor: pointer; width: 250px; min-width: 250px;"><i class="fas fa-sort me-1"></i>Description</th>' +
        '<th onclick="sortTable(6)" style="cursor: pointer; width: 150px; min-width: 150px;"><i class="fas fa-sort me-1"></i>Material</th>' +
        '<th onclick="sortTable(7)" style="cursor: pointer; width: 150px; min-width: 150px;"><i class="fas fa-sort me-1"></i>Finish 1</th>' +
        '<th onclick="sortTable(8)" style="cursor: pointer; width: 150px; min-width: 150px;"><i class="fas fa-sort me-1"></i>Finish 2</th>' +
        '<th onclick="sortTable(9)" style="cursor: pointer; width: 100px; min-width: 100px;"><i class="fas fa-sort me-1"></i>QTY</th>' +
        '<th onclick="sortTable(10)" style="cursor: pointer; background: #f8f9fc; width: 150px; min-width: 150px;" title="Editable"><i class="fas fa-sort me-1"></i>Vendor <i class="fas fa-edit text-primary" style="font-size: 0.7em;"></i></th>' +
        '<th onclick="sortTable(11)" style="cursor: pointer; background: #f8f9fc; width: 150px; min-width: 150px;" title="Editable"><i class="fas fa-sort me-1"></i>Order Qty <i class="fas fa-edit text-primary" style="font-size: 0.7em;"></i></th>' +
        '<th onclick="sortTable(12)" style="cursor: pointer; background: #f8f9fc; width: 150px; min-width: 150px;" title="Editable"><i class="fas fa-sort me-1"></i>Unit Cost <i class="fas fa-edit text-primary" style="font-size: 0.7em;"></i></th>' +
        '<th onclick="sortTable(13)" style="cursor: pointer; background: #f8f9fc; width: 150px; min-width: 150px;" title="Editable"><i class="fas fa-sort me-1"></i>Price/BOM <i class="fas fa-edit text-primary" style="font-size: 0.7em;"></i></th>' +
        '<th onclick="sortTable(14)" style="cursor: pointer; background: #f8f9fc; width: 150px; min-width: 150px;" title="Editable"><i class="fas fa-sort me-1"></i>PO Orders <i class="fas fa-edit text-primary" style="font-size: 0.7em;"></i></th>' +
        '<th onclick="sortTable(15)" style="cursor: pointer; background: #f8f9fc; width: 150px; min-width: 150px;" title="Editable"><i class="fas fa-sort me-1"></i>Inventory <i class="fas fa-edit text-primary" style="font-size: 0.7em;"></i></th>' +
        '<th onclick="sortTable(16)" style="cursor: pointer; background: #f8f9fc; width: 170px; min-width: 170px;" title="Editable"><i class="fas fa-sort me-1"></i>Warehouse Box <i class="fas fa-edit text-primary" style="font-size: 0.7em;"></i></th>' +
        '<th onclick="sortTable(17)" style="cursor: pointer; width: 150px; min-width: 130px;"><i class="fas fa-sort me-1"></i>State</th>' +
        '</tr></thead>';
    html += '<tbody>';
    
    // Function to render tree nodes recursively
    function renderNode(node, level = 0, parentId = null) {
        const nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const hasChildren = node.children && node.children.length > 0;
        const indent = '&nbsp;'.repeat(level * 4);
        let levelClass = level === 0 ? 'table-primary' : level === 1 ? 'table-light' : '';
        
        // Extract data from BOM columns (handle both tree and flat formats)
        const partNumber = node.name || node['PART NUMBER'] || 'N/A';
        const revision = node.bom_columns?.Revision || node['Revision'] || '';
        const description = node.description || node.bom_columns?.Description || node.bom_columns?.['DESCRIPTION'] || node['DESCRIPTION'] || '';
        const material = node.bom_columns?.Material || node['Material'] || '';
        const finish1 = node.bom_columns?.FINISH1 || node['FINISH1'] || '';
        const finish2 = node.bom_columns?.FINISH2 || node['FINISH2'] || '';
        const qty = node.qty || node['QTY.'] || '1';
        const state = node.bom_columns?.State || node.state || node['State'] || 'Active';
        
        // Get part type (preserve existing format, only classify if truly unknown)
        let partType = node.part_type || node.bom_columns?.Type || node.bom_columns?.type || 'Unknown';
        
        // Only auto-classify if type is truly 'Unknown' and we have part number
        // This preserves the existing type format from the data
        if (partType === 'Unknown' && partNumber && partNumber !== 'N/A') {
            partType = classifyPartType(partNumber, state, description);
        }
        
        const changes = node.changes || node.bom_columns?.Changes || '';
        
        // Create arrow for collapsible functionality (always expanded)
        let arrow = '';
        if (hasChildren) {
            arrow = '<i class="fas fa-chevron-down expand-arrow" onclick="toggleNode(\'' + nodeId + '\')" style="cursor: pointer; margin-right: 5px;"></i>';
        } else {
            arrow = '<i class="fas fa-minus" style="margin-right: 5px; color: #ccc;"></i>';
        }
        
        // Check if thumbnail is available
        let thumbnail = node.thumbnail || {};
        // If thumbnail is a string, try to parse it
        if (typeof thumbnail === 'string' && thumbnail.length > 0) {
            try {
                thumbnail = JSON.parse(thumbnail);
            } catch (e) {
                thumbnail = {};
            }
        }
        const hasThumbnail = thumbnail && thumbnail.available && thumbnail.data_base64;
        
        // Create thumbnail icon or indicator
        let thumbnailIcon = '';
        if (hasThumbnail) {
            thumbnailIcon = '<i class="fas fa-image text-info ms-1" style="cursor: pointer;" ' +
                           'onmouseover="showThumbnailTooltip(event, \'' + thumbnail.data_base64 + '\', \'' + 
                           partNumber + '\', ' + (thumbnail.width || 256) + ', ' + (thumbnail.height || 256) + ')" ' +
                           'onmouseout="hideThumbnailTooltip()" ' +
                           'title="Hover to see thumbnail"></i>';
        } else {
            // Show a placeholder icon that explains how to generate thumbnails
            thumbnailIcon = '<i class="fas fa-image text-muted ms-1" style="cursor: help;" ' +
                           'onmouseover="showThumbnailHelpTooltip(event, \'' + partNumber + '\')" ' +
                           'onmouseout="hideThumbnailTooltip()" ' +
                           'title="No thumbnail available - Click for help"></i>';
        }
        
        // Create PDF icon next to thumbnail
        let pdfIcon = '';
        if (partNumber !== 'N/A' && revision && revision.trim() !== '') {
            pdfIcon = '<i class="fas fa-file-pdf text-danger ms-1" style="cursor: pointer;" ' +
                     'onclick="viewPartPDF(\'' + partNumber + '\', \'' + revision + '\')" ' +
                     'title="Click to view PDF for ' + partNumber + ' REV' + revision + '"></i>';
        }
        
        // Create type badge with pastel color coding (matching original assembly_bom.html styling)
        let typeBadge = '<span class="badge" style="background-color: #f8f9fa; color: #6c757d; border: 1px solid #dee2e6;">' + partType + '</span>';
        
        if (partType === 'Assembly') {
            typeBadge = '<span class="badge" style="background-color: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb;">' + partType + '</span>';
        } else if (partType === 'Mechanical part') {
            typeBadge = '<span class="badge" style="background-color: #f3e5f5; color: #7b1fa2; border: 1px solid #e1bee7;">' + partType + '</span>';
        } else if (partType === '3D Printing part') {
            typeBadge = '<span class="badge" style="background-color: #fff3e0; color: #f57c00; border: 1px solid #ffcc02;">' + partType + '</span>';
        } else if (partType === 'Inhouse electrical part') {
            typeBadge = '<span class="badge" style="background-color: #e8f5e8; color: #388e3c; border: 1px solid #c8e6c9;">' + partType + '</span>';
        } else if (partType === 'External electrical part') {
            typeBadge = '<span class="badge" style="background-color: #e8f5e8; color: #388e3c; border: 1px solid #c8e6c9;">' + partType + '</span>';
        } else if (partType === 'Bearings') {
            typeBadge = '<span class="badge" style="background-color: #fce4ec; color: #c2185b; border: 1px solid #f8bbd9;">' + partType + '</span>';
        } else if (partType === 'Cross Roller Bearings') {
            typeBadge = '<span class="badge" style="background-color: #fce4ec; color: #c2185b; border: 1px solid #f8bbd9;">' + partType + '</span>';
        } else if (partType === 'Fasteners') {
            typeBadge = '<span class="badge" style="background-color: #f1f8e9; color: #689f38; border: 1px solid #dcedc8;">' + partType + '</span>';
        } else if (partType === 'Cables') {
            typeBadge = '<span class="badge" style="background-color: #e0f2f1; color: #00796b; border: 1px solid #b2dfdb;">' + partType + '</span>';
        } else if (partType === 'Motors') {
            typeBadge = '<span class="badge" style="background-color: #fff8e1; color: #f9a825; border: 1px solid #ffecb3;">' + partType + '</span>';
        } else if (partType === 'Gears') {
            typeBadge = '<span class="badge" style="background-color: #f3e5f5; color: #7b1fa2; border: 1px solid #e1bee7;">' + partType + '</span>';
        }
        
        // Get editable field values (or empty if not set) - handle both tree and flat formats
        const vendor = node.vendor || node['Vendor'] || '';
        const orderQty = node.order_qty || node['Order Qty'] || '';
        const unitCost = node.unit_cost || node['Unit Cost'] || '';
        const pricePerBom = node.price_per_bom || node['Price/BOM'] || '';
        const poOrders = node.po_orders || node['PO Orders'] || '';
        const inventory = node.inventory || node['Inventory'] || '';
        const warehouseBox = node.warehouse_box_number || node['Warehouse Box'] || '';
        const ecoNumber = node.eco_number || node.bom_columns?.ECO_Number || node['ECO Number'] || '';
        const ecoDescription = node.eco_description || node.bom_columns?.ECO_Description || node['ECO Description'] || '';
        
        // Create ECO badge if ECO data exists
        let ecoBadge = '';
        if (ecoNumber) {
            const backwardCompatible = node['Backward Compatible'] !== undefined ? node['Backward Compatible'] : (node.backward_compatible !== undefined ? node.backward_compatible : node.bom_columns?.Backward_Compatible);
            const compatibleText = backwardCompatible ? 'Compatible' : 'Not Compatible';
            const compatibleClass = backwardCompatible ? 'bg-success' : 'bg-warning';
            
            // Use data attributes instead of inline onclick for safety
            ecoBadge = `<span class="badge ${compatibleClass} eco-badge" style="cursor: pointer;" 
                data-eco-number="${ecoNumber}" 
                data-eco-description="${ecoDescription}" 
                data-part-number="${partNumber}" 
                data-revision="${revision}" 
                data-backward-compatible="${backwardCompatible}"
                title="Click for ECO details - ${compatibleText}">${ecoNumber}</span>`;
        } else {
            ecoBadge = '<span class="text-muted">-</span>';
        }
        
        // Get IDs for editing functionality
        const partId = node.part_id || '';
        const bomPartId = node.bom_part_id || '';
        
        let row = '<tr class="' + levelClass + '" id="' + nodeId + '" data-level="' + level + '" data-parent="' + (parentId || '') + '" data-part-number="' + partNumber + '" data-part-id="' + partId + '" data-bom-part-id="' + bomPartId + '">' +
            '<td>' +
                '<input type="checkbox" class="node-checkbox" data-node-id="' + nodeId + '" ' +
                       'onchange="handleCheckboxChange(\'' + nodeId + '\')" ' +
                       (hasChildren ? 'data-has-children="true"' : '') + '>' +
            '</td>' +
            '<td class="read-only">' + typeBadge + '</td>' +
            '<td class="read-only">' + indent + arrow + '<strong>' + partNumber + '</strong>' + thumbnailIcon + pdfIcon + '</td>' +
            '<td class="read-only">' + revision + '</td>' +
            '<td class="read-only">' + ecoBadge + '</td>' +
            '<td class="read-only">' + description + '</td>' +
            '<td class="read-only">' + material + '</td>' +
            '<td class="read-only">' + finish1 + '</td>' +
            '<td class="read-only">' + finish2 + '</td>' +
            '<td class="read-only"><span class="badge bg-primary">' + qty + '</span></td>' +
            (function() {
                // Check window values at execution time, not at function definition time
                const isFloor = typeof window !== 'undefined' && window.currentUserRole === 'floor';
                const canEdit = typeof window !== 'undefined' && (window.currentUserRole === 'admin' || window.currentUserRole === 'engineer' || isFloor);
                // IMPORTANT: Check editModeEnabled at execution time, not capture it
                const isEditModeActive = typeof window !== 'undefined' && window.editModeEnabled === true;
                
                // For floor users, only allow editing inventory column; for admin/engineer, allow all
                const isInventoryField = (field) => field === 'inventory';
                const canEditField = (field) => {
                    if (isFloor) {
                        return isEditModeActive && isInventoryField(field);
                    }
                    return canEdit && isEditModeActive;
                };
                
                const makeEditableCell = (field, value, bomPartId = null) => {
                    const fieldEditable = canEditField(field);
                    const cursorStyle = fieldEditable ? 'cursor: text;' : ((canEdit || (isFloor && field === 'inventory')) && !isEditModeActive ? 'cursor: not-allowed;' : 'cursor: default;');
                    
                    // Special handling for inventory field with arrows in edit mode
                    let cellContent = String(value || '');
                    let cellStyle = `background: #f8f9fc; ${cursorStyle}`;
                    let cellClass = 'editable';
                    let finalContenteditableAttr = fieldEditable ? 'contenteditable="true"' : 'contenteditable="false"';
                    
                    
                    const styleAttr = `style="${cellStyle}"`;
                    const onblurAttr = fieldEditable ? 'onblur="saveInlineEdit(this)"' : '';
                    const oninputAttr = fieldEditable ? 'oninput="handleCellInput(this)"' : '';
                    const onfocusAttr = fieldEditable ? 'onfocus="handleCellFocus(this)"' : '';
                    let titleText = '';
                    if (isFloor && field !== 'inventory') {
                        titleText = 'title="Floor can only edit inventory column"';
                    } else if ((canEdit || (isFloor && field === 'inventory')) && !isEditModeActive) {
                        titleText = 'title="Enable Edit Mode to edit"';
                    }
                    const dataBomPartId = bomPartId ? `data-bom-part-id="${bomPartId}"` : '';
                    // Escape value for HTML attribute
                    const escapedValue = String(value || '').replace(/"/g, '&quot;');
                    return `<td class="${cellClass}" ${finalContenteditableAttr} data-field="${field}" data-part-number="${partNumber}" data-part-id="${partId}" ${dataBomPartId} data-original-value="${escapedValue}" ${onblurAttr} ${oninputAttr} ${onfocusAttr} ${styleAttr} ${titleText}>${cellContent}</td>`;
                };
                
                return makeEditableCell('vendor', vendor) +
                    makeEditableCell('order_qty', orderQty) +
                    makeEditableCell('unit_cost', unitCost) +
                    makeEditableCell('price_per_bom', pricePerBom, bomPartId) +
                    makeEditableCell('po_orders', poOrders) +
                    makeEditableCell('inventory', inventory) +
                    makeEditableCell('warehouse_box_number', warehouseBox);
            })() +
            '<td class="read-only"><span class="badge bg-success">' + state + '</span></td>' +
        '</tr>';
        
        // Render children (initially hidden)
        if (hasChildren) {
            for (let child of node.children) {
                row += renderNode(child, level + 1, nodeId);
            }
        }
        
        return row;
    }
    
    // Render the data - handle both tree and flat formats
    if (data) {
        if (data.items && Array.isArray(data.items)) {
            // Flat format from new API
            data.items.forEach(item => {
                html += renderNode(item);
            });
        } else if (data.children && Array.isArray(data.children)) {
            // Tree format
            data.children.forEach(child => {
                html += renderNode(child);
            });
        } else {
            // Single node format
            html += renderNode(data);
        }
    } else {
        html += '<tr>' +
            '<td colspan="17" class="text-center text-muted">' +
                '<i class="fas fa-info-circle me-2"></i>' +
                'No BOM data available' +
            '</td>' +
        '</tr>';
    }
    
    html += '</tbody></table></div>';
    
    return html;
}

// Enhanced filtering functions
function filterBOMByType(partType) {
    const table = document.getElementById('bomTable');
    if (!table) return;
    
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const typeCell = row.cells[1]; // Type column is now index 1
        if (typeCell) {
            const cellText = typeCell.textContent.toLowerCase();
            const shouldShow = partType === 'all' || cellText.includes(partType.toLowerCase());
            row.style.display = shouldShow ? '' : 'none';
        }
    });
}

function getBOMTypeStatistics() {
    const table = document.getElementById('bomTable');
    if (!table) return {};
    
    const typeCounts = {};
    const rows = table.querySelectorAll('tr');
    
    rows.forEach(row => {
        const typeCell = row.cells[1]; // Type column is now index 1
        if (typeCell && row.style.display !== 'none') {
            const typeText = typeCell.textContent.trim();
            typeCounts[typeText] = (typeCounts[typeText] || 0) + 1;
        }
    });
    
    return typeCounts;
}

// Enhanced search function that includes type column
function enhancedHighlightSearchResults(searchTerm) {
    if (!searchTerm) return 0;
    
    // Clear previous highlights first
    clearSearchHighlights();
    
    const table = document.getElementById('bomTable');
    if (!table) return 0;
    
    const rows = table.querySelectorAll('tr');
    let matchCount = 0;
    
    rows.forEach(row => {
        const cells = row.cells;
        if (!cells || cells.length < 2) return; // Skip if not enough cells
        
        // Check all relevant columns including the new Type column
        const partNumber = cells[2] ? cells[2].textContent.toLowerCase() : ''; // Part Number is now index 2
        const type = cells[1] ? cells[1].textContent.toLowerCase() : ''; // Type is now index 1
        const description = cells[4] ? cells[4].textContent.toLowerCase() : ''; // Description is now index 4
        const material = cells[5] ? cells[5].textContent.toLowerCase() : ''; // Material is now index 5
        const revision = cells[3] ? cells[3].textContent.toLowerCase() : ''; // Revision is now index 3
        
        const matches = partNumber.includes(searchTerm) || 
                       type.includes(searchTerm) ||
                       description.includes(searchTerm) || 
                       material.includes(searchTerm) || 
                       revision.includes(searchTerm);
        
        if (matches) {
            // Add highlight class to the entire row
            row.classList.add('search-highlight');
            matchCount++;
        }
    });
    
    return matchCount;
}

// Inline editing functions
let saveTimeout = null;
// Make saveTimeout accessible globally for clearing
window.saveTimeout = saveTimeout;

// Internal function to perform the actual save (used by both debounced and immediate saves)
async function performSaveInlineEdit(cell, skipDebounce = false) {
    // Track unsaved changes
    if (!cell.dataset.originalValue) {
        cell.dataset.originalValue = cell.textContent.trim();
    }
    
    const partNumber = cell.getAttribute('data-part-number');
    const field = cell.getAttribute('data-field');
    const value = cell.textContent.trim();
    
    // Skip if no change
    if (value === cell.dataset.originalValue) {
        return Promise.resolve();
    }
    
    // Show saving indicator
    cell.style.background = '#fff3cd';
    
    // Find the BOM item ID for this part number
    const currentBomId = window.currentBOMId;
    
    if (!currentBomId) {
        cell.style.background = '#f8d7da';
        setTimeout(() => cell.style.background = '#f8f9fc', 2000);
        return Promise.reject(new Error('No BOM ID available'));
    }
    
    // Define field types
    const partLevelFields = ['vendor', 'unit_cost', 'lead_time', 'inventory', 'warehouse_box_number', 'order_qty', 'po_orders', 'notes'];
    const bomPartLevelFields = ['quantity', 'price_per_bom', 'bom_notes'];
    
    // Determine if this is a Part-level or BOMPart-level field
    const isPartLevelField = partLevelFields.includes(field);
    const isBomPartLevelField = bomPartLevelFields.includes(field);
    
    if (!isPartLevelField && !isBomPartLevelField) {
        console.error('Unknown field type:', field);
        cell.style.background = '#f8d7da';
        setTimeout(() => cell.style.background = '#f8f9fc', 2000);
        return Promise.reject(new Error('Unknown field type'));
    }
    
    // Make API call to save the value
    
    if (isPartLevelField) {
        // For Part-level fields, we need to find the part ID first
        return fetch(`/api/bom-data-new/${currentBomId}?view_type=flat`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                throw new Error(data.error || 'Failed to load BOM data');
            }
            
            // Find the part with matching part number
            const part = data.flat_data.items.find(p => p['PART NUMBER'] === partNumber);
            
            if (!part) {
                throw new Error(`Part ${partNumber} not found in BOM`);
            }
            
            // Update the part
            const updateData = {};
            updateData[field] = value;
            
            return fetch(`/api/part/${part.part_id}/update`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update original value after successful save
                cell.dataset.originalValue = value;
                const cellId = `${cell.dataset.field || ''}_${cell.dataset.partNumber || ''}_${cell.dataset.partId || ''}`;
                if (window.unsavedChanges) {
                    window.unsavedChanges.delete(cellId);
                }
                
                // Show success
                cell.style.background = '#d4edda';
                setTimeout(() => cell.style.background = '#f8f9fc', 1000);
                
                // Add checkmark icon temporarily
                const checkmark = document.createElement('i');
                checkmark.className = 'fas fa-check text-success ms-2';
                checkmark.style.fontSize = '0.8em';
                cell.appendChild(checkmark);
                setTimeout(() => checkmark.remove(), 1000);
                
                // Show warning if multiple BOMs are affected
                if (data.affected_boms && data.affected_boms.length > 1) {
                    console.warn(`Part-level field updated. Affected BOMs: ${data.affected_boms.join(', ')}`);
                }
            } else {
                throw new Error(data.error || 'Save failed');
            }
        })
        .catch(error => {
            console.error('Error saving part-level field:', error);
            cell.style.background = '#f8d7da';
            setTimeout(() => cell.style.background = '#f8f9fc', 2000);
            throw error;
        });
        
    } else {
        // For BOMPart-level fields, use the new structure
        return fetch(`/api/bom-data-new/${currentBomId}?view_type=flat`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                throw new Error(data.error || 'Failed to load BOM data');
            }
            
            // Find the part with matching part number
            const part = data.flat_data.items.find(p => p['PART NUMBER'] === partNumber);
            
            if (!part) {
                throw new Error(`Part ${partNumber} not found in BOM`);
            }
            
            // Update the BOMPart
            const updateData = {};
            updateData[field] = value;
            
            return fetch(`/api/bom/item/${part.bom_part_id}/update`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update original value after successful save
                cell.dataset.originalValue = value;
                const cellId = `${cell.dataset.field || ''}_${cell.dataset.partNumber || ''}_${cell.dataset.partId || ''}`;
                if (window.unsavedChanges) {
                    window.unsavedChanges.delete(cellId);
                }
                
                // Show success
                cell.style.background = '#d4edda';
                setTimeout(() => cell.style.background = '#f8f9fc', 1000);
                
                // Add checkmark icon temporarily
                const checkmark = document.createElement('i');
                checkmark.className = 'fas fa-check text-success ms-2';
                checkmark.style.fontSize = '0.8em';
                cell.appendChild(checkmark);
                setTimeout(() => checkmark.remove(), 1000);
            } else {
                throw new Error(data.error || 'Save failed');
            }
        })
        .catch(error => {
            console.error('Error saving BOMPart-level field:', error);
            cell.style.background = '#f8d7da';
            setTimeout(() => cell.style.background = '#f8f9fc', 2000);
            throw error;
        });
    }
}

function saveInlineEdit(cell) {
    // Track unsaved changes
    if (!cell.dataset.originalValue) {
        cell.dataset.originalValue = cell.textContent.trim();
    }
    
    const cellId = `${cell.dataset.field || ''}_${cell.dataset.partNumber || ''}_${cell.dataset.partId || ''}`;
    if (!window.unsavedChanges) {
        window.unsavedChanges = new Set();
    }
    
    if (cell.textContent.trim() !== cell.dataset.originalValue) {
        window.unsavedChanges.add(cellId);
    } else {
        window.unsavedChanges.delete(cellId);
    }
    
    // Debounce save to avoid too many requests (only for onblur, not for saveAllEdits)
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        performSaveInlineEdit(cell);
    }, 500); // 500ms debounce
    // Keep window reference in sync
    window.saveTimeout = saveTimeout;
}

// Export the performSaveInlineEdit for use in saveAllEdits
window.performSaveInlineEdit = performSaveInlineEdit;

// Part type classification function (matches the Python logic)
function classifyPartType(partNumber, state, description) {
    if (!partNumber || partNumber === 'N/A') return 'Unknown';
    
    const partNum = partNumber.toString().toUpperCase();
    const stateStr = (state || '').toString().toLowerCase();
    const descStr = (description || '').toString().toLowerCase();
    
    // Check for 3D printing first
    if (is3DPrinting(stateStr, descStr)) {
        return '3D Printing part';
    }
    
    // Check part number patterns
    if (partNum.includes('-MP-')) return 'Mechanical part';
    if (partNum.includes('EL-')) return 'Inhouse electrical part';
    if (partNum.includes('ES-')) return 'External electrical part';
    if (partNum.includes('CB-')) return 'Cables';
    if (partNum.includes('ILM')) return 'Motors';
    if (partNum.includes('CSG') || partNum.includes('CPL')) return 'Gears';
    if (partNum.includes('-AS-')) return 'Assembly';
    
    // Check for specific bearing types
    if (partNum.includes('SRAU') || partNum.includes('SFT') || partNum.includes('SRBE')) {
        return 'Cross Roller Bearings';
    }
    
    // Check for bearing manufacturers
    if (partNum.includes('SKF') || partNum.includes('NSK') || partNum.includes('PCM') || 
        partNum.includes('FAG') || partNum.includes('INA') || partNum.includes('TIMKEN')) {
        return 'Bearings';
    }
    
    // Check for fastener standards
    if (partNum.includes('DIN') || partNum.includes('ISO') || partNum.includes('PEM') || 
        partNum.includes('M') || partNum.includes('UNC') || partNum.includes('UNF')) {
        return 'Fasteners';
    }
    
    return 'Unknown';
}

// Helper function to detect 3D printing
function is3DPrinting(state, description) {
    const combinedText = `${state} ${description}`.toLowerCase();
    const printingIndicators = ["3d", "3d print", "3d printing", "print", "printed"];
    return printingIndicators.some(indicator => combinedText.includes(indicator));
}

// ECO tooltip function
function showECOTooltip(ecoNumber, ecoDescription, partNumber, revision, backwardCompatible) {
    if (!ecoNumber) return;
    
    // Remove existing modal if it exists to avoid conflicts
    const existingModal = document.getElementById('ecoModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create new modal
    const modal = document.createElement('div');
    modal.id = 'ecoModal';
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="ecoModalTitle">ECO Information</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="row mb-3">
                        <div class="col-sm-3"><strong>Part Number:</strong></div>
                        <div class="col-sm-9" id="ecoPartNumber"></div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-sm-3"><strong>Revision:</strong></div>
                        <div class="col-sm-9" id="ecoRevision"></div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-sm-3"><strong>ECO Number:</strong></div>
                        <div class="col-sm-9" id="ecoNumber"></div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-sm-3"><strong>Description:</strong></div>
                        <div class="col-sm-9" id="ecoDescription"></div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-sm-3"><strong>Backward Compatible:</strong></div>
                        <div class="col-sm-9" id="ecoBackwardCompatible"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Set content with error checking and small delay to ensure DOM is ready
    setTimeout(() => {
        const titleElement = document.getElementById('ecoModalTitle');
        const partNumberElement = document.getElementById('ecoPartNumber');
        const revisionElement = document.getElementById('ecoRevision');
        const ecoNumberElement = document.getElementById('ecoNumber');
        const ecoDescriptionElement = document.getElementById('ecoDescription');
        const backwardCompatibleElement = document.getElementById('ecoBackwardCompatible');
        
        if (titleElement) titleElement.textContent = `ECO Information - ${partNumber}`;
        if (partNumberElement) partNumberElement.textContent = partNumber || 'Unknown';
        if (revisionElement) revisionElement.textContent = revision || 'N/A';
        if (ecoNumberElement) ecoNumberElement.textContent = ecoNumber || 'N/A';
        if (ecoDescriptionElement) ecoDescriptionElement.textContent = ecoDescription || 'No description available';
        
        if (backwardCompatibleElement) {
            const compatibleText = backwardCompatible ? 'Yes' : 'No';
            const compatibleClass = backwardCompatible ? 'text-success' : 'text-warning';
            backwardCompatibleElement.innerHTML = `<span class="${compatibleClass}"><strong>${compatibleText}</strong></span>`;
        }
    }, 10);
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    // Clean up modal when it's hidden
    modal.addEventListener('hidden.bs.modal', function() {
        modal.remove();
    });
}

// Add event delegation for ECO badge clicks
document.addEventListener('click', function(event) {
    if (event.target.classList.contains('eco-badge')) {
        const ecoNumber = event.target.getAttribute('data-eco-number');
        const ecoDescription = event.target.getAttribute('data-eco-description');
        const partNumber = event.target.getAttribute('data-part-number');
        const revision = event.target.getAttribute('data-revision');
        const backwardCompatible = event.target.getAttribute('data-backward-compatible') === 'true';
        
        showECOTooltip(ecoNumber, ecoDescription, partNumber, revision, backwardCompatible);
    }
});

// Export functions for use in the main template
window.createEnhancedBOMTreeHTML = createEnhancedBOMTreeHTML;
window.filterBOMByType = filterBOMByType;
window.getBOMTypeStatistics = getBOMTypeStatistics;
window.enhancedHighlightSearchResults = enhancedHighlightSearchResults;
window.saveInlineEdit = saveInlineEdit;
window.classifyPartType = classifyPartType;
window.showECOTooltip = showECOTooltip;
