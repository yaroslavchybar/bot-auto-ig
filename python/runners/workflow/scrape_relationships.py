import logging
import time
from typing import Any, Dict, Optional, Tuple

from python.runners.workflow.compat import compat as compat_module
from python.runners.workflow.scrape_script import RELATIONSHIP_CHUNK_SCRIPT

logger = logging.getLogger(__name__)

ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS = (1, 2, 4)
INTERRUPTIBLE_SLEEP_POLL_SECONDS = 0.1


def open_relationship_view(
    runner,
    page: Any,
    *,
    target_username: str,
    kind: str,
) -> Optional[Tuple[str, str]]:
    compat = compat_module()
    normalized_target = str(target_username or '').strip().strip('/').lower()
    compat.log(f'scrape_relationships @{normalized_target}: opening {kind} list')
    clicked_selector, click_error = _click_relationship_link(page, normalized_target, kind)
    if not clicked_selector:
        return _relationship_link_error(compat, normalized_target, kind, click_error)
    return _wait_for_relationship_ui(compat, page, normalized_target, kind)


def _click_relationship_link(page: Any, normalized_target: str, kind: str) -> Tuple[Optional[str], Optional[Exception]]:
    clicked_selector, click_error = _click_via_selector(page, normalized_target, kind)
    if clicked_selector:
        return clicked_selector, None
    return _click_via_locators(page, kind, click_error)


def _click_via_selector(page: Any, normalized_target: str, kind: str) -> Tuple[Optional[str], Optional[Exception]]:
    selectors = [
        f'a[href="/{normalized_target}/{kind}/"]',
        f'a[href="/{normalized_target}/{kind}"]',
        f'a[href$="/{kind}/"]',
        f'a[href$="/{kind}"]',
        f'a[href*="/{kind}/"]',
        f'a[href*="/{kind}"]',
    ]
    try:
        clicked_selector = page.evaluate(
            """
            ({ selectors }) => {
              for (const selector of selectors) {
                const el = document.querySelector(selector)
                if (el instanceof HTMLElement) {
                  el.click()
                  return selector
                }
              }
              return null
            }
            """,
            {'selectors': selectors},
        )
        return clicked_selector, None
    except Exception as exc:
        return None, exc


def _click_via_locators(page: Any, kind: str, click_error: Optional[Exception]) -> Tuple[Optional[str], Optional[Exception]]:
    label = 'Followers' if kind == 'followers' else 'Following'
    locators = [
        ('role link', page.get_by_role('link', name=label, exact=True).first),
        ('header link', page.locator('header a', has_text=label).first),
        ('header section link', page.locator('header section a', has_text=label).first),
        ('text link', page.locator('a', has_text=label).first),
    ]
    for description, locator in locators:
        try:
            locator.click(timeout=2000)
            return description, None
        except Exception as exc:
            click_error = exc
    return None, click_error


def _relationship_link_error(
    compat,
    normalized_target: str,
    kind: str,
    click_error: Optional[Exception],
) -> Tuple[str, str]:
    if click_error is not None:
        compat.log(
            f'scrape_relationships @{normalized_target}: failed to resolve {kind} link '
            f'via in-page click: {click_error}'
        )
    return (
        'relationship_link_not_found',
        f'Could not find {kind} link on @{normalized_target}',
    )


def _wait_for_relationship_ui(
    compat,
    page: Any,
    normalized_target: str,
    kind: str,
) -> Optional[Tuple[str, str]]:
    try:
        page.wait_for_function(
            r"""
            ({ targetUsername, kind }) => {
              const normalizedPath = String(window.location.pathname || '')
                .toLowerCase()
                .replace(/\/+$/, '/')
              if (normalizedPath.includes(`/${targetUsername}/${kind}/`)) {
                return true
              }
              if (normalizedPath.endsWith(`/${kind}/`) || normalizedPath.includes(`/${kind}/`)) {
                return true
              }
              return Boolean(document.querySelector('div[role="dialog"]'))
            }
            """,
            arg={'targetUsername': normalized_target, 'kind': kind},
            timeout=7000,
        )
        compat.log(f'scrape_relationships @{normalized_target}: {kind} UI opened')
        return None
    except Exception as exc:
        return (
            'relationship_open_failed',
            f'Failed to open {kind} list for @{normalized_target}: {exc}',
        )


def scrape_relationship_chunk(
    runner,
    page: Any,
    *,
    target_username: str,
    kind: str,
    cursor: Optional[str],
    chunk_limit: int,
    max_pages: int,
) -> Dict[str, Any]:
    return page.evaluate(
        RELATIONSHIP_CHUNK_SCRIPT,
        {
            'targetUsername': target_username,
            'kind': kind,
            'cursor': cursor,
            'chunkLimit': chunk_limit,
            'maxPages': max_pages,
        },
    )


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
        self.compat = compat_module()
        self.runner = runner
        self.node_id = node_id
        self.cfg = cfg
        self.page = page
        self.profile_name = profile_name
        self.profile_data = profile_data
        self.targets = self.compat._normalize_string_list(cfg.get('targets'))
        self.kind = 'following' if str(cfg.get('kind') or '').strip().lower() == 'following' else 'followers'
        self.chunk_limit = max(1, min(5000, self.compat._parse_int(cfg.get('chunkLimit'), 200)))
        self.max_pages_per_attempt = max(1, min(100, self.compat._parse_int(cfg.get('maxPagesPerAttempt'), 3)))
        self.max_attempts = max(1, min(20, self.compat._parse_int(cfg.get('maxAttempts'), 4)))
        self.retry_backoff_seconds = self.compat._parse_retry_backoff_seconds(cfg.get('retryBackoffSeconds'))
        self.open_delay_seconds = max(0.0, min(60.0, self.compat._parse_float(cfg.get('openDelaySeconds'), 2.0)))
        self.state: Dict[str, Any] = {}
        self.artifact_storage_id = ''
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

    def run(self) -> str:
        if not self.targets:
            self.compat.log('scrape_relationships requires at least one target username')
            return 'failure'
        self._load_state()
        self._prepare_profile_record()
        self._emit_initial_state()
        if self.compat._profile_remaining_daily_scraping_capacity(self.profile_record) == 0:
            return self._fail_due_to_daily_limit()

        while self.runner.running and self.current_target_index < len(self.targets):
            target_username = self.targets[self.current_target_index]
            relationship_error = self._ensure_relationship_view(target_username)
            chunk, elapsed_ms = self._fetch_chunk(target_username, relationship_error)
            result = self._handle_chunk_result(target_username, chunk, elapsed_ms)
            if result is not None:
                return result

        self.compat.log(
            f'scrape_relationships: node {self.node_id} finished with running={self.runner.running} '
            f'currentTargetIndex={self.current_target_index} targets={len(self.targets)}'
        )
        return 'failure' if not self.runner.running else 'success'

    def _load_state(self) -> None:
        existing_state = self.runner._get_node_state(self.node_id)
        self.state = dict(existing_state) if isinstance(existing_state, dict) else {}
        if self.state.get('kind') != self.kind or self.compat._normalize_string_list(self.state.get('targets')) != self.targets:
            self.compat._delete_resume_snapshot(self.state.get('resumeSnapshotPath'))
            self.state = {}
        stale_index = max(0, self.compat._parse_int(self.state.get('currentTargetIndex'), 0))
        should_reset = self.state.get('done') or str(self.state.get('status') or '').strip().lower() == 'completed'
        if should_reset or stale_index >= len(self.targets):
            self._reset_stale_state(stale_index)
        self._hydrate_resume_state()

    def _reset_stale_state(self, stale_index: int) -> None:
        if not self.state:
            return
        self.compat._delete_resume_snapshot(self.state.get('resumeSnapshotPath'))
        self.compat.log(
            f'scrape_relationships: clearing stale resume state for node {self.node_id} '
            f'(status={self.state.get("status")}, done={self.state.get("done")}, '
            f'currentTargetIndex={stale_index}, targets={len(self.targets)})'
        )
        self.state = {}

    def _hydrate_resume_state(self) -> None:
        self.artifact_storage_id = str(self.state.get('artifactStorageId') or '').strip()
        self.resume_snapshot_path = str(self.state.get('resumeSnapshotPath') or '').strip()
        self.merged_users = self._load_merged_users()
        self.current_target_index = max(0, self.compat._parse_int(self.state.get('currentTargetIndex'), 0))
        self.cursor = str(self.state.get('cursor') or '').strip() or None
        self.attempt = max(0, self.compat._parse_int(self.state.get('attempt'), 0))
        self.total_scraped = max(0, self.compat._parse_int(self.state.get('scraped'), len(self.merged_users)))
        self.chunks_completed = max(0, self.compat._parse_int(self.state.get('chunksCompleted'), 0))
        self.target_scraped = max(0, self.compat._parse_int(self.state.get('targetScraped'), 0))
        failed_targets = self.state.get('failedTargets')
        self.failed_targets = failed_targets if isinstance(failed_targets, list) else []

    def _load_merged_users(self) -> list[Any]:
        if self.artifact_storage_id:
            users = self.compat._load_users_from_storage(self.artifact_storage_id)
        elif self.resume_snapshot_path:
            users = self.compat._load_users_from_resume_snapshot(self.resume_snapshot_path)
        else:
            users = []
        return self.compat._dedupe_scraped_users(users)

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
            activityId='scrape_relationships',
            kind=self.kind,
            targets=self.targets,
            currentTargetIndex=self.current_target_index,
            cursor=self.cursor,
            attempt=self.attempt,
            scraped=self.total_scraped,
            deduped=len(self.merged_users),
            chunksCompleted=self.chunks_completed,
            targetScraped=self.target_scraped,
            completedTargets=self.current_target_index,
            failedTargets=self.failed_targets,
            artifactStorageId=self.artifact_storage_id or None,
            manifestStorageId=self.state.get('manifestStorageId'),
            resumeSnapshotPath=self.resume_snapshot_path or None,
            updatedAt=int(time.time() * 1000),
        )
        self.compat.log(
            f'scrape_relationships: starting node {self.node_id} kind={self.kind} '
            f'targets={len(self.targets)} chunkLimit={self.chunk_limit} maxPagesPerAttempt={self.max_pages_per_attempt} '
            f'maxAttempts={self.max_attempts} resumeIndex={self.current_target_index} '
            f"resumeCursor={'yes' if self.cursor else 'no'}"
        )

    def _fail_due_to_daily_limit(self) -> str:
        limit = self.compat._profile_daily_scraping_limit(self.profile_record)
        used = self.compat._profile_daily_scraping_used(self.profile_record)
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
            status='failed',
            kind=self.kind,
            targets=self.targets,
            currentTargetIndex=self.current_target_index,
            cursor=self.cursor,
            attempt=self.attempt,
            scraped=self.total_scraped,
            deduped=len(self.merged_users),
            chunksCompleted=self.chunks_completed,
            targetScraped=self.target_scraped,
            completedTargets=self.current_target_index,
            failedTargets=self.failed_targets,
            lastError=message,
            lastErrorCode='daily_scraping_limit_reached',
            artifactStorageId=self.artifact_storage_id or None,
            resumeSnapshotPath=self.resume_snapshot_path or None,
            updatedAt=int(time.time() * 1000),
        )
        self.compat.log(message)
        return 'failure'

    def _persist_resume_snapshot_if_needed(self) -> None:
        if not self.merged_users or self.artifact_storage_id or self.resume_snapshot_path:
            return
        try:
            self.resume_snapshot_path = self.compat._store_resume_snapshot(
                self.compat._resume_snapshot_path(self.runner.workflow_id, self.node_id),
                self.compat._build_scrape_export_payload(
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
            self.compat.log(f'Ошибка открытия @{target_username}: {exc}')
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
        self.compat.log(
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
        self.compat.log(
            f'scrape_relationships @{target_username}: profile opened '
            f'(delay={self.open_delay_seconds:.1f}s)'
        )

    def _fetch_chunk(self, target_username: str, relationship_error: Optional[Tuple[str, str]]) -> Tuple[Dict[str, Any], int]:
        if relationship_error is not None:
            error_code, error_message = relationship_error
            return self._build_error_chunk(error_code, error_message), 0
        chunk_started_at = time.time()
        remaining_capacity = self.compat._profile_remaining_daily_scraping_capacity(self.profile_record)
        if remaining_capacity == 0:
            return {'outcome': 'daily_limit'}, 0
        effective_chunk_limit = max(1, min(self.chunk_limit, remaining_capacity)) if remaining_capacity is not None else self.chunk_limit
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
        next_cursor = str(chunk.get('nextCursor') or '').strip() or None
        has_more = bool(chunk.get('hasMore')) and bool(next_cursor)
        expected_total = chunk.get('total') if isinstance(chunk.get('total'), int) else None
        next_target_scraped = self.target_scraped + len(chunk_users)
        if self._is_unexpected_empty_result(has_more, expected_total, next_target_scraped):
            message = f'{self.kind} list for @{target_username} returned zero users but profile metadata reported {expected_total}'
            return self._fail_target(target_username, 'fatal_error', 'unexpected_empty_result', message)
        self._record_success_progress(chunk_users, next_cursor, next_target_scraped)
        self._log_success_chunk(target_username, chunk_users, chunk_debug, elapsed_ms, has_more, expected_total, next_target_scraped)
        self._update_after_success(target_username, has_more)
        if self.current_target_index >= len(self.targets):
            return self._complete_node()
        return None

    def _is_unexpected_empty_result(self, has_more: bool, expected_total: Optional[int], next_target_scraped: int) -> bool:
        return not has_more and expected_total is not None and expected_total > 0 and next_target_scraped == 0

    def _record_success_progress(self, chunk_users: list[Any], next_cursor: Optional[str], next_target_scraped: int) -> None:
        if chunk_users:
            self.runner._record_daily_scraping_usage(self.profile_name, len(chunk_users))
            cached_profile = self.runner._get_cached_profile(self.profile_name)
            if isinstance(cached_profile, dict):
                self.profile_record = dict(cached_profile)
        self.merged_users = self.compat._dedupe_scraped_users(self.merged_users + chunk_users)
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
    ) -> None:
        reported_total = expected_total if expected_total is not None else '?'
        label = 'chunk saved' if has_more else 'final chunk'
        total_value = next_target_scraped
        suffix = ' nextCursor=yes' if has_more else ''
        self.compat.log(
            f'scrape_relationships @{target_username}: {label} '
            f'rows={len(chunk_users)} total={total_value}/{reported_total} '
            f"deduped={len(self.merged_users)} pages={chunk_debug.get('pagesFetched') or '-'} "
            f'elapsedMs={elapsed_ms}{suffix}'
        )

    def _update_after_success(self, target_username: str, has_more: bool) -> None:
        if has_more:
            self._store_resume_snapshot()
        else:
            self._complete_target(target_username)
        self.runner._update_node_state(
            self.node_id,
            activityId='scrape_relationships',
            kind=self.kind,
            targets=self.targets,
            currentTargetIndex=self.current_target_index,
            cursor=self.cursor,
            attempt=self.attempt,
            scraped=self.total_scraped,
            deduped=len(self.merged_users),
            chunksCompleted=self.chunks_completed,
            targetScraped=self.target_scraped,
            completedTargets=self.current_target_index,
            failedTargets=self.failed_targets,
            lastError=None,
            lastErrorCode=None,
            artifactStorageId=self.artifact_storage_id or None,
            updatedAt=int(time.time() * 1000),
            resumeSnapshotPath=self.resume_snapshot_path or None,
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
            hasMore=has_more,
            nextCursor=self.cursor,
            completedTargets=self.current_target_index,
            progress=min(99, int(round(100.0 * (self.current_target_index / max(1, len(self.targets)))))),
        )

    def _store_resume_snapshot(self) -> None:
        self.artifact_storage_id = ''
        try:
            self.resume_snapshot_path = self.compat._store_resume_snapshot(
                self.compat._resume_snapshot_path(self.runner.workflow_id, self.node_id),
                self.compat._build_scrape_export_payload(
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

    def _complete_target(self, target_username: str) -> None:
        self.current_target_index += 1
        self.cursor = None
        self.attempt = 0
        self.target_scraped = 0
        self.active_target_username = None
        self.relationship_view_ready = False
        if self.current_target_index < len(self.targets):
            self._store_resume_snapshot()
        else:
            self.compat._delete_resume_snapshot(self.resume_snapshot_path)
            self.resume_snapshot_path = ''
        self.compat.log(
            f'scrape_relationships @{target_username}: target completed '
            f'(totalScraped={self.total_scraped}, deduped={len(self.merged_users)})'
        )

    def _complete_node(self) -> str:
        try:
            artifact_payload = self.compat._build_scrape_export_payload(
                self.runner.workflow_id,
                self.node_id,
                self.profile_name,
                self.kind,
                self.targets,
                self.merged_users,
            )
            self.artifact_storage_id = self.compat._store_artifact_payload(artifact_payload)
        except Exception as exc:
            return self._fail_node_completion('artifact_storage_failed', f'Failed to store scrape artifact: {exc}')
        artifact_payload = {
            'workflowId': self.runner.workflow_id,
            'workflowName': self.runner.workflow_name,
            'nodeId': self.node_id,
            'nodeLabel': (self.runner._get_node_state(self.node_id) or {}).get('label') or 'Scrape Relationships',
            'kind': self.kind,
            'targets': self.targets,
            'targetUsername': '\n'.join(self.targets),
            'status': 'completed',
            'sourceProfileName': self.profile_name,
            'lastRunAt': int(time.time() * 1000),
            'storageId': self.artifact_storage_id,
            'exportStorageId': self.artifact_storage_id,
            'stats': {
                'scraped': self.total_scraped,
                'deduped': len(self.merged_users),
                'chunksCompleted': self.chunks_completed,
                'targetsCompleted': self.current_target_index,
            },
            'metadata': {'activityId': 'scrape_relationships', 'failedTargets': self.failed_targets},
        }
        artifact_row, artifact_upsert_error = self._upsert_artifact_row(artifact_payload)
        artifact_upsert_context = {
            'workflowId': self.runner.workflow_id,
            'nodeId': self.node_id,
            'activityId': 'scrape_relationships',
        }
        self.runner._update_node_state(
            self.node_id,
            status='completed',
            attempt=0,
            cursor=None,
            done=True,
            targetScraped=0,
            completedTargets=self.current_target_index,
            artifactStorageId=self.artifact_storage_id,
            manifestStorageId=None,
            artifactId=(artifact_row or {}).get('_id'),
            artifactUpsertFailedAt=int(time.time() * 1000) if artifact_row is None else None,
            artifactUpsertError=artifact_upsert_error,
            artifactUpsertPayload=artifact_upsert_context if artifact_row is None else None,
            resumeSnapshotPath=None,
            updatedAt=int(time.time() * 1000),
        )
        self.compat.log(
            f'scrape_relationships: node {self.node_id} completed '
            f'(targets={self.current_target_index}, totalScraped={self.total_scraped}, deduped={len(self.merged_users)})'
        )
        return 'success'

    def _fail_node_completion(self, error_code: str, error_message: str) -> str:
        self.artifact_storage_id = ''
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
            status='failed',
            kind=self.kind,
            targets=self.targets,
            currentTargetIndex=self.current_target_index,
            cursor=self.cursor,
            attempt=self.attempt,
            scraped=self.total_scraped,
            deduped=len(self.merged_users),
            chunksCompleted=self.chunks_completed,
            targetScraped=self.target_scraped,
            completedTargets=self.current_target_index,
            failedTargets=self.failed_targets,
            lastError=error_message,
            lastErrorCode=error_code,
            artifactStorageId=None,
            manifestStorageId=None,
            artifactId=None,
            artifactUpsertFailedAt=None,
            artifactUpsertError=None,
            artifactUpsertPayload=None,
            resumeSnapshotPath=self.resume_snapshot_path or None,
            updatedAt=int(time.time() * 1000),
        )
        self.compat.log(
            f'scrape_relationships: node {self.node_id} failed during completion '
            f'({error_code}: {error_message})'
        )
        return 'failure'

    def _upsert_artifact_row(
        self,
        payload: Dict[str, Any],
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        log_payload = {
            'workflowId': payload.get('workflowId'),
            'nodeId': payload.get('nodeId'),
            'activityId': (payload.get('metadata') or {}).get('activityId'),
        }
        attempts = len(ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS) + 1
        last_error: Optional[str] = None
        for attempt_index in range(attempts):
            try:
                artifact_row = self.compat._convex_post_json('/api/workflow-artifacts/upsert', payload)
                if attempt_index:
                    self.compat.log(
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
                self.compat.log(
                    f'scrape_relationships: artifact upsert failed for node {self.node_id} '
                    f'attempt {attempt_index + 1}/{attempts} '
                    f'(workflowId={log_payload["workflowId"]}, nodeId={log_payload["nodeId"]}, '
                    f'activityId={log_payload["activityId"]}): {exc}'
                )
                if attempt_index >= attempts - 1:
                    break
                delay_seconds = ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS[attempt_index]
                self.compat.log(
                    f'scrape_relationships: retrying artifact upsert for node {self.node_id} '
                    f'in {delay_seconds}s'
                )
                time.sleep(delay_seconds)
        self.compat.log(
            f'scrape_relationships: artifact upsert exhausted retries for node {self.node_id}; '
            f'continuing with local artifact storage only '
            f'(workflowId={log_payload["workflowId"]}, nodeId={log_payload["nodeId"]}, '
            f'activityId={log_payload["activityId"]})'
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
        self.compat.log(
            f'scrape_relationships @{target_username}: scheduling retry '
            f'{self.attempt}/{self.max_attempts} in {delay_seconds}s '
            f'(errorCode={error_code or "-"}, message={error_message or "-"})'
        )
        self.runner._update_node_state(
            self.node_id,
            kind=self.kind,
            targets=self.targets,
            currentTargetIndex=self.current_target_index,
            cursor=self.cursor,
            attempt=self.attempt,
            scraped=self.total_scraped,
            deduped=len(self.merged_users),
            chunksCompleted=self.chunks_completed,
            targetScraped=self.target_scraped,
            completedTargets=self.current_target_index,
            failedTargets=self.failed_targets,
            lastError=error_message,
            lastErrorCode=error_code,
            updatedAt=int(time.time() * 1000),
            resumeSnapshotPath=self.resume_snapshot_path or None,
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
            status='failed',
            kind=self.kind,
            targets=self.targets,
            currentTargetIndex=self.current_target_index,
            cursor=self.cursor,
            attempt=self.attempt + (1 if retryable else 0),
            scraped=self.total_scraped,
            deduped=len(self.merged_users),
            chunksCompleted=self.chunks_completed,
            targetScraped=self.target_scraped,
            completedTargets=self.current_target_index,
            failedTargets=self.failed_targets,
            lastError=error_message,
            lastErrorCode=error_code,
            artifactStorageId=self.artifact_storage_id or None,
            resumeSnapshotPath=self.resume_snapshot_path or None,
            updatedAt=int(time.time() * 1000),
        )
        self.compat.log(
            f"Ошибка scrape_relationships @{target_username}: "
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
