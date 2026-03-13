import random
import time
from typing import Any, Dict, Optional

from python.runners.workflow.compat import compat as compat_module


def process_account(runner, account) -> bool:
    compat = compat_module()
    profile_name = account.username
    browser_state = _build_browser_state(account)
    profile_data = _load_profile_data(runner, profile_name)
    _hydrate_browser_identity(browser_state, profile_data)
    compat.emit_event('profile_started', profile=profile_name, workflow_id=runner.workflow_id)
    try:
        _sync_profile_status(runner, profile_name, 'running', True)
        _allocate_display(runner, profile_name, browser_state)
        succeeded = _run_account_nodes(runner, account, browser_state, profile_data)
        if runner.running:
            compat.emit_event(
                'profile_completed',
                profile=profile_name,
                status='success' if succeeded else 'failed',
                workflow_id=runner.workflow_id,
            )
        _sync_profile_status(runner, profile_name, 'idle', False)
        return succeeded
    except Exception as exc:
        return _handle_account_exception(runner, profile_name, exc)
    finally:
        _cleanup_browser_context(browser_state)
        _release_display(runner, profile_name)


def _build_browser_state(account) -> Dict[str, Any]:
    return {
        'context': None,
        'page': None,
        'profile_name': account.username,
        'proxy_str': account.proxy or 'None',
        'user_agent': None,
        'fingerprint_seed': None,
        'fingerprint_os_val': None,
        'display': None,
    }


def _load_profile_data(runner, profile_name: str) -> Optional[Dict[str, Any]]:
    profile_data = runner._get_cached_profile(profile_name)
    if profile_data:
        return profile_data
    try:
        profile_data = runner.profiles_client.get_profile_by_name(profile_name)
        if profile_data:
            runner._set_cached_profile(profile_name, profile_data)
        return profile_data
    except Exception:
        return profile_data


def _hydrate_browser_identity(browser_state: Dict[str, Any], profile_data: Optional[Dict[str, Any]]) -> None:
    if not profile_data:
        return
    try:
        browser_state['user_agent'] = profile_data.get('user_agent')
        browser_state['fingerprint_seed'] = profile_data.get('fingerprint_seed')
        browser_state['fingerprint_os_val'] = profile_data.get('fingerprint_os')
    except Exception:
        browser_state['user_agent'] = None


def _sync_profile_status(runner, profile_name: str, status: str, running: bool) -> None:
    try:
        runner.profiles_client.sync_profile_status(profile_name, status, running)
    except Exception:
        pass


def _allocate_display(runner, profile_name: str, browser_state: Dict[str, Any]) -> None:
    compat = compat_module()
    try:
        display_session = runner.display_mgr.allocate(runner.workflow_id, profile_name)
        if not display_session:
            return
        browser_state['display'] = display_session.get('display')
        compat.emit_event(
            'display_allocated',
            workflow_id=runner.workflow_id,
            profile=profile_name,
            vnc_port=display_session.get('vnc_port'),
            display_num=display_session.get('display_num'),
        )
    except Exception as exc:
        compat.log(f'Display allocation failed for @{profile_name}: {exc}')


def _run_account_nodes(runner, account, browser_state: Dict[str, Any], profile_data: Optional[Dict[str, Any]]) -> bool:
    compat = compat_module()
    start_node = compat._find_start_node(runner.nodes)
    if not start_node:
        compat.log('Не найден start node')
        return False
    current = compat._next_node(runner.edge_index, str(start_node.get('id')), '')
    loop_state: Dict[str, int] = {}
    completed_steps = 0
    activity_nodes = [node for node in runner.nodes if node.get('type') == 'activity']
    total_steps = max(1, len(activity_nodes))
    visited_steps = 0
    last_handle = ''
    while runner.running and current:
        visited_steps += 1
        if visited_steps > 500:
            compat.log('Превышен лимит шагов workflow')
            return False
        current, completed_steps, last_handle = _run_single_node(
            runner,
            account,
            browser_state,
            profile_data,
            current,
            loop_state,
            completed_steps,
            total_steps,
        )
    return runner.running and last_handle != 'failure'


def _run_single_node(
    runner,
    account,
    browser_state: Dict[str, Any],
    profile_data: Optional[Dict[str, Any]],
    current: str,
    loop_state: Dict[str, int],
    completed_steps: int,
    total_steps: int,
) -> tuple[Optional[str], int, str]:
    compat = compat_module()
    node = runner.node_index.get(current)
    if not node:
        return None, completed_steps, ''
    if node.get('type') == 'start':
        next_node = compat._next_node(runner.edge_index, str(node.get('id')), '')
        return next_node, completed_steps, ''
    node_id = str(node.get('id'))
    activity_id, label, config = _node_metadata(node)
    progress = int(round(100.0 * min(1.0, float(completed_steps) / float(total_steps))))
    _emit_task_started(runner, node_id, activity_id, label, browser_state['profile_name'], progress)
    handle = runner._execute_activity(node_id, activity_id, config, browser_state, account, profile_data, loop_state)
    next_completed_steps = completed_steps + (1 if node.get('type') == 'activity' else 0)
    _emit_task_completed(runner, node_id, label, browser_state['profile_name'], handle, next_completed_steps, total_steps)
    next_node = compat._next_node(runner.edge_index, node_id, str(handle or ''))
    if runner.running and next_node:
        time.sleep(random.randint(1, 3))
    return next_node, next_completed_steps, str(handle or '')


def _node_metadata(node: Dict[str, Any]) -> tuple[str, str, Dict[str, Any]]:
    data = node.get('data') if isinstance(node.get('data'), dict) else {}
    activity_id = str(data.get('activityId') or '')
    label = str(data.get('label') or activity_id or node.get('id') or '')
    config = data.get('config') if isinstance(data.get('config'), dict) else {}
    return activity_id, label, config


def _emit_task_started(runner, node_id: str, activity_id: str, label: str, profile_name: str, progress: int) -> None:
    compat = compat_module()
    runner._update_node_state(
        node_id,
        activityId=activity_id,
        label=label,
        status='running',
        profile=profile_name,
        progress=progress,
        updatedAt=int(time.time() * 1000),
    )
    compat.emit_event(
        'task_started',
        profile=profile_name,
        task=label,
        workflow_id=runner.workflow_id,
        node_id=node_id,
        progress=progress,
        node_states=runner._sanitize_node_states(),
    )


def _emit_task_completed(
    runner,
    node_id: str,
    label: str,
    profile_name: str,
    handle: str,
    completed_steps: int,
    total_steps: int,
) -> None:
    runner._update_node_state(
        node_id,
        status='failed' if str(handle or '') == 'failure' else 'completed',
        lastHandle=str(handle or ''),
        updatedAt=int(time.time() * 1000),
    )
    runner._emit_node_state(
        'task_completed',
        node_id,
        profile_name,
        task=label,
        progress=int(round(100.0 * min(1.0, float(completed_steps) / float(total_steps)))),
        handle=str(handle or ''),
    )


def _handle_account_exception(runner, profile_name: str, exc: Exception) -> bool:
    compat = compat_module()
    if not runner.running:
        compat.emit_event('profile_completed', profile=profile_name, status='cancelled', workflow_id=runner.workflow_id)
        _sync_profile_status(runner, profile_name, 'idle', False)
        return False
    if 'Target page, context or browser has been closed' in str(exc):
        compat.emit_event('profile_completed', profile=profile_name, status='cancelled', workflow_id=runner.workflow_id)
        _sync_profile_status(runner, profile_name, 'idle', False)
        compat.log(f'Остановлено @{profile_name}')
        return False
    compat.emit_event('profile_completed', profile=profile_name, status='failed', workflow_id=runner.workflow_id)
    compat.log(f'Ошибка @{profile_name}: {exc}')
    _sync_profile_status(runner, profile_name, 'idle', False)
    return False


def _cleanup_browser_context(browser_state: Dict[str, Any]) -> None:
    try:
        ctx_mgr = browser_state.get('_ctx_mgr')
        if ctx_mgr:
            ctx_mgr.__exit__(None, None, None)
    except Exception:
        pass


def _release_display(runner, profile_name: str) -> None:
    compat = compat_module()
    try:
        released = runner.display_mgr.release(runner.workflow_id, profile_name)
        if not released:
            return
        compat.emit_event(
            'display_released',
            workflow_id=runner.workflow_id,
            profile=profile_name,
            vnc_port=released.get('vnc_port'),
            display_num=released.get('display_num'),
        )
    except Exception:
        pass
