import json
import signal
import sys
from typing import Any, Dict, List, Optional

from python.core.config import PROJECT_URL
from python.core.logging import setup_logging
from python.core.models import ThreadsAccount
from python.core.sentry import flush_sentry, init_sentry, set_sentry_context
from python.core.clients import MessageTemplatesClient
from python.runners.multi_account.config import _build_config
from python.runners.multi_account.io import emit_event, log
from python.runners.multi_account.profiles import _fetch_profiles_for_lists
from python.runners.multi_account.runtime import InstagramAutomationRunner


def main() -> int:
    setup_logging()
    init_sentry()
    try:
        return _main_inner()
    finally:
        flush_sentry()


def _main_inner() -> int:
    payload = _read_payload()
    if payload is None:
        return 2
    settings = _settings_payload(payload)
    if settings is None:
        return 2
    selected_list_ids = _selected_list_ids(payload, settings)
    _log_debug_context(selected_list_ids)
    if not _has_enabled_activity(settings):
        log('Select at least one activity type!')
        return 2
    profiles = _load_profiles(selected_list_ids)
    if profiles is None:
        return 2
    target_accounts = _build_target_accounts(profiles)
    if target_accounts is None:
        return 2
    config = _build_config(settings, _message_texts(settings))
    set_sentry_context(
        extra={'profile_count': len(target_accounts), 'tasks': _task_names(config)},
    )
    log(f"Starting full cycle ({', '.join(_task_names(config))}) for {len(target_accounts)} profiles...")
    runner = InstagramAutomationRunner(config, target_accounts)
    _register_signal_handlers(runner)
    return runner.run()


def _read_payload() -> Optional[Dict[str, Any]]:
    raw = sys.stdin.read()
    if not raw.strip():
        log('No input data received.')
        return None
    try:
        payload = json.loads(raw)
    except Exception as exc:
        log(f'Invalid JSON: {exc}')
        return None
    if isinstance(payload, dict):
        return payload
    log('payload must be an object.')
    return None


def _settings_payload(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    settings = payload.get('settings')
    if isinstance(settings, dict):
        return settings
    log('settings must be an object.')
    return None


def _selected_list_ids(payload: Dict[str, Any], settings: Dict[str, Any]) -> List[str]:
    selected = settings.get('source_list_ids') or payload.get('source_list_ids') or []
    if not isinstance(selected, list):
        return []
    return [str(item) for item in selected if str(item).strip()]


def _log_debug_context(selected_list_ids: List[str]) -> None:
    log(f'DEBUG: PROJECT_URL={PROJECT_URL}')
    log(f'DEBUG: selected_list_ids={selected_list_ids}')


def _has_enabled_activity(settings: Dict[str, Any]) -> bool:
    return any(
        [
            bool(settings.get('enable_feed')),
            bool(settings.get('enable_reels')),
            bool(settings.get('watch_stories')),
            bool(settings.get('enable_follow')),
            bool(settings.get('do_unfollow')),
            bool(settings.get('do_approve')),
            bool(settings.get('do_message')),
        ]
    )


def _load_profiles(selected_list_ids: List[str]):
    if not selected_list_ids:
        log('Please select a profile list!')
        return None
    profiles = _fetch_profiles_for_lists(selected_list_ids)
    log(f'DEBUG: fetched profiles count={len(profiles or [])}')
    if profiles:
        return profiles
    log('No profiles found in the selected list!')
    return None


def _build_target_accounts(profiles: List[Dict[str, Any]]):
    target_accounts = []
    for profile in profiles:
        name = profile.get('name')
        if not name:
            continue
        target_accounts.append(ThreadsAccount(username=name, password='', proxy=profile.get('proxy')))
    if target_accounts:
        return target_accounts
    log('No valid profiles found in the selected list!')
    return None


def _message_texts(settings: Dict[str, Any]) -> List[str]:
    if not bool(settings.get('do_message')):
        return []
    try:
        return MessageTemplatesClient().get_texts('message') or []
    except Exception:
        return []


def _task_names(config) -> List[str]:
    task_pairs = [
        (config.enable_feed, 'Feed'),
        (config.enable_reels, 'Reels'),
        (config.watch_stories, 'Stories'),
        (config.enable_follow, 'Follow'),
        (config.enable_unfollow, 'Unfollow'),
        (config.enable_approve, 'Approve'),
        (config.enable_message, 'Message'),
    ]
    return [label for enabled, label in task_pairs if enabled]


def _register_signal_handlers(runner) -> None:
    def _handle_signal(_sig, _frame):
        runner.stop()

    if hasattr(signal, 'SIGINT'):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, 'SIGTERM'):
        signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, _handle_signal)
