# MenteeBOM Permission System

This document describes the comprehensive role-based access control (RBAC) system implemented in MenteeBOM.

## Overview

The permission system provides three distinct user roles with different levels of access to system features:

- **Admin**: Full system access including user management and system configuration
- **Engineer**: Can import, export, create RFQ/PO, but cannot delete BOMs or manage users
- **Floor**: Can only view Dashboard and Assembly Tree pages

## User Roles

### Admin Role
- **Access Level**: Full administrative access
- **Permissions**:
  - Access admin panel
  - User management (create, edit, delete users)
  - System settings configuration
  - PDM integration configuration
  - BOM import, export, create, delete, view
  - RFQ/PO creation
  - All future administrative features

### Engineer Role
- **Access Level**: Operational access
- **Permissions**:
  - BOM import from PDM
  - BOM export (Google Sheets, CSV)
  - BOM creation and viewing
  - RFQ/PO creation
  - Cannot delete existing BOMs
  - Cannot access admin panel
  - Cannot manage users

### Floor Role
- **Access Level**: Limited access
- **Permissions**:
  - View Dashboard
  - View Assembly Tree
  - Cannot access Assembly BOM page
  - Cannot access Purchases page
  - Cannot import, export, create, or delete BOMs
  - Cannot create RFQ/PO
  - Cannot access admin panel

## Implementation Details

### Database Schema
The `User` model includes:
- `role`: String field with values 'admin', 'engineer', 'floor'
- `is_active`: Boolean field for account status
- Permission checking methods

### Permission Framework
Located in `permissions.py`, provides:
- Permission constants
- Role-permission mappings
- Decorator functions for route protection
- Utility functions for permission checking

### Key Files
- `app.py`: Main application with route decorators
- `permissions.py`: Permission framework and decorators
- `templates/admin.html`: Admin panel with role management
- `templates/assembly_bom.html`: BOM interface with role-based UI
- `templates/base.html`: Navigation with role-based visibility

## Usage Examples

### Route Protection
```python
from permissions import admin_required, engineer_required, bom_import_required

@app.route('/admin')
@admin_required
def admin_panel():
    return render_template('admin.html')

@app.route('/api/import-bom')
@bom_import_required
def import_bom():
    # Only engineers and admins can access
    pass
```

### Template Permission Checking
```html
{% if can_import_bom() %}
    <button class="btn btn-primary">Import BOM</button>
{% else %}
    <button class="btn btn-secondary" disabled>Import BOM</button>
{% endif %}
```

### JavaScript Permission Checking
```javascript
// In templates, use Jinja2 to pass user role
const userRole = '{{ current_user.role }}';
const canDelete = userRole === 'admin';
```

## API Endpoints and Permissions

### BOM Management
- `GET /api/bom-data`: All authenticated users
- `POST /api/bom-data`: Engineers and Admins
- `PUT /api/bom-data/<id>`: Engineers and Admins
- `DELETE /api/bom-data/<id>`: Admins only

### PDM Integration
- `POST /api/pdm-import`: Engineers and Admins
- `POST /api/pdm-import-by-name`: Engineers and Admins
- `GET /api/pdm-config`: All authenticated users
- `POST /api/pdm-config`: Admins only

### RFQ/PO
- `POST /api/mechanical-rfq`: Engineers and Admins

### User Management
- All `/api/users/*` endpoints: Admins only

## Security Features

### Frontend Security
- UI elements are disabled/hidden based on user role
- Clear visual indicators of user permissions
- Tooltips explaining permission restrictions

### Backend Security
- All API endpoints protected with permission decorators
- Server-side permission validation
- Proper HTTP status codes (401, 403) for unauthorized access

### Database Security
- Role validation on user creation/update
- Default role is 'floor' for new users
- Admin user auto-creation on first run

## Default Users

On first application startup, the system creates default users with configured passwords for each role:
- **admin** - Full access
- **engineer** - Operational access
- **floor** - Limited access (Dashboard and Assembly Tree only)

## Extending the Permission System

### Adding New Permissions
1. Add permission constant to `Permissions` class in `permissions.py`
2. Add permission to appropriate role in `ROLE_PERMISSIONS`
3. Create decorator if needed
4. Update UI templates to check new permission

### Adding New Roles
1. Add role to `ROLE_PERMISSIONS` in `permissions.py`
2. Update role hierarchy in `get_role_hierarchy()`
3. Add role to admin panel dropdown
4. Update UI templates for new role

### Adding New Features
1. Create permission constant
2. Add to appropriate roles
3. Protect routes with decorators
4. Update UI with permission checks

## Best Practices

1. **Always check permissions on both frontend and backend**
2. **Use descriptive permission names**
3. **Follow the principle of least privilege**
4. **Test permission boundaries thoroughly**
5. **Document new permissions and roles**
6. **Use consistent naming conventions**

## Troubleshooting

### Common Issues
1. **Permission denied errors**: Check user role and permission mapping
2. **UI elements not showing**: Verify template permission checks
3. **API access denied**: Check route decorators and user authentication

### Debugging
- Check user role in database
- Verify permission mappings in `permissions.py`
- Test with different user accounts
- Check browser console for JavaScript errors

## Future Enhancements

Potential improvements to the permission system:
- Fine-grained permissions (e.g., specific BOM access)
- Permission inheritance
- Time-based permissions
- Audit logging for permission changes
- Role-based UI customization
- Multi-tenant support
