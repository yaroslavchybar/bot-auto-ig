import argparse
import json
import sys
import traceback

from python.database.profiles import ProfilesClient

from python.actions.login.runtime import (
    ALT_SELECTORS,
    PRIMARY_SELECTORS,
    _click_login_button,
    _find_login_inputs,
    _has_authenticated_instagram_session,
    login_session,
)


def _log_stdout(message: str) -> None:
    print(message, flush=True)


def _read_credentials_from_stdin() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError('Missing credentials payload on stdin')
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f'Invalid credentials JSON: {exc}') from exc
    if not isinstance(data, dict):
        raise ValueError('Credentials payload must be a JSON object')
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description='Run Instagram login session for a profile')
    parser.add_argument('--profile', required=True, help='Profile name from database')
    parser.add_argument('--headless', action='store_true', help='Run browser in headless mode')
    args = parser.parse_args()
    try:
        creds = _read_credentials_from_stdin()
        username = str(creds.get('username') or '').strip()
        password = str(creds.get('password') or '').strip()
        two_factor_secret = creds.get('two_factor_secret')
        if not username or not password:
            raise ValueError('username and password are required in credentials payload')
        profile = ProfilesClient().get_profile_by_name(args.profile)
        if not profile:
            raise ValueError(f'Profile not found: {args.profile}')
        success = login_session(
            profile_name=args.profile,
            proxy_string=str(profile.get('proxy') or '').strip() or None,
            username=username,
            password=password,
            log=_log_stdout,
            two_factor_secret=two_factor_secret,
            user_agent=str(profile.get('user_agent') or profile.get('userAgent') or '').strip() or None,
            headless=args.headless,
            fingerprint_seed=str(profile.get('fingerprint_seed') or profile.get('fingerprintSeed') or '').strip() or None,
            fingerprint_os=str(profile.get('fingerprint_os') or profile.get('fingerprintOs') or '').strip() or None,
        )
        return 0 if success else 1
    except Exception as exc:
        print(f'Login script error: {exc}', file=sys.stderr, flush=True)
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
