"""
Nightly PDM revision staleness check for MenteeBOM.

Detects BOMs whose parts (or root assembly) have a NEWER revision in the
SolidWorks PDM vault than what the BOM stores, flags them on BOMInstance
(pdm_stale / pdm_stale_details / last_pdm_check) and fans out Notification
rows to admin + engineer users.

Detection only — updating a BOM still goes through the existing
/api/pdm-update flow (which handles ECO input).

Requires the native COM extractor (pdm_settings.json: use_native_extractor)
and the stale_check_enabled flag — on machines without a PDM client the job
is a logged no-op.
"""
import hashlib
import json
import threading
import time
import traceback
from datetime import datetime, timedelta

from utils.logger import get_logger, log_action

# In-memory change counter polled by browsers via /api/poll/updates.
# Single-process server (see run.py) — module-level state is safe.
# Seeded from wall clock so a server restart looks like a change and
# clients do one harmless refetch.
stale_state = {'version': int(time.time())}

# Status of the last/current run, surfaced by the admin status endpoint.
job_status = {'running': False, 'last_run': None}

_job_lock = threading.Lock()

# How long ago a revision probe may run before we give up (seconds).
# Full prod sweeps measure ~40 min for ~1650 parts — keep generous headroom.
JOB_DEADLINE_SECONDS = 75 * 60

NOTIFY_ROLES = ('admin', 'engineer')


def bump_staleness_version():
    stale_state['version'] += 1


def _clean_rev_num(revision):
    """'REV05' / '05' / 5 -> 5; '00' -> 0 (checked — PDM may hold REV01+);
    non-numeric -> None (skipped, matches /api/parts/refresh-from-pdm)."""
    rev_clean = str(revision or '').replace('REV', '').replace('rev', '').strip()
    return int(rev_clean) if rev_clean.isdigit() else None


def _is_tracked_pn(part_number):
    pn = (part_number or '').upper()
    return '-MP-' in pn or '-AS-' in pn


def run_pdm_stale_check(app, db, triggered_by='scheduler'):
    """Entry point for the scheduler and the manual admin trigger."""
    logger = get_logger()

    from pdm_config import pdm_config
    if not (pdm_config.is_enabled()
            and pdm_config.is_stale_check_enabled()
            and pdm_config.is_native_extractor_enabled()):
        reason = 'PDM stale check skipped: requires enabled + stale_check_enabled + use_native_extractor'
        logger.info(reason)
        job_status['last_run'] = {
            'started_at': datetime.utcnow().isoformat(),
            'finished_at': datetime.utcnow().isoformat(),
            'triggered_by': triggered_by,
            'skipped_reason': reason,
        }
        return {'skipped': reason}

    if not _job_lock.acquire(blocking=False):
        logger.warning('PDM stale check already running — skipping this trigger')
        return {'skipped': 'already running'}

    started = time.monotonic()
    run_info = {
        'started_at': datetime.utcnow().isoformat(),
        'finished_at': None,
        'triggered_by': triggered_by,
        'checked_parts': 0,
        'stale_boms': 0,
        'new_notifications': 0,
        'lookup_errors': 0,
        'error': None,
        'skipped_reason': None,
    }
    job_status['running'] = True

    try:
        with app.app_context():
            from app import BOMInstance, BOMPart, Part, User, Notification, format_part_revision

            logger.info('PDM stale check starting (triggered by %s)...', triggered_by)

            # ── Collect phase ────────────────────────────────────────────
            boms = BOMInstance.query.filter_by(status='active', is_latest=True).all()
            unique = {}    # pn -> max rev_num known across all BOMs
            bom_entries = {}  # bom_id -> list of (pn, rev_num, rev_display, kind)

            for bom in boms:
                entries = []
                seen = set()

                root_pn = bom.assembly_part_number
                if _is_tracked_pn(root_pn):
                    root_num = _clean_rev_num(bom.assembly_revision)
                    if root_num is not None:
                        entries.append((root_pn, root_num, f'{root_num:02d}', 'root'))
                        seen.add((root_pn, root_num))

                rows = (db.session.query(Part.part_number, Part.revision)
                        .join(BOMPart, BOMPart.part_id == Part.id)
                        .filter(BOMPart.bom_id == bom.id).all())
                for pn, rev in rows:
                    if not _is_tracked_pn(pn):
                        continue
                    rev_num = _clean_rev_num(rev)
                    if rev_num is None or (pn, rev_num) in seen:
                        continue
                    seen.add((pn, rev_num))
                    entries.append((pn, rev_num, f'{rev_num:02d}', 'part'))

                if entries:
                    bom_entries[bom.id] = entries
                    for pn, rev_num, _, _ in entries:
                        unique[pn] = max(unique.get(pn, 0), rev_num)

            run_info['checked_parts'] = len(unique)
            logger.info('PDM stale check: %d active BOMs, %d unique parts to check',
                        len(boms), len(unique))

            # ── PDM phase (one COM login for the whole batch) ────────────
            probe_results = {}
            if unique:
                from pdm_native_extractor import find_newer_revisions_batch
                probe_results = find_newer_revisions_batch(
                    [{'part_number': pn, 'current_rev': rev} for pn, rev in unique.items()],
                    deadline=started + JOB_DEADLINE_SECONDS,
                )

            # Effective latest per pn. The DB max is a floor: a BOM holding
            # rev 03 is stale if another BOM already holds 05 even when the
            # PDM probe fails.
            effective_latest = {}
            unknown_pns = set()
            for pn, db_max in unique.items():
                res = probe_results.get(pn) or {'success': False, 'latest_revision': '', 'error': 'no result'}
                if res.get('success'):
                    # latest_revision is '' when no newer rev exists; _clean_rev_num
                    # returns None for that — treat as 0 so the DB floor wins
                    probe_num = _clean_rev_num(res.get('latest_revision')) or 0
                    effective_latest[pn] = max(probe_num, db_max)
                else:
                    run_info['lookup_errors'] += 1
                    unknown_pns.add(pn)
                    effective_latest[pn] = db_max  # only DB-floor evidence usable

            # ── Write phase (commit per BOM to release the SQLite lock) ──
            anything_changed = False
            notifications_created = 0
            recipients = User.query.filter(
                User.role.in_(list(NOTIFY_ROLES)), User.is_active == True  # noqa: E712
            ).all()

            for bom in boms:
                entries = bom_entries.get(bom.id, [])
                try:
                    old_details = json.loads(bom.pdm_stale_details) if bom.pdm_stale_details else []
                except Exception:
                    old_details = []
                old_by_pn = {d.get('part_number'): d for d in old_details}

                new_list = []
                for pn, rev_num, rev_display, kind in entries:
                    if pn in unknown_pns:
                        # PDM lookup failed — never clear, carry forward what we knew
                        if pn in old_by_pn and effective_latest[pn] <= rev_num:
                            new_list.append(old_by_pn[pn])
                            continue
                    latest = effective_latest.get(pn, rev_num)
                    if latest > rev_num:
                        latest_str = f'{latest:02d}'
                        eco_number = None
                        try:
                            newer_part = Part.query.filter_by(
                                part_number=pn,
                                revision=format_part_revision(latest_str)
                            ).first()
                            if newer_part and newer_part.eco_number:
                                eco_number = newer_part.eco_number
                        except Exception:
                            pass
                        new_list.append({
                            'part_number': pn,
                            'kind': kind,
                            'bom_revision': rev_display,
                            'pdm_revision': latest_str,
                            'eco_number': eco_number,
                        })

                new_stale = bool(new_list)
                new_details_json = json.dumps(new_list) if new_list else None
                if bool(bom.pdm_stale) != new_stale or (bom.pdm_stale_details or None) != new_details_json:
                    anything_changed = True
                bom.pdm_stale = new_stale
                bom.pdm_stale_details = new_details_json
                bom.last_pdm_check = datetime.utcnow()
                db.session.commit()

                if new_stale:
                    run_info['stale_boms'] += 1

                # Notify only on NEW staleness items (not re-alert every night)
                old_items = {(d.get('part_number'), d.get('pdm_revision')) for d in old_details}
                new_items = [d for d in new_list
                             if (d['part_number'], d['pdm_revision']) not in old_items]
                if not new_items or not recipients:
                    continue

                stale_sig = hashlib.sha1(
                    json.dumps(sorted((d['part_number'], d['pdm_revision']) for d in new_list)).encode()
                ).hexdigest()[:12]
                dedupe_key = f'pdm_stale:{bom.id}:{stale_sig}'

                lines = [f"{d['part_number']} {d['bom_revision']}→{d['pdm_revision']}"
                         for d in new_items[:5]]
                if len(new_items) > 5:
                    lines.append(f'and {len(new_items) - 5} more')
                if any(d.get('eco_number') for d in new_items):
                    lines.append('ECO already recorded for some parts — re-import may be all that is needed.')
                message = '; '.join(lines)
                payload = json.dumps({'bom_id': bom.id, 'items': new_items})

                for user in recipients:
                    exists = Notification.query.filter_by(
                        user_id=user.id, dedupe_key=dedupe_key, is_read=False
                    ).first()
                    if exists:
                        continue
                    db.session.add(Notification(
                        user_id=user.id,
                        type='pdm_stale',
                        title=f'PDM: newer revisions for {bom.assembly_part_number}',
                        message=message,
                        link=f'/assembly-bom?bom_id={bom.id}',
                        payload=payload,
                        dedupe_key=dedupe_key,
                    ))
                    notifications_created += 1
                db.session.commit()

            run_info['new_notifications'] = notifications_created
            if notifications_created:
                anything_changed = True

            # ── Cleanup old notifications ────────────────────────────────
            try:
                now = datetime.utcnow()
                deleted = Notification.query.filter(
                    db.or_(
                        db.and_(Notification.is_read == True,  # noqa: E712
                                Notification.created_at < now - timedelta(days=60)),
                        Notification.created_at < now - timedelta(days=180),
                    )
                ).delete(synchronize_session=False)
                db.session.commit()
                if deleted:
                    logger.info('PDM stale check: cleaned up %d old notification(s)', deleted)
            except Exception:
                db.session.rollback()
                logger.warning('PDM stale check: notification cleanup failed\n%s', traceback.format_exc())

            if anything_changed:
                bump_staleness_version()

            elapsed = int(time.monotonic() - started)
            summary = (f"checked {run_info['checked_parts']} parts across {len(boms)} BOMs, "
                       f"{run_info['stale_boms']} stale BOMs, "
                       f"{notifications_created} new notifications, "
                       f"{run_info['lookup_errors']} lookup errors, {elapsed}s")
            log_action('PDM_STALE_CHECK', {'username': 'system', 'role': 'system'}, summary)
            logger.info('PDM stale check finished: %s', summary)
            return run_info

    except Exception as e:
        run_info['error'] = str(e)
        logger.error('PDM stale check failed: %s\n%s', e, traceback.format_exc())
        return run_info
    finally:
        run_info['finished_at'] = datetime.utcnow().isoformat()
        job_status['last_run'] = run_info
        job_status['running'] = False
        _job_lock.release()
