"""
Notifications & live-update polling API Blueprint
=================================================
Per-user notification center (list / mark read / delete), the cheap polling
endpoint browsers hit every ~10 s, and the admin endpoints to trigger and
inspect the nightly PDM staleness check.

The poll endpoint is THE hot path — it must stay one indexed SQL statement
plus an in-memory version read. No PDM/COM calls here, ever.
"""
import json
import threading
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from sqlalchemy import func

from permissions import admin_required
from utils.live_updates import versions as live_versions, get_active_imports
from utils.pdm_stale_check import stale_state, job_status, run_pdm_stale_check

notifications_bp = Blueprint('notifications', __name__)


def get_models():
    """Lazy import to avoid circular imports (same pattern as robot_assembly.py)."""
    from app import db, Notification
    return db, Notification


def _serialize(n):
    payload = None
    if n.payload:
        try:
            payload = json.loads(n.payload)
        except Exception:
            payload = None
    return {
        'id': n.id,
        'type': n.type,
        'title': n.title,
        'message': n.message,
        'link': n.link,
        'payload': payload,
        'is_read': bool(n.is_read),
        'created_at': n.created_at.isoformat() if n.created_at else None,
    }


@notifications_bp.route('/api/notifications', methods=['GET'])
@login_required
def list_notifications():
    db, Notification = get_models()
    try:
        limit = min(request.args.get('limit', 50, type=int), 200)
        before_id = request.args.get('before_id', type=int)

        query = Notification.query.filter_by(user_id=current_user.id)
        if before_id:
            query = query.filter(Notification.id < before_id)
        rows = query.order_by(Notification.id.desc()).limit(limit + 1).all()

        has_more = len(rows) > limit
        return jsonify({
            'success': True,
            'notifications': [_serialize(n) for n in rows[:limit]],
            'has_more': has_more,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notifications_bp.route('/api/notifications/unread-count', methods=['GET'])
@login_required
def unread_count():
    db, Notification = get_models()
    try:
        count = Notification.query.filter_by(user_id=current_user.id, is_read=False).count()
        return jsonify({'success': True, 'unread': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notifications_bp.route('/api/notifications/<int:notif_id>/read', methods=['POST'])
@login_required
def mark_read(notif_id):
    db, Notification = get_models()
    try:
        n = Notification.query.filter_by(id=notif_id, user_id=current_user.id).first()
        if not n:
            return jsonify({'success': False, 'error': 'Notification not found'}), 404
        if not n.is_read:
            n.is_read = True
            db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@notifications_bp.route('/api/notifications/read-all', methods=['POST'])
@login_required
def mark_all_read():
    db, Notification = get_models()
    try:
        marked = Notification.query.filter_by(
            user_id=current_user.id, is_read=False
        ).update({'is_read': True}, synchronize_session=False)
        db.session.commit()
        return jsonify({'success': True, 'marked': marked})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@notifications_bp.route('/api/notifications/<int:notif_id>', methods=['DELETE'])
@login_required
def delete_notification(notif_id):
    db, Notification = get_models()
    try:
        n = Notification.query.filter_by(id=notif_id, user_id=current_user.id).first()
        if not n:
            return jsonify({'success': False, 'error': 'Notification not found'}), 404
        db.session.delete(n)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@notifications_bp.route('/api/poll/updates', methods=['GET'])
@login_required
def poll_updates():
    """Cheap cursor poll hit by every open tab every ~10 s.

    Extensibility contract: future live events are added as new keys under
    'channels'; clients ignore unknown channels and compare each channel's
    cursor/version by inequality (values may reset on server restart).
    """
    db, Notification = get_models()
    try:
        max_id = (db.session.query(func.max(Notification.id))
                  .filter(Notification.user_id == current_user.id).scalar())
        unread = Notification.query.filter_by(user_id=current_user.id, is_read=False).count()
        return jsonify({
            'success': True,
            'channels': {
                'notifications': {'cursor': max_id or 0, 'unread': int(unread or 0)},
                'bom_staleness': {'version': stale_state['version']},
                **{ch: {'version': v} for ch, v in live_versions.items() if ch != 'activity'},
                'activity': {'version': live_versions['activity'], 'imports': get_active_imports()},
            },
            'server_time': datetime.utcnow().isoformat() + 'Z',
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notifications_bp.route('/api/admin/pdm-stale-check/run', methods=['POST'])
@login_required
@admin_required
def run_stale_check_now():
    from app import db
    if job_status['running']:
        return jsonify({'success': False, 'error': 'PDM stale check is already running'}), 409

    app_obj = current_app._get_current_object()
    thread = threading.Thread(
        target=run_pdm_stale_check,
        args=(app_obj, db),
        kwargs={'triggered_by': current_user.username},
        daemon=True,
    )
    thread.start()

    from utils.logger import log_action
    log_action('PDM_STALE_CHECK_MANUAL', current_user, 'Manual PDM stale check triggered')
    return jsonify({'success': True, 'started': True})


@notifications_bp.route('/api/admin/pdm-stale-check/status', methods=['GET'])
@login_required
@admin_required
def stale_check_status():
    from pdm_config import pdm_config
    return jsonify({
        'success': True,
        'running': job_status['running'],
        'last_run': job_status['last_run'],
        'config': {
            'enabled': pdm_config.is_enabled(),
            'stale_check_enabled': pdm_config.is_stale_check_enabled(),
            'use_native_extractor': pdm_config.is_native_extractor_enabled(),
        },
    })
