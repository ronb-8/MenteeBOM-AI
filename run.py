#!/usr/bin/env python3
"""
MenteeBOM Web Application Startup Script
"""

import os
import sys
import subprocess
import signal
import atexit
import argparse
import shutil
from pathlib import Path

def check_python_version():
    """Check if Python version is compatible"""
    if sys.version_info < (3, 8):
        print("❌ Error: Python 3.8 or higher is required")
        print(f"Current version: {sys.version}")
        sys.exit(1)
    print(f"✅ Python version: {sys.version.split()[0]}")

def check_dependencies():
    """Check if required dependencies are installed"""
    try:
        import flask
        import flask_sqlalchemy
        import flask_login
        print("✅ All required dependencies are installed")
        return True
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("Please run: pip install -r requirements.txt")
        return False
    except AssertionError as e:
        if "SQLCoreOperations" in str(e):
            print("⚠️  SQLAlchemy compatibility issue detected with Python 3.13")
            print("   This is a known issue. Trying to fix...")
            try:
                subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "sqlalchemy", "flask-sqlalchemy"], check=True)
                print("✅ Updated SQLAlchemy packages")
                return True
            except subprocess.CalledProcessError:
                print("❌ Failed to update SQLAlchemy packages")
                print("Please manually run: pip install --upgrade sqlalchemy flask-sqlalchemy")
                return False
        else:
            print(f"❌ AssertionError: {e}")
            return False

def create_virtual_environment():
    """Create virtual environment if it doesn't exist"""
    venv_path = Path("venv")
    if not venv_path.exists():
        print("📦 Creating virtual environment...")
        subprocess.run([sys.executable, "-m", "venv", "venv"])
        print("✅ Virtual environment created")
        return True
    return False

def activate_virtual_environment():
    """Activate virtual environment"""
    if os.name == 'nt':  # Windows
        activate_script = "venv\\Scripts\\activate"
    else:  # Unix/Linux/macOS
        activate_script = "venv/bin/activate"
    
    if os.path.exists(activate_script):
        print("🔧 Activating virtual environment...")
        if os.name == 'nt':
            os.system(f"call {activate_script}")
        else:
            os.system(f"source {activate_script}")
        return True
    return False

def install_dependencies():
    """Install dependencies if requirements.txt exists"""
    if Path("requirements.txt").exists():
        print("📦 Installing dependencies...")
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✅ Dependencies installed")
        return True
    return False

def signal_handler(sig, frame):
    print('\n🛑 Shutdown signal received...')
    print('👋 Shutting down MenteeBOM Web Application gracefully...')
    print('✅ Application stopped successfully')
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
signal.signal(signal.SIGTERM, signal_handler)  # Termination signal

def build_react(skip_build=False):
    """Build React frontend (optional)"""
    if skip_build:
        print("\n⏭️  Skipping React build (use --build-react to enable)")
        return False

    frontend_path = Path("frontend")
    if not frontend_path.exists():
        print("⚠️  Frontend directory not found. Skipping React build.")
        return False

    # Check if dist already exists
    dist_path = frontend_path / "dist"
    if dist_path.exists() and any(dist_path.iterdir()):
        print("\n✅ React frontend already built (dist folder exists)")
        print("   Use --force-build to rebuild")
        return True

    print("\n📦 Building React frontend...")
    print("   This may take a few minutes...")
    try:
        # Check if node_modules exists
        if not (frontend_path / "node_modules").exists():
            print("📥 Installing npm dependencies (this will take a while)...")
            result = subprocess.run(
                ["npm", "install"],
                cwd=str(frontend_path),
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            if result.returncode != 0:
                print(f"⚠️  npm install failed")
                print(f"   Error: {result.stderr[:200]}")  # Show first 200 chars
                print("   You can build manually: cd frontend && npm install && npm run build")
                return False

        # Build React app
        result = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(frontend_path),
            capture_output=True,
            text=True,
            timeout=180  # 3 minute timeout
        )
        if result.returncode == 0:
            print("✅ React frontend built successfully")
            return True
        else:
            print(f"⚠️  React build failed")
            print(f"   Error: {result.stderr[:200]}")  # Show first 200 chars
            print("   You can build manually: cd frontend && npm run build")
            return False
    except subprocess.TimeoutExpired:
        print("⚠️  Build timed out. The build is taking longer than expected.")
        print("   You can build manually: cd frontend && npm install && npm run build")
        return False
    except FileNotFoundError:
        print("⚠️  npm not found. Please install Node.js to build React frontend.")
        print("   Or build manually and the server will use the dist folder.")
        return False
    except Exception as e:
        print(f"⚠️  Error building React: {str(e)[:100]}")
        print("   You can build manually: cd frontend && npm run build")
        return False

def check_port_80():
    """Check if we can bind to port 80 (requires admin on Windows)"""
    import socket
    try:
        # Try to bind to port 80
        test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        test_socket.bind(('0.0.0.0', 80))
        test_socket.close()
        return True
    except OSError:
        return False

def main():
    """Main startup function"""
    # Parse command-line arguments
    parser = argparse.ArgumentParser(description='MenteeBOM Web Application Startup Script')
    parser.add_argument('--port', type=int, help='Port number to run the Flask application on')
    parser.add_argument('--dev', action='store_true', help='Run in development mode (port 5000, separate database)')
    parser.add_argument('--stockwise-test', action='store_true',
                        help='Serve the StockWise test snapshot DB (port 5001, read-only integration testing)')
    args = parser.parse_args()

    # StockWise test environment: serves the production snapshot created by
    # scripts/refresh_stockwise_testdb.py. Mutually exclusive with --dev.
    if args.stockwise_test:
        if args.dev:
            print("❌ Error: --stockwise-test and --dev are mutually exclusive.")
            sys.exit(1)
        test_db = Path("instance") / "menteebom_stockwise_test.db"
        if not test_db.exists():
            print("❌ Error: StockWise test database not found.")
            print("   Create it first with: python scripts/refresh_stockwise_testdb.py")
            sys.exit(1)
        os.environ['DATABASE_URI'] = 'sqlite:///menteebom_stockwise_test.db'
        if not args.port:
            args.port = 5001
        print("=" * 50)
        print("  STOCKWISE TEST MODE")
        print("=" * 50)
        print(f"🗄️  Database: instance/menteebom_stockwise_test.db (production snapshot)")
        print(f"🔌 Port: {args.port}")
        print("=" * 50)

    # Dev mode setup
    is_dev = args.dev
    if is_dev:
        print("=" * 50)
        print("  DEV MODE")
        print("=" * 50)

        # Set dev database - copy production DB on first run
        instance_dir = Path("instance")
        dev_db = instance_dir / "menteebom_dev.db"
        prod_db = instance_dir / "menteebom.db"

        if not dev_db.exists() and prod_db.exists():
            print("📋 Copying production database to dev database...")
            shutil.copy2(str(prod_db), str(dev_db))
            print("✅ Dev database created from production copy")

        os.environ['DATABASE_URI'] = 'sqlite:///menteebom_dev.db'

        # Default dev port to 5000 unless --port is specified
        if not args.port:
            args.port = 5000

        print(f"🗄️  Database: instance/menteebom_dev.db")
        print(f"🔌 Port: {args.port}")
        print("")
        print("💡 For frontend hot reload, also run in another terminal:")
        print("   cd frontend && npm run dev")
        print("   Then open http://localhost:3000")
        print("=" * 50)
    else:
        print("🚀 Starting MenteeBOM Web Application...")
        print("=" * 50)
    
    # Check Python version
    check_python_version()
    
    # Check if we're in the right directory
    if not Path("app.py").exists():
        print("❌ Error: app.py not found. Please run this script from the MenteeBOM-Web directory.")
        sys.exit(1)
    
    # Check dependencies (only install if missing)
    if not check_dependencies():
        print("\n📦 Some dependencies are missing. Installing...")
        if not install_dependencies():
            print("❌ Failed to install dependencies")
            sys.exit(1)
        # Re-check after installation
        if not check_dependencies():
            print("❌ Dependencies still missing after installation")
            sys.exit(1)
    else:
        print("✅ All dependencies are already installed")

    # Build React frontend (skip by default, build manually for better control)
    # Uncomment the next line to enable automatic building:
    # build_react()
    print("\n📝 Note: React frontend build is skipped by default")
    print("   To build manually: cd frontend && npm install && npm run build")
    
    # Determine port: command-line argument > environment variable > default behavior
    port = None
    if args.port:
        port = args.port
        print(f"\n🔧 Using port from command-line argument: {port}")
    elif os.environ.get('FLASK_PORT'):
        try:
            port = int(os.environ.get('FLASK_PORT'))
            print(f"\n🔧 Using port from FLASK_PORT environment variable: {port}")
        except ValueError:
            print(f"\n⚠️  Invalid FLASK_PORT environment variable: {os.environ.get('FLASK_PORT')}")
            print("   Falling back to default port selection")
    
    # Default port selection if not specified
    if port is None:
        # Check port 80 availability
        port = 80
        if not check_port_80():
            print("\n⚠️  Cannot bind to port 80 (requires administrator privileges on Windows)")
            print("   Falling back to port 5000")
            port = 5000
        else:
            print(f"\n✅ Port {port} is available")
    
    # Set the port as an environment variable for app.py to use
    os.environ['FLASK_PORT'] = str(port)
    
    print("\n🌐 Starting Flask application...")
    print(f"📱 The application will be available at: http://localhost:{port}")
    print("=" * 50)
    
    # Initialize database and create admin user
    print("\n🗄️  Initializing database...")
    try:
        from app import app, db, User
        app.config['IS_DEV'] = is_dev
        print(f"🗄️  Using database: {app.config['SQLALCHEMY_DATABASE_URI']}")
        from werkzeug.security import generate_password_hash
        
        with app.app_context():
            db.create_all()
            
            # Migration: Add version column to bom_instance if it doesn't exist
            try:
                from sqlalchemy import inspect, text
                inspector = inspect(db.engine)
                existing_columns = [col['name'] for col in inspector.get_columns('bom_instance')]
                
                if 'version' not in existing_columns:
                    print("🔄 Adding missing 'version' column to bom_instance table...")
                    db.session.execute(text("ALTER TABLE bom_instance ADD COLUMN version VARCHAR(50)"))
                    db.session.execute(text("UPDATE bom_instance SET version = 'v1' WHERE version IS NULL"))
                    db.session.commit()
                    print("✅ Successfully added 'version' column to bom_instance table")
            except Exception as e:
                print(f"⚠️  Warning: Could not add version column: {e}")
                db.session.rollback()

            # Migration: Add phone column to user table if it doesn't exist
            try:
                from sqlalchemy import inspect as sa_inspect
                insp = sa_inspect(db.engine)
                user_columns = [col['name'] for col in insp.get_columns('user')]

                if 'phone' not in user_columns:
                    print("🔄 Adding 'phone' column to user table...")
                    db.session.execute(text("ALTER TABLE user ADD COLUMN phone VARCHAR(30)"))
                    db.session.commit()
                    print("✅ Successfully added 'phone' column to user table")
            except Exception as e:
                print(f"⚠️  Warning: Could not add phone column: {e}")
                db.session.rollback()

            # Migration: Add contact_name column to vendor_list if it doesn't exist
            try:
                vendor_columns = [col['name'] for col in insp.get_columns('vendor_list')]

                if 'contact_name' not in vendor_columns:
                    print("🔄 Adding 'contact_name' column to vendor_list table...")
                    db.session.execute(text("ALTER TABLE vendor_list ADD COLUMN contact_name VARCHAR(200)"))
                    db.session.commit()
                    print("✅ Successfully added 'contact_name' column to vendor_list table")
            except Exception as e:
                print(f"⚠️  Warning: Could not add contact_name column: {e}")
                db.session.rollback()

            # Migration: Add PDM staleness columns to bom_instance if they don't exist
            try:
                insp = sa_inspect(db.engine)
                bom_columns = [col['name'] for col in insp.get_columns('bom_instance')]

                if 'pdm_stale' not in bom_columns:
                    print("🔄 Adding 'pdm_stale' column to bom_instance table...")
                    db.session.execute(text("ALTER TABLE bom_instance ADD COLUMN pdm_stale BOOLEAN DEFAULT 0"))
                if 'pdm_stale_details' not in bom_columns:
                    print("🔄 Adding 'pdm_stale_details' column to bom_instance table...")
                    db.session.execute(text("ALTER TABLE bom_instance ADD COLUMN pdm_stale_details TEXT"))
                if 'last_pdm_check' not in bom_columns:
                    print("🔄 Adding 'last_pdm_check' column to bom_instance table...")
                    db.session.execute(text("ALTER TABLE bom_instance ADD COLUMN last_pdm_check DATETIME"))
                db.session.commit()
            except Exception as e:
                print(f"⚠️  Warning: Could not add PDM staleness columns: {e}")
                db.session.rollback()

            # No default admin is seeded any more (it used to be admin/admin123).
            if not User.query.filter_by(role='admin').first():
                print("⚠️  No admin user found. Create one with: python scripts\\create_admin.py")
            else:
                print("✅ Admin user exists")
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        sys.exit(1)

    # Start background scheduler for daily backups
    try:
        from utils.scheduler import start_scheduler
        start_scheduler(app, db)
        print("✅ Background scheduler started for daily backups (scheduled for 2:00 AM daily)")
    except Exception as e:
        print(f"⚠️  Warning: Could not start background scheduler: {e}")

    # Start the Flask application
    try:
        # Debug (Werkzeug interactive debugger = remote code execution) must be
        # opt-in via env — never on by default on a 0.0.0.0 bind
        debug_mode = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes')
        app.run(debug=debug_mode, host='0.0.0.0', port=port, use_reloader=False)
    except KeyboardInterrupt:
        print("\n🛑 Keyboard interrupt received...")
        print("👋 Shutting down MenteeBOM Web Application...")
        print("✅ Application stopped successfully")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error starting application: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
