#!/usr/bin/env python3
"""
Initialize the database (create all tables) and create the first admin user.

No default passwords are seeded any more: the admin password is asked for interactively
(or read from stdin with --password-stdin) via scripts/create_admin.py.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts'))

from create_admin import create_admin, prompt_password  # noqa: E402

from app import app, db, User  # noqa: E402


def init_database():
    """Create all tables and make sure an admin user exists."""
    with app.app_context():
        db.create_all()
        print("✅ Database tables created successfully!")

        if User.query.filter_by(role='admin').first():
            print("ℹ️  An admin user already exists")
        else:
            username = input("Admin username [admin]: ").strip() or 'admin'
            if '--password-stdin' in sys.argv:
                password = sys.stdin.readline().rstrip('\r\n')
            else:
                password = prompt_password("Admin password")
            create_admin(username, password)

        print("\n🎉 Database initialization completed!")
        print("You can now start the application with: python run.py")


if __name__ == '__main__':
    init_database()
