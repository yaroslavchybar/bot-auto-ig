import logging
from typing import Callable, Optional

from python.browser.cookies import (
    canonical_cookies_json,
    extract_instagram_session_id,
    normalize_profile_cookies,
)


logger = logging.getLogger(__name__)


def _load_profile_cookies(profile_name: str) -> list[dict]:
    try:
        from python.database.profiles import ProfilesClient

        profile = ProfilesClient().get_profile_by_name(profile_name) or {}
        raw = profile.get('cookies_json')
        if raw is None:
            raw = profile.get('cookiesJson')
        return normalize_profile_cookies(raw, drop_invalid=True)
    except Exception as exc:
        logger.warning('Failed to load profile cookies for %s: %s', profile_name, exc)
        return []


def _preload_profile_cookies(context, profile_name: str) -> int:
    cookies = _load_profile_cookies(profile_name)
    if not cookies:
        return 0
    context.add_cookies(cookies)
    return len(cookies)


def sync_profile_session_state(
    context,
    profile_name: str,
    log: Optional[Callable] = None,
) -> bool:
    try:
        cookies = normalize_profile_cookies(context.cookies(), drop_invalid=True)
        session_id = extract_instagram_session_id(cookies)
        from python.database.profiles import ProfilesClient

        ProfilesClient().update_profile_by_name(
            profile_name,
            {
                'name': profile_name,
                'cookiesJson': canonical_cookies_json(cookies) if cookies else '',
                'sessionId': session_id or '',
            },
        )
        if log:
            log('Saved browser cookies and Instagram sessionid to database' if session_id else 'Saved browser cookies to database')
        return True
    except Exception as exc:
        if log:
            log(f'Failed saving browser cookies: {exc}')
        else:
            logger.warning('Failed saving browser cookies for %s: %s', profile_name, exc)
        return False
