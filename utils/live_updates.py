"""
In-memory version counters for the browser live-update poll channel
(/api/poll/updates). Single-process server (see run.py) — module state is safe.

Channels are bumped automatically by SQLAlchemy session listeners in app.py
whenever a row of a mapped model group changes, regardless of which endpoint
did it. Counters are seeded from the wall clock so a server restart looks like
a change and clients do one harmless refetch. Clients compare versions by
inequality, never by ordering.
"""
import threading
import time
from datetime import datetime

_seed = int(time.time())

versions = {
    'purchases': _seed,  # RFQ / RFQItem / PO / POItem
    'boms': _seed,       # BOMInstance / BOMPart / DissolvedBOM
    'parts': _seed,      # Part
    'activity': _seed,   # running PDM import/update registry (below)
}


def bump(channel):
    versions[channel] = versions.get(channel, _seed) + 1


# ── Running PDM import/update registry ──────────────────────────────────────
# One import/update per assembly at a time, across all users. Entries expire
# after IMPORT_ACTIVITY_TTL as a safety net in case a request thread dies
# without reaching the teardown handler.

IMPORT_ACTIVITY_TTL = 40 * 60  # seconds; > the 25-min exporter timeout

_activity_lock = threading.Lock()
_active_imports = {}  # normalized part number -> entry dict


def _normalize_key(part_number):
    return (part_number or '').strip().upper()


def _prune_locked():
    now = time.monotonic()
    for key in [k for k, e in _active_imports.items()
                if now - e['_started_mono'] > IMPORT_ACTIVITY_TTL]:
        del _active_imports[key]


def try_start_import(part_number, username, kind):
    """Register a running import. Returns (True, None) on success or
    (False, existing_entry) if this assembly is already being imported."""
    key = _normalize_key(part_number)
    if not key:
        return True, None  # no identifiable assembly — don't block
    with _activity_lock:
        _prune_locked()
        existing = _active_imports.get(key)
        if existing:
            return False, dict(existing)
        _active_imports[key] = {
            'part_number': (part_number or '').strip(),
            'username': username,
            'kind': kind,  # 'import' | 'update'
            'started_at': datetime.utcnow().isoformat() + 'Z',
            '_started_mono': time.monotonic(),
        }
    bump('activity')
    return True, None


def end_import(part_number):
    key = _normalize_key(part_number)
    with _activity_lock:
        removed = _active_imports.pop(key, None) is not None
    if removed:
        bump('activity')


def get_active_imports():
    with _activity_lock:
        _prune_locked()
        return [{k: v for k, v in e.items() if not k.startswith('_')}
                for e in _active_imports.values()]
