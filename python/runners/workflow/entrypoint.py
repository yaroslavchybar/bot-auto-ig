import atexit
import json
import os
import sys
from typing import Any, Dict, List, Optional

from python.browser.display import DisplayManager
from python.core.config import PROJECT_URL, SECRET_KEY
from python.core.logging import setup_logging
from python.core.models import ThreadsAccount
from python.core.sentry import flush_sentry, init_sentry, set_sentry_context
from python.core.shutdown import ShutdownManager
from python.runners.workflow.bootstrap import (
    _extract_start_browser_settings,
    _find_start_node,
    _workflow_has_activity,
    fetch_profiles_for_lists,
)
from python.runners.workflow.io import emit_event, log
from python.runners.workflow.parsing import (
    _parse_bool,
    _parse_int,
    _profile_remaining_daily_scraping_capacity,
)
from python.runners.workflow.runtime import WorkflowRunner


def _normalize_list_ids(raw_items: Any) -> List[str]:
    if not isinstance(raw_items, list):
        return []
    list_ids: List[str] = []
    for item in raw_items:
        if not item:
            continue
        item_text = str(item).strip()
        if item_text:
            list_ids.append(item_text)
    return list_ids


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
    workflow_id, workflow, nodes, options = _extract_workflow_payload(payload)
    if workflow is None:
        return 2
    _, start_data, list_ids = _start_node_inputs(nodes)
    start_settings = _extract_start_browser_settings(nodes, start_data)
    has_scrape_relationships = _workflow_has_activity(nodes, 'scrape_relationships')
    if _should_fail_scrape_start_node(workflow_id, has_scrape_relationships, nodes):
        return 2
    profiles = _resolve_profiles(workflow_id, list_ids, start_settings, has_scrape_relationships)
    if profiles is None:
        return 2
    accounts = _build_accounts(workflow_id, profiles)
    if accounts is None:
        return 2
    set_sentry_context(
        workflow_id=workflow_id,
        workflow_name=workflow.get('name'),
        extra={'profile_count': len(accounts)},
    )
    runner = WorkflowRunner(
        workflow_id,
        nodes,
        workflow.get('edges') if isinstance(workflow.get('edges'), list) else [],
        accounts,
        {**start_settings, **options, 'workflow_name': workflow.get('name')},
    )
    _register_process_handlers(runner)
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
    if not isinstance(payload, dict):
        log('payload must be an object')
        return None
    return payload


def _extract_workflow_payload(payload: Dict[str, Any]) -> tuple[str, Optional[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    workflow_id = str(payload.get('workflowId') or payload.get('workflow_id') or '').strip()
    workflow = payload.get('workflow') if isinstance(payload.get('workflow'), dict) else None
    if not workflow_id or not workflow:
        log('workflowId and workflow are required')
        return workflow_id, None, [], {}
    nodes = workflow.get('nodes') if isinstance(workflow.get('nodes'), list) else []
    options = payload.get('options') if isinstance(payload.get('options'), dict) else {}
    return workflow_id, workflow, nodes, options


def _start_node_inputs(nodes: List[Dict[str, Any]]) -> tuple[Optional[Dict[str, Any]], Dict[str, Any], List[str]]:
    start_node = _find_start_node(nodes)
    start_data = start_node.get('data') if start_node and isinstance(start_node.get('data'), dict) else {}
    list_ids: List[str] = []
    for node in nodes:
        node_data = node.get('data') if isinstance(node.get('data'), dict) else {}
        config = node_data.get('config') if isinstance(node_data.get('config'), dict) else {}
        if str(node_data.get('activityId') or '') != 'select_list':
            continue
        list_ids.extend(_normalize_list_ids(config.get('sourceLists')))
    if not list_ids:
        list_ids = _normalize_list_ids(start_data.get('sourceLists'))
    return start_node, start_data, list_ids


def _should_fail_scrape_start_node(workflow_id: str, has_scrape_relationships: bool, nodes: List[Dict[str, Any]]) -> bool:
    if not (has_scrape_relationships and not _workflow_has_activity(nodes, 'start_browser')):
        return False
    log('scrape_relationships requires a Start Browser node in the workflow')
    emit_event('session_ended', status='failed', workflow_id=workflow_id)
    return True


def _resolve_profiles(
    workflow_id: str,
    list_ids: List[str],
    start_settings: Dict[str, Any],
    has_scrape_relationships: bool,
) -> Optional[List[Dict[str, Any]]]:
    if not list_ids:
        log('Please select a profile list!')
        emit_event('session_ended', status='failed', workflow_id=workflow_id)
        return None
    profiles = fetch_profiles_for_lists(
        PROJECT_URL,
        SECRET_KEY,
        list_ids,
        cooldown_minutes=max(0, _parse_int(start_settings.get('profile_reopen_cooldown_minutes'), 30)),
        enforce_cooldown=_parse_bool(start_settings.get('profile_reopen_cooldown_enabled'), True),
    )
    if has_scrape_relationships:
        profiles = _filter_scrape_profiles(profiles)
    if profiles:
        return profiles
    log('No profiles found in the selected list!')
    emit_event('session_ended', status='failed', workflow_id=workflow_id)
    return None


def _filter_scrape_profiles(profiles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    eligible_profiles = [
        profile
        for profile in profiles
        if _profile_remaining_daily_scraping_capacity(profile) != 0
    ]
    skipped_profiles = len(profiles) - len(eligible_profiles)
    if skipped_profiles > 0:
        log(
            f'scrape_relationships: skipped {skipped_profiles} profile(s) with exhausted '
            f'daily scraping limits'
        )
    return eligible_profiles


def _build_accounts(workflow_id: str, profiles: List[Dict[str, Any]]) -> Optional[List[ThreadsAccount]]:
    accounts = []
    for profile in profiles:
        name = profile.get('name')
        if not name:
            continue
        accounts.append(ThreadsAccount(username=name, password='', proxy=profile.get('proxy')))
    if accounts:
        return accounts
    log('No valid profiles found in the selected list!')
    emit_event('session_ended', status='failed', workflow_id=workflow_id)
    return None


def _register_process_handlers(runner: WorkflowRunner) -> None:
    atexit.register(DisplayManager.cleanup_owner_sessions, os.getpid())

    shutdown_mgr = ShutdownManager()
    # Track the first account as the active profile for state persistence
    if runner.accounts:
        shutdown_mgr.set_state(
            runner.accounts[0].username,
            'workflow',
            0,
        )
    shutdown_mgr.add_stop_callback(runner.stop)
    shutdown_mgr.add_cleanup(lambda: DisplayManager.cleanup_owner_sessions(os.getpid()))
    shutdown_mgr.register()
