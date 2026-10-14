# Inventory audit-trail read API (for the logistics/inventory system)

`GET /api/mrp/inventory-transactions?since_id=<n>&limit=<1..1000>` with header
`X-MenteeBOM-Read-Key: <MENTEEBOM_LEDGER_READ_KEY>`.

Returns `inventory_transaction` rows with `id > since_id`, ascending, at most `limit` rows, plus
`next_since_id` and `has_more` so the caller keeps a cursor. Row shape = `InventoryTransaction.to_dict()`.

Setup on the production PC: add `MENTEEBOM_LEDGER_READ_KEY=<long random value>` to `.env` (the same value
goes into the logistics system's Kubernetes secret) and restart the app. Without the variable the endpoint
answers 503 and nothing else changes.

Implementation: `mrp_ledger_api.py` (self-contained blueprint, constant-time key compare) registered from
`app.py` with two lines. Tests: `python -m pytest tests/test_mrp_ledger_api.py` (needs only Flask,
Flask-SQLAlchemy, pytest; does not import app.py).
