#!/usr/bin/env python3
"""Create an admin user for a fresh MenteeBOM install.

The app no longer seeds default accounts (admin/admin123 and friends), so the first admin
is created with this script. Run it from the repo root with the app's Python:

    python scripts\\create_admin.py                       # prompts for the password
    python scripts\\create_admin.py --username ron --email ron@example.com
    echo <password> | python scripts\\create_admin.py --password-stdin   # non-interactive

Which database: the same rule as the app (DATABASE_URI env var, default instance/menteebom.db).
For the dev database:  set DATABASE_URI=sqlite:///menteebom_dev.db  before running.
"""
from __future__ import annotations

import argparse
import getpass
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# app.py prints emoji at import/exit; keep that from crashing on a cp1252 console or a pipe.
for _stream in (sys.stdout, sys.stderr):
    if _stream and hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

MIN_PASSWORD_LENGTH = 10


def prompt_password(prompt: str = "Password") -> str:
    while True:
        first = getpass.getpass(f"{prompt} (min {MIN_PASSWORD_LENGTH} chars): ")
        if len(first) < MIN_PASSWORD_LENGTH:
            print(f"Too short - use at least {MIN_PASSWORD_LENGTH} characters.")
            continue
        if first != getpass.getpass("Repeat password: "):
            print("Passwords do not match, try again.")
            continue
        return first


def create_admin(username: str, password: str, email: str | None = None) -> bool:
    """Create (or refuse to duplicate) an active admin user. Returns True when created."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    from werkzeug.security import generate_password_hash

    from app import User, app, db

    with app.app_context():
        db.create_all()
        if User.query.filter_by(username=username).first():
            print(f"User '{username}' already exists - nothing changed.")
            return False
        user = User(
            username=username,
            email=email or f"{username}@menteebom.com",
            password_hash=generate_password_hash(password),
            role="admin",
            is_active=True,
        )
        db.session.add(user)
        db.session.commit()
        print(f"Admin user '{username}' created in {app.config['SQLALCHEMY_DATABASE_URI']}")
        return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--username", default="admin")
    ap.add_argument("--email", default=None, help="default <username>@menteebom.com")
    ap.add_argument("--password-stdin", action="store_true", help="read the password from stdin instead of prompting")
    a = ap.parse_args()
    if a.password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
        if len(password) < MIN_PASSWORD_LENGTH:
            print(f"password must be at least {MIN_PASSWORD_LENGTH} characters", file=sys.stderr)
            return 1
    else:
        password = prompt_password()
    created = create_admin(a.username, password, a.email)
    return 0 if created else 1


if __name__ == "__main__":
    if os.environ.get("DATABASE_URI"):
        print(f"Using DATABASE_URI={os.environ['DATABASE_URI']}")
    sys.exit(main())
