import random
import time
from typing import Any, Dict, Optional

from python.runners.workflow.compat import compat as compat_module


def execute_activity(
    runner,
    node_id: str,
    activity_id: str,
    cfg: Dict[str, Any],
    browser_state: Dict[str, Any],
    account,
    profile_data: Optional[Dict[str, Any]],
    loop_state: Dict[str, int],
) -> str:
    compat = compat_module()
    try:
        control_result = _execute_control_activity(
            runner,
            node_id,
            activity_id,
            cfg,
            browser_state,
            account,
            profile_data,
            loop_state,
        )
        if control_result is not None:
            return control_result
        page = _ensure_browser(runner, activity_id, cfg, browser_state)
        if page is None:
            return 'failure'
        return _execute_browser_activity(
            runner,
            node_id,
            activity_id,
            cfg,
            browser_state,
            page,
            account,
            profile_data,
        )
    except Exception as exc:
        compat.log(f'Ошибка activity {activity_id}: {exc}')
        return 'failure'


def _execute_control_activity(
    runner,
    node_id: str,
    activity_id: str,
    cfg: Dict[str, Any],
    browser_state: Dict[str, Any],
    account,
    profile_data: Optional[Dict[str, Any]],
    loop_state: Dict[str, int],
) -> Optional[str]:
    if activity_id == 'start_browser':
        return _start_browser(runner, cfg, browser_state, auto_started=False)
    if activity_id == 'close_browser':
        return _close_browser(browser_state)
    if activity_id == 'select_list':
        return 'next'
    if activity_id == 'delay':
        return _run_delay(cfg)
    if activity_id == 'condition':
        return _run_condition(cfg)
    if activity_id == 'loop':
        return _run_loop(node_id, cfg, loop_state)
    if activity_id == 'random_branch':
        return _run_random_branch(cfg)
    if activity_id == 'python_script':
        return _run_python_script(cfg, browser_state.get('page'), account, profile_data, loop_state, node_id)
    return None


def _execute_browser_activity(
    runner,
    node_id: str,
    activity_id: str,
    cfg: Dict[str, Any],
    browser_state: Dict[str, Any],
    page: Any,
    account,
    profile_data: Optional[Dict[str, Any]],
) -> str:
    if activity_id == 'scrape_relationships':
        return runner._execute_scrape_relationships(node_id, cfg, page, browser_state['profile_name'], profile_data)
    if activity_id == 'browse_feed':
        return _run_browse_feed(runner, cfg, page)
    if activity_id == 'browse_reels':
        return _run_browse_reels(runner, cfg, page)
    if activity_id == 'watch_stories':
        return _run_watch_stories(cfg, page)
    if activity_id == 'follow_user':
        return _run_follow_activity(runner, cfg, page, account, profile_data)
    if activity_id == 'unfollow_user':
        return _run_unfollow_activity(runner, cfg, page, account, profile_data)
    if activity_id == 'approve_requests':
        return _run_approve_activity(runner, cfg, page, account)
    if activity_id == 'send_dm':
        return _run_send_dm_activity(runner, cfg, page, account, profile_data)
    compat = compat_module()
    compat.log(f'Unknown workflow activity: {activity_id}')
    return 'failure'


def _start_browser(runner, cfg: Dict[str, Any], browser_state: Dict[str, Any], *, auto_started: bool) -> str:
    compat = compat_module()
    _close_existing_context(browser_state)
    headless_cfg = bool(cfg.get('headlessMode', runner.headless))
    ctx_mgr = compat.create_browser_context(
        browser_state['profile_name'],
        browser_state['proxy_str'],
        browser_state.get('user_agent'),
        headless=headless_cfg,
        fingerprint_seed=browser_state.get('fingerprint_seed'),
        fingerprint_os=browser_state.get('fingerprint_os_val'),
        display=browser_state.get('display'),
    )
    context, page = ctx_mgr.__enter__()
    browser_state['_ctx_mgr'] = ctx_mgr
    browser_state['context'] = context
    browser_state['page'] = page
    compat.log('Browser auto-started.' if auto_started else 'Browser started.')
    return 'next' if not auto_started else 'success'


def _close_existing_context(browser_state: Dict[str, Any]) -> None:
    try:
        context = browser_state.get('context')
        if context:
            context.close()
    except Exception:
        pass
    browser_state['context'] = None
    browser_state['page'] = None


def _close_browser(browser_state: Dict[str, Any]) -> str:
    compat = compat_module()
    ctx_mgr = browser_state.get('_ctx_mgr')
    if not ctx_mgr:
        return 'next'
    try:
        ctx_mgr.__exit__(None, None, None)
    except Exception:
        pass
    browser_state['context'] = None
    browser_state['page'] = None
    browser_state['_ctx_mgr'] = None
    compat.log('Browser closed.')
    return 'next'


def _run_delay(cfg: Dict[str, Any]) -> str:
    compat = compat_module()
    min_seconds = max(1, compat._parse_int(cfg.get('minSeconds'), 30))
    max_seconds = max(min_seconds, compat._parse_int(cfg.get('maxSeconds'), 120))
    time.sleep(random.randint(min_seconds, max_seconds))
    return 'next'


def _run_condition(cfg: Dict[str, Any]) -> str:
    compat = compat_module()
    check = str(cfg.get('check') or 'random').strip().lower()
    value = str(cfg.get('value') or '').strip()
    if check != 'random':
        return 'true'
    pct = max(0, min(100, compat._parse_int(value, 50)))
    return 'true' if random.randint(1, 100) <= pct else 'false'


def _run_loop(node_id: str, cfg: Dict[str, Any], loop_state: Dict[str, int]) -> str:
    compat = compat_module()
    iterations = max(1, min(100, compat._parse_int(cfg.get('iterations'), 3)))
    key = _loop_state_key(node_id, cfg)
    current_iter = loop_state.get(key, 0) + 1
    loop_state[key] = current_iter
    if current_iter < iterations:
        return 'loop'
    loop_state[key] = 0
    return 'done'


def _loop_state_key(node_id: Optional[str], cfg: Dict[str, Any]) -> str:
    cleaned_node_id = str(node_id or '').strip()
    if cleaned_node_id:
        return cleaned_node_id
    return f'loop:{id(cfg)}'


def _run_random_branch(cfg: Dict[str, Any]) -> str:
    compat = compat_module()
    return compat._choose_weighted(['path_a', 'path_b', 'path_c'], str(cfg.get('weights') or ''))


def _run_python_script(
    cfg: Dict[str, Any],
    page: Any,
    account,
    profile_data: Optional[Dict[str, Any]],
    loop_state: Dict[str, int],
    node_id: str,
) -> str:
    compat = compat_module()
    code_snippet = str(cfg.get('code') or '')
    if not code_snippet.strip():
        return 'success'
    exec_globals = {
        'page': page,
        'account': account,
        'profile_data': profile_data,
        'log': compat.log,
        'time': time,
        'random': random,
        'loop_state': loop_state,
        'node_id': node_id,
    }
    try:
        exec(code_snippet, exec_globals)
        return 'success'
    except Exception as exc:
        compat.log(f'Ошибка python_script: {exc}')
        return 'failure'


def _ensure_browser(runner, activity_id: str, cfg: Dict[str, Any], browser_state: Dict[str, Any]) -> Optional[Any]:
    compat = compat_module()
    page = browser_state.get('page')
    if page is not None:
        return page
    compat.log(f'No browser open for activity {activity_id} – auto-starting browser.')
    try:
        _start_browser(runner, cfg, browser_state, auto_started=True)
        return browser_state.get('page')
    except Exception as exc:
        compat.log(f'Failed to auto-start browser: {exc}')
        return None


def _run_browse_feed(runner, cfg: Dict[str, Any], page: Any) -> str:
    compat = compat_module()
    min_minutes = compat._parse_int(cfg.get('feed_min_time_minutes'), 1)
    max_minutes = compat._parse_int(cfg.get('feed_max_time_minutes'), 3)
    min_minutes, max_minutes = compat.normalize_range((min_minutes, max_minutes), (1, 3))
    duration = random.randint(min_minutes, max_minutes)
    compat.scroll_feed(page, duration, _build_feed_config(compat, cfg), should_stop=lambda: not runner.running)
    return 'success'


def _build_feed_config(compat, cfg: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'like_chance': compat._parse_int(cfg.get('like_chance'), 10),
        'comment_chance': 0,
        'follow_chance': compat._parse_int(cfg.get('follow_chance'), 0),
        'carousel_watch_chance': compat._parse_int(cfg.get('carousel_watch_chance'), 0),
        'carousel_max_slides': compat._parse_int(cfg.get('carousel_max_slides'), 3),
        'watch_stories': compat._parse_bool(cfg.get('watch_stories'), False),
        'stories_max': compat._parse_int(cfg.get('stories_max'), 3),
        'stories_min_view_seconds': compat._parse_float(cfg.get('stories_min_view_seconds'), 2.0),
        'stories_max_view_seconds': compat._parse_float(cfg.get('stories_max_view_seconds'), 5.0),
        'skip_post_chance': compat._parse_int(cfg.get('skip_post_chance'), 30),
        'skip_post_max': compat._parse_int(cfg.get('skip_post_max'), 2),
        'post_view_min_seconds': compat._parse_float(cfg.get('post_view_min_seconds'), 2.0),
        'post_view_max_seconds': compat._parse_float(cfg.get('post_view_max_seconds'), 5.0),
    }


def _run_browse_reels(runner, cfg: Dict[str, Any], page: Any) -> str:
    compat = compat_module()
    min_minutes = compat._parse_int(cfg.get('reels_min_time_minutes'), 1)
    max_minutes = compat._parse_int(cfg.get('reels_max_time_minutes'), 3)
    min_minutes, max_minutes = compat.normalize_range((min_minutes, max_minutes), (1, 3))
    duration = random.randint(min_minutes, max_minutes)
    compat.scroll_reels(page, duration, _build_reels_config(compat, cfg), should_stop=lambda: not runner.running)
    return 'success'


def _build_reels_config(compat, cfg: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'like_chance': compat._parse_int(cfg.get('reels_like_chance'), 10),
        'comment_chance': 0,
        'follow_chance': compat._parse_int(cfg.get('reels_follow_chance'), 0),
        'reels_skip_chance': compat._parse_int(cfg.get('reels_skip_chance'), 30),
        'reels_skip_min_time': compat._parse_float(cfg.get('reels_skip_min_time'), 0.8),
        'reels_skip_max_time': compat._parse_float(cfg.get('reels_skip_max_time'), 2.0),
        'reels_normal_min_time': compat._parse_float(cfg.get('reels_normal_min_time'), 5.0),
        'reels_normal_max_time': compat._parse_float(cfg.get('reels_normal_max_time'), 20.0),
        'reels_advance_min_seconds': compat._parse_float(cfg.get('reels_advance_min_seconds'), 1.5),
        'reels_advance_max_seconds': compat._parse_float(cfg.get('reels_advance_max_seconds'), 3.0),
    }


def _run_watch_stories(cfg: Dict[str, Any], page: Any) -> str:
    compat = compat_module()
    compat.watch_stories(
        page,
        max_stories=compat._parse_int(cfg.get('stories_max'), 3),
        min_view_s=compat._parse_float(cfg.get('stories_min_view_seconds'), 2.0),
        max_view_s=compat._parse_float(cfg.get('stories_max_view_seconds'), 5.0),
        log=compat.log,
    )
    return 'success'


def _run_follow_activity(runner, cfg: Dict[str, Any], page: Any, account, profile_data: Optional[Dict[str, Any]]) -> str:
    compat = compat_module()
    profile_id = _resolve_profile_id(runner, account, profile_data)
    if not profile_id:
        return 'failure'
    accounts = runner.accounts_client.get_accounts_for_profile(profile_id)
    usernames = [entry.get('user_name') for entry in accounts if entry.get('user_name')]
    if not usernames:
        return 'failure'
    follow_min = compat._parse_int(cfg.get('follow_min_count'), 5)
    follow_max = compat._parse_int(cfg.get('follow_max_count'), 15)
    follow_min, follow_max = compat.normalize_range((follow_min, follow_max), (5, 15))
    follow_delay_min = compat._parse_int(cfg.get('follow_min_delay_seconds'), 10)
    follow_delay_max = compat._parse_int(cfg.get('follow_max_delay_seconds'), 20)
    follow_delay_min, follow_delay_max = compat.normalize_range((follow_delay_min, follow_delay_max), (10, 20))
    highlights_min = compat._parse_int(cfg.get('highlights_min'), 0)
    highlights_max = compat._parse_int(cfg.get('highlights_max'), 2)
    highlights_range = compat.normalize_range((highlights_min, highlights_max), (0, 2))
    compat.follow_usernames(
        profile_name=account.username,
        proxy_string=account.proxy or '',
        usernames=compat.apply_count_limit(usernames, (follow_min, follow_max)),
        account_map={entry['user_name']: entry['id'] for entry in accounts if entry.get('id') and entry.get('user_name')},
        interactions_config={
            'highlights_range': highlights_range,
            'likes_percentage': compat._parse_int(cfg.get('likes_percentage'), 0),
            'scroll_percentage': compat._parse_int(cfg.get('scroll_percentage'), 0),
            'following_limit': compat._parse_int(cfg.get('following_limit'), 3000),
        },
        log=compat.log,
        should_stop=lambda: not runner.running,
        page=page,
        delay_range=(follow_delay_min, follow_delay_max),
    )
    return 'success'


def _run_unfollow_activity(runner, cfg: Dict[str, Any], page: Any, account, profile_data: Optional[Dict[str, Any]]) -> str:
    compat = compat_module()
    profile_id = _resolve_profile_id(runner, account, profile_data)
    if not profile_id:
        return 'failure'
    accounts = runner.accounts_client.get_accounts_for_profile(profile_id, status='unsubscribed')
    usernames = [entry.get('user_name') for entry in accounts if entry.get('user_name')]
    if not usernames:
        return 'failure'
    min_delay = compat._parse_int(cfg.get('min_delay'), 10)
    max_delay = compat._parse_int(cfg.get('max_delay'), 30)
    min_delay, max_delay = compat.normalize_range((min_delay, max_delay), (10, 30))
    min_count = compat._parse_int(cfg.get('unfollow_min_count'), 5)
    max_count = compat._parse_int(cfg.get('unfollow_max_count'), 15)
    min_count, max_count = compat.normalize_range((min_count, max_count), (5, 15))
    account_map = {entry['user_name']: entry['id'] for entry in accounts if entry.get('id') and entry.get('user_name')}
    status_sync_failed = {'value': False}
    compat.unfollow_usernames(
        profile_name=account.username,
        proxy_string=account.proxy or '',
        usernames=compat.apply_count_limit(usernames, (min_count, max_count)),
        log=compat.log,
        should_stop=lambda: not runner.running,
        delay_range=(min_delay, max_delay),
        on_success=lambda uname: _mark_unfollow_done(runner, account_map, uname, compat.log, status_sync_failed),
        page=page,
    )
    return 'failure' if status_sync_failed['value'] else 'success'


def _mark_unfollow_done(runner, account_map: Dict[str, Any], username: str, log, status_sync_failed: Optional[Dict[str, bool]] = None) -> None:
    account_id = account_map.get(username)
    if not account_id:
        return
    try:
        runner.accounts_client.update_account_status(account_id, status='done')
    except Exception as exc:
        if isinstance(status_sync_failed, dict):
            status_sync_failed['value'] = True
        log(f'Не удалось сохранить статус отписки для @{username}: {exc}')
        raise


def _run_approve_activity(runner, cfg: Dict[str, Any], page: Any, account) -> str:
    compat = compat_module()
    min_delay = compat._parse_float(cfg.get('approve_min_delay_seconds'), 1.0)
    max_delay = compat._parse_float(cfg.get('approve_max_delay_seconds'), 2.0)
    if max_delay < min_delay:
        min_delay, max_delay = max_delay, min_delay
    compat.approve_follow_requests(
        profile_name=account.username,
        proxy_string=account.proxy or '',
        log=compat.log,
        should_stop=lambda: not runner.running,
        page=page,
        approve_delay_range=(min_delay, max_delay),
        finish_delay_seconds=compat._parse_float(cfg.get('approve_finish_delay_seconds'), 3.0),
    )
    return 'success'


def _run_send_dm_activity(runner, cfg: Dict[str, Any], page: Any, account, profile_data: Optional[Dict[str, Any]]) -> str:
    compat = compat_module()
    profile_id = _resolve_profile_id(runner, account, profile_data)
    if not profile_id:
        return 'failure'
    message_texts = _resolve_message_texts(compat, cfg)
    cooldown_hours = runner.messaging_cooldown_hours if runner.messaging_cooldown_enabled else 0
    targets = runner.accounts_client.get_accounts_to_message(profile_id, cooldown_hours=cooldown_hours)
    if not targets:
        return 'failure'
    compat.send_messages(
        profile_name=account.username,
        proxy_string=account.proxy or '',
        targets=targets,
        message_texts=message_texts,
        log=compat.log,
        should_stop=lambda: not runner.running,
        page=page,
        behavior_config=_build_dm_behavior_config(compat, cfg),
    )
    return 'success'


def _resolve_message_texts(compat, cfg: Dict[str, Any]) -> list[str]:
    template_kind = str(cfg.get('template_kind') or 'message').strip() or 'message'
    try:
        message_texts = compat.MessageTemplatesClient().get_texts(template_kind) or []
    except Exception:
        message_texts = []
    return message_texts or ['Hi!']


def _build_dm_behavior_config(compat, cfg: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'follow_if_no_message_button': compat._parse_bool(cfg.get('follow_if_no_message_button'), True),
        'navigation_delay_min_seconds': compat._parse_float(cfg.get('navigation_delay_min_seconds'), 2.0),
        'navigation_delay_max_seconds': compat._parse_float(cfg.get('navigation_delay_max_seconds'), 3.0),
        'composer_delay_min_seconds': compat._parse_float(cfg.get('composer_delay_min_seconds'), 1.0),
        'composer_delay_max_seconds': compat._parse_float(cfg.get('composer_delay_max_seconds'), 2.0),
        'typing_delay_min_ms': compat._parse_int(cfg.get('typing_delay_min_ms'), 100),
        'typing_delay_max_ms': compat._parse_int(cfg.get('typing_delay_max_ms'), 200),
        'between_targets_min_seconds': compat._parse_float(cfg.get('between_targets_min_seconds'), 3.0),
        'between_targets_max_seconds': compat._parse_float(cfg.get('between_targets_max_seconds'), 5.0),
    }


def _resolve_profile_id(runner, account, profile_data: Optional[Dict[str, Any]]) -> Optional[Any]:
    profile_id = profile_data.get('profile_id') if profile_data else None
    if profile_id:
        return profile_id
    profiles = runner.accounts_client.get_profiles_with_assigned_accounts()
    fallback = next((profile for profile in profiles if profile.get('name') == account.username), None)
    return fallback.get('profile_id') if fallback else None
