// PDM Loading Enhancement for MenteeBOM Web Application
// This file provides enhanced loading experience for PDM operations

// Override the existing PDM import functions to use enhanced loading
document.addEventListener('DOMContentLoaded', function() {
    // Wait for the main functions to be available
    setTimeout(() => {
        enhancePDMImportFunctions();
    }, 1000);
});

function enhancePDMImportFunctions() {
    // Override processPDMImportByName function to use smooth modal transition
    if (typeof window.processPDMImportByName === 'function') {
        const originalProcessPDMImportByName = window.processPDMImportByName;
        window.processPDMImportByName = function() {
            // Use the enhanced version with smooth modal transition
            processPDMImportByNameWithLoading();
        };
    }
}

// Enhanced PDM Import Functions with Loading Modal
function processPDMImportWithLoading() {
    const assemblyPath = document.getElementById('pdmAssemblyPath').value.trim();
    const bomName = document.getElementById('pdmBomName').value.trim();
    const bomLayout = document.getElementById('pdmBomLayout').value;
    const configuration = document.getElementById('pdmConfiguration').value;
    const outputMode = document.getElementById('pdmOutputMode').value;

    if (!assemblyPath || !bomName) {
        showNotification('Please enter both assembly path and BOM name', 'warning');
        return;
    }

    const payload = { 
        assembly_path: assemblyPath, 
        bom_name: bomName, 
        bom_layout: bomLayout, 
        configuration, 
        output_mode: outputMode 
    };

    // Show enhanced loading modal
    showPDMLoadingModal('PDM Import');

    fetch('/api/pdm-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        // Hide loading modal
        hidePDMLoadingModal();
        
        if (data.success) {
            showNotification('PDM import completed successfully', 'success');
            document.getElementById('pdmImportModal').querySelector('.btn-close').click();
            document.getElementById('pdmImportForm').reset();
            loadBOMList();
            
            // If BOM data was returned, display it
            if (data.bom_data) {
                currentBOMData = data.bom_data;
                displayBOMTree(data.bom_data);
            }
        } else {
            showNotification('PDM import failed: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error importing from PDM:', error);
        hidePDMLoadingModal();
        showNotification('Error importing from PDM', 'error');
    });
}

function processPDMImportByNameWithLoading() {
    const partName = document.getElementById('pdmPartName').value.trim();
    const bomName = document.getElementById('pdmBomNameByName').value.trim();
    const bomLayout = document.getElementById('pdmBomLayoutByName').value;
    const configuration = document.getElementById('pdmConfigurationByName').value;
    const outputMode = document.getElementById('pdmOutputModeByName').value;

    if (!partName || !bomName) {
        showNotification('Please enter both part name and BOM name', 'warning');
        return;
    }

    const payload = { 
        part_name: partName, 
        bom_name: bomName, 
        bom_layout: bomLayout, 
        configuration, 
        output_mode: outputMode 
    };

    // Switch modal to loading state
    switchModalToLoading('pdmImportByNameModal', 'PDM Search & Import');

    fetch('/api/pdm-import-by-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('PDM Import Response:', data); // Debug log
        
        // Hide the modal completely (using same method as original)
        const modalElement = document.getElementById('pdmImportByNameModal');
        if (modalElement) {
            const closeButton = modalElement.querySelector('.btn-close');
            if (closeButton) {
                closeButton.click();
            } else {
                // Fallback to bootstrap modal instance
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) {
                    modal.hide();
                }
            }
        }
        
        // Check if data exists and has success property
        if (data && typeof data === 'object' && data.success === true) {
            showNotification('BOM imported successfully for part: ' + partName, 'success');
            
            // Reset form if it still exists
            const form = document.getElementById('pdmImportByNameForm');
            if (form) {
                form.reset();
            }
            
            // Load BOM list
            if (typeof loadBOMList === 'function') {
                loadBOMList();
            }
            
            // If BOM data was returned, display it
            if (data.bom_data && typeof displayBOMTree === 'function') {
                currentBOMData = data.bom_data;
                displayBOMTree(data.bom_data);
            }
        } else {
            // Handle different response formats
            const errorMsg = (data && data.error) ? data.error : 
                           (data && data.message) ? data.message : 
                           'Import completed but response format was unexpected';
            console.log('PDM Import Error:', errorMsg, 'Full response:', data);
            showNotification('PDM import issue: ' + errorMsg, 'warning');
        }
    })
    .catch(error => {
        console.error('Error importing from PDM by name:', error);
        
        // Hide the modal completely (using same method as original)
        const modalElement = document.getElementById('pdmImportByNameModal');
        if (modalElement) {
            const closeButton = modalElement.querySelector('.btn-close');
            if (closeButton) {
                closeButton.click();
            } else {
                // Fallback to bootstrap modal instance
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) {
                    modal.hide();
                }
            }
        }
        
        // Show appropriate error message
        const errorMsg = error.message || 'Network error occurred';
        showNotification('Error importing from PDM: ' + errorMsg, 'error');
    });
}

// Function to switch modal content to loading state
function switchModalToLoading(modalId, operation = 'Processing') {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    // Store original content for potential restoration
    const modalBody = modal.querySelector('.modal-body');
    const modalFooter = modal.querySelector('.modal-footer');
    
    if (modalBody) {
        modalBody.dataset.originalContent = modalBody.innerHTML;
    }
    if (modalFooter) {
        modalFooter.dataset.originalContent = modalFooter.innerHTML;
    }
    
    // Replace modal content with loading animation
    const loadingContent = `
        <div class="text-center py-5">
            <!-- Animated Icon -->
            <div class="mb-4">
                <div class="pdm-loading-icon">
                    <i class="fas fa-cogs fa-3x text-primary"></i>
                    <div class="loading-rings">
                        <div class="ring ring-1"></div>
                        <div class="ring ring-2"></div>
                        <div class="ring ring-3"></div>
                    </div>
                </div>
            </div>
            
            <!-- Title -->
            <h4 class="mb-3 text-primary">${operation} in Progress</h4>
            
            <!-- Simple Message -->
            <p class="mb-0 text-muted">Please wait while we process your request...</p>
        </div>
    `;
    
    // Update modal content
    if (modalBody) {
        modalBody.innerHTML = loadingContent;
    }
    if (modalFooter) {
        modalFooter.innerHTML = `
            <button type="button" class="btn btn-outline-secondary" onclick="cancelModalOperation('${modalId}')">
                <i class="fas fa-times me-1"></i>Cancel
            </button>
        `;
    }
    
    // Add CSS for animations if not already added
    addPDMLoadingStyles();
}

// Function to cancel modal operation and restore content
function cancelModalOperation(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    const modalBody = modal.querySelector('.modal-body');
    const modalFooter = modal.querySelector('.modal-footer');
    
    // Restore original content
    if (modalBody && modalBody.dataset.originalContent) {
        modalBody.innerHTML = modalBody.dataset.originalContent;
        delete modalBody.dataset.originalContent;
    }
    if (modalFooter && modalFooter.dataset.originalContent) {
        modalFooter.innerHTML = modalFooter.dataset.originalContent;
        delete modalFooter.dataset.originalContent;
    }
    
    // Hide modal
    const modalInstance = bootstrap.Modal.getInstance(modal);
    if (modalInstance) {
        modalInstance.hide();
    }
    
    showNotification('Operation cancelled by user', 'warning');
}

// Make functions globally available
window.processPDMImportWithLoading = processPDMImportWithLoading;
window.processPDMImportByNameWithLoading = processPDMImportByNameWithLoading;
window.switchModalToLoading = switchModalToLoading;
window.cancelModalOperation = cancelModalOperation;
