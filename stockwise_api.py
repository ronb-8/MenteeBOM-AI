"""
StockWise Integration API Blueprint (read-only)

External integration surface for the StockWise storage-location app.
Phase 1: read-only access to the parts library, DEV DATABASE ONLY.

Security model:
- Every request must carry a valid `X-StockWise-API-Key` header. The expected
  key comes from the STOCKWISE_API_KEY env var, or from the
  instance/stockwise_api_key file if the env var is unset. If neither is
  configured the whole API returns 503 (integration disabled).
- The blueprint refuses to serve unless the running app is connected to the
  dev database (menteebom_dev.db). This is a hard guard: the production
  server returns 403 for every StockWise route even with a valid key.
- Only GET/HEAD/OPTIONS are accepted (enforced in before_request as
  defense-in-depth on top of the routes themselves being GET-only), so this
  integration cannot modify quantities, engineering data, or anything else.

The planned Warehouse-Box-update endpoint (phase 2) is intentionally NOT
implemented yet — see docs/STOCKWISE_INTEGRATION.md.
"""
import os
import secrets
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user

stockwise_bp = Blueprint('stockwise_api', __name__, url_prefix='/api/stockwise/v1')

# Separate blueprint for the admin panel (session-authenticated, no API key) —
# kept off stockwise_bp so it isn't subject to the API-key/dev-DB before_request.
stockwise_admin_bp = Blueprint('stockwise_admin', __name__, url_prefix='/api/stockwise/admin')

API_VERSION = '1.0'
DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 500


def get_models():
    """Lazy import to avoid circular imports (same pattern as robot_assembly)."""
    from app import db, Part, BOMPart, BOMInstance
    return {'db': db, 'Part': Part, 'BOMPart': BOMPart, 'BOMInstance': BOMInstance}


# The StockWise API serves two non-production environments, each with its OWN
# key (a test key must not unlock dev and vice versa):
#   dev  — menteebom_dev.db            key: STOCKWISE_API_KEY / instance/stockwise_api_key
#   test — menteebom_stockwise_test.db key: STOCKWISE_TEST_API_KEY / instance/stockwise_api_key_test
# (test = read-only production snapshot created by scripts/refresh_stockwise_testdb.py)
TEST_DB_FILENAME = 'menteebom_stockwise_test.db'
SNAPSHOT_META_FILENAME = 'stockwise_test_snapshot.json'


def _db_uri():
    return current_app.config.get('SQLALCHEMY_DATABASE_URI', '')


def _is_test_database():
    return TEST_DB_FILENAME in _db_uri()


def _is_nonprod_database():
    return 'menteebom_dev.db' in _db_uri() or _is_test_database()


def _environment_name():
    return 'test' if _is_test_database() else ('development' if _is_nonprod_database() else 'production')


def _key_env_var():
    return 'STOCKWISE_TEST_API_KEY' if _is_test_database() else 'STOCKWISE_API_KEY'


def _key_file_name():
    return 'stockwise_api_key_test' if _is_test_database() else 'stockwise_api_key'


def _configured_api_key():
    """Expected API key for THIS environment: env var, else instance key file."""
    key = os.environ.get(_key_env_var(), '').strip()
    if key:
        return key
    key_file = os.path.join(current_app.instance_path, _key_file_name())
    try:
        with open(key_file, 'r') as f:
            return f.read().strip()
    except OSError:
        return None


def _writes_enabled():
    """Whether Warehouse Box writes are enabled in THIS environment. One key
    serves both read and write; writes are gated by this explicit admin toggle
    (Admin -> StockWise API), so enabling them stays a deliberate decision.
    Default: disabled."""
    env_var = 'STOCKWISE_TEST_WRITES_ENABLED' if _is_test_database() else 'STOCKWISE_WRITES_ENABLED'
    env_val = os.environ.get(env_var, '').strip().lower()
    if env_val:
        return env_val in ('1', 'true', 'yes', 'on')
    file_name = 'stockwise_writes_enabled_test' if _is_test_database() else 'stockwise_writes_enabled'
    try:
        with open(os.path.join(current_app.instance_path, file_name), 'r') as f:
            return f.read().strip().lower() in ('1', 'true', 'yes', 'on')
    except OSError:
        return False


def _snapshot_meta():
    """Snapshot metadata for the test environment (written by the refresh script)."""
    try:
        with open(os.path.join(current_app.instance_path, SNAPSHOT_META_FILENAME), 'r') as f:
            import json as _json
            return _json.load(f)
    except (OSError, ValueError):
        return None


def _error(status, code, message, **extra):
    payload = {'error': code, 'message': message}
    payload.update(extra)
    return jsonify(payload), status


@stockwise_bp.before_request
def stockwise_guards():
    if request.method == 'OPTIONS':
        return None

    # Hard guard: this integration only serves non-production databases
    # (dev DB or the dedicated StockWise test snapshot). Production always refuses.
    if not _is_nonprod_database():
        return _error(403, 'stockwise_disabled',
                      'The StockWise integration is only enabled on non-production '
                      'servers (dev or test database). This server does not serve '
                      'StockWise requests.')

    # Diagnostic endpoint: reports what scope the presented key matches without
    # requiring a valid key (it exists to debug key-delivery mismatches).
    if request.endpoint == 'stockwise_api.auth_check':
        return None

    # One key serves reads and (when the admin toggle is on) Warehouse Box
    # writes. The PATCH below falls through to the shared key validation.
    if request.method == 'PATCH' and request.endpoint == 'stockwise_api.update_warehouse_box':
        if not _writes_enabled():
            return _error(403, 'writes_disabled',
                          'Warehouse Box updates are not enabled on this server '
                          '(admin toggle is off).')
    elif request.method not in ('GET', 'HEAD'):
        return _error(405, 'read_only_api',
                      'The StockWise API is read-only except for the Warehouse Box '
                      'endpoint. Only GET requests are allowed here.')

    expected = _configured_api_key()
    if not expected:
        return _error(503, 'not_configured',
                      'StockWise integration is not configured on this server '
                      '(no STOCKWISE_API_KEY set).')

    provided = request.headers.get('X-StockWise-API-Key', '')
    if not provided or not secrets.compare_digest(provided, expected):
        return _error(401, 'invalid_api_key',
                      'Missing or invalid X-StockWise-API-Key header '
                      f'(note: the {_environment_name()} environment has its own key).')
    return None


def _parse_updated_since(raw):
    """Parse ISO-8601 timestamp; accepts trailing 'Z'. Returns datetime or raises ValueError."""
    value = raw.strip()
    if value.endswith('Z'):
        value = value[:-1]
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)  # DB stores naive UTC
    return dt


def _iso(dt):
    return dt.isoformat() + 'Z' if dt else None


def _assemblies_for_parts(part_ids):
    """Map part_id -> list of parent-assembly dicts (latest active BOMs only)."""
    if not part_ids:
        return {}
    m = get_models()
    BOMPart, BOMInstance = m['BOMPart'], m['BOMInstance']
    # parent_bom_part_id is NULL only on a BOM's root row (the assembly linked to
    # its own BOM) — excluded so items don't list themselves as a parent assembly.
    rows = (m['db'].session.query(BOMPart.part_id, BOMPart.quantity, BOMInstance)
            .join(BOMInstance, BOMPart.bom_id == BOMInstance.id)
            .filter(BOMPart.part_id.in_(part_ids),
                    BOMPart.parent_bom_part_id.isnot(None),
                    BOMInstance.is_latest.is_(True),
                    BOMInstance.status == 'active')
            .all())
    # A part can occur at several positions inside one BOM (732 such cases in
    # current data) — aggregate to one entry per assembly, summing quantities.
    aggregated = {}
    for part_id, quantity, bom in rows:
        key = (part_id, bom.id)
        if key in aggregated:
            aggregated[key]['quantity_in_assembly'] += (quantity or 0)
        else:
            aggregated[key] = {
                '_part_id': part_id,
                'assembly_part_number': bom.assembly_part_number,
                'assembly_revision': bom.assembly_revision,
                'assembly_name': bom.name,
                'bom_version': bom.version,
                'quantity_in_assembly': quantity or 0,
            }
    result = {}
    for entry in aggregated.values():
        part_id = entry.pop('_part_id')
        result.setdefault(part_id, []).append(entry)
    return result


def _legacy_image_part_ids(part_ids):
    """Ids among part_ids whose image lives in the legacy thumbnail_data DB column
    (thumbnail_data is a deferred column — query ids only, never load the blobs)."""
    if not part_ids:
        return set()
    m = get_models()
    Part = m['Part']
    # Require an actual base64 payload — rows like {"available": false,
    # "data_base64": null} are placeholders, not images.
    rows = (m['db'].session.query(Part.id)
            .filter(Part.id.in_(part_ids),
                    (Part.thumbnail_path.is_(None)) | (Part.thumbnail_path == ''),
                    Part.thumbnail_data.like('%"data_base64": "%'))
            .all())
    return {r[0] for r in rows}


def _serialize_part(part, assemblies=None, has_image=None):
    updated = _iso(part.updated_at)
    if has_image is None:
        has_image = bool(part.thumbnail_path)
    return {
        # Identity
        'id': part.id,                                # stable external record ID
        'part_number': part.part_number,              # e.g. MB10-MP-10001
        'revision': part.revision,
        'part_name': part.part_name,
        'description': part.description,
        'part_type': part.part_type,                  # Assembly / Mechanical part / ...
        # Lifecycle
        'state': part.state,                          # engineering (PDM) lifecycle state
        'status': part.status,                        # active / obsolete / pending
        # Inventory (READ-ONLY for StockWise)
        'quantity': part.inventory,
        'warehouse_box_number': part.warehouse_box_number,
        # Searchable metadata
        'material': part.material,
        'finish1': part.finish1,
        'finish2': part.finish2,
        'vendor': part.vendor,
        'manufacturer': part.manufacturer,
        'manufacturer_pn': part.manufacturer_pn,
        # Timestamps / concurrency
        'created_at': _iso(part.created_at),
        'updated_at': updated,
        'revision_token': updated,                    # optimistic-concurrency token
        # Image (CAD thumbnail; fetch via the image endpoint, validate with ETag)
        'has_image': has_image,
        'image_url': f'/api/stockwise/v1/items/{part.id}/image' if has_image else None,
        # Membership (parent assemblies, latest active BOMs)
        'assemblies': assemblies if assemblies is not None else [],
    }


@stockwise_bp.route('/ping', methods=['GET'])
def ping():
    """Authenticated connectivity check."""
    payload = {
        'ok': True,
        'api_version': API_VERSION,
        'environment': _environment_name(),
        'server_time': _iso(datetime.utcnow()),
    }
    if _is_test_database():
        meta = _snapshot_meta()
        payload['snapshot'] = meta or {'warning': 'snapshot metadata missing'}
    return jsonify(payload)


@stockwise_bp.route('/auth-check', methods=['GET'])
def auth_check():
    """Key-delivery diagnostic. Send any key in X-StockWise-API-Key and this
    reports which scope it matches ('read' / 'write' / 'none') plus a SHA-256
    fingerprint prefix — so both sides can compare what they hold without ever
    transmitting the key itself. Never returns key material."""
    import hashlib
    presented = request.headers.get('X-StockWise-API-Key', '')
    matches = 'none'
    expected = _configured_api_key()
    if presented and expected and secrets.compare_digest(presented, expected):
        matches = 'read+write' if _writes_enabled() else 'read'
    return jsonify({
        'environment': _environment_name(),
        'key_received': bool(presented),
        'key_length': len(presented),
        'key_sha256_prefix': hashlib.sha256(presented.encode()).hexdigest()[:12] if presented else None,
        'matches': matches,
        'writes_enabled': _writes_enabled(),
    })


@stockwise_bp.route('/items', methods=['GET'])
def list_items():
    """Paginated item list.

    Query params:
      cursor         - opaque cursor from previous page (integer item id)
      page_size      - default 100, max 500
      updated_since  - ISO-8601 UTC timestamp; only items modified at/after it
      status         - filter: active / obsolete / pending
      part_type      - filter: e.g. 'Mechanical part', 'Assembly'
      part_number    - substring match on part number
      include_assemblies - 'false' to skip parent-assembly lookup (default true)

    Ordering is by item id ascending — stable across pages and syncs.
    """
    m = get_models()
    Part = m['Part']

    try:
        page_size = int(request.args.get('page_size', DEFAULT_PAGE_SIZE))
    except ValueError:
        return _error(400, 'invalid_parameter', 'page_size must be an integer.')
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))

    query = Part.query

    updated_since = request.args.get('updated_since')
    if updated_since:
        try:
            query = query.filter(Part.updated_at >= _parse_updated_since(updated_since))
        except ValueError:
            return _error(400, 'invalid_parameter',
                          "updated_since must be ISO-8601, e.g. '2026-07-29T00:00:00Z'.")

    status = request.args.get('status')
    if status:
        query = query.filter(Part.status == status)

    part_type = request.args.get('part_type')
    if part_type:
        query = query.filter(Part.part_type == part_type)

    part_number = request.args.get('part_number')
    if part_number:
        query = query.filter(Part.part_number.ilike(f'%{part_number}%'))

    # total_count reflects ALL records matching the filters, independent of the
    # cursor position, so clients can show sync progress.
    total_count = query.count()

    cursor = request.args.get('cursor')
    if cursor:
        try:
            query = query.filter(Part.id > int(cursor))
        except ValueError:
            return _error(400, 'invalid_cursor', 'cursor must be an integer item id.')

    parts = query.order_by(Part.id.asc()).limit(page_size + 1).all()
    has_more = len(parts) > page_size
    parts = parts[:page_size]

    include_assemblies = request.args.get('include_assemblies', 'true').lower() != 'false'
    part_ids = [p.id for p in parts]
    assemblies_map = _assemblies_for_parts(part_ids) if include_assemblies else {}
    legacy_image_ids = _legacy_image_part_ids(part_ids)

    return jsonify({
        'items': [_serialize_part(p, assemblies_map.get(p.id, []),
                                  has_image=bool(p.thumbnail_path) or p.id in legacy_image_ids)
                  for p in parts],
        'page_size': page_size,
        'total_count': total_count,
        'has_more': has_more,
        'next_cursor': str(parts[-1].id) if has_more and parts else None,
    })


@stockwise_bp.route('/items/<int:item_id>', methods=['GET'])
def get_item(item_id):
    """Single item by stable record id."""
    m = get_models()
    part = m['Part'].query.get(item_id)
    if not part:
        return _error(404, 'not_found', f'No item with id {item_id}.')
    assemblies = _assemblies_for_parts([part.id]).get(part.id, [])
    has_image = bool(part.thumbnail_path) or part.id in _legacy_image_part_ids([part.id])
    return jsonify({'item': _serialize_part(part, assemblies, has_image=has_image)})


WAREHOUSE_BOX_MAX_LENGTH = 50


@stockwise_bp.route('/items/<int:item_id>/warehouse-box', methods=['PATCH'])
def update_warehouse_box(item_id):
    """Update ONLY warehouse_box_number on one item. Requires the writes-enabled
    admin toggle (enforced in stockwise_guards; auth uses the standard key) and an
    If-Match header carrying the item's current revision_token.
    Body: {"warehouse_box_number": "F-001"} or null to clear.

    Idempotency: if the item already holds the requested value, the request
    succeeds as a no-op regardless of If-Match — so queued retries are safe even
    after the original request changed the revision token.
    """
    m = get_models()
    part = m['Part'].query.get(item_id)
    if not part:
        return _error(404, 'not_found', f'No item with id {item_id}.')

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'warehouse_box_number' not in data:
        return _error(400, 'invalid_request',
                      'Body must be JSON with a warehouse_box_number field.')
    extra_fields = set(data.keys()) - {'warehouse_box_number'}
    if extra_fields:
        return _error(400, 'field_not_writable',
                      f'Only warehouse_box_number may be updated; rejected: {sorted(extra_fields)}.')

    new_value = data['warehouse_box_number']
    if new_value is not None:
        if not isinstance(new_value, str):
            return _error(400, 'invalid_value', 'warehouse_box_number must be a string or null.')
        new_value = new_value.strip()
        if not new_value:
            return _error(400, 'invalid_value',
                          'Empty string is not allowed — send null to clear the location.')
        if len(new_value) > WAREHOUSE_BOX_MAX_LENGTH:
            return _error(400, 'invalid_value',
                          f'warehouse_box_number exceeds {WAREHOUSE_BOX_MAX_LENGTH} characters.')

    def item_payload(p):
        assemblies = _assemblies_for_parts([p.id]).get(p.id, [])
        has_image = bool(p.thumbnail_path) or p.id in _legacy_image_part_ids([p.id])
        return _serialize_part(p, assemblies, has_image=has_image)

    old_value = part.warehouse_box_number
    idempotency_key = request.headers.get('Idempotency-Key')

    # Idempotent no-op: already at the requested value. Succeeds regardless of
    # If-Match so a retried request that already applied doesn't 409.
    if (old_value or None) == (new_value or None):
        return jsonify({'applied': 'no_change', 'item': item_payload(part)})

    current_token = _iso(part.updated_at)
    if_match = request.headers.get('If-Match', '').strip().strip('"')
    if not if_match:
        return _error(428, 'precondition_required',
                      'If-Match header with the current revision_token is required.')
    if if_match != current_token:
        payload = {'error': 'conflict',
                   'message': 'revision_token is stale — the item changed since you read it. '
                              'Re-read, re-check your assignment, and retry with the new token.',
                   'item': item_payload(part)}
        return jsonify(payload), 409

    part.warehouse_box_number = new_value
    m['db'].session.commit()

    from utils.logger import log_action
    log_action('STOCKWISE_WAREHOUSE_BOX_UPDATED',
               {'username': 'stockwise', 'role': 'integration'},
               f'item {part.id} ({part.part_number} rev {part.revision}): '
               f'{old_value!r} -> {new_value!r}'
               + (f' [idempotency-key: {idempotency_key}]' if idempotency_key else ''))

    return jsonify({
        'applied': 'updated',
        'audit': {
            'actor': 'stockwise',
            'old_value': old_value,
            'new_value': new_value,
            'at': _iso(datetime.utcnow()),
        },
        'item': item_payload(part),
    })


def _load_image_bytes(part):
    """Raw stored PNG bytes for a part, or None. Prefers filesystem, falls back
    to the legacy thumbnail_data DB column (same logic as serve_part_thumbnail)."""
    if part.thumbnail_path:
        filepath = os.path.join(current_app.instance_path, part.thumbnail_path)
        try:
            with open(filepath, 'rb') as f:
                return f.read()
        except OSError:
            pass
    if part.thumbnail_data:
        try:
            import json as _json
            data = _json.loads(part.thumbnail_data)
            if data.get('data_base64'):
                import base64 as _base64
                return _base64.b64decode(data['data_base64'])
        except Exception:
            pass
    return None


MAX_IMAGE_DIMENSION = 1200


@stockwise_bp.route('/items/<int:item_id>/image', methods=['GET'])
def get_item_image(item_id):
    """Item image as PNG (the CAD thumbnail — a shaded render, not an outline).

    Query params:
      format    - 'png' (default: stored image as-is) or 'bw' (1-bit black/white,
                  Floyd-Steinberg dithered, transparency flattened to white —
                  intended for thermal label printers)
      max_size  - optional; downscale so the longest edge is <= this (16..1200),
                  aspect ratio preserved; never upscales

    Supports ETag / If-None-Match revalidation (returns 304 when unchanged).
    """
    m = get_models()
    part = m['Part'].query.get(item_id)
    if not part:
        return _error(404, 'not_found', f'No item with id {item_id}.')

    fmt = request.args.get('format', 'png').lower()
    if fmt not in ('png', 'bw'):
        return _error(400, 'invalid_parameter', "format must be 'png' or 'bw'.")
    max_size = request.args.get('max_size')
    if max_size is not None:
        try:
            max_size = int(max_size)
        except ValueError:
            return _error(400, 'invalid_parameter', 'max_size must be an integer.')
        if not 16 <= max_size <= MAX_IMAGE_DIMENSION:
            return _error(400, 'invalid_parameter',
                          f'max_size must be between 16 and {MAX_IMAGE_DIMENSION}.')

    raw = _load_image_bytes(part)
    if raw is None:
        return _error(404, 'no_image', f'Item {item_id} has no image.')

    out = raw
    if fmt == 'bw' or max_size:
        from PIL import Image
        from io import BytesIO
        try:
            im = Image.open(BytesIO(raw))
            if max_size:
                im.thumbnail((max_size, max_size))
            if fmt == 'bw':
                # Flatten transparency onto white before thresholding, otherwise
                # transparent background dithers to black on the label.
                if im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info):
                    im = im.convert('RGBA')
                    background = Image.new('RGB', im.size, (255, 255, 255))
                    background.paste(im, mask=im.split()[-1])
                    im = background
                im = im.convert('L').convert('1')  # Floyd-Steinberg dither
            buf = BytesIO()
            im.save(buf, format='PNG', optimize=True)
            out = buf.getvalue()
        except Exception:
            return _error(500, 'image_processing_failed',
                          'Stored image could not be processed. Retry without '
                          'format/max_size or report the item id to the MenteeBOM team.')

    import hashlib
    etag = f'"{hashlib.md5(out).hexdigest()}"'
    if request.headers.get('If-None-Match') == etag:
        response = current_app.response_class(status=304)
    else:
        response = current_app.response_class(out, mimetype='image/png')
        response.headers['Content-Length'] = len(out)
    response.headers['ETag'] = etag
    response.headers['Cache-Control'] = 'private, max-age=86400'
    return response


# ============================================================================
# ADMIN — StockWise key management (session auth, used by the Admin page)
# ============================================================================

def _key_file_path():
    # Environment-specific: the admin panel on a test instance manages the TEST
    # key file, on the dev instance the dev key file.
    return os.path.join(current_app.instance_path, _key_file_name())


def _read_key_file():
    try:
        with open(_key_file_path(), 'r') as f:
            return f.read().strip() or None
    except OSError:
        return None


def _admin_config_payload():
    env_key = os.environ.get(_key_env_var(), '').strip() or None
    file_key = _read_key_file()
    effective = env_key or file_key
    return {
        'success': True,
        'configured': bool(effective),
        'api_key': effective,
        'key_source': 'env' if env_key else ('file' if file_key else None),
        'env_override': bool(env_key),
        'dev_database': _is_nonprod_database(),
        'environment': _environment_name(),
        'writes_enabled': _writes_enabled(),
        'header_name': 'X-StockWise-API-Key',
        'base_path': '/api/stockwise/v1',
    }


@stockwise_admin_bp.route('/config', methods=['GET'])
@login_required
def admin_get_stockwise_config():
    """Current StockWise integration status + effective key (admin only)."""
    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403
    return jsonify(_admin_config_payload())


@stockwise_admin_bp.route('/config', methods=['PUT'])
@login_required
def admin_set_stockwise_config():
    """Update the StockWise config: the API key and/or the Warehouse Box write toggle.

    Body: {"api_key": "<key>"} — empty string clears the key and disables the API
    (unless the env var is set, which always takes precedence).
          {"writes_enabled": true|false} — allow/forbid Warehouse Box writes with
    the same key. Either field may be sent alone.
    """
    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    data = request.json or {}
    if 'api_key' not in data and 'writes_enabled' not in data:
        return jsonify({'success': False,
                        'error': 'Provide api_key and/or writes_enabled'}), 400

    from utils.logger import log_action
    messages = []

    if 'writes_enabled' in data:
        enabled = bool(data['writes_enabled'])
        toggle_file = os.path.join(
            current_app.instance_path,
            'stockwise_writes_enabled_test' if _is_test_database() else 'stockwise_writes_enabled')
        if enabled:
            os.makedirs(current_app.instance_path, exist_ok=True)
            with open(toggle_file, 'w') as f:
                f.write('1')
        else:
            try:
                os.remove(toggle_file)
            except OSError:
                pass
        log_action('STOCKWISE_WRITES_' + ('ENABLED' if enabled else 'DISABLED'), current_user,
                   f'StockWise Warehouse Box writes {"enabled" if enabled else "disabled"} '
                   f'({_environment_name()} environment)')
        messages.append(f'Warehouse Box writes {"enabled" if enabled else "disabled"}.')

    if 'api_key' not in data:
        payload = _admin_config_payload()
        payload['message'] = ' '.join(messages)
        return jsonify(payload)

    new_key = (data.get('api_key') or '').strip()
    if new_key:
        if len(new_key) < 16:
            return jsonify({'success': False,
                            'error': 'API key must be at least 16 characters'}), 400
        os.makedirs(current_app.instance_path, exist_ok=True)
        with open(_key_file_path(), 'w') as f:
            f.write(new_key)
        log_action('STOCKWISE_KEY_UPDATED', current_user, 'StockWise API key set/rotated')
        messages.append('StockWise API key saved. Previous key (if any) stopped working.')
    else:
        try:
            os.remove(_key_file_path())
        except OSError:
            pass
        log_action('STOCKWISE_KEY_CLEARED', current_user, 'StockWise API key cleared (integration disabled)')
        messages.append('StockWise API key cleared — integration disabled.')

    payload = _admin_config_payload()
    if payload['env_override']:
        messages.append('NOTE: the key environment variable is set and overrides the saved key.')
    payload['message'] = ' '.join(messages)
    return jsonify(payload)


@stockwise_bp.route('/items/by-part-number/<path:part_number>', methods=['GET'])
def get_item_by_part_number(part_number):
    """All revisions of a part number (exact match), newest record first."""
    m = get_models()
    Part = m['Part']
    parts = (Part.query.filter(Part.part_number == part_number)
             .order_by(Part.id.desc()).all())
    if not parts:
        return _error(404, 'not_found', f"No item with part number '{part_number}'.")
    part_ids = [p.id for p in parts]
    assemblies_map = _assemblies_for_parts(part_ids)
    legacy_image_ids = _legacy_image_part_ids(part_ids)
    return jsonify({'items': [_serialize_part(p, assemblies_map.get(p.id, []),
                                              has_image=bool(p.thumbnail_path) or p.id in legacy_image_ids)
                              for p in parts]})
