// Purchases Tab JavaScript
// Handles RFQ and PO tables, PO creation, and inventory updates

let currentRFQId = null;
let currentPOId = null;
let currentUserRole = null;

// Load RFQs on page load
document.addEventListener('DOMContentLoaded', function() {
    loadUserRole();
    loadRFQs();
    loadPOs();
});

// Load current user role
function loadUserRole() {
    // Get user role from body data attribute if available
    const bodyElement = document.body;
    if (bodyElement && bodyElement.dataset.userRole) {
        currentUserRole = bodyElement.dataset.userRole;
    } else {
        // Fallback: try to fetch from API
        fetch('/api/user-info')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    currentUserRole = data.user.role;
                }
            })
            .catch(error => {
                console.error('Error loading user role:', error);
            });
    }
}

// Load RFQs
function loadRFQs() {
    fetch('/api/rfqs')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                renderRFQTable(data.rfqs);
            } else {
                showError('Failed to load RFQs: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error loading RFQs:', error);
            showError('Error loading RFQs');
        });
}

// Render RFQ Table
function renderRFQTable(rfqs) {
    const tbody = document.getElementById('rfqTableBody');
    
    if (rfqs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    <i class="fas fa-inbox fa-2x mb-2"></i>
                    <p class="mb-0">No RFQs found</p>
                    <small>Create an RFQ to get started</small>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = rfqs.map(rfq => {
        const statusClass = rfq.status === 'active' ? 'status-active' : 
                           rfq.status === 'converted_to_po' ? 'status-converted' : 'status-cancelled';
        const statusText = rfq.status === 'active' ? 'Active' : 
                          rfq.status === 'converted_to_po' ? 'Converted to PO' : 'Cancelled';
        
        const poButtonDisabled = rfq.status === 'converted_to_po' ? 'disabled' : '';
        
        const notesText = rfq.excluded_parts_note ? 
            `<small class="text-muted" title="${escapeHtml(rfq.excluded_parts_note)}">Excluded parts</small>` : 
            '<small class="text-muted">-</small>';
        
        return `
            <tr>
                <td>${escapeHtml(rfq.bom_name || 'N/A')}</td>
                <td>${escapeHtml(rfq.bom_revision || 'N/A')}</td>
                <td>${escapeHtml(rfq.rfq_name)}</td>
                <td>${formatDate(rfq.created_date)}</td>
                <td>${rfq.parts_count}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${notesText}</td>
                <td>
                    ${currentUserRole === 'floor' ? 
                        `<button class="btn btn-sm btn-outline-secondary me-1" disabled title="Floor cannot create PO">
                            <i class="fas fa-file-invoice"></i> PO
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" disabled title="Floor cannot delete RFQ">
                            <i class="fas fa-trash"></i>
                        </button>` :
                        `<button class="btn btn-sm btn-success me-1" ${poButtonDisabled} onclick="openPOCreationModal(${rfq.id})" title="Create PO">
                            <i class="fas fa-file-invoice"></i> PO
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteRFQ(${rfq.id})" title="Delete RFQ">
                            <i class="fas fa-trash"></i>
                        </button>`
                    }
                </td>
            </tr>
        `;
    }).join('');
}

// Open PO Creation Modal
function openPOCreationModal(rfqId) {
    currentRFQId = rfqId;
    
    // Clear form
    document.getElementById('poNumber').value = '';
    document.getElementById('vendor').value = '';
    document.getElementById('quotationFile').value = '';
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('poCreationModal'));
    modal.show();
}

// Submit PO Creation
function submitPOCreation() {
    const poNumber = document.getElementById('poNumber').value.trim();
    const vendor = document.getElementById('vendor').value.trim();
    const quotationFile = document.getElementById('quotationFile');
    
    if (!poNumber || !vendor) {
        showError('PO number and vendor are required');
        return;
    }
    
    // Show loading
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Processing...';
    button.disabled = true;
    
    // Create form data
    const formData = new FormData();
    formData.append('po_number', poNumber);
    formData.append('vendor', vendor);
    
    // Add quotation files if any
    if (quotationFile.files.length > 0) {
        for (let i = 0; i < quotationFile.files.length; i++) {
            formData.append('quotation', quotationFile.files[i]);
        }
    }
    
    // Send request to validate_prices endpoint
    fetch(`/api/rfqs/${currentRFQId}/validate_prices`, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close PO creation modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('poCreationModal'));
            modal.hide();
            
            // Open price validation modal
            openPriceValidationModal(currentRFQId, data);
        } else {
            showError('Failed to process quotations: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error creating PO:', error);
        showError('Error creating PO');
    })
    .finally(() => {
        // Reset button
        button.innerHTML = originalText;
        button.disabled = false;
    });
}

// Load POs
function loadPOs() {
    fetch('/api/pos')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                renderPOTable(data.pos);
            } else {
                showError('Failed to load POs: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error loading POs:', error);
            showError('Error loading POs');
        });
}

// Render PO Table
function renderPOTable(pos) {
    const tbody = document.getElementById('poTableBody');
    
    if (pos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center text-muted py-4">
                    <i class="fas fa-inbox fa-2x mb-2"></i>
                    <p class="mb-0">No POs found</p>
                    <small>Create a PO from an RFQ to get started</small>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = pos.map(po => {
        const statusClass = po.status === 'pending' ? 'status-pending' : 
                           po.status === 'sent_to_vendor' ? 'status-sent' :
                           po.status === 'received' ? 'status-received' : 'status-cancelled';
        const statusText = po.status === 'pending' ? 'Pending' : 
                          po.status === 'sent_to_vendor' ? 'Sent to Vendor' :
                          po.status === 'received' ? 'Received' : 'Cancelled';
        
        const receivedCheckbox = po.po_received ? 'checked' : '';
        const receivedDisabled = po.po_received ? 'disabled' : '';
        
        return `
            <tr>
                <td>${escapeHtml(po.po_number)}</td>
                <td>${escapeHtml(po.bom_name || 'N/A')}</td>
                <td>${escapeHtml(po.bom_revision || 'N/A')}</td>
                <td>${escapeHtml(po.vendor)}</td>
                <td>${formatDate(po.po_date)}</td>
                <td>$${(po.total_cost || 0).toFixed(2)}</td>
                <td>${po.parts_count || 0}</td>
                <td>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" ${receivedCheckbox} 
                               onchange="togglePOReceived(${po.id}, this.checked)" 
                               ${receivedDisabled || currentUserRole === 'floor' ? 'disabled' : ''}>
                        <label class="form-check-label">
                            ${po.po_received ? 'Received' : 'Pending'}
                        </label>
                    </div>
                </td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    ${currentUserRole === 'floor' ? 
                        `<button class="btn btn-sm btn-outline-secondary me-1" disabled title="Floor cannot modify PO">
                            <i class="fas fa-lock"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" disabled title="Floor cannot delete PO">
                            <i class="fas fa-trash"></i>
                        </button>` :
                        `${po.po_received && currentUserRole === 'admin' ? 
                            `<button class="btn btn-sm btn-info me-1" onclick="undoPOReceived(${po.id})" title="Undo Received Status (Admin Only)">
                                <i class="fas fa-undo"></i> Undo Received
                            </button>` : ''
                        }
                        <button class="btn btn-sm btn-danger" onclick="deletePO(${po.id})" title="Delete PO">
                            <i class="fas fa-trash"></i>
                        </button>`
                    }
                </td>
            </tr>
        `;
    }).join('');
}

// Delete RFQ
function deleteRFQ(rfqId) {
    if (confirm('Are you sure you want to delete this RFQ? This action cannot be undone.')) {
        fetch(`/api/rfqs/${rfqId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccess('RFQ deleted successfully');
                loadRFQs();
            } else {
                showError('Failed to delete RFQ: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting RFQ:', error);
            showError('Error deleting RFQ');
        });
    }
}

// Mark PO as sent to vendor (removed - POs now start with 'pending' status)
// This function is kept for backward compatibility but is no longer used

// Delete PO
function deletePO(poId) {
    if (confirm('Are you sure you want to delete this PO? This action cannot be undone.')) {
        fetch(`/api/pos/${poId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccess('PO deleted successfully');
                loadPOs();
            } else {
                showError('Failed to delete PO: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting PO:', error);
            showError('Error deleting PO');
        });
    }
}

// Toggle PO Received
function togglePOReceived(poId, isReceived) {
    if (isReceived && !confirm('Are you sure you want to mark this PO as received? This will update inventory and cannot be undone.')) {
        // Reset checkbox if user cancels
        const checkbox = event.target;
        checkbox.checked = false;
        return;
    }
    
    fetch(`/api/pos/${poId}/mark_received`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showSuccess(isReceived ? 'PO marked as received and inventory updated' : 'PO marked as pending');
            loadPOs();
        } else {
            showError('Failed to update PO status: ' + (data.error || 'Unknown error'));
            // Reset checkbox on error
            const checkbox = event.target;
            checkbox.checked = !isReceived;
        }
    })
    .catch(error => {
        console.error('Error updating PO status:', error);
        showError('Error updating PO status');
        // Reset checkbox on error
        const checkbox = event.target;
        checkbox.checked = !isReceived;
    });
}

function undoPOReceived(poId) {
    if (!confirm('Are you sure you want to undo the received status? This will subtract from inventory and order quantity.')) {
        return;
    }
    
    fetch(`/api/pos/${poId}/undo_received`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showSuccess('PO received status undone and inventory/order_qty updated');
            loadPOs();
        } else {
            showError('Failed to undo PO received status: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error undoing PO received status:', error);
        showError('Error undoing PO received status');
    });
}

// Refresh functions
function refreshRFQs() {
    loadRFQs();
}

function refreshPOs() {
    loadPOs();
}

// Utility functions
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(message) {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'toast show position-fixed top-0 end-0 m-3';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="toast-header bg-danger text-white">
            <i class="fas fa-exclamation-circle me-2"></i>
            <strong class="me-auto">Error</strong>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">${escapeHtml(message)}</div>
    `;
    document.body.appendChild(toast);
    
    const bsToast = new bootstrap.Toast(toast, { autohide: true, delay: 5000 });
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
}

function showSuccess(message) {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'toast show position-fixed top-0 end-0 m-3';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="toast-header bg-success text-white">
            <i class="fas fa-check-circle me-2"></i>
            <strong class="me-auto">Success</strong>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">${escapeHtml(message)}</div>
    `;
    document.body.appendChild(toast);
    
    const bsToast = new bootstrap.Toast(toast, { autohide: true, delay: 3000 });
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
}

// Price Validation Modal Functions
let currentValidationData = null;
let currentPONumber = null;
let currentVendor = null;
let excludedParts = []; // Track parts removed from PO

function openPriceValidationModal(rfqId, validationData) {
    currentRFQId = rfqId;
    currentValidationData = validationData;
    currentPONumber = validationData.po_number;
    currentVendor = validationData.vendor;
    
    // Reset excluded parts for new PO
    excludedParts = [];
    
    // Update modal title
    document.getElementById('poNumberDisplay').textContent = currentPONumber;
    
    // Populate the table
    refreshPriceTable(validationData);
    
    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('priceValidationModal'));
    modal.show();
}

function refreshPriceTable(validationData) {
    const tbody = document.getElementById('priceValidationTableBody');
    tbody.innerHTML = '';
    
    validationData.parts.forEach((part, index) => {
        const row = document.createElement('tr');
        row.className = 'part-row';
        row.dataset.partNumber = part.part_number;
        
        // Unit Cost cell
        let unitCostCell = '';
        if (part.has_price) {
            if (part.price_options.length > 1) {
                // Multiple prices - show dropdown
                unitCostCell = `
                    <select class="form-select price-dropdown" onchange="selectPriceOption('${part.part_number}', this.value)">
                        ${part.price_options.map((option, idx) => `
                            <option value="${idx}" ${idx === 0 ? 'selected' : ''}>
                                $${option.unit_cost} (${option.source_file})
                            </option>
                        `).join('')}
                    </select>
                `;
            } else {
                // Single price - show input
                unitCostCell = `
                    <input type="number" class="form-control price-input" 
                           value="${part.unit_cost || ''}" 
                           step="0.01" 
                           onchange="updatePartPrice('${part.part_number}', this.value)">
                `;
            }
        } else {
            // No price - show input with red border
            unitCostCell = `
                <input type="number" class="form-control price-input price-missing" 
                       placeholder="Enter price" 
                       step="0.01" 
                       onchange="updatePartPrice('${part.part_number}', this.value)">
                <small class="text-danger">Missing Price</small>
            `;
        }
        
        // Total Cost calculation - using BOM quantity
        const totalCost = part.unit_cost && part.quantity ? (part.unit_cost * part.quantity).toFixed(2) : '0.00';
        
        // Revision display - show update if revision was updated
        let revisionDisplay = escapeHtml(part.revision);
        if (part.revision_updated && part.old_revision) {
            revisionDisplay = `<span title="Revision updated from ${escapeHtml(part.old_revision)} to ${escapeHtml(part.revision)}">${escapeHtml(part.old_revision)} → ${escapeHtml(part.revision)}</span> <span class="badge bg-info" title="Revision updated">Updated</span>`;
        }
        
        row.innerHTML = `
            <td>${escapeHtml(part.part_number)}</td>
            <td>${revisionDisplay}</td>
            <td>${part.quantity}</td>
            <td>${unitCostCell}</td>
            <td>$${totalCost}</td>
            <td>
                <button class="remove-part-btn" onclick="removePart('${part.part_number}')" title="Remove from PO">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    // Update summary
    updateSummary(validationData);
}

function selectPriceOption(partNumber, optionIndex) {
    const part = currentValidationData.parts.find(p => p.part_number === partNumber);
    if (part && part.price_options[optionIndex]) {
        const selectedOption = part.price_options[optionIndex];
        part.unit_cost = selectedOption.unit_cost;
        part.total_cost = part.unit_cost * part.quantity; // Using BOM quantity
        
        // Update the input field
        const row = document.querySelector(`tr[data-part-number="${partNumber}"]`);
        const input = row.querySelector('.price-input');
        if (input) {
            input.value = part.unit_cost;
            input.classList.remove('price-missing');
        }
        
        // Update total cost
        const totalCostCell = row.querySelector('td:nth-child(7)');
        totalCostCell.textContent = `$${part.total_cost.toFixed(2)}`;
        
        // Update summary
        updateSummary(currentValidationData);
    }
}

function updatePartPrice(partNumber, price) {
    const part = currentValidationData.parts.find(p => p.part_number === partNumber);
    if (part) {
        part.unit_cost = parseFloat(price) || 0;
        part.total_cost = part.unit_cost * part.quantity; // Using BOM quantity
        part.has_price = part.unit_cost > 0;
        
        // Update total cost display
        const row = document.querySelector(`tr[data-part-number="${partNumber}"]`);
        const totalCostCell = row.querySelector('td:nth-child(7)');
        totalCostCell.textContent = `$${part.total_cost.toFixed(2)}`;
        
        // Update input styling
        const input = row.querySelector('.price-input');
        if (input) {
            if (part.has_price) {
                input.classList.remove('price-missing');
            } else {
                input.classList.add('price-missing');
            }
        }
        
        // Update summary
        updateSummary(currentValidationData);
    }
}

function removePart(partNumber) {
    if (confirm(`Are you sure you want to remove ${partNumber} from this PO?`)) {
        // Find the part to remove
        const partToRemove = currentValidationData.parts.find(p => p.part_number === partNumber);
        
        if (partToRemove) {
            // Add to excluded parts list
            excludedParts.push({
                part_number: partToRemove.part_number,
                revision: partToRemove.revision,
                quantity: partToRemove.quantity
            });
            
            // Remove from validation data
            currentValidationData.parts = currentValidationData.parts.filter(p => p.part_number !== partNumber);
            
            // Refresh the table
            refreshPriceTable(currentValidationData);
            
            showSuccess(`Part ${partNumber} removed from PO`);
        }
    }
}

function uploadAdditionalQuotation() {
    const fileInput = document.getElementById('additionalQuotationFiles');
    const files = fileInput.files;
    
    if (files.length === 0) {
        showError('Please select at least one quotation file');
        return;
    }
    
    // Show loading
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Processing...';
    button.disabled = true;
    
    // Create form data
    const formData = new FormData();
    formData.append('rfq_id', currentRFQId);
    formData.append('vendor', currentVendor);
    
    for (let i = 0; i < files.length; i++) {
        formData.append('quotation', files[i]);
    }
    
    // Send request
    fetch('/api/quotations/process_additional', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update validation data with new prices
            currentValidationData = data;
            refreshPriceTable(data);
            showSuccess(`Processed ${files.length} quotation file(s)`);
        } else {
            showError('Failed to process quotations: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error uploading quotations:', error);
        showError('Error uploading quotations');
    })
    .finally(() => {
        // Reset button
        button.innerHTML = originalText;
        button.disabled = false;
        fileInput.value = '';
    });
}

function updateSummary(validationData) {
    const totalParts = validationData.parts.length;
    const partsWithPrices = validationData.parts.filter(p => p.has_price).length;
    const missingPrices = totalParts - partsWithPrices;
    const totalCost = validationData.parts.reduce((sum, part) => sum + (part.total_cost || 0), 0);
    
    document.getElementById('totalPartsCount').textContent = totalParts;
    document.getElementById('partsWithPricesCount').textContent = partsWithPrices;
    document.getElementById('missingPricesCount').textContent = missingPrices;
    document.getElementById('totalPOCost').textContent = `$${totalCost.toFixed(2)}`;
    
    // Enable/disable Export PO button
    checkAllPricesValid();
}

function checkAllPricesValid() {
    const exportButton = document.getElementById('exportPOButton');
    const missingPrices = currentValidationData.parts.filter(p => !p.has_price).length;
    
    if (missingPrices === 0 && currentValidationData.parts.length > 0) {
        exportButton.disabled = false;
        exportButton.classList.remove('btn-secondary');
        exportButton.classList.add('btn-success');
    } else {
        exportButton.disabled = true;
        exportButton.classList.remove('btn-success');
        exportButton.classList.add('btn-secondary');
    }
}

function exportFinalPO() {
    if (!currentValidationData || currentValidationData.parts.length === 0) {
        showError('No parts selected for PO');
        return;
    }
    
    const missingPrices = currentValidationData.parts.filter(p => !p.has_price).length;
    if (missingPrices > 0) {
        showError(`Cannot export PO: ${missingPrices} parts are missing prices`);
        return;
    }
    
    // Show loading
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Exporting...';
    button.disabled = true;
    
    // Prepare data
    const partsWithPrices = currentValidationData.parts.filter(p => p.has_price);
    // Use the global excludedParts array that tracks removed parts
    
    const requestData = {
        po_number: currentPONumber,
        vendor: currentVendor,
        parts_with_prices: partsWithPrices,
        excluded_parts: excludedParts
    };
    
    // Send request
    fetch(`/api/rfqs/${currentRFQId}/create_po_final`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('priceValidationModal'));
            modal.hide();
            
            // Show success message with Google Drive link
            showPOCreationSuccess(data);
            
            // Refresh tables
            loadRFQs();
            loadPOs();
        } else {
            showError('Failed to create PO: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error creating PO:', error);
        showError('Error creating PO');
    })
    .finally(() => {
        // Reset button
        button.innerHTML = originalText;
        button.disabled = false;
    });
}

function showPOCreationSuccess(data) {
    // Create a custom modal for PO success
    const modalHtml = `
        <div class="modal fade" id="poSuccessModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-check-circle me-2"></i>PO Created Successfully!
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body text-center">
                        <p><strong>PO Number:</strong> ${data.po_number}</p>
                        <p><strong>Total Cost:</strong> $${data.total_cost.toFixed(2)}</p>
                        <p><strong>Parts Count:</strong> ${data.summary.parts_count}</p>
                        <div class="mt-3">
                            <a href="${data.google_drive.folder_url}" target="_blank" class="btn btn-primary">
                                <i class="fas fa-external-link-alt me-1"></i>Open Google Drive Folder
                            </a>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('poSuccessModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('poSuccessModal'));
    modal.show();
}
