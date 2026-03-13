import logging
import random
from datetime import datetime, timedelta, timezone
import time
from typing import Dict, List, Optional, Tuple

from python.runners.multi_account.compat import compat as compat_module


def process_account(runner, account) -> bool:
    compat = compat_module()
    profile_name = account.username
    profile_data = _load_profile_data(runner, profile_name)
    allowed, message_targets = _preflight_account(runner, account, profile_data)
    if not allowed:
        return False
    compat.log(f'Запуск браузера для @{profile_name}...')
    compat.emit_event('profile_started', profile=profile_name)
    try:
        _mark_profile_running(runner, profile_name, profile_data)
        return _run_account_session(runner, account, profile_data, message_targets)
    except Exception as exc:
        return _handle_account_exception(runner, profile_name, exc)


def _load_profile_data(runner, profile_name: str) -> Optional[Dict[str, object]]:
    profile_data = runner._get_cached_profile(profile_name)
    if profile_data:
        return profile_data
    try:
        profile_data = runner.profiles_client.get_profile_by_name(profile_name)
    except Exception:
        return None
    if profile_data:
        runner._set_cached_profile(profile_name, profile_data)
    return profile_data


def _preflight_account(
    runner,
    account,
    profile_data: Optional[Dict[str, object]],
) -> Tuple[bool, Optional[List[Dict[str, object]]]]:
    compat = compat_module()
    profile_name = account.username
    try:
        if _is_busy_profile(runner, profile_data):
            compat.log(f'Пропуск @{profile_name}: профиль занят.')
            return False, None
        if _is_reopen_cooldown_active(runner, profile_data):
            cooldown_min = int(getattr(runner.config, 'profile_reopen_cooldown_minutes', 30) or 0)
            compat.log(f'Пропуск @{profile_name}: недавно открыт (<{cooldown_min} мин).')
            return False, None
        message_targets = _message_targets_if_only_messages(runner, profile_name, profile_data)
        if message_targets == []:
            return False, None
        return True, message_targets
    except Exception as exc:
        compat.log(f'Ошибка проверки сессий для @{profile_name}: {exc}')
        return False, None


def _is_busy_profile(runner, profile_data: Optional[Dict[str, object]]) -> bool:
    if not profile_data or not profile_data.get('profile_id'):
        return False
    return bool(runner.accounts_client.is_profile_busy(profile_data.get('profile_id')))


def _is_reopen_cooldown_active(runner, profile_data: Optional[Dict[str, object]]) -> bool:
    if not profile_data or not profile_data.get('last_opened_at'):
        return False
    if not getattr(runner.config, 'profile_reopen_cooldown_enabled', True):
        return False
    cooldown_min = int(getattr(runner.config, 'profile_reopen_cooldown_minutes', 30) or 0)
    if cooldown_min <= 0:
        return False
    last_dt = _parse_last_opened_at(profile_data.get('last_opened_at'))
    if last_dt is None:
        return False
    now = datetime.now(timezone.utc)
    return now - last_dt < timedelta(minutes=cooldown_min)


def _parse_last_opened_at(value) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    if not parsed.tzinfo:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _message_targets_if_only_messages(runner, profile_name: str, profile_data: Optional[Dict[str, object]]):
    compat = compat_module()
    enabled_map = compat.get_action_enabled_map(runner.config)
    only_messages = enabled_map.get('Send Messages', False) and sum(1 for enabled in enabled_map.values() if enabled) == 1
    if not only_messages:
        return None
    profile_id = profile_data.get('profile_id') if profile_data else None
    if not profile_id:
        compat.log(f'@{profile_name}: профиль не найден в БД, пропуск запуска браузера.')
        return []
    targets = runner.accounts_client.get_accounts_to_message(profile_id)
    if not targets:
        compat.log(f'@{profile_name}: нет целей для сообщений (message=true), не открываю браузер.')
        return []
    return targets


def _mark_profile_running(runner, profile_name: str, profile_data: Optional[Dict[str, object]]) -> None:
    logger = getattr(runner, 'logger', None) or logging.getLogger(__name__)
    try:
        runner.profiles_client.sync_profile_status(profile_name, 'running', True)
    except Exception as exc:
        logger.exception(
            "Failed runner.profiles_client.sync_profile_status(%r, 'running', True): %s",
            profile_name,
            exc,
        )
    if not profile_data:
        return
    try:
        profile_data['last_opened_at'] = datetime.now(timezone.utc).isoformat()
    except Exception as exc:
        logger.exception(
            "Failed updating profile_data['last_opened_at'] with datetime.now(timezone.utc).isoformat() for %r: %s",
            profile_name,
            exc,
        )


def _run_account_session(
    runner,
    account,
    profile_data: Optional[Dict[str, object]],
    message_targets: Optional[List[Dict[str, object]]],
) -> bool:
    compat = compat_module()
    with compat.create_browser_context(
        account.username,
        account.proxy,
        _user_agent(profile_data),
        headless=runner.config.headless,
    ) as (_context, page):
        _run_enabled_actions(runner, page, account, profile_data, message_targets)
        if runner.running:
            compat.log(f'Все задачи завершены для @{account.username}')
            compat.emit_event('profile_completed', profile=account.username, status='success')
        else:
            compat.emit_event('profile_completed', profile=account.username, status='success')
        _sync_profile_idle(runner, account.username)
        return True


def _user_agent(profile_data: Optional[Dict[str, object]]) -> Optional[str]:
    if not profile_data:
        return None
    try:
        return str(profile_data.get('user_agent')) if profile_data.get('user_agent') else None
    except Exception:
        return None


def _run_enabled_actions(runner, page, account, profile_data, message_targets) -> None:
    compat = compat_module()
    actions_map = {
        'Feed Scroll': lambda: runner._run_scrolling(page, mode='feed'),
        'Reels Scroll': lambda: runner._run_scrolling(page, mode='reels'),
        'Watch Stories': lambda: runner._run_stories(page),
        'Follow': lambda: runner._run_follow(page, account, profile_data),
        'Unfollow': lambda: runner._run_unfollow_only(page, account, profile_data),
        'Approve Requests': lambda: runner._run_approve_only(page, account),
        'Send Messages': lambda: runner._run_message_only(page, account, profile_data, message_targets),
    }
    enabled_map = compat.get_action_enabled_map(runner.config)
    for action_name in compat.build_action_order(runner.config):
        if not runner.running:
            break
        if action_name not in actions_map or not enabled_map.get(action_name, False):
            continue
        compat.emit_event('task_started', profile=account.username, task=action_name)
        actions_map[action_name]()
        if runner.running:
            time.sleep(random.randint(3, 7))


def _handle_account_exception(runner, profile_name: str, exc: Exception) -> bool:
    compat = compat_module()
    if not runner.running:
        compat.emit_event('profile_completed', profile=profile_name, status='cancelled')
        _sync_profile_idle(runner, profile_name)
        return False
    if 'Target page, context or browser has been closed' in str(exc):
        compat.emit_event('profile_completed', profile=profile_name, status='cancelled')
        compat.log(f'Остановлено @{profile_name}')
        _sync_profile_idle(runner, profile_name)
        return False
    compat.emit_event('profile_completed', profile=profile_name, status='failed')
    compat.log(f'Ошибка @{profile_name}: {exc}')
    _sync_profile_idle(runner, profile_name)
    return False


def _sync_profile_idle(runner, profile_name: str) -> None:
    logger = getattr(runner, 'logger', None) or logging.getLogger(__name__)
    for attempt in range(2):
        try:
            runner.profiles_client.sync_profile_status(profile_name, 'idle', False)
            return
        except Exception as exc:
            if attempt == 0:
                logger.exception(
                    "Failed runner.profiles_client.sync_profile_status(%r, 'idle', False); retrying once: %s",
                    profile_name,
                    exc,
                )
                continue
            logger.error(
                "Failed runner.profiles_client.sync_profile_status(%r, 'idle', False) after retry; profile state may remain inconsistent: %s",
                profile_name,
                exc,
                exc_info=True,
            )
