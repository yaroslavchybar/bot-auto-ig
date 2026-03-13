import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from typing import Any, Dict, Optional

from python.runners.multi_account.account_session import process_account as process_account_impl
from python.runners.multi_account.activity_dispatch import (
    run_approve,
    run_follow,
    run_messages,
    run_scrolling,
    run_stories,
    run_unfollow,
)
from python.runners.multi_account.compat import compat as compat_module


class InstagramAutomationRunner:
    def __init__(self, config, accounts, workflow_id: Optional[str] = None):
        compat = compat_module()
        self.config = config
        self.accounts = accounts
        self.workflow_id = workflow_id
        self.running = True
        self.accounts_client = compat.InstagramAccountsClient()
        self.profiles_client = compat.ProfilesClient()
        self._profile_cache: Dict[str, Dict[str, Any]] = {}
        self._profile_cache_lock = Lock()
        configured = compat._parse_int(getattr(self.config, 'parallel_profiles', 1), 1)
        account_count = len(accounts) if accounts else 1
        self._max_workers = max(1, min(account_count, configured))
        self._executor = ThreadPoolExecutor(max_workers=self._max_workers)
        self._workflow_sessions: Dict[str, int] = {}
        if self.workflow_id:
            self._workflow_sessions = _load_workflow_sessions(self)

    def _get_cached_profile(self, profile_name: str):
        with self._profile_cache_lock:
            return self._profile_cache.get(profile_name)

    def _set_cached_profile(self, profile_name: str, profile_data: Dict[str, Any]) -> None:
        with self._profile_cache_lock:
            self._profile_cache[profile_name] = profile_data

    def stop(self) -> None:
        compat = compat_module()
        self.running = False
        compat.log('Остановка автоматизации...')
        _shutdown_executor(self._executor, wait=False)

    def run(self) -> int:
        return run_automation_session(self)

    def process_account(self, account) -> bool:
        return process_account_impl(self, account)

    def _run_scrolling(self, page, mode: str) -> None:
        run_scrolling(self, page, mode)

    def _run_stories(self, page) -> None:
        run_stories(self, page)

    def _run_follow(self, page, account, profile_data=None) -> None:
        run_follow(self, page, account, profile_data)

    def _run_unfollow_only(self, page, account, profile_data=None) -> None:
        run_unfollow(self, page, account, profile_data)

    def _run_approve_only(self, page, account) -> None:
        run_approve(self, page, account)

    def _run_message_only(self, page, account, profile_data=None, cached_targets=None) -> None:
        run_messages(self, page, account, profile_data, cached_targets)


def _load_workflow_sessions(runner) -> Dict[str, int]:
    try:
        workflow = runner.profiles_client.get_workflow(runner.workflow_id)
    except Exception:
        return {}
    if workflow and isinstance(workflow.get('profileSessions'), dict):
        return workflow['profileSessions']
    return {}


def run_automation_session(runner: InstagramAutomationRunner) -> int:
    compat = compat_module()
    compat.emit_event('session_started', total_accounts=len(runner.accounts))
    status = 'failed'
    try:
        if not runner.accounts:
            compat.log('Нет профилей для запуска.')
            return 2
        _run_cycles(runner)
        status = 'completed' if runner.running else 'cancelled'
        return 0 if runner.running else 1
    finally:
        _shutdown_executor(runner._executor, wait=True)
        compat.log('Автоматизация остановлена.')
        compat.emit_event('session_ended', status=status)


def _run_cycles(runner: InstagramAutomationRunner) -> None:
    compat = compat_module()
    while runner.running:
        work_done = _run_cycle(runner)
        if not runner.running:
            return
        if work_done:
            _sleep_seconds(runner, 5)
            continue
        compat.log('Все профили достигли лимита или пропущены. Жду 60 сек...')
        _sleep_seconds(runner, 60)


def _run_cycle(runner: InstagramAutomationRunner) -> bool:
    compat = compat_module()
    futures = []
    for account in runner.accounts:
        if not runner.running:
            break
        futures.append(runner._executor.submit(runner.process_account, account))
    work_done = False
    for future in as_completed(futures):
        if not runner.running:
            break
        try:
            if future.result():
                work_done = True
        except Exception as exc:
            compat.log(f'Ошибка профиля: {exc}')
    return work_done


def _sleep_seconds(runner: InstagramAutomationRunner, seconds: int) -> None:
    for _ in range(seconds):
        if not runner.running:
            return
        time.sleep(1)


def _shutdown_executor(executor, *, wait: bool) -> None:
    try:
        executor.shutdown(wait=wait, cancel_futures=not wait)
    except TypeError:
        try:
            executor.shutdown(wait=wait)
        except Exception:
            pass
    except Exception:
        pass
