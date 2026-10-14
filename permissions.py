"""
Permission framework for MenteeBOM application.
Provides decorators and utilities for role-based access control.
"""

from functools import wraps
from flask import jsonify, request, current_app, redirect, url_for
from flask_login import current_user

# Define permission constants
class Permissions:
    # Admin permissions
    ADMIN_PANEL = 'admin_panel'
    USER_MANAGEMENT = 'user_management'
    SYSTEM_SETTINGS = 'system_settings'
    PDM_CONFIGURE = 'pdm_configure'
    
    # BOM permissions
    BOM_IMPORT = 'bom_import'
    BOM_EXPORT = 'bom_export'
    BOM_CREATE = 'bom_create'
    BOM_DELETE = 'bom_delete'
    BOM_VIEW = 'bom_view'
    BOM_EDIT = 'bom_edit'
    
    # RFQ/PO permissions
    RFQ_CREATE = 'rfq_create'
    PO_CREATE = 'po_create'
    
    # Future permissions can be added here
    REPORT_GENERATE = 'report_generate'
    AUDIT_LOG_VIEW = 'audit_log_view'
    BACKUP_CREATE = 'backup_create'
    BACKUP_RESTORE = 'backup_restore'

# Role hierarchy and permissions
ROLE_PERMISSIONS = {
    'admin': [
        # Admin permissions
        Permissions.ADMIN_PANEL,
        Permissions.USER_MANAGEMENT,
        Permissions.SYSTEM_SETTINGS,
        Permissions.PDM_CONFIGURE,
        
        # BOM permissions
        Permissions.BOM_IMPORT,
        Permissions.BOM_EXPORT,
        Permissions.BOM_CREATE,
        Permissions.BOM_DELETE,
        Permissions.BOM_VIEW,
        
        # RFQ/PO permissions
        Permissions.RFQ_CREATE,
        Permissions.PO_CREATE,
        
        # Future permissions
        Permissions.REPORT_GENERATE,
        Permissions.AUDIT_LOG_VIEW,
        Permissions.BACKUP_CREATE,
        Permissions.BACKUP_RESTORE,
    ],
    'engineer': [
        # BOM permissions
        Permissions.BOM_IMPORT,
        Permissions.BOM_EXPORT,
        Permissions.BOM_CREATE,
        Permissions.BOM_VIEW,
        
        # RFQ/PO permissions
        Permissions.RFQ_CREATE,
        Permissions.PO_CREATE,
    ],
    'floor_manager': [
        # BOM permissions
        Permissions.BOM_VIEW,
        Permissions.BOM_EDIT,
        # RFQ/PO permissions
        Permissions.RFQ_CREATE,
        Permissions.PO_CREATE,
        # Purchases permissions
        'purchases_view',
        'po_receive',
    ],
    'floor': [
        # BOM permissions
        Permissions.BOM_VIEW,
        # Purchases permissions (view, receive, split - no PO create or price edit)
        'purchases_view',
        'po_receive',
    ],
    'finance': [
        # BOM permissions (needed for BOM cost calculations)
        Permissions.BOM_VIEW,
        # Purchases permissions
        'purchases_view',
        Permissions.RFQ_CREATE,
        Permissions.PO_CREATE,
        'po_receive',
    ],
    'system': [
        # Same as finance
        Permissions.BOM_VIEW,
        'purchases_view',
        Permissions.RFQ_CREATE,
        Permissions.PO_CREATE,
        'po_receive',
        # Plus robot assembly access
        'robot_assembly',
    ],
    'viewer': [
        # Read-only integration/audit account (e.g. the logistics nightly part
        # sync). app.py's block_viewer_writes() rejects every non-GET request.
        Permissions.BOM_VIEW,
        'purchases_view',
    ]
}

def has_permission(permission):
    """
    Check if the current user has a specific permission.
    
    Args:
        permission (str): The permission to check
        
    Returns:
        bool: True if user has permission, False otherwise
    """
    if not current_user.is_authenticated:
        return False
    
    user_role = getattr(current_user, 'role', 'floor')
    return permission in ROLE_PERMISSIONS.get(user_role, [])

def require_permission(permission):
    """
    Decorator to require a specific permission for a route.
    
    Args:
        permission (str): The permission required
        
    Returns:
        function: Decorated route function
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                if request.is_json:
                    return jsonify({'success': False, 'error': 'Authentication required'}), 401
                return redirect(url_for('login'))
            
            if not has_permission(permission):
                if request.is_json:
                    return jsonify({'success': False, 'error': f'Permission denied. Required: {permission}'}), 403
                return jsonify({'success': False, 'error': 'Access denied'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def require_role(role):
    """
    Decorator to require a specific role for a route.
    
    Args:
        role (str): The role required ('admin', 'engineer', 'finance', 'floor_manager', 'floor')
        
    Returns:
        function: Decorated route function
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                if request.is_json:
                    return jsonify({'success': False, 'error': 'Authentication required'}), 401
                return redirect(url_for('login'))
            
            user_role = getattr(current_user, 'role', 'floor')
            if user_role != role:
                if request.is_json:
                    return jsonify({'success': False, 'error': f'Role required: {role}'}), 403
                return jsonify({'success': False, 'error': 'Access denied'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def require_any_role(*roles):
    """
    Decorator to require any of the specified roles for a route.
    
    Args:
        *roles: Variable number of role strings
        
    Returns:
        function: Decorated route function
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                if request.is_json:
                    return jsonify({'success': False, 'error': 'Authentication required'}), 401
                return redirect(url_for('login'))
            
            user_role = getattr(current_user, 'role', 'floor')
            if user_role not in roles:
                if request.is_json:
                    return jsonify({'success': False, 'error': f'One of these roles required: {", ".join(roles)}'}), 403
                return jsonify({'success': False, 'error': 'Access denied'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def get_user_permissions():
    """
    Get all permissions for the current user.
    
    Returns:
        list: List of permission strings
    """
    if not current_user.is_authenticated:
        return []
    
    user_role = getattr(current_user, 'role', 'floor')
    return ROLE_PERMISSIONS.get(user_role, [])

def get_role_hierarchy():
    """
    Get the role hierarchy for permission checking.
    
    Returns:
        dict: Role hierarchy mapping
    """
    return {
        'admin': 3,          # Highest level
        'engineer': 2,       # Medium level
        'finance': 2.5,      # Between engineer and admin
        'system': 2.5,       # Same level as finance + robot assembly
        'floor_manager': 1.5, # Between floor and engineer
        'floor': 1,          # Lowest operational level
        'viewer': 1          # Same view level as floor; writes blocked by app.block_viewer_writes()
    }

def can_access_feature(feature):
    """
    Check if user can access a specific feature based on role hierarchy.
    
    Args:
        feature (str): The feature to check access for
        
    Returns:
        bool: True if user can access feature
    """
    if not current_user.is_authenticated:
        return False
    
    user_role = getattr(current_user, 'role', 'floor')
    hierarchy = get_role_hierarchy()
    
    # Define feature access levels
    feature_levels = {
        'admin_panel': 3,      # Admin only
        'user_management': 3,   # Admin only
        'bom_import': 2,       # Engineer and above
        'bom_export': 2,       # Engineer and above
        'bom_delete': 3,       # Admin only
        'bom_view': 1,         # All users
        'rfq_create': 2,       # Engineer and above
        'po_create': 2,        # Engineer and above
    }
    
    required_level = feature_levels.get(feature, 3)  # Default to admin level
    user_level = hierarchy.get(user_role, 1)
    
    return user_level >= required_level

# Convenience decorators for common permissions
admin_required = require_role('admin')
engineer_required = require_any_role('admin', 'engineer')
floor_required = require_any_role('admin', 'engineer', 'floor')

# Permission-specific decorators
admin_panel_required = require_permission(Permissions.ADMIN_PANEL)
bom_import_required = require_permission(Permissions.BOM_IMPORT)
bom_export_required = require_permission(Permissions.BOM_EXPORT)
bom_delete_required = require_permission(Permissions.BOM_DELETE)
rfq_create_required = require_permission(Permissions.RFQ_CREATE)
po_create_required = require_permission(Permissions.PO_CREATE)
