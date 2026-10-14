"""Read-only feed of the inventory audit trail for the logistics/inventory system.

    GET /api/mrp/inventory-transactions?since_id=<n>&limit=<1..1000>
    Header: X-MenteeBOM-Read-Key: <value of env MENTEEBOM_LEDGER_READ_KEY>

Returns InventoryTransaction rows with id > since_id in ascending id order, so a poller can keep a
cursor and never miss or repeat a row. The row shape is InventoryTransaction.to_dict() unchanged.

Self-contained on purpose: it needs only the `db` and `InventoryTransaction` objects that app.py
already defines (looked up lazily to avoid an import cycle), one env var, and a two-line registration
in app.py. It does not touch the session auth, the MRP read-key allowlist, or any existing route, so
it applies on any branch that carries the inventory_transaction table.
"""
from __future__ import annotations

import hmac
import os
from typing import Callable

from flask import Blueprint, jsonify, request

ENV_KEY = "MENTEEBOM_LEDGER_READ_KEY"
HEADER = "X-MenteeBOM-Read-Key"
DEFAULT_LIMIT, MAX_LIMIT = 500, 1000


def _key_ok(given: str | None) -> tuple[bool, str]:
    expected = os.environ.get(ENV_KEY, "")
    if not expected:
        return False, f"{ENV_KEY} not configured"
    if not given or not hmac.compare_digest(given.encode(), expected.encode()):
        return False, "missing or invalid read key"
    return True, ""


def create_ledger_blueprint(get_db_and_model: Callable[[], tuple]) -> Blueprint:
    """`get_db_and_model` returns (db, InventoryTransaction) — called per request, so app.py can pass
    `lambda: (db, InventoryTransaction)` without import-order problems."""
    bp = Blueprint("mrp_ledger_api", __name__)

    @bp.route("/api/mrp/inventory-transactions", methods=["GET"])
    def inventory_transactions():
        ok, why = _key_ok(request.headers.get(HEADER))
        if not ok:
            return jsonify({"success": False, "error": why}), (503 if "not configured" in why else 401)
        try:
            since_id = int(request.args.get("since_id", 0))
            limit = int(request.args.get("limit", DEFAULT_LIMIT))
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "since_id and limit must be integers"}), 400
        if since_id < 0 or not (1 <= limit <= MAX_LIMIT):
            return jsonify({"success": False, "error": f"since_id >= 0 and 1 <= limit <= {MAX_LIMIT}"}), 400
        db, model = get_db_and_model()
        q = db.session.query(model).filter(model.id > since_id).order_by(model.id.asc())
        rows = q.limit(limit + 1).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        return jsonify({
            "success": True,
            "transactions": [r.to_dict() for r in rows],
            "count": len(rows),
            "next_since_id": rows[-1].id if rows else since_id,
            "has_more": has_more,
        })

    return bp
