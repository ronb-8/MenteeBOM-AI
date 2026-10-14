"""Viewer (read-only) role: a 'viewer' user can log in and read, but every non-GET request is
rejected with 403 by app.block_viewer_writes(). Imports the real app.py against a throwaway
SQLite database. Run:  python -m pytest tests/test_viewer_role.py
"""
import os
import sys
import tempfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# app.py reads DATABASE_URI at import time, so point it at a scratch file *before* importing.
_tmp = tempfile.NamedTemporaryFile(prefix="menteebom_viewer_test_", suffix=".db", delete=False)
_tmp.close()
os.environ["DATABASE_URI"] = "sqlite:///" + _tmp.name.replace("\\", "/")
os.chdir(ROOT)

from werkzeug.security import generate_password_hash  # noqa: E402

import app as menteebom  # noqa: E402
from permissions import ROLE_PERMISSIONS, get_role_hierarchy  # noqa: E402

PW = "pw-test"


@pytest.fixture(scope="module")
def flask_app():
    a = menteebom.app
    a.config["TESTING"] = True
    with a.app_context():
        menteebom.db.create_all()
        for name, role in (("viewer1", "viewer"), ("eng1", "engineer")):
            menteebom.db.session.add(menteebom.User(username=name, email=f"{name}@test.local",
                                                    password_hash=generate_password_hash(PW), role=role))
        menteebom.db.session.commit()
    yield a
    with a.app_context():
        menteebom.db.session.remove()
        menteebom.db.drop_all()


def _login(client, username):
    r = client.post("/login", data={"username": username, "password": PW}, headers={"Accept": "application/json"})
    assert r.status_code == 200 and r.get_json()["success"], r.data
    return r.get_json()["user"]["role"]


def test_role_tables_know_viewer(flask_app):
    assert set(ROLE_PERMISSIONS["viewer"]) == {"bom_view", "purchases_view"}
    assert get_role_hierarchy()["viewer"] <= get_role_hierarchy()["floor"]
    with flask_app.app_context():
        u = menteebom.User.query.filter_by(username="viewer1").one()
        assert u.has_permission("bom_view") and u.is_read_only()
        for p in ("po_receive", "bom_edit", "bom_export", "rfq_create", "po_create", "bom_import", "admin_panel"):
            assert not u.has_permission(p), p
        assert not (u.can_edit_bom() or u.can_import_bom() or u.can_export_bom() or u.can_create_rfq_po()
                    or u.can_delete_bom() or u.can_access_admin())


def test_viewer_can_login_and_read(flask_app):
    c = flask_app.test_client()
    assert _login(c, "viewer1") == "viewer"
    r = c.get("/api/parts/search?q=abc")
    assert r.status_code == 200, r.data
    r = c.get("/api/parts/lookup?part_number=nope")
    assert r.status_code != 403


def test_viewer_writes_are_blocked(flask_app):
    c = flask_app.test_client()
    _login(c, "viewer1")
    checks = [
        ("post", "/api/parts/create", {"part_number": "X-1", "revision": "00"}),
        ("put", "/api/part/1/update", {"part_name": "hacked"}),
        ("post", "/api/parts/refresh-from-pdm", {}),
        ("delete", "/api/parts/db-revisions/1", None),
        ("post", "/api/users", {"username": "evil", "email": "e@x", "password": "p", "role": "admin"}),
    ]
    for method, url, body in checks:
        r = getattr(c, method)(url, json=body) if body is not None else getattr(c, method)(url)
        assert r.status_code == 403, (method, url, r.status_code, r.data[:200])
        assert r.get_json() == {"success": False, "error": "Read-only account: this action is not permitted"}
    # non-API (HTML) POST gets a plain 403 too
    r = c.post("/dashboard", data={"x": "1"})
    assert r.status_code == 403
    # ...but logout still works
    r = c.get("/logout", headers={"Accept": "application/json"})
    assert r.status_code == 200 and r.get_json()["success"]


def test_hook_is_a_noop_for_other_roles(flask_app):
    c = flask_app.test_client()
    _login(c, "eng1")
    r = c.put("/api/part/999999/update", json={"part_name": "x"})
    assert r.status_code != 403  # engineer reaches the view (404/400/etc.), the hook doesn't fire
    # and for anonymous users the hook stays out of the way of @login_required
    anon = flask_app.test_client()
    r = anon.post("/api/parts/create", json={})
    assert r.status_code in (302, 401)
