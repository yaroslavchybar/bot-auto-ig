import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock, RLock
from typing import Any, Dict, List, Optional

from python.runners.workflow.account_session import process_account as process_account_impl
from python.runners.workflow.activity_dispatch import execute_activity as execute_activity_impl
from python.runners.workflow.compat import compat as compat_module
from python.runners.workflow.graph import _build_edge_index
from python.runners.workflow.scrape_relationships import (
    execute_scrape_relationships,
    open_relationship_view,
    scrape_relationship_chunk,
)


class WorkflowRunner:
    def __init__(
        self,
        workflow_id: str,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        accounts: List[Any],
        options: Dict[str, Any],
    ) -> None:
        compat = compat_module()
        self.workflow_id = workflow_id
        self.nodes = nodes
        self.edges = edges
        self.node_index = {str(node.get('id')): node for node in nodes if node.get('id')}
        self.edge_index = _build_edge_index(edges)
        self.accounts = accounts
        self.running = True
        self.options = options
        self._scrape_node_ids = _scrape_node_ids(nodes)
        self._has_scrape_relationships = bool(self._scrape_node_ids)
        self.headless = compat._parse_bool(options.get('headless'), False)
        self.messaging_cooldown_enabled = compat._parse_bool(options.get('messaging_cooldown_enabled'), False)
        self.messaging_cooldown_hours = max(0, compat._parse_int(options.get('messaging_cooldown_hours'), 2))
        self.workflow_name = str(options.get('workflow_name') or workflow_id).strip() or workflow_id
        self.accounts_client = compat.InstagramAccountsClient()
        self.profiles_client = compat.ProfilesClient()
        self._profile_cache: Dict[str, Dict[str, Any]] = {}
        self._profile_cache_lock = Lock()
        self._node_states_lock = RLock()
        self._max_workers = _max_workers(compat, options, accounts, self._has_scrape_relationships)
        self._executor = ThreadPoolExecutor(max_workers=self._max_workers)
        self.display_mgr = compat.DisplayManager()
        raw_node_states = options.get('node_states')
        self.node_states: Dict[str, Any] = dict(raw_node_states) if isinstance(raw_node_states, dict) else {}

    def stop(self) -> None:
        self.running = False
        try:
            self._executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            try:
                self._executor.shutdown(wait=False)
            except Exception:
                pass
        except Exception:
            pass

    def _get_cached_profile(self, name: str) -> Optional[Dict[str, Any]]:
        with self._profile_cache_lock:
            return self._profile_cache.get(name)

    def _set_cached_profile(self, name: str, data: Dict[str, Any]) -> None:
        with self._profile_cache_lock:
            self._profile_cache[name] = data

    def _record_daily_scraping_usage(self, profile_name: str, amount: int) -> None:
        compat = compat_module()
        safe_amount = max(0, int(amount)) if isinstance(amount, (int, float)) else 0
        if safe_amount <= 0:
            return
        self.profiles_client.increment_daily_scraping_used(profile_name, safe_amount)
        cached = self._get_cached_profile(profile_name)
        next_profile = dict(cached) if isinstance(cached, dict) else {'name': profile_name}
        next_profile['daily_scraping_used'] = compat._profile_daily_scraping_used(next_profile) + safe_amount
        self._set_cached_profile(profile_name, next_profile)

    def _sanitize_node_states(self) -> Dict[str, Any]:
        with self._node_states_lock:
            return json.loads(json.dumps(self.node_states))

    def _update_node_state(self, node_id: str, **patch: Any) -> Dict[str, Any]:
        with self._node_states_lock:
            existing = self.node_states.get(node_id)
            base = dict(existing) if isinstance(existing, dict) else {}
            base.update(patch)
            self.node_states[node_id] = base
            return dict(base)

    def _get_node_state(self, node_id: str) -> Optional[Dict[str, Any]]:
        with self._node_states_lock:
            existing = self.node_states.get(node_id)
            return dict(existing) if isinstance(existing, dict) else None

    def _emit_node_state(self, event_type: str, node_id: str, profile_name: str, **extra: Any) -> None:
        compat = compat_module()
        compat.emit_event(
            event_type,
            workflow_id=self.workflow_id,
            node_id=node_id,
            profile=profile_name,
            node_states=self._sanitize_node_states(),
            **extra,
        )

    def _scrape_work_complete(self) -> bool:
        for node_id in self._scrape_node_ids:
            state = self._get_node_state(node_id)
            if not state:
                return False
            if state.get('done') is True:
                continue
            if str(state.get('status') or '').strip().lower() == 'completed':
                continue
            return False
        return bool(self._scrape_node_ids)

    def _open_relationship_view(self, page: Any, *, target_username: str, kind: str):
        return open_relationship_view(self, page, target_username=target_username, kind=kind)

    def _scrape_relationship_chunk(self, page: Any, **kwargs: Any) -> Dict[str, Any]:
        return scrape_relationship_chunk(self, page, **kwargs)

    def _execute_scrape_relationships(
        self,
        node_id: str,
        cfg: Dict[str, Any],
        page: Any,
        profile_name: str,
        profile_data: Optional[Dict[str, Any]] = None,
    ) -> str:
        return execute_scrape_relationships(self, node_id, cfg, page, profile_name, profile_data)

    def run(self) -> int:
        return run_workflow_session(self)

    def process_account(self, account) -> bool:
        return process_account_impl(self, account)

    def _execute_activity(
        self,
        node_id: str,
        activity_id: str,
        cfg: Dict[str, Any],
        browser_state: Dict[str, Any],
        account,
        profile_data: Optional[Dict[str, Any]],
        loop_state: Dict[str, int],
    ) -> str:
        return execute_activity_impl(
            self,
            node_id,
            activity_id,
            cfg,
            browser_state,
            account,
            profile_data,
            loop_state,
        )


def _scrape_node_ids(nodes: List[Dict[str, Any]]) -> List[str]:
    return [
        str(node.get('id'))
        for node in nodes
        if str((node.get('data') if isinstance(node.get('data'), dict) else {}).get('activityId') or '') == 'scrape_relationships'
    ]


def _max_workers(compat, options: Dict[str, Any], accounts: List[Any], has_scrape_relationships: bool) -> int:
    configured = compat._parse_int(options.get('parallel_profiles', options.get('parallelProfiles')), 1)
    account_count = len(accounts) if accounts else 1
    configured_workers = max(1, min(account_count, configured))
    return 1 if has_scrape_relationships else configured_workers


def run_workflow_session(runner: WorkflowRunner) -> int:
    compat = compat_module()
    compat.emit_event('session_started', total_accounts=len(runner.accounts), workflow_id=runner.workflow_id)
    if not runner.accounts:
        compat.log('Нет профилей для запуска.')
        compat.emit_event('session_ended', status='failed', workflow_id=runner.workflow_id)
        return 2
    had_failures = _run_accounts(runner)
    _shutdown_runner_resources(runner)
    status, exit_code = _session_outcome(runner, had_failures)
    compat.emit_event('session_ended', status=status, workflow_id=runner.workflow_id)
    return exit_code


def _run_accounts(runner: WorkflowRunner) -> bool:
    if runner._has_scrape_relationships:
        return _run_scrape_queue(runner)
    return _run_parallel_accounts(runner)


def _run_scrape_queue(runner: WorkflowRunner) -> bool:
    compat = compat_module()
    had_failures = False
    if len(runner.accounts) > 1:
        compat.log(
            f'scrape_relationships: queueing {len(runner.accounts)} auth profiles '
            f'with sequential execution'
        )
    scrape_completed = False
    for index, account in enumerate(runner.accounts):
        if not runner.running:
            break
        had_failures = _process_runner_account(runner, account, had_failures)
        if runner._scrape_work_complete():
            scrape_completed = True
            _log_skipped_profiles(compat, account.username, len(runner.accounts) - index - 1)
            break
        _log_next_scrape_profile(compat, account.username, len(runner.accounts) - index - 1)
    return had_failures or (runner.running and not scrape_completed)


def _process_runner_account(runner: WorkflowRunner, account, had_failures: bool) -> bool:
    compat = compat_module()
    try:
        if not runner.process_account(account):
            had_failures = True
    except Exception as exc:
        had_failures = True
        compat.log(f'Ошибка профиля: {exc}')
    return had_failures


def _log_skipped_profiles(compat, username: str, remaining: int) -> None:
    if remaining <= 0:
        return
    compat.log(
        f'scrape_relationships: completed with @{username}; '
        f'skipping {remaining} queued profile(s)'
    )


def _log_next_scrape_profile(compat, username: str, remaining: int) -> None:
    if remaining <= 0:
        return
    compat.log(
        f'scrape_relationships: @{username} finished without completing '
        f'the scrape node; moving to next queued profile ({remaining} remaining)'
    )


def _run_parallel_accounts(runner: WorkflowRunner) -> bool:
    compat = compat_module()
    had_failures = False
    futures = []
    for account in runner.accounts:
        if not runner.running:
            break
        futures.append(runner._executor.submit(runner.process_account, account))
    for future in as_completed(futures):
        if not runner.running:
            break
        try:
            if not future.result():
                had_failures = True
        except Exception as exc:
            had_failures = True
            compat.log(f'Ошибка профиля: {exc}')
    return had_failures


def _shutdown_runner_resources(runner: WorkflowRunner) -> None:
    try:
        runner._executor.shutdown(wait=True)
    except Exception:
        pass
    try:
        runner.display_mgr.cleanup_all()
    except Exception:
        pass


def _session_outcome(runner: WorkflowRunner, had_failures: bool) -> tuple[str, int]:
    if not runner.running:
        return 'cancelled', 1
    if had_failures:
        return 'failed', 1
    return 'completed', 0
