"""
Robot Assembly & MenteeFlow Integration Blueprint
Handles robot visualization, DOF assembly navigation, and manufacturing process workflows.
"""
import json
import os
import re
import secrets
import requests as http_requests
from datetime import datetime, timedelta
from functools import wraps
from flask import Blueprint, request, jsonify, current_app, make_response, send_file, has_request_context
from flask_login import login_required, current_user
from sqlalchemy.exc import IntegrityError

robot_assembly_bp = Blueprint('robot_assembly', __name__)

# Actor recorded by log_action when work runs outside a logged-in request
# (scheduler sweeps, MenteeFlow API-key calls).
SYSTEM_USER = {'username': 'system', 'role': 'system'}


def _actor(user=None):
    """Resolve who to attribute an action to: explicit user, the logged-in
    request user, or SYSTEM_USER for background / API-key contexts."""
    if user is not None:
        return user
    if has_request_context() and getattr(current_user, 'is_authenticated', False):
        return current_user
    return SYSTEM_USER


def _get_part_thumb(part):
    """Return thumbnail value for a part: URL string for filesystem, raw base64 for legacy, or None."""
    if part.thumbnail_path:
        return f'/api/parts/{part.id}/thumbnail'
    if not part.thumbnail_data:
        return None
    try:
        td = json.loads(part.thumbnail_data)
        if isinstance(td, dict):
            return td.get('data_base64') or td.get('base64')
        return part.thumbnail_data
    except Exception:
        return part.thumbnail_data


@robot_assembly_bp.before_request
def handle_embed_preflight():
    """Handle CORS preflight requests for embed endpoints."""
    if request.method == 'OPTIONS' and request.path.startswith('/api/embed/'):
        m = get_models()
        config = m['MenteeFlowConfig'].query.first()
        origin = '*'
        if config and config.base_url:
            from urllib.parse import urlparse
            parsed = urlparse(config.base_url)
            origin = f"{parsed.scheme}://{parsed.netloc}"

        response = make_response('', 204)
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Max-Age'] = '3600'
        return response


# ============================================================================
# HELPERS
# ============================================================================

def get_db():
    """Lazy import to avoid circular imports"""
    from app import db
    return db


def set_inventory_context(reason, reference=None):
    """Label inventory changes made during this request (see app.set_inventory_context)."""
    from app import set_inventory_context as _sic
    _sic(reason, reference)


def get_models():
    """Lazy import all models needed"""
    from app import (
        db, RobotConfig, RobotLimb, DOFMapping, ProcessBOMInstance,
        ManufacturingProcess, ProcessStage, MenteeFlowConfig,
        ProjectBadge, BOMInstance, BOMPart, Part, LimbAssemblySnapshot,
        EmbedToken, PartReplacement, MenteeFlowApiKeyHistory,
        AssemblyDrawingDefault,
        LimbAssemblyStageDefinition, LimbAssemblyProcess, LimbAssemblyProcessStage
    )
    return {
        'db': db,
        'RobotConfig': RobotConfig,
        'RobotLimb': RobotLimb,
        'DOFMapping': DOFMapping,
        'ProcessBOMInstance': ProcessBOMInstance,
        'ManufacturingProcess': ManufacturingProcess,
        'ProcessStage': ProcessStage,
        'MenteeFlowConfig': MenteeFlowConfig,
        'ProjectBadge': ProjectBadge,
        'BOMInstance': BOMInstance,
        'BOMPart': BOMPart,
        'Part': Part,
        'LimbAssemblySnapshot': LimbAssemblySnapshot,
        'EmbedToken': EmbedToken,
        'PartReplacement': PartReplacement,
        'MenteeFlowApiKeyHistory': MenteeFlowApiKeyHistory,
        'AssemblyDrawingDefault': AssemblyDrawingDefault,
        'LimbAssemblyStageDefinition': LimbAssemblyStageDefinition,
        'LimbAssemblyProcess': LimbAssemblyProcess,
        'LimbAssemblyProcessStage': LimbAssemblyProcessStage,
    }


def validate_menteeflow_api_key():
    """Validate incoming MenteeFlow webhook API key.
    Checks against the live config webhook_secret AND verifies the key is not revoked in history."""
    m = get_models()
    api_key = request.headers.get('X-MenteeFlow-API-Key')
    if not api_key:
        print(f"[MenteeFlow AUTH] FAILED - No 'X-MenteeFlow-API-Key' header found. Header names received: {list(request.headers.keys())}")
        return False
    config = m['MenteeFlowConfig'].query.first()
    if not config or not config.webhook_secret:
        print(f"[MenteeFlow AUTH] FAILED - No MenteeFlowConfig or webhook_secret in DB. Config exists: {config is not None}")
        return False
    if not secrets.compare_digest(api_key, config.webhook_secret):
        print(f"[MenteeFlow AUTH] FAILED - Key mismatch. Received: '{api_key[:4]}...'")
        return False

    # Check if this key has been explicitly revoked in history
    revoked = m['MenteeFlowApiKeyHistory'].query.filter_by(
        webhook_secret=api_key, is_active=False
    ).first()
    if revoked:
        print(f"[MenteeFlow AUTH] FAILED - Key matches config but is revoked in history (label: '{revoked.label}')")
        return False

    print(f"[MenteeFlow AUTH] SUCCESS - Key validated for {request.method} {request.path}")
    return True


def require_menteeflow_auth(f):
    """Decorator to require MenteeFlow API key authentication"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not validate_menteeflow_api_key():
            return jsonify({'success': False, 'error': 'Invalid or missing API key'}), 401
        return f(*args, **kwargs)
    return decorated


def validate_embed_token():
    """Validate embed token from query parameter. Returns (EmbedToken, None) or (None, error_response)."""
    m = get_models()
    token_str = request.args.get('token')
    if not token_str:
        return None, (jsonify({'success': False, 'error': 'Missing embed token'}), 401)

    token = m['EmbedToken'].query.filter_by(token=token_str).first()
    if not token:
        return None, (jsonify({'success': False, 'error': 'Invalid embed token'}), 401)

    if token.is_revoked:
        return None, (jsonify({'success': False, 'error': 'Token has been revoked'}), 401)

    if token.expires_at < datetime.utcnow():
        return None, (jsonify({'success': False, 'error': 'Token has expired'}), 401)

    # Mark as used
    if not token.used_at:
        token.used_at = datetime.utcnow()
        m['db'].session.commit()

    return token, None


def require_embed_auth(f):
    """Decorator to require embed token authentication.
    Sets g.embed_token and g.embed_process (or g.embed_limb_process) on success."""
    @wraps(f)
    def decorated(*args, **kwargs):
        from flask import g
        token, error = validate_embed_token()
        if error:
            return error
        m = get_models()
        if token.process_id:
            process = m['ManufacturingProcess'].query.get(token.process_id)
            if not process:
                return jsonify({'success': False, 'error': 'Process not found'}), 404
            g.embed_token = token
            g.embed_process = process
            g.embed_limb_process = None
        elif token.limb_process_id:
            limb_process = m['LimbAssemblyProcess'].query.get(token.limb_process_id)
            if not limb_process:
                return jsonify({'success': False, 'error': 'Limb process not found'}), 404
            g.embed_token = token
            g.embed_process = None
            g.embed_limb_process = limb_process
        else:
            return jsonify({'success': False, 'error': 'Token not linked to any process'}), 400
        return f(*args, **kwargs)
    return decorated


def add_embed_headers(response):
    """Add security headers for embed responses (CORS + frame-ancestors).

    Allows credentialed cross-origin requests from MenteeFlow's configured origin.
    When base_url isn't set, falls back to wildcard '*' (no credentials).
    """
    m = get_models()
    config = m['MenteeFlowConfig'].query.first()
    menteeflow_origin = None
    if config and config.base_url:
        from urllib.parse import urlparse
        parsed = urlparse(config.base_url)
        if parsed.scheme and parsed.netloc:
            menteeflow_origin = f"{parsed.scheme}://{parsed.netloc}"

    # Echo the request origin if it matches the configured MenteeFlow host —
    # supports both the prod ingress and dev LAN IPs without listing each.
    req_origin = request.headers.get('Origin')
    if menteeflow_origin and req_origin == menteeflow_origin:
        response.headers['Access-Control-Allow-Origin'] = req_origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Vary'] = 'Origin'
    elif menteeflow_origin:
        response.headers['Access-Control-Allow-Origin'] = menteeflow_origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    else:
        response.headers['Access-Control-Allow-Origin'] = '*'

    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = (
        'Content-Type, X-MenteeBOM-API-Key, X-MenteeFlow-API-Key, Authorization'
    )
    response.headers['Access-Control-Max-Age'] = '600'

    frame_origin = menteeflow_origin or '*'
    response.headers['Content-Security-Policy'] = f"frame-ancestors 'self' {frame_origin}"
    return response


def parse_process_number(process_number):
    """Parse process number X-XXX-XXX into components.
    Returns (badge_digit, dof_identifier, menteeflow_suffix) or None if invalid."""
    import re
    match = re.match(r'^(\d)-(\d{3})-(\d{3})$', process_number)
    if not match:
        return None
    return match.group(1), match.group(2), match.group(3)


def notify_menteeflow(process, stage_number, data=None):
    """Send stage completion notification to MenteeFlow"""
    m = get_models()
    config = m['MenteeFlowConfig'].query.first()
    if not config or not config.base_url or not config.api_key:
        return  # MenteeFlow not configured

    url = f"{config.base_url.rstrip('/')}/api/webhook/menteebom/stage-complete"
    headers = {
        'X-MenteeBOM-API-Key': config.api_key,
        'Content-Type': 'application/json'
    }
    payload = {
        'process_number': process.process_number,
        'stage': stage_number,
        'status': 'completed',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'completed_by': current_user.username if current_user and current_user.is_authenticated else None
    }
    if data:
        payload['data'] = data

    try:
        from utils.logger import log_action
        response = http_requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        log_action('MENTEEFLOW_CALLBACK', current_user,
                   f'Process {process.process_number} stage {stage_number} notification sent')
    except Exception as e:
        from utils.logger import log_action
        log_action('MENTEEFLOW_CALLBACK_FAILED', current_user,
                   f'Process {process.process_number} stage {stage_number} failed: {str(e)}')


def parse_stage_key(stage):
    """Parse a stage key string into (stage_number, stage_sub) for DB lookup.
    Handles: '2' → (2, None), '3.1' → (3, '3.1'), '3.2' → (3, '3.2'), '4' → (4, None), etc.
    """
    stage_str = str(stage).strip()
    if '.' in stage_str:
        return (int(stage_str.split('.')[0]), stage_str)
    else:
        return (int(stage_str), None)


# Canonical stage ordering — used for rank calculations and revert logic
# BOM stages: 1=Created, 2=Picking, 3.1=Motor, 3.2=Gear, 4=CHE1, 5=M&G, 6=CHE2, 7=Actuator, 8=CHE3, 9=DOF
STAGE_ORDER = ['1', '2', '3.1', '3.2', '4', '5', '6', '7', '8', '9']
STAGE_RANK = {s: i for i, s in enumerate(STAGE_ORDER)}
# 3.1 and 3.2 are parallel (same rank)
STAGE_RANK['3.2'] = STAGE_RANK['3.1']


def create_process_stages(process_id):
    """Create all stage records for a new process.
    Flow: 1(Created) → 2(Picking) → 3.1∥3.2(Motor/Gear) → 4(CHE1) → 5(M&G) → 6(CHE2) → 7(Actuator) → 8(CHE3) → 9(DOF)
    """
    m = get_models()
    db = m['db']
    ProcessStage = m['ProcessStage']

    stages = [
        (1, None, 'Process Created'),
        (2, None, 'Picking'),
        (3, '3.1', 'Motor Assembly'),
        (3, '3.2', 'Gear Assembly'),
        (4, None, 'CHE 1'),
        (5, None, 'Motor and Gear Assembly'),
        (6, None, 'CHE 2'),
        (7, None, 'Actuator Assembly'),
        (8, None, 'CHE 3'),
        (9, None, 'DOF Assembly'),
    ]

    for stage_num, stage_sub, stage_name in stages:
        stage = ProcessStage(
            process_id=process_id,
            stage_number=stage_num,
            stage_sub=stage_sub,
            stage_name=stage_name,
            status='completed' if stage_num == 1 else 'pending',
            started_at=datetime.utcnow() if stage_num == 1 else None,
            completed_at=datetime.utcnow() if stage_num == 1 else None,
        )
        db.session.add(stage)


def _get_or_create_process_embed_token(process, ttl_minutes=43200):  # default 30 days
    """Get an existing active process-wide embed token, or create a new one.
    Token has no stage_scope so it works for ALL stages of this process.
    Returns dict with token, embed_base_url, and expires_at."""
    m = get_models()
    db = m['db']

    # Look for an existing active process-wide token
    existing = m['EmbedToken'].query.filter_by(
        process_id=process.id,
        stage_scope=None,
        is_revoked=False,
    ).filter(
        m['EmbedToken'].expires_at > datetime.utcnow()
    ).first()

    if existing:
        token_str = existing.token
        expires_at = existing.expires_at
    else:
        # Create a new process-wide token
        token_str = secrets.token_urlsafe(48)
        expires_at = datetime.utcnow() + timedelta(minutes=ttl_minutes)

        embed_token = m['EmbedToken'](
            token=token_str,
            process_id=process.id,
            stage_scope=None,  # Process-wide, works for all stages
            expires_at=expires_at,
        )
        db.session.add(embed_token)
        db.session.commit()

        from utils.logger import log_action
        log_action('EMBED_TOKEN_CREATED', None,
                   f'Process-wide embed token for {process.process_number}, expires {expires_at.isoformat()}')

    # Build base embed URL (MenteeFlow appends /stage/{N} as needed)
    config = m['MenteeFlowConfig'].query.first()
    if config and config.embed_url_template:
        base_url = config.embed_url_template.rstrip('/')
    else:
        base_url = request.host_url.rstrip('/')

    embed_base_url = f"{base_url}/embed/process/{process.process_number}"

    return {
        'token': token_str,
        'embed_base_url': embed_base_url,
        'expires_at': expires_at.isoformat() + 'Z',
    }


def _resolve_badge_digit(badge, m=None):
    """Return the configured single-digit prefix for a badge (from MenteeFlowConfig
    badge_digit_mapping), or None if not mapped."""
    if m is None:
        m = get_models()
    config = m['MenteeFlowConfig'].query.first()
    if not config or not config.badge_digit_mapping:
        return None
    try:
        mapping = json.loads(config.badge_digit_mapping)
    except (json.JSONDecodeError, TypeError):
        return None
    digit = mapping.get(badge.name)
    if digit is None or str(digit).strip() == '':
        return None
    return str(digit).strip()


def _get_or_create_dof_template(dof_mapping, badge, m=None):
    """Get or create a read-only template ManufacturingProcess for a DOF.

    A template is a "no serial number" reference process used to preview a DOF's stage
    flow without opening a real run. Its process_number is "{badge_digit}-{dof_number}"
    (e.g. "2-201"). Idempotent. Returns (process, None) on success or (None, warning).
    """
    if m is None:
        m = get_models()
    db = m['db']

    badge_digit = _resolve_badge_digit(badge, m)
    if not badge_digit:
        return None, f'No badge digit mapped for "{badge.name}"'

    process_number = f"{badge_digit}-{dof_mapping.dof_number}"

    existing = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if existing:
        if not existing.is_template:
            return None, f'Process number {process_number} already exists as a real process'
        return existing, None

    process = m['ManufacturingProcess'](
        process_number=process_number,
        badge_id=badge.id,
        dof_mapping_id=dof_mapping.id,
        name=f'{dof_mapping.dof_name} (template)',
        current_stage=1,
        status='template',
        is_template=True,
        badge_digit=badge_digit,
        dof_identifier=dof_mapping.dof_number,
        menteeflow_suffix=None,
    )
    db.session.add(process)
    try:
        db.session.flush()  # Get process.id
    except IntegrityError:
        db.session.rollback()
        existing = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
        if existing and existing.is_template:
            return existing, None
        return None, f'Could not create template {process_number}'

    create_process_stages(process.id)
    db.session.commit()
    return process, None


def _reject_if_template(process):
    """Return a 403 read-only embed response if the process is a template, else None.
    Used to block writes on template (preview) processes."""
    if process is not None and getattr(process, 'is_template', False):
        resp = make_response(jsonify({
            'success': False,
            'read_only': True,
            'error': 'This is a read-only DOF template process — actions are disabled.',
        }), 403)
        return add_embed_headers(resp)
    return None


# ============================================================================
# MENTEEFLOW WEBHOOK ENDPOINTS (incoming from MenteeFlow)
# ============================================================================

@robot_assembly_bp.route('/api/menteeflow/process/create', methods=['POST'])
@require_menteeflow_auth
def menteeflow_create_process():
    """Stage 1: MenteeFlow creates a new manufacturing process"""
    m = get_models()
    db = m['db']

    data = request.json
    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    process_number = data.get('process_number', '').strip()
    name = data.get('name', '').strip()

    if not process_number or not name:
        return jsonify({'success': False, 'error': 'process_number and name are required'}), 400

    # Parse process number
    parsed = parse_process_number(process_number)
    if not parsed:
        return jsonify({'success': False, 'error': 'Invalid process_number format. Expected X-XXX-XXX'}), 400

    badge_digit, dof_identifier, mf_suffix = parsed

    # Check uniqueness
    existing = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if existing:
        return jsonify({'success': False, 'error': 'Process number already exists'}), 409

    # Find badge by digit mapping
    config = m['MenteeFlowConfig'].query.first()
    badge = None
    if config and config.badge_digit_mapping:
        try:
            mapping = json.loads(config.badge_digit_mapping)
            # Reverse mapping: digit -> badge name
            for badge_name, digit in mapping.items():
                if str(digit) == badge_digit:
                    badge = m['ProjectBadge'].query.filter_by(name=badge_name, is_active=True).first()
                    break
        except (json.JSONDecodeError, AttributeError):
            pass

    if not badge:
        return jsonify({'success': False, 'error': f'No badge mapped to digit "{badge_digit}"'}), 404

    # Find DOF mapping — check limb-scoped first, then external (limb_id IS NULL)
    dof_mapping = m['DOFMapping'].query.filter_by(dof_number=dof_identifier, is_active=True).join(
        m['RobotLimb']
    ).join(
        m['RobotConfig']
    ).filter(
        m['RobotConfig'].badge_id == badge.id
    ).first()

    if not dof_mapping:
        dof_mapping = m['DOFMapping'].query.filter(
            m['DOFMapping'].dof_number == dof_identifier,
            m['DOFMapping'].limb_id.is_(None),
            m['DOFMapping'].is_active.is_(True)
        ).first()

    if not dof_mapping:
        return jsonify({'success': False, 'error': f'No DOF mapping found for "{dof_identifier}" in badge "{badge.name}"'}), 404

    # Create process
    process = m['ManufacturingProcess'](
        process_number=process_number,
        badge_id=badge.id,
        dof_mapping_id=dof_mapping.id,
        name=name,
        current_stage=1,
        status='active',
        badge_digit=badge_digit,
        dof_identifier=dof_identifier,
        menteeflow_suffix=mf_suffix,
        menteeflow_ticket_id=data.get('ticket_id'),
        menteeflow_url=data.get('ticket_url'),
    )
    db.session.add(process)
    try:
        db.session.flush()  # Get process.id
    except IntegrityError:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Process number already exists'}), 409

    # Create all stage records
    create_process_stages(process.id)
    db.session.commit()

    from utils.logger import log_action
    log_action('PROCESS_CREATED', None,
               f'Process {process_number} created by MenteeFlow for badge {badge.name}, DOF {dof_mapping.dof_name}')

    # Auto-generate process-wide embed token
    embed_info = _get_or_create_process_embed_token(process)

    return jsonify({
        'success': True,
        'process_id': process.id,
        'process_number': process_number,
        'badge': badge.name,
        'dof_name': dof_mapping.dof_name,
        'limb': dof_mapping.limb.name if dof_mapping.limb else None,
        'message': 'Process created successfully',
        'embed': embed_info,
    }), 201


@robot_assembly_bp.route('/api/menteeflow/process/<process_number>/advance', methods=['POST'])
@require_menteeflow_auth
def menteeflow_advance_process(process_number):
    """MenteeFlow advances a process to the next stage"""
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.json or {}
    stage = data.get('stage')
    stage_data = data.get('stage_data', {})
    print(f'[MenteeFlow ADVANCE] Process {process_number} — stage={stage}, payload={data}')

    if stage is None:
        return jsonify({'success': False, 'error': 'stage is required'}), 400

    stage_str = str(stage)
    stage_num, stage_sub = parse_stage_key(stage_str)

    stage_record = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=stage_num,
        stage_sub=stage_sub
    ).first()

    if not stage_record:
        return jsonify({'success': False, 'error': f'Stage {stage} not found'}), 404

    if stage_record.status in ('completed', 'in_progress'):
        # Idempotent: return success with embed token so MenteeFlow doesn't need a separate call
        embed_info = _get_or_create_process_embed_token(process)
        return jsonify({
            'success': True,
            'process_number': process_number,
            'stage': stage,
            'stage_status': stage_record.status,
            'message': f'Stage {stage} ({stage_record.stage_name}) already {stage_record.status}',
            'embed': embed_info,
        })

    # Activate the stage
    stage_record.status = 'in_progress'
    stage_record.started_at = datetime.utcnow()
    if stage_data:
        stage_record.stage_data_json = json.dumps(stage_data)

    # Update process current stage
    process.current_stage = stage_num
    process.updated_at = datetime.utcnow()

    db.session.commit()

    from utils.logger import log_action
    log_action('PROCESS_STAGE_ADVANCED', None,
               f'Process {process_number} advanced to stage {stage}')

    # Return the existing process-wide embed token (or create if expired)
    embed_info = _get_or_create_process_embed_token(process)

    return jsonify({
        'success': True,
        'process_number': process_number,
        'stage': stage,
        'stage_status': 'in_progress',
        'message': f'Stage {stage} ({stage_record.stage_name}) activated',
        'embed': embed_info,
    })


@robot_assembly_bp.route('/api/menteeflow/process/<process_number>/complete-stage', methods=['POST'])
@require_menteeflow_auth
def menteeflow_complete_stage(process_number):
    """MenteeFlow completes a stage (e.g. user clicks 'complete motor assembly' on MenteeFlow side)"""
    set_inventory_context('stage_complete', process_number)
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.json or {}
    stage = data.get('stage')
    stage_data = data.get('stage_data', {})
    print(f'[MenteeFlow COMPLETE] Process {process_number} — stage={stage}, payload={data}')

    if stage is None:
        return jsonify({'success': False, 'error': 'stage is required'}), 400

    stage_str = str(stage)
    stage_num, stage_sub = parse_stage_key(stage_str)

    stage_record = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=stage_num,
        stage_sub=stage_sub
    ).first()

    if not stage_record:
        return jsonify({'success': False, 'error': f'Stage {stage} not found'}), 404

    if stage_record.status == 'completed':
        return jsonify({'success': False, 'error': f'Stage {stage} already completed'}), 409

    # Allow completing from pending or in_progress (MenteeFlow may skip advance)
    if stage_record.status not in ('pending', 'in_progress'):
        return jsonify({'success': False, 'error': f'Stage {stage} cannot be completed (status: {stage_record.status})'}), 409

    # Types auto-withdrawn on assembly stage completion (not picked manually)
    AUTO_WITHDRAW_TYPES = {'Fasteners', 'Inhouse Electrical Part'}

    # Stage 2 (Picking): reduce inventory for saved picked parts
    if stage_num == 2:
        picked_parts = []
        if stage_record.picked_parts_json:
            try:
                picked_parts = json.loads(stage_record.picked_parts_json)
            except (json.JSONDecodeError, TypeError):
                pass

        print(f'[INVENTORY] Stage 2 complete for {process_number}: {len(picked_parts)} picked parts to withdraw')
        for pp in picked_parts:
            part = m['Part'].query.get(pp.get('part_id'))
            if part:
                qty = float(pp.get('quantity', 1))
                old_inv = part.inventory or 0
                part.inventory = max(0, old_inv - qty)
                print(f'[INVENTORY]   {part.part_number} (id={part.id}): {old_inv} -> {part.inventory} (withdrew {qty})')
            else:
                print(f'[INVENTORY]   WARNING: part_id={pp.get("part_id")} not found in DB')

    # Assembly stages (3.1, 3.2, 5, 7, 9): auto-withdraw fasteners & electronics
    # CHE stages (4, 6, 8) have no parts to withdraw
    elif stage_str in ('3.1', '3.2', '5', '7', '9'):
        stage_parts = _get_stage_parts_internal(process, stage_str, m)
        auto_withdrawn = []
        for sp in stage_parts:
            part = m['Part'].query.get(sp.get('part_id'))
            if part and part.part_type in AUTO_WITHDRAW_TYPES:
                qty = float(sp.get('quantity', 1))
                old_inv = part.inventory or 0
                part.inventory = max(0, old_inv - qty)
                auto_withdrawn.append(sp)
                print(f'[INVENTORY]   AUTO-WITHDRAW {part.part_type}: {part.part_number} (id={part.id}): {old_inv} -> {part.inventory} (withdrew {qty})')
        if auto_withdrawn:
            print(f'[INVENTORY] Stage {stage} complete for {process_number}: auto-withdrew {len(auto_withdrawn)} fasteners/electronics')

    # Complete the stage
    stage_record.status = 'completed'
    stage_record.completed_at = datetime.utcnow()
    stage_record.completed_by = None  # No MenteeBOM user in MenteeFlow context
    if stage_data:
        stage_record.stage_data_json = json.dumps(stage_data)

    process.updated_at = datetime.utcnow()

    # Check if all stages are completed
    all_stages = m['ProcessStage'].query.filter_by(process_id=process.id).all()
    all_completed = all(s.status == 'completed' for s in all_stages)
    if all_completed:
        process.status = 'completed'
        process.completed_at = datetime.utcnow()
        m['EmbedToken'].query.filter_by(process_id=process.id, is_revoked=False).update({'is_revoked': True})

        # Increment inventory of the assembled DOF unit (we just built one)
        dof_mapping = m['DOFMapping'].query.get(process.dof_mapping_id)
        if dof_mapping:
            if dof_mapping.bom_instance_id:
                bom = m['BOMInstance'].query.get(dof_mapping.bom_instance_id)
                dof_pn = bom.assembly_part_number if bom else None
            else:
                dof_pn = dof_mapping.assembly_description  # external DOF fallback
            if dof_pn:
                dof_part = m['Part'].query.filter_by(part_number=dof_pn).first()
                if dof_part:
                    old_inv = dof_part.inventory or 0
                    dof_part.inventory = old_inv + 1
                    print(f'[INVENTORY] DOF complete: {dof_part.part_number} inventory {old_inv} -> {dof_part.inventory}')

    db.session.commit()

    from utils.logger import log_action
    log_action('MENTEEFLOW_STAGE_COMPLETED', None,
               f'MenteeFlow completed stage {stage} for process {process_number}')

    return jsonify({
        'success': True,
        'process_number': process_number,
        'stage': stage,
        'stage_status': 'completed',
        'process_completed': all_completed,
        'message': f'Stage {stage} ({stage_record.stage_name}) completed',
    })


@robot_assembly_bp.route('/api/menteeflow/process/<process_number>/save-picking', methods=['POST'])
@require_menteeflow_auth
def menteeflow_save_picking(process_number):
    """MenteeFlow saves partial picking progress (does NOT complete the stage).
    Can also be used to trigger the iframe to save via postMessage."""
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.json or {}
    picked_parts = data.get('picked_parts', [])
    unpicked_parts = data.get('unpicked_parts', [])

    stage = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=2,
        stage_sub=None
    ).first()

    if not stage:
        return jsonify({'success': False, 'error': 'Stage 2 not found'}), 404

    # Save progress without completing or changing inventory
    stage.picked_parts_json = json.dumps(picked_parts)
    stage.unpicked_parts_json = json.dumps(unpicked_parts) if unpicked_parts else None

    process.updated_at = datetime.utcnow()
    db.session.commit()

    from utils.logger import log_action
    log_action('MENTEEFLOW_PICKING_SAVED', None,
               f'MenteeFlow saved picking progress for process {process_number}: {len(picked_parts)} picked')

    return jsonify({
        'success': True,
        'picked_count': len(picked_parts),
        'unpicked_count': len(unpicked_parts),
        'message': 'Picking progress saved',
    })


@robot_assembly_bp.route('/api/menteeflow/process/<process_number>/status', methods=['GET'])
@require_menteeflow_auth
def menteeflow_process_status(process_number):
    """MenteeFlow polls process status"""
    m = get_models()

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stages = m['ProcessStage'].query.filter_by(process_id=process.id).order_by(
        m['ProcessStage'].stage_number, m['ProcessStage'].stage_sub
    ).all()

    dof_mapping = m['DOFMapping'].query.get(process.dof_mapping_id)

    # Load unpicked parts from stage 2 once, reuse across all stage dicts
    stage2_record = next((s for s in stages if s.stage_number == 2 and s.stage_sub is None), None)
    all_unpicked = []
    if stage2_record and stage2_record.unpicked_parts_json:
        try:
            all_unpicked = json.loads(stage2_record.unpicked_parts_json)
        except (json.JSONDecodeError, TypeError):
            all_unpicked = []
    unpicked_lookup = {(u.get('part_number', ''), u.get('revision', '') or ''): u for u in all_unpicked}

    ASSEMBLY_STAGE_KEYS = {'3.1', '3.2', '5', '7', '9'}

    def stage_to_dict(s):
        stage_key = s.stage_sub if s.stage_sub else str(s.stage_number)

        # For assembly stages, cross-reference unpicked parts against this stage's BOM
        # so MenteeFlow gets only the parts that actually block THIS stage.
        blocking_parts = []
        if stage_key in ASSEMBLY_STAGE_KEYS and unpicked_lookup:
            try:
                stage_parts = _get_stage_parts_internal(process, stage_key, m)
                for sp in stage_parts:
                    if sp.get('is_assembly'):
                        continue
                    key = (sp.get('part_number', ''), sp.get('revision', '') or '')
                    if key in unpicked_lookup:
                        up = unpicked_lookup[key]
                        blocking_parts.append({
                            'part_id': sp.get('part_id'),
                            'part_number': sp['part_number'],
                            'revision': sp.get('revision', ''),
                            'description': sp.get('description', ''),
                            'required_quantity': sp.get('quantity', 1),
                            'unpicked_quantity': up.get('quantity', up.get('required_quantity', 1)),
                        })
            except Exception:
                pass

        d = {
            'stage_number': s.stage_number,
            'stage_sub': s.stage_sub or None,
            'stage_name': s.stage_name,
            'status': s.status,
            'unpicked_parts_json': blocking_parts,  # now stage-filtered, not raw full list
            'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
            'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
            'reverted_at': s.reverted_at.isoformat() + 'Z' if s.reverted_at else None,
            'revert_reason': s.revert_reason,
        }
        return d

    return jsonify({
        'process': {
            'process_number': process.process_number,
            'name': process.name,
            'badge': process.badge.name if process.badge else None,
            'dof_name': dof_mapping.dof_name if dof_mapping else None,
            'limb': dof_mapping.limb.name if dof_mapping and dof_mapping.limb else None,
            'current_stage': process.current_stage,
            'status': process.status,
            'revert_count': process.revert_count or 0,
            'created_at': process.created_at.isoformat() + 'Z' if process.created_at else None,
            'updated_at': process.updated_at.isoformat() + 'Z' if process.updated_at else None,
            'stages': [stage_to_dict(s) for s in stages],
        }
    })


@robot_assembly_bp.route('/api/menteeflow/process/<process_number>/revert', methods=['POST'])
@require_menteeflow_auth
def menteeflow_revert_process(process_number):
    """MenteeFlow requests reverting a process to a previous stage.

    Rules:
    - Only previously completed stages can be reverted to
    - All stages after the target are marked as 'reverted'
    - The target stage is reopened as 'in_progress'
    - Parallel stages (3.1/3.2): reverting to 3.1 doesn't affect 3.2
    - Reverting before stage 3 reverts both 3.1 and 3.2
    """
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    if process.status not in ('active', 'completed'):
        return jsonify({'success': False, 'error': f'Process status is {process.status}, cannot revert'}), 400

    data = request.json or {}
    target_stage = data.get('target_stage') or data.get('stage')
    reason = data.get('reason', '')
    print(f'[MenteeFlow REVERT] Process {process_number} — target_stage={target_stage}, payload={data}')

    if target_stage is None:
        return jsonify({'success': False, 'error': 'target_stage or stage is required'}), 400

    target_str = str(target_stage)
    target_num, target_sub = parse_stage_key(target_str)

    target_record = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=target_num,
        stage_sub=target_sub
    ).first()

    if not target_record:
        return jsonify({'success': False, 'error': f'Stage {target_stage} not found'}), 404

    target_rank = STAGE_RANK.get(target_str, 99)

    # Get all stages for this process
    all_stages = m['ProcessStage'].query.filter_by(process_id=process.id).all()

    reverted_stages = []
    for s in all_stages:
        s_key = s.stage_sub or str(s.stage_number)
        s_rank = STAGE_RANK.get(s_key, 99)

        if s_key == target_str:
            # Reopen the target stage
            if s.status == 'completed':
                s.original_completed_at = s.completed_at
            s.status = 'in_progress'
            s.started_at = datetime.utcnow()
            s.completed_at = None
            s.reverted_at = datetime.utcnow()
            s.revert_reason = reason
            reverted_stages.append(s_key)
        elif s_rank > target_rank:
            # For parallel stages: only revert 3.x if target is before stage 3
            if s.stage_sub in ('3.1', '3.2') and target_str in ('3.1', '3.2') and target_str != s_key:
                continue

            if s.status in ('completed', 'in_progress'):
                if s.status == 'completed':
                    s.original_completed_at = s.completed_at
                s.status = 'reverted'
                s.reverted_at = datetime.utcnow()
                s.revert_reason = reason
                s.completed_at = None
                reverted_stages.append(s_key)

    # Update process
    reverted_from_stage = process.current_stage
    process.current_stage = target_num
    if process.status == 'completed':
        process.status = 'active'
        process.completed_at = None
    process.revert_count = (process.revert_count or 0) + 1
    process.updated_at = datetime.utcnow()

    db.session.commit()

    # Notify MenteeFlow (callback)
    callback_data = {
        'reverted_from': reverted_from_stage,
        'reverted_to': target_str,
        'reason': reason,
        'stages_reverted': reverted_stages,
    }
    notify_menteeflow(process, float(target_str) if '.' in target_str else target_num, callback_data)

    from utils.logger import log_action
    log_action('PROCESS_REVERTED', None,
               f'Process {process_number} reverted to stage {target_stage}. Reason: {reason}')

    return jsonify({
        'success': True,
        'process_number': process_number,
        'reverted_to_stage': target_str,
        'stages_reverted': reverted_stages,
        'message': f'Process reverted to Stage {target_stage} ({target_record.stage_name})',
    })


# ============================================================================
# CANCEL PROCESS (MenteeFlow ticket deleted)
# ============================================================================

@robot_assembly_bp.route('/api/menteeflow/process/<process_number>/cancel', methods=['POST'])
@require_menteeflow_auth
def menteeflow_cancel_process(process_number):
    """Cancel/archive a process when the MenteeFlow ticket is deleted.
    Returns reserved inventory to stock and marks all stages as cancelled."""
    set_inventory_context('process_cancel_return', process_number)
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.json or {}
    reason = data.get('reason', 'Cancelled by MenteeFlow')
    print(f'[MenteeFlow CANCEL] Process {process_number} — reason: {reason}')

    # Return picked parts inventory (from stage 2 picked_parts_json)
    stage2 = m['ProcessStage'].query.filter_by(
        process_id=process.id, stage_number=2, stage_sub=None
    ).first()

    returned_parts = []
    if stage2 and stage2.picked_parts_json:
        try:
            picked = json.loads(stage2.picked_parts_json)
        except (json.JSONDecodeError, TypeError):
            picked = []

        for pp in picked:
            part = m['Part'].query.get(pp.get('part_id'))
            if part:
                qty = float(pp.get('quantity', 1))
                old_inv = part.inventory or 0
                part.inventory = old_inv + qty
                returned_parts.append(part.part_number)
                print(f'[INVENTORY] CANCEL RETURN: {part.part_number} (id={part.id}): {old_inv} -> {part.inventory} (returned {qty})')

    # Return auto-withdrawn fasteners/electronics from completed assembly stages
    AUTO_WITHDRAW_TYPES = {'Fasteners', 'Inhouse Electrical Part'}
    from sqlalchemy import or_
    completed_assembly_stages = m['ProcessStage'].query.filter(
        m['ProcessStage'].process_id == process.id,
        m['ProcessStage'].status == 'completed',
        or_(
            m['ProcessStage'].stage_sub.in_(['3.1', '3.2']),
            m['ProcessStage'].stage_number.in_([5, 7, 9])
        )
    ).all()

    for cs in completed_assembly_stages:
        s_key = cs.stage_sub or str(cs.stage_number)
        stage_parts = _get_stage_parts_internal(process, s_key, m)
        for sp in stage_parts:
            part = m['Part'].query.get(sp.get('part_id'))
            if part and part.part_type in AUTO_WITHDRAW_TYPES:
                qty = float(sp.get('quantity', 1))
                old_inv = part.inventory or 0
                part.inventory = old_inv + qty
                returned_parts.append(part.part_number)
                print(f'[INVENTORY] CANCEL RETURN (fastener/elec): {part.part_number} (id={part.id}): {old_inv} -> {part.inventory} (returned {qty})')

    # Mark all stages as cancelled
    all_stages = m['ProcessStage'].query.filter_by(process_id=process.id).all()
    for s in all_stages:
        s.status = 'cancelled'
        s.completed_at = None

    # Cancel the process
    process.status = 'cancelled'
    process.updated_at = datetime.utcnow()

    db.session.commit()

    from utils.logger import log_action
    log_action('PROCESS_CANCELLED', None,
               f'Process {process_number} cancelled. Reason: {reason}. Returned {len(returned_parts)} parts to inventory.')

    return jsonify({
        'success': True,
        'message': 'Process cancelled',
        'process_number': process_number,
        'parts_returned_to_inventory': len(returned_parts),
    })


# ============================================================================
# EMBED TOKEN ENDPOINTS (for MenteeFlow iframe embedding)
# ============================================================================

@robot_assembly_bp.route('/api/menteeflow/process/<process_number>/embed-token', methods=['POST'])
@require_menteeflow_auth
def menteeflow_generate_embed_token(process_number):
    """Regenerate a process-wide embed token (e.g. if the previous one expired).

    Request: { ttl_minutes: 480 }  (optional, default 8h, max 24h)
    Returns: { token, embed_base_url, expires_at }
    """
    m = get_models()

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.json or {}
    try:
        ttl_minutes = int(data.get('ttl_minutes') or 43200)
    except (TypeError, ValueError):
        ttl_minutes = 43200
    ttl_minutes = max(1, min(ttl_minutes, 43200))  # default + cap: 30 days

    embed_info = _get_or_create_process_embed_token(process, ttl_minutes=ttl_minutes)

    return jsonify({
        'success': True,
        'process_number': process_number,
        **embed_info,
    }), 201


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage-parts/<stage>', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_get_stage_parts(process_number, stage):
    """Embed: Get stage parts (mirrors get_stage_parts with token auth)"""
    from flask import g
    process = g.embed_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403

    # Scope check
    token = g.embed_token
    if token.stage_scope and token.stage_scope != stage:
        return jsonify({'success': False, 'error': f'Token scoped to stage {token.stage_scope}, not {stage}'}), 403

    m = get_models()
    dof = m['DOFMapping'].query.get(process.dof_mapping_id) if process.dof_mapping_id else None

    parts_list, assembly_info = _get_stage_parts_internal(process, stage, m, include_assembly=True)

    resp = make_response(jsonify({
        'success': True,
        'assembly': assembly_info,
        'parts': parts_list,
        'dof_name': dof.dof_name if dof else None,
        'stage': str(stage),
        'is_template': bool(process.is_template),
        'read_only': bool(process.is_template),
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/picking-parts', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_get_picking_parts(process_number):
    """Embed: Get picking parts (mirrors get_picking_parts with token auth)"""
    from flask import g
    process = g.embed_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403

    token = g.embed_token
    if token.stage_scope and token.stage_scope != '2':
        return jsonify({'success': False, 'error': 'Token not scoped for picking stage'}), 403

    # Reuse the internal picking parts logic
    m = get_models()
    # Get the DOF info and parts the same way get_picking_parts does
    # We'll call the internal helper that provides full dissolution
    try:
        result = _get_picking_parts_internal(process, m)

        # Include previously saved picked parts so the UI can restore checkmarks
        stage_record = m['ProcessStage'].query.filter_by(
            process_id=process.id, stage_number=2, stage_sub=None
        ).first()
        saved_picked = []
        if stage_record and stage_record.picked_parts_json:
            try:
                saved_picked = json.loads(stage_record.picked_parts_json)
            except (json.JSONDecodeError, TypeError):
                pass
        result['saved_picked_parts'] = saved_picked
        result['is_template'] = bool(process.is_template)
        result['read_only'] = bool(process.is_template)

        resp = make_response(jsonify(result))
        return add_embed_headers(resp)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/<stage>/complete', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_complete_stage(process_number, stage):
    """Embed: Complete a stage (mirrors complete_process_stage with token auth)"""
    from flask import g
    process = g.embed_process
    if not process:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403
    guard = _reject_if_template(process)
    if guard:
        return guard
    if process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403

    token = g.embed_token
    if token.stage_scope and token.stage_scope != stage:
        return jsonify({'success': False, 'error': f'Token scoped to stage {token.stage_scope}, not {stage}'}), 403

    m = get_models()
    db = m['db']

    stage_str = str(stage)
    stage_num, stage_sub = parse_stage_key(stage_str)

    # Check unpicked blocking first
    data = request.json or {}
    force = data.get('force', False)
    if not force and stage_str in ('3.1', '3.2', '5', '7', '9'):
        unpicked = _get_unpicked_parts_for_process(process)
        if unpicked:
            stage_parts = _get_stage_parts_internal(process, stage_str, m)
            parts_list = stage_parts
            missing = []
            for up in unpicked:
                for sp in parts_list:
                    if sp.get('part_number') == up.get('part_number') and \
                       (sp.get('revision') or '') == (up.get('revision') or ''):
                        missing.append(up)
                        break
            if missing:
                resp = make_response(jsonify({
                    'success': False,
                    'error': 'Stage blocked by unpicked parts',
                    'blocking': True,
                    'missing_parts': missing,
                }))
                return add_embed_headers(resp), 400

    stage_record = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=stage_num,
        stage_sub=stage_sub
    ).first()

    if not stage_record:
        return jsonify({'success': False, 'error': f'Stage {stage} not found'}), 404

    if stage_record.status == 'completed':
        return jsonify({'success': False, 'error': f'Stage {stage} already completed'}), 409

    stage_record.status = 'completed'
    stage_record.completed_at = datetime.utcnow()
    stage_record.completed_by = None  # No user in embed context

    # Check if all stages are completed to mark process as completed
    all_stages = m['ProcessStage'].query.filter_by(process_id=process.id).all()
    all_completed = all(s.status == 'completed' for s in all_stages)
    if all_completed:
        process.status = 'completed'
        process.completed_at = datetime.utcnow()
        m['EmbedToken'].query.filter_by(process_id=process.id, is_revoked=False).update({'is_revoked': True})

    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Notify MenteeFlow
    notify_menteeflow(process, float(stage_str) if '.' in stage_str else stage_num)

    resp = make_response(jsonify({
        'success': True,
        'stage': stage_str,
        'message': f'Stage {stage} completed',
        'process_completed': all_completed,
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/2/save-picking', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_save_picking(process_number):
    """Embed: Save partial picking progress (does NOT complete the stage)"""
    from flask import g
    process = g.embed_process
    if not process:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403
    guard = _reject_if_template(process)
    if guard:
        return guard
    if process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403

    m = get_models()
    db = m['db']

    data = request.json or {}
    picked_parts = data.get('picked_parts', [])
    unpicked_parts = data.get('unpicked_parts', [])

    stage = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=2,
        stage_sub=None
    ).first()

    if not stage:
        return jsonify({'success': False, 'error': 'Stage 2 not found'}), 404

    # Save progress without completing or changing inventory
    stage.picked_parts_json = json.dumps(picked_parts)
    stage.unpicked_parts_json = json.dumps(unpicked_parts) if unpicked_parts else None

    print(f'[PICKING SAVE] {process_number}: {len(picked_parts)} picked, {len(unpicked_parts)} unpicked')
    for pp in picked_parts:
        print(f'[PICKING SAVE]   PICKED: {pp.get("part_number")} qty={pp.get("quantity")}')

    process.updated_at = datetime.utcnow()
    db.session.commit()

    resp = make_response(jsonify({
        'success': True,
        'picked_count': len(picked_parts),
        'unpicked_count': len(unpicked_parts),
        'message': 'Picking progress saved',
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/2/pick', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_submit_picking(process_number):
    """Embed: Submit picking data (mirrors submit_picking with token auth)"""
    set_inventory_context('picking', process_number)
    from flask import g
    process = g.embed_process
    if not process:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403
    guard = _reject_if_template(process)
    if guard:
        return guard
    if process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403

    token = g.embed_token
    if token.stage_scope and token.stage_scope != '2':
        return jsonify({'success': False, 'error': 'Token not scoped for picking stage'}), 403

    m = get_models()
    db = m['db']

    data = request.json or {}
    picked_parts = data.get('picked_parts', [])
    unpicked_parts = data.get('unpicked_parts', [])

    stage = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=2,
        stage_sub=None
    ).first()

    if not stage:
        return jsonify({'success': False, 'error': 'Stage 2 not found'}), 404

    # Reduce inventory for picked parts
    for pp in picked_parts:
        part = m['Part'].query.get(pp.get('part_id'))
        if part:
            qty = float(pp.get('quantity', 1))
            part.inventory = max(0, (part.inventory or 0) - qty)

    # Store unpicked parts
    if unpicked_parts:
        stage.unpicked_parts_json = json.dumps(unpicked_parts)

    stage.picked_parts_json = json.dumps(picked_parts)
    stage.status = 'completed'
    stage.completed_at = datetime.utcnow()
    process.updated_at = datetime.utcnow()
    db.session.commit()

    notify_menteeflow(process, 2, {
        'picked_count': len(picked_parts),
        'unpicked_count': len(unpicked_parts),
    })

    resp = make_response(jsonify({
        'success': True,
        'picked_count': len(picked_parts),
        'unpicked_count': len(unpicked_parts),
        'message': 'Picking submitted via embed',
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/repick', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_repick_parts(process_number):
    """Embed: Re-pick parts (mirrors repick_parts with token auth)"""
    set_inventory_context('repick', process_number)
    from flask import g
    process = g.embed_process
    if not process:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403
    guard = _reject_if_template(process)
    if guard:
        return guard
    if process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403

    m = get_models()
    db = m['db']

    data = request.json or {}
    parts_to_repick = data.get('parts', [])
    if not parts_to_repick:
        return jsonify({'success': False, 'error': 'No parts specified'}), 400

    # Get Stage 2 for unpicked_parts_json
    stage2 = m['ProcessStage'].query.filter_by(
        process_id=process.id, stage_number=2, stage_sub=None
    ).first()

    if not stage2 or not stage2.unpicked_parts_json:
        return jsonify({'success': False, 'error': 'No unpicked parts found'}), 400

    unpicked = json.loads(stage2.unpicked_parts_json)
    repicked_count = 0

    for rp in parts_to_repick:
        part_id = rp.get('part_id')
        qty = float(rp.get('quantity', 1))

        part = m['Part'].query.get(part_id)
        if part:
            part.inventory = max(0, (part.inventory or 0) - qty)
            repicked_count += 1

        # Remove from unpicked list
        unpicked = [u for u in unpicked if u.get('part_id') != part_id]

    stage2.unpicked_parts_json = json.dumps(unpicked) if unpicked else None
    db.session.commit()

    notify_menteeflow(process, 2, {
        'status': 'parts_repicked',
        'repicked_count': repicked_count,
    })

    resp = make_response(jsonify({
        'success': True,
        'repicked_count': repicked_count,
        'remaining_unpicked': len(unpicked),
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/<stage>/unpicked-check', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_check_unpicked(process_number, stage):
    """Embed: Check unpicked blocking (mirrors check_unpicked_blocking with token auth)"""
    from flask import g
    process = g.embed_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403

    m = get_models()
    unpicked = _get_unpicked_parts_for_process(process)

    if not unpicked:
        resp = make_response(jsonify({
            'success': True, 'blocking': False, 'missing_parts': [], 'can_proceed': True,
        }))
        return add_embed_headers(resp)

    parts_list = _get_stage_parts_internal(process, stage, m)

    missing = []
    for up in unpicked:
        for sp in parts_list:
            if sp.get('part_number') == up.get('part_number') and \
               (sp.get('revision') or '') == (up.get('revision') or ''):
                up['inventory_available'] = sp.get('inventory', 0)
                missing.append(up)
                break

    resp = make_response(jsonify({
        'success': True,
        'blocking': len(missing) > 0,
        'missing_parts': missing,
        'can_proceed': len(missing) == 0,
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/<stage>/default-drawing', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_get_stage_default_drawing(process_number, stage):
    """Embed: Resolve the default assembly drawing for a process stage"""
    from flask import g
    process = g.embed_process
    if not process or process.process_number != process_number:
        resp = make_response(jsonify({'success': False, 'error': 'Token/process mismatch'}))
        return add_embed_headers(resp), 403

    result = _resolve_default_drawing(process.id, stage)
    resp = make_response(jsonify({'success': True, 'default_drawing': result}))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/<stage>/drawing-options', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_get_stage_drawing_options(process_number, stage):
    """Embed: List all available drawing defaults for a stage — used when auto-resolution fails."""
    from flask import g
    process = g.embed_process
    if not process or process.process_number != process_number:
        resp = make_response(jsonify({'success': False, 'error': 'Token/process mismatch'}))
        return add_embed_headers(resp), 403

    stage_to_type = {'3.2': 'gear', '5': 'motor_and_gear', '7': 'actuator'}
    assembly_type = stage_to_type.get(stage)
    if not assembly_type:
        resp = make_response(jsonify({'success': True, 'options': []}))
        return add_embed_headers(resp)

    m = get_models()
    defaults = m['AssemblyDrawingDefault'].query.filter_by(
        assembly_type=assembly_type, is_active=True
    ).all()

    options = [
        {
            'id': d.id,
            'match_key': d.match_key,
            'display_label': d.display_label or d.match_key,
            'drawing_part_number': d.drawing_part_number,
        }
        for d in defaults if d.drawing_part_number
    ]

    resp = make_response(jsonify({'success': True, 'options': options}))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/<stage>/damaged-part', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_damaged_part(process_number, stage):
    """Embed: Report a damaged part — withdraw 1x replacement from inventory."""
    set_inventory_context('damaged_part_replace', process_number)
    from flask import g
    process = g.embed_process
    if not process:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403
    guard = _reject_if_template(process)
    if guard:
        return guard
    if process.process_number != process_number:
        resp = make_response(jsonify({'success': False, 'error': 'Token/process mismatch'}))
        return add_embed_headers(resp), 403

    m = get_models()
    db = m['db']

    data = request.json or {}
    part_id = data.get('part_id')
    if not part_id:
        resp = make_response(jsonify({'success': False, 'error': 'part_id is required'}))
        return add_embed_headers(resp), 400

    part = m['Part'].query.get(part_id)
    if not part:
        resp = make_response(jsonify({'success': False, 'error': 'Part not found'}))
        return add_embed_headers(resp), 404

    # Withdraw 1 from inventory
    old_inv = part.inventory or 0
    part.inventory = max(0, old_inv - 1)
    print(f'[INVENTORY] DAMAGED PART (embed): {part.part_number} (id={part.id}): {old_inv} -> {part.inventory} (withdrew 1)')

    # Find stage record for audit
    stage_str = str(stage)
    stage_num, stage_sub = parse_stage_key(stage_str)
    stage_record = m['ProcessStage'].query.filter_by(
        process_id=process.id, stage_number=stage_num, stage_sub=stage_sub
    ).first()

    # Create replacement audit record
    replacement = m['PartReplacement'](
        process_id=process.id,
        stage_id=stage_record.id if stage_record else None,
        old_part_id=part.id,
        old_part_number=part.part_number,
        old_revision=part.revision,
        new_part_id=part.id,
        new_part_number=part.part_number,
        new_revision=part.revision,
        quantity=1,
        reason='damaged',
        created_by=None,
    )
    db.session.add(replacement)
    process.updated_at = datetime.utcnow()
    db.session.commit()

    from utils.logger import log_action
    log_action('PART_DAMAGED', None,
               f'Process {process_number} stage {stage}: {part.part_number} damaged, replacement withdrawn from inventory')

    # Notify MenteeFlow about the damaged part
    notify_menteeflow(process, float(stage_str) if '.' in stage_str else stage_num, {
        'status': 'part_damaged',
        'part_number': part.part_number,
        'revision': part.revision,
        'new_inventory': part.inventory,
    })

    resp = make_response(jsonify({
        'success': True,
        'part_number': part.part_number,
        'new_inventory': part.inventory,
        'message': f'1x {part.part_number} withdrawn from inventory',
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/<stage>/pick-part', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_pick_part(process_number, stage):
    """Embed: Late-pick a part that was missed during stage 2 picking.
    Withdraws from inventory and updates the stage 2 picked_parts_json."""
    set_inventory_context('picking', process_number)
    from flask import g
    process = g.embed_process
    if not process:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403
    guard = _reject_if_template(process)
    if guard:
        return guard
    if process.process_number != process_number:
        resp = make_response(jsonify({'success': False, 'error': 'Token/process mismatch'}))
        return add_embed_headers(resp), 403

    m = get_models()
    db = m['db']

    data = request.json or {}
    part_id = data.get('part_id')
    part_number_str = data.get('part_number', '')
    revision = data.get('revision', '')
    quantity = data.get('quantity', 1)

    if not part_id:
        resp = make_response(jsonify({'success': False, 'error': 'part_id is required'}))
        return add_embed_headers(resp), 400

    part = m['Part'].query.get(part_id)
    if not part:
        resp = make_response(jsonify({'success': False, 'error': 'Part not found'}))
        return add_embed_headers(resp), 404

    # Withdraw from inventory
    old_inv = part.inventory or 0
    part.inventory = max(0, old_inv - float(quantity))
    print(f'[INVENTORY] LATE PICK (embed): {part.part_number} (id={part.id}): {old_inv} -> {part.inventory} (withdrew {quantity})')

    # Update stage 2 picked_parts_json to include this part
    stage2 = m['ProcessStage'].query.filter_by(
        process_id=process.id, stage_number=2, stage_sub=None
    ).first()

    if stage2:
        picked = []
        if stage2.picked_parts_json:
            try:
                picked = json.loads(stage2.picked_parts_json)
            except (json.JSONDecodeError, TypeError):
                pass

        # Add to picked list
        picked.append({
            'part_id': part.id,
            'part_number': part.part_number,
            'revision': part.revision,
            'quantity': float(quantity),
        })
        stage2.picked_parts_json = json.dumps(picked)

        # Remove from unpicked list
        unpicked = []
        if stage2.unpicked_parts_json:
            try:
                unpicked = json.loads(stage2.unpicked_parts_json)
            except (json.JSONDecodeError, TypeError):
                pass

        unpicked = [
            u for u in unpicked
            if not (u.get('part_number') == part.part_number and
                    (u.get('revision') or '') == (part.revision or ''))
        ]
        stage2.unpicked_parts_json = json.dumps(unpicked) if unpicked else None

    process.updated_at = datetime.utcnow()
    db.session.commit()

    from utils.logger import log_action
    log_action('PART_LATE_PICKED', None,
               f'Process {process_number} stage {stage}: {part.part_number} late-picked, {quantity}x withdrawn from inventory')

    resp = make_response(jsonify({
        'success': True,
        'part_number': part.part_number,
        'new_inventory': part.inventory,
        'message': f'{quantity}x {part.part_number} picked and withdrawn from inventory',
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/process/<process_number>/stage/<stage>/pick-all-missing', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_pick_all_missing(process_number, stage):
    """Embed: Batch late-pick all missing parts for an assembly stage.
    Withdraws inventory for each supplied part and updates stage 2 picked_parts_json
    in a single transaction.  Called by the MenteeFlow 'check-all' button."""
    set_inventory_context('picking', process_number)
    from flask import g
    process = g.embed_process
    if not process:
        return jsonify({'success': False, 'error': 'Token/process mismatch'}), 403
    guard = _reject_if_template(process)
    if guard:
        return guard
    if process.process_number != process_number:
        resp = make_response(jsonify({'success': False, 'error': 'Token/process mismatch'}))
        return add_embed_headers(resp), 403

    m = get_models()
    db = m['db']

    data = request.json or {}
    parts_to_pick = data.get('parts', [])  # [{part_id, part_number, revision, quantity}]

    if not parts_to_pick:
        resp = make_response(jsonify({'success': True, 'picked_count': 0, 'message': 'No parts to pick'}))
        return add_embed_headers(resp)

    # Load stage 2 record once — all late picks update its JSON columns
    stage2 = m['ProcessStage'].query.filter_by(
        process_id=process.id, stage_number=2, stage_sub=None
    ).first()

    picked = []
    unpicked = []
    if stage2:
        if stage2.picked_parts_json:
            try:
                picked = json.loads(stage2.picked_parts_json)
            except (json.JSONDecodeError, TypeError):
                pass
        if stage2.unpicked_parts_json:
            try:
                unpicked = json.loads(stage2.unpicked_parts_json)
            except (json.JSONDecodeError, TypeError):
                pass

    picked_names = []
    errors = []
    for item in parts_to_pick:
        part_id = item.get('part_id')
        quantity = float(item.get('quantity') or 1)

        part = m['Part'].query.get(part_id)
        if not part:
            errors.append(f'Part id={part_id} not found')
            continue

        old_inv = part.inventory or 0
        part.inventory = max(0, old_inv - quantity)
        print(f'[INVENTORY] BATCH LATE PICK (embed): {part.part_number} (id={part.id}): '
              f'{old_inv} -> {part.inventory} (withdrew {quantity})')

        picked.append({
            'part_id': part.id,
            'part_number': part.part_number,
            'revision': part.revision,
            'quantity': quantity,
        })
        unpicked = [
            u for u in unpicked
            if not (u.get('part_number') == part.part_number and
                    (u.get('revision') or '') == (part.revision or ''))
        ]
        picked_names.append(part.part_number)

    if stage2:
        stage2.picked_parts_json = json.dumps(picked)
        stage2.unpicked_parts_json = json.dumps(unpicked) if unpicked else None

    process.updated_at = datetime.utcnow()
    db.session.commit()

    from utils.logger import log_action
    log_action('PARTS_BATCH_LATE_PICKED', None,
               f'Process {process_number} stage {stage}: {len(picked_names)} parts '
               f'batch late-picked via check-all')

    resp = make_response(jsonify({
        'success': True,
        'picked_count': len(picked_names),
        'errors': errors,
        'message': f'{len(picked_names)} part(s) picked',
    }))
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/part-pdf/<part_number>/<revision>', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_get_part_pdf(part_number, revision):
    """Embed: Serve a part PDF using embed token auth (no login required)."""
    import os
    import glob as glob_module
    from flask import send_file
    from werkzeug.utils import secure_filename

    safe_part_number = secure_filename(part_number)
    safe_revision = secure_filename(revision)

    if not safe_part_number or not safe_revision:
        return jsonify({'success': False, 'error': 'Invalid part number or revision'}), 400

    pdm_base_dir = "C:/PDM/Projects/"
    if not os.path.exists(pdm_base_dir):
        return jsonify({'success': False, 'error': 'PDM directory not accessible'}), 404

    # Glob first — find local cached file
    search_patterns = [
        f"{safe_part_number} REV{safe_revision}.pdf",
        f"{safe_part_number} REV{safe_revision}.PDF",
        f"{safe_part_number}_REV{safe_revision}.pdf",
        f"{safe_part_number}_REV{safe_revision}.PDF",
        f"{safe_part_number} REV{safe_revision.zfill(2)}.pdf",
        f"{safe_part_number} REV{safe_revision.zfill(2)}.PDF",
    ]
    found_files = []
    for pattern in search_patterns:
        found_files.extend(glob_module.glob(os.path.join(pdm_base_dir, "**", pattern), recursive=True))
    found_files = list(dict.fromkeys(found_files))

    # Sync from vault using exact local filename — more reliable than wildcard search
    try:
        from pdm_native_extractor import get_latest_files_native
        if found_files:
            for local_path in found_files:
                exact_stem = os.path.splitext(os.path.basename(local_path))[0]
                res = get_latest_files_native(exact_stem, None, ['.pdf'])
                if res.get('success'):
                    break
        else:
            res = get_latest_files_native(safe_part_number, safe_revision, ['.pdf'])
            if res.get('success'):
                found_files = []
                for pattern in search_patterns:
                    found_files.extend(glob_module.glob(os.path.join(pdm_base_dir, "**", pattern), recursive=True))
                found_files = list(dict.fromkeys(found_files))
    except Exception as e:
        print(f"[embed-PDF] PDM sync exception: {e}")

    if not found_files:
        return jsonify({'success': False, 'error': 'PDF not found'}), 404

    pdf_path = max(found_files, key=os.path.getmtime)
    pdf_path = os.path.abspath(pdf_path)
    pdm_base_abs = os.path.abspath(pdm_base_dir)

    if not pdf_path.startswith(pdm_base_abs):
        return jsonify({'success': False, 'error': 'Security violation'}), 403
    if not pdf_path.lower().endswith('.pdf'):
        return jsonify({'success': False, 'error': 'Not a PDF'}), 400

    resp = make_response(send_file(
        pdf_path,
        as_attachment=False,
        mimetype='application/pdf',
        download_name=f"{safe_part_number}_REV{safe_revision}.pdf"
    ))
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['ETag'] = f'"{safe_part_number}-{safe_revision}-{int(os.path.getmtime(pdf_path))}"'
    return resp


@robot_assembly_bp.route('/api/embed/part-ai/<part_number>', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_get_part_ai(part_number):
    """Embed: Serve an AI instruction PDF using embed token auth (no login required)."""
    import os
    import re
    import glob as glob_module
    from flask import send_file
    from werkzeug.utils import secure_filename
    from urllib.parse import unquote

    decoded_part_number = unquote(part_number)
    safe_part_number = secure_filename(decoded_part_number)

    if not safe_part_number:
        return jsonify({'success': False, 'error': 'Invalid part number'}), 400

    pdm_base_dir = "C:/PDM/Projects/"
    if not os.path.exists(pdm_base_dir):
        return jsonify({'success': False, 'error': 'PDM directory not accessible'}), 404

    search_patterns = [
        f"{safe_part_number}-AI REV*.pdf",
        f"{safe_part_number}-AI REV*.PDF",
        f"{safe_part_number}_AI_REV*.pdf",
        f"{safe_part_number}_AI_REV*.PDF",
        f"{safe_part_number} AI REV*.pdf",
        f"{safe_part_number} AI REV*.PDF",
    ]

    found_files = []
    for pattern in search_patterns:
        search_path = os.path.join(pdm_base_dir, "**", pattern)
        matches = glob_module.glob(search_path, recursive=True)
        found_files.extend(matches)

    # Broader search if exact patterns didn't match
    if not found_files:
        broader_patterns = [
            f"*{safe_part_number}*AI*.pdf",
            f"*{safe_part_number}*AI*.PDF",
        ]
        for pattern in broader_patterns:
            search_path = os.path.join(pdm_base_dir, "**", pattern)
            matches = glob_module.glob(search_path, recursive=True)
            found_files.extend(matches)

    # Deduplicate
    found_files = list(dict.fromkeys(found_files))

    print(f"[part-ai] Found {len(found_files)} candidate file(s) for {safe_part_number}:")
    for f in found_files:
        import datetime
        mtime_str = datetime.datetime.fromtimestamp(os.path.getmtime(f)).strftime('%Y-%m-%d %H:%M:%S')
        print(f"  {f}  (modified: {mtime_str})")

    if not found_files:
        # No local cache — try pulling from PDM vault using guessed stems, then re-scan
        print(f"[part-ai] No local files found, trying PDM vault fallback for {safe_part_number}...")
        try:
            from pdm_native_extractor import get_latest_files_native
            for ai_name in [f"{safe_part_number}-AI", f"{safe_part_number} AI"]:
                print(f"[part-ai] Trying vault pull: '{ai_name}'")
                res = get_latest_files_native(ai_name, None, ['.pdf'])
                if res.get('success'):
                    print(f"[part-ai] Vault pull OK for '{ai_name}', re-scanning local dir...")
                    break
            # Re-scan after vault sync attempt
            for pattern in search_patterns + [f"*{safe_part_number}*AI*.pdf", f"*{safe_part_number}*AI*.PDF"]:
                matches = glob_module.glob(os.path.join(pdm_base_dir, "**", pattern), recursive=True)
                found_files.extend(matches)
            found_files = list(dict.fromkeys(found_files))
        except Exception as e:
            print(f"[part-ai] Vault fallback error: {e}")

    if not found_files:
        print(f"[part-ai] No files found — check naming convention in C:/PDM/Projects/")
        return jsonify({'success': False, 'error': 'AI instructions not found'}), 404

    # Now pull latest from PDM vault using the EXACT filenames found locally.
    # This is far more reliable than a wildcard vault search — the local path
    # proves the file exists in the vault; we just need PDM to sync the latest version.
    try:
        from pdm_native_extractor import get_latest_files_native
        for local_path in found_files:
            exact_stem = os.path.splitext(os.path.basename(local_path))[0]  # e.g. "034-AS-01476-AI REV01"
            pdm_result = get_latest_files_native(exact_stem, None, ['.pdf'])
            if pdm_result.get('success'):
                print(f"[part-ai] PDM sync OK for '{exact_stem}'")
            else:
                print(f"[part-ai] PDM sync failed for '{exact_stem}': {pdm_result.get('failed')}")
    except Exception as e:
        print(f"[part-ai] PDM sync exception: {e}")

    # Find the latest revision
    revision_pattern = re.compile(r'AI\s*REV(\d+)', re.IGNORECASE)
    files_with_revisions = []
    for file_path in found_files:
        filename = os.path.basename(file_path)
        match = revision_pattern.search(filename)
        if match:
            files_with_revisions.append((int(match.group(1)), file_path))

    if not files_with_revisions:
        print(f"[part-ai] Files found but none match AI REV pattern: {[os.path.basename(f) for f in found_files]}")
        return jsonify({'success': False, 'error': 'AI instructions not found'}), 404

    latest_revision, ai_path = max(files_with_revisions, key=lambda x: x[0])
    print(f"[part-ai] Serving REV{latest_revision}: {ai_path}")

    ai_path = os.path.abspath(ai_path)
    pdm_base_abs = os.path.abspath(pdm_base_dir)

    if not ai_path.startswith(pdm_base_abs):
        return jsonify({'success': False, 'error': 'Security violation'}), 403

    if not ai_path.lower().endswith('.pdf'):
        return jsonify({'success': False, 'error': 'Not a PDF'}), 400

    import time
    file_mtime = int(os.path.getmtime(ai_path))
    resp = make_response(send_file(
        ai_path,
        as_attachment=False,
        mimetype='application/pdf',
        download_name=f"{safe_part_number}_AI_REV{latest_revision:02d}.pdf"
    ))
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['ETag'] = f'"{latest_revision}-{file_mtime}"'
    return resp


# ============================================================================
# INTERNAL API ENDPOINTS (for MenteeBOM frontend)
# ============================================================================

@robot_assembly_bp.route('/api/robot-assembly/displayed-badges', methods=['GET'])
@login_required
def get_displayed_badges():
    """Get the list of badges enabled for Robot Assembly display"""
    m = get_models()

    config = m['MenteeFlowConfig'].query.first()
    displayed_ids = []
    if config and config.displayed_badge_ids:
        try:
            displayed_ids = json.loads(config.displayed_badge_ids)
        except (json.JSONDecodeError, TypeError):
            pass

    if not displayed_ids:
        # If none configured, show all badges that have a robot config
        robot_configs = m['RobotConfig'].query.filter_by(is_active=True).all()
        displayed_ids = [rc.badge_id for rc in robot_configs]

    badges = m['ProjectBadge'].query.filter(
        m['ProjectBadge'].id.in_(displayed_ids),
        m['ProjectBadge'].is_active == True
    ).all()

    return jsonify({
        'success': True,
        'badges': [{
            'id': b.id,
            'name': b.name,
            'color': b.color,
        } for b in badges]
    })


@robot_assembly_bp.route('/api/robot-assembly/config/<int:badge_id>', methods=['GET'])
@login_required
def get_robot_config(badge_id):
    """Get robot configuration (image, limbs, DOFs) for a badge"""
    m = get_models()

    config = m['RobotConfig'].query.filter_by(badge_id=badge_id, is_active=True).first()
    if not config:
        return jsonify({'success': False, 'error': 'No robot config for this badge'}), 404

    limbs = m['RobotLimb'].query.filter_by(
        robot_config_id=config.id, is_active=True
    ).order_by(m['RobotLimb'].display_order).all()

    return jsonify({
        'success': True,
        'config': {
            'id': config.id,
            'badge_id': config.badge_id,
            'robot_image_path': config.robot_image_path,
            'robot_image_data': config.robot_image_data,
            'limbs': [{
                'id': limb.id,
                'name': limb.name,
                'slug': limb.slug,
                'region_type': limb.region_type,
                'region_coords': json.loads(limb.region_coords) if limb.region_coords else None,
                'display_order': limb.display_order,
                'color_highlight': limb.color_highlight,
                'dof_count': m['DOFMapping'].query.filter_by(limb_id=limb.id, is_active=True).count(),
            } for limb in limbs]
        }
    })


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/dofs', methods=['GET'])
@login_required
def get_limb_dofs(limb_id):
    """Get DOF list for a limb"""
    m = get_models()

    limb = m['RobotLimb'].query.get_or_404(limb_id)
    dofs = m['DOFMapping'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).order_by(m['DOFMapping'].display_order).all()

    return jsonify({
        'success': True,
        'limb': {
            'id': limb.id,
            'name': limb.name,
            'slug': limb.slug,
        },
        'dofs': [{
            'id': dof.id,
            'dof_number': dof.dof_number,
            'dof_name': dof.dof_name,
            'assembly_description': dof.assembly_description,
            'has_bom': dof.bom_instance_id is not None,
            'display_order': dof.display_order,
        } for dof in dofs]
    })


@robot_assembly_bp.route('/api/robot-assembly/dof/<int:dof_id>/tree', methods=['GET'])
@login_required
def get_dof_tree(dof_id):
    """Get dissolved assembly tree for a DOF"""
    m = get_models()

    dof = m['DOFMapping'].query.get_or_404(dof_id)

    # Find current ProcessBOMInstance
    process_bom = m['ProcessBOMInstance'].query.filter_by(
        dof_mapping_id=dof_id, is_current=True
    ).first()

    if not process_bom:
        return jsonify({
            'success': True,
            'dof': {
                'id': dof.id,
                'dof_number': dof.dof_number,
                'dof_name': dof.dof_name,
            },
            'tree': None,
            'message': 'No process BOM available. Build one from admin or start a process.'
        })

    try:
        tree = json.loads(process_bom.dissolved_tree_json)
    except (json.JSONDecodeError, TypeError):
        tree = []

    return jsonify({
        'success': True,
        'dof': {
            'id': dof.id,
            'dof_number': dof.dof_number,
            'dof_name': dof.dof_name,
        },
        'tree': tree,
        'process_bom_id': process_bom.id,
        'version': process_bom.version,
        'updated_at': process_bom.updated_at.isoformat() + 'Z' if process_bom.updated_at else None,
    })


@robot_assembly_bp.route('/api/robot-assembly/dof/<int:dof_id>/process-bom', methods=['GET'])
@login_required
def get_or_create_process_bom(dof_id):
    """Get or create ProcessBOMInstance for a DOF"""
    m = get_models()

    dof = m['DOFMapping'].query.get_or_404(dof_id)

    # Check for existing current ProcessBOM
    process_bom = m['ProcessBOMInstance'].query.filter_by(
        dof_mapping_id=dof_id, is_current=True
    ).first()

    if process_bom:
        try:
            tree = json.loads(process_bom.dissolved_tree_json)
        except (json.JSONDecodeError, TypeError):
            tree = []
        return jsonify({
            'success': True,
            'process_bom_id': process_bom.id,
            'version': process_bom.version,
            'tree': tree,
            'updated_at': process_bom.updated_at.isoformat() + 'Z' if process_bom.updated_at else None,
        })

    return jsonify({
        'success': True,
        'process_bom_id': None,
        'tree': None,
        'message': 'No process BOM exists yet. Use rebuild endpoint to create one.'
    })


@robot_assembly_bp.route('/api/robot-assembly/dof/<int:dof_id>/rebuild-process-bom', methods=['POST'])
@login_required
def rebuild_process_bom(dof_id):
    """Force re-dissolution and rebuild of ProcessBOMInstance for a DOF"""
    m = get_models()
    db = m['db']

    dof = m['DOFMapping'].query.get_or_404(dof_id)
    limb = m['RobotLimb'].query.get(dof.limb_id)
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id) if limb else None
    badge_id = robot_config.badge_id if robot_config else None

    if not badge_id:
        return jsonify({'success': False, 'error': 'Cannot determine badge for this DOF'}), 400

    # TODO: Implement full dissolution algorithm (Phase 3)
    # For now, return a placeholder
    return jsonify({
        'success': False,
        'error': 'Dissolution algorithm not yet implemented. Coming in Phase 3.'
    }), 501


@robot_assembly_bp.route('/api/robot-assembly/processes', methods=['GET'])
@login_required
def list_processes():
    """List manufacturing processes with filters"""
    m = get_models()

    badge_id = request.args.get('badge_id', type=int)
    status = request.args.get('status', 'active')  # active, completed, all
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    include_templates = request.args.get('include_templates', type=int)

    query = m['ManufacturingProcess'].query

    # Exclude read-only DOF template processes from normal lists (floor/engineer views)
    if not include_templates:
        query = query.filter(m['ManufacturingProcess'].is_template.is_(False))

    if badge_id:
        query = query.filter_by(badge_id=badge_id)

    if status == 'active':
        query = query.filter(m['ManufacturingProcess'].status.in_(['active', 'on_hold']))
    elif status == 'completed':
        query = query.filter_by(status='completed')
    # 'all' means no filter

    processes = query.order_by(m['ManufacturingProcess'].created_at.desc()).limit(per_page).offset((page - 1) * per_page).all()

    # Batch-load stage statuses for all processes
    process_ids = [p.id for p in processes]
    all_stages = m['ProcessStage'].query.filter(
        m['ProcessStage'].process_id.in_(process_ids)
    ).all() if process_ids else []

    # Build a map: process_id -> { stage_key: status }
    stage_map = {}
    for s in all_stages:
        key = s.stage_sub or str(s.stage_number)
        stage_map.setdefault(s.process_id, {})[key] = s.status

    return jsonify({
        'success': True,
        'processes': [{
            'id': p.id,
            'process_number': p.process_number,
            'name': p.name,
            'badge_id': p.badge_id,
            'badge_name': p.badge.name if p.badge else None,
            'dof_name': p.dof_mapping.dof_name if p.dof_mapping else None,
            'limb_name': p.dof_mapping.limb.name if p.dof_mapping and p.dof_mapping.limb else None,
            'current_stage': p.current_stage,
            'status': p.status,
            'stage_statuses': stage_map.get(p.id, {}),
            'menteeflow_url': p.menteeflow_url,
            'created_at': p.created_at.isoformat() + 'Z' if p.created_at else None,
            'updated_at': p.updated_at.isoformat() + 'Z' if p.updated_at else None,
            'completed_at': p.completed_at.isoformat() + 'Z' if p.completed_at else None,
        } for p in processes]
    })


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>', methods=['GET'])
@login_required
def get_process_detail(process_id):
    """Get detailed process info with all stages"""
    m = get_models()

    process = m['ManufacturingProcess'].query.get_or_404(process_id)
    stages = m['ProcessStage'].query.filter_by(process_id=process.id).order_by(
        m['ProcessStage'].stage_number, m['ProcessStage'].stage_sub
    ).all()

    return jsonify({
        'success': True,
        'process': {
            'id': process.id,
            'process_number': process.process_number,
            'name': process.name,
            'badge_id': process.badge_id,
            'badge_name': process.badge.name if process.badge else None,
            'dof_mapping_id': process.dof_mapping_id,
            'dof_name': process.dof_mapping.dof_name if process.dof_mapping else None,
            'limb_name': process.dof_mapping.limb.name if process.dof_mapping and process.dof_mapping.limb else None,
            'current_stage': process.current_stage,
            'status': process.status,
            'menteeflow_url': process.menteeflow_url,
            'menteeflow_ticket_id': process.menteeflow_ticket_id,
            'created_at': process.created_at.isoformat() + 'Z' if process.created_at else None,
            'updated_at': process.updated_at.isoformat() + 'Z' if process.updated_at else None,
            'completed_at': process.completed_at.isoformat() + 'Z' if process.completed_at else None,
        },
        'stages': [{
            'id': s.id,
            'stage_number': s.stage_number,
            'stage_sub': s.stage_sub,
            'stage_name': s.stage_name,
            'status': s.status,
            'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
            'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
        } for s in stages]
    })


@robot_assembly_bp.route('/api/robot-assembly/process/by-number/<process_number>', methods=['GET'])
@login_required
def get_process_by_number(process_number):
    """Look up a process by its process_number (for deep-linking from URLs)"""
    m = get_models()

    process = m['ManufacturingProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stages = m['ProcessStage'].query.filter_by(process_id=process.id).order_by(
        m['ProcessStage'].stage_number, m['ProcessStage'].stage_sub
    ).all()

    return jsonify({
        'success': True,
        'process': {
            'id': process.id,
            'process_number': process.process_number,
            'name': process.name,
            'badge_id': process.badge_id,
            'badge_name': process.badge.name if process.badge else None,
            'dof_mapping_id': process.dof_mapping_id,
            'dof_name': process.dof_mapping.dof_name if process.dof_mapping else None,
            'limb_name': process.dof_mapping.limb.name if process.dof_mapping and process.dof_mapping.limb else None,
            'current_stage': process.current_stage,
            'status': process.status,
            'menteeflow_url': process.menteeflow_url,
            'menteeflow_ticket_id': process.menteeflow_ticket_id,
            'created_at': process.created_at.isoformat() + 'Z' if process.created_at else None,
            'updated_at': process.updated_at.isoformat() + 'Z' if process.updated_at else None,
            'completed_at': process.completed_at.isoformat() + 'Z' if process.completed_at else None,
        },
        'stages': [{
            'id': s.id,
            'stage_number': s.stage_number,
            'stage_sub': s.stage_sub,
            'stage_name': s.stage_name,
            'status': s.status,
            'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
            'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
        } for s in stages]
    })


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/stage/<stage_number>/complete', methods=['POST'])
@login_required
def complete_process_stage(process_id, stage_number):
    """Complete a stage (stages 3-9) and notify MenteeFlow"""
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.get_or_404(process_id)

    stage_str = str(stage_number)
    stage_num, stage_sub = parse_stage_key(stage_str)

    stage_record = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=stage_num,
        stage_sub=stage_sub
    ).first()

    if not stage_record:
        return jsonify({'success': False, 'error': f'Stage {stage_number} not found'}), 404

    if stage_record.status != 'in_progress':
        return jsonify({'success': False, 'error': f'Stage {stage_number} is not in progress'}), 400

    # Check for unpicked parts blocking this stage (stages 3-6)
    data = request.json or {}
    if stage_num >= 3 and not data.get('force'):
        unpicked = _get_unpicked_parts_for_process(process)
        if unpicked:
            stage_parts = _get_stage_parts_internal(process, stage_number, m)
            unpicked_lookup = {(up.get('part_number') or '', up.get('revision') or ''): up for up in unpicked}
            blocking_parts = []
            for sp in stage_parts:
                if sp.get('is_assembly'):
                    continue
                key = (sp.get('part_number', ''), sp.get('revision', '') or '')
                if key in unpicked_lookup:
                    blocking_parts.append({
                        'part_number': sp['part_number'],
                        'revision': sp.get('revision', ''),
                        'description': sp.get('description', ''),
                    })
            if blocking_parts:
                return jsonify({
                    'success': False,
                    'error': 'Cannot complete stage — missing unpicked parts',
                    'blocking': True,
                    'missing_parts': blocking_parts,
                }), 400

    # Complete the stage
    stage_record.status = 'completed'
    stage_record.completed_at = datetime.utcnow()
    stage_record.completed_by = current_user.id

    callback_data = {'assembly_completed': True}

    # Stage-specific logic
    if stage_num == 9:
        # Final stage - close the process
        process.status = 'completed'
        process.completed_at = datetime.utcnow()

    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Notify MenteeFlow
    notify_menteeflow(process, float(stage_sub) if stage_sub else stage_num, callback_data)

    from utils.logger import log_action
    log_action('PROCESS_STAGE_COMPLETED', current_user,
               f'Process {process.process_number} stage {stage_number} completed')

    return jsonify({
        'success': True,
        'message': f'Stage {stage_number} completed',
        'process_status': process.status,
    })


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/picking-parts', methods=['GET'])
@login_required
def get_picking_parts(process_id):
    """Get the FULLY DISSOLVED parts list for picking.

    Dissolution algorithm:
    1. Start from the DOF assembly node in the limb's BOM tree.
    2. Walk the tree recursively. For each node:
       - If it's a leaf part (non-assembly): add to results with accumulated qty multiplier.
       - If it's an assembly WITH children in the current BOM: recurse into children.
       - If it's an assembly WITHOUT children in current BOM: check if it has its
         OWN BOMInstance. If so, load that BOM's parts and dissolve recursively.
         If not, add it as-is (undissolvable assembly).
    3. Quantity multiplication: each level multiplies by parent qty.
    4. Consolidate duplicates: same (part_number, revision) → sum quantities.
    5. Inventory comes directly from Part.inventory in the database.
    """
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.get_or_404(process_id)
    dof = m['DOFMapping'].query.get(process.dof_mapping_id) if process.dof_mapping_id else None

    if not dof:
        return jsonify({'success': False, 'error': 'No DOF mapping for this process'}), 404

    limb = m['RobotLimb'].query.get(dof.limb_id)
    if not limb or not limb.assembly_part_number:
        return jsonify({'success': False, 'error': 'No assembly linked to this DOF\'s limb'}), 404

    robot_config = m['RobotConfig'].query.get(limb.robot_config_id)
    badge_id = robot_config.badge_id if robot_config else process.badge_id

    # --- Helper: load all BOMParts for a given bom_instance_id ---
    bom_cache = {}  # bom_instance_id -> [(BOMPart, Part), ...]

    def load_bom_parts(bom_id):
        if bom_id in bom_cache:
            return bom_cache[bom_id]
        parts = (
            db.session.query(m['BOMPart'], m['Part'])
            .join(m['Part'])
            .filter(m['BOMPart'].bom_id == bom_id)
            .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
            .all()
        )
        bom_cache[bom_id] = parts
        return parts

    # --- Helper: find a BOMInstance for an assembly part_number ---
    bom_instance_cache = {}  # part_number -> BOMInstance or None

    def find_bom_for_assembly(part_number):
        if part_number in bom_instance_cache:
            return bom_instance_cache[part_number]
        bom = m['BOMInstance'].query.filter_by(
            assembly_part_number=part_number,
            badge_id=badge_id,
            is_latest=True,
        ).first()
        if not bom:
            bom = m['BOMInstance'].query.filter_by(
                assembly_part_number=part_number,
                is_latest=True,
            ).first()
        bom_instance_cache[part_number] = bom
        return bom

    # --- Core dissolution: collect leaf parts with qty multiplier ---
    # Tracks visited BOMs to prevent infinite loops
    visited_boms = set()

    def dissolve_bom(bom_id, parent_bp_id, qty_multiplier):
        """Dissolve children of parent_bp_id in the given bom_id.
        If parent_bp_id is None, dissolve root-level parts (level 0)."""
        all_parts = load_bom_parts(bom_id)
        results = []  # list of (part_number, revision, part_id, qty, description, part_type)

        if parent_bp_id is not None:
            children = [(bp, p) for bp, p in all_parts if bp.parent_bom_part_id == parent_bp_id]
        else:
            # Root level of this BOM
            children = [(bp, p) for bp, p in all_parts if bp.level == 0]

        for bp, part in children:
            is_assembly = (part.part_type == 'Assembly') if part.part_type else False
            child_qty = (bp.quantity or 1) * qty_multiplier

            if not is_assembly:
                # Leaf part — add with accumulated qty
                results.append({
                    'part_id': part.id,
                    'part_number': part.part_number,
                    'revision': part.revision or '',
                    'quantity': child_qty,
                })
            else:
                # Assembly — check for children in THIS BOM first
                has_children_here = any(
                    bp2.parent_bom_part_id == bp.id for bp2, _ in all_parts
                )
                if has_children_here:
                    # Has children in current BOM → recurse within same BOM
                    results.extend(dissolve_bom(bom_id, bp.id, child_qty))
                else:
                    # No children here — look for its own BOMInstance
                    child_bom = find_bom_for_assembly(part.part_number)
                    if child_bom and child_bom.id not in visited_boms:
                        visited_boms.add(child_bom.id)
                        # Dissolve the child assembly's BOM, starting from its roots
                        results.extend(dissolve_bom(child_bom.id, None, child_qty))
                    else:
                        # No BOM found or already visited — add assembly as leaf
                        results.append({
                            'part_id': part.id,
                            'part_number': part.part_number,
                            'revision': part.revision or '',
                            'quantity': child_qty,
                        })

        return results

    # --- Find the starting point ---
    # Load the limb's BOM
    limb_bom = find_bom_for_assembly(limb.assembly_part_number)
    if not limb_bom:
        return jsonify({'success': True, 'parts': [], 'message': f'No BOM found for assembly {limb.assembly_part_number}'})

    visited_boms.add(limb_bom.id)
    limb_parts = load_bom_parts(limb_bom.id)

    # Find the DOF sub-tree root by matching assembly_description to part_number
    dof_root_bp = None
    for bp, part in limb_parts:
        if part.part_number == dof.assembly_description:
            dof_root_bp = bp
            break

    if dof_root_bp:
        # Check if DOF root has children in the limb BOM
        has_children = any(bp2.parent_bom_part_id == dof_root_bp.id for bp2, _ in limb_parts)
        if has_children:
            # Dissolve from DOF root's children within the limb BOM
            raw_parts = dissolve_bom(limb_bom.id, dof_root_bp.id, 1.0)
        else:
            # DOF assembly has its own BOMInstance — dissolve that
            dof_bom = find_bom_for_assembly(dof.assembly_description)
            if dof_bom and dof_bom.id not in visited_boms:
                visited_boms.add(dof_bom.id)
                raw_parts = dissolve_bom(dof_bom.id, None, 1.0)
            else:
                raw_parts = []
    else:
        # Fallback: dissolve entire limb BOM
        raw_parts = dissolve_bom(limb_bom.id, None, 1.0)

    # --- Consolidate duplicates: (part_number, revision) → summed qty ---
    consolidated = {}  # key: (part_number, revision) → {part_id, total_qty}
    for item in raw_parts:
        key = (item['part_number'], item['revision'])
        if key in consolidated:
            consolidated[key]['quantity'] += item['quantity']
        else:
            consolidated[key] = {
                'part_id': item['part_id'],
                'part_number': item['part_number'],
                'revision': item['revision'],
                'quantity': item['quantity'],
            }

    # --- Fetch fresh Part data for all consolidated parts (inventory, thumbnail, etc.) ---
    part_ids = list(set(v['part_id'] for v in consolidated.values()))
    parts_by_id = {}
    if part_ids:
        for part in m['Part'].query.filter(m['Part'].id.in_(part_ids)).all():
            parts_by_id[part.id] = part

    # --- Build final output ---
    parts_list = []
    for key, item in sorted(consolidated.items(), key=lambda x: x[0]):
        part = parts_by_id.get(item['part_id'])
        if not part:
            continue

        thumb = _get_part_thumb(part)

        parts_list.append({
            'part_id': part.id,
            'part_number': part.part_number,
            'revision': part.revision,
            'description': part.description or part.part_name or '',
            'part_type': part.part_type or '',
            'quantity': item['quantity'],
            'inventory': part.inventory if part.inventory is not None else 0,
            'warehouse_box': part.warehouse_box_number,
            'thumbnail': thumb,
        })

    return jsonify({
        'success': True,
        'parts': parts_list,
        'dof_name': dof.dof_name,
        'total_unique_parts': len(parts_list),
    })


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/stage-parts/<stage>', methods=['GET'])
@login_required
def get_stage_parts(process_id, stage):
    """Get parts for a specific assembly stage (3.1, 3.2, 4, 5, 6).

    Each stage corresponds to a sub-assembly in the DOF tree, identified by
    matching keywords in the assembly description:
      3.1 → "motor assembly" (but NOT "motor and gear" / "motor & gear")
      3.2 → "gear assembly" (but NOT "motor and gear" / "motor & gear")
      4   → "motor and gear" / "motor & gear"
      5   → "actuator"
      6   → the DOF assembly itself

    Returns the assembly info (part_number, description — needed for PDF/AI)
    plus its direct children.
    """
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.get_or_404(process_id)
    dof = m['DOFMapping'].query.get(process.dof_mapping_id) if process.dof_mapping_id else None
    if not dof:
        return jsonify({'success': False, 'error': 'No DOF mapping for this process'}), 404

    limb = m['RobotLimb'].query.get(dof.limb_id)
    if not limb or not limb.assembly_part_number:
        return jsonify({'success': False, 'error': 'No assembly linked to this DOF\'s limb'}), 404

    robot_config = m['RobotConfig'].query.get(limb.robot_config_id)
    badge_id = robot_config.badge_id if robot_config else process.badge_id

    # --- Helper to find BOMInstance ---
    def find_bom(part_number):
        bom = m['BOMInstance'].query.filter_by(
            assembly_part_number=part_number, badge_id=badge_id, is_latest=True
        ).first()
        if not bom:
            bom = m['BOMInstance'].query.filter_by(
                assembly_part_number=part_number, is_latest=True
            ).first()
        return bom

    # --- Load the DOF assembly's full tree ---
    # First, find the DOF assembly's parts (could be in the limb BOM or its own BOM)
    limb_bom = find_bom(limb.assembly_part_number)
    if not limb_bom:
        return jsonify({'success': True, 'assembly': None, 'parts': [],
                        'message': f'No BOM found for {limb.assembly_part_number}'})

    limb_parts = (
        db.session.query(m['BOMPart'], m['Part'])
        .join(m['Part'])
        .filter(m['BOMPart'].bom_id == limb_bom.id)
        .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
        .all()
    )

    # Find DOF root in limb BOM
    dof_root_bp = None
    dof_root_part = None
    for bp, part in limb_parts:
        if part.part_number == dof.assembly_description:
            dof_root_bp = bp
            dof_root_part = part
            break

    # Determine the BOM + parent that contains the DOF's direct children
    dof_bom_id = limb_bom.id
    dof_parent_bp_id = dof_root_bp.id if dof_root_bp else None
    dof_bom_parts = limb_parts

    if dof_root_bp:
        has_children = any(bp.parent_bom_part_id == dof_root_bp.id for bp, _ in limb_parts)
        if not has_children:
            # DOF assembly has its own BOM
            dof_own_bom = find_bom(dof.assembly_description)
            if dof_own_bom:
                dof_bom_id = dof_own_bom.id
                dof_parent_bp_id = None  # root level
                dof_bom_parts = (
                    db.session.query(m['BOMPart'], m['Part'])
                    .join(m['Part'])
                    .filter(m['BOMPart'].bom_id == dof_own_bom.id)
                    .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
                    .all()
                )

    # --- Stage matching: walk the DOF's children to find all assemblies ---
    # Collect all assembly nodes (direct and nested) within the DOF tree
    def collect_all_assemblies(bom_parts_list, parent_bp_id, depth=0):
        """Recursively collect all assembly nodes from the tree."""
        if parent_bp_id is not None:
            children = [(bp, p) for bp, p in bom_parts_list if bp.parent_bom_part_id == parent_bp_id]
        else:
            children = [(bp, p) for bp, p in bom_parts_list if bp.level == 0]

        assemblies = []
        for bp, part in children:
            is_assembly = (part.part_type == 'Assembly') if part.part_type else False
            if is_assembly:
                assemblies.append((bp, part, depth))
                # Check if this assembly has children in the same BOM
                has_children = any(bp2.parent_bom_part_id == bp.id for bp2, _ in bom_parts_list)
                if has_children:
                    assemblies.extend(collect_all_assemblies(bom_parts_list, bp.id, depth + 1))
                else:
                    # May have its own BOM — check and recurse
                    child_bom = find_bom(part.part_number)
                    if child_bom:
                        child_bom_parts = (
                            db.session.query(m['BOMPart'], m['Part'])
                            .join(m['Part'])
                            .filter(m['BOMPart'].bom_id == child_bom.id)
                            .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
                            .all()
                        )
                        assemblies.extend(collect_all_assemblies(child_bom_parts, None, depth + 1))
        return assemblies

    all_assemblies = collect_all_assemblies(dof_bom_parts, dof_parent_bp_id)

    # --- Match stage to assembly by description keywords ---
    stage_str = str(stage)

    def match_stage(desc):
        """Return which stage an assembly description matches."""
        d = (desc or '').lower()
        # Order matters: check "motor and gear" / "motor & gear" BEFORE "motor" / "gear"
        if 'motor and gear' in d or 'motor & gear' in d or 'motor+gear' in d:
            return '5'
        if 'actuator' in d:
            return '7'
        if 'motor' in d and 'gear' not in d and ('assembly' in d or 'assy' in d):
            return '3.1'
        if 'gear' in d and 'motor' not in d and ('assembly' in d or 'assy' in d):
            return '3.2'
        return None

    target_assembly = None
    target_bp = None

    if stage_str == '9':
        # Stage 9 is the DOF assembly itself
        target_assembly = dof_root_part
        target_bp = dof_root_bp
    else:
        # For stage 3.1/3.2, only search inside the Motor+Gear (stage 5) subtree.
        # An unrelated assembly with "gear"/"motor" in its name can appear as a direct
        # DOF child and must not shadow the real sub-assembly inside stage 5.
        stage5_depth = None
        if stage_str in ('3.1', '3.2'):
            for _, part, depth in all_assemblies:
                desc = part.description or part.part_name or ''
                if match_stage(desc) == '5':
                    if stage5_depth is None or depth < stage5_depth:
                        stage5_depth = depth

        best_depth = None
        for bp, part, depth in all_assemblies:
            desc = part.description or part.part_name or ''
            matched = match_stage(desc)
            if matched != stage_str:
                continue
            if stage5_depth is not None and depth <= stage5_depth:
                continue
            if best_depth is None or depth < best_depth:
                target_assembly = part
                target_bp = bp
                best_depth = depth

    if not target_assembly:
        return jsonify({
            'success': True,
            'assembly': None,
            'parts': [],
            'message': f'No assembly found for stage {stage}. Check that assembly descriptions contain stage keywords (motor, gear, actuator, etc.)',
            'available_assemblies': [
                {'part_number': p.part_number, 'description': p.description or p.part_name or ''}
                for _, p, _ in all_assemblies
            ],
        })

    # --- Load direct children of the target assembly ---
    # The target assembly might be in the limb BOM, the DOF's own BOM, or its own separate BOM
    # Try to find its children
    def get_assembly_children(assembly_part, assembly_bp):
        """Get direct children of an assembly, checking current BOM first, then its own BOM."""
        # Check in the BOM where the assembly_bp lives
        if assembly_bp:
            parent_bom_id = assembly_bp.bom_id if hasattr(assembly_bp, 'bom_id') else None
            if parent_bom_id:
                bp_in_bom = (
                    db.session.query(m['BOMPart'], m['Part'])
                    .join(m['Part'])
                    .filter(m['BOMPart'].bom_id == parent_bom_id)
                    .filter(m['BOMPart'].parent_bom_part_id == assembly_bp.id)
                    .order_by(m['BOMPart'].sequence)
                    .all()
                )
                if bp_in_bom:
                    return bp_in_bom

        # No children in parent BOM — check its own BOM
        own_bom = find_bom(assembly_part.part_number)
        if own_bom:
            return (
                db.session.query(m['BOMPart'], m['Part'])
                .join(m['Part'])
                .filter(m['BOMPart'].bom_id == own_bom.id)
                .filter(m['BOMPart'].level == 0)
                .order_by(m['BOMPart'].sequence)
                .all()
            )
        return []

    children = get_assembly_children(target_assembly, target_bp)

    # --- Dissolve all child assemblies, keeping only prior-stage assemblies intact ---
    #
    # Stage build order:  3.1, 3.2, 5, 7, 9
    # The only assemblies kept as single "Assembly" rows are those that were
    # already built in a PREVIOUS stage. Everything else gets dissolved.
    #
    # Stage 3.1 (motor):     no prior stages → dissolve everything
    # Stage 3.2 (gear):      no prior stages → dissolve everything
    # Stage 5   (motor+gear): 3.1 and 3.2 are prior → keep motor & gear assemblies
    # Stage 7   (actuator):   5 is prior → keep motor+gear assembly
    # Stage 9   (DOF):        7 is prior → keep actuator assembly
    stage_rank = {'3.1': 0, '3.2': 0, '5': 1, '7': 2, '9': 3}
    current_rank = stage_rank.get(stage_str, 99)

    def get_assembly_stage_id(desc):
        """Return stage id for an assembly description, or None."""
        d = (desc or '').lower()
        if 'motor and gear' in d or 'motor & gear' in d or 'motor+gear' in d:
            return '5'
        if 'actuator' in d:
            return '7'
        if 'motor' in d and 'gear' not in d and ('assembly' in d or 'assy' in d):
            return '3.1'
        if 'gear' in d and 'motor' not in d and ('assembly' in d or 'assy' in d):
            return '3.2'
        return None

    def is_prior_stage(desc):
        """True if this assembly was built in a stage BEFORE the current one."""
        s = get_assembly_stage_id(desc)
        if s is None:
            return False
        return stage_rank.get(s, 99) < current_rank

    def dissolve_assembly_recursive(assembly_part, assembly_bp, qty_mult):
        """Dissolve an assembly. Stop only at prior-stage assemblies."""
        asm_children = get_assembly_children(assembly_part, assembly_bp)
        results = []
        for cbp, cpart in asm_children:
            child_is_asm = (cpart.part_type == 'Assembly') if cpart.part_type else False
            child_qty = (cbp.quantity or 1) * qty_mult
            if child_is_asm and is_prior_stage(cpart.description or cpart.part_name or ''):
                # Prior stage assembly → keep as opaque row
                results.append((cpart, child_qty, True))
            elif child_is_asm:
                # Current-stage or non-stage assembly → dissolve
                results.extend(dissolve_assembly_recursive(cpart, cbp, child_qty))
            else:
                # Leaf part
                results.append((cpart, child_qty, False))
        return results

    # --- Build response ---
    def parse_thumb(part):
        return _get_part_thumb(part)

    asm_thumb = parse_thumb(target_assembly)

    assembly_info = {
        'part_id': target_assembly.id,
        'part_number': target_assembly.part_number,
        'revision': target_assembly.revision,
        'description': target_assembly.description or target_assembly.part_name or '',
        'thumbnail': asm_thumb,
    }

    # Dissolve all children, then consolidate duplicates
    dissolved_parts = []
    for bp, part in children:
        is_asm = (part.part_type == 'Assembly') if part.part_type else False
        qty = bp.quantity or 1

        if is_asm and is_prior_stage(part.description or part.part_name or ''):
            dissolved_parts.append((part, qty, True))
        elif is_asm:
            dissolved_parts.extend(dissolve_assembly_recursive(part, bp, qty))
        else:
            dissolved_parts.append((part, qty, False))

    # Consolidate by (part_number, revision)
    consolidated = {}
    for dpart, dqty, d_is_asm in dissolved_parts:
        key = (dpart.part_number, dpart.revision or '')
        if key not in consolidated:
            consolidated[key] = {
                'part_id': dpart.id,
                'part_number': dpart.part_number,
                'revision': dpart.revision,
                'description': dpart.description or dpart.part_name or '',
                'part_type': dpart.part_type or '',
                'is_assembly': d_is_asm,
                'quantity': dqty,
                'inventory': dpart.inventory if dpart.inventory is not None else 0,
                'warehouse_box': dpart.warehouse_box_number,
                'thumbnail': parse_thumb(dpart),
            }
        else:
            consolidated[key]['quantity'] += dqty

    parts_list = list(consolidated.values())

    return jsonify({
        'success': True,
        'assembly': assembly_info,
        'parts': parts_list,
        'dof_name': dof.dof_name,
        'stage': stage_str,
    })


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/stage/2/pick', methods=['POST'])
@login_required
def submit_picking(process_id):
    """Stage 2: Submit picking data and notify MenteeFlow"""
    set_inventory_context('picking', f"process_id:{process_id}")
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.get_or_404(process_id)

    stage_record = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=2,
        stage_sub=None
    ).first()

    if not stage_record:
        return jsonify({'success': False, 'error': 'Stage 2 not found'}), 404

    if stage_record.status != 'in_progress':
        return jsonify({'success': False, 'error': 'Stage 2 is not in progress'}), 400

    data = request.json or {}
    picked_parts = data.get('picked_parts', [])
    unpicked_parts = data.get('unpicked_parts', [])

    # Store picking data
    stage_record.stage_data_json = json.dumps({'picked_parts': picked_parts})
    stage_record.picked_parts_json = json.dumps(picked_parts)
    stage_record.unpicked_parts_json = json.dumps(unpicked_parts) if unpicked_parts else None

    # Complete stage 2
    stage_record.status = 'completed'
    stage_record.completed_at = datetime.utcnow()
    stage_record.completed_by = current_user.id

    # Update inventory for picked parts
    for part_info in picked_parts:
        part_id = part_info.get('part_id')
        qty = part_info.get('quantity', 1)
        if part_id:
            part = m['Part'].query.get(part_id)
            if part and part.inventory is not None:
                part.inventory = max(0, part.inventory - qty)

    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Notify MenteeFlow
    callback_data = {
        'all_parts_picked': len(unpicked_parts) == 0,
        'picked_count': len(picked_parts),
        'total_count': len(picked_parts) + len(unpicked_parts),
    }
    if unpicked_parts:
        callback_data['unpicked_parts'] = unpicked_parts

    notify_menteeflow(process, 2, callback_data)

    from utils.logger import log_action
    log_action('PROCESS_PICKING_COMPLETED', current_user,
               f'Process {process.process_number} picking completed. Picked: {len(picked_parts)}, Unpicked: {len(unpicked_parts)}')

    return jsonify({
        'success': True,
        'message': 'Picking completed',
        'picked_count': len(picked_parts),
        'unpicked_count': len(unpicked_parts),
    })


# ============================================================================
# UNPICKED PARTS BLOCKING & RE-PICK (Feature 1)
# ============================================================================

def _get_unpicked_parts_for_process(process):
    """Helper: get the unpicked parts list from Stage 2 for a process.
    Returns a list of dicts with part_number, revision, quantity."""
    m = get_models()
    stage2 = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=2,
        stage_sub=None
    ).first()

    if not stage2 or not stage2.unpicked_parts_json:
        return []

    try:
        return json.loads(stage2.unpicked_parts_json)
    except (json.JSONDecodeError, TypeError):
        return []


def _get_picking_parts_internal(process, m=None):
    """Internal helper: get picking parts for a process.
    Returns a dict with success, parts, dof_name (same structure as get_picking_parts endpoint)."""
    if m is None:
        m = get_models()
    db = m['db']

    dof = m['DOFMapping'].query.get(process.dof_mapping_id) if process.dof_mapping_id else None
    if not dof:
        return {'success': False, 'error': 'No DOF mapping for this process'}

    limb = m['RobotLimb'].query.get(dof.limb_id) if dof.limb_id else None
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id) if limb else None
    badge_id = robot_config.badge_id if robot_config else process.badge_id

    bom_cache = {}
    bom_instance_cache = {}

    def load_bom_parts(bom_id):
        if bom_id in bom_cache:
            return bom_cache[bom_id]
        parts = (
            db.session.query(m['BOMPart'], m['Part'])
            .join(m['Part'])
            .filter(m['BOMPart'].bom_id == bom_id)
            .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
            .all()
        )
        bom_cache[bom_id] = parts
        return parts

    def find_bom_for_assembly(part_number):
        if part_number in bom_instance_cache:
            return bom_instance_cache[part_number]
        bom = m['BOMInstance'].query.filter_by(
            assembly_part_number=part_number, badge_id=badge_id, is_latest=True
        ).first()
        if not bom:
            bom = m['BOMInstance'].query.filter_by(
                assembly_part_number=part_number, is_latest=True
            ).first()
        bom_instance_cache[part_number] = bom
        return bom

    visited_boms = set()

    def dissolve_bom(bom_id, parent_bp_id, qty_multiplier):
        all_parts = load_bom_parts(bom_id)
        results = []
        if parent_bp_id is not None:
            children = [(bp, p) for bp, p in all_parts if bp.parent_bom_part_id == parent_bp_id]
        else:
            children = [(bp, p) for bp, p in all_parts if bp.level == 0]
        for bp, part in children:
            is_assembly = (part.part_type == 'Assembly') if part.part_type else False
            child_qty = (bp.quantity or 1) * qty_multiplier
            if not is_assembly:
                results.append({
                    'part_id': part.id, 'part_number': part.part_number,
                    'revision': part.revision or '', 'quantity': child_qty,
                })
            else:
                has_children_here = any(bp2.parent_bom_part_id == bp.id for bp2, _ in all_parts)
                if has_children_here:
                    results.extend(dissolve_bom(bom_id, bp.id, child_qty))
                else:
                    child_bom = find_bom_for_assembly(part.part_number)
                    if child_bom and child_bom.id not in visited_boms:
                        visited_boms.add(child_bom.id)
                        results.extend(dissolve_bom(child_bom.id, None, child_qty))
                    else:
                        results.append({
                            'part_id': part.id, 'part_number': part.part_number,
                            'revision': part.revision or '', 'quantity': child_qty,
                        })
        return results

    if limb and limb.assembly_part_number:
        limb_bom = find_bom_for_assembly(limb.assembly_part_number)
        if not limb_bom:
            return {'success': True, 'parts': [], 'dof_name': dof.dof_name,
                    'message': f'No BOM found for assembly {limb.assembly_part_number}'}

        visited_boms.add(limb_bom.id)
        limb_parts = load_bom_parts(limb_bom.id)

        dof_root_bp = None
        for bp, part in limb_parts:
            if part.part_number == dof.assembly_description:
                dof_root_bp = bp
                break

        if dof_root_bp:
            has_children = any(bp2.parent_bom_part_id == dof_root_bp.id for bp2, _ in limb_parts)
            if has_children:
                raw_parts = dissolve_bom(limb_bom.id, dof_root_bp.id, 1.0)
            else:
                dof_bom = find_bom_for_assembly(dof.assembly_description)
                if dof_bom and dof_bom.id not in visited_boms:
                    visited_boms.add(dof_bom.id)
                    raw_parts = dissolve_bom(dof_bom.id, None, 1.0)
                else:
                    raw_parts = []
        else:
            raw_parts = dissolve_bom(limb_bom.id, None, 1.0)
    else:
        # External DOF (no limb) — dissolve directly from the DOF's own assembly BOM
        dof_bom = find_bom_for_assembly(dof.assembly_description)
        if not dof_bom:
            return {'success': True, 'parts': [], 'dof_name': dof.dof_name,
                    'message': f'No BOM found for external DOF assembly {dof.assembly_description}'}
        visited_boms.add(dof_bom.id)
        raw_parts = dissolve_bom(dof_bom.id, None, 1.0)

    # Consolidate
    consolidated = {}
    for item in raw_parts:
        key = (item['part_number'], item['revision'])
        if key in consolidated:
            consolidated[key]['quantity'] += item['quantity']
        else:
            consolidated[key] = dict(item)

    # Fetch Part data
    part_ids = list(set(v['part_id'] for v in consolidated.values()))
    parts_by_id = {}
    if part_ids:
        for part in m['Part'].query.filter(m['Part'].id.in_(part_ids)).all():
            parts_by_id[part.id] = part

    # Part types excluded from picking (shown in assembly stages instead)
    PICKING_EXCLUDED_TYPES = {'Fasteners', 'Inhouse Electrical Part'}

    parts_list = []
    for key, item in sorted(consolidated.items(), key=lambda x: x[0]):
        part = parts_by_id.get(item['part_id'])
        if not part:
            continue
        if part.part_type in PICKING_EXCLUDED_TYPES:
            continue
        thumb = _get_part_thumb(part)
        parts_list.append({
            'part_id': part.id, 'part_number': part.part_number,
            'revision': part.revision, 'description': part.description or part.part_name or '',
            'part_type': part.part_type or '', 'quantity': item['quantity'],
            'inventory': part.inventory if part.inventory is not None else 0,
            'warehouse_box': part.warehouse_box_number, 'thumbnail': thumb,
        })

    return {
        'success': True, 'parts': parts_list,
        'dof_name': dof.dof_name, 'total_unique_parts': len(parts_list),
    }


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/stage/<stage>/unpicked-check', methods=['GET'])
@login_required
def check_unpicked_blocking(process_id, stage):
    """Check if unpicked parts from Stage 2 block a specific assembly stage.

    Cross-references Stage 2's unpicked_parts_json against the target stage's parts list.
    Returns which parts are missing and whether the stage is blocked.
    """
    m = get_models()

    process = m['ManufacturingProcess'].query.get_or_404(process_id)

    # Get unpicked parts from Stage 2
    unpicked = _get_unpicked_parts_for_process(process)
    if not unpicked:
        return jsonify({
            'success': True,
            'blocking': False,
            'missing_parts': [],
        })

    # Build lookup of unpicked parts by (part_number, revision)
    unpicked_lookup = {}
    for up in unpicked:
        key = (up.get('part_number') or '', up.get('revision') or '')
        unpicked_lookup[key] = up

    # Get the parts for the target stage using the internal helper
    stage_parts_data = _get_stage_parts_internal(process, stage, m)

    # Cross-reference: find parts needed by this stage that are in the unpicked list
    missing_parts = []
    for sp in stage_parts_data:
        if sp.get('is_assembly'):
            continue  # Skip sub-assemblies (prior-stage assemblies kept intact)
        key = (sp.get('part_number', ''), sp.get('revision', '') or '')
        if key in unpicked_lookup:
            up = unpicked_lookup[key]
            missing_parts.append({
                'part_id': sp.get('part_id'),
                'part_number': sp['part_number'],
                'revision': sp.get('revision', ''),
                'description': sp.get('description', ''),
                'required_quantity': sp.get('quantity', 1),
                'inventory_available': sp.get('inventory', 0),
                'unpicked_quantity': up.get('quantity', up.get('required_quantity', 1)),
            })

    return jsonify({
        'success': True,
        'blocking': len(missing_parts) > 0,
        'missing_parts': missing_parts,
    })


def _get_stage_parts_internal(process, stage, m=None, include_assembly=False):
    """Internal helper to get the leaf parts for a given stage.
    Returns a list of dicts with part_number, revision, quantity, etc.
    If include_assembly=True, returns (parts_list, assembly_info_dict_or_None).
    Reuses the same dissolution logic as get_stage_parts endpoint."""
    if m is None:
        m = get_models()
    db = m['db']

    _empty = ([], None) if include_assembly else []

    dof = m['DOFMapping'].query.get(process.dof_mapping_id) if process.dof_mapping_id else None
    if not dof:
        return _empty

    limb = m['RobotLimb'].query.get(dof.limb_id) if dof.limb_id else None
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id) if limb else None
    badge_id = robot_config.badge_id if robot_config else process.badge_id

    def find_bom(part_number):
        bom = m['BOMInstance'].query.filter_by(
            assembly_part_number=part_number, badge_id=badge_id, is_latest=True
        ).first()
        if not bom:
            bom = m['BOMInstance'].query.filter_by(
                assembly_part_number=part_number, is_latest=True
            ).first()
        return bom

    if limb and limb.assembly_part_number:
        limb_bom = find_bom(limb.assembly_part_number)
        if not limb_bom:
            return _empty

        limb_parts = (
            db.session.query(m['BOMPart'], m['Part'])
            .join(m['Part'])
            .filter(m['BOMPart'].bom_id == limb_bom.id)
            .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
            .all()
        )

        # Find DOF root
        dof_root_bp = None
        dof_root_part = None
        for bp, part in limb_parts:
            if part.part_number == dof.assembly_description:
                dof_root_bp = bp
                dof_root_part = part
                break

        dof_bom_id = limb_bom.id
        dof_parent_bp_id = dof_root_bp.id if dof_root_bp else None
        dof_bom_parts = limb_parts

        if dof_root_bp:
            has_children = any(bp.parent_bom_part_id == dof_root_bp.id for bp, _ in limb_parts)
            if not has_children:
                dof_own_bom = find_bom(dof.assembly_description)
                if dof_own_bom:
                    dof_bom_id = dof_own_bom.id
                    dof_parent_bp_id = None
                    dof_bom_parts = (
                        db.session.query(m['BOMPart'], m['Part'])
                        .join(m['Part'])
                        .filter(m['BOMPart'].bom_id == dof_own_bom.id)
                        .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
                        .all()
                    )
    else:
        # External DOF (no limb) — use the DOF's own assembly as root
        dof_own_bom = find_bom(dof.assembly_description)
        if not dof_own_bom:
            return _empty
        dof_root_part = m['Part'].query.filter_by(part_number=dof.assembly_description).first()
        dof_root_bp = None
        dof_bom_id = dof_own_bom.id
        dof_parent_bp_id = None
        dof_bom_parts = (
            db.session.query(m['BOMPart'], m['Part'])
            .join(m['Part'])
            .filter(m['BOMPart'].bom_id == dof_own_bom.id)
            .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
            .all()
        )

    # Collect assemblies
    def collect_all_assemblies(bom_parts_list, parent_bp_id, depth=0):
        if parent_bp_id is not None:
            children = [(bp, p) for bp, p in bom_parts_list if bp.parent_bom_part_id == parent_bp_id]
        else:
            children = [(bp, p) for bp, p in bom_parts_list if bp.level == 0]
        assemblies = []
        for bp, part in children:
            is_assembly = (part.part_type == 'Assembly') if part.part_type else False
            if is_assembly:
                assemblies.append((bp, part, depth))
                has_children = any(bp2.parent_bom_part_id == bp.id for bp2, _ in bom_parts_list)
                if has_children:
                    assemblies.extend(collect_all_assemblies(bom_parts_list, bp.id, depth + 1))
                else:
                    child_bom = find_bom(part.part_number)
                    if child_bom:
                        child_bom_parts = (
                            db.session.query(m['BOMPart'], m['Part'])
                            .join(m['Part'])
                            .filter(m['BOMPart'].bom_id == child_bom.id)
                            .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
                            .all()
                        )
                        assemblies.extend(collect_all_assemblies(child_bom_parts, None, depth + 1))
        return assemblies

    all_assemblies = collect_all_assemblies(dof_bom_parts, dof_parent_bp_id)

    # Match stage to assembly
    stage_str = str(stage)

    def match_stage(desc):
        d = (desc or '').lower()
        if 'motor and gear' in d or 'motor & gear' in d or 'motor+gear' in d:
            return '5'
        if 'actuator' in d:
            return '7'
        if 'motor' in d and 'gear' not in d and ('assembly' in d or 'assy' in d):
            return '3.1'
        if 'gear' in d and 'motor' not in d and ('assembly' in d or 'assy' in d):
            return '3.2'
        return None

    target_assembly = None
    target_bp = None

    if stage_str == '9':
        target_assembly = dof_root_part
        target_bp = dof_root_bp
    else:
        stage5_depth = None
        if stage_str in ('3.1', '3.2'):
            for _, part, depth in all_assemblies:
                desc = part.description or part.part_name or ''
                if match_stage(desc) == '5':
                    if stage5_depth is None or depth < stage5_depth:
                        stage5_depth = depth

        best_depth = None
        for bp, part, depth in all_assemblies:
            desc = part.description or part.part_name or ''
            matched = match_stage(desc)
            if matched != stage_str:
                continue
            if stage5_depth is not None and depth <= stage5_depth:
                continue
            if best_depth is None or depth < best_depth:
                target_assembly = part
                target_bp = bp
                best_depth = depth

    if not target_assembly:
        return _empty

    # Get children and dissolve
    def get_assembly_children(assembly_part, assembly_bp):
        if assembly_bp:
            parent_bom_id = assembly_bp.bom_id if hasattr(assembly_bp, 'bom_id') else None
            if parent_bom_id:
                bp_in_bom = (
                    db.session.query(m['BOMPart'], m['Part'])
                    .join(m['Part'])
                    .filter(m['BOMPart'].bom_id == parent_bom_id)
                    .filter(m['BOMPart'].parent_bom_part_id == assembly_bp.id)
                    .order_by(m['BOMPart'].sequence)
                    .all()
                )
                if bp_in_bom:
                    return bp_in_bom
        own_bom = find_bom(assembly_part.part_number)
        if own_bom:
            return (
                db.session.query(m['BOMPart'], m['Part'])
                .join(m['Part'])
                .filter(m['BOMPart'].bom_id == own_bom.id)
                .filter(m['BOMPart'].level == 0)
                .order_by(m['BOMPart'].sequence)
                .all()
            )
        return []

    children = get_assembly_children(target_assembly, target_bp)

    stage_rank = {'3.1': 0, '3.2': 0, '5': 1, '7': 2, '9': 3}
    current_rank = stage_rank.get(stage_str, 99)

    def get_assembly_stage_id(desc):
        d = (desc or '').lower()
        if 'motor and gear' in d or 'motor & gear' in d or 'motor+gear' in d:
            return '5'
        if 'actuator' in d:
            return '7'
        if 'motor' in d and 'gear' not in d and ('assembly' in d or 'assy' in d):
            return '3.1'
        if 'gear' in d and 'motor' not in d and ('assembly' in d or 'assy' in d):
            return '3.2'
        return None

    def is_prior_stage(desc):
        s = get_assembly_stage_id(desc)
        if s is None:
            return False
        return stage_rank.get(s, 99) < current_rank

    def dissolve_assembly_recursive(assembly_part, assembly_bp, qty_mult):
        asm_children = get_assembly_children(assembly_part, assembly_bp)
        results = []
        for cbp, cpart in asm_children:
            child_is_asm = (cpart.part_type == 'Assembly') if cpart.part_type else False
            child_qty = (cbp.quantity or 1) * qty_mult
            if child_is_asm and is_prior_stage(cpart.description or cpart.part_name or ''):
                results.append((cpart, child_qty, True))
            elif child_is_asm:
                results.extend(dissolve_assembly_recursive(cpart, cbp, child_qty))
            else:
                results.append((cpart, child_qty, False))
        return results

    dissolved_parts = []
    for bp, part in children:
        is_asm = (part.part_type == 'Assembly') if part.part_type else False
        qty = bp.quantity or 1
        if is_asm and is_prior_stage(part.description or part.part_name or ''):
            dissolved_parts.append((part, qty, True))
        elif is_asm:
            dissolved_parts.extend(dissolve_assembly_recursive(part, bp, qty))
        else:
            dissolved_parts.append((part, qty, False))

    # Consolidate
    consolidated = {}
    for dpart, dqty, d_is_asm in dissolved_parts:
        key = (dpart.part_number, dpart.revision or '')
        if key not in consolidated:
            thumb = _get_part_thumb(dpart)
            consolidated[key] = {
                'part_id': dpart.id,
                'part_number': dpart.part_number,
                'revision': dpart.revision,
                'description': dpart.description or dpart.part_name or '',
                'part_type': dpart.part_type or '',
                'is_assembly': d_is_asm,
                'quantity': dqty,
                'inventory': dpart.inventory if dpart.inventory is not None else 0,
                'warehouse_box': getattr(dpart, 'warehouse_box_number', '') or '',
                'thumbnail': thumb,
            }
        else:
            consolidated[key]['quantity'] += dqty

    parts_result = list(consolidated.values())

    if include_assembly:
        thumb = _get_part_thumb(target_assembly)
        assembly_info = {
            'part_id': target_assembly.id,
            'part_number': target_assembly.part_number,
            'revision': target_assembly.revision,
            'description': target_assembly.description or target_assembly.part_name or '',
            'thumbnail': thumb,
        }
        return parts_result, assembly_info

    return parts_result


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/repick', methods=['POST'])
@login_required
def repick_parts(process_id):
    """Re-pick parts that were missed during Stage 2 (Picking).

    Reduces inventory for re-picked parts, updates Stage 2's unpicked_parts_json,
    and notifies MenteeFlow that parts were re-picked.
    """
    set_inventory_context('repick', f"process_id:{process_id}")
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.get_or_404(process_id)

    if process.status != 'active':
        return jsonify({'success': False, 'error': 'Process is not active'}), 400

    data = request.json or {}
    parts_to_repick = data.get('parts', [])

    if not parts_to_repick:
        return jsonify({'success': False, 'error': 'No parts specified for re-picking'}), 400

    # Get Stage 2 record
    stage2 = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        stage_number=2,
        stage_sub=None
    ).first()

    if not stage2:
        return jsonify({'success': False, 'error': 'Stage 2 not found'}), 404

    # Parse current unpicked parts
    unpicked = []
    if stage2.unpicked_parts_json:
        try:
            unpicked = json.loads(stage2.unpicked_parts_json)
        except (json.JSONDecodeError, TypeError):
            unpicked = []

    # Build lookup by (part_number, revision)
    unpicked_lookup = {}
    for i, up in enumerate(unpicked):
        key = (up.get('part_number') or '', up.get('revision') or '')
        unpicked_lookup[key] = i

    # Process each part to re-pick
    repicked_records = []
    for part_info in parts_to_repick:
        part_id = part_info.get('part_id')
        qty = part_info.get('quantity', 1)

        if not part_id:
            continue

        part = m['Part'].query.get(part_id)
        if not part:
            continue

        # Reduce inventory
        if part.inventory is not None:
            part.inventory = max(0, part.inventory - qty)

        # Remove from unpicked list
        key = (part.part_number, part.revision or '')
        if key in unpicked_lookup:
            idx = unpicked_lookup[key]
            if idx < len(unpicked):
                up_entry = unpicked[idx]
                up_qty = up_entry.get('quantity', up_entry.get('required_quantity', 1))
                if qty >= up_qty:
                    # Fully re-picked — remove from list
                    unpicked.pop(idx)
                    # Rebuild lookup since indices shifted
                    unpicked_lookup = {}
                    for i, up in enumerate(unpicked):
                        k = (up.get('part_number') or '', up.get('revision') or '')
                        unpicked_lookup[k] = i
                else:
                    # Partially re-picked — reduce quantity
                    if 'quantity' in up_entry:
                        up_entry['quantity'] -= qty
                    elif 'required_quantity' in up_entry:
                        up_entry['required_quantity'] -= qty

        repicked_records.append({
            'part_id': part_id,
            'part_number': part.part_number,
            'revision': part.revision,
            'quantity': qty,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    # Update Stage 2's unpicked_parts_json
    stage2.unpicked_parts_json = json.dumps(unpicked) if unpicked else None

    # Append to repick history on the current active stage
    current_stages = m['ProcessStage'].query.filter_by(
        process_id=process.id,
        status='in_progress'
    ).all()

    for cs in current_stages:
        history = []
        if cs.repick_history_json:
            try:
                history = json.loads(cs.repick_history_json)
            except (json.JSONDecodeError, TypeError):
                history = []
        history.append({
            'repicked_parts': repicked_records,
            'repicked_by': current_user.username if current_user.is_authenticated else None,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })
        cs.repick_history_json = json.dumps(history)

    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Notify MenteeFlow
    callback_data = {
        'repicked_parts': repicked_records,
        'remaining_unpicked': unpicked,
    }
    notify_menteeflow(process, 2, callback_data)

    from utils.logger import log_action
    log_action('PROCESS_PARTS_REPICKED', current_user,
               f'Process {process.process_number}: {len(repicked_records)} part(s) re-picked')

    return jsonify({
        'success': True,
        'message': f'{len(repicked_records)} part(s) re-picked successfully',
        'repicked_count': len(repicked_records),
        'remaining_unpicked': len(unpicked),
    })


# ============================================================================
# PART REPLACEMENT (Feature 3)
# ============================================================================

@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/replace-part', methods=['POST'])
@login_required
def replace_part(process_id):
    """Replace a broken/damaged part with a new one (same part number).

    Returns the old part to inventory, takes the new part from inventory.
    Creates a PartReplacement audit record.
    """
    set_inventory_context('part_replace', f"process_id:{process_id}")
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.get_or_404(process_id)

    if process.status not in ('active',):
        return jsonify({'success': False, 'error': 'Process is not active'}), 400

    data = request.json or {}
    old_part_id = data.get('old_part_id')
    quantity = data.get('quantity', 1)
    reason = data.get('reason', '')
    stage_label = data.get('stage', '')

    if not old_part_id:
        return jsonify({'success': False, 'error': 'old_part_id is required'}), 400

    old_part = m['Part'].query.get(old_part_id)
    if not old_part:
        return jsonify({'success': False, 'error': 'Part not found'}), 404

    # Find the current in-progress stage for this process
    stage_record = None
    if stage_label:
        stage_str = str(stage_label)
        if '.' in stage_str:
            sn = int(stage_str.split('.')[0])
            ss = stage_str
        else:
            sn = int(stage_label)
            ss = None
        stage_record = m['ProcessStage'].query.filter_by(
            process_id=process.id, stage_number=sn, stage_sub=ss
        ).first()

    if not stage_record:
        # Fallback: find any in_progress stage
        stage_record = m['ProcessStage'].query.filter_by(
            process_id=process.id, status='in_progress'
        ).first()

    if not stage_record:
        return jsonify({'success': False, 'error': 'No active stage found for replacement'}), 400

    # Damaged part — withdraw replacement from inventory (old part is discarded, not returned)
    new_part = old_part  # Same part number
    old_inv = old_part.inventory or 0
    old_part.inventory = max(0, old_inv - quantity)
    print(f'[INVENTORY] DAMAGED PART: {old_part.part_number} (id={old_part.id}): {old_inv} -> {old_part.inventory} (withdrew {quantity})')

    # Create replacement record
    replacement = m['PartReplacement'](
        process_id=process.id,
        stage_id=stage_record.id,
        old_part_id=old_part.id,
        old_part_number=old_part.part_number,
        old_revision=old_part.revision,
        new_part_id=new_part.id,
        new_part_number=new_part.part_number,
        new_revision=new_part.revision,
        quantity=quantity,
        reason=reason,
        created_by=current_user.id if current_user.is_authenticated else None,
    )
    db.session.add(replacement)

    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Notify MenteeFlow
    callback_data = {
        'old_part': {'part_number': old_part.part_number, 'revision': old_part.revision},
        'new_part': {'part_number': new_part.part_number, 'revision': new_part.revision},
        'quantity': quantity,
        'reason': reason,
    }
    stage_num = float(stage_record.stage_sub) if stage_record.stage_sub else stage_record.stage_number
    notify_menteeflow(process, stage_num, callback_data)

    from utils.logger import log_action
    log_action('PART_REPLACED', current_user,
               f'Process {process.process_number}: {old_part.part_number} replaced. Reason: {reason}')

    return jsonify({
        'success': True,
        'replacement_id': replacement.id,
        'old_part': {
            'part_number': old_part.part_number,
            'new_inventory': old_part.inventory,
        },
        'new_part': {
            'part_number': new_part.part_number,
            'new_inventory': new_part.inventory,
        },
        'message': 'Part replaced successfully',
    })


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/replacements', methods=['GET'])
@login_required
def get_replacements(process_id):
    """Get part replacement history for a process."""
    m = get_models()

    process = m['ManufacturingProcess'].query.get_or_404(process_id)
    replacements = m['PartReplacement'].query.filter_by(
        process_id=process.id
    ).order_by(m['PartReplacement'].created_at.desc()).all()

    return jsonify({
        'success': True,
        'replacements': [{
            'id': r.id,
            'old_part_number': r.old_part_number,
            'old_revision': r.old_revision,
            'new_part_number': r.new_part_number,
            'new_revision': r.new_revision,
            'quantity': r.quantity,
            'reason': r.reason,
            'created_at': r.created_at.isoformat() + 'Z' if r.created_at else None,
            'stage_name': r.stage.stage_name if r.stage else None,
        } for r in replacements],
    })


# ============================================================================
# ADMIN ENDPOINTS
# ============================================================================

@robot_assembly_bp.route('/api/robot-assembly/admin/config', methods=['GET', 'POST'])
@login_required
def admin_robot_configs():
    """List or create robot configurations"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    if request.method == 'GET':
        configs = m['RobotConfig'].query.filter_by(is_active=True).all()
        return jsonify({
            'success': True,
            'configs': [{
                'id': c.id,
                'badge_id': c.badge_id,
                'badge_name': c.badge.name if c.badge else None,
                'badge_color': c.badge.color if c.badge else None,
                'robot_image_path': c.robot_image_path,
                'has_image_data': bool(c.robot_image_data),
                'created_at': c.created_at.isoformat() + 'Z' if c.created_at else None,
                'limb_count': m['RobotLimb'].query.filter_by(robot_config_id=c.id, is_active=True).count(),
            } for c in configs]
        })

    # POST - create new config
    data = request.json
    badge_id = data.get('badge_id')
    if not badge_id:
        return jsonify({'success': False, 'error': 'badge_id is required'}), 400

    existing = m['RobotConfig'].query.filter_by(badge_id=badge_id).first()
    if existing:
        return jsonify({'success': False, 'error': 'Robot config already exists for this badge'}), 409

    config = m['RobotConfig'](
        badge_id=badge_id,
        robot_image_path=data.get('robot_image_path'),
        created_by=current_user.id,
    )
    db.session.add(config)
    db.session.commit()

    from utils.logger import log_action
    log_action('ROBOT_CONFIG_CREATED', current_user, f'Robot config for badge {badge_id}')

    return jsonify({
        'success': True,
        'config_id': config.id,
        'message': 'Robot config created'
    }), 201


@robot_assembly_bp.route('/api/robot-assembly/admin/config/<int:config_id>', methods=['PUT', 'DELETE'])
@login_required
def admin_robot_config_detail(config_id):
    """Update or delete a robot configuration"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    config = m['RobotConfig'].query.get_or_404(config_id)

    if request.method == 'DELETE':
        config.is_active = False
        db.session.commit()
        return jsonify({'success': True, 'message': 'Robot config deactivated'})

    # PUT - update
    data = request.json
    if 'robot_image_path' in data:
        config.robot_image_path = data['robot_image_path']
    if 'robot_image_data' in data:
        config.robot_image_data = data['robot_image_data']
    config.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({'success': True, 'message': 'Robot config updated'})


@robot_assembly_bp.route('/api/robot-assembly/admin/config/<int:config_id>/upload-image', methods=['POST'])
@login_required
def admin_upload_robot_image(config_id):
    """Upload robot image for a configuration"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    config = m['RobotConfig'].query.get_or_404(config_id)

    if 'image' not in request.files:
        return jsonify({'success': False, 'error': 'No image file provided'}), 400

    import base64
    file = request.files['image']
    image_data = base64.b64encode(file.read()).decode('utf-8')
    config.robot_image_data = image_data
    config.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({'success': True, 'message': 'Robot image uploaded'})


@robot_assembly_bp.route('/api/robot-assembly/config/<int:config_id>/image', methods=['GET'])
@login_required
def robot_config_image(config_id):
    """Serve the robot image as a binary response (avoids base64 in JSON)"""
    m = get_models()
    config = m['RobotConfig'].query.get_or_404(config_id)

    # Prefer file path
    if config.robot_image_path:
        import os
        build_path = os.path.join(os.path.dirname(__file__), 'frontend', 'dist')
        full_path = os.path.join(build_path, config.robot_image_path)
        if os.path.exists(full_path):
            from flask import send_file
            return send_file(full_path, mimetype='image/png')

    # Fallback to base64 data
    if config.robot_image_data:
        import base64
        from flask import Response
        image_bytes = base64.b64decode(config.robot_image_data)
        return Response(image_bytes, mimetype='image/png')

    return jsonify({'success': False, 'error': 'No image available'}), 404


@robot_assembly_bp.route('/api/robot-assembly/admin/limbs/<int:config_id>', methods=['GET', 'POST'])
@login_required
def admin_limbs(config_id):
    """List or create limbs for a robot config"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    if request.method == 'GET':
        limbs = m['RobotLimb'].query.filter_by(
            robot_config_id=config_id, is_active=True
        ).order_by(m['RobotLimb'].display_order).all()

        return jsonify({
            'success': True,
            'limbs': [{
                'id': l.id,
                'name': l.name,
                'slug': l.slug,
                'region_type': l.region_type,
                'region_coords': json.loads(l.region_coords) if l.region_coords else None,
                'display_order': l.display_order,
                'color_highlight': l.color_highlight,
                'assembly_part_number': l.assembly_part_number,
                'dof_count': m['DOFMapping'].query.filter_by(limb_id=l.id, is_active=True).count(),
            } for l in limbs]
        })

    # POST - create limb
    data = request.json
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'name is required'}), 400

    import re
    slug = data.get('slug', re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'))

    limb = m['RobotLimb'](
        robot_config_id=config_id,
        name=name,
        slug=slug,
        region_type=data.get('region_type', 'polygon'),
        region_coords=json.dumps(data.get('region_coords')) if data.get('region_coords') else None,
        display_order=data.get('display_order', 0),
        color_highlight=data.get('color_highlight', 'rgba(75,44,111,0.3)'),
        assembly_part_number=data.get('assembly_part_number'),
    )
    db.session.add(limb)
    db.session.commit()

    return jsonify({'success': True, 'limb_id': limb.id, 'message': 'Limb created'}), 201


@robot_assembly_bp.route('/api/robot-assembly/admin/limb/<int:limb_id>', methods=['PUT', 'DELETE'])
@login_required
def admin_limb_detail(limb_id):
    """Update or delete a limb"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    limb = m['RobotLimb'].query.get_or_404(limb_id)

    if request.method == 'DELETE':
        limb.is_active = False
        db.session.commit()
        return jsonify({'success': True, 'message': 'Limb deactivated'})

    # PUT
    data = request.json
    if 'name' in data:
        limb.name = data['name']
    if 'slug' in data:
        limb.slug = data['slug']
    if 'region_type' in data:
        limb.region_type = data['region_type']
    if 'region_coords' in data:
        limb.region_coords = json.dumps(data['region_coords']) if data['region_coords'] else None
    if 'display_order' in data:
        limb.display_order = data['display_order']
    if 'color_highlight' in data:
        limb.color_highlight = data['color_highlight']
    if 'assembly_part_number' in data:
        limb.assembly_part_number = data['assembly_part_number']

    db.session.commit()
    return jsonify({'success': True, 'message': 'Limb updated'})


@robot_assembly_bp.route('/api/robot-assembly/admin/bom-search', methods=['GET'])
@login_required
def admin_bom_search():
    """Search BOMs by assembly part number or name for linking to limbs"""
    m = get_models()

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    badge_id = request.args.get('badge_id', type=int)
    q = request.args.get('q', '').strip()

    if not badge_id:
        return jsonify({'success': False, 'error': 'badge_id is required'}), 400

    db = m['db']
    query = m['BOMInstance'].query.filter_by(badge_id=badge_id, is_latest=True)

    if q:
        query = query.filter(
            db.or_(
                m['BOMInstance'].assembly_part_number.ilike(f'%{q}%'),
                m['BOMInstance'].name.ilike(f'%{q}%'),
            )
        )

    boms = query.order_by(m['BOMInstance'].name).limit(30).all()

    return jsonify({
        'success': True,
        'boms': [{
            'id': b.id,
            'assembly_part_number': b.assembly_part_number,
            'assembly_revision': b.assembly_revision,
            'name': b.name,
            'version': b.version,
        } for b in boms]
    })


@robot_assembly_bp.route('/api/robot-assembly/admin/limb/<int:limb_id>/child-assemblies', methods=['GET'])
@login_required
def admin_limb_child_assemblies(limb_id):
    """Get full assembly tree of a limb's linked BOM, for DOF selection.

    Returns the complete BOM tree (all levels), not just direct children.
    Each node includes is_assembly and is_dof flags so the admin can pick
    which assembly nodes represent DOFs.
    """
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    limb = m['RobotLimb'].query.get_or_404(limb_id)
    if not limb.assembly_part_number:
        return jsonify({'success': True, 'tree': [], 'message': 'No assembly linked to this limb'})

    # Find the badge for this limb's robot config
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id)
    if not robot_config:
        return jsonify({'success': False, 'error': 'Robot config not found'}), 404

    # Find the latest BOM for this assembly + badge
    bom_instance = m['BOMInstance'].query.filter_by(
        assembly_part_number=limb.assembly_part_number,
        badge_id=robot_config.badge_id,
        is_latest=True,
    ).first()

    if not bom_instance:
        # Try without badge filter
        bom_instance = m['BOMInstance'].query.filter_by(
            assembly_part_number=limb.assembly_part_number,
            is_latest=True,
        ).first()

    if not bom_instance:
        return jsonify({
            'success': True,
            'tree': [],
            'message': f'No BOM found for assembly {limb.assembly_part_number}'
        })

    # Load ALL bom parts with their Part data in one query
    bom_parts = (
        db.session.query(m['BOMPart'], m['Part'])
        .join(m['Part'])
        .filter(m['BOMPart'].bom_id == bom_instance.id)
        .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
        .all()
    )

    # Existing DOF mappings for this limb (to flag nodes already mapped)
    existing_dof_part_numbers = set()
    existing_dofs = m['DOFMapping'].query.filter_by(limb_id=limb_id, is_active=True).all()
    for d in existing_dofs:
        if d.assembly_description:
            existing_dof_part_numbers.add(d.assembly_description)

    # DOF mappings in OTHER limbs of the same robot config (for shared indicator)
    other_limb_ids = [
        lmb.id for lmb in m['RobotLimb'].query.filter_by(
            robot_config_id=robot_config.id, is_active=True
        ).all() if lmb.id != limb_id
    ]
    # Map part_number -> list of limb names that already have it as a DOF
    shared_dof_map = {}
    for other_limb_id in other_limb_ids:
        other_limb = m['RobotLimb'].query.get(other_limb_id)
        other_dofs = m['DOFMapping'].query.filter_by(limb_id=other_limb_id, is_active=True).all()
        for d in other_dofs:
            if d.assembly_description:
                shared_dof_map.setdefault(d.assembly_description, []).append(other_limb.name)

    # Build tree recursively
    def build_node(bom_part, part):
        is_assembly = (part.part_type == 'Assembly') if part.part_type else False
        is_dof = part.part_number in existing_dof_part_numbers

        thumb = _get_part_thumb(part)

        node = {
            'bom_part_id': bom_part.id,
            'part_id': part.id,
            'part_number': part.part_number,
            'revision': part.revision,
            'part_name': part.part_name,
            'description': part.description or '',
            'part_type': part.part_type or '',
            'is_assembly': is_assembly,
            'quantity': bom_part.quantity,
            'level': bom_part.level,
            'is_dof': is_dof,
            'thumbnail': thumb,
            'shared_with_limbs': shared_dof_map.get(part.part_number, []),
            'children': [],
        }

        # Find children of this bom_part
        children = [(bp, p) for bp, p in bom_parts if bp.parent_bom_part_id == bom_part.id]
        for child_bp, child_part in children:
            node['children'].append(build_node(child_bp, child_part))

        return node

    # Build from root parts (level 0)
    root_parts = [(bp, p) for bp, p in bom_parts if bp.level == 0]
    tree = [build_node(bp, p) for bp, p in root_parts]

    return jsonify({
        'success': True,
        'bom_id': bom_instance.id,
        'bom_name': bom_instance.name,
        'assembly_part_number': limb.assembly_part_number,
        'tree': tree,
    })


# ============================================================================
# DOF TEMPLATE PROCESSES (read-only stage preview, "no serial number")
# ============================================================================

@robot_assembly_bp.route('/api/robot-assembly/admin/dof-templates', methods=['GET'])
@login_required
def admin_dof_templates():
    """List read-only DOF template processes for a badge — one per configured DOF mapping.

    Each template is a "no serial number" reference process (process_number "X-XXX") used to
    preview a DOF's stage flow without opening a real run. Templates are created lazily here.
    Returns an embed link per DOF so MenteeFlow / admins can open the stage preview.
    """
    m = get_models()

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    badge_id = request.args.get('badge_id', type=int)
    if not badge_id:
        return jsonify({'success': False, 'error': 'badge_id is required'}), 400

    badge = m['ProjectBadge'].query.get(badge_id)
    if not badge:
        return jsonify({'success': False, 'error': 'Badge not found'}), 404

    # All active DOF mappings for this badge's robot-config limbs, in display order
    dofs = m['DOFMapping'].query.filter(
        m['DOFMapping'].is_active.is_(True)
    ).join(
        m['RobotLimb'], m['DOFMapping'].limb_id == m['RobotLimb'].id
    ).join(
        m['RobotConfig'], m['RobotLimb'].robot_config_id == m['RobotConfig'].id
    ).filter(
        m['RobotConfig'].badge_id == badge_id
    ).order_by(
        m['RobotLimb'].display_order, m['DOFMapping'].display_order
    ).all()

    templates = []
    for dof in dofs:
        process, warning = _get_or_create_dof_template(dof, badge, m)
        row = {
            'dof_number': dof.dof_number,
            'dof_name': dof.dof_name,
            'limb_name': dof.limb.name if dof.limb else None,
        }
        if process:
            embed = _get_or_create_process_embed_token(process)
            row.update({
                'process_number': process.process_number,
                'embed_base_url': embed['embed_base_url'],
                'token': embed['token'],
                'expires_at': embed['expires_at'],
            })
        else:
            row['warning'] = warning
        templates.append(row)

    return jsonify({
        'success': True,
        'badge_id': badge_id,
        'badge_name': badge.name,
        'templates': templates,
    })


@robot_assembly_bp.route('/api/menteeflow/dof-template/<process_number>', methods=['GET'])
@require_menteeflow_auth
def menteeflow_get_dof_template(process_number):
    """MenteeFlow: fetch (auto-creating) the read-only stage-preview embed link for a DOF
    template process, e.g. "2-201". Mirrors the `embed` block returned by process/create."""
    m = get_models()

    # Parse "{badge_digit}-{dof_number}"
    parts = process_number.split('-')
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return jsonify({'success': False, 'error': 'Invalid template number. Expected "X-XXX"'}), 400
    badge_digit, dof_number = parts[0], parts[1]

    process = m['ManufacturingProcess'].query.filter_by(
        process_number=process_number, is_template=True
    ).first()

    if not process:
        # Resolve badge from digit, find the DOF mapping under it, then create the template
        config = m['MenteeFlowConfig'].query.first()
        badge = None
        if config and config.badge_digit_mapping:
            try:
                mapping = json.loads(config.badge_digit_mapping)
                for badge_name, digit in mapping.items():
                    if str(digit).strip() == badge_digit:
                        badge = m['ProjectBadge'].query.filter_by(name=badge_name, is_active=True).first()
                        break
            except (json.JSONDecodeError, AttributeError):
                pass
        if not badge:
            return jsonify({'success': False, 'error': f'No badge mapped to digit "{badge_digit}"'}), 404

        dof_mapping = m['DOFMapping'].query.filter(
            m['DOFMapping'].dof_number == dof_number, m['DOFMapping'].is_active.is_(True)
        ).join(m['RobotLimb']).join(m['RobotConfig']).filter(
            m['RobotConfig'].badge_id == badge.id
        ).first()
        if not dof_mapping:
            dof_mapping = m['DOFMapping'].query.filter(
                m['DOFMapping'].dof_number == dof_number,
                m['DOFMapping'].limb_id.is_(None),
                m['DOFMapping'].is_active.is_(True)
            ).first()
        if not dof_mapping:
            return jsonify({'success': False, 'error': f'No DOF mapping for "{dof_number}" in badge "{badge.name}"'}), 404

        process, warning = _get_or_create_dof_template(dof_mapping, badge, m)
        if not process:
            return jsonify({'success': False, 'error': warning}), 400

    dof = m['DOFMapping'].query.get(process.dof_mapping_id) if process.dof_mapping_id else None
    embed_info = _get_or_create_process_embed_token(process)
    return jsonify({
        'success': True,
        'process_number': process.process_number,
        'dof_name': dof.dof_name if dof else None,
        'is_template': True,
        'embed': embed_info,
    })


@robot_assembly_bp.route('/api/robot-assembly/admin/dof-mappings/<int:limb_id>', methods=['GET', 'POST'])
@login_required
def admin_dof_mappings(limb_id):
    """List or create DOF mappings for a limb"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    if request.method == 'GET':
        dofs = m['DOFMapping'].query.filter_by(
            limb_id=limb_id, is_active=True
        ).order_by(m['DOFMapping'].display_order).all()

        return jsonify({
            'success': True,
            'dof_mappings': [{
                'id': d.id,
                'dof_number': d.dof_number,
                'dof_name': d.dof_name,
                'assembly_description': d.assembly_description,
                'bom_instance_id': d.bom_instance_id,
                'serial_number_prefix': d.serial_number_prefix,
                'display_order': d.display_order,
            } for d in dofs]
        })

    # POST - create DOF mapping
    data = request.json
    dof_number = data.get('dof_number', '').strip()
    dof_name = data.get('dof_name', '').strip()
    assembly_description = data.get('assembly_description', '').strip()

    if not dof_number or not dof_name or not assembly_description:
        return jsonify({'success': False, 'error': 'dof_number, dof_name, and assembly_description are required'}), 400

    # Check for existing DOF with same number (active or inactive due to DB unique constraint)
    existing = m['DOFMapping'].query.filter_by(
        limb_id=limb_id, dof_number=dof_number
    ).first()
    if existing:
        if existing.is_active:
            return jsonify({'success': False, 'error': f'DOF #{dof_number} already exists on this limb'}), 409
        # Reactivate the soft-deleted DOF with new data
        existing.is_active = True
        existing.dof_name = dof_name
        existing.assembly_description = assembly_description
        existing.bom_instance_id = data.get('bom_instance_id')
        existing.serial_number_prefix = data.get('serial_number_prefix')
        existing.display_order = data.get('display_order', 0)
        db.session.commit()
        return jsonify({'success': True, 'dof_mapping_id': existing.id, 'message': 'DOF mapping created'}), 201

    dof = m['DOFMapping'](
        limb_id=limb_id,
        dof_number=dof_number,
        dof_name=dof_name,
        assembly_description=assembly_description,
        bom_instance_id=data.get('bom_instance_id'),
        serial_number_prefix=data.get('serial_number_prefix'),
        display_order=data.get('display_order', 0),
    )
    db.session.add(dof)
    db.session.commit()

    return jsonify({'success': True, 'dof_mapping_id': dof.id, 'message': 'DOF mapping created'}), 201


@robot_assembly_bp.route('/api/robot-assembly/admin/dof-mapping/<int:mapping_id>', methods=['PUT', 'DELETE'])
@login_required
def admin_dof_mapping_detail(mapping_id):
    """Update or delete a DOF mapping"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    dof = m['DOFMapping'].query.get_or_404(mapping_id)

    if request.method == 'DELETE':
        dof.is_active = False
        db.session.commit()
        return jsonify({'success': True, 'message': 'DOF mapping deactivated'})

    # PUT
    data = request.json
    if 'dof_number' in data:
        dof.dof_number = data['dof_number']
    if 'dof_name' in data:
        dof.dof_name = data['dof_name']
    if 'assembly_description' in data:
        dof.assembly_description = data['assembly_description']
    if 'bom_instance_id' in data:
        dof.bom_instance_id = data['bom_instance_id']
    if 'serial_number_prefix' in data:
        dof.serial_number_prefix = data['serial_number_prefix']
    if 'display_order' in data:
        dof.display_order = data['display_order']

    db.session.commit()
    return jsonify({'success': True, 'message': 'DOF mapping updated'})


@robot_assembly_bp.route('/api/robot-assembly/admin/external-dofs', methods=['GET'])
@login_required
def admin_get_external_dofs():
    """List external DOFs (limb_id IS NULL)"""
    m = get_models()

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    dofs = m['DOFMapping'].query.filter(
        m['DOFMapping'].limb_id.is_(None),
        m['DOFMapping'].is_active.is_(True)
    ).order_by(m['DOFMapping'].display_order).all()

    return jsonify({
        'success': True,
        'external_dofs': [{
            'id': d.id,
            'dof_number': d.dof_number,
            'dof_name': d.dof_name,
            'assembly_description': d.assembly_description,
            'bom_instance_id': d.bom_instance_id,
        } for d in dofs]
    })


@robot_assembly_bp.route('/api/robot-assembly/admin/diagnostics', methods=['GET'])
@login_required
def admin_diagnostics():
    """Sanity-check endpoint: which DB is this Flask process reading?
    Hit from a browser on each server to verify dev/prod aren't swapped.
    Shows the SQLALCHEMY_DATABASE_URI, absolute resolved file path, file mtime,
    and the MenteeFlowConfig.base_url loaded from THAT DB (so you can confirm
    the webhook URL matches the environment you expect)."""
    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin required'}), 403
    import os as _os
    from flask import current_app
    m = get_models()

    db_uri = current_app.config.get('SQLALCHEMY_DATABASE_URI', '(not set)')

    # Resolve sqlite:///... → absolute path
    resolved_path = None
    file_size = None
    file_mtime = None
    if db_uri.startswith('sqlite:///'):
        rel = db_uri[len('sqlite:///'):]
        candidate = rel if _os.path.isabs(rel) else _os.path.join(current_app.instance_path, rel)
        resolved_path = _os.path.abspath(candidate)
        if _os.path.exists(resolved_path):
            st = _os.stat(resolved_path)
            file_size = st.st_size
            file_mtime = datetime.utcfromtimestamp(st.st_mtime).isoformat() + 'Z'

    config = m['MenteeFlowConfig'].query.first()
    cfg_info = None
    if config:
        cfg_info = {
            'base_url': config.base_url,
            'is_active': config.is_active,
            'has_api_key': bool(config.api_key),
            'api_key_prefix': (config.api_key[:8] + '...') if config.api_key else None,
        }

    return jsonify({
        'database_uri': db_uri,
        'database_resolved_path': resolved_path,
        'database_size_bytes': file_size,
        'database_last_modified': file_mtime,
        'instance_path': current_app.instance_path,
        'menteeflow_config': cfg_info,
        'server_time_utc': datetime.utcnow().isoformat() + 'Z',
    })


@robot_assembly_bp.route('/api/robot-assembly/admin/menteeflow-config', methods=['GET', 'PUT'])
@login_required
def admin_menteeflow_config():
    """Get or update MenteeFlow configuration"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    config = m['MenteeFlowConfig'].query.first()

    if request.method == 'GET':
        if not config:
            return jsonify({
                'success': True,
                'config': None,
                'message': 'No MenteeFlow config exists yet'
            })
        return jsonify({
            'success': True,
            'config': {
                'id': config.id,
                'base_url': config.base_url,
                'api_key': config.api_key,
                'webhook_secret': config.webhook_secret,
                'is_active': config.is_active,
                'badge_digit_mapping': json.loads(config.badge_digit_mapping) if config.badge_digit_mapping else {},
                'displayed_badge_ids': json.loads(config.displayed_badge_ids) if config.displayed_badge_ids else [],
                'embed_url_template': config.embed_url_template or '',
                'updated_at': config.updated_at.isoformat() + 'Z' if config.updated_at else None,
            }
        })

    # PUT - update or create
    data = request.json
    if not config:
        config = m['MenteeFlowConfig']()
        db.session.add(config)

    if 'base_url' in data:
        config.base_url = data['base_url']
    if 'api_key' in data:
        config.api_key = data['api_key']
    if 'webhook_secret' in data:
        config.webhook_secret = data['webhook_secret']
    if 'is_active' in data:
        config.is_active = data['is_active']
    if 'badge_digit_mapping' in data:
        config.badge_digit_mapping = json.dumps(data['badge_digit_mapping'])
    if 'displayed_badge_ids' in data:
        config.displayed_badge_ids = json.dumps(data['displayed_badge_ids'])
    if 'embed_url_template' in data:
        config.embed_url_template = data['embed_url_template']

    config.updated_by = current_user.id
    config.updated_at = datetime.utcnow()
    db.session.commit()

    from utils.logger import log_action
    log_action('MENTEEFLOW_CONFIG_UPDATED', current_user, 'MenteeFlow configuration updated')

    return jsonify({'success': True, 'message': 'MenteeFlow config updated'})


# ============================================================================
# MENTEEFLOW API KEY HISTORY
# ============================================================================

@robot_assembly_bp.route('/api/robot-assembly/admin/menteeflow-api-keys', methods=['GET'])
@login_required
def admin_list_api_keys():
    """List all saved API key pairs"""
    m = get_models()

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    keys = m['MenteeFlowApiKeyHistory'].query.order_by(
        m['MenteeFlowApiKeyHistory'].created_at.desc()
    ).all()

    return jsonify({
        'success': True,
        'keys': [{
            'id': k.id,
            'label': k.label,
            'api_key_preview': k.api_key[:8] + '...' if k.api_key else '',
            'webhook_secret_preview': k.webhook_secret[:8] + '...' if k.webhook_secret else '',
            'is_active': k.is_active,
            'created_at': k.created_at.isoformat() + 'Z' if k.created_at else None,
            'revoked_at': k.revoked_at.isoformat() + 'Z' if k.revoked_at else None,
            'created_by': k.creator.username if k.creator else None,
        } for k in keys]
    })


@robot_assembly_bp.route('/api/robot-assembly/admin/menteeflow-api-keys', methods=['POST'])
@login_required
def admin_save_api_key():
    """Save the current API key + webhook secret pair to history"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    data = request.json or {}
    label = data.get('label', '').strip()
    api_key = data.get('api_key', '').strip()
    webhook_secret = data.get('webhook_secret', '').strip()

    if not label:
        return jsonify({'success': False, 'error': 'Label is required'}), 400
    if not api_key and not webhook_secret:
        return jsonify({'success': False, 'error': 'At least one of api_key or webhook_secret is required'}), 400

    entry = m['MenteeFlowApiKeyHistory'](
        label=label,
        api_key=api_key,
        webhook_secret=webhook_secret,
        is_active=True,
        created_by=current_user.id,
    )
    db.session.add(entry)
    db.session.commit()

    from utils.logger import log_action
    log_action('API_KEY_SAVED', current_user, f'Saved API key pair "{label}"')

    return jsonify({'success': True, 'id': entry.id, 'message': f'API key "{label}" saved'}), 201


@robot_assembly_bp.route('/api/robot-assembly/admin/menteeflow-api-keys/<int:key_id>/revoke', methods=['POST'])
@login_required
def admin_revoke_api_key(key_id):
    """Revoke a saved API key pair"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    entry = m['MenteeFlowApiKeyHistory'].query.get(key_id)
    if not entry:
        return jsonify({'success': False, 'error': 'Key not found'}), 404

    entry.is_active = False
    entry.revoked_at = datetime.utcnow()
    db.session.commit()

    from utils.logger import log_action
    log_action('API_KEY_REVOKED', current_user, f'Revoked API key pair "{entry.label}"')

    return jsonify({'success': True, 'message': f'API key "{entry.label}" revoked'})


@robot_assembly_bp.route('/api/robot-assembly/admin/menteeflow-api-keys/<int:key_id>/activate', methods=['POST'])
@login_required
def admin_activate_api_key(key_id):
    """Re-activate a saved API key pair and apply it to the MenteeFlow config"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    entry = m['MenteeFlowApiKeyHistory'].query.get(key_id)
    if not entry:
        return jsonify({'success': False, 'error': 'Key not found'}), 404

    # Re-activate the key
    entry.is_active = True
    entry.revoked_at = None

    # Apply to the live MenteeFlow config
    config = m['MenteeFlowConfig'].query.first()
    if config:
        config.api_key = entry.api_key
        config.webhook_secret = entry.webhook_secret
        config.updated_by = current_user.id
        config.updated_at = datetime.utcnow()

    db.session.commit()

    from utils.logger import log_action
    log_action('API_KEY_ACTIVATED', current_user, f'Activated API key pair "{entry.label}" and applied to config')

    return jsonify({'success': True, 'message': f'API key "{entry.label}" activated and applied to config'})


@robot_assembly_bp.route('/api/robot-assembly/admin/embed-tokens', methods=['GET'])
@login_required
def admin_list_embed_tokens():
    """List active (non-expired, non-revoked) embed tokens for admin management."""
    m = get_models()

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    tokens = m['EmbedToken'].query.filter(
        m['EmbedToken'].is_revoked == False,
        m['EmbedToken'].expires_at > datetime.utcnow()
    ).order_by(m['EmbedToken'].created_at.desc()).all()

    result = []
    for t in tokens:
        process = m['ManufacturingProcess'].query.get(t.process_id)
        result.append({
            'id': t.id,
            'token': t.token[:12] + '...',  # Truncated for display
            'process_number': process.process_number if process else 'Unknown',
            'process_id': t.process_id,
            'stage_scope': t.stage_scope,
            'created_at': t.created_at.isoformat() + 'Z' if t.created_at else None,
            'expires_at': t.expires_at.isoformat() + 'Z' if t.expires_at else None,
            'used_at': t.used_at.isoformat() + 'Z' if t.used_at else None,
        })

    return jsonify({'success': True, 'tokens': result})


@robot_assembly_bp.route('/api/robot-assembly/admin/embed-token/<int:token_id>', methods=['DELETE'])
@login_required
def admin_revoke_embed_token(token_id):
    """Revoke a specific embed token."""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    token = m['EmbedToken'].query.get(token_id)
    if not token:
        return jsonify({'success': False, 'error': 'Token not found'}), 404

    token.is_revoked = True
    db.session.commit()

    from utils.logger import log_action
    log_action('EMBED_TOKEN_REVOKED', current_user, f'Embed token {token_id} revoked')

    return jsonify({'success': True, 'message': 'Token revoked'})


@robot_assembly_bp.route('/api/robot-assembly/admin/embed-tokens/revoke-all', methods=['POST'])
@login_required
def admin_revoke_all_embed_tokens():
    """Revoke all active embed tokens."""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    count = m['EmbedToken'].query.filter(
        m['EmbedToken'].is_revoked == False,
        m['EmbedToken'].expires_at > datetime.utcnow()
    ).update({'is_revoked': True})
    db.session.commit()

    from utils.logger import log_action
    log_action('EMBED_TOKENS_REVOKED_ALL', current_user, f'{count} embed tokens revoked')

    return jsonify({'success': True, 'message': f'{count} token(s) revoked'})


# ============================================================================
# LIMB ASSEMBLY SNAPSHOT ENDPOINTS
# ============================================================================

def _find_limb_bom_instance(limb, m):
    """Latest BOMInstance for the limb's assembly — the config's badge first,
    any badge as fallback. None if the limb has no assembly or no BOM."""
    if not limb.assembly_part_number:
        return None

    robot_config = m['RobotConfig'].query.get(limb.robot_config_id)
    badge_id = robot_config.badge_id if robot_config else None

    bom_instance = None
    if badge_id:
        bom_instance = m['BOMInstance'].query.filter_by(
            assembly_part_number=limb.assembly_part_number,
            badge_id=badge_id, is_latest=True
        ).first()
    if not bom_instance:
        bom_instance = m['BOMInstance'].query.filter_by(
            assembly_part_number=limb.assembly_part_number, is_latest=True
        ).first()
    return bom_instance


def _build_limb_tree(limb, m):
    """Build full BOM tree for a limb's assembly_part_number.
    Returns (tree_root_list, bom_instance) or ([], None) if not found.
    Each node has: bom_part_id, part_number, part_id, part_name, description,
    part_type, is_assembly, quantity, level, thumbnail, inventory, warehouse_box,
    datasheet_drive_url, children.
    """
    db = m['db']
    bom_instance = _find_limb_bom_instance(limb, m)
    if not bom_instance:
        return [], None

    bom_parts = (
        db.session.query(m['BOMPart'], m['Part'])
        .join(m['Part'])
        .filter(m['BOMPart'].bom_id == bom_instance.id)
        .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
        .all()
    )

    def build_node(bp, p):
        thumb = _get_part_thumb(p)
        node = {
            'bom_part_id': bp.id,
            'part_id': p.id,
            'part_number': p.part_number,
            'revision': p.revision or '',
            'part_name': p.part_name or '',
            'description': p.description or '',
            'part_type': p.part_type or '',
            'is_assembly': (p.part_type == 'Assembly') if p.part_type else False,
            'quantity': bp.quantity,
            'level': bp.level,
            'inventory': p.inventory,
            'warehouse_box': p.warehouse_box_number or '',
            'datasheet_drive_url': p.datasheet_drive_url or None,
            'thumbnail': thumb,
            'children': [],
        }
        children = [(b2, p2) for b2, p2 in bom_parts if b2.parent_bom_part_id == bp.id]
        for cb, cp in children:
            node['children'].append(build_node(cb, cp))
        return node

    root_parts = [(bp, p) for bp, p in bom_parts if bp.level == 0]
    tree = [build_node(bp, p) for bp, p in root_parts]
    return tree, bom_instance


def _apply_dissolves(base_tree, dissolved_ids_set):
    """Apply dissolve list to a tree. Returns new tree with:
    - Dissolved nodes replaced by their children (qty multiplied)
    - Same-part_number nodes at the same level consolidated (qty summed)
    """
    def dissolve_node_simple(node):
        """Return flat list of result nodes after applying dissolves at all levels."""
        if node['bom_part_id'] in dissolved_ids_set and node['children']:
            result = []
            for child in node['children']:
                child_copy = dict(child)
                child_copy['quantity'] = child['quantity'] * node['quantity']
                child_copy['children'] = list(child.get('children', []))
                for item in dissolve_node_simple(child_copy):
                    result.append(item)
            return result
        else:
            node_copy = dict(node)
            node_copy['children'] = _consolidate(_apply_dissolves_to_children(node.get('children', []), dissolved_ids_set))
            return [node_copy]

    result_nodes = []
    for top_node in base_tree:
        result_nodes.extend(dissolve_node_simple(top_node))
    return _consolidate(result_nodes)


def _apply_dissolves_to_children(children, dissolved_ids_set):
    """Recursively apply dissolves within children list."""
    result = []
    for child in children:
        if child['bom_part_id'] in dissolved_ids_set and child.get('children'):
            for grandchild in child['children']:
                gc_copy = dict(grandchild)
                gc_copy['quantity'] = grandchild['quantity'] * child['quantity']
                gc_copy['children'] = list(grandchild.get('children', []))
                result.extend(_apply_dissolves_to_children([gc_copy], dissolved_ids_set))
        else:
            child_copy = dict(child)
            child_copy['children'] = _apply_dissolves_to_children(child.get('children', []), dissolved_ids_set)
            result.append(child_copy)
    return result


def _consolidate(nodes):
    """Merge nodes with the same part_number at the same level by summing qty."""
    seen = {}
    order = []
    for node in nodes:
        key = node['part_number']
        if key in seen:
            seen[key]['quantity'] += node['quantity']
        else:
            seen[key] = dict(node)
            order.append(key)
    return [seen[k] for k in order]


def _collect_part_numbers(nodes, result=None):
    """Set of every part_number in a (nested) tree."""
    if result is None:
        result = set()
    for n in nodes:
        pn = n.get('part_number')
        if pn:
            result.add(pn)
        _collect_part_numbers(n.get('children', []), result)
    return result


def _resync_snapshot(snapshot, tree, bom_instance, m, trigger='auto'):
    """Rebuild an existing snapshot from `tree` (the limb's current BOM).

    Smart rebuild: existing stage definitions and dissolves are remapped using
    part_number as the stable key, so configured stages survive BOM updates.
    A stage whose assembly vanished from the BOM is deactivated. (It is not
    re-activated if the part returns in a later version — engineer-cleared
    stages also use is_active=False, so the two are indistinguishable.)

    Writes a summary of what changed to snapshot.stale_diff_json (read by the
    tree UI as "last re-sync") and clears is_stale. Does NOT commit.
    Returns the summary dict.
    """
    limb_id = snapshot.limb_id
    current_version = bom_instance.version if bom_instance else None
    bom_instance_id = bom_instance.id if bom_instance else None

    def collect_pn_map(nodes, result=None):
        if result is None:
            result = {}
        for n in nodes:
            pn = n.get('part_number')
            if pn and pn not in result:
                result[pn] = n['bom_part_id']
            collect_pn_map(n.get('children', []), result)
        return result

    try:
        old_tree = json.loads(snapshot.base_tree_json or '[]')
    except Exception:
        old_tree = []

    old_parts = _collect_part_numbers(old_tree)
    new_parts = _collect_part_numbers(tree)

    old_pn_to_id = collect_pn_map(old_tree)
    new_pn_to_id = collect_pn_map(tree)

    # Build old_bom_part_id → new_bom_part_id via shared part_number
    old_id_to_pn = {v: k for k, v in old_pn_to_id.items()}
    id_remap = {
        old_id: new_pn_to_id[pn]
        for old_id, pn in old_id_to_pn.items()
        if pn in new_pn_to_id
    }

    # Remap dissolved_node_ids (skip any that no longer exist in new BOM)
    try:
        old_dissolved = json.loads(snapshot.dissolved_node_ids or '[]')
    except Exception:
        old_dissolved = []
    new_dissolved = [id_remap[oid] for oid in old_dissolved if oid in id_remap]

    # Remap active stage definitions
    remapped, deactivated = [], []
    stage_defs = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).all()
    for sd in stage_defs:
        if sd.bom_part_id in id_remap:
            sd.bom_part_id = id_remap[sd.bom_part_id]
            sd.bom_instance_id = bom_instance_id
            remapped.append(sd.stage_label)
        elif sd.assembly_part_number in new_pn_to_id:
            # Fallback: match by part number string directly
            sd.bom_part_id = new_pn_to_id[sd.assembly_part_number]
            sd.bom_instance_id = bom_instance_id
            remapped.append(sd.stage_label)
        else:
            # Part no longer present in new BOM — deactivate
            sd.is_active = False
            deactivated.append(sd.stage_label)

    summary = {
        'added': sorted(new_parts - old_parts),
        'removed': sorted(old_parts - new_parts),
        'old_bom_version': snapshot.bom_version_ref,
        'new_bom_version': str(current_version) if current_version is not None else None,
        'remapped_stage_labels': remapped,
        'deactivated_stage_labels': deactivated,
        'resynced_at': datetime.utcnow().isoformat() + 'Z',
        'trigger': trigger,
    }

    snapshot.source_bom_instance_id = bom_instance_id
    snapshot.base_tree_json = json.dumps(tree)
    snapshot.dissolved_node_ids = json.dumps(new_dissolved)
    snapshot.effective_tree_json = json.dumps(
        _apply_dissolves(tree, set(new_dissolved))
    )
    snapshot.bom_version_ref = summary['new_bom_version']
    snapshot.is_stale = False
    snapshot.stale_diff_json = json.dumps(summary)
    return summary


def _ensure_snapshot_fresh(limb_id, m, trigger='auto', user=None):
    """Re-sync the limb's snapshot if its source BOM moved to a new version.

    Called from request handlers (tree GET, dissolve endpoints, MenteeFlow
    stage-definition pulls, process creation) and from the 5-minute sweep in
    utils/limb_snapshot_sync.py. Cheap when nothing changed — one BOMInstance
    lookup. Never raises: a failed re-sync is logged and the caller keeps
    using the previous snapshot.

    Returns the re-sync summary dict, or None when nothing had to change.
    """
    db = m['db']
    snapshot = m['LimbAssemblySnapshot'].query.filter_by(limb_id=limb_id).first()
    if not snapshot:
        return None  # nothing to refresh — the tree GET builds the first one
    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return None

    bom_instance = _find_limb_bom_instance(limb, m)
    if not bom_instance or str(bom_instance.version) == snapshot.bom_version_ref:
        return None

    from utils.logger import log_action
    actor = _actor(user)
    try:
        tree, bom_instance = _build_limb_tree(limb, m)
        summary = _resync_snapshot(snapshot, tree, bom_instance, m, trigger=trigger)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        log_action('LIMB_SNAPSHOT_AUTO_RESYNC_FAILED', actor,
                   f'Limb {limb.name}: {e}', level='ERROR')
        return None

    log_action(
        'LIMB_SNAPSHOT_AUTO_RESYNC', actor,
        f"Limb {limb.name}: BOM {summary['old_bom_version']} -> {summary['new_bom_version']} "
        f"({trigger}); +{len(summary['added'])}/-{len(summary['removed'])} parts, "
        f"{len(summary['remapped_stage_labels'])} stage(s) remapped, "
        f"{len(summary['deactivated_stage_labels'])} deactivated"
    )
    # Stage defs may have moved or been deactivated (and DOF suffixes on their
    # names may differ) — push the fresh definitions to MenteeFlow.
    notify_menteeflow_limb_stages(limb, action='changed', user=actor)
    return summary


def _get_or_build_snapshot(limb_id, m, force_rebuild=False):
    """Get existing snapshot (auto re-synced if its BOM moved) or build a fresh one.

    force_rebuild re-syncs from the current BOM even when the version matches
    (the manual "Re-sync BOM" button).
    """
    db = m['db']
    limb = m['RobotLimb'].query.get_or_404(limb_id)
    snapshot = m['LimbAssemblySnapshot'].query.filter_by(limb_id=limb_id).first()

    if snapshot and not force_rebuild:
        _ensure_snapshot_fresh(limb_id, m, trigger='auto')
        return snapshot

    tree, bom_instance = _build_limb_tree(limb, m)

    if not snapshot:
        base_json = json.dumps(tree)
        snapshot = m['LimbAssemblySnapshot'](
            limb_id=limb_id,
            source_bom_instance_id=bom_instance.id if bom_instance else None,
            base_tree_json=base_json,
            effective_tree_json=base_json,
            dissolved_node_ids='[]',
            bom_version_ref=str(bom_instance.version) if bom_instance else None,
            is_stale=False,
        )
        db.session.add(snapshot)
        db.session.commit()
        return snapshot

    _resync_snapshot(snapshot, tree, bom_instance, m, trigger='manual')
    db.session.commit()
    notify_menteeflow_limb_stages(limb, action='changed')
    return snapshot


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/assembly-snapshot', methods=['GET'])
@login_required
def limb_assembly_snapshot(limb_id):
    """Get the limb's assembly tree snapshot (builds one if not exists). Checks staleness."""
    m = get_models()
    snapshot = _get_or_build_snapshot(limb_id, m)

    try:
        effective_tree = json.loads(snapshot.effective_tree_json or '[]')
        dissolved_ids = json.loads(snapshot.dissolved_node_ids or '[]')
    except Exception:
        effective_tree = []
        dissolved_ids = []

    stale_diff = None
    if snapshot.stale_diff_json:
        try:
            stale_diff = json.loads(snapshot.stale_diff_json)
        except Exception:
            pass

    return jsonify({
        'success': True,
        'snapshot_id': snapshot.id,
        'effective_tree': effective_tree,
        'dissolved_node_ids': dissolved_ids,
        'is_stale': snapshot.is_stale,
        'stale_diff': stale_diff,
        'bom_version_ref': snapshot.bom_version_ref,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/assembly-snapshot/rebuild', methods=['POST'])
@login_required
def limb_assembly_snapshot_rebuild(limb_id):
    """Force re-sync from the current BOM. Dissolves and configured stages are
    remapped by part number (only those whose part vanished are dropped).
    Normally unnecessary — snapshots auto re-sync when the BOM version moves."""
    m = get_models()
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Engineer or admin access required'}), 403

    snapshot = _get_or_build_snapshot(limb_id, m, force_rebuild=True)
    return jsonify({'success': True, 'message': 'Snapshot re-synced from current BOM', 'snapshot_id': snapshot.id})


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/assembly-snapshot/dissolve', methods=['POST'])
@login_required
def limb_dissolve_node(limb_id):
    """Dissolve a sub-assembly node: replace it with its children (consolidated) in effective tree."""
    m = get_models()
    db = m['db']
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Engineer or admin access required'}), 403

    data = request.json or {}
    node_id = data.get('node_id')
    if node_id is None:
        return jsonify({'success': False, 'error': 'node_id is required'}), 400

    snapshot = _get_or_build_snapshot(limb_id, m)

    try:
        dissolved_ids = set(json.loads(snapshot.dissolved_node_ids or '[]'))
        base_tree = json.loads(snapshot.base_tree_json or '[]')
    except Exception:
        return jsonify({'success': False, 'error': 'Snapshot data corrupted'}), 500

    dissolved_ids.add(int(node_id))
    new_effective = _apply_dissolves(base_tree, dissolved_ids)

    snapshot.dissolved_node_ids = json.dumps(list(dissolved_ids))
    snapshot.effective_tree_json = json.dumps(new_effective)
    db.session.commit()

    return jsonify({
        'success': True,
        'message': 'Sub-assembly dissolved',
        'effective_tree': new_effective,
        'dissolved_node_ids': list(dissolved_ids),
    })


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/assembly-snapshot/dissolve/<int:node_id>', methods=['DELETE'])
@login_required
def limb_undissolve_node(limb_id, node_id):
    """Undo dissolve: restore a sub-assembly node in the effective tree."""
    m = get_models()
    db = m['db']
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Engineer or admin access required'}), 403

    snapshot = _get_or_build_snapshot(limb_id, m)

    try:
        dissolved_ids = set(json.loads(snapshot.dissolved_node_ids or '[]'))
        base_tree = json.loads(snapshot.base_tree_json or '[]')
    except Exception:
        return jsonify({'success': False, 'error': 'Snapshot data corrupted'}), 500

    dissolved_ids.discard(int(node_id))
    new_effective = _apply_dissolves(base_tree, dissolved_ids)

    snapshot.dissolved_node_ids = json.dumps(list(dissolved_ids))
    snapshot.effective_tree_json = json.dumps(new_effective)
    db.session.commit()

    return jsonify({
        'success': True,
        'message': 'Dissolve undone',
        'effective_tree': new_effective,
        'dissolved_node_ids': list(dissolved_ids),
    })


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/assembly-snapshot/dissolve-all', methods=['DELETE'])
@login_required
def limb_dissolve_reset(limb_id):
    """Reset all dissolves for a limb (restore original tree)."""
    m = get_models()
    db = m['db']
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Engineer or admin access required'}), 403

    snapshot = _get_or_build_snapshot(limb_id, m)
    try:
        base_tree = json.loads(snapshot.base_tree_json or '[]')
    except Exception:
        base_tree = []

    snapshot.dissolved_node_ids = '[]'
    snapshot.effective_tree_json = json.dumps(base_tree)
    db.session.commit()

    return jsonify({'success': True, 'message': 'All dissolves reset', 'effective_tree': base_tree})


@robot_assembly_bp.route('/api/robot-assembly/assembly/<int:bom_instance_id>/build-data', methods=['GET'])
@login_required
def assembly_build_data(bom_instance_id):
    """Get parts data for building a sub-assembly (inventory, PDF/AI links)."""
    m = get_models()
    db = m['db']

    bom_instance = m['BOMInstance'].query.get_or_404(bom_instance_id)

    bom_parts = (
        db.session.query(m['BOMPart'], m['Part'])
        .join(m['Part'])
        .filter(m['BOMPart'].bom_id == bom_instance_id)
        .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
        .all()
    )

    parts_data = []
    for bp, p in bom_parts:
        if bp.level == 0:
            continue  # skip the root assembly itself
        thumb = _get_part_thumb(p)
        parts_data.append({
            'bom_part_id': bp.id,
            'part_id': p.id,
            'part_number': p.part_number,
            'revision': p.revision or '',
            'part_name': p.part_name or '',
            'description': p.description or '',
            'quantity': bp.quantity,
            'inventory': p.inventory,
            'warehouse_box': p.warehouse_box_number or '',
            'datasheet_drive_url': p.datasheet_drive_url or None,
            'thumbnail': thumb,
            'is_assembly': (p.part_type == 'Assembly') if p.part_type else False,
            'level': bp.level,
        })

    return jsonify({
        'success': True,
        'assembly_part_number': bom_instance.assembly_part_number,
        'assembly_name': bom_instance.name or bom_instance.assembly_part_number,
        'parts': parts_data,
    })


@robot_assembly_bp.route('/api/robot-assembly/assembly/<int:bom_instance_id>/collect-parts', methods=['POST'])
@login_required
def assembly_collect_parts(bom_instance_id):
    """Reduce inventory for parts collected to build this assembly."""
    m = get_models()
    db = m['db']

    data = request.json or {}
    parts = data.get('parts', [])  # [{part_id, qty}]
    if not parts:
        return jsonify({'success': False, 'error': 'No parts provided'}), 400

    updated = []
    errors = []
    for item in parts:
        part_id = item.get('part_id')
        qty = item.get('qty', 0)
        if not part_id or qty <= 0:
            continue
        part = m['Part'].query.get(part_id)
        if not part:
            errors.append(f'Part {part_id} not found')
            continue
        current_inv = part.inventory if part.inventory is not None else 0
        part.inventory = max(0, current_inv - qty)
        updated.append({'part_id': part_id, 'part_number': part.part_number, 'new_inventory': part.inventory})

    db.session.commit()

    from utils.logger import log_action
    log_action('ASSEMBLY_PARTS_COLLECTED', current_user,
               f'Collected parts for BOM {bom_instance_id}: {len(updated)} parts updated')

    return jsonify({
        'success': True,
        'updated': updated,
        'errors': errors,
        'message': f'{len(updated)} part(s) inventory updated',
    })


@robot_assembly_bp.route('/api/robot-assembly/collect-parts', methods=['POST'])
@login_required
def collect_parts_direct():
    """Reduce inventory for a list of parts directly (no BOM instance required)."""
    m = get_models()
    db = m['db']

    data = request.json or {}
    parts = data.get('parts', [])  # [{part_id, qty}]
    if not parts:
        return jsonify({'success': False, 'error': 'No parts provided'}), 400

    updated = []
    errors = []
    for item in parts:
        part_id = item.get('part_id')
        qty = item.get('qty', 0)
        if not part_id or qty <= 0:
            continue
        part = m['Part'].query.get(part_id)
        if not part:
            errors.append(f'Part {part_id} not found')
            continue
        current_inv = part.inventory if part.inventory is not None else 0
        part.inventory = max(0, current_inv - qty)
        updated.append({'part_id': part_id, 'part_number': part.part_number, 'new_inventory': part.inventory})

    db.session.commit()

    from utils.logger import log_action
    log_action('ASSEMBLY_PARTS_COLLECTED', current_user,
               f'Direct collect: {len(updated)} parts updated')

    return jsonify({
        'success': True,
        'updated': updated,
        'errors': errors,
        'message': f'{len(updated)} part(s) inventory updated',
    })


@robot_assembly_bp.route('/api/robot-assembly/admin/limb-staleness', methods=['GET'])
@login_required
def admin_limb_staleness():
    """Get stale status for all limbs of a given robot config."""
    m = get_models()
    config_id = request.args.get('config_id', type=int)
    if not config_id:
        return jsonify({'success': False, 'error': 'config_id required'}), 400

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    limbs = m['RobotLimb'].query.filter_by(robot_config_id=config_id, is_active=True).all()
    result = []
    for limb in limbs:
        snapshot = m['LimbAssemblySnapshot'].query.filter_by(limb_id=limb.id).first()
        result.append({
            'limb_id': limb.id,
            'limb_name': limb.name,
            'is_stale': snapshot.is_stale if snapshot else False,
            'has_snapshot': snapshot is not None,
            'dissolved_count': len(json.loads(snapshot.dissolved_node_ids or '[]')) if snapshot else 0,
        })
    return jsonify({'success': True, 'limbs': result})





# ============================================================================
# Assembly Drawing Defaults — Admin CRUD
# ============================================================================

VALID_ASSEMBLY_TYPES = ['gear', 'motor_and_gear', 'actuator']


@robot_assembly_bp.route('/api/robot-assembly/admin/drawing-defaults', methods=['GET', 'POST'])
@login_required
def admin_drawing_defaults():
    """List or create assembly drawing default mappings"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    if request.method == 'GET':
        defaults = m['AssemblyDrawingDefault'].query.filter_by(is_active=True).all()

        grouped = {}
        for d in defaults:
            if d.assembly_type not in grouped:
                grouped[d.assembly_type] = []
            grouped[d.assembly_type].append({
                'id': d.id,
                'assembly_type': d.assembly_type,
                'match_key': d.match_key,
                'display_label': d.display_label,
                'drawing_part_number': d.drawing_part_number,
                'has_uploaded_file': bool(d.uploaded_file_path),
                'is_active': d.is_active,
            })

        return jsonify({'success': True, 'drawing_defaults': grouped})

    # POST - create new mapping
    data = request.json
    assembly_type = (data.get('assembly_type') or '').strip()
    match_key = (data.get('match_key') or '').strip()

    if assembly_type not in VALID_ASSEMBLY_TYPES:
        return jsonify({'success': False, 'error': f'assembly_type must be one of: {VALID_ASSEMBLY_TYPES}'}), 400
    if not match_key:
        return jsonify({'success': False, 'error': 'match_key is required'}), 400

    drawing_part_number = (data.get('drawing_part_number') or '').strip() or None
    display_label = (data.get('display_label') or '').strip() or None

    # Validate part number exists if provided
    part_warning = None
    if drawing_part_number:
        part = m['Part'].query.filter_by(part_number=drawing_part_number).first()
        if not part:
            part_warning = f'Part {drawing_part_number} not found in database'
        elif not part.has_ai_pdf:
            part_warning = f'Part {drawing_part_number} exists but has no AI PDF flagged'

    # Check for existing (including inactive)
    existing = m['AssemblyDrawingDefault'].query.filter_by(
        assembly_type=assembly_type, match_key=match_key
    ).first()
    if existing:
        if existing.is_active:
            return jsonify({'success': False, 'error': f'Mapping for {assembly_type}:{match_key} already exists'}), 409
        # Reactivate
        existing.is_active = True
        existing.display_label = display_label
        existing.drawing_part_number = drawing_part_number
        existing.created_by = current_user.id
        db.session.commit()
        result = {'success': True, 'id': existing.id, 'message': 'Drawing default created'}
        if part_warning:
            result['warning'] = part_warning
        return jsonify(result), 201

    new_default = m['AssemblyDrawingDefault'](
        assembly_type=assembly_type,
        match_key=match_key,
        display_label=display_label,
        drawing_part_number=drawing_part_number,
        created_by=current_user.id,
    )
    db.session.add(new_default)
    db.session.commit()

    result = {'success': True, 'id': new_default.id, 'message': 'Drawing default created'}
    if part_warning:
        result['warning'] = part_warning
    return jsonify(result), 201


@robot_assembly_bp.route('/api/robot-assembly/admin/drawing-default/<int:default_id>', methods=['PUT', 'DELETE'])
@login_required
def admin_drawing_default_detail(default_id):
    """Update or delete an assembly drawing default"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    default = m['AssemblyDrawingDefault'].query.get_or_404(default_id)

    if request.method == 'DELETE':
        default.is_active = False
        db.session.commit()
        return jsonify({'success': True, 'message': 'Drawing default deactivated'})

    # PUT
    data = request.json
    if 'match_key' in data:
        default.match_key = data['match_key'].strip()
    if 'display_label' in data:
        default.display_label = (data['display_label'] or '').strip() or None
    if 'drawing_part_number' in data:
        default.drawing_part_number = (data['drawing_part_number'] or '').strip() or None
    if 'is_active' in data:
        default.is_active = data['is_active']

    db.session.commit()
    return jsonify({'success': True, 'message': 'Drawing default updated'})


@robot_assembly_bp.route('/api/robot-assembly/admin/drawing-default/<int:default_id>/upload', methods=['POST'])
@login_required
def admin_drawing_default_upload(default_id):
    """Upload a fallback drawing file for an assembly drawing default"""
    m = get_models()
    db = m['db']

    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    default = m['AssemblyDrawingDefault'].query.get_or_404(default_id)

    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    import base64
    file = request.files['file']
    file_data = file.read()

    # Save to filesystem
    upload_dir = os.path.join(current_app.instance_path, 'drawing_defaults')
    os.makedirs(upload_dir, exist_ok=True)

    from werkzeug.utils import secure_filename
    ext = os.path.splitext(file.filename or '')[1].lower()
    if ext not in ('.pdf', '.png', '.jpg', '.jpeg', '.svg', '.dwg', '.dxf', '.slddrw'):
        return jsonify({'success': False, 'error': f'Unsupported file type: {ext or "(none)"}'}), 400
    safe_name = secure_filename(f"{default.assembly_type}_{default.match_key}_{default_id}{ext}")
    if not safe_name:
        return jsonify({'success': False, 'error': 'Invalid file name'}), 400
    file_path = os.path.join(upload_dir, safe_name)
    with open(file_path, 'wb') as f:
        f.write(file_data)

    default.uploaded_file_path = os.path.join('drawing_defaults', safe_name)
    default.uploaded_file_data = base64.b64encode(file_data).decode('utf-8')
    db.session.commit()

    return jsonify({'success': True, 'message': 'Drawing file uploaded'})


@robot_assembly_bp.route('/api/robot-assembly/admin/drawing-default/<int:default_id>/file', methods=['GET'])
@login_required
def admin_drawing_default_file(default_id):
    """Serve the uploaded fallback drawing file"""
    m = get_models()

    default = m['AssemblyDrawingDefault'].query.get_or_404(default_id)

    if default.uploaded_file_path:
        file_path = os.path.join(current_app.instance_path, default.uploaded_file_path)
        if os.path.exists(file_path):
            return send_file(file_path)

    # Fallback to base64 data
    if default.uploaded_file_data:
        import base64
        data = base64.b64decode(default.uploaded_file_data)
        ext = os.path.splitext(default.uploaded_file_path or '.pdf')[1].lower()
        mime = 'application/pdf' if ext == '.pdf' else 'application/octet-stream'
        from io import BytesIO
        return send_file(BytesIO(data), mimetype=mime)

    return jsonify({'success': False, 'error': 'No uploaded file found'}), 404


# ============================================================================
# Assembly Drawing Defaults — Resolution
# ============================================================================

def _resolve_default_drawing(process_id, stage_str):
    """Internal: resolve the default assembly drawing for a given process + stage.
    Returns dict with drawing info or None."""
    m = get_models()
    db = m['db']

    process = m['ManufacturingProcess'].query.get(process_id)
    if not process:
        return None

    dof = m['DOFMapping'].query.get(process.dof_mapping_id) if process.dof_mapping_id else None
    if not dof:
        return None

    # Stage 3.1 (Motor) and 9 (DOF) — use the assembly's own part number
    stage_type_names = {'3.1': 'motor', '9': 'dof'}
    if stage_str in stage_type_names:
        target_part_number = _find_stage_assembly_part_number(m, db, dof, stage_str, process)
        if target_part_number:
            return {
                'drawing_part_number': target_part_number,
                'source': 'assembly_own',
                'match_info': {
                    'assembly_type': stage_type_names[stage_str],
                    'match_key': target_part_number,
                }
            }
        return None

    # For gear, motor_and_gear, and actuator — look up from AssemblyDrawingDefault (or exact pn)
    stage_to_type = {
        '3.2': 'gear',
        '5': 'motor_and_gear',
        '7': 'actuator',
    }
    assembly_type = stage_to_type.get(stage_str)
    if not assembly_type:
        return None

    # Find the target assembly and extract match_key
    match_key = _extract_match_key(m, db, dof, stage_str, assembly_type, process)
    print(f"[DrawingDefault] stage={stage_str} type={assembly_type} extracted_match_key={match_key!r}")
    if not match_key:
        print(f"[DrawingDefault] No match_key extracted for {assembly_type} stage {stage_str}")
        return None

    # Actuator with an exact part number (MC/MD case): return directly.
    # Named motor keys (MA, MB, MA_MB, MC_MD) are looked up in AssemblyDrawingDefault below.
    _ACTUATOR_NAMED_KEYS = ('MA', 'MB', 'MA_MB', 'MC_MD')
    if assembly_type == 'actuator' and match_key not in _ACTUATOR_NAMED_KEYS:
        return {
            'drawing_part_number': match_key,
            'source': 'assembly_own',
            'match_info': {
                'assembly_type': assembly_type,
                'match_key': match_key,
            }
        }

    # Query the defaults table
    default = m['AssemblyDrawingDefault'].query.filter_by(
        assembly_type=assembly_type,
        match_key=match_key,
        is_active=True,
    ).first()

    # Fallback: try case-insensitive substring match
    if not default:
        all_defaults = m['AssemblyDrawingDefault'].query.filter_by(
            assembly_type=assembly_type,
            is_active=True,
        ).all()
        print(f"[DrawingDefault] No exact match. Trying substring among {[d.match_key for d in all_defaults]}")
        for d in all_defaults:
            if d.match_key.lower() in match_key.lower() or match_key.lower() in d.match_key.lower():
                default = d
                break

    if not default:
        print(f"[DrawingDefault] No match found for {assembly_type}:{match_key!r}")
        return None

    print(f"[DrawingDefault] Matched! {assembly_type}:{match_key!r} -> {default.drawing_part_number}")

    return {
        'drawing_part_number': default.drawing_part_number,
        'has_uploaded_fallback': bool(default.uploaded_file_path),
        'default_id': default.id,
        'source': 'pdm' if default.drawing_part_number else 'uploaded',
        'match_info': {
            'assembly_type': assembly_type,
            'match_key': match_key,
            'matched_key': default.match_key,
            'display_label': default.display_label,
        }
    }


def _get_dof_bom_data(m, db, dof, process=None):
    """Get the DOF's BOM parts by navigating from limb → limb BOM → DOF root.
    For external DOFs (no limb), navigates directly from the DOF's own assembly BOM.
    Returns (bom_parts_list, dof_parent_bp_id) or (None, None) if not found."""
    limb = m['RobotLimb'].query.get(dof.limb_id) if dof.limb_id else None
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id) if limb else None
    badge_id = robot_config.badge_id if robot_config else (process.badge_id if process else None)

    def find_bom(part_number):
        bom = m['BOMInstance'].query.filter_by(
            assembly_part_number=part_number, badge_id=badge_id, is_latest=True
        ).first() if badge_id else None
        if not bom:
            bom = m['BOMInstance'].query.filter_by(
                assembly_part_number=part_number, is_latest=True
            ).first()
        return bom

    if not limb or not limb.assembly_part_number:
        # External DOF — use DOF's own assembly as root
        dof_own_bom = find_bom(dof.assembly_description)
        if not dof_own_bom:
            return None, None
        dof_bom_parts = (
            db.session.query(m['BOMPart'], m['Part'])
            .join(m['Part'])
            .filter(m['BOMPart'].bom_id == dof_own_bom.id)
            .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
            .all()
        )
        return dof_bom_parts, None

    limb_bom = find_bom(limb.assembly_part_number)
    if not limb_bom:
        return None, None

    limb_parts = (
        db.session.query(m['BOMPart'], m['Part'])
        .join(m['Part'])
        .filter(m['BOMPart'].bom_id == limb_bom.id)
        .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
        .all()
    )

    # Find DOF root in limb BOM
    dof_root_bp = None
    for bp, part in limb_parts:
        if part.part_number == dof.assembly_description:
            dof_root_bp = bp
            break

    dof_bom_parts = limb_parts
    dof_parent_bp_id = dof_root_bp.id if dof_root_bp else None

    if dof_root_bp:
        has_children = any(bp.parent_bom_part_id == dof_root_bp.id for bp, _ in limb_parts)
        if not has_children:
            dof_own_bom = find_bom(dof.assembly_description)
            if dof_own_bom:
                dof_parent_bp_id = None
                dof_bom_parts = (
                    db.session.query(m['BOMPart'], m['Part'])
                    .join(m['Part'])
                    .filter(m['BOMPart'].bom_id == dof_own_bom.id)
                    .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
                    .all()
                )

    return dof_bom_parts, dof_parent_bp_id


def _match_stage_desc(desc):
    """Match an assembly description to a stage label."""
    d = (desc or '').lower()
    if 'motor and gear' in d or 'motor & gear' in d or 'motor+gear' in d:
        return '5'
    if 'actuator' in d:
        return '7'
    if 'motor' in d and 'gear' not in d and ('assembly' in d or 'assy' in d):
        return '3.1'
    if 'gear' in d and 'motor' not in d and ('assembly' in d or 'assy' in d):
        return '3.2'
    return None


def _collect_all_assemblies_for_drawing(m, db, bom_parts_list, parent_bp_id, badge_id=None, depth=0):
    """Collect all sub-assemblies recursively, following into child BOMs when needed."""
    def find_bom(part_number):
        bom = m['BOMInstance'].query.filter_by(
            assembly_part_number=part_number, badge_id=badge_id, is_latest=True
        ).first() if badge_id else None
        if not bom:
            bom = m['BOMInstance'].query.filter_by(
                assembly_part_number=part_number, is_latest=True
            ).first()
        return bom

    if parent_bp_id is not None:
        children = [(bp, p) for bp, p in bom_parts_list if bp.parent_bom_part_id == parent_bp_id]
    else:
        children = [(bp, p) for bp, p in bom_parts_list if bp.level == 0]

    assemblies = []
    for bp, part in children:
        is_assembly = (part.part_type == 'Assembly') if part.part_type else False
        if is_assembly:
            assemblies.append((bp, part, bom_parts_list, depth))
            has_children = any(bp2.parent_bom_part_id == bp.id for bp2, _ in bom_parts_list)
            if has_children:
                assemblies.extend(_collect_all_assemblies_for_drawing(m, db, bom_parts_list, bp.id, badge_id, depth + 1))
            else:
                child_bom = find_bom(part.part_number)
                if child_bom:
                    child_bom_parts = (
                        db.session.query(m['BOMPart'], m['Part'])
                        .join(m['Part'])
                        .filter(m['BOMPart'].bom_id == child_bom.id)
                        .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
                        .all()
                    )
                    assemblies.extend(_collect_all_assemblies_for_drawing(m, db, child_bom_parts, None, badge_id, depth + 1))
    return assemblies


def _find_stage_assembly_part_number(m, db, dof, stage_str, process=None):
    """Find the part number of the assembly matching the given stage within the DOF's BOM tree."""
    if stage_str == '9':
        return dof.assembly_description

    dof_bom_parts, dof_parent_bp_id = _get_dof_bom_data(m, db, dof, process)
    if not dof_bom_parts:
        return None

    # Get badge_id for BOM lookups
    limb = m['RobotLimb'].query.get(dof.limb_id) if dof.limb_id else None
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id) if limb else None
    badge_id = robot_config.badge_id if robot_config else (process.badge_id if process else None)

    all_assemblies = _collect_all_assemblies_for_drawing(m, db, dof_bom_parts, dof_parent_bp_id, badge_id)

    # For stage 3.1/3.2, only search inside the Motor+Gear (stage 5) subtree.
    stage5_depth = None
    if stage_str in ('3.1', '3.2'):
        for _, part, _, depth in all_assemblies:
            desc = part.description or part.part_name or ''
            if _match_stage_desc(desc) == '5':
                if stage5_depth is None or depth < stage5_depth:
                    stage5_depth = depth

    best_depth = None
    best_pn = None
    for bp, part, _, depth in all_assemblies:
        desc = part.description or part.part_name or ''
        if _match_stage_desc(desc) != stage_str:
            continue
        if stage5_depth is not None and depth <= stage5_depth:
            continue
        if best_depth is None or depth < best_depth:
            best_pn = part.part_number
            best_depth = depth

    return best_pn


def _extract_match_key(m, db, dof, stage_str, assembly_type, process=None):
    """Extract the match_key from the assembly description for the given stage.
    Uses limb-based BOM traversal to find assemblies."""
    dof_bom_parts, dof_parent_bp_id = _get_dof_bom_data(m, db, dof, process)
    if not dof_bom_parts:
        print(f"[DrawingDefault] No BOM data found for DOF {dof.id}")
        return None

    # Get badge_id for BOM lookups
    limb = m['RobotLimb'].query.get(dof.limb_id) if dof.limb_id else None
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id) if limb else None
    badge_id = robot_config.badge_id if robot_config else (process.badge_id if process else None)

    all_assemblies = _collect_all_assemblies_for_drawing(m, db, dof_bom_parts, dof_parent_bp_id, badge_id)

    if assembly_type == 'gear':
        # Gear assembly (3.2) must live inside the Motor+Gear assembly (stage 5).
        # A depth-only search is wrong: an unrelated assembly with "gear" in its name
        # can appear as a direct DOF child (depth 0) and shadow the real one at depth 2+.
        # Strategy: find stage-5 depth first, then only consider stage-3.2 assemblies
        # that are deeper (i.e. inside the Motor+Gear subtree).
        stage5_depth = None
        for _, part, _, depth in all_assemblies:
            desc = part.description or part.part_name or ''
            if _match_stage_desc(desc) == '5':
                if stage5_depth is None or depth < stage5_depth:
                    stage5_depth = depth

        best_depth = None
        best_desc = None
        best_pn = None
        for bp, part, _, depth in all_assemblies:
            desc = part.description or part.part_name or ''
            if _match_stage_desc(desc) != '3.2':
                continue
            if stage5_depth is not None and depth <= stage5_depth:
                continue  # skip assemblies at or above the motor+gear level
            if best_depth is None or depth < best_depth:
                best_depth = depth
                best_desc = desc
                best_pn = part.part_number
        if best_desc is not None:
            print(f"[DrawingDefault] Gear assembly found: pn={best_pn} desc={best_desc!r}")
            return best_desc.strip()
        print(f"[DrawingDefault] No gear assembly found in {len(all_assemblies)} assemblies")
        return None

    if assembly_type in ('motor_and_gear', 'actuator'):
        # Find the target assembly (stage 5 or 7)
        target_bp = None
        target_part = None
        target_bom_parts = None
        best_depth = None
        for bp, part, bom_parts_list, depth in all_assemblies:
            desc = part.description or part.part_name or ''
            if _match_stage_desc(desc) == stage_str and (best_depth is None or depth < best_depth):
                target_bp = bp
                target_part = part
                target_bom_parts = bom_parts_list
                best_depth = depth

        if not target_part:
            return None

        # For actuator: the motor is a sibling under the DOF (inside Motor+Gear), not inside the
        # actuator itself. Scan the full DOF assembly tree for a motor (3.1) to determine MA/MB.
        if assembly_type == 'actuator':
            motor_desc = None
            for _, part, _, _ in all_assemblies:
                desc = part.description or part.part_name or ''
                if _match_stage_desc(desc) == '3.1':
                    motor_desc = desc
                    break
            print(f"[DrawingDefault] Actuator motor lookup: motor_desc={motor_desc!r}")
            if motor_desc:
                motor_upper = motor_desc.upper()
                has_ma = 'MA' in motor_upper
                has_mb = 'MB' in motor_upper
                if has_ma and has_mb:
                    return 'MA_MB'
                if has_mb:
                    return 'MB'
                if has_ma:
                    return 'MA'
            # MC/MD or no motor found: use the exact actuator part number
            return target_part.part_number

        # motor_and_gear: find motor child inside this assembly
        motor_desc = None
        children = [(bp, p) for bp, p in target_bom_parts if bp.parent_bom_part_id == target_bp.id]
        for bp, part in children:
            desc = part.description or part.part_name or ''
            if _match_stage_desc(desc) == '3.1':
                motor_desc = desc
                break

        # If no children in current BOM, check the assembly's own BOM
        if not motor_desc:
            def find_bom(part_number):
                bom = m['BOMInstance'].query.filter_by(
                    assembly_part_number=part_number, badge_id=badge_id, is_latest=True
                ).first() if badge_id else None
                if not bom:
                    bom = m['BOMInstance'].query.filter_by(
                        assembly_part_number=part_number, is_latest=True
                    ).first()
                return bom

            child_bom = find_bom(target_part.part_number)
            if child_bom:
                child_parts = (
                    db.session.query(m['BOMPart'], m['Part'])
                    .join(m['Part'])
                    .filter(m['BOMPart'].bom_id == child_bom.id)
                    .order_by(m['BOMPart'].level, m['BOMPart'].sequence)
                    .all()
                )
                for bp, part in child_parts:
                    desc = part.description or part.part_name or ''
                    if _match_stage_desc(desc) == '3.1':
                        motor_desc = desc
                        break

        if not motor_desc:
            return None

        motor_upper = motor_desc.upper()
        if 'MA' in motor_upper or 'MB' in motor_upper:
            return 'MA_MB'
        elif 'MC' in motor_upper or 'MD' in motor_upper:
            return 'MC_MD'
        return None

    return None


@robot_assembly_bp.route('/api/robot-assembly/process/<int:process_id>/stage/<stage>/default-drawing', methods=['GET'])
@login_required
def get_stage_default_drawing(process_id, stage):
    """Resolve the default assembly drawing for a process stage"""
    result = _resolve_default_drawing(process_id, stage)
    if not result:
        return jsonify({'success': True, 'default_drawing': None})

    return jsonify({'success': True, 'default_drawing': result})


# ============================================================================
# LIMB ASSEMBLY STAGES — HELPERS
# ============================================================================

def suggest_stage_prefix(limb_name):
    """Generate stage prefix from limb name initials.
    'Left Leg' → 'LL', 'Right Arm' → 'RA', 'Head' → 'H', 'Torso' → 'T'"""
    words = limb_name.strip().split()
    if len(words) == 1:
        return words[0][0].upper()
    return ''.join(w[0].upper() for w in words)


def _compute_stage_labels(prefix, stages_data, parent_label=None, top_stage_num=None, counter=None):
    """Compute stage labels recursively from nested stages_data.
    Supports arbitrary depth: LL1, LL1.1, LL1.1.1, LL1.1.1.1, etc.
    Input stages_data is a list of dicts with optional 'sub_stages' lists.
    Returns a flat list of dicts ready for DB insertion."""
    if counter is None:
        counter = [0]  # mutable counter for display_order across recursion

    result = []

    for idx, stage in enumerate(stages_data):
        child_num = idx + 1
        if parent_label:
            label = f"{parent_label}.{child_num}"
        else:
            label = f"{prefix}{child_num}"

        root_stage_num = top_stage_num if top_stage_num is not None else child_num
        has_subs = bool(stage.get('sub_stages'))

        result.append({
            'stage_number': root_stage_num,
            'stage_sub': label.split(prefix)[-1] if parent_label else None,
            'stage_label': label,
            'stage_name': stage['stage_name'],
            'bom_part_id': stage.get('bom_part_id'),
            'assembly_part_number': stage['assembly_part_number'],
            'bom_instance_id': stage.get('bom_instance_id'),
            'has_drawing': stage.get('has_drawing', False),
            'parallel_group': root_stage_num,
            'display_order': counter[0],
            'parent_label': parent_label,  # used for linking after DB insert
        })
        counter[0] += 1

        if has_subs:
            child_results = _compute_stage_labels(
                prefix, stage['sub_stages'],
                parent_label=label,
                top_stage_num=root_stage_num,
                counter=counter,
            )
            result.extend(child_results)

    return result


def _get_limb_stage_parts(stage_def, badge_id, m=None, dof_index=None):
    """Get parts for a limb assembly stage from the engineer's pre-configured snapshot.

    Uses LimbAssemblySnapshot.effective_tree_json (which has the engineer's
    dissolves already applied) so the picking list exactly matches what was
    configured in the tree view — no re-computation needed.

    Sub-stage assemblies (those with their own separate stage) are excluded
    because they have their own picking workflow.

    assembly_info carries the stage's DOF numbers (DOF assemblies among the
    picked parts) and a display_name with them appended. Pass dof_index
    (see _limb_dof_index) when calling for many stages of one limb.
    """
    if m is None:
        m = get_models()

    asm_pn = stage_def.assembly_part_number
    limb_id = stage_def.limb_id

    # Part numbers that have their own separate picking stage — skip them.
    sub_stage_pns = {s.assembly_part_number for s in (stage_def.sub_stages or []) if s.is_active}

    # ── Load the engineer's effective tree from the snapshot ──────────────────

    snapshot = m['LimbAssemblySnapshot'].query.filter_by(limb_id=limb_id).first()
    if not snapshot or not snapshot.effective_tree_json:
        return [], None

    try:
        effective_tree = json.loads(snapshot.effective_tree_json)
    except Exception:
        return [], None

    # ── Find the stage's node in the effective tree ───────────────────────────

    def find_node(nodes, pn, depth=0):
        if depth > 10:
            return None
        for node in nodes:
            if node.get('part_number') == pn:
                return node
            found = find_node(node.get('children', []), pn, depth + 1)
            if found:
                return found
        return None

    stage_node = find_node(effective_tree, asm_pn)
    if not stage_node:
        return [], None

    # ── Take direct children of the stage node as the picking parts ───────────
    # The effective tree already has dissolves applied: dissolved assemblies
    # have been replaced by their components, so what appears as a direct child
    # is exactly what needs to be picked.  Sub-stage assemblies are skipped
    # (they manage their own picking).

    consolidated = {}
    for child in stage_node.get('children', []):
        if child.get('part_number') in sub_stage_pns:
            continue
        pn = child.get('part_number', '')
        rev = child.get('revision', '')
        key = (pn, rev)
        qty = child.get('quantity', 1) or 1
        if key in consolidated:
            consolidated[key]['quantity'] += qty
        else:
            consolidated[key] = {
                'part_id': child.get('part_id'),
                'part_number': pn,
                'revision': rev,
                'part_name': child.get('part_name', ''),
                'description': child.get('description', ''),
                'quantity': qty,
                # inventory & warehouse_box refreshed from DB below
                'inventory': child.get('inventory', 0) or 0,
                'thumbnail': child.get('thumbnail', ''),
                'warehouse_box': child.get('warehouse_box', '') or '',
                'part_type': child.get('part_type', ''),
            }

    # ── Refresh live inventory & warehouse_box from DB ────────────────────────
    # The snapshot is a point-in-time cache; inventory changes every time parts
    # are picked/received, so always read the current values.
    # Parts not found in the live DB (deleted/renumbered since snapshot) are dropped.
    part_ids = [v['part_id'] for v in consolidated.values() if v['part_id']]
    live_map = {}
    if part_ids:
        live_parts = m['Part'].query.filter(m['Part'].id.in_(part_ids)).all()
        live_map = {p.id: p for p in live_parts}

    valid_keys = []
    for key, row in consolidated.items():
        pid = row['part_id']
        if pid and pid in live_map:
            p = live_map[pid]
            row['inventory'] = p.inventory or 0
            row['warehouse_box'] = p.warehouse_box_number or ''
            row['thumbnail'] = _get_part_thumb(p)
            valid_keys.append(key)
        elif not pid:
            valid_keys.append(key)  # no part_id at all — keep as-is

    consolidated = {k: consolidated[k] for k in valid_keys}

    # DOF assemblies among the picked parts → this stage's DOF numbers
    if dof_index is None:
        dof_index = _limb_dof_index(limb_id, m)
    dofs = _match_dofs(
        {_normalize_asm_pn(r['part_number']) for r in consolidated.values() if r['part_number']},
        asm_pn, dof_index,
    )

    assembly_info = {
        'part_number': asm_pn,
        'bom_instance_id': snapshot.source_bom_instance_id,
        'stage_name': stage_def.stage_name,
        'display_name': _stage_display_name(stage_def.stage_name, dofs),
        'dof_numbers': dofs,
        'stage_label': stage_def.stage_label,
    }
    return list(consolidated.values()), assembly_info


def _get_or_create_limb_embed_token(limb_process, ttl_minutes=43200):  # default 30 days
    """Get an existing active limb process-wide embed token, or create a new one."""
    m = get_models()
    db = m['db']

    existing = m['EmbedToken'].query.filter_by(
        limb_process_id=limb_process.id,
        stage_scope=None,
        is_revoked=False,
    ).filter(
        m['EmbedToken'].expires_at > datetime.utcnow()
    ).first()

    if existing:
        token_str = existing.token
        expires_at = existing.expires_at
    else:
        token_str = secrets.token_urlsafe(48)
        expires_at = datetime.utcnow() + timedelta(minutes=ttl_minutes)

        embed_token = m['EmbedToken'](
            token=token_str,
            limb_process_id=limb_process.id,
            stage_scope=None,
            expires_at=expires_at,
        )
        db.session.add(embed_token)
        db.session.commit()

        from utils.logger import log_action
        log_action('EMBED_TOKEN_CREATED', None,
                   f'Limb process-wide embed token for {limb_process.process_number}, expires {expires_at.isoformat()}')

    config = m['MenteeFlowConfig'].query.first()
    if config and config.embed_url_template:
        base_url = config.embed_url_template.rstrip('/')
    else:
        base_url = request.host_url.rstrip('/')

    embed_base_url = f"{base_url}/embed/limb-process/{limb_process.process_number}"

    return {
        'token': token_str,
        'embed_base_url': embed_base_url,
        'expires_at': expires_at.isoformat() + 'Z',
    }


def _limb_stage_sort_key(label):
    """Sort key ensuring sub-stages (e.g. TD1.1) come before their parent (TD1).

    Within the same top-level stage number, sub-stages sort first (by sub number),
    then the parent stage (no dot) sorts last.  Between different top-level numbers,
    order is ascending by that number.
    """
    parts = label.split('.')
    m = re.match(r'[A-Za-z]+(\d+)', parts[0])
    num = int(m.group(1)) if m else 0
    if len(parts) == 1:
        return (num, 1, 0)          # parent: comes after its sub-stages
    sub = int(parts[1]) if parts[1].isdigit() else 0
    return (num, 0, sub)            # sub-stage: comes before parent


def create_limb_process_stages(process_id, limb_id):
    """Create all stage records for a new limb assembly process from stage definitions."""
    m = get_models()
    db = m['db']

    defs = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).order_by(m['LimbAssemblyStageDefinition'].display_order).all()

    for stage_def in defs:
        stage = m['LimbAssemblyProcessStage'](
            process_id=process_id,
            stage_def_id=stage_def.id,
            stage_label=stage_def.stage_label,
            stage_name=stage_def.stage_name,
            assembly_part_number=stage_def.assembly_part_number,
            display_order=stage_def.display_order,
            parallel_group=stage_def.parallel_group,
            phase='pending',
            status='pending',
        )
        db.session.add(stage)


def notify_menteeflow_limb_stages(limb, action='changed', user=None):
    """Notify MenteeFlow when limb stage definitions change.

    Also fired after a snapshot re-sync (auto or manual), since stage defs may
    have been remapped/deactivated. `user` attributes the log entry; defaults
    to the request user, or SYSTEM_USER from the sweep job.
    """
    m = get_models()
    config = m['MenteeFlowConfig'].query.first()
    if not config or not config.base_url or not config.api_key:
        return

    defs = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb.id, is_active=True
    ).order_by(m['LimbAssemblyStageDefinition'].display_order).all()

    dof_index = _limb_dof_index(limb.id, m)
    stages_payload = []
    for d in defs:
        dofs = _dofs_for_stage_def(d, m, dof_index)
        stages_payload.append({
            'label': d.stage_label,
            'name': _stage_display_name(d.stage_name, dofs),
            'dof_numbers': dofs,
            'assembly_part_number': d.assembly_part_number,
            'parallel_group': d.parallel_group,
            'has_sub_stages': bool(d.sub_stages and any(s.is_active for s in d.sub_stages)),
            'has_drawing': d.has_drawing,
            'display_order': d.display_order,
        })

    url = f"{config.base_url.rstrip('/')}/api/webhook/menteebom/limb-stages-{action}"
    headers = {
        'X-MenteeBOM-API-Key': config.api_key,
        'Content-Type': 'application/json'
    }
    payload = {
        'limb_id': limb.id,
        'limb_name': limb.name,
        'stage_prefix': limb.stage_prefix or '',
        'stage_count': len(stages_payload),
        'stages': stages_payload,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }

    from utils.logger import log_action
    actor = _actor(user)
    try:
        response = http_requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        log_action('MENTEEFLOW_LIMB_STAGES_NOTIFY', actor,
                   f'Limb {limb.name} stages {action} notification sent ({len(stages_payload)} stages)')
    except Exception as e:
        log_action('MENTEEFLOW_LIMB_STAGES_NOTIFY_FAILED', actor,
                   f'Limb {limb.name} stages {action} failed: {str(e)}')


def _normalize_asm_pn(s):
    """Strip .SLDASM / .sldprt suffix and lowercase for matching."""
    if not s:
        return ''
    s = s.strip().lower()
    for ext in ('.sldasm', '.sldprt'):
        if s.endswith(ext):
            s = s[: -len(ext)]
            break
    return s


def _limb_dof_index(limb_id, m):
    """{normalized DOF assembly part number: dof_number} for the limb's DOFs.
    Build once per request when serializing many stages."""
    index = {}
    for d in m['DOFMapping'].query.filter_by(limb_id=limb_id).all():
        key = _normalize_asm_pn(d.assembly_description)
        if key:
            index[key] = d.dof_number
    return index


def _sort_dofs(dofs):
    """Numeric order ('200' < '1000'); non-numeric values last."""
    return sorted(dofs, key=lambda d: (0, int(d)) if str(d).isdigit() else (1, str(d)))


def _match_dofs(candidate_pns, own_pn, dof_index):
    """Match normalized candidate part numbers against the DOF index; fall back
    to the stage's own assembly part number. Returns a sorted list of DOF numbers."""
    matched = []
    for pn in candidate_pns:
        if pn in dof_index and dof_index[pn] not in matched:
            matched.append(dof_index[pn])
    if matched:
        return _sort_dofs(matched)

    own = _normalize_asm_pn(own_pn)
    if own in dof_index:
        return [dof_index[own]]
    return []


def _stage_display_name(stage_name, dofs):
    """Stage name as shown to users and mirrored to MenteeFlow, with the DOF
    numbers appended: 'Knee Assembly (DOF 203, 204)'. Computed at read time;
    the stored stage_name stays the raw BOM/PDM description so the stage
    configurator round-trips cleanly."""
    name = stage_name or ''
    if not dofs:
        return name
    return f"{name} (DOF {', '.join(str(d) for d in dofs)})".strip()


def _dofs_for_stage_def(stage_def, m, dof_index=None):
    """DOF numbers for a configured stage (LimbAssemblyStageDefinition):
    DOF assemblies in its picking list, else its own assembly. Returns []
    when no DOF assembly is involved."""
    if not stage_def:
        return []
    if dof_index is None:
        dof_index = _limb_dof_index(stage_def.limb_id, m)
    if not dof_index:
        return []

    try:
        _, info = _get_limb_stage_parts(stage_def, None, m, dof_index=dof_index)
        if info:
            return info['dof_numbers']
    except Exception:
        pass

    # No snapshot / node for this stage — only its own assembly can match
    return _match_dofs(set(), stage_def.assembly_part_number, dof_index)


def _dofs_for_stage(stage, limb_id, m, dof_index=None):
    """Return DOF numbers tied to this process stage, derived from the parts being picked.

    Resolution order:
      1. Look at the parts in the stage's picking list. Match each part_number
         against DOFMapping.assembly_description (stripped of .SLDASM). If any
         picked part is a DOF assembly, that's the stage's DOF.
      2. If picking already happened, use the persisted picked_parts_json.
      3. Fall back to text-matching the stage's own assembly_part_number.
    Returns [] when no DOF assembly is involved.
    """
    if not stage:
        return []
    if dof_index is None:
        dof_index = _limb_dof_index(limb_id, m)
    if not dof_index:
        return []

    # Gather candidate part numbers from the stage:
    #   - the live picking list (snapshot of what needs to be picked)
    #   - and what was actually picked / left unpicked, if data exists
    candidate_pns = set()

    try:
        stage_def = m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
        if stage_def:
            parts, _ = _get_limb_stage_parts(stage_def, None, m, dof_index=dof_index)
            for p in parts:
                pn = p.get('part_number')
                if pn:
                    candidate_pns.add(_normalize_asm_pn(pn))
    except Exception:
        pass

    for src in (stage.picked_parts_json, stage.unpicked_parts_json):
        if not src:
            continue
        try:
            for p in json.loads(src):
                pn = p.get('part_number')
                if pn:
                    candidate_pns.add(_normalize_asm_pn(pn))
        except (json.JSONDecodeError, TypeError):
            pass

    return _match_dofs(candidate_pns, stage.assembly_part_number, dof_index)


class _StageDofResolver:
    """Per-request memo for stage DOF lookups. Serializers that list many
    stages (process lists, status payloads) resolve each stage definition
    once and load each limb's DOF index once."""

    def __init__(self, m):
        self.m = m
        self._index = {}
        self._by_def = {}

    def index(self, limb_id):
        if limb_id not in self._index:
            self._index[limb_id] = _limb_dof_index(limb_id, self.m)
        return self._index[limb_id]

    def for_def(self, stage_def):
        if stage_def is None:
            return []
        if stage_def.id not in self._by_def:
            self._by_def[stage_def.id] = _dofs_for_stage_def(
                stage_def, self.m, self.index(stage_def.limb_id)
            )
        return self._by_def[stage_def.id]

    def for_stage(self, stage, limb_id):
        """Process stage → DOFs of its stage definition (own-assembly fallback)."""
        stage_def = None
        if stage.stage_def_id:
            stage_def = self.m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
        if stage_def:
            return self.for_def(stage_def)
        return _match_dofs(set(), stage.assembly_part_number, self.index(limb_id))

    def display(self, stage, limb_id):
        return _stage_display_name(stage.stage_name, self.for_stage(stage, limb_id))


def _adjust_limb_assembly_inventory(process, delta, m):
    """Adjust the limb's top-level assembly Part inventory by +delta or -delta.
    Called on limb completion (+1 — built one) and revert-from-completed (-1).
    Returns the Part if it was adjusted, else None.
    """
    limb = m['RobotLimb'].query.get(process.limb_id) if process.limb_id else None
    if not limb or not limb.assembly_part_number:
        return None
    part = m['Part'].query.filter_by(part_number=limb.assembly_part_number).first()
    if not part:
        return None
    old_inv = part.inventory or 0
    new_inv = max(0, old_inv + delta)
    part.inventory = new_inv
    print(f'[INVENTORY] Limb {process.process_number}: {part.part_number} '
          f'{old_inv} -> {new_inv} (delta={delta:+d})')
    return part


def _return_picked_inventory(stage, m):
    """Return all parts in stage.picked_parts_json back to inventory.
    Used on rollback so re-picking doesn't double-deduct. Clears the json after.
    Returns count of part-rows returned.
    """
    if not stage.picked_parts_json:
        return 0
    try:
        picked = json.loads(stage.picked_parts_json)
    except (json.JSONDecodeError, TypeError):
        return 0
    count = 0
    for pp in picked:
        part = m['Part'].query.get(pp.get('part_id'))
        if not part:
            continue
        qty = float(pp.get('quantity', 0))
        if qty <= 0:
            continue
        part.inventory = (part.inventory or 0) + qty
        count += 1
    stage.picked_parts_json = '[]'
    return count


def _build_limb_stage_notify_data(process, stage, m):
    """Build enriched data payload for MenteeFlow stage notifications.

    Includes the DOF number(s) specific to this stage's assembly, electrical
    parts picked in this stage, and overall process progress.
    """
    resolver = _StageDofResolver(m)
    stage_dofs = _dofs_for_stage(stage, process.limb_id, m, resolver.index(process.limb_id))

    # Full DOF list for the whole limb — context for MenteeFlow (not stage-specific).
    # Per-stage DOF data lives in `stage_dof_numbers` / `dof_number`.
    all_limb_dofs = [
        d.dof_number
        for d in m['DOFMapping'].query.filter_by(limb_id=process.limb_id).all()
    ]

    picked = []
    try:
        picked = json.loads(stage.picked_parts_json or '[]')
    except (json.JSONDecodeError, TypeError):
        pass

    el_types = {'Inhouse electrical part', 'External electrical part'}
    el_comps = [
        {'part_number': p.get('part_number', ''), 'quantity': p.get('quantity', 1)}
        for p in picked if p.get('part_type') in el_types
    ]

    all_stages = m['LimbAssemblyProcessStage'].query.filter_by(process_id=process.id).all()
    total = len(all_stages)
    done = sum(1 for s in all_stages if s.phase == 'completed')

    # Full process snapshot — every stage with its current phase/status
    process_snapshot = {
        'process_number': process.process_number,
        'limb_id': process.limb_id,
        'limb_name': process.limb.name if process.limb else None,
        'badge_id': process.badge_id,
        'status': process.status,
        'current_stage_label': process.current_stage_label,
        'stages': [
            {
                'stage_label': s.stage_label,
                'stage_name': resolver.display(s, process.limb_id),
                'dof_numbers': resolver.for_stage(s, process.limb_id),
                'assembly_part_number': s.assembly_part_number,
                'phase': s.phase,
                'status': s.status,
                'parallel_group': s.parallel_group,
                'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
                'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
            }
            for s in sorted(all_stages, key=lambda x: _limb_stage_sort_key(x.stage_label))
        ],
    }

    return {
        # DOF(s) tied to THIS stage's assembly. Empty list = stage isn't a DOF assembly.
        'stage_dof_numbers': stage_dofs,
        # Single primary DOF for convenience — None if stage has no DOF (e.g. integration stages)
        'dof_number': stage_dofs[0] if stage_dofs else None,
        # All DOFs across the limb — context only, not stage-specific.
        'dof_numbers': all_limb_dofs,
        'stage_assembly_part_number': stage.assembly_part_number,
        'stage_name': _stage_display_name(stage.stage_name, stage_dofs),
        'el_components': el_comps,
        'progress': {
            'completed_stages': done,
            'total_stages': total,
            'percent': round(done / total * 100, 1) if total else 0,
        },
        # True only on the webhook that completes the LAST stage of the limb.
        # Lets MenteeFlow flag "limb fully assembled" without inspecting
        # data.process.stages or process.status.
        'process_completed': (total > 0 and done == total),
        # Full process state — every stage's current phase/status
        'process': process_snapshot,
    }


def notify_menteeflow_limb_process(limb_process, stage_label, status='completed', data=None):
    """Send stage notification for a limb process to MenteeFlow."""
    m = get_models()
    config = m['MenteeFlowConfig'].query.first()
    if not config or not config.base_url or not config.api_key:
        return

    url = f"{config.base_url.rstrip('/')}/api/webhook/menteebom/limb-stage-complete"
    headers = {
        'X-MenteeBOM-API-Key': config.api_key,
        'Content-Type': 'application/json'
    }
    payload = {
        'process_number': limb_process.process_number,
        'stage_label': stage_label,
        'status': status,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'completed_by': current_user.username if current_user and current_user.is_authenticated else None,
    }
    if data:
        payload['data'] = data

    try:
        from utils.logger import log_action
        response = http_requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        log_action('MENTEEFLOW_LIMB_CALLBACK', current_user,
                   f'Limb process {limb_process.process_number} stage {stage_label} ({status}) notification sent')
    except Exception as e:
        from utils.logger import log_action
        log_action('MENTEEFLOW_LIMB_CALLBACK_FAILED', current_user,
                   f'Limb process {limb_process.process_number} stage {stage_label} failed: {str(e)}')


# ============================================================================
# LIMB ASSEMBLY STAGES — STAGE DEFINITION CRUD ENDPOINTS
# ============================================================================

@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/stage-definitions', methods=['GET'])
@login_required
def get_limb_stage_definitions(limb_id):
    """Get all stage definitions for a limb."""
    m = get_models()
    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return jsonify({'success': False, 'error': 'Limb not found'}), 404

    defs = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).order_by(m['LimbAssemblyStageDefinition'].display_order).all()

    dof_index = _limb_dof_index(limb_id, m)
    result = []
    for d in defs:
        dofs = _dofs_for_stage_def(d, m, dof_index)
        result.append({
            'id': d.id,
            'stage_prefix': d.stage_prefix,
            'stage_number': d.stage_number,
            'stage_sub': d.stage_sub,
            'stage_label': d.stage_label,
            'stage_name': d.stage_name,
            'display_name': _stage_display_name(d.stage_name, dofs),
            'dof_numbers': dofs,
            'bom_part_id': d.bom_part_id,
            'assembly_part_number': d.assembly_part_number,
            'bom_instance_id': d.bom_instance_id,
            'parent_stage_id': d.parent_stage_id,
            'parallel_group': d.parallel_group,
            'display_order': d.display_order,
            'has_drawing': d.has_drawing,
        })

    return jsonify({
        'success': True,
        'limb_id': limb_id,
        'limb_name': limb.name,
        'stage_prefix': limb.stage_prefix or suggest_stage_prefix(limb.name),
        'suggested_prefix': suggest_stage_prefix(limb.name),
        'definitions': result,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/stage-definitions', methods=['POST'])
@login_required
def save_limb_stage_definitions(limb_id):
    """Bulk-save stage definitions for a limb. Replaces existing definitions."""
    m = get_models()
    db = m['db']
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Engineer or admin access required'}), 403

    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return jsonify({'success': False, 'error': 'Limb not found'}), 404

    data = request.get_json()
    if not data or 'stages' not in data:
        return jsonify({'success': False, 'error': 'Missing stages data'}), 400

    prefix = limb.stage_prefix or suggest_stage_prefix(limb.name)

    # Deactivate all existing active definitions — will be re-activated if still present
    existing_active = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).all()
    for ex in existing_active:
        ex.is_active = False

    # Compute labels and upsert definitions (avoids unique constraint on limb_id+stage_label)
    computed = _compute_stage_labels(prefix, data['stages'])

    label_to_id = {}  # stage_label → DB id (for linking parents)
    created = []

    for item in computed:
        # Try to reuse an existing record with the same label (active or inactive)
        stage_def = m['LimbAssemblyStageDefinition'].query.filter_by(
            limb_id=limb_id, stage_label=item['stage_label']
        ).first()

        if stage_def:
            stage_def.stage_prefix = prefix
            stage_def.stage_number = item['stage_number']
            stage_def.stage_sub = item['stage_sub']
            stage_def.stage_name = item['stage_name']
            stage_def.bom_part_id = item['bom_part_id']
            stage_def.assembly_part_number = item['assembly_part_number']
            stage_def.bom_instance_id = item['bom_instance_id']
            stage_def.has_drawing = item['has_drawing']
            stage_def.parallel_group = item['parallel_group']
            stage_def.display_order = item['display_order']
            stage_def.is_active = True
            stage_def.updated_at = datetime.utcnow()
        else:
            stage_def = m['LimbAssemblyStageDefinition'](
                limb_id=limb_id,
                stage_prefix=prefix,
                stage_number=item['stage_number'],
                stage_sub=item['stage_sub'],
                stage_label=item['stage_label'],
                stage_name=item['stage_name'],
                bom_part_id=item['bom_part_id'],
                assembly_part_number=item['assembly_part_number'],
                bom_instance_id=item['bom_instance_id'],
                has_drawing=item['has_drawing'],
                parallel_group=item['parallel_group'],
                display_order=item['display_order'],
                is_active=True,
                created_by=current_user.id if current_user and current_user.is_authenticated else None,
            )
            db.session.add(stage_def)

        db.session.flush()  # Get ID

        label_to_id[item['stage_label']] = stage_def.id

        # Link to parent by label
        if item.get('parent_label') and item['parent_label'] in label_to_id:
            stage_def.parent_stage_id = label_to_id[item['parent_label']]

        created.append(stage_def)

    db.session.commit()

    # Notify MenteeFlow of definition change
    try:
        notify_menteeflow_limb_stages(limb, action='changed')
    except Exception:
        pass  # Don't fail the save if notification fails

    from utils.logger import log_action
    log_action('LIMB_STAGES_SAVED', current_user,
               f'Saved {len(created)} stage definitions for limb {limb.name} (prefix={prefix})')

    dof_index = _limb_dof_index(limb_id, m)
    return jsonify({
        'success': True,
        'created_count': len(created),
        'definitions': [{
            'id': d.id,
            'stage_label': d.stage_label,
            'stage_name': d.stage_name,
            'display_name': _stage_display_name(d.stage_name, _dofs_for_stage_def(d, m, dof_index)),
            'dof_numbers': _dofs_for_stage_def(d, m, dof_index),
            'assembly_part_number': d.assembly_part_number,
            'parallel_group': d.parallel_group,
            'display_order': d.display_order,
            'has_drawing': d.has_drawing,
            'parent_stage_id': d.parent_stage_id,
        } for d in created],
    })


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/stage-definitions', methods=['DELETE'])
@login_required
def clear_limb_stage_definitions(limb_id):
    """Clear all stage definitions for a limb."""
    m = get_models()
    db = m['db']
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Engineer or admin access required'}), 403

    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return jsonify({'success': False, 'error': 'Limb not found'}), 404

    existing = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).all()

    count = 0
    for ex in existing:
        ex.is_active = False
        count += 1

    db.session.commit()

    try:
        notify_menteeflow_limb_stages(limb, action='cleared')
    except Exception:
        pass

    from utils.logger import log_action
    log_action('LIMB_STAGES_CLEARED', current_user,
               f'Cleared {count} stage definitions for limb {limb.name}')

    return jsonify({'success': True, 'cleared_count': count})


@robot_assembly_bp.route('/api/robot-assembly/admin/limb/<int:limb_id>/stage-prefix', methods=['PUT'])
@login_required
def update_limb_stage_prefix(limb_id):
    """Update a limb's stage prefix."""
    m = get_models()
    db = m['db']
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Engineer or admin access required'}), 403

    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return jsonify({'success': False, 'error': 'Limb not found'}), 404

    data = request.get_json()
    if not data or 'prefix' not in data:
        return jsonify({'success': False, 'error': 'Missing prefix'}), 400

    prefix = data['prefix'].strip().upper()
    if not prefix or len(prefix) > 10:
        return jsonify({'success': False, 'error': 'Prefix must be 1-10 characters'}), 400

    limb.stage_prefix = prefix
    db.session.commit()

    from utils.logger import log_action
    log_action('LIMB_PREFIX_UPDATED', current_user,
               f'Updated stage prefix for limb {limb.name} to {prefix}')

    return jsonify({
        'success': True,
        'limb_id': limb_id,
        'stage_prefix': prefix,
    })


# ============================================================================
# LIMB ASSEMBLY PROCESSES — NATIVE START (no MenteeFlow required)
# ============================================================================

def _begin_runnable_stages(process_id, m):
    """Begin all pending stages whose direct child sub-stages are all completed.
    Leaf stages (no children in the process) are always runnable.
    Returns list of stage_labels that were begun.
    """
    db = m['db']
    all_stages = m['LimbAssemblyProcessStage'].query.filter_by(process_id=process_id).all()

    # Build lookup: stage_def_id → process_stage
    def_to_stage = {s.stage_def_id: s for s in all_stages}

    # Load stage definitions for this process
    stage_def_ids = list(def_to_stage.keys())
    stage_defs = {
        sd.id: sd for sd in m['LimbAssemblyStageDefinition'].query.filter(
            m['LimbAssemblyStageDefinition'].id.in_(stage_def_ids)
        ).all()
    }

    begun = []
    for proc_stage in all_stages:
        if proc_stage.phase != 'pending':
            continue
        sd = stage_defs.get(proc_stage.stage_def_id)
        if not sd:
            continue

        # Child stage_def_ids = those whose parent_stage_id == sd.id (and are in this process)
        child_def_ids = [
            sdid for sdid, sdef in stage_defs.items()
            if sdef.parent_stage_id == sd.id
        ]

        if not child_def_ids:
            can_start = True  # leaf stage
        else:
            can_start = all(
                def_to_stage.get(cid) and def_to_stage[cid].phase == 'completed'
                for cid in child_def_ids
            )

        if can_start:
            proc_stage.phase = 'picking'
            proc_stage.status = 'in_progress'
            proc_stage.started_at = datetime.utcnow()
            begun.append(proc_stage.stage_label)

    return begun


@robot_assembly_bp.route('/api/robot-assembly/limb/<int:limb_id>/start-process', methods=['POST'])
@login_required
def start_limb_process_native(limb_id):
    """Create or return the active limb assembly process for a badge without MenteeFlow."""
    m = get_models()
    db = m['db']

    data = request.get_json() or {}
    badge_id = data.get('badge_id')
    if not badge_id:
        return jsonify({'success': False, 'error': 'Missing badge_id'}), 400

    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return jsonify({'success': False, 'error': 'Limb not found'}), 404

    # Picking lists come from the snapshot — make sure it reflects the current BOM
    _ensure_snapshot_fresh(limb_id, m)
    resolver = _StageDofResolver(m)

    # Return existing active process if one exists (idempotent)
    existing = m['LimbAssemblyProcess'].query.filter_by(
        limb_id=limb_id, badge_id=badge_id, status='active'
    ).first()
    if existing:
        stages = []
        for s in sorted(existing.stages, key=lambda s: _limb_stage_sort_key(s.stage_label)):
            stages.append({
                'id': s.id, 'stage_label': s.stage_label, 'stage_name': s.stage_name,
                'display_name': resolver.display(s, limb_id), 'dof_numbers': resolver.for_stage(s, limb_id),
                'assembly_part_number': s.assembly_part_number, 'display_order': s.display_order,
                'parallel_group': s.parallel_group, 'phase': s.phase, 'status': s.status,
                'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
                'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
            })
        return jsonify({
            'success': True, 'created': False,
            'process': {
                'id': existing.id, 'process_number': existing.process_number,
                'badge_id': existing.badge_id, 'limb_id': existing.limb_id,
                'limb_name': existing.limb.name if existing.limb else None,
                'status': existing.status, 'current_stage_label': existing.current_stage_label,
                'stages': stages,
            }
        })

    # Verify stage definitions exist
    defs_count = m['LimbAssemblyStageDefinition'].query.filter_by(limb_id=limb_id, is_active=True).count()
    if defs_count == 0:
        return jsonify({
            'success': False,
            'error': 'No stage definitions configured for this limb. Configure in Admin → Robot Assembly.',
        }), 400

    # Generate unique process number: {prefix}-{badge_id}-{seq:03d}
    prefix = (limb.stage_prefix or 'LA').upper()
    existing_count = m['LimbAssemblyProcess'].query.filter_by(limb_id=limb_id, badge_id=badge_id).count()
    seq = existing_count + 1
    process_number = f"{prefix}-{badge_id}-{seq:03d}"
    while m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first():
        seq += 1
        process_number = f"{prefix}-{badge_id}-{seq:03d}"

    process = m['LimbAssemblyProcess'](
        process_number=process_number,
        badge_id=badge_id,
        limb_id=limb_id,
        status='active',
    )
    db.session.add(process)
    db.session.flush()

    create_limb_process_stages(process.id, limb_id)

    # Auto-begin all runnable stages (leaves start in parallel; parents wait for sub-stages)
    begun = _begin_runnable_stages(process.id, m)
    if begun:
        process.current_stage_label = sorted(begun, key=_limb_stage_sort_key)[0]

    db.session.commit()

    from utils.logger import log_action
    log_action('LIMB_PROCESS_STARTED_NATIVE', current_user,
               f'Native limb process {process_number} started for {limb.name}')

    stages = []
    for s in sorted(process.stages, key=lambda s: _limb_stage_sort_key(s.stage_label)):
        stages.append({
            'id': s.id, 'stage_label': s.stage_label, 'stage_name': s.stage_name,
            'display_name': resolver.display(s, limb_id), 'dof_numbers': resolver.for_stage(s, limb_id),
            'assembly_part_number': s.assembly_part_number, 'display_order': s.display_order,
            'parallel_group': s.parallel_group, 'phase': s.phase, 'status': s.status,
            'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
            'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
        })

    return jsonify({
        'success': True, 'created': True,
        'process': {
            'id': process.id, 'process_number': process.process_number,
            'badge_id': process.badge_id, 'limb_id': process.limb_id,
            'limb_name': process.limb.name if process.limb else None,
            'status': process.status, 'current_stage_label': process.current_stage_label,
            'stages': stages,
        }
    }), 201


# ============================================================================
# LIMB ASSEMBLY PROCESSES — INTERNAL UI ENDPOINTS
# ============================================================================

@robot_assembly_bp.route('/api/robot-assembly/limb-processes', methods=['GET'])
@login_required
def get_limb_processes():
    """List limb assembly processes with optional filters."""
    m = get_models()

    query = m['LimbAssemblyProcess'].query
    badge_id = request.args.get('badge_id', type=int)
    limb_id = request.args.get('limb_id', type=int)
    status = request.args.get('status')

    if badge_id:
        query = query.filter_by(badge_id=badge_id)
    if limb_id:
        query = query.filter_by(limb_id=limb_id)
    if status:
        query = query.filter_by(status=status)

    processes = query.order_by(m['LimbAssemblyProcess'].created_at.desc()).all()

    resolver = _StageDofResolver(m)
    result = []
    for p in processes:
        stage_statuses = {}
        for s in p.stages:
            stage_statuses[s.stage_label] = {
                'phase': s.phase,
                'status': s.status,
                'stage_name': s.stage_name,
                'display_name': resolver.display(s, p.limb_id),
                'dof_numbers': resolver.for_stage(s, p.limb_id),
                'parallel_group': s.parallel_group,
            }

        result.append({
            'id': p.id,
            'process_number': p.process_number,
            'badge_id': p.badge_id,
            'limb_id': p.limb_id,
            'limb_name': p.limb.name if p.limb else None,
            'status': p.status,
            'current_stage_label': p.current_stage_label,
            'stage_statuses': stage_statuses,
            'menteeflow_ticket_id': p.menteeflow_ticket_id,
            'menteeflow_url': p.menteeflow_url,
            'created_at': p.created_at.isoformat() + 'Z' if p.created_at else None,
        })

    return jsonify({'success': True, 'processes': result})


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>', methods=['GET'])
@login_required
def get_limb_process(process_id):
    """Get detailed limb process with all stage states."""
    m = get_models()
    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    resolver = _StageDofResolver(m)
    stages = []
    for s in sorted(process.stages, key=lambda s: _limb_stage_sort_key(s.stage_label)):
        stages.append({
            'id': s.id,
            'stage_label': s.stage_label,
            'stage_name': s.stage_name,
            'display_name': resolver.display(s, process.limb_id),
            'dof_numbers': resolver.for_stage(s, process.limb_id),
            'assembly_part_number': s.assembly_part_number,
            'display_order': s.display_order,
            'parallel_group': s.parallel_group,
            'phase': s.phase,
            'status': s.status,
            'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
            'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
            'reverted_at': s.reverted_at.isoformat() + 'Z' if s.reverted_at else None,
            'revert_reason': s.revert_reason,
        })

    return jsonify({
        'success': True,
        'process': {
            'id': process.id,
            'process_number': process.process_number,
            'badge_id': process.badge_id,
            'limb_id': process.limb_id,
            'limb_name': process.limb.name if process.limb else None,
            'status': process.status,
            'current_stage_label': process.current_stage_label,
            'revert_count': process.revert_count,
            'menteeflow_ticket_id': process.menteeflow_ticket_id,
            'menteeflow_url': process.menteeflow_url,
            'created_at': process.created_at.isoformat() + 'Z' if process.created_at else None,
            'completed_at': process.completed_at.isoformat() + 'Z' if process.completed_at else None,
            'stages': stages,
        }
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/begin', methods=['POST'])
@login_required
def begin_limb_stage(process_id, stage_label):
    """Advance a limb stage from pending to picking phase (native flow, no MenteeFlow required)."""
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase in ('picking', 'assembly'):
        # Already active — idempotent
        return jsonify({'success': True, 'stage_label': stage_label, 'phase': stage.phase, 'status': stage.status})

    if stage.phase == 'completed':
        return jsonify({'success': False, 'error': 'Stage already completed'}), 400

    # pending → picking
    stage.phase = 'picking'
    stage.status = 'in_progress'
    stage.started_at = datetime.utcnow()
    process.current_stage_label = stage_label
    process.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({'success': True, 'stage_label': stage_label, 'phase': stage.phase, 'status': stage.status})


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/picking-started', methods=['POST'])
@login_required
def picking_started_limb_stage(process_id, stage_label):
    """Notify MenteeFlow that the user opened the picking UI for this stage."""
    m = get_models()
    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    try:
        notify_data = _build_limb_stage_notify_data(process, stage, m)
        notify_menteeflow_limb_process(process, stage_label,
                                       status='picking_started', data=notify_data)
    except Exception:
        pass

    return jsonify({'success': True})


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/parts', methods=['GET'])
@login_required
def get_limb_stage_parts(process_id, stage_label):
    """Get parts for a limb process stage (for both picking and assembly phases)."""
    m = get_models()
    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    stage_def = m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
    if not stage_def:
        return jsonify({'success': False, 'error': 'Stage definition not found'}), 404

    parts, assembly_info = _get_limb_stage_parts(stage_def, process.badge_id, m)

    # During picking phase, fasteners are handled automatically — exclude from user's list
    if stage.phase == 'picking':
        FASTENER_TYPES = {'Fasteners'}
        parts = [p for p in parts if p.get('part_type') not in FASTENER_TYPES]

    return jsonify({
        'success': True,
        'stage_label': stage_label,
        'stage_name': stage.stage_name,
        'display_name': (assembly_info or {}).get('display_name', stage.stage_name),
        'dof_numbers': (assembly_info or {}).get('dof_numbers', []),
        'phase': stage.phase,
        'assembly': assembly_info,
        'parts': parts,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/pick', methods=['POST'])
@login_required
def submit_limb_picking(process_id, stage_label):
    """Submit picking for a limb process stage."""
    set_inventory_context('limb_picking', f"process_id:{process_id} {stage_label}")
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase != 'picking':
        return jsonify({'success': False, 'error': f'Stage is in {stage.phase} phase, not picking'}), 400

    data = request.get_json() or {}
    picked_parts = data.get('picked_parts', [])
    stage.picked_parts_json = json.dumps(picked_parts)
    stage.unpicked_parts_json = json.dumps(data.get('unpicked_parts', []))

    # Deduct inventory for picked parts
    for pp in picked_parts:
        part = m['Part'].query.get(pp.get('part_id'))
        if part:
            qty = float(pp.get('quantity', 1))
            old_inv = part.inventory or 0
            part.inventory = max(0, old_inv - qty)

    # Move to assembly phase
    stage.phase = 'assembly'
    db.session.commit()

    # Notify MenteeFlow with DOF numbers, EL components, and progress
    try:
        notify_data = _build_limb_stage_notify_data(process, stage, m)
        notify_menteeflow_limb_process(process, stage_label,
                                       status='picking_completed', data=notify_data)
    except Exception:
        pass

    return jsonify({
        'success': True,
        'stage_label': stage_label,
        'phase': stage.phase,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/complete', methods=['POST'])
@login_required
def complete_limb_stage(process_id, stage_label):
    """Complete a limb process stage (marks assembly phase as done)."""
    set_inventory_context('limb_stage_complete', f"process_id:{process_id} {stage_label}")
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase == 'completed':
        return jsonify({'success': False, 'error': 'Stage already completed'}), 400

    if stage.phase not in ('assembly', 'picking'):
        return jsonify({'success': False, 'error': f'Stage in {stage.phase} phase, cannot complete'}), 400

    stage.phase = 'completed'
    stage.status = 'completed'
    stage.completed_at = datetime.utcnow()
    stage.completed_by = current_user.id if current_user and current_user.is_authenticated else None

    # Auto-withdraw fasteners — they are not picked manually but must leave inventory
    FASTENER_TYPES = {'Fasteners'}
    stage_def = m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
    if stage_def:
        all_stage_parts, _ = _get_limb_stage_parts(stage_def, process.badge_id, m)
        for sp in all_stage_parts:
            part = m['Part'].query.get(sp.get('part_id'))
            if part and part.part_type in FASTENER_TYPES:
                qty = float(sp.get('quantity', 1))
                part.inventory = max(0, (part.inventory or 0) - qty)

    # Auto-begin any stages that just became runnable (their sub-stages are now all done)
    _begin_runnable_stages(process_id, m)

    # Check if all stages completed
    all_stages = m['LimbAssemblyProcessStage'].query.filter_by(process_id=process_id).all()
    all_done = all(s.phase == 'completed' or s.status == 'skipped' for s in all_stages)

    if all_done and process.status != 'completed':
        process.status = 'completed'
        process.completed_at = datetime.utcnow()
        # +1 the limb's assembly Part — we just built one
        _adjust_limb_assembly_inventory(process, +1, m)

    # Update current_stage_label to the first currently active stage
    next_active = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id
    ).filter(
        m['LimbAssemblyProcessStage'].phase.in_(['picking', 'assembly'])
    ).order_by(m['LimbAssemblyProcessStage'].display_order).first()

    process.current_stage_label = next_active.stage_label if next_active else None
    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Notify MenteeFlow with enriched stage data
    try:
        notify_data = _build_limb_stage_notify_data(process, stage, m)
        notify_menteeflow_limb_process(process, stage_label, status='completed', data=notify_data)
    except Exception:
        pass

    from utils.logger import log_action
    log_action('LIMB_STAGE_COMPLETED', current_user,
               f'Limb process {process.process_number} stage {stage_label} completed')

    return jsonify({
        'success': True,
        'stage_label': stage_label,
        'process_completed': all_done,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/rollback', methods=['POST'])
@login_required
def rollback_limb_stage(process_id, stage_label):
    """Admin: roll a completed stage back to picking phase so it can be redone."""
    set_inventory_context('stage_rollback_return', f"process_id:{process_id} {stage_label}")
    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin required'}), 403
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase not in ('completed', 'assembly'):
        return jsonify({'success': False, 'error': f'Stage is in {stage.phase} phase — only assembly or completed stages can be rolled back'}), 400

    # Return ALL previously picked parts back to inventory before clearing.
    # Operator will re-pick from scratch — without this, re-picking would
    # double-deduct (parts gone twice for one physical assembly).
    returned_count = _return_picked_inventory(stage, m)

    # Reset stage to picking phase
    stage.phase = 'picking'
    stage.status = 'in_progress'
    stage.completed_at = None
    stage.completed_by = None
    stage.unpicked_parts_json = '[]'

    # Revert process status if it was completed — also undo the +1 limb assembly bump
    if process.status == 'completed':
        process.status = 'active'
        process.completed_at = None
        _adjust_limb_assembly_inventory(process, -1, m)
    process.current_stage_label = stage_label
    process.updated_at = datetime.utcnow()

    db.session.commit()

    from utils.logger import log_action
    log_action('LIMB_STAGE_ROLLBACK', current_user,
               f'Admin rolled back limb process {process.process_number} stage {stage_label} '
               f'({returned_count} part-rows returned to stock)')

    return jsonify({
        'success': True,
        'stage_label': stage_label,
        'phase': 'picking',
        'parts_returned_to_stock': returned_count,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/skip-picking', methods=['POST'])
@login_required
def skip_limb_picking(process_id, stage_label):
    """Admin: skip the picking phase without deducting inventory (testing / override)."""
    if not current_user.can_access_admin():
        return jsonify({'success': False, 'error': 'Admin required'}), 403
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase != 'picking':
        return jsonify({'success': False, 'error': f'Stage is in {stage.phase} phase — only picking stages can be skipped'}), 400

    stage.picked_parts_json = '[]'
    stage.unpicked_parts_json = '[]'
    stage.phase = 'assembly'
    db.session.commit()

    from utils.logger import log_action
    log_action('LIMB_PICKING_SKIPPED', current_user,
               f'Admin skipped picking for limb process {process.process_number} stage {stage_label}')

    return jsonify({'success': True, 'stage_label': stage_label, 'phase': 'assembly'})


SKIP_STAGE_PASSWORD = os.environ.get('SKIP_STAGE_PASSWORD', 'NoPickSkip')


def _do_skip_limb_stage(process, stage, m):
    """Shared logic for the Forward action, callable from both session and
    embed endpoints. Marks the stage completed with NO inventory side-effects.
    Returns (all_done, error_response_tuple_or_None).
    """
    db = m['db']

    if stage.phase == 'completed':
        return False, (jsonify({'success': False, 'error': 'Stage already completed'}), 400)

    # Mark stage complete with NO inventory side-effects.
    # Note: we intentionally do NOT run the fastener auto-withdraw block here.
    stage.picked_parts_json = '[]'
    stage.unpicked_parts_json = '[]'
    stage.phase = 'completed'
    stage.status = 'completed'
    stage.completed_at = datetime.utcnow()
    stage.completed_by = current_user.id if current_user and current_user.is_authenticated else None

    # Cascade: auto-begin parents whose dependencies are now met
    _begin_runnable_stages(process.id, m)

    # Process completion check — if this was the last stage, mark process completed
    # and +1 the limb assembly Part (treating this as a real build, since the
    # limb physically exists on the floor).
    all_stages = m['LimbAssemblyProcessStage'].query.filter_by(process_id=process.id).all()
    all_done = all(s.phase == 'completed' or s.status == 'skipped' for s in all_stages)
    if all_done and process.status != 'completed':
        process.status = 'completed'
        process.completed_at = datetime.utcnow()
        _adjust_limb_assembly_inventory(process, +1, m)

    next_stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id
    ).filter(
        m['LimbAssemblyProcessStage'].phase.in_(['picking', 'assembly'])
    ).order_by(m['LimbAssemblyProcessStage'].display_order).first()
    process.current_stage_label = next_stage.stage_label if next_stage else None
    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Tell MenteeFlow the stage is done. Single `completed` event (matches
    # normal completion) with `forwarded: true` added — no state-machine
    # surprises on their side.
    try:
        notify_data = _build_limb_stage_notify_data(process, stage, m)
        notify_data['forwarded'] = True
        notify_menteeflow_limb_process(process, stage.stage_label, status='completed', data=notify_data)
    except Exception:
        pass

    from utils.logger import log_action
    log_action('LIMB_STAGE_SKIPPED', current_user,
               f'Force-completed stage {stage.stage_label} on {process.process_number} '
               f'(no inventory deducted — already-built limb)')

    return all_done, None


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/skip-stage', methods=['POST'])
@login_required
def skip_limb_stage(process_id, stage_label):
    """Skip an ENTIRE stage (session-auth path — native MenteeBOM UI).
    Available to all logged-in users but gated by a shared override password.
    Body: { "password": "<override password>" }
    """
    data = request.get_json() or {}
    password = data.get('password', '')
    if not password:
        return jsonify({'success': False, 'error': 'Password required'}), 400
    if password != SKIP_STAGE_PASSWORD:
        # 403, not 401: the user IS logged in, they just don't know the override.
        # 401 would trigger the global axios interceptor to redirect to /login.
        return jsonify({'success': False, 'error': 'Incorrect password'}), 403

    m = get_models()
    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    all_done, err = _do_skip_limb_stage(process, stage, m)
    if err:
        return err

    return jsonify({
        'success': True,
        'stage_label': stage_label,
        'phase': 'completed',
        'process_completed': all_done,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/cancel', methods=['DELETE'])
@login_required
def cancel_limb_process(process_id):
    """Admin-only: cancel a limb assembly process and return any picked parts to stock."""
    set_inventory_context('process_cancel_return', f"process_id:{process_id}")
    if not (current_user.role in ('admin', 'engineer') or current_user.can_access_admin()):
        return jsonify({'success': False, 'error': 'Admin access required'}), 403

    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    if process.status == 'completed':
        return jsonify({'success': False, 'error': 'Cannot cancel a completed process'}), 400

    # Collect all picked parts from every stage and return them to stock
    returned_parts = []
    for stage in process.stages:
        if not stage.picked_parts_json:
            continue
        try:
            picked = json.loads(stage.picked_parts_json)
        except (json.JSONDecodeError, TypeError):
            picked = []

        for pp in picked:
            part_id = pp.get('part_id')
            qty = float(pp.get('quantity', 0))
            if not part_id or qty <= 0:
                continue
            part = m['Part'].query.get(part_id)
            if part:
                part.inventory = (part.inventory or 0) + qty
                returned_parts.append({
                    'part_number': part.part_number,
                    'quantity': qty,
                    'stage_label': stage.stage_label,
                })

    process_number = process.process_number
    limb_name = process.limb.name if process.limb else str(process.limb_id)

    # Revoke any embed tokens tied to this process
    m['EmbedToken'].query.filter_by(limb_process_id=process.id).update({'is_revoked': True})

    # Delete stages explicitly first — avoids SQLAlchemy trying to SET process_id=NULL
    # on already-loaded stage objects (which would fail the NOT NULL constraint)
    m['LimbAssemblyProcessStage'].query.filter_by(process_id=process.id).delete()
    db.session.delete(process)
    db.session.commit()

    from utils.logger import log_action
    log_action('LIMB_PROCESS_CANCELLED', current_user,
               f'Limb process {process_number} ({limb_name}) cancelled by admin; '
               f'{len(returned_parts)} part lines returned to stock')

    return jsonify({
        'success': True,
        'process_number': process_number,
        'returned_parts': returned_parts,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/stage/<stage_label>/unpicked-check', methods=['GET'])
@login_required
def check_limb_unpicked(process_id, stage_label):
    """Check if unpicked parts block a limb stage."""
    m = get_models()

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    unpicked = json.loads(stage.unpicked_parts_json) if stage.unpicked_parts_json else []
    missing = [p for p in unpicked if p.get('quantity', 0) > 0]

    return jsonify({
        'success': True,
        'blocking': len(missing) > 0,
        'missing_parts': missing,
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/repick', methods=['POST'])
@login_required
def repick_limb_parts(process_id):
    """Re-pick parts that were missed during a limb stage's picking phase."""
    set_inventory_context('repick', f"process_id:{process_id}")
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.get_json() or {}
    stage_label = data.get('stage_label')
    repicked_parts = data.get('repicked_parts', [])

    if not stage_label:
        return jsonify({'success': False, 'error': 'Missing stage_label'}), 400

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    # Update unpicked list
    unpicked = json.loads(stage.unpicked_parts_json) if stage.unpicked_parts_json else []
    repicked_pns = {p['part_number'] for p in repicked_parts}
    unpicked = [p for p in unpicked if p.get('part_number') not in repicked_pns]
    stage.unpicked_parts_json = json.dumps(unpicked)

    # Add to repick history
    history = json.loads(stage.repick_history_json) if stage.repick_history_json else []
    history.append({
        'repicked_parts': repicked_parts,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'repicked_by': current_user.username if current_user and current_user.is_authenticated else None,
    })
    stage.repick_history_json = json.dumps(history)

    db.session.commit()

    return jsonify({
        'success': True,
        'remaining_unpicked': len(unpicked),
    })


@robot_assembly_bp.route('/api/robot-assembly/limb-process/<int:process_id>/replace-part', methods=['POST'])
@login_required
def replace_limb_part(process_id):
    """Replace a damaged/defective part in a limb process stage."""
    set_inventory_context('part_replace', f"process_id:{process_id}")
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.get(process_id)
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.get_json() or {}
    stage_label = data.get('stage_label')
    if not stage_label:
        return jsonify({'success': False, 'error': 'Missing stage_label'}), 400

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process_id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    replacement = m['PartReplacement'](
        limb_process_id=process.id,
        limb_stage_id=stage.id,
        old_part_id=data.get('old_part_id'),
        old_part_number=data.get('old_part_number', ''),
        old_revision=data.get('old_revision'),
        new_part_id=data.get('new_part_id'),
        new_part_number=data.get('new_part_number', ''),
        new_revision=data.get('new_revision'),
        quantity=data.get('quantity', 1),
        reason=data.get('reason'),
        created_by=current_user.id if current_user and current_user.is_authenticated else None,
    )
    db.session.add(replacement)
    db.session.commit()

    return jsonify({'success': True, 'replacement_id': replacement.id})


# ============================================================================
# LIMB ASSEMBLY PROCESSES — MENTEEFLOW WEBHOOK ENDPOINTS
# ============================================================================

@robot_assembly_bp.route('/api/menteeflow/limb/<int:limb_id>/stage-definitions', methods=['GET'])
@require_menteeflow_auth
def menteeflow_get_limb_stage_definitions(limb_id):
    """MenteeFlow queries stage definitions for a limb."""
    m = get_models()
    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return jsonify({'success': False, 'error': 'Limb not found'}), 404

    # Serve definitions remapped to the current BOM version
    _ensure_snapshot_fresh(limb_id, m)

    defs = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).order_by(m['LimbAssemblyStageDefinition'].display_order).all()

    dof_index = _limb_dof_index(limb_id, m)
    stages = []
    for d in defs:
        dofs = _dofs_for_stage_def(d, m, dof_index)
        stages.append({
            'label': d.stage_label,
            'name': _stage_display_name(d.stage_name, dofs),
            'dof_numbers': dofs,
            'assembly_part_number': d.assembly_part_number,
            'parallel_group': d.parallel_group,
            'has_drawing': d.has_drawing,
            'display_order': d.display_order,
            'parent_stage_label': d.parent_stage.stage_label if d.parent_stage else None,
        })

    return jsonify({
        'success': True,
        'limb_id': limb_id,
        'limb_name': limb.name,
        'stage_prefix': limb.stage_prefix or '',
        'stages': stages,
    })


@robot_assembly_bp.route('/api/menteeflow/limb-process/create', methods=['POST'])
@require_menteeflow_auth
def menteeflow_create_limb_process():
    """MenteeFlow creates a new limb assembly process."""
    m = get_models()
    db = m['db']

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Missing request body'}), 400

    process_number = data.get('process_number')
    limb_id = data.get('limb_id')

    if not process_number or not limb_id:
        return jsonify({'success': False, 'error': 'Missing process_number or limb_id'}), 400

    # Check for duplicate
    existing = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if existing:
        return jsonify({'success': False, 'error': f'Process {process_number} already exists'}), 409

    limb = m['RobotLimb'].query.get(limb_id)
    if not limb:
        return jsonify({'success': False, 'error': 'Limb not found'}), 404

    # New processes pick from the snapshot — make sure it reflects the current BOM
    _ensure_snapshot_fresh(limb_id, m)

    # Check stage definitions exist
    defs_count = m['LimbAssemblyStageDefinition'].query.filter_by(
        limb_id=limb_id, is_active=True
    ).count()
    if defs_count == 0:
        return jsonify({'success': False, 'error': 'No stage definitions configured for this limb'}), 400

    # Resolve badge
    robot_config = m['RobotConfig'].query.get(limb.robot_config_id)
    badge_id = robot_config.badge_id if robot_config else None

    if not badge_id:
        return jsonify({'success': False, 'error': 'Could not resolve badge for limb'}), 400

    process = m['LimbAssemblyProcess'](
        process_number=process_number,
        badge_id=badge_id,
        limb_id=limb_id,
        status='active',
        menteeflow_ticket_id=data.get('ticket_id'),
        menteeflow_url=data.get('ticket_url'),
    )
    db.session.add(process)
    db.session.flush()

    create_limb_process_stages(process.id, limb_id)

    # Set current_stage_label to first stage
    first_stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id
    ).order_by(m['LimbAssemblyProcessStage'].display_order).first()
    if first_stage:
        process.current_stage_label = first_stage.stage_label

    db.session.commit()

    # Build embed token
    embed_data = _get_or_create_limb_embed_token(process)

    from utils.logger import log_action
    log_action('LIMB_PROCESS_CREATED', None,
               f'MenteeFlow created limb process {process_number} for {limb.name}')

    # Build stage list for response
    resolver = _StageDofResolver(m)
    stages = []
    for s in process.stages:
        stages.append({
            'label': s.stage_label,
            'name': resolver.display(s, limb_id),
            'dof_numbers': resolver.for_stage(s, limb_id),
            'parallel_group': s.parallel_group,
            'phase': s.phase,
        })

    return jsonify({
        'success': True,
        'process_id': process.id,
        'process_number': process_number,
        'limb_name': limb.name,
        'badge_id': badge_id,
        'stages': stages,
        'embed': embed_data,
    }), 201


@robot_assembly_bp.route('/api/menteeflow/limb-process/open', methods=['POST'])
@require_menteeflow_auth
def menteeflow_open_limb_process():
    """MenteeFlow opens or starts a limb assembly process by process number.

    Parses the process number (e.g. 'LL-2-001') to derive limb and badge,
    creates the process if it doesn't exist, or returns the existing one.
    Always returns an embed URL pointing at the current stage so the iframe
    can resume exactly where work stopped.
    """
    m = get_models()
    db = m['db']

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Missing request body'}), 400

    process_number = (data.get('process_number') or '').strip()
    if not process_number:
        return jsonify({'success': False, 'error': 'Missing process_number'}), 400

    # Parse process number: PREFIX-VERSION_DIGIT-SEQ  e.g. "LL-2-001"
    # VERSION_DIGIT maps to a badge via MenteeFlowConfig.badge_digit_mapping
    parts = process_number.split('-')
    if len(parts) < 3:
        return jsonify({'success': False, 'error': 'Invalid process_number format — expected PREFIX-VERSION-SEQ'}), 400

    prefix = parts[0]
    version_digit = parts[1]

    # Resolve version digit → badge via MenteeFlow config mapping
    config = m['MenteeFlowConfig'].query.first()
    badge = None
    if config and config.badge_digit_mapping:
        try:
            mapping = json.loads(config.badge_digit_mapping)
            for badge_name, digit in mapping.items():
                if str(digit) == version_digit:
                    badge = m['ProjectBadge'].query.filter_by(name=badge_name, is_active=True).first()
                    break
        except (json.JSONDecodeError, AttributeError):
            pass

    if not badge:
        return jsonify({
            'success': False,
            'error': f'No badge mapped to version digit "{version_digit}". Configure badge_digit_mapping in MenteeFlow admin.'
        }), 404

    badge_id = badge.id

    # Check if process already exists
    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    created = False

    if process:
        # Update MenteeFlow ticket linkage if provided
        if data.get('ticket_id'):
            process.menteeflow_ticket_id = data['ticket_id']
        if data.get('ticket_url'):
            process.menteeflow_url = data['ticket_url']

        # If nothing is currently in picking/assembly, kick off runnable stages
        # (handles processes created before auto-begin was wired in)
        has_active = m['LimbAssemblyProcessStage'].query.filter_by(
            process_id=process.id
        ).filter(
            m['LimbAssemblyProcessStage'].phase.in_(['picking', 'assembly'])
        ).first()
        if not has_active and process.status == 'active':
            begun = _begin_runnable_stages(process.id, m)
            if begun:
                process.current_stage_label = sorted(begun, key=_limb_stage_sort_key)[0]

        process.updated_at = datetime.utcnow()
        db.session.commit()
        limb = m['RobotLimb'].query.get(process.limb_id)
    else:
        # Resolve limb from prefix + badge
        limb = m['RobotLimb'].query.join(
            m['RobotConfig'], m['RobotLimb'].robot_config_id == m['RobotConfig'].id
        ).filter(
            m['RobotLimb'].stage_prefix == prefix,
            m['RobotConfig'].badge_id == badge_id,
        ).first()
        if not limb:
            return jsonify({
                'success': False,
                'error': f'No limb found with prefix "{prefix}" for badge "{badge.name}" (id={badge_id})'
            }), 404

        # New processes pick from the snapshot — make sure it reflects the current BOM
        _ensure_snapshot_fresh(limb.id, m)

        defs_count = m['LimbAssemblyStageDefinition'].query.filter_by(limb_id=limb.id, is_active=True).count()
        if defs_count == 0:
            return jsonify({'success': False, 'error': 'No stage definitions configured for this limb'}), 400

        process = m['LimbAssemblyProcess'](
            process_number=process_number,
            badge_id=badge_id,
            limb_id=limb.id,
            status='active',
            menteeflow_ticket_id=data.get('ticket_id'),
            menteeflow_url=data.get('ticket_url'),
        )
        db.session.add(process)
        try:
            db.session.flush()
        except IntegrityError:
            # Race: a concurrent request inserted this process_number first.
            # Roll back and fetch the existing row — endpoint is idempotent.
            db.session.rollback()
            process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
            if not process:
                return jsonify({'success': False, 'error': 'Race resolution failed — process not found after duplicate'}), 500
            limb = m['RobotLimb'].query.get(process.limb_id)
            created = False
        else:
            create_limb_process_stages(process.id, limb.id)
            db.session.flush()

            # Auto-begin leaf stages and set current_stage_label using the same
            # sort key as the native "Start Assembly" flow (sub-stages first).
            begun = _begin_runnable_stages(process.id, m)
            if begun:
                process.current_stage_label = sorted(begun, key=_limb_stage_sort_key)[0]

            db.session.commit()
            created = True

            from utils.logger import log_action
            log_action('LIMB_PROCESS_CREATED', None,
                       f'MenteeFlow opened/created limb process {process_number} for {limb.name}')

    embed_data = _get_or_create_limb_embed_token(process)

    # Build a ready-to-embed URL pointed at the current stage
    current_label = process.current_stage_label
    current_stage_url = None
    if current_label:
        current_stage_url = (
            f"{embed_data['embed_base_url']}/stage/{current_label}"
            f"?token={embed_data['token']}"
        )
    embed_data['current_stage_url'] = current_stage_url

    return jsonify({
        'success': True,
        'created': created,
        'process_id': process.id,
        'process_number': process_number,
        'limb_name': limb.name if limb else None,
        'status': process.status,
        'current_stage_label': current_label,
        'embed': embed_data,
    })


@robot_assembly_bp.route('/api/menteeflow/limb-process/<process_number>/status', methods=['GET'])
@require_menteeflow_auth
def menteeflow_limb_process_status(process_number):
    """MenteeFlow gets full status of a limb assembly process."""
    m = get_models()
    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    resolver = _StageDofResolver(m)
    stages = []
    for s in process.stages:
        stages.append({
            'label': s.stage_label,
            'name': resolver.display(s, process.limb_id),
            'dof_numbers': resolver.for_stage(s, process.limb_id),
            'parallel_group': s.parallel_group,
            'phase': s.phase,
            'status': s.status,
            'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
            'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
        })

    return jsonify({
        'success': True,
        'process_number': process.process_number,
        'status': process.status,
        'current_stage_label': process.current_stage_label,
        'revert_count': process.revert_count,
        'stages': stages,
    })


@robot_assembly_bp.route('/api/menteeflow/limb-process/<process_number>/stage/<stage_label>/parts', methods=['GET'])
@require_menteeflow_auth
def menteeflow_limb_stage_parts(process_number, stage_label):
    """List parts for a stage. Used by MenteeFlow's repair/rollback picker
    to show the operator which parts were in this stage so they can pick
    which ones were physically replaced.

    Works any time after process creation — does NOT depend on picking
    state or webhook data. Pulls live data from the engineer's snapshot
    and refreshes inventory from the Part table at query time.

    Response: see MenteeFlow spec — parts[] with
      part_id, part_number, name, quantity, category, current_inventory.
    """
    m = get_models()
    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found in {process_number}'}), 404

    stage_def = m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
    if not stage_def:
        return jsonify({'success': False, 'error': 'Stage definition missing'}), 404

    raw_parts, assembly_info = _get_limb_stage_parts(stage_def, process.badge_id, m)

    def _category_short(pn):
        # Middle segment of NNN-XX-NNNNN  ("MP", "AS", "EL", etc.)
        if not pn:
            return ''
        segments = pn.split('-')
        return segments[1] if len(segments) >= 3 else ''

    # Refresh live inventory + warehouse_box from the Part table — _get_limb_stage_parts
    # already does this, but `warehouse_box` may not have been populated in the snapshot
    # so look up fresh values for any rows missing it.
    part_ids = [p.get('part_id') for p in raw_parts if p.get('part_id')]
    live_parts = {}
    if part_ids:
        live_parts = {
            p.id: p
            for p in m['Part'].query.filter(m['Part'].id.in_(part_ids)).all()
        }

    # Build absolute base URL so MenteeFlow can use thumbnail URLs in <img src>
    # from their own origin (cross-origin <img> doesn't need CORS).
    base = request.host_url.rstrip('/')

    def _abs_thumb(thumb_value):
        if not thumb_value:
            return None
        # Relative URL → make absolute. Base64 / data URIs → return as-is.
        if thumb_value.startswith('/'):
            return f'{base}{thumb_value}'
        return thumb_value

    parts = []
    for p in raw_parts:
        pid = p.get('part_id')
        live = live_parts.get(pid)
        box = p.get('warehouse_box') or (live.warehouse_box_number if live else '') or ''
        thumb = _abs_thumb(p.get('thumbnail'))
        parts.append({
            'part_id': pid,
            'part_number': p.get('part_number'),
            'name': p.get('part_name') or p.get('description', ''),
            # `category` = full classification ("Mechanical part", "Fasteners", etc.)
            # Per MenteeFlow spec — used for the checklist UI grouping.
            'category': p.get('part_type', ''),
            # `category_short` = MP/AS/EL/etc. for code-level filtering
            'category_short': _category_short(p.get('part_number', '')),
            'quantity': p.get('quantity', 1),
            'current_stock': p.get('inventory', 0) or 0,
            'box': box,
            'revision': p.get('revision', ''),
            # Absolute URL for direct <img src>, or a base64 data URI for legacy parts.
            'thumbnail': thumb,
        })

    stage_dofs = _dofs_for_stage(stage, process.limb_id, m)
    return jsonify({
        'success': True,
        'process_number': process.process_number,
        'stage_label': stage.stage_label,
        'stage_name': _stage_display_name(stage.stage_name, stage_dofs),
        'dof_numbers': stage_dofs,
        'stage_assembly_part_number': stage.assembly_part_number,
        'phase': stage.phase,
        'parts': parts,
    })


@robot_assembly_bp.route('/api/menteeflow/limb-process/<process_number>/advance', methods=['POST'])
@require_menteeflow_auth
def menteeflow_advance_limb_process(process_number):
    """MenteeFlow advances a limb process to the next phase/stage.
    Each stage goes: pending → picking → assembly → completed."""
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    if process.status != 'active':
        return jsonify({'success': False, 'error': f'Process is {process.status}'}), 400

    data = request.get_json() or {}
    target_label = data.get('stage_label')

    if target_label:
        # Advance a specific stage
        stage = m['LimbAssemblyProcessStage'].query.filter_by(
            process_id=process.id, stage_label=target_label
        ).first()
        if not stage:
            return jsonify({'success': False, 'error': f'Stage {target_label} not found'}), 404
    else:
        # Advance the next pending stage
        stage = m['LimbAssemblyProcessStage'].query.filter_by(
            process_id=process.id
        ).filter(
            m['LimbAssemblyProcessStage'].phase.in_(['pending', 'picking'])
        ).order_by(m['LimbAssemblyProcessStage'].display_order).first()

        if not stage:
            return jsonify({'success': False, 'error': 'No stages to advance'}), 400

    # Check if all child sub-stages are completed before allowing this stage to start
    if stage.phase == 'pending':
        # Find child stages (labels that start with this stage's label + ".")
        child_stages = [s for s in process.stages
                        if s.stage_label.startswith(stage.stage_label + '.') and
                        s.stage_label.count('.') == stage.stage_label.count('.') + 1]
        if child_stages:
            incomplete = [s.stage_label for s in child_stages if s.phase != 'completed']
            if incomplete:
                return jsonify({
                    'success': False,
                    'error': f'Cannot start {stage.stage_label} — sub-stages not complete: {", ".join(incomplete)}',
                    'incomplete_children': incomplete,
                }), 400

    # Advance phase
    if stage.phase == 'pending':
        stage.phase = 'picking'
        stage.status = 'in_progress'
        stage.started_at = datetime.utcnow()
    elif stage.phase == 'picking':
        stage.phase = 'assembly'
    elif stage.phase == 'assembly':
        stage.phase = 'completed'
        stage.status = 'completed'
        stage.completed_at = datetime.utcnow()
    elif stage.phase == 'completed':
        return jsonify({'success': True, 'message': 'Stage already completed', 'phase': 'completed'})

    process.current_stage_label = stage.stage_label
    process.updated_at = datetime.utcnow()
    db.session.commit()

    embed_data = _get_or_create_limb_embed_token(process)

    return jsonify({
        'success': True,
        'stage_label': stage.stage_label,
        'phase': stage.phase,
        'status': stage.status,
        'embed': embed_data,
    })


@robot_assembly_bp.route('/api/menteeflow/limb-process/<process_number>/complete-stage', methods=['POST'])
@require_menteeflow_auth
def menteeflow_complete_limb_stage(process_number):
    """MenteeFlow marks a limb stage as completed."""
    set_inventory_context('limb_stage_complete', process_number)
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.get_json() or {}
    stage_label = data.get('stage_label') or data.get('stage')
    if not stage_label:
        return jsonify({'success': False, 'error': 'Missing stage_label'}), 400

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase == 'completed':
        return jsonify({'success': True, 'message': 'Already completed'})

    # Guard against post-revert race: if this stage was reverted in the last
    # 30 seconds, refuse to silently re-complete it. Caller must pass `force: true`
    # to confirm the re-completion is intentional. Without this guard, a webhook
    # echo or reconciler can clobber an in-progress repair back to "completed".
    force = bool(data.get('force'))
    if stage.reverted_at and not force:
        from datetime import timedelta
        if datetime.utcnow() - stage.reverted_at < timedelta(seconds=30):
            return jsonify({
                'success': False,
                'error': (
                    f'Stage {stage_label} was reverted at '
                    f'{stage.reverted_at.isoformat()}Z. Pass {{"force": true}} to confirm '
                    f're-completion.'
                ),
                'reverted_at': stage.reverted_at.isoformat() + 'Z',
                'phase': stage.phase,
            }), 409

    stage.phase = 'completed'
    stage.status = 'completed'
    stage.completed_at = datetime.utcnow()

    # Auto-begin stages whose dependencies are now met
    _begin_runnable_stages(process.id, m)

    # Check if all done
    all_stages = m['LimbAssemblyProcessStage'].query.filter_by(process_id=process.id).all()
    all_done = all(s.phase == 'completed' or s.status == 'skipped' for s in all_stages)

    if all_done and process.status != 'completed':
        process.status = 'completed'
        process.completed_at = datetime.utcnow()
        # +1 the limb's assembly Part — we just built one
        _adjust_limb_assembly_inventory(process, +1, m)

    # Next pending stage
    next_stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id
    ).filter(
        m['LimbAssemblyProcessStage'].phase.in_(['pending', 'picking', 'assembly'])
    ).order_by(m['LimbAssemblyProcessStage'].display_order).first()

    process.current_stage_label = next_stage.stage_label if next_stage else None
    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Notify back
    try:
        notify_menteeflow_limb_process(process, stage_label, status='completed')
    except Exception:
        pass

    return jsonify({
        'success': True,
        'stage_label': stage_label,
        'process_completed': all_done,
    })


@robot_assembly_bp.route('/api/menteeflow/limb-process/<process_number>/revert', methods=['POST'])
@require_menteeflow_auth
def menteeflow_revert_limb_process(process_number):
    """Revert a limb process to a previous stage.

    Accepts optional `replaced_parts` to model "repair-style" rollback: parts
    that were physically replaced during disassembly need new inventory
    deducted; parts that were reused don't.

    `target_phase` controls where the reverted stages land:
      - "assembly" (default): target + cascade stay at phase=assembly with
        picked_parts_json preserved — operator only needs to redo assembly,
        not re-pick. This is the repair-flow default since picked parts are
        physically still in the limb.
      - "picking": target → phase=picking, inventory of previously picked
        parts is RETURNED to stock, picked_parts_json is cleared. Cascade
        stages go to phase=pending. Use this when a true reset is needed.

    Body:
      {
        "target_stage": "LL1.1.1.1",
        "reason": "Motor replacement",
        "target_phase": "assembly",   # OPTIONAL — "assembly" (default) | "picking"
        "replaced_parts": [            # OPTIONAL — empty = nothing changed
          {"part_id": 123, "quantity": 1},
          ...
        ]
      }
    """
    set_inventory_context('limb_revert_return', process_number)
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    data = request.get_json() or {}
    target_label = data.get('target_stage') or data.get('stage_label')
    reason = data.get('reason', '')
    replaced_parts = data.get('replaced_parts') or []
    target_phase = (data.get('target_phase') or 'assembly').lower()
    if target_phase not in ('assembly', 'picking'):
        return jsonify({
            'success': False,
            'error': f'Invalid target_phase "{target_phase}" — must be "assembly" or "picking"',
        }), 400

    if not target_label:
        return jsonify({'success': False, 'error': 'Missing target_stage'}), 400

    target_stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=target_label
    ).first()
    if not target_stage:
        return jsonify({'success': False, 'error': f'Stage {target_label} not found'}), 404

    was_completed = process.status == 'completed'

    # Per-part deduction for parts that were physically replaced during
    # disassembly. Parts not in this list are considered reused (no change).
    deducted = []
    for rp in replaced_parts:
        part = m['Part'].query.get(rp.get('part_id'))
        if not part:
            continue
        qty = float(rp.get('quantity', 1))
        if qty <= 0:
            continue
        old_inv = part.inventory or 0
        part.inventory = max(0, old_inv - qty)
        deducted.append({
            'part_id': part.id,
            'part_number': part.part_number,
            'quantity': qty,
            'inventory_before': old_inv,
            'inventory_after': part.inventory,
        })
        print(f'[INVENTORY] REPAIR-REPLACE: {part.part_number} (id={part.id}): '
              f'{old_inv} -> {part.inventory} (-{qty})')

    # ── Build cascade: target + every ancestor in the parent_stage_id chain ──
    # Using explicit hierarchy is safer than display_order, which the engineer
    # configures per-limb and may not match build order.
    def_to_proc = {
        ps.stage_def_id: ps
        for ps in m['LimbAssemblyProcessStage'].query.filter_by(process_id=process.id).all()
    }
    target_def = m['LimbAssemblyStageDefinition'].query.get(target_stage.stage_def_id)

    stages_to_revert = [target_stage]
    visited = {target_stage.id}
    cursor_def = target_def
    depth = 0
    while cursor_def and cursor_def.parent_stage_id and depth < 20:
        parent_def = m['LimbAssemblyStageDefinition'].query.get(cursor_def.parent_stage_id)
        if not parent_def:
            break
        parent_proc = def_to_proc.get(parent_def.id)
        if not parent_proc or parent_proc.id in visited:
            break
        # Only include ancestors that are NOT pending — i.e. they were touched
        # and need to be rolled back. Pending means they never started.
        if parent_proc.phase != 'pending':
            stages_to_revert.append(parent_proc)
            visited.add(parent_proc.id)
        cursor_def = parent_def
        depth += 1

    inventory_returned = 0
    reverted_labels = []

    for s in stages_to_revert:
        if target_phase == 'assembly':
            # Repair-flow path: every affected stage lands at assembly,
            # picked_parts_json preserved (parts are physically still in place).
            # The operator just redoes the assembly with replacements.
            s.original_completed_at = s.completed_at
            s.phase = 'assembly'
            s.status = 'in_progress' if s.id == target_stage.id else 'reverted'
            if s.id == target_stage.id:
                s.started_at = datetime.utcnow()
            else:
                s.reverted_at = datetime.utcnow()
                s.reverted_by = current_user.id if current_user and current_user.is_authenticated else None
                s.revert_reason = reason
            s.completed_at = None
            s.completed_by = None
        else:
            # "picking" path: true reset. Return inventory of previously picked
            # parts, clear picked_parts_json, target → picking, cascade → pending.
            inventory_returned += _return_picked_inventory(s, m)
            if s.id == target_stage.id:
                s.original_completed_at = s.completed_at
                s.phase = 'picking'
                s.status = 'in_progress'
                s.started_at = datetime.utcnow()
                s.completed_at = None
                s.completed_by = None
            else:
                s.original_completed_at = s.completed_at
                s.phase = 'pending'
                s.status = 'reverted'
                s.reverted_at = datetime.utcnow()
                s.reverted_by = current_user.id if current_user and current_user.is_authenticated else None
                s.revert_reason = reason
                s.completed_at = None
                s.completed_by = None
        reverted_labels.append(s.stage_label)

    # Undo limb assembly +1 if the process was previously completed
    if was_completed:
        _adjust_limb_assembly_inventory(process, -1, m)

    process.current_stage_label = target_label
    process.revert_count += 1
    process.status = 'active'
    process.completed_at = None
    process.updated_at = datetime.utcnow()
    db.session.commit()

    # Fire one `reverted` webhook per cascaded stage so MenteeFlow can update
    # every affected stage's phase locally — not just the explicit target.
    for s in stages_to_revert:
        try:
            notify_data = _build_limb_stage_notify_data(process, s, m)
            notify_menteeflow_limb_process(process, s.stage_label,
                                           status='reverted', data=notify_data)
        except Exception:
            pass

    from utils.logger import log_action
    log_action('LIMB_PROCESS_REVERTED', current_user,
               f'Limb process {process_number} reverted to {target_label} ({target_phase}): '
               f'cascade={reverted_labels}; reason={reason}')

    return jsonify({
        'success': True,
        'reverted_to': target_label,
        'reverted_stages': reverted_labels,
        'target_phase': target_phase,
        'revert_count': process.revert_count,
        'replaced_parts_deducted': deducted,
        'inventory_returned_count': inventory_returned,
        'limb_assembly_decremented': was_completed,
    })


@robot_assembly_bp.route('/api/menteeflow/limb-process/<process_number>/cancel', methods=['POST'])
@require_menteeflow_auth
def menteeflow_cancel_limb_process(process_number):
    """Cancel a limb assembly process."""
    set_inventory_context('process_cancel_return', process_number)
    m = get_models()
    db = m['db']

    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    if process.status == 'completed':
        return jsonify({'success': False, 'error': 'Cannot cancel a completed process'}), 400
    if process.status == 'cancelled':
        return jsonify({'success': True, 'process_number': process_number, 'status': 'cancelled'})

    # Return all picked parts to stock — mirrors the native admin cancel path,
    # otherwise deducted inventory is permanently lost on webhook cancels.
    returned_count = 0
    for stage in process.stages:
        if not stage.picked_parts_json:
            continue
        try:
            picked = json.loads(stage.picked_parts_json)
        except (json.JSONDecodeError, TypeError):
            picked = []
        for pp in picked:
            part_id = pp.get('part_id')
            qty = float(pp.get('quantity', 0))
            if not part_id or qty <= 0:
                continue
            part = m['Part'].query.get(part_id)
            if part:
                part.inventory = (part.inventory or 0) + qty
                returned_count += 1

    # Revoke any embed tokens tied to this process
    m['EmbedToken'].query.filter_by(limb_process_id=process.id).update({'is_revoked': True})

    process.status = 'cancelled'
    process.updated_at = datetime.utcnow()
    db.session.commit()

    from utils.logger import log_action
    log_action('LIMB_PROCESS_CANCELLED', None,
               f'MenteeFlow cancelled limb process {process_number}; '
               f'{returned_count} part lines returned to stock')

    return jsonify({'success': True, 'process_number': process_number, 'status': 'cancelled',
                    'parts_returned_to_stock': returned_count})


@robot_assembly_bp.route('/api/menteeflow/limb-process/<process_number>/embed-token', methods=['POST'])
@require_menteeflow_auth
def menteeflow_limb_embed_token(process_number):
    """Generate a fresh embed token + URL. Same response shape as /open's embed block.
    MenteeFlow calls this to refresh an expired token without re-creating the process."""
    m = get_models()

    process = m['LimbAssemblyProcess'].query.filter_by(process_number=process_number).first()
    if not process:
        return jsonify({'success': False, 'error': 'Process not found'}), 404

    embed_data = _get_or_create_limb_embed_token(process)

    # Match /open's shape — include current_stage_url pointed at the active stage
    current_label = process.current_stage_label
    current_stage_url = None
    if current_label:
        current_stage_url = (
            f"{embed_data['embed_base_url']}/stage/{current_label}"
            f"?token={embed_data['token']}"
        )
    embed_data['current_stage_url'] = current_stage_url

    return jsonify({
        'success': True,
        'process_number': process_number,
        'current_stage_label': current_label,
        'embed': embed_data,
    })


# ============================================================================
# LIMB ASSEMBLY PROCESSES — EMBED ENDPOINTS (for MenteeFlow iframe)
# ============================================================================

@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/picking-parts', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_limb_picking_parts(process_number, stage_label):
    """Get parts for picking phase of a limb stage (iframe endpoint)."""
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    stage_def = m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
    parts, assembly_info = _get_limb_stage_parts(stage_def, process.badge_id, m)

    # Fasteners are auto-withdrawn on completion — don't show them in the picking list
    FASTENER_TYPES = {'Fasteners'}
    parts = [p for p in parts if p.get('part_type') not in FASTENER_TYPES]

    resp = jsonify({
        'success': True,
        'stage_label': stage_label,
        'stage_name': (assembly_info or {}).get('display_name', stage.stage_name),
        'dof_numbers': (assembly_info or {}).get('dof_numbers', []),
        'phase': stage.phase,
        'assembly': assembly_info,
        'parts': parts,
    })
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/pick', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_limb_pick(process_number, stage_label):
    """Submit picking for a limb stage (iframe endpoint)."""
    set_inventory_context('limb_picking', f"{process_number} {stage_label}")
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    db = m['db']

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase != 'picking':
        return jsonify({'success': False, 'error': f'Stage is in {stage.phase} phase — picking already submitted'}), 400

    data = request.get_json() or {}
    picked_parts = data.get('picked_parts', [])
    stage.picked_parts_json = json.dumps(picked_parts)
    stage.unpicked_parts_json = json.dumps(data.get('unpicked_parts', []))

    # Deduct inventory for picked parts
    for pp in picked_parts:
        part = m['Part'].query.get(pp.get('part_id'))
        if part:
            qty = float(pp.get('quantity', 1))
            part.inventory = max(0, (part.inventory or 0) - qty)

    stage.phase = 'assembly'
    db.session.commit()

    # Notify MenteeFlow with DOF numbers, EL components, and progress
    try:
        notify_data = _build_limb_stage_notify_data(process, stage, m)
        notify_menteeflow_limb_process(process, stage_label,
                                       status='picking_completed', data=notify_data)
    except Exception:
        pass

    resp = jsonify({'success': True, 'stage_label': stage_label, 'phase': 'assembly'})
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/assembly-parts', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_limb_assembly_parts(process_number, stage_label):
    """Get parts for assembly phase of a limb stage (iframe endpoint)."""
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    stage_def = m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
    parts, assembly_info = _get_limb_stage_parts(stage_def, process.badge_id, m)

    resp = jsonify({
        'success': True,
        'stage_label': stage_label,
        'stage_name': (assembly_info or {}).get('display_name', stage.stage_name),
        'dof_numbers': (assembly_info or {}).get('dof_numbers', []),
        'phase': stage.phase,
        'assembly': assembly_info,
        'parts': parts,
    })
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/complete', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_limb_complete(process_number, stage_label):
    """Complete a limb stage from iframe."""
    set_inventory_context('limb_stage_complete', f"{process_number} {stage_label}")
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    db = m['db']

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase == 'completed':
        resp = jsonify({'success': True, 'message': 'Already completed'})
        return add_embed_headers(resp)

    stage.phase = 'completed'
    stage.status = 'completed'
    stage.completed_at = datetime.utcnow()

    # Auto-withdraw fasteners — not picked manually but must leave inventory
    FASTENER_TYPES = {'Fasteners'}
    stage_def = m['LimbAssemblyStageDefinition'].query.get(stage.stage_def_id)
    if stage_def:
        all_stage_parts, _ = _get_limb_stage_parts(stage_def, process.badge_id, m)
        for sp in all_stage_parts:
            part = m['Part'].query.get(sp.get('part_id'))
            if part and part.part_type in FASTENER_TYPES:
                qty = float(sp.get('quantity', 1))
                part.inventory = max(0, (part.inventory or 0) - qty)

    # Auto-begin any pending stages whose dependencies are now met (e.g. parent
    # whose last child just completed). Without this the next stage stays
    # 'pending' and the embed iframe has nothing to show next.
    _begin_runnable_stages(process.id, m)

    all_stages = m['LimbAssemblyProcessStage'].query.filter_by(process_id=process.id).all()
    all_done = all(s.phase == 'completed' or s.status == 'skipped' for s in all_stages)

    if all_done and process.status != 'completed':
        process.status = 'completed'
        process.completed_at = datetime.utcnow()
        # Don't revoke the embed token here — the iframe is still open at this
        # moment and will try to refresh after the user clicks "Finished".
        # Also the repair flow expects to reopen the same URL later. Tokens
        # already expire after 30 days; revocation only on explicit cancel.
        _adjust_limb_assembly_inventory(process, +1, m)

    # Prefer a stage currently being worked (picking/assembly) over a pending one
    next_stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id
    ).filter(
        m['LimbAssemblyProcessStage'].phase.in_(['picking', 'assembly'])
    ).order_by(m['LimbAssemblyProcessStage'].display_order).first()
    if not next_stage:
        next_stage = m['LimbAssemblyProcessStage'].query.filter_by(
            process_id=process.id
        ).filter(
            m['LimbAssemblyProcessStage'].phase == 'pending'
        ).order_by(m['LimbAssemblyProcessStage'].display_order).first()

    process.current_stage_label = next_stage.stage_label if next_stage else None
    process.updated_at = datetime.utcnow()
    db.session.commit()

    try:
        notify_data = _build_limb_stage_notify_data(process, stage, m)
        notify_menteeflow_limb_process(process, stage_label, status='completed', data=notify_data)
    except Exception:
        pass

    resp = jsonify({
        'success': True,
        'stage_label': stage_label,
        'process_completed': all_done,
    })
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/skip-stage', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_limb_skip_stage(process_number, stage_label):
    """Force-complete a stage from the iframe (Forward button in MenteeFlow's
    embed view). Same semantics as the session-auth /skip-stage endpoint:
    no inventory deducted, no fastener auto-withdraw, single `completed`
    webhook to MenteeFlow with `forwarded: true`.

    Password-gated by the shared `NoPickSkip` override.
    Body: { "password": "NoPickSkip" }
    """
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    data = request.get_json() or {}
    password = data.get('password', '')
    if not password:
        return jsonify({'success': False, 'error': 'Password required'}), 400
    if password != SKIP_STAGE_PASSWORD:
        return jsonify({'success': False, 'error': 'Incorrect password'}), 403

    m = get_models()
    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    all_done, err = _do_skip_limb_stage(process, stage, m)
    if err:
        return err

    resp = jsonify({
        'success': True,
        'stage_label': stage_label,
        'phase': 'completed',
        'process_completed': all_done,
    })
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/damaged-part', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_limb_damaged_part(process_number, stage_label):
    """Report a damaged part during a limb assembly stage (iframe)."""
    set_inventory_context('damaged_part_replace', f"{process_number} {stage_label}")
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    db = m['db']

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    data = request.get_json() or {}

    replacement = m['PartReplacement'](
        limb_process_id=process.id,
        limb_stage_id=stage.id,
        old_part_id=data.get('old_part_id'),
        old_part_number=data.get('old_part_number', ''),
        old_revision=data.get('old_revision'),
        new_part_id=data.get('new_part_id'),
        new_part_number=data.get('new_part_number', ''),
        new_revision=data.get('new_revision'),
        quantity=data.get('quantity', 1),
        reason=data.get('reason'),
    )
    db.session.add(replacement)
    db.session.commit()

    resp = jsonify({'success': True, 'replacement_id': replacement.id})
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/unpicked-check', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_limb_unpicked_check(process_number, stage_label):
    """Check unpicked parts for a limb stage (iframe)."""
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    unpicked = json.loads(stage.unpicked_parts_json) if stage.unpicked_parts_json else []
    missing = [p for p in unpicked if p.get('quantity', 0) > 0]

    resp = jsonify({
        'success': True,
        'blocking': len(missing) > 0,
        'missing_parts': missing,
    })
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/picking-started', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_limb_picking_started(process_number, stage_label):
    """Notify MenteeFlow that the floor user opened the picking UI for a stage.
    Fires the stage-DOF / EL-components payload at picking start (not after submit)."""
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    try:
        notify_data = _build_limb_stage_notify_data(process, stage, m)
        notify_menteeflow_limb_process(process, stage_label,
                                       status='picking_started', data=notify_data)
    except Exception:
        pass

    resp = jsonify({'success': True})
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/stage/<stage_label>/begin', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_limb_begin(process_number, stage_label):
    """Begin a pending limb stage (iframe). No-op if already started."""
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    db = m['db']
    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    if stage.phase == 'pending':
        stage.phase = 'picking'
        stage.status = 'in_progress'
        stage.started_at = datetime.utcnow()
        db.session.commit()

    resp = jsonify({'success': True, 'stage_label': stage_label, 'phase': stage.phase})
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/repick', methods=['POST', 'OPTIONS'])
@require_embed_auth
def embed_limb_repick(process_number):
    """Re-pick missed parts during a limb stage (iframe)."""
    set_inventory_context('repick', process_number)
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    db = m['db']

    data = request.get_json() or {}
    stage_label = data.get('stage_label')
    repicked_parts = data.get('repicked_parts', [])

    if not stage_label:
        return jsonify({'success': False, 'error': 'Missing stage_label'}), 400

    stage = m['LimbAssemblyProcessStage'].query.filter_by(
        process_id=process.id, stage_label=stage_label
    ).first()
    if not stage:
        return jsonify({'success': False, 'error': f'Stage {stage_label} not found'}), 404

    # Update unpicked list
    unpicked = json.loads(stage.unpicked_parts_json) if stage.unpicked_parts_json else []
    repicked_pns = {p['part_number'] for p in repicked_parts}
    unpicked = [p for p in unpicked if p.get('part_number') not in repicked_pns]
    stage.unpicked_parts_json = json.dumps(unpicked)

    # Deduct inventory for re-picked parts
    for rp in repicked_parts:
        part = m['Part'].query.get(rp.get('part_id'))
        if part:
            qty = float(rp.get('quantity', 1))
            part.inventory = max(0, (part.inventory or 0) - qty)

    # Track repick history
    history = json.loads(stage.repick_history_json) if stage.repick_history_json else []
    history.append({
        'repicked_parts': repicked_parts,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'repicked_by': None,  # No MenteeBOM user in embed context
    })
    stage.repick_history_json = json.dumps(history)

    db.session.commit()

    resp = jsonify({'success': True, 'remaining_unpicked': len(unpicked)})
    return add_embed_headers(resp)


@robot_assembly_bp.route('/api/embed/limb-process/<process_number>/status', methods=['GET', 'OPTIONS'])
@require_embed_auth
def embed_limb_status(process_number):
    """Return full limb process status — stages, phases, current stage (iframe)."""
    from flask import g
    process = g.embed_limb_process
    if not process or process.process_number != process_number:
        return jsonify({'success': False, 'error': 'Process mismatch'}), 403

    m = get_models()
    resolver = _StageDofResolver(m)
    stages = []
    for s in sorted(process.stages, key=lambda s: _limb_stage_sort_key(s.stage_label)):
        stages.append({
            'id': s.id,
            'stage_label': s.stage_label,
            'stage_name': resolver.display(s, process.limb_id),
            'dof_numbers': resolver.for_stage(s, process.limb_id),
            'assembly_part_number': s.assembly_part_number,
            'display_order': s.display_order,
            'parallel_group': s.parallel_group,
            'phase': s.phase,
            'status': s.status,
            'started_at': s.started_at.isoformat() + 'Z' if s.started_at else None,
            'completed_at': s.completed_at.isoformat() + 'Z' if s.completed_at else None,
        })

    resp = jsonify({
        'success': True,
        'process': {
            'id': process.id,
            'process_number': process.process_number,
            'badge_id': process.badge_id,
            'limb_id': process.limb_id,
            'limb_name': process.limb.name if process.limb else None,
            'status': process.status,
            'current_stage_label': process.current_stage_label,
            'stages': stages,
        },
    })
    return add_embed_headers(resp)
