import argparse
import sys
import os
import io
import json
import signal

# Force UTF-8 encoding for stdin/stdout on Windows to avoid issues with non-ASCII characters
if sys.platform == "win32":
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python.automation.login.session import login_session

def log(msg):
    print(msg)
    sys.stdout.flush()

def main():
    parser = argparse.ArgumentParser(description="Instagram Login Automation")
    parser.add_argument("--profile", required=True, help="Profile name")
    parser.add_argument("--proxy", default=None, help="Proxy string")
    parser.add_argument("--headless", action="store_true", help="Headless mode")
    
    args = parser.parse_args()

    def _handle_signal(_sig, _frame):
        raise SystemExit(0)

    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle_signal)
    
    # Read credentials from stdin (security: not visible in process list)
    try:
        stdin_data = sys.stdin.read()
        creds = json.loads(stdin_data)
        username = creds.get('username')
        password = creds.get('password')
        two_factor_secret = creds.get('two_factor_secret')
        
        if not username or not password:
            log("ERROR: username and password are required in stdin JSON")
            return 1
    except json.JSONDecodeError as e:
        log(f"ERROR: Failed to parse credentials from stdin: {e}")
        return 1
    
    login_session(
        profile_name=args.profile,
        proxy_string=args.proxy,
        username=username,
        password=password,
        two_factor_secret=two_factor_secret,
        log=log,
        headless=args.headless
    )

if __name__ == "__main__":
    raise SystemExit(main() or 0)
