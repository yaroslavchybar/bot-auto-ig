import signal
import sys
from typing import Any, Dict, List, Optional

from python.runners.multi_account.compat import compat as compat_module


def main() -> int:
    compat = compat_module()
    payload = _read_payload(compat)
    if payload is None:
        return 2
    settings = _settings_payload(compat, payload)
    if settings is None:
        return 2
    selected_list_ids = _selected_list_ids(payload, settings)
    _log_debug_context(compat, selected_list_ids)
    if not _has_enabled_activity(settings):
        compat.log('Выберите хотя бы один тип активности!')
        return 2
    profiles = _load_profiles(compat, selected_list_ids)
    if profiles is None:
        return 2
    target_accounts = _build_target_accounts(compat, profiles)
    if target_accounts is None:
        return 2
    config = compat._build_config(settings, _message_texts(compat, settings))
    compat.log(f"Запуск полного цикла ({', '.join(_task_names(config))}) для {len(target_accounts)} профилей...")
    runner = compat.InstagramAutomationRunner(config, target_accounts)
    _register_signal_handlers(runner)
    return runner.run()


def _read_payload(compat) -> Optional[Dict[str, Any]]:
    raw = sys.stdin.read()
    if not raw.strip():
        compat.log('Не получены входные данные.')
        return None
    try:
        payload = compat.json.loads(raw)
    except Exception as exc:
        compat.log(f'Некорректный JSON: {exc}')
        return None
    if isinstance(payload, dict):
        return payload
    compat.log('payload должен быть объектом.')
    return None


def _settings_payload(compat, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    settings = payload.get('settings')
    if isinstance(settings, dict):
        return settings
    compat.log('settings должен быть объектом.')
    return None


def _selected_list_ids(payload: Dict[str, Any], settings: Dict[str, Any]) -> List[str]:
    selected = settings.get('source_list_ids') or payload.get('source_list_ids') or []
    if not isinstance(selected, list):
        return []
    return [str(item) for item in selected if str(item).strip()]


def _log_debug_context(compat, selected_list_ids: List[str]) -> None:
    compat.log(f'DEBUG: PROJECT_URL={compat.PROJECT_URL}')
    compat.log(f'DEBUG: selected_list_ids={selected_list_ids}')


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


def _load_profiles(compat, selected_list_ids: List[str]):
    if not selected_list_ids:
        compat.log('Выберите список профилей!')
        return None
    profiles = compat._fetch_profiles_for_lists(selected_list_ids)
    compat.log(f'DEBUG: fetched profiles count={len(profiles)}')
    if profiles:
        return profiles
    compat.log('В выбранном списке нет профилей!')
    return None


def _build_target_accounts(compat, profiles: List[Dict[str, Any]]):
    target_accounts = []
    for profile in profiles:
        name = profile.get('name')
        if not name:
            continue
        target_accounts.append(compat.ThreadsAccount(username=name, password='', proxy=profile.get('proxy')))
    if target_accounts:
        return target_accounts
    compat.log('В выбранном списке нет валидных профилей!')
    return None


def _message_texts(compat, settings: Dict[str, Any]) -> List[str]:
    if not bool(settings.get('do_message')):
        return []
    try:
        return compat.MessageTemplatesClient().get_texts('message') or []
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
