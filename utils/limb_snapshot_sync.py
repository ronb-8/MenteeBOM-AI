"""
Limb assembly snapshot auto re-sync sweep.

Each limb's LimbAssemblySnapshot is pinned to the BOMInstance version it was
built from. When a newer version of that BOM is imported, the snapshot (and
the stage definitions / dissolves that hang off it) must be remapped —
otherwise picking lists keep coming from the old BOM and MenteeFlow keeps
stale stage definitions.

Re-sync also happens on read (tree open, MenteeFlow stage-definition pull,
process creation — see robot_assembly._ensure_snapshot_fresh). This sweep
covers limbs nobody has opened since the import, so MenteeFlow receives the
limb-stages-changed webhook within a few minutes regardless.

Cheap when nothing changed: one BOMInstance lookup per limb.
"""
import json
import threading
import time
import traceback
from datetime import datetime

from utils.logger import get_logger, log_action

# Status of the last/current run (mirrors utils.pdm_stale_check.job_status).
job_status = {'running': False, 'last_run': None}

_job_lock = threading.Lock()

NOTIFY_ROLES = ('admin', 'engineer')


def _notify_deactivated_stages(db, User, Notification, limb, summary):
    """Tell admins/engineers that a re-sync deactivated configured stages
    (their assembly is no longer in the BOM). One notification per user per
    limb+BOM version."""
    labels = summary['deactivated_stage_labels']
    dedupe_key = f"limb_resync:{limb.id}:{summary['new_bom_version']}"
    recipients = User.query.filter(
        User.role.in_(list(NOTIFY_ROLES)), User.is_active == True  # noqa: E712
    ).all()

    created = 0
    for user in recipients:
        exists = Notification.query.filter_by(
            user_id=user.id, dedupe_key=dedupe_key, is_read=False
        ).first()
        if exists:
            continue
        db.session.add(Notification(
            user_id=user.id,
            type='limb_resync',
            title=f'{limb.name}: stages deactivated after BOM re-sync',
            message=(
                f"BOM {summary['old_bom_version']} → {summary['new_bom_version']}: "
                f"{', '.join(labels)} no longer in the BOM. Re-configure stages if needed."
            ),
            link='/admin',
            payload=json.dumps({'limb_id': limb.id, **summary}),
            dedupe_key=dedupe_key,
        ))
        created += 1
    db.session.commit()
    return created


def run_limb_snapshot_sync(app, db, triggered_by='scheduler'):
    """Entry point for the scheduler (or a manual shell call)."""
    logger = get_logger()

    if not _job_lock.acquire(blocking=False):
        logger.warning('Limb snapshot sync already running — skipping this trigger')
        return {'skipped': 'already running'}

    started = time.monotonic()
    run_info = {
        'started_at': datetime.utcnow().isoformat(),
        'finished_at': None,
        'triggered_by': triggered_by,
        'checked_limbs': 0,
        'resynced': [],
        'new_notifications': 0,
        'errors': 0,
        'error': None,
    }
    job_status['running'] = True

    try:
        with app.app_context():
            from app import RobotLimb, LimbAssemblySnapshot, User, Notification
            from robot_assembly import get_models, _ensure_snapshot_fresh

            m = get_models()
            for snapshot in LimbAssemblySnapshot.query.all():
                limb = RobotLimb.query.get(snapshot.limb_id)
                if not limb or not limb.is_active:
                    continue
                run_info['checked_limbs'] += 1

                try:
                    summary = _ensure_snapshot_fresh(limb.id, m, trigger='sweep')
                except Exception:
                    run_info['errors'] += 1
                    db.session.rollback()
                    logger.error('Limb snapshot sync: %s failed\n%s', limb.name, traceback.format_exc())
                    continue
                if not summary:
                    continue

                run_info['resynced'].append({
                    'limb_id': limb.id,
                    'limb_name': limb.name,
                    'old_bom_version': summary['old_bom_version'],
                    'new_bom_version': summary['new_bom_version'],
                    'added': len(summary['added']),
                    'removed': len(summary['removed']),
                    'deactivated_stage_labels': summary['deactivated_stage_labels'],
                })
                if summary['deactivated_stage_labels']:
                    try:
                        run_info['new_notifications'] += _notify_deactivated_stages(
                            db, User, Notification, limb, summary
                        )
                    except Exception:
                        db.session.rollback()
                        logger.warning('Limb snapshot sync: notification failed for %s\n%s',
                                       limb.name, traceback.format_exc())

            if run_info['resynced']:
                elapsed = int(time.monotonic() - started)
                names = ', '.join(r['limb_name'] for r in run_info['resynced'])
                summary_line = (f"re-synced {len(run_info['resynced'])} of {run_info['checked_limbs']} "
                                f"limb snapshot(s): {names}; "
                                f"{run_info['new_notifications']} notification(s), {elapsed}s")
                log_action('LIMB_SNAPSHOT_SYNC', {'username': 'system', 'role': 'system'}, summary_line)
                logger.info('Limb snapshot sync: %s', summary_line)
            return run_info

    except Exception as e:
        run_info['error'] = str(e)
        logger.error('Limb snapshot sync failed: %s\n%s', e, traceback.format_exc())
        return run_info
    finally:
        run_info['finished_at'] = datetime.utcnow().isoformat()
        job_status['last_run'] = run_info
        job_status['running'] = False
        _job_lock.release()
