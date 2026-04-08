import logging
import time
from typing import Any, Dict, Optional, Tuple

from python.runners.workflow.scrape_utils import (
    _build_scrape_export_payload,
    _convex_post_json,
    _dedupe_scraped_users,
    _delete_resume_snapshot,
    _local_scrape_artifact_relative_path,
    _load_users_from_local_artifact,
    _load_users_from_resume_snapshot,
    _load_users_from_storage,
    _resume_snapshot_path,
    _store_local_artifact_payload,
    _store_resume_snapshot,
)
from python.runners.workflow.io import log
from python.runners.workflow.parsing import (
    _normalize_string_list,
    _parse_bool,
    _parse_float,
    _parse_int,
    _parse_retry_backoff_seconds,
    _profile_daily_scraping_limit,
    _profile_daily_scraping_used,
    _profile_remaining_daily_scraping_capacity,
)
from python.runners.workflow.scrape_navigation import (  # noqa: F401
    open_relationship_view,
    scrape_relationship_chunk,
)

logger = logging.getLogger(__name__)

ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS = (1, 2, 4)
INTERRUPTIBLE_SLEEP_POLL_SECONDS = 0.1


class ScrapeRelationshipsExecutor:
    def __init__(
        self,
        runner,
        node_id: str,
        cfg: Dict[str, Any],
        page: Any,
        profile_name: str,
        profile_data: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.runner = runner
        self.node_id = node_id
        self.cfg = cfg
        self.page = page
        self.profile_name = profile_name
        self.profile_data = profile_data
        self.configured_targets = _normalize_string_list(cfg.get('targets'))
        self.use_account_usernames = _parse_bool(cfg.get('useAccountUsernames'), False)
        self.targets = list(self.configured_targets)
        self.kind_mode = self._parse_kind_mode(cfg.get('kind'))
        self.kind_queue = self._build_kind_queue(self.kind_mode)
        self.kind = self.kind_queue[0]
        self.chunk_limit = max(1, min(5000, _parse_int(cfg.get('chunkLimit'), 200)))
        self.followers_max_to_scrape = self._parse_max_to_scrape(cfg.get('followersMaxToScrape'))
        self.following_max_to_scrape = self._parse_max_to_scrape(cfg.get('followingMaxToScrape'))
        self.max_pages_per_attempt = max(1, min(100, _parse_int(cfg.get('maxPagesPerAttempt'), 3)))
        self.max_attempts = max(1, min(20, _parse_int(cfg.get('maxAttempts'), 4)))
        self.retry_backoff_seconds = _parse_retry_backoff_seconds(cfg.get('retryBackoffSeconds'))
        self.open_delay_seconds = max(0.0, min(60.0, _parse_float(cfg.get('openDelaySeconds'), 2.0)))
        self.state: Dict[str, Any] = {}
        self.artifact_storage_id = ''
        self.local_artifact_path = ''
        self.resume_snapshot_path = ''
        self.merged_users: list[Any] = []
        self.current_target_index = 0
        self.cursor: Optional[str] = None
        self.attempt = 0
        self.total_scraped = 0
        self.chunks_completed = 0
        self.target_scraped = 0
        self.failed_targets: list[Dict[str, Any]] = []
        self.profile_record: Dict[str, Any] = {}
        self.active_target_username: Optional[str] = None
        self.relationship_view_ready = False
        self.target_account_ids: Dict[str, str] = {}
        self.completed_kinds: list[str] = []
        self.completed_artifacts: list[Dict[str, Any]] = []

    def run(self) -> str:
        self._prepare_targets()
        if not self.targets:
            if self.use_account_usernames:
                log('scrape_relationships could not resolve any account usernames in status scraping')
            else:
                log('scrape_relationships requires at least one target username')
            return 'failure'
        self._load_state()
        self._prepare_profile_record()
        self._emit_initial_state()
        if _profile_remaining_daily_scraping_capacity(self.profile_record) == 0:
            return self._fail_due_to_daily_limit()

        while self.runner.running and self.current_target_index < len(self.targets):
            target_username = self.targets[self.current_target_index]
            relationship_error = self._ensure_relationship_view(target_username)
            chunk, elapsed_ms = self._fetch_chunk(target_username, relationship_error)
            result = self._handle_chunk_result(target_username, chunk, elapsed_ms)
            if result is not None:
                return result

        log(
            f'scrape_relationships: node {self.node_id} finished with running={self.runner.running} '
            f'kindMode={self.kind_mode} activeKind={self.kind} completedKinds={self.completed_kinds} '
            f'currentTargetIndex={self.current_target_index} targets={len(self.targets)}'
        )
        return 'failure' if not self.runner.running else 'success'

    def _parse_kind_mode(self, value: Any) -> str:
        lowered = str(value or '').strip().lower()
        if lowered == 'following':
            return 'following'
        if lowered == 'both':
            return 'both'
        return 'followers'

    def _build_kind_queue(self, kind_mode: str) -> list[str]:
        if kind_mode == 'both':
            return ['followers', 'following']
        return [kind_mode]

    def _parse_max_to_scrape(self, value: Any) -> Optional[int]:
        parsed = max(0, _parse_int(value, 0))
        if parsed == 0:
            return None
        return min(1000000, parsed)

    def _normalize_kind(self, value: Any) -> str:
        return 'following' if str(value or '').strip().lower() == 'following' else 'followers'

    def _active_max_to_scrape(self) -> Optional[int]:
        if self.kind == 'following':
            return self.following_max_to_scrape
        return self.followers_max_to_scrape

    def _remaining_target_scrape_allowance(self) -> Optional[int]:
        active_max = self._active_max_to_scrape()
        if active_max is None:
            return None
        return max(0, active_max - self.target_scraped)

    def _normalize_completed_kinds(self, kinds: Any) -> list[str]:
        values = kinds if isinstance(kinds, list) else []
        normalized: list[str] = []
        for raw in values:
            kind = self._normalize_kind(raw)
            if kind not in self.kind_queue or kind in normalized:
                continue
            normalized.append(kind)
        return [kind for kind in self.kind_queue if kind in normalized]

    def _normalize_completed_artifacts(self, artifacts: Any) -> list[Dict[str, Any]]:
        rows = artifacts if isinstance(artifacts, list) else []
        normalized: list[Dict[str, Any]] = []
        for row in rows:
            if isinstance(row, dict):
                normalized.append(dict(row))
        return normalized

    def _next_pending_kind(self) -> Optional[str]:
        completed = set(self.completed_kinds)
        for kind in self.kind_queue:
            if kind not in completed:
                return kind
        return None

    def _is_final_kind(self) -> bool:
        return self.kind == self.kind_queue[-1]

    def _node_state_patch(self, **extra: Any) -> Dict[str, Any]:
        patch: Dict[str, Any] = {
            'activityId': 'scrape_relationships',
            'useAccountUsernames': self.use_account_usernames,
            'kindMode': self.kind_mode,
            'kind': self.kind,
            'activeKind': self.kind,
            'followersMaxToScrape': self.followers_max_to_scrape or 0,
            'followingMaxToScrape': self.following_max_to_scrape or 0,
            'activeMaxToScrape': self._active_max_to_scrape() or 0,
            'completedKinds': list(self.completed_kinds),
            'completedArtifacts': list(self.completed_artifacts),
            'targets': self.targets,
            'currentTargetIndex': self.current_target_index,
            'cursor': self.cursor,
            'attempt': self.attempt,
            'scraped': self.total_scraped,
            'deduped': len(self.merged_users),
            'chunksCompleted': self.chunks_completed,
            'targetScraped': self.target_scraped,
            'completedTargets': self.current_target_index,
            'failedTargets': self.failed_targets,
            'artifactStorageId': self.artifact_storage_id or None,
            'localArtifactPath': self.local_artifact_path or None,
            'resumeSnapshotPath': self.resume_snapshot_path or None,
            'updatedAt': int(time.time() * 1000),
        }
        patch.update(extra)
        return patch

    def _prepare_targets(self) -> None:
        if not self.use_account_usernames:
            self.targets = list(self.configured_targets)
            self.target_account_ids = {}
            return
        existing_state = self.runner._get_node_state(self.node_id)
        scraping_accounts = self.runner.accounts_client.list_scraping_accounts_by_status('need_scraping')
        self.target_account_ids = self._build_target_account_ids(scraping_accounts)
        if self._should_resume_account_targets(existing_state):
            self.targets = _normalize_string_list(existing_state.get('targets'))
            return
        self.targets = []
        seen: set[str] = set()
        for account in scraping_accounts:
            username = self._normalize_account_username(account.get('user_name'))
            if not username or username in seen:
                continue
            seen.add(username)
            self.targets.append(username)

    def _should_resume_account_targets(self, state: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(state, dict):
            return False
        if not _parse_bool(state.get('useAccountUsernames'), False):
            return False
        if state.get('done') or str(state.get('status') or '').strip().lower() == 'completed':
            return False
        return bool(_normalize_string_list(state.get('targets')))

    def _build_target_account_ids(self, accounts: Any) -> Dict[str, str]:
        mapping: Dict[str, str] = {}
        rows = accounts if isinstance(accounts, list) else []
        for account in rows:
            if not isinstance(account, dict):
                continue
            username = self._normalize_account_username(account.get('user_name'))
            account_id = str(account.get('id') or '').strip()
            if not username or not account_id or username in mapping:
                continue
            mapping[username] = account_id
        return mapping

    def _normalize_account_username(self, value: Any) -> str:
        cleaned = str(value or '').strip()
        if cleaned.startswith('@'):
            cleaned = cleaned[1:]
        cleaned = cleaned.strip().strip('/')
        return cleaned.lower()

    def _load_state(self) -> None:
        existing_state = self.runner._get_node_state(self.node_id)
        self.state = dict(existing_state) if isinstance(existing_state, dict) else {}
        state_kind_mode = self._parse_kind_mode(self.state.get('kindMode') or self.state.get('kind'))
        if (
            state_kind_mode != self.kind_mode
            or _parse_bool(self.state.get('useAccountUsernames'), False) != self.use_account_usernames
            or _normalize_string_list(self.state.get('targets')) != self.targets
        ):
            _delete_resume_snapshot(self.state.get('resumeSnapshotPath'))
            self.state = {}
        stale_index = max(0, _parse_int(self.state.get('currentTargetIndex'), 0))
        should_reset = self.state.get('done') or str(self.state.get('status') or '').strip().lower() == 'completed'
        if should_reset or stale_index > len(self.targets):
            self._reset_stale_state(stale_index)
        self._hydrate_resume_state()

    def _reset_stale_state(self, stale_index: int) -> None:
        if not self.state:
            return
        _delete_resume_snapshot(self.state.get('resumeSnapshotPath'))
        log(
            f'scrape_relationships: clearing stale resume state for node {self.node_id} '
            f'(status={self.state.get("status")}, done={self.state.get("done")}, '
            f'currentTargetIndex={stale_index}, targets={len(self.targets)})'
        )
        self.state = {}

    def _hydrate_resume_state(self) -> None:
        self.completed_kinds = self._normalize_completed_kinds(self.state.get('completedKinds'))
        self.completed_artifacts = self._normalize_completed_artifacts(self.state.get('completedArtifacts'))
        active_kind = str(self.state.get('activeKind') or self.state.get('kind') or '').strip().lower()
        active_kind = self._normalize_kind(active_kind) if active_kind else ''
        next_kind = self._next_pending_kind()
        if active_kind and active_kind in self.kind_queue and active_kind not in self.completed_kinds:
            self.kind = active_kind
        elif next_kind is not None:
            self.kind = next_kind
        else:
            self.kind = self.kind_queue[-1]

        self.artifact_storage_id = str(self.state.get('artifactStorageId') or '').strip()
        self.local_artifact_path = str(self.state.get('localArtifactPath') or '').strip()
        self.resume_snapshot_path = str(self.state.get('resumeSnapshotPath') or '').strip()
        self.merged_users = self._load_merged_users()
        self.current_target_index = max(0, _parse_int(self.state.get('currentTargetIndex'), 0))
        self.cursor = str(self.state.get('cursor') or '').strip() or None
        self.attempt = max(0, _parse_int(self.state.get('attempt'), 0))
        self.total_scraped = max(0, _parse_int(self.state.get('scraped'), len(self.merged_users)))
        self.chunks_completed = max(0, _parse_int(self.state.get('chunksCompleted'), 0))
        self.target_scraped = max(0, _parse_int(self.state.get('targetScraped'), 0))
        failed_targets = self.state.get('failedTargets')
        self.failed_targets = failed_targets if isinstance(failed_targets, list) else []

    def _load_merged_users(self) -> list[Any]:
        if self.artifact_storage_id:
            users = _load_users_from_storage(self.artifact_storage_id)
        elif self.local_artifact_path:
            users = _load_users_from_local_artifact(self.local_artifact_path)
        elif self.resume_snapshot_path:
            users = _load_users_from_resume_snapshot(self.resume_snapshot_path)
        else:
            users = []
        return _dedupe_scraped_users(users)

    def _prepare_profile_record(self) -> None:
        profile_record = dict(self.profile_data) if isinstance(self.profile_data, dict) else {}
        if not profile_record:
            cached_profile = self.runner._get_cached_profile(self.profile_name)
            if isinstance(cached_profile, dict):
                profile_record = dict(cached_profile)
        self.profile_record = profile_record
        if profile_record:
            self.runner._set_cached_profile(self.profile_name, profile_record)

    def _emit_initial_state(self) -> None:
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                manifestStorageId=self.state.get('manifestStorageId'),
                lastError=None,
                lastErrorCode=None,
            ),
        )
        log(
            f'scrape_relationships: starting node {self.node_id} kindMode={self.kind_mode} '
            f'activeKind={self.kind} completedKinds={self.completed_kinds} '
            f'targets={len(self.targets)} chunkLimit={self.chunk_limit} '
            f'followersMaxToScrape={self.followers_max_to_scrape or 0} '
            f'followingMaxToScrape={self.following_max_to_scrape or 0} '
            f'maxPagesPerAttempt={self.max_pages_per_attempt} maxAttempts={self.max_attempts} '
            f'accountTargets={self.use_account_usernames} resumeIndex={self.current_target_index} '
            f"resumeCursor={'yes' if self.cursor else 'no'}"
        )

    def _fail_due_to_daily_limit(self) -> str:
        limit = _profile_daily_scraping_limit(self.profile_record)
        used = _profile_daily_scraping_used(self.profile_record)
        if limit is None:
            return 'failure'
        self._persist_resume_snapshot_if_needed()
        message = (
            f'scrape_relationships: profile {self.profile_name} reached daily scraping '
            f'limit ({used}/{limit})'
        )
        target_username = self._current_target_username()
        if target_username:
            self.failed_targets = [
                *self.failed_targets,
                {
                    'targetUsername': target_username,
                    'errorCode': 'daily_scraping_limit_reached',
                    'errorMessage': message,
                },
            ]
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                status='failed',
                lastError=message,
                lastErrorCode='daily_scraping_limit_reached',
            ),
        )
        log(message)
        return 'failure'

    def _persist_resume_snapshot_if_needed(self) -> None:
        if not self.merged_users or self.artifact_storage_id or self.resume_snapshot_path:
            return
        try:
            self.resume_snapshot_path = _store_resume_snapshot(
                _resume_snapshot_path(self.runner.workflow_id, self.node_id),
                _build_scrape_export_payload(
                    self.runner.workflow_id,
                    self.node_id,
                    self.profile_name,
                    self.kind,
                    self.targets,
                    self.merged_users,
                ),
            )
        except Exception as exc:
            logger.exception(
                'Failed to persist resume snapshot for workflow %s node %s: %s',
                self.runner.workflow_id,
                self.node_id,
                exc,
            )

    def _current_target_username(self) -> Optional[str]:
        if 0 <= self.current_target_index < len(self.targets):
            return self.targets[self.current_target_index]
        return None

    def _ensure_relationship_view(self, target_username: str) -> Optional[Tuple[str, str]]:
        should_open = not self.relationship_view_ready or self.active_target_username != target_username
        if not should_open:
            return None
        try:
            self._open_target_profile(target_username)
        except Exception as exc:
            log(f'Error opening @{target_username}: {exc}')
            return ('profile_open_failed', str(exc))
        relationship_error = self.runner._open_relationship_view(
            self.page,
            target_username=target_username,
            kind=self.kind,
        )
        if relationship_error is None:
            self.active_target_username = target_username
            self.relationship_view_ready = True
        return relationship_error

    def _open_target_profile(self, target_username: str) -> None:
        log(
            f'scrape_relationships @{target_username}: target '
            f'{self.current_target_index + 1}/{len(self.targets)} open profile start'
        )
        self.page.goto(
            f'https://www.instagram.com/{target_username}/',
            wait_until='domcontentloaded',
            timeout=60000,
        )
        if self.open_delay_seconds > 0:
            self.page.wait_for_timeout(int(self.open_delay_seconds * 1000))
        log(
            f'scrape_relationships @{target_username}: profile opened '
            f'(delay={self.open_delay_seconds:.1f}s)'
        )

    def _fetch_chunk(self, target_username: str, relationship_error: Optional[Tuple[str, str]]) -> Tuple[Dict[str, Any], int]:
        if relationship_error is not None:
            error_code, error_message = relationship_error
            return self._build_error_chunk(error_code, error_message), 0
        chunk_started_at = time.time()
        remaining_capacity = _profile_remaining_daily_scraping_capacity(self.profile_record)
        if remaining_capacity == 0:
            return {'outcome': 'daily_limit'}, 0
        remaining_target_allowance = self._remaining_target_scrape_allowance()
        if remaining_target_allowance == 0:
            return {'outcome': 'target_cap_reached'}, 0
        effective_chunk_limit = self.chunk_limit
        if remaining_capacity is not None:
            effective_chunk_limit = min(effective_chunk_limit, remaining_capacity)
        if remaining_target_allowance is not None:
            effective_chunk_limit = min(effective_chunk_limit, remaining_target_allowance)
        effective_chunk_limit = max(1, effective_chunk_limit)
        chunk = self.runner._scrape_relationship_chunk(
            self.page,
            target_username=target_username,
            kind=self.kind,
            cursor=self.cursor,
            chunk_limit=effective_chunk_limit,
            max_pages=self.max_pages_per_attempt,
        )
        elapsed_ms = int(round((time.time() - chunk_started_at) * 1000))
        return chunk, elapsed_ms

    def _build_error_chunk(self, error_code: str, error_message: str) -> Dict[str, Any]:
        return {
            'outcome': 'fatal_error',
            'users': [],
            'nextCursor': self.cursor,
            'hasMore': bool(self.cursor),
            'total': None,
            'statusCode': None,
            'errorCode': error_code,
            'errorMessage': error_message,
        }

    def _handle_chunk_result(self, target_username: str, chunk: Dict[str, Any], elapsed_ms: int) -> Optional[str]:
        if chunk.get('outcome') == 'daily_limit':
            return self._fail_due_to_daily_limit()
        if chunk.get('outcome') == 'target_cap_reached':
            log(
                f'scrape_relationships @{target_username}: target cap already reached '
                f'(kind={self.kind}, total={self.target_scraped}/{self._active_max_to_scrape() or 0})'
            )
            return self._update_after_success(target_username, False, completion_reason='capped')
        outcome, error_code, error_message, chunk_users, chunk_debug = self._normalize_chunk(chunk)
        if outcome == 'success':
            return self._handle_success_chunk(
                target_username,
                chunk,
                chunk_users,
                chunk_debug,
                elapsed_ms,
            )
        if self._maybe_schedule_retry(target_username, outcome, error_code, error_message):
            return None
        if not self.runner.running:
            return 'failure'
        return self._fail_target(target_username, outcome, error_code, error_message)

    def _normalize_chunk(
        self,
        chunk: Dict[str, Any],
    ) -> Tuple[str, Optional[str], Optional[str], list[Any], Dict[str, Any]]:
        outcome = str(chunk.get('outcome') or '')
        error_code = str(chunk.get('errorCode') or '').strip() or None
        error_message = str(chunk.get('errorMessage') or '').strip() or None
        chunk_users = chunk.get('users') if isinstance(chunk.get('users'), list) else []
        chunk_debug = chunk.get('debug') if isinstance(chunk.get('debug'), dict) else {}
        return outcome, error_code, error_message, chunk_users, chunk_debug

    def _handle_success_chunk(
        self,
        target_username: str,
        chunk: Dict[str, Any],
        chunk_users: list[Any],
        chunk_debug: Dict[str, Any],
        elapsed_ms: int,
    ) -> Optional[str]:
        chunk_users, next_cursor, has_more, next_target_scraped, capped_by_limit = self._apply_target_scrape_cap(
            chunk,
            chunk_users,
        )
        expected_total = chunk.get('total') if isinstance(chunk.get('total'), int) else None
        if self._is_unexpected_empty_result(has_more, expected_total, next_target_scraped):
            message = f'{self.kind} list for @{target_username} returned zero users but profile metadata reported {expected_total}'
            return self._fail_target(target_username, 'fatal_error', 'unexpected_empty_result', message)
        self._record_success_progress(chunk_users, next_cursor, next_target_scraped)
        self._log_success_chunk(
            target_username,
            chunk_users,
            chunk_debug,
            elapsed_ms,
            has_more,
            expected_total,
            next_target_scraped,
            capped_by_limit,
        )
        return self._update_after_success(
            target_username,
            has_more,
            completion_reason='capped' if capped_by_limit else None,
        )

    def _apply_target_scrape_cap(
        self,
        chunk: Dict[str, Any],
        chunk_users: list[Any],
    ) -> Tuple[list[Any], Optional[str], bool, int, bool]:
        next_cursor = str(chunk.get('nextCursor') or '').strip() or None
        has_more = bool(chunk.get('hasMore')) and bool(next_cursor)
        remaining_target_allowance = self._remaining_target_scrape_allowance()
        if remaining_target_allowance is None:
            return chunk_users, next_cursor, has_more, self.target_scraped + len(chunk_users), False

        trimmed_users = chunk_users[:remaining_target_allowance]
        next_target_scraped = self.target_scraped + len(trimmed_users)
        active_max = self._active_max_to_scrape()
        capped_by_limit = bool(active_max is not None and next_target_scraped >= active_max)
        if capped_by_limit:
            next_cursor = None
            has_more = False
        return trimmed_users, next_cursor, has_more, next_target_scraped, capped_by_limit

    def _is_unexpected_empty_result(self, has_more: bool, expected_total: Optional[int], next_target_scraped: int) -> bool:
        return not has_more and expected_total is not None and expected_total > 0 and next_target_scraped == 0

    def _record_success_progress(self, chunk_users: list[Any], next_cursor: Optional[str], next_target_scraped: int) -> None:
        if chunk_users:
            self.runner._record_daily_scraping_usage(self.profile_name, len(chunk_users))
            cached_profile = self.runner._get_cached_profile(self.profile_name)
            if isinstance(cached_profile, dict):
                self.profile_record = dict(cached_profile)
        self.merged_users = _dedupe_scraped_users(self.merged_users + chunk_users)
        self.total_scraped += len(chunk_users)
        self.chunks_completed += 1
        self.cursor = next_cursor
        self.target_scraped = next_target_scraped

    def _log_success_chunk(
        self,
        target_username: str,
        chunk_users: list[Any],
        chunk_debug: Dict[str, Any],
        elapsed_ms: int,
        has_more: bool,
        expected_total: Optional[int],
        next_target_scraped: int,
        capped_by_limit: bool,
    ) -> None:
        reported_total = expected_total if expected_total is not None else '?'
        label = 'chunk saved' if has_more else 'final chunk'
        if capped_by_limit:
            label = 'cap reached'
        total_value = next_target_scraped
        suffix = ' nextCursor=yes' if has_more else ''
        if capped_by_limit:
            suffix = f' cap={self._active_max_to_scrape() or 0}'
        log(
            f'scrape_relationships @{target_username}: {label} '
            f'rows={len(chunk_users)} total={total_value}/{reported_total} '
            f"deduped={len(self.merged_users)} pages={chunk_debug.get('pagesFetched') or '-'} "
            f'elapsedMs={elapsed_ms} kind={self.kind}{suffix}'
        )

    def _update_after_success(
        self,
        target_username: str,
        has_more: bool,
        completion_reason: Optional[str] = None,
    ) -> Optional[str]:
        should_resume = has_more and completion_reason is None
        if should_resume:
            self._store_resume_snapshot()
        else:
            completion_error = self._complete_target(target_username, completion_reason=completion_reason)
            if completion_error is not None:
                error_code, error_message = completion_error
                return self._fail_target(target_username, 'fatal_error', error_code, error_message)
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                lastError=None,
                lastErrorCode=None,
            ),
        )
        progress = 100 if not has_more and self.current_target_index >= len(self.targets) else min(
            99,
            int(round(100.0 * (self.current_target_index / max(1, len(self.targets))))),
        )
        self.runner._emit_node_state(
            'task_progress',
            self.node_id,
            self.profile_name,
            task=f'Scraped @{target_username}',
            targetUsername=target_username,
            scraped=0,
            totalScraped=self.total_scraped,
            deduped=len(self.merged_users),
            hasMore=should_resume,
            nextCursor=self.cursor,
            kind=self.kind,
            kindMode=self.kind_mode,
            completedKinds=list(self.completed_kinds),
            completedTargets=self.current_target_index,
            progress=progress,
        )
        if self.current_target_index >= len(self.targets):
            return self._complete_active_kind()
        return None

    def _store_resume_snapshot(self) -> None:
        self.artifact_storage_id = ''
        self.local_artifact_path = ''
        try:
            self.resume_snapshot_path = _store_resume_snapshot(
                _resume_snapshot_path(self.runner.workflow_id, self.node_id),
                _build_scrape_export_payload(
                    self.runner.workflow_id,
                    self.node_id,
                    self.profile_name,
                    self.kind,
                    self.targets,
                    self.merged_users,
                ),
            )
        except Exception as exc:
            logger.exception(
                'Failed to store resume snapshot for workflow %s node %s profile %s kind %s: %s',
                self.runner.workflow_id,
                self.node_id,
                self.profile_name,
                self.kind,
                exc,
            )

    def _complete_target(
        self,
        target_username: str,
        completion_reason: Optional[str] = None,
    ) -> Optional[Tuple[str, str]]:
        if self.use_account_usernames and self._is_final_kind():
            try:
                self._mark_target_account_done(target_username)
            except Exception as exc:
                return ('account_status_update_failed', f'Failed to mark @{target_username} done after scrape: {exc}')
        self.current_target_index += 1
        self.cursor = None
        self.attempt = 0
        self.target_scraped = 0
        self.active_target_username = None
        self.relationship_view_ready = False
        if self.current_target_index < len(self.targets):
            self._store_resume_snapshot()
        else:
            _delete_resume_snapshot(self.resume_snapshot_path)
            self.resume_snapshot_path = ''
        reason_suffix = ''
        if completion_reason == 'capped':
            reason_suffix = f' cap={self._active_max_to_scrape() or 0}'
        log(
            f'scrape_relationships @{target_username}: target completed '
            f'(kind={self.kind}, totalScraped={self.total_scraped}, deduped={len(self.merged_users)}{reason_suffix})'
        )
        return None

    def _mark_target_account_done(self, target_username: str) -> None:
        normalized = self._normalize_account_username(target_username)
        account_id = self.target_account_ids.get(normalized)
        if not account_id:
            raise RuntimeError('target account id not found in scraping pool')
        self.runner.accounts_client.update_scraping_account_status(account_id, status='done')
        self.target_account_ids.pop(normalized, None)

    def _complete_active_kind(self) -> Optional[str]:
        completed_kind = self.kind
        local_artifact_path, queue_error = self._queue_completed_kind_locally(completed_kind)
        if queue_error is not None:
            error_code, error_message = queue_error
            return self._fail_node_completion(error_code, error_message)
        artifact_payload = self._artifact_row_payload(
            completed_kind,
            local_artifact_path=local_artifact_path,
        )
        artifact_row, artifact_upsert_error = self._upsert_artifact_row(artifact_payload)
        if artifact_row is None:
            return self._fail_node_completion(
                'artifact_upsert_failed',
                f'Failed to persist queued scrape history row: {artifact_upsert_error or "unknown error"}',
            )
        artifact_record = {
            'kind': completed_kind,
            'artifactId': (artifact_row or {}).get('_id'),
            'localArtifactPath': local_artifact_path,
            'imported': False,
        }
        self.completed_artifacts = [*self.completed_artifacts, artifact_record]
        if completed_kind not in self.completed_kinds:
            self.completed_kinds = [*self.completed_kinds, completed_kind]

        next_kind = self._next_pending_kind()
        if next_kind is None:
            return self._complete_node(artifact_row, artifact_upsert_error)
        return self._start_next_kind(next_kind, artifact_record)

    def _start_next_kind(self, next_kind: str, artifact_record: Dict[str, Any]) -> Optional[str]:
        self.kind = next_kind
        self.artifact_storage_id = ''
        self.local_artifact_path = ''
        self.resume_snapshot_path = ''
        self.merged_users = []
        self.current_target_index = 0
        self.cursor = None
        self.attempt = 0
        self.total_scraped = 0
        self.chunks_completed = 0
        self.target_scraped = 0
        self.failed_targets = []
        self.active_target_username = None
        self.relationship_view_ready = False
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                status='running',
                done=False,
                manifestStorageId=None,
                artifactId=None,
                artifactUpsertFailedAt=None,
                artifactUpsertError=None,
                artifactUpsertPayload=None,
                lastCompletedKind=artifact_record.get('kind'),
                lastError=None,
                lastErrorCode=None,
            ),
        )
        self.runner._emit_node_state(
            'task_progress',
            self.node_id,
            self.profile_name,
            task=f'Starting {next_kind} pass',
            kind=self.kind,
            kindMode=self.kind_mode,
            completedKinds=list(self.completed_kinds),
            completedTargets=0,
            progress=0,
        )
        log(
            f'scrape_relationships: node {self.node_id} continuing with next pass '
            f'kind={next_kind} completedKinds={self.completed_kinds}'
        )
        return None

    def _complete_node(
        self,
        artifact_row: Optional[Dict[str, Any]] = None,
        artifact_upsert_error: Optional[str] = None,
    ) -> str:
        if artifact_row is None and artifact_upsert_error is None:
            return self._fail_node_completion(
                'artifact_upsert_failed',
                'Expected a completed queued artifact row before final node completion',
            )
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                status='completed',
                attempt=0,
                cursor=None,
                done=True,
                targetScraped=0,
                artifactStorageId=None,
                localArtifactPath=self.local_artifact_path or None,
                manifestStorageId=None,
                artifactId=(artifact_row or {}).get('_id'),
                artifactUpsertFailedAt=None,
                artifactUpsertError=None,
                artifactUpsertPayload=None,
                resumeSnapshotPath=None,
                lastCompletedKind=self.kind,
            ),
        )
        log(
            f'scrape_relationships: node {self.node_id} completed '
            f'(kindMode={self.kind_mode}, completedKinds={self.completed_kinds}, '
            f'targets={len(self.targets)}, totalScraped={self.total_scraped}, deduped={len(self.merged_users)})'
        )
        return 'success'

    def _fail_node_completion(self, error_code: str, error_message: str) -> str:
        self.artifact_storage_id = ''
        self.local_artifact_path = ''
        logger.exception(
            'Failed to finalize scrape_relationships artifact for workflow %s node %s profile %s kind %s: %s',
            self.runner.workflow_id,
            self.node_id,
            self.profile_name,
            self.kind,
            error_message,
        )
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                status='failed',
                lastError=error_message,
                lastErrorCode=error_code,
                artifactStorageId=None,
                localArtifactPath=None,
                manifestStorageId=None,
                artifactId=None,
                artifactUpsertFailedAt=None,
                artifactUpsertError=None,
                artifactUpsertPayload=None,
            ),
        )
        log(
            f'scrape_relationships: node {self.node_id} failed during completion '
            f'({error_code}: {error_message})'
        )
        return 'failure'

    def _processing_metadata(self) -> Dict[str, Any]:
        return {
            'activityId': 'scrape_relationships',
            'failedTargets': self.failed_targets,
            'useAccountUsernames': self.use_account_usernames,
            'kindMode': self.kind_mode,
        }

    def _artifact_row_payload(
        self,
        kind: str,
        *,
        local_artifact_path: str,
    ) -> Dict[str, Any]:
        node_label = (self.runner._get_node_state(self.node_id) or {}).get('label') or 'Scrape Relationships'
        return {
            'workflowId': self.runner.workflow_id,
            'workflowName': self.runner.workflow_name,
            'nodeId': self.node_id,
            'nodeLabel': node_label,
            'kind': kind,
            'targets': self.targets,
            'targetUsername': '\n'.join(self.targets),
            'status': 'completed',
            'imported': False,
            'sourceProfileName': self.profile_name,
            'lastRunAt': int(time.time() * 1000),
            'localArtifactPath': local_artifact_path,
            'stats': {
                'scraped': self.total_scraped,
                'deduped': len(self.merged_users),
                'chunksCompleted': self.chunks_completed,
                'targetsCompleted': self.current_target_index,
            },
            'metadata': {
                **self._processing_metadata(),
                'processingMode': 'manual_queue',
                'artifactSource': 'local_file',
                'localArtifactPath': local_artifact_path,
            },
        }

    def _queue_completed_kind_locally(
        self,
        completed_kind: str,
    ) -> Tuple[str, Optional[Tuple[str, str]]]:
        try:
            local_artifact_path = _local_scrape_artifact_relative_path(
                self.runner.workflow_id,
                self.node_id,
                completed_kind,
            )
            payload = _build_scrape_export_payload(
                self.runner.workflow_id,
                self.node_id,
                self.profile_name,
                completed_kind,
                self.targets,
                self.merged_users,
            )
            _store_local_artifact_payload(local_artifact_path, payload)
        except Exception as exc:
            return '', (
                'local_artifact_store_failed',
                f'Failed to queue scrape artifact locally: {exc}',
            )

        log(
            f'scrape_relationships: queued node {self.node_id} '
            f'kind={completed_kind} localArtifactPath={local_artifact_path} '
            f'rows={len(self.merged_users)}'
        )
        self.local_artifact_path = local_artifact_path
        return local_artifact_path, None

    def _upsert_artifact_row(
        self,
        payload: Dict[str, Any],
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        log_payload = {
            'workflowId': payload.get('workflowId'),
            'nodeId': payload.get('nodeId'),
            'activityId': (payload.get('metadata') or {}).get('activityId'),
            'kind': payload.get('kind'),
        }
        attempts = len(ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS) + 1
        last_error: Optional[str] = None
        for attempt_index in range(attempts):
            try:
                artifact_row = _convex_post_json('/api/workflow-artifacts/upsert', payload)
                if attempt_index:
                    log(
                        f'scrape_relationships: artifact upsert recovered for node {self.node_id} '
                        f'on attempt {attempt_index + 1}/{attempts}'
                    )
                return artifact_row, None
            except Exception as exc:
                last_error = str(exc)
                logger.exception(
                    'scrape_relationships artifact upsert failed '
                    '(attempt %s/%s, payload=%s)',
                    attempt_index + 1,
                    attempts,
                    log_payload,
                )
                log(
                    f'scrape_relationships: artifact upsert failed for node {self.node_id} '
                    f'attempt {attempt_index + 1}/{attempts} '
                    f'(workflowId={log_payload["workflowId"]}, nodeId={log_payload["nodeId"]}, '
                    f'activityId={log_payload["activityId"]}, kind={log_payload["kind"]}): {exc}'
                )
                if attempt_index >= attempts - 1:
                    break
                delay_seconds = ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS[attempt_index]
                log(
                    f'scrape_relationships: retrying artifact upsert for node {self.node_id} '
                    f'in {delay_seconds}s'
                )
                time.sleep(delay_seconds)
        log(
            f'scrape_relationships: artifact upsert exhausted retries for node {self.node_id}; '
            f'continuing with local artifact storage only '
            f'(workflowId={log_payload["workflowId"]}, nodeId={log_payload["nodeId"]}, '
            f'activityId={log_payload["activityId"]}, kind={log_payload["kind"]})'
        )
        return None, last_error

    def _maybe_schedule_retry(
        self,
        target_username: str,
        outcome: str,
        error_code: Optional[str],
        error_message: Optional[str],
    ) -> bool:
        retryable = outcome in {'retryable_error', 'rate_limited'}
        if not (retryable and self.attempt + 1 < self.max_attempts and self.runner.running):
            return False
        self.attempt += 1
        self.relationship_view_ready = False
        delay_seconds = self.retry_backoff_seconds[min(self.attempt - 1, len(self.retry_backoff_seconds) - 1)]
        log(
            f'scrape_relationships @{target_username}: scheduling retry '
            f'{self.attempt}/{self.max_attempts} in {delay_seconds}s '
            f'(kind={self.kind}, errorCode={error_code or "-"}, message={error_message or "-"})'
        )
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                lastError=error_message,
                lastErrorCode=error_code,
            ),
        )
        self.runner._emit_node_state(
            'task_progress',
            self.node_id,
            self.profile_name,
            task=f'Retrying @{target_username}',
            targetUsername=target_username,
            errorMessage=error_message,
            errorCode=error_code,
            retryInSeconds=delay_seconds,
            attempt=self.attempt,
            kind=self.kind,
            kindMode=self.kind_mode,
            completedKinds=list(self.completed_kinds),
        )
        deadline = time.time() + delay_seconds
        while self.runner.running:
            remaining_seconds = deadline - time.time()
            if remaining_seconds <= 0:
                return True
            time.sleep(min(INTERRUPTIBLE_SLEEP_POLL_SECONDS, remaining_seconds))
        return False

    def _fail_target(
        self,
        target_username: str,
        outcome: str,
        error_code: Optional[str],
        error_message: Optional[str],
    ) -> str:
        retryable = outcome in {'retryable_error', 'rate_limited'}
        self.failed_targets = [
            *self.failed_targets,
            {
                'targetUsername': target_username,
                'errorCode': error_code,
                'errorMessage': error_message,
            },
        ]
        self.runner._update_node_state(
            self.node_id,
            **self._node_state_patch(
                status='failed',
                attempt=self.attempt + (1 if retryable else 0),
                lastError=error_message,
                lastErrorCode=error_code,
            ),
        )
        log(
            f"Error scrape_relationships @{target_username}: "
            f"{error_code or outcome or 'unknown_error'} {error_message or ''}".strip()
        )
        return 'failure'


def execute_scrape_relationships(
    runner,
    node_id: str,
    cfg: Dict[str, Any],
    page: Any,
    profile_name: str,
    profile_data: Optional[Dict[str, Any]] = None,
) -> str:
    executor = ScrapeRelationshipsExecutor(
        runner,
        node_id,
        cfg,
        page,
        profile_name,
        profile_data,
    )
    return executor.run()
