import logging
from types import SimpleNamespace

import pytest

from python.runners import run_workflow
from python.runners.workflow import scrape_utils
from python.runners.workflow.scrape_relationships import (
    ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS,
    ScrapeRelationshipsExecutor,
)
from python.tests.workflow_scrape_relationships_support import (
    DummyClient as _DummyClient,
    DummyDisplayManager as _DummyDisplayManager,
    FakePage as _FakePage,
    build_runner as _build_runner,
    scrape_config,
)


def _mock_datauploader(
    monkeypatch,
    *,
    payloads=None,
    stats=None,
    uploaded=None,
    duplicates=None,
    error=None,
):
    captured = payloads if payloads is not None else []

    def fake_post(path, payload):
        assert path == "/workflow-runs/process-scrape"
        captured.append(payload)
        if error is not None:
            raise RuntimeError(error)
        users = payload.get("users") if isinstance(payload.get("users"), list) else []
        return {
            "status": "completed",
            "stats": stats
            or {
                "totalProcessed": len(users),
                "removed": 0,
                "remaining": len(users),
            },
            "uploaded": uploaded or {"dev": len(users)},
            "duplicates": duplicates or {"dev": 0},
        }

    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._datauploader_post_json",
        fake_post,
    )
    return captured


def _build_executor(
    monkeypatch,
    *,
    node_id="node-direct",
    cfg=None,
    node_states=None,
    page=None,
    profile_name="session_profile",
    profile_data=None,
):
    runner = _build_runner(monkeypatch, node_states=node_states)
    executor = ScrapeRelationshipsExecutor(
        runner,
        node_id,
        cfg or scrape_config("followers", ["alpha", "beta"]),
        page or _FakePage(available_kinds={"followers"}),
        profile_name,
        profile_data,
    )
    return runner, executor


def test_scrape_relationship_helpers_normalize_and_dedupe():
    assert run_workflow._normalize_string_list("@alpha\nbeta,@ALPHA") == [
        "alpha",
        "beta",
    ]
    assert run_workflow._parse_retry_backoff_seconds("5, 10, 15") == [5, 10, 15]
    assert run_workflow._parse_retry_backoff_seconds("30,30,120") == [30, 30, 120]
    assert run_workflow._parse_retry_backoff_seconds("30, nope, 30, 0") == [
        30,
        30,
        1,
    ]
    assert run_workflow._parse_retry_backoff_seconds(7) == [7]
    assert run_workflow._parse_retry_backoff_seconds("") == [30, 120, 600, 1800]
    assert run_workflow._parse_retry_backoff_seconds("nope, ,still-nope") == [
        30,
        120,
        600,
        1800,
    ]

    deduped = scrape_utils._dedupe_scraped_users(
        [
            {"username": "alpha", "id": "1"},
            {"username": "ALPHA", "id": "1"},
            {"username": "beta", "id": "2"},
        ]
    )
    assert deduped == [
        {"username": "alpha", "id": "1"},
        {"username": "beta", "id": "2"},
    ]
    assert run_workflow._profile_remaining_daily_scraping_capacity(
        {"daily_scraping_limit": 5, "daily_scraping_used": 3}
    ) == 2
    assert run_workflow._profile_remaining_daily_scraping_capacity(
        {"daily_scraping_limit": 5, "daily_scraping_used": 5}
    ) == 0
    assert run_workflow._profile_remaining_daily_scraping_capacity({}) is None


def test_scrape_relationships_clicks_followers_before_scraping(monkeypatch):
    processed_payloads = []
    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_followers"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    page = _FakePage(available_kinds={"followers"})

    def fake_scrape(*args, **kwargs):
        assert any("/followers" in click["selector"] for click in page.clicks)
        return {
            "outcome": "success",
            "users": [{"username": "beta", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-followers",
        {
            "kind": "followers",
            "targets": ["beta"],
            "chunkLimit": 50,
            "maxPagesPerAttempt": 2,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
    )

    assert result == "success"
    assert page.clicks[0]["selector"] == 'a[href="/beta/followers/"]'
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["kind"] == "followers"
    assert processed_payloads[0]["users"] == [{"username": "beta", "id": "2"}]


def test_scrape_relationships_clicks_following_before_scraping(monkeypatch):
    processed_payloads = []
    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_following"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    page = _FakePage(available_kinds={"following"})

    def fake_scrape(*args, **kwargs):
        assert any("/following" in click["selector"] for click in page.clicks)
        return {
            "outcome": "success",
            "users": [{"username": "gamma", "id": "3"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-following",
        {
            "kind": "following",
            "targets": ["gamma"],
            "chunkLimit": 50,
            "maxPagesPerAttempt": 2,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
    )

    assert result == "success"
    assert page.clicks[0]["selector"] == 'a[href="/gamma/following/"]'
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["kind"] == "following"
    assert processed_payloads[0]["users"] == [{"username": "gamma", "id": "3"}]


def _resume_node_state():
    return {
        "activityId": "scrape_relationships",
        "label": "Resume Scrape",
        "kind": "followers",
        "targets": ["alpha", "beta"],
        "currentTargetIndex": 1,
        "scraped": 1,
        "chunksCompleted": 1,
        "artifactStorageId": "export_existing",
    }


def _assert_resume_success(runner, page, processed_payloads):
    assert [entry["url"] for entry in page.visited] == ["https://www.instagram.com/beta/"]
    assert page.clicks[0]["selector"] == 'a[href="/beta/followers/"]'
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["users"] == [
        {"username": "alpha", "id": "1"},
        {"username": "beta", "id": "2"},
    ]
    state = runner.node_states["node-1"]
    assert state["done"] is True
    assert state["completedTargets"] == 2
    assert state["scraped"] == 2
    assert state["deduped"] == 2
    assert state["artifactStorageId"] is None
    assert state["manifestStorageId"] is None
    assert state["artifactId"] == "artifact_1"


@pytest.mark.parametrize(
    ("state_patch", "expected_users"),
    [
        (
            {
                "artifactStorageId": "export_resume",
                "resumeSnapshotPath": "resume_ignored.json",
            },
            [
                {"username": "alpha", "id": "1"},
                {"username": "ALPHA", "id": "1"},
                {"username": "beta", "id": "2"},
            ],
        ),
        (
            {"resumeSnapshotPath": "resume_snapshot.json"},
            [
                {"username": "gamma", "id": "3"},
                {"username": "GAMMA", "id": "3"},
                {"username": "delta", "id": "4"},
            ],
        ),
    ],
)
def test_scrape_relationships_hydrates_resume_state(monkeypatch, state_patch, expected_users):
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._load_users_from_storage",
        lambda storage_id: expected_users if storage_id == "export_resume" else [],
    )
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._load_users_from_resume_snapshot",
        lambda path: expected_users if path == "resume_snapshot.json" else [],
    )

    runner, executor = _build_executor(
        monkeypatch,
        node_id="node-hydrate",
        node_states={
            "node-hydrate": {
                "activityId": "scrape_relationships",
                "kind": "followers",
                "targets": ["alpha", "beta"],
                "currentTargetIndex": 1,
                "cursor": "cursor_resume",
                "attempt": 2,
                "scraped": 7,
                "chunksCompleted": 3,
                "targetScraped": 4,
                **state_patch,
            }
        },
    )

    executor._load_state()

    assert executor.merged_users == scrape_utils._dedupe_scraped_users(expected_users)
    assert executor.cursor == "cursor_resume"
    assert executor.current_target_index == 1
    assert executor.attempt == 2
    assert executor.total_scraped == 7
    assert executor.chunks_completed == 3
    assert executor.target_scraped == 4
    assert executor.artifact_storage_id == state_patch.get("artifactStorageId", "")
    assert executor.resume_snapshot_path == state_patch.get("resumeSnapshotPath", "")
    assert runner._get_node_state("node-hydrate")["currentTargetIndex"] == 1


def test_scrape_relationships_resume_uses_saved_artifact(monkeypatch):
    processed_payloads = []

    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._load_users_from_storage",
        lambda storage_id: [{"username": "alpha", "id": "1"}]
        if storage_id == "export_existing"
        else [],
    )

    def fake_post(path, payload):
        assert path == "/api/workflow-artifacts/upsert"
        return {"_id": "artifact_1"}

    runner = _build_runner(
        monkeypatch,
        node_states={"node-1": _resume_node_state()},
    )
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", fake_post)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [{"username": "beta", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
        },
    )

    page = _FakePage()
    result = runner._execute_scrape_relationships(
        "node-1",
        scrape_config("followers", ["alpha", "beta"]),
        page,
        "session_profile",
    )

    assert result == "success"
    _assert_resume_success(runner, page, processed_payloads)


def test_scrape_relationships_retries_artifact_upsert_until_success(monkeypatch):
    upsert_attempts = []
    sleep_calls = []

    def flaky_post(path, payload):
        upsert_attempts.append({"path": path, "payload": payload})
        if len(upsert_attempts) < 3:
            raise RuntimeError("temporary convex failure")
        return {"_id": "artifact_retry_success"}

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", flaky_post)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships.time.sleep",
        lambda seconds: sleep_calls.append(seconds),
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [{"username": "beta", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        },
    )

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-artifact-retry",
        scrape_config("followers", ["beta"]),
        page,
        "session_profile",
    )

    assert result == "success"
    assert [call["path"] for call in upsert_attempts] == [
        "/api/workflow-artifacts/upsert",
        "/api/workflow-artifacts/upsert",
        "/api/workflow-artifacts/upsert",
    ]
    assert sleep_calls == [1, 2]
    state = runner.node_states["node-artifact-retry"]
    assert state["artifactId"] == "artifact_retry_success"
    assert state["artifactUpsertFailedAt"] is None
    assert state["artifactUpsertError"] is None
    assert state["artifactUpsertPayload"] is None


def test_scrape_relationships_fails_when_artifact_upsert_exhausts_retries(monkeypatch, caplog):
    upsert_attempts = []
    sleep_calls = []

    def always_fail_post(path, payload):
        upsert_attempts.append({"path": path, "payload": payload})
        raise RuntimeError("convex unavailable")

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", always_fail_post)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships.time.sleep",
        lambda seconds: sleep_calls.append(seconds),
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [{"username": "beta", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        },
    )

    page = _FakePage(available_kinds={"followers"})
    with caplog.at_level(logging.ERROR, logger="python.runners.workflow.scrape_relationships"):
        result = runner._execute_scrape_relationships(
            "node-artifact-fallback",
            scrape_config("followers", ["beta"]),
            page,
            "session_profile",
        )

    assert result == "failure"
    assert len(upsert_attempts) == 4
    assert sleep_calls == [1, 2, 4]
    state = runner.node_states["node-artifact-fallback"]
    assert state.get("done") is not True
    assert state["status"] == "failed"
    assert state["artifactStorageId"] is None
    assert state["artifactId"] is None
    assert state["artifactUpsertFailedAt"] is None
    assert state["artifactUpsertError"] is None
    assert state["artifactUpsertPayload"] is None
    assert state["lastErrorCode"] == "artifact_upsert_failed"
    assert "Failed to persist direct scrape history row: convex unavailable" in state["lastError"]
    assert "payload={'workflowId': 'wf_123', 'nodeId': 'node-artifact-fallback', 'activityId': 'scrape_relationships', 'kind': 'followers'}" in caplog.text


def test_scrape_relationships_marks_node_failed_when_datauploader_processing_raises(monkeypatch):
    upsert_called = False

    def fake_post(*args, **kwargs):
        nonlocal upsert_called
        upsert_called = True
        return {"_id": "artifact_should_not_exist"}

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, error="uploader unavailable")
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", fake_post)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [{"username": "beta", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        },
    )

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-artifact-store-failure",
        scrape_config("followers", ["beta"]),
        page,
        "session_profile",
    )

    assert result == "failure"
    assert upsert_called is False
    state = runner.node_states["node-artifact-store-failure"]
    assert state["status"] == "failed"
    assert state["lastErrorCode"] == "datauploader_processing_failed"
    assert state["lastError"] == "Failed to process scrape with datauploader: uploader unavailable"
    assert state["artifactStorageId"] is None
    assert state["artifactId"] is None
    assert state["artifactUpsertFailedAt"] is None
    assert state["artifactUpsertError"] is None
    assert state["artifactUpsertPayload"] is None
    assert state["completedTargets"] == 1
    assert state["resumeSnapshotPath"] is None


def test_scrape_relationships_retry_wait_stops_when_runner_stops(monkeypatch):
    sleep_calls = []
    runner = _build_runner(monkeypatch)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    executor = ScrapeRelationshipsExecutor(
        runner,
        "node-retry-stop",
        scrape_config("followers", ["alpha"], retryBackoffSeconds="1,10", maxAttempts=3),
        _FakePage(),
        "session_profile",
    )

    def fake_sleep(seconds):
        sleep_calls.append(seconds)
        runner.running = False

    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships.time.sleep",
        fake_sleep,
    )

    result = executor._handle_chunk_result(
        "alpha",
        {
            "outcome": "retryable_error",
            "errorCode": "temporary_error",
            "errorMessage": "temporary failure",
        },
        0,
    )

    assert result == "failure"
    assert sleep_calls == [0.1]
    assert executor.attempt == 1
    assert executor.failed_targets == []


def test_scrape_relationships_maybe_schedule_retry_updates_state(monkeypatch):
    update_calls = []
    emit_calls = []
    sleep_calls = []
    now_values = iter([100.0, 100.0, 100.0, 105.0])

    runner, executor = _build_executor(monkeypatch, node_id="node-retry-direct")
    original_update_node_state = runner._update_node_state

    def record_update(node_id, **patch):
        update_calls.append({"node_id": node_id, "patch": dict(patch)})
        return original_update_node_state(node_id, **patch)

    def record_emit(event_type, node_id, profile_name, **extra):
        emit_calls.append(
            {
                "event_type": event_type,
                "node_id": node_id,
                "profile_name": profile_name,
                "extra": dict(extra),
            }
        )

    monkeypatch.setattr(runner, "_update_node_state", record_update)
    monkeypatch.setattr(runner, "_emit_node_state", record_emit)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships.time.sleep",
        lambda seconds: sleep_calls.append(seconds),
    )
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships.time.time",
        lambda: next(now_values),
    )

    executor.current_target_index = 1
    executor.cursor = "cursor_retry"
    executor.total_scraped = 3
    executor.chunks_completed = 2
    executor.target_scraped = 1
    executor.merged_users = [{"username": "alpha", "id": "1"}]
    executor.failed_targets = [{"targetUsername": "skipped"}]
    executor.relationship_view_ready = True
    executor.resume_snapshot_path = "resume_retry.json"
    executor.retry_backoff_seconds = [5, 10]
    executor.max_attempts = 3

    assert (
        executor._maybe_schedule_retry(
            "beta",
            "retryable_error",
            "temporary_failure",
            "retry later",
        )
        is True
    )

    assert executor.attempt == 1
    assert executor.relationship_view_ready is False
    assert sleep_calls == [0.1]
    assert update_calls[-1]["patch"]["attempt"] == 1
    assert update_calls[-1]["patch"]["lastErrorCode"] == "temporary_failure"
    assert update_calls[-1]["patch"]["resumeSnapshotPath"] == "resume_retry.json"
    assert emit_calls[-1]["event_type"] == "task_progress"
    assert emit_calls[-1]["extra"]["retryInSeconds"] == 5
    assert emit_calls[-1]["extra"]["attempt"] == 1
    assert runner.node_states["node-retry-direct"]["attempt"] == 1


def test_scrape_relationships_keeps_profile_open_between_partial_chunks(monkeypatch):
    processed_payloads = []
    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_multi_chunk"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    chunk_calls = []

    def fake_scrape(*args, **kwargs):
        chunk_calls.append(kwargs.get("cursor"))
        if len(chunk_calls) == 1:
            return {
                "outcome": "success",
                "users": [{"username": "alpha_1", "id": "1"}],
                "nextCursor": "cursor_2",
                "hasMore": True,
                "total": 2,
            }
        return {
            "outcome": "success",
            "users": [{"username": "alpha_2", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 2,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-multi-chunk",
        {
            "kind": "followers",
            "targets": ["alpha"],
            "chunkLimit": 25,
            "maxPagesPerAttempt": 3,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
    )

    assert result == "success"
    assert chunk_calls == [None, "cursor_2"]
    assert [entry["url"] for entry in page.visited] == [
        "https://www.instagram.com/alpha/",
    ]
    assert [click["selector"] for click in page.clicks] == ['a[href="/alpha/followers/"]']
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["users"] == [
        {"username": "alpha_1", "id": "1"},
        {"username": "alpha_2", "id": "2"},
    ]


def test_scrape_relationships_logs_updated_total_for_each_saved_chunk(monkeypatch):
    logs = []

    runner = _build_runner(monkeypatch)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships.log", logs.append)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_logged_chunks"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    chunk_calls = []

    def fake_scrape(*args, **kwargs):
        chunk_calls.append(kwargs.get("cursor"))
        if len(chunk_calls) == 1:
            return {
                "outcome": "success",
                "users": [{"username": "alpha_1", "id": "1"}],
                "nextCursor": "cursor_2",
                "hasMore": True,
                "total": 2,
            }
        return {
            "outcome": "success",
            "users": [{"username": "alpha_2", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 2,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-log-totals",
        scrape_config("followers", ["alpha"], chunkLimit=25, maxPagesPerAttempt=3),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "success"
    chunk_logs = [message for message in logs if "scrape_relationships @alpha:" in message]
    assert any("chunk saved rows=1 total=1/2" in message for message in chunk_logs)
    assert any("final chunk rows=1 total=2/2" in message for message in chunk_logs)


def test_scrape_relationships_uses_scraping_accounts_as_targets(monkeypatch):
    runner = _build_runner(monkeypatch)
    runner.accounts_client = SimpleNamespace(
        list_accounts_by_status=lambda status: [
            {'id': 'acct-1', 'user_name': 'alpha', 'status': 'scraping'},
            {'id': 'acct-2', 'user_name': 'beta', 'status': 'scraping'},
        ] if status == 'scraping' else [],
        update_account_status=lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_scraping_targets"},
    )
    visited_targets = []

    def fake_scrape(*args, **kwargs):
        visited_targets.append(kwargs["target_username"])
        return {
            "outcome": "success",
            "users": [{"username": kwargs["target_username"], "id": kwargs["target_username"]}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-account-targets",
        scrape_config("followers", ["manual-target"], useAccountUsernames=True),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "success"
    assert visited_targets == ["alpha", "beta"]
    state = runner.node_states["node-account-targets"]
    assert state["useAccountUsernames"] is True
    assert state["targets"] == ["alpha", "beta"]


def test_scrape_relationships_marks_scraping_account_done_after_success(monkeypatch):
    status_updates = []
    runner = _build_runner(monkeypatch)
    runner.accounts_client = SimpleNamespace(
        list_accounts_by_status=lambda status: [
            {'id': 'acct-1', 'user_name': 'alpha', 'status': 'scraping'},
        ] if status == 'scraping' else [],
        update_account_status=lambda account_id, status='subscribed', assigned_to='__NOT_SET__': status_updates.append(
            {'account_id': account_id, 'status': status, 'assigned_to': assigned_to}
        ),
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_scraping_done"},
    )
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [{"username": "alpha", "id": "1"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        },
    )

    result = runner._execute_scrape_relationships(
        "node-account-done",
        scrape_config("followers", [], useAccountUsernames=True),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "success"
    assert status_updates == [
        {'account_id': 'acct-1', 'status': 'done', 'assigned_to': '__NOT_SET__'}
    ]


def test_scrape_relationships_leaves_scraping_account_unchanged_on_failure(monkeypatch):
    status_updates = []
    runner = _build_runner(monkeypatch)
    runner.accounts_client = SimpleNamespace(
        list_accounts_by_status=lambda status: [
            {'id': 'acct-1', 'user_name': 'alpha', 'status': 'scraping'},
        ] if status == 'scraping' else [],
        update_account_status=lambda account_id, status='subscribed', assigned_to='__NOT_SET__': status_updates.append(
            {'account_id': account_id, 'status': status, 'assigned_to': assigned_to}
        ),
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "fatal_error",
            "users": [],
            "nextCursor": None,
            "hasMore": False,
            "errorCode": "profile_unavailable",
            "errorMessage": "broken target",
        },
    )

    result = runner._execute_scrape_relationships(
        "node-account-failure",
        scrape_config("followers", [], useAccountUsernames=True),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "failure"
    assert status_updates == []


def test_scrape_relationships_fails_when_scraping_pool_is_empty(monkeypatch):
    logs = []
    runner = _build_runner(monkeypatch)
    runner.accounts_client = SimpleNamespace(
        list_accounts_by_status=lambda status: [],
        update_account_status=lambda *args, **kwargs: None,
    )
    monkeypatch.setattr("python.runners.workflow.scrape_relationships.log", logs.append)

    result = runner._execute_scrape_relationships(
        "node-empty-scraping-pool",
        scrape_config("followers", ["manual-target"], useAccountUsernames=True),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "failure"
    assert logs == ['scrape_relationships could not resolve any account usernames in status scraping']


def test_scrape_relationships_both_mode_runs_followers_then_following(monkeypatch):
    processed_payloads = []
    upsert_payloads = []

    def fake_post(path, payload):
        assert path == "/api/workflow-artifacts/upsert"
        upsert_payloads.append(payload)
        return {"_id": f"artifact_{payload['kind']}"}

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", fake_post)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    scrape_calls = []

    def fake_scrape(*args, **kwargs):
        scrape_calls.append(
            {
                "kind": kwargs["kind"],
                "target": kwargs["target_username"],
            }
        )
        return {
            "outcome": "success",
            "users": [{"username": f"{kwargs['kind']}_{kwargs['target_username']}", "id": kwargs["kind"]}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    page = _FakePage(available_kinds={"followers", "following"})
    result = runner._execute_scrape_relationships(
        "node-both",
        scrape_config("both", ["alpha"]),
        page,
        "session_profile",
    )

    assert result == "success"
    assert scrape_calls == [
        {"kind": "followers", "target": "alpha"},
        {"kind": "following", "target": "alpha"},
    ]
    assert [click["selector"] for click in page.clicks] == [
        'a[href="/alpha/followers/"]',
        'a[href="/alpha/following/"]',
    ]
    assert [payload["kind"] for payload in processed_payloads] == ["followers", "following"]
    assert [payload["kind"] for payload in upsert_payloads] == ["followers", "following"]
    state = runner.node_states["node-both"]
    assert state["done"] is True
    assert state["kindMode"] == "both"
    assert state["completedKinds"] == ["followers", "following"]
    assert state["artifactId"] == "artifact_following"


def test_scrape_relationships_both_mode_resume_skips_completed_pass(monkeypatch):
    processed_payloads = []
    scrape_kinds = []

    runner = _build_runner(
        monkeypatch,
        node_states={
            "node-both-resume": {
                "activityId": "scrape_relationships",
                "kind": "followers",
                "kindMode": "both",
                "completedKinds": ["followers"],
                "targets": ["alpha"],
                "currentTargetIndex": 0,
            }
        },
    )
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_following_resume"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    def fake_scrape(*args, **kwargs):
        scrape_kinds.append(kwargs["kind"])
        return {
            "outcome": "success",
            "users": [{"username": "alpha_following", "id": "following"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    page = _FakePage(available_kinds={"followers", "following"})
    result = runner._execute_scrape_relationships(
        "node-both-resume",
        scrape_config("both", ["alpha"]),
        page,
        "session_profile",
    )

    assert result == "success"
    assert scrape_kinds == ["following"]
    assert [click["selector"] for click in page.clicks] == ['a[href="/alpha/following/"]']
    assert [payload["kind"] for payload in processed_payloads] == ["following"]
    state = runner.node_states["node-both-resume"]
    assert state["completedKinds"] == ["followers", "following"]
    assert state["done"] is True


def test_scrape_relationships_both_mode_keeps_first_artifact_when_second_pass_fails(monkeypatch):
    processed_payloads = []
    upsert_payloads = []

    def fake_post(path, payload):
        assert path == "/api/workflow-artifacts/upsert"
        upsert_payloads.append(payload)
        return {"_id": f"artifact_{payload['kind']}"}

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", fake_post)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    def fake_scrape(*args, **kwargs):
        if kwargs["kind"] == "followers":
            return {
                "outcome": "success",
                "users": [{"username": "alpha_follower", "id": "followers"}],
                "nextCursor": None,
                "hasMore": False,
                "total": 1,
            }
        return {
            "outcome": "fatal_error",
            "users": [],
            "nextCursor": None,
            "hasMore": False,
            "errorCode": "profile_unavailable",
            "errorMessage": "broken following view",
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-both-failure",
        scrape_config("both", ["alpha"]),
        _FakePage(available_kinds={"followers", "following"}),
        "session_profile",
    )

    assert result == "failure"
    assert [payload["kind"] for payload in processed_payloads] == ["followers"]
    assert [payload["kind"] for payload in upsert_payloads] == ["followers"]
    state = runner.node_states["node-both-failure"]
    assert state["status"] == "failed"
    assert state["kindMode"] == "both"
    assert state["kind"] == "following"
    assert state["completedKinds"] == ["followers"]
    assert state["completedArtifacts"] == [
        {
            "kind": "followers",
            "artifactId": "artifact_followers",
            "filterStats": {
                "totalProcessed": 1,
                "removed": 0,
                "remaining": 1,
            },
            "uploaded": {"dev": 1},
            "duplicates": {"dev": 0},
        }
    ]


def test_scrape_relationships_both_mode_marks_account_done_only_after_final_pass(monkeypatch):
    status_updates = []
    runner = _build_runner(monkeypatch)
    runner.accounts_client = SimpleNamespace(
        list_accounts_by_status=lambda status: [
            {'id': 'acct-1', 'user_name': 'alpha', 'status': 'scraping'},
        ] if status == 'scraping' else [],
        update_account_status=lambda account_id, status='subscribed', assigned_to='__NOT_SET__': status_updates.append(
            {'account_id': account_id, 'status': status, 'assigned_to': assigned_to}
        ),
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_test"},
    )

    def fake_scrape(*args, **kwargs):
        return {
            "outcome": "success",
            "users": [{"username": f"{kwargs['kind']}_user", "id": kwargs["kind"]}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-both-account-done",
        scrape_config("both", [], useAccountUsernames=True),
        _FakePage(available_kinds={"followers", "following"}),
        "session_profile",
    )

    assert result == "success"
    assert status_updates == [
        {'account_id': 'acct-1', 'status': 'done', 'assigned_to': '__NOT_SET__'}
    ]
