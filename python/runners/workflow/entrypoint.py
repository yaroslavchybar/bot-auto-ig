import atexit
import os
import signal
import sys
from typing import Any, Dict, List, Optional

from python.core.models import ThreadsAccount
from python.runners.workflow.compat import compat as compat_module
from python.runners.workflow.runtime import WorkflowRunner


def main() -> int:
    compat = compat_module()
    payload = _read_payload(compat)
    if payload is None:
        return 2
    workflow_id, workflow, nodes, options = _extract_workflow_payload(compat, payload)
    if workflow is None:
        return 2
    _, start_data, list_ids = _start_node_inputs(nodes)
    start_settings = compat._extract_start_browser_settings(nodes, start_data)
    has_scrape_relationships = compat._workflow_has_activity(nodes, 'scrape_relationships')
    if _should_fail_scrape_start_node(compat, workflow_id, has_scrape_relationships, nodes):
        return 2
    profiles = _resolve_profiles(compat, workflow_id, list_ids, start_settings, has_scrape_relationships)
    if profiles is None:
        return 2
    accounts = _build_accounts(compat, workflow_id, profiles)
    if accounts is None:
        return 2
    runner = WorkflowRunner(
        workflow_id,
        nodes,
        workflow.get('edges') if isinstance(workflow.get('edges'), list) else [],
        accounts,
        {**start_settings, **options, 'workflow_name': workflow.get('name')},
    )
    _register_process_handlers(compat, runner)
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
    if not isinstance(payload, dict):
        compat.log('payload должен быть объектом')
        return None
    return payload


def _extract_workflow_payload(compat, payload: Dict[str, Any]) -> tuple[str, Optional[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    workflow_id = str(payload.get('workflowId') or payload.get('workflow_id') or '').strip()
    workflow = payload.get('workflow') if isinstance(payload.get('workflow'), dict) else None
    if not workflow_id or not workflow:
        compat.log('workflowId и workflow обязательны')
        return workflow_id, None, [], {}
    nodes = workflow.get('nodes') if isinstance(workflow.get('nodes'), list) else []
    options = payload.get('options') if isinstance(payload.get('options'), dict) else {}
    return workflow_id, workflow, nodes, options


def _start_node_inputs(nodes: List[Dict[str, Any]]) -> tuple[Optional[Dict[str, Any]], Dict[str, Any], List[str]]:
    compat = compat_module()
    start_node = compat._find_start_node(nodes)
    start_data = start_node.get('data') if start_node and isinstance(start_node.get('data'), dict) else {}
    list_ids: List[str] = []
    for node in nodes:
        node_data = node.get('data') if isinstance(node.get('data'), dict) else {}
        config = node_data.get('config') if isinstance(node_data.get('config'), dict) else {}
        if str(node_data.get('activityId') or '') != 'select_list':
            continue
        source_lists = config.get('sourceLists') or []
        if isinstance(source_lists, list):
            list_ids.extend([str(item) for item in source_lists if str(item).strip()])
    if not list_ids:
        old_lists = start_data.get('sourceLists') or []
        if isinstance(old_lists, list):
            list_ids = [str(item) for item in old_lists if str(item).strip()]
    return start_node, start_data, list_ids


def _should_fail_scrape_start_node(compat, workflow_id: str, has_scrape_relationships: bool, nodes: List[Dict[str, Any]]) -> bool:
    if not (has_scrape_relationships and not compat._workflow_has_activity(nodes, 'start_browser')):
        return False
    compat.log('scrape_relationships requires a Start Browser node in the workflow')
    compat.emit_event('session_ended', status='failed', workflow_id=workflow_id)
    return True


def _resolve_profiles(
    compat,
    workflow_id: str,
    list_ids: List[str],
    start_settings: Dict[str, Any],
    has_scrape_relationships: bool,
) -> Optional[List[Dict[str, Any]]]:
    if not list_ids:
        compat.log('Выберите список профилей!')
        compat.emit_event('session_ended', status='failed', workflow_id=workflow_id)
        return None
    profiles = compat._fetch_profiles_for_lists(
        list_ids,
        cooldown_minutes=max(0, compat._parse_int(start_settings.get('profile_reopen_cooldown_minutes'), 30)),
        enforce_cooldown=compat._parse_bool(start_settings.get('profile_reopen_cooldown_enabled'), True),
    )
    if has_scrape_relationships:
        profiles = _filter_scrape_profiles(compat, profiles)
    if profiles:
        return profiles
    compat.log('В выбранном списке нет профилей!')
    compat.emit_event('session_ended', status='failed', workflow_id=workflow_id)
    return None


def _filter_scrape_profiles(compat, profiles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    eligible_profiles = [
        profile
        for profile in profiles
        if compat._profile_remaining_daily_scraping_capacity(profile) != 0
    ]
    skipped_profiles = len(profiles) - len(eligible_profiles)
    if skipped_profiles > 0:
        compat.log(
            f'scrape_relationships: skipped {skipped_profiles} profile(s) with exhausted '
            f'daily scraping limits'
        )
    return eligible_profiles


def _build_accounts(compat, workflow_id: str, profiles: List[Dict[str, Any]]) -> Optional[List[ThreadsAccount]]:
    accounts = []
    for profile in profiles:
        name = profile.get('name')
        if not name:
            continue
        accounts.append(ThreadsAccount(username=name, password='', proxy=profile.get('proxy')))
    if accounts:
        return accounts
    compat.log('В выбранном списке нет валидных профилей!')
    compat.emit_event('session_ended', status='failed', workflow_id=workflow_id)
    return None


def _register_process_handlers(compat, runner: WorkflowRunner) -> None:
    atexit.register(compat.DisplayManager.cleanup_owner_sessions, os.getpid())

    def _handle_signal(_sig, _frame):
        runner.stop()

    if hasattr(signal, 'SIGINT'):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, 'SIGTERM'):
        signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, _handle_signal)
