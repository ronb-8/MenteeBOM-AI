#!/usr/bin/env python3
"""
Reset the database to a clean state (drops ALL tables) and create a fresh admin user.

The admin password is asked for interactively; nothing with a default password is created.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts'))

from create_admin import create_admin, prompt_password  # noqa: E402

from app import app, db  # noqa: E402


def reset_database():
    """Reset the database to a clean state"""
    with app.app_context():
        print("Resetting database...")

        print("   Dropping all tables...")
        db.drop_all()

        print("   Creating all tables...")
        db.create_all()

        print("   Creating admin user...")
        username = input("   Admin username [admin]: ").strip() or 'admin'
        create_admin(username, prompt_password("   Admin password"))

        print("Database reset complete!")
        print("   - All tables dropped and recreated")
        print(f"   - Admin user '{username}' created")
        print("   - Ready for fresh imports")


if __name__ == "__main__":
    reset_database()
