"""Standalone test for mrp_ledger_api (does not import app.py). Run:  python -m pytest tests/test_mrp_ledger_api.py"""
import os
import sys
from datetime import datetime

import pytest
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from mrp_ledger_api import ENV_KEY, HEADER, create_ledger_blueprint  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
    db = SQLAlchemy(app)

    class InventoryTransaction(db.Model):
        __tablename__ = "inventory_transaction"
        id = db.Column(db.Integer, primary_key=True)
        part_number = db.Column(db.String(100), nullable=False)
        revision = db.Column(db.String(20))
        qty_before = db.Column(db.Float)
        qty_after = db.Column(db.Float)
        qty_change = db.Column(db.Float, nullable=False)
        reason = db.Column(db.String(100), nullable=False)
        reference = db.Column(db.String(200))
        username = db.Column(db.String(100))
        created_at = db.Column(db.DateTime, default=datetime.utcnow)

        def to_dict(self):
            return {"id": self.id, "part_number": self.part_number, "revision": self.revision, "qty_before": self.qty_before,
                    "qty_after": self.qty_after, "qty_change": self.qty_change, "reason": self.reason, "reference": self.reference,
                    "username": self.username, "created_at": self.created_at.isoformat() if self.created_at else None}

    app.register_blueprint(create_ledger_blueprint(lambda: (db, InventoryTransaction)))
    with app.app_context():
        db.create_all()
        for i in range(1, 8):
            db.session.add(InventoryTransaction(part_number=f"034-MP-0{i:04d}", qty_before=10, qty_after=10 - i, qty_change=-i,
                                                reason="picking", reference=f"2-105-00{i}", username="floor1"))
        db.session.commit()
    monkeypatch.setenv(ENV_KEY, "k-secret")
    return app.test_client()


def test_auth(client, monkeypatch):
    assert client.get("/api/mrp/inventory-transactions").status_code == 401
    assert client.get("/api/mrp/inventory-transactions", headers={HEADER: "wrong"}).status_code == 401
    monkeypatch.delenv(ENV_KEY)
    assert client.get("/api/mrp/inventory-transactions", headers={HEADER: "k-secret"}).status_code == 503


def test_cursor_paging(client):
    h = {HEADER: "k-secret"}
    r = client.get("/api/mrp/inventory-transactions?limit=3", headers=h).get_json()
    assert r["success"] and [t["id"] for t in r["transactions"]] == [1, 2, 3] and r["has_more"] and r["next_since_id"] == 3
    r = client.get(f"/api/mrp/inventory-transactions?since_id={r['next_since_id']}&limit=3", headers=h).get_json()
    assert [t["id"] for t in r["transactions"]] == [4, 5, 6] and r["has_more"]
    r = client.get(f"/api/mrp/inventory-transactions?since_id={r['next_since_id']}&limit=3", headers=h).get_json()
    assert [t["id"] for t in r["transactions"]] == [7] and not r["has_more"] and r["next_since_id"] == 7
    r = client.get("/api/mrp/inventory-transactions?since_id=7", headers=h).get_json()
    assert r["transactions"] == [] and r["next_since_id"] == 7
    assert r is not None and client.get("/api/mrp/inventory-transactions?limit=0", headers=h).status_code == 400
    assert client.get("/api/mrp/inventory-transactions?since_id=x", headers=h).status_code == 400


def test_row_shape(client):
    t = client.get("/api/mrp/inventory-transactions?limit=1", headers={HEADER: "k-secret"}).get_json()["transactions"][0]
    assert set(t) == {"id", "part_number", "revision", "qty_before", "qty_after", "qty_change", "reason", "reference", "username", "created_at"}
    assert t["qty_change"] == -1 and t["reason"] == "picking" and t["reference"] == "2-105-001"
