#!/usr/bin/env python3
"""
AI Web Dev Backend - Python Test Script
Tests all server endpoints and verifies functionality
"""

import subprocess
import time
import sys
import json
import requests
from pathlib import Path

class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    NC = '\033[0m'

def print_step(step, total, message):
    print(f"{Colors.YELLOW}[{step}/{total}]{Colors.NC} {message}")

def print_success(message):
    print(f"{Colors.GREEN}✓ {message}{Colors.NC}")

def print_error(message):
    print(f"{Colors.RED}✗ {message}{Colors.NC}")

def run_tests():
    print("🧪 Starting AI Web Dev Backend Test Suite")
    print("=" * 50)

    total_steps = 5

    # Step 1: Check Node.js
    print_step(1, total_steps, "Checking Node.js installation...")
    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True)
        print_success(f"Node.js {result.stdout.strip()} found")
    except FileNotFoundError:
        print_error("Node.js not found")
        sys.exit(1)

    # Step 2: Check dependencies
    print_step(2, total_steps, "Checking dependencies...")
    project_dir = Path(__file__).parent
    node_modules = project_dir / 'node_modules'

    if not node_modules.exists():
        print_error("node_modules not found, installing...")
        subprocess.run(['npm', 'install'], cwd=project_dir)
    print_success("Dependencies ready")

    # Step 3: Check environment
    print_step(3, total_steps, "Checking environment configuration...")
    env_file = project_dir / '.env'
    if not env_file.exists():
        print_error(".env file not found")
        sys.exit(1)

    env_content = env_file.read_text()
    if 'GEMINI_API_KEY' not in env_content:
        print_error("GEMINI_API_KEY not found in .env")
        sys.exit(1)
    print_success(".env file configured")

    # Step 4: Start server
    print_step(4, total_steps, "Starting Node.js server...")
    server_process = subprocess.Popen(
        ['node', 'server.js'],
        cwd=project_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    time.sleep(3)  # Wait for server to start

    if server_process.poll() is not None:
        stderr = server_process.stderr.read().decode()
        print_error(f"Server failed to start:\n{stderr}")
        sys.exit(1)
    print_success(f"Server started (PID: {server_process.pid})")

    # Step 5: Run tests
    print_step(5, total_steps, "Running endpoint tests...")

    try:
        # Test 1: Health check
        print("\n📌 Testing GET /")
        response = requests.get('http://localhost:5000/', timeout=5)
        if response.status_code == 200:
            data = response.json()
            if 'message' in data:
                print_success("Health check passed")
                print(f"   Response: {json.dumps(data, indent=2)}")
            else:
                print_error("Unexpected response format")
        else:
            print_error(f"HTTP {response.status_code}")

        # Test 2: Generate endpoint
        print("\n📌 Testing POST /generate")
        payload = {"prompt": "Create a simple landing page with a hero section"}
        response = requests.post(
            'http://localhost:5000/generate',
            json=payload,
            timeout=60
        )

        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                print_success("Generate endpoint successful")
                print(f"   Files created: {data.get('filesCreated', 0)}")
                if 'files' in data:
                    print("   Generated files:")
                    for file in data['files']:
                        print(f"     - {file}")

                # Check workspace
                workspace = project_dir / 'workspace'
                if workspace.exists():
                    files = list(workspace.rglob('*'))
                    file_count = len([f for f in files if f.is_file()])
                    print_success(f"Workspace directory contains {file_count} file(s)")
            else:
                error_msg = data.get('error', 'Unknown error')
                print_error(f"Generation failed: {error_msg}")
        else:
            print_error(f"HTTP {response.status_code}")
            print(f"   Response: {response.text[:200]}")

    except requests.exceptions.ConnectionError:
        print_error("Could not connect to server on localhost:5000")
    except Exception as e:
        print_error(f"Test error: {str(e)}")

    finally:
        # Cleanup
        print("\n🧹 Cleaning up...")
        server_process.terminate()
        try:
            server_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_process.kill()
        print_success("Server stopped")

    print(f"\n{Colors.GREEN}✅ Test suite completed!{Colors.NC}")

if __name__ == '__main__':
    run_tests()
