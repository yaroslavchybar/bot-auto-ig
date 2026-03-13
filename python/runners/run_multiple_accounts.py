import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List

import requests


def _project_root() -> str:
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, '..', '..'))


sys.path.insert(0, _project_root())

from python.actions.browsing import scroll_feed, scroll_reels
from python.actions.engagement.approve.session import approve_follow_requests
from python.actions.engagement.follow.common import normalize_range
from python.actions.engagement.follow.session import follow_usernames
from python.actions.engagement.unfollow.session import unfollow_usernames
from python.actions.messaging.session import send_messages
from python.actions.stories import watch_stories
from python.core.config import PROJECT_URL, SECRET_KEY
from python.core.models import ScrollingConfig, ThreadsAccount
from python.core.utils import (
    apply_count_limit,
    build_action_order,
    create_browser_context,
    create_status_callback,
    get_action_enabled_map,
)
from python.database.accounts import InstagramAccountsClient
from python.database.messages import MessageTemplatesClient
from python.database.profiles import ProfilesClient
from python.runners.multi_account.config import _build_config
from python.runners.multi_account.entrypoint import main
from python.runners.multi_account.runtime import InstagramAutomationRunner


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _configure_stdio() -> None:
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    try:
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


_configure_stdio()

_log_stream_handler = logging.StreamHandler(sys.stdout)
_log_stream_handler.setFormatter(logging.Formatter('%(message)s'))

_logger = logging.getLogger('instagram_automation')
_logger.handlers.clear()
_logger.addHandler(_log_stream_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False


def log(message: str) -> None:
    msg = f'[{_now_iso()}] {message}'
    level = logging.INFO
    try:
        normalized = str(message).lstrip().lower()
        if normalized.startswith(('ошибка', 'error', 'exception')):
            level = logging.ERROR
    except Exception:
        level = logging.INFO
    _logger.log(level, msg)
    sys.stdout.flush()


def emit_event(event_type: str, **data: Any) -> None:
    event = {'type': event_type, 'ts': _now_iso(), **data}
    sys.stdout.write(f"__EVENT__{json.dumps(event)}__EVENT__\n")
    sys.stdout.flush()


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip().split()[0])
    except Exception:
        return default


def _parse_float(value: Any, default: float) -> float:
    try:
        return float(str(value).strip().split()[0])
    except Exception:
        return default


def _fetch_profiles_for_lists(list_ids: List[str]) -> List[Dict[str, Any]]:
    if not PROJECT_URL or not list_ids:
        return []
    try:
        clean_ids = [str(item).strip().replace('"', '') for item in list_ids if str(item).strip()]
        if not clean_ids:
            return []
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        if SECRET_KEY:
            headers['Authorization'] = f'Bearer {SECRET_KEY}'
        response = requests.post(
            f'{PROJECT_URL}/api/profiles/by-list-ids',
            json={'listIds': clean_ids},
            headers=headers,
            timeout=30,
        )
        payload = response.json() if 200 <= response.status_code < 300 else []
    except Exception:
        return []
    return _dedupe_profiles(payload)


def _dedupe_profiles(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    seen = set()
    unique: List[Dict[str, Any]] = []
    for profile in payload:
        if not isinstance(profile, dict):
            continue
        profile_id = profile.get('profile_id')
        if not profile_id or profile_id in seen:
            continue
        seen.add(profile_id)
        unique.append(profile)
    return unique


if __name__ == '__main__':
    raise SystemExit(main())
