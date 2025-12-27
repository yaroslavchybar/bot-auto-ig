import argparse
import sys
import os
import io

# Force UTF-8 encoding for stdin/stdout on Windows to avoid issues with non-ASCII characters
if sys.platform == "win32":
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from automation.login.session import login_session

def log(msg):
    print(msg)
    sys.stdout.flush()

def main():
    parser = argparse.ArgumentParser(description="Instagram Login Automation")
    parser.add_argument("--profile", required=True, help="Profile name")
    parser.add_argument("--username", required=True, help="Instagram username")
    parser.add_argument("--password", required=True, help="Instagram password")
    parser.add_argument("--proxy", default=None, help="Proxy string")
    parser.add_argument("--2fa-secret", dest="two_factor_secret", default=None, help="2FA Secret Key")
    parser.add_argument("--headless", action="store_true", help="Headless mode")
    
    args = parser.parse_args()
    
    login_session(
        profile_name=args.profile,
        proxy_string=args.proxy,
        username=args.username,
        password=args.password,
        two_factor_secret=args.two_factor_secret,
        log=log,
        headless=args.headless
    )

if __name__ == "__main__":
    main()
