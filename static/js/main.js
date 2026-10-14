// Main JavaScript file for MenteeBOM Web Application

// Global variables
let currentUser = null;
let apiBaseUrl = '';

// Toast notification system
function showNotification(message, type = 'info', duration = 5000) {
    const toastContainer = document.querySelector('.toast-container') || createToastContainer();
    
    const toastId = 'toast-' + Date.now();
    const iconClass = getIconForType(type);
    const bgClass = getBgClassForType(type);
    
    const toastHtml = `
        <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header ${bgClass} text-white">
                <i class="${iconClass} me-2"></i>
                <strong class="me-auto">${getTitleForType(type)}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    
    const toastElement = document.getElementById(toastId);
    const bsToast = new bootstrap.Toast(toastElement, {
        autohide: true,
        delay: duration
    });
    
    bsToast.show();
    
    // Remove toast element after it's hidden
    toastElement.addEventListener('hidden.bs.toast', function() {
        toastElement.remove();
    });
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.style.zIndex = '1055';
    document.body.appendChild(container);
    return container;
}

function getIconForType(type) {
    const icons = {
        'success': 'fas fa-check-circle',
        'error': 'fas fa-exclamation-circle',
        'warning': 'fas fa-exclamation-triangle',
        'info': 'fas fa-info-circle'
    };
    return icons[type] || icons['info'];
}

function getBgClassForType(type) {
    const bgClasses = {
        'success': 'bg-success',
        'error': 'bg-danger',
        'warning': 'bg-warning',
        'info': 'bg-info'
    };
    return bgClasses[type] || bgClasses['info'];
}

function getTitleForType(type) {
    const titles = {
        'success': 'Success',
        'error': 'Error',
        'warning': 'Warning',
        'info': 'Notification'
    };
    return titles[type] || titles['info'];
}

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // Set API base URL
    apiBaseUrl = window.location.origin;
    
    // Initialize tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Initialize popovers
    var popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    var popoverList = popoverTriggerList.map(function (popoverTriggerEl) {
        return new bootstrap.Popover(popoverTriggerEl);
    });
    
    // Add fade-in animation to cards
    addFadeInAnimation();
    
    // Initialize any page-specific functionality
    initializePageSpecific();
}

function addFadeInAnimation() {
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

function initializePageSpecific() {
    const currentPage = window.location.pathname;
    
    switch(currentPage) {
        case '/dashboard':
            initializeDashboard();
            break;
        case '/assembly-bom':
            initializeAssemblyBOM();
            break;
        case '/admin':
            initializeAdmin();
            break;
        default:
            break;
    }
}

// API Functions
async function apiCall(endpoint, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'same-origin'
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    try {
        const response = await fetch(`${apiBaseUrl}${endpoint}`, finalOptions);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }
    } catch (error) {
        console.error('API call failed:', error);
        showNotification('Error: ' + error.message, 'error');
        throw error;
    }
}

// Notification System
function showNotification(message, type = 'info', duration = 5000) {
    // Remove existing notifications of the same type (but keep errors)
    const existingNotifications = document.querySelectorAll('.custom-notification');
    existingNotifications.forEach(notification => {
        // Only remove non-error notifications, keep error notifications persistent
        if (!notification.classList.contains('alert-error') && type !== 'error') {
            notification.remove();
        }
    });
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `custom-notification alert alert-${type} alert-dismissible fade show`;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 99999;
        min-width: 350px;
        max-width: 500px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.25);
        border-radius: 10px;
        border: none;
        font-weight: 500;
        animation: slideInRight 0.3s ease-out;
    `;
    
    // Get icon based on type
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'warning') icon = 'exclamation-triangle';
    if (type === 'error') icon = 'times-circle';
    
    notification.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="fas fa-${icon} me-2" style="font-size: 1.2rem;"></i>
            <div class="flex-grow-1">${message}</div>
            <button type="button" class="btn-close ms-2" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto remove after duration (but not for error messages)
    if (type !== 'error') {
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, duration);
    }
}

// Loading Spinner
function showLoading(element, text = 'Loading...') {
    const originalContent = element.innerHTML;
    element.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        ${text}
    `;
    element.disabled = true;
    element.dataset.originalContent = originalContent;
}

function hideLoading(element) {
    if (element.dataset.originalContent) {
        element.innerHTML = element.dataset.originalContent;
        element.disabled = false;
        delete element.dataset.originalContent;
    }
}

// Enhanced Loading Modal for PDM Operations
let pdmLoadingModal = null;

function showPDMLoadingModal(operation = 'PDM Import') {
    // Remove existing modal if any
    hidePDMLoadingModal();
    
    // Create modal HTML
    const modalHtml = `
        <div class="modal fade" id="pdmLoadingModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-body text-center py-5">
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
                        
                        <!-- Cancel Button -->
                        <div class="mt-4">
                            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="cancelPDMOperation()">
                                <i class="fas fa-times me-1"></i>Cancel
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Show modal
    pdmLoadingModal = new bootstrap.Modal(document.getElementById('pdmLoadingModal'));
    pdmLoadingModal.show();
    
    // Add CSS for animations
    addPDMLoadingStyles();
}

function hidePDMLoadingModal() {
    if (pdmLoadingModal) {
        pdmLoadingModal.hide();
        pdmLoadingModal = null;
    }
    
    // Remove modal element
    const modalElement = document.getElementById('pdmLoadingModal');
    if (modalElement) {
        modalElement.remove();
    }
}

function cancelPDMOperation() {
    // This would need to be implemented with server-side cancellation
    showNotification('Operation cancelled by user', 'warning');
    hidePDMLoadingModal();
}

function addPDMLoadingStyles() {
    // Check if styles already added
    if (document.getElementById('pdmLoadingStyles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'pdmLoadingStyles';
    styles.textContent = `
        .pdm-loading-icon {
            position: relative;
            display: inline-block;
        }
        
        .pdm-loading-icon .fa-cogs {
            animation: rotate 2s linear infinite;
        }
        
        .loading-rings {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }
        
        .ring {
            position: absolute;
            border: 2px solid transparent;
            border-top: 2px solid #007bff;
            border-radius: 50%;
            animation: spin 2s linear infinite;
        }
        
        .ring-1 {
            width: 60px;
            height: 60px;
            top: -30px;
            left: -30px;
            animation-duration: 2s;
        }
        
        .ring-2 {
            width: 80px;
            height: 80px;
            top: -40px;
            left: -40px;
            animation-duration: 3s;
            animation-direction: reverse;
        }
        
        .ring-3 {
            width: 100px;
            height: 100px;
            top: -50px;
            left: -50px;
            animation-duration: 4s;
        }
        
        @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        
        
        #pdmLoadingModal .modal-content {
            border-radius: 15px;
        }
        
        #pdmLoadingModal .modal-body {
            padding: 3rem 2rem;
        }
    `;
    
    document.head.appendChild(styles);
}

// Form Validation
function validateForm(formElement) {
    const inputs = formElement.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;
    
    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.classList.add('is-invalid');
            isValid = false;
        } else {
            input.classList.remove('is-invalid');
        }
    });
    
    return isValid;
}

// File Upload Helper
function handleFileUpload(fileInput, allowedTypes = [], maxSize = 5 * 1024 * 1024) {
    const file = fileInput.files[0];
    
    if (!file) {
        return { success: false, message: 'No file selected' };
    }
    
    // Check file type
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
        return { 
            success: false, 
            message: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}` 
        };
    }
    
    // Check file size
    if (file.size > maxSize) {
        return { 
            success: false, 
            message: `File too large. Maximum size: ${Math.round(maxSize / 1024 / 1024)}MB` 
        };
    }
    
    return { success: true, file: file };
}

// Data Table Helper
function createDataTable(tableElement, options = {}) {
    const defaultOptions = {
        pageLength: 10,
        responsive: true,
        language: {
            search: "Search:",
            lengthMenu: "Show _MENU_ entries",
            info: "Showing _START_ to _END_ of _TOTAL_ entries",
            infoEmpty: "Showing 0 to 0 of 0 entries",
            infoFiltered: "(filtered from _MAX_ total entries)",
            paginate: {
                first: "First",
                last: "Last",
                next: "Next",
                previous: "Previous"
            }
        }
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    // Check if DataTables is available
    if (typeof $.fn.DataTable !== 'undefined') {
        return $(tableElement).DataTable(finalOptions);
    } else {
        console.warn('DataTables not loaded. Using basic table functionality.');
        return null;
    }
}

// Date/Time Helpers
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString();
}

function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return formatDate(dateString);
}

// Export Functions
function exportToCSV(data, filename = 'export.csv') {
    if (!data || data.length === 0) {
        showNotification('No data to export', 'warning');
        return;
    }
    
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => `"${row[header]}"`).join(','))
    ].join('\n');
    
    downloadFile(csvContent, filename, 'text/csv');
}

function exportToExcel(data, filename = 'export.xlsx') {
    // This would require a library like SheetJS
    showNotification('Excel export coming soon!', 'info');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Utility Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Page-specific initializations
function initializeDashboard() {
    // Dashboard-specific code will be added here
    console.log('Dashboard initialized');
}

function initializeAssemblyBOM() {
    // Assembly BOM-specific code will be added here
    console.log('Assembly BOM initialized');
}

function initializeAdmin() {
    // Admin-specific code will be added here
    console.log('Admin panel initialized');
}

// Global error handler
window.addEventListener('error', function(e) {
    console.error('Global error:', e.error);
    showNotification('An unexpected error occurred', 'error');
});

// Export functions for use in other scripts
window.MenteeBOM = {
    apiCall,
    showNotification,
    showLoading,
    hideLoading,
    showPDMLoadingModal,
    hidePDMLoadingModal,
    cancelPDMOperation,
    validateForm,
    handleFileUpload,
    createDataTable,
    formatDate,
    formatDateTime,
    timeAgo,
    exportToCSV,
    exportToExcel,
    debounce,
    throttle
};

