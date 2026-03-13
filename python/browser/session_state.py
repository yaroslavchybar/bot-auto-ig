import logging
from typing import Any, Callable, Optional

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


def _stored_profile_payload(profile: dict[str, Any] | None) -> tuple[list[dict], str]:
    if not isinstance(profile, dict):
        return [], ''
    raw_cookies = profile.get('cookies_json')
    if raw_cookies is None:
        raw_cookies = profile.get('cookiesJson')
    try:
        cookies = normalize_profile_cookies(raw_cookies, drop_invalid=True)
    except Exception:
        cookies = []
    session_id = str(profile.get('session_id') or profile.get('sessionId') or '').strip()
    return cookies, session_id


def _stored_profile_is_empty(profile: dict[str, Any] | None) -> bool:
    cookies, session_id = _stored_profile_payload(profile)
    return not cookies and not session_id


def _should_skip_session_write(
    cookies: list[dict],
    session_id: str,
    previous_profile: dict[str, Any] | None,
    *,
    explicit_logout: bool,
) -> bool:
    if explicit_logout or session_id:
        return False
    if previous_profile is None:
        return True
    _, previous_session_id = _stored_profile_payload(previous_profile)
    if previous_session_id:
        return True
    if not cookies and not _stored_profile_is_empty(previous_profile):
        return True
    return False


def sync_profile_session_state(
    context,
    profile_name: str,
    log: Optional[Callable] = None,
    *,
    explicit_logout: bool = False,
) -> bool:
    try:
        cookies = normalize_profile_cookies(context.cookies(), drop_invalid=True)
        session_id = extract_instagram_session_id(cookies)
        from python.database.profiles import ProfilesClient

        client = ProfilesClient()
        previous_profile = client.get_profile_by_name(profile_name)
        if _should_skip_session_write(
            cookies,
            session_id or '',
            previous_profile,
            explicit_logout=explicit_logout,
        ):
            if log:
                log('Skipped saving browser session state because no authenticated Instagram session was available')
            else:
                logger.info(
                    'Skipped saving browser session state for %s because no authenticated Instagram session was available',
                    profile_name,
                )
            return True

        client.update_profile_by_name(
            profile_name,
            {
                'name': profile_name,
                'cookiesJson': canonical_cookies_json(cookies) if cookies else '',
                'sessionId': session_id or '',
            },
        )
        if log:
            if explicit_logout and not cookies and not session_id:
                log('Cleared browser session state from database')
            else:
                log('Saved browser cookies and Instagram sessionid to database' if session_id else 'Saved browser cookies to database')
        return True
    except Exception as exc:
        if log:
            log(f'Failed saving browser cookies: {exc}')
        else:
            logger.warning('Failed saving browser cookies for %s: %s', profile_name, exc)
        return False
