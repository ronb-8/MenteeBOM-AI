#!/usr/bin/env python3
"""
MenteeBOM Frontend Development Server Startup Script
"""

import os
import sys
import subprocess
import signal
from pathlib import Path

def signal_handler(sig, frame):
    print('\n🛑 Shutdown signal received...')
    print('👋 Shutting down frontend development server gracefully...')
    print('✅ Frontend server stopped successfully')
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
signal.signal(signal.SIGTERM, signal_handler)  # Termination signal

def check_node_installed():
    """Check if Node.js and npm are installed"""
    # On Windows, we need shell=True to access PATH properly from virtual environments
    use_shell = (os.name == 'nt')
    
    try:
        node_result = subprocess.run(
            "node --version" if use_shell else ["node", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            shell=use_shell
        )
        npm_result = subprocess.run(
            "npm --version" if use_shell else ["npm", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            shell=use_shell
        )
        
        if node_result.returncode == 0 and npm_result.returncode == 0:
            node_version = node_result.stdout.strip()
            npm_version = npm_result.stdout.strip()
            print(f"✅ Node.js version: {node_version}")
            print(f"✅ npm version: {npm_version}")
            return True
        else:
            print("❌ Node.js or npm not found")
            print(f"   Node result: {node_result.stderr}")
            print(f"   npm result: {npm_result.stderr}")
            return False
    except FileNotFoundError:
        print("❌ Node.js or npm not found. Please install Node.js from https://nodejs.org/")
        return False
    except Exception as e:
        print(f"❌ Error checking Node.js installation: {e}")
        return False

def check_dependencies():
    """Check if node_modules exists"""
    frontend_path = Path("frontend")
    node_modules = frontend_path / "node_modules"
    
    if node_modules.exists():
        print("✅ npm dependencies are installed")
        return True
    else:
        print("⚠️  node_modules not found")
        return False

def install_dependencies():
    """Install npm dependencies"""
    frontend_path = Path("frontend")
    use_shell = (os.name == 'nt')
    
    print("\n📦 Installing npm dependencies...")
    print("   This may take a few minutes...")
    
    try:
        result = subprocess.run(
            "npm install" if use_shell else ["npm", "install"],
            cwd=str(frontend_path),
            timeout=300,  # 5 minute timeout
            shell=use_shell
        )
        
        if result.returncode == 0:
            print("✅ npm dependencies installed successfully")
            return True
        else:
            print("❌ Failed to install npm dependencies")
            return False
    except subprocess.TimeoutExpired:
        print("⚠️  Installation timed out. The installation is taking longer than expected.")
        print("   You can install manually: cd frontend && npm install")
        return False
    except Exception as e:
        print(f"❌ Error installing dependencies: {e}")
        return False

def start_dev_server():
    """Start the Vite development server"""
    frontend_path = Path("frontend")
    use_shell = (os.name == 'nt')
    
    print("\n🌐 Starting Vite development server...")
    print("📱 The frontend will be available at: http://localhost:3000")
    print("   (Configured in vite.config.js)")
    print("=" * 50)
    print("\n💡 Press Ctrl+C to stop the server\n")
    
    try:
        # Run npm run dev and stream output in real-time
        process = subprocess.Popen(
            "npm run dev" if use_shell else ["npm", "run", "dev"],
            cwd=str(frontend_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
            shell=use_shell
        )
        
        # Stream output line by line
        for line in process.stdout:
            print(line, end='')
        
        process.wait()
        
        if process.returncode != 0:
            print("\n❌ Development server exited with an error")
            return False
        
        return True
        
    except KeyboardInterrupt:
        print("\n🛑 Keyboard interrupt received...")
        print("👋 Shutting down frontend development server...")
        process.terminate()
        process.wait()
        print("✅ Frontend server stopped successfully")
        return True
    except Exception as e:
        print(f"\n❌ Error starting development server: {e}")
        return False

def main():
    """Main startup function"""
    print("🚀 Starting MenteeBOM Frontend Development Server...")
    print("=" * 50)
    
    # Check if we're in the right directory
    if not Path("frontend").exists():
        print("❌ Error: frontend directory not found.")
        print("   Please run this script from the MenteeBOM-Web directory.")
        sys.exit(1)
    
    if not Path("frontend/package.json").exists():
        print("❌ Error: package.json not found in frontend directory.")
        sys.exit(1)
    
    # Check Node.js installation
    if not check_node_installed():
        print("\n❌ Node.js is required to run the frontend development server")
        print("   Please install Node.js from: https://nodejs.org/")
        sys.exit(1)
    
    # Check and install dependencies if needed
    if not check_dependencies():
        print("\n📦 npm dependencies are missing. Installing...")
        if not install_dependencies():
            print("\n❌ Failed to install dependencies")
            print("   Please try manually: cd frontend && npm install")
            sys.exit(1)
    
    # Start the development server
    print("\n" + "=" * 50)
    if not start_dev_server():
        sys.exit(1)

if __name__ == "__main__":
    main()
