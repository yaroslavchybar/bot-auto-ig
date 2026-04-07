import logging

import pytest

from python.runners import run_workflow
from python.runners.workflow import scrape_utils
from python.runners.workflow.scrape_navigation import RELATIONSHIP_OPEN_RETRY_DELAYS_MS
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


def test_scrape_relationships_persists_completed_targets_before_retry(monkeypatch):
    resume_snapshots = []

    runner = _build_runner(monkeypatch)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._delete_resume_snapshot", lambda path: None)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._store_resume_snapshot",
        lambda path, payload: resume_snapshots.append(
            {
                "path": path,
                "payload": payload,
            }
        )
        or path,
    )

    chunk_calls = []

    def fake_scrape(*args, **kwargs):
        chunk_calls.append(kwargs["target_username"])
        if len(chunk_calls) == 1:
            return {
                "outcome": "success",
                "users": [{"username": "alpha", "id": "1"}],
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
            "errorMessage": "beta failed",
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-retry-snapshot",
        {
            "kind": "followers",
            "targets": ["alpha", "beta"],
            "chunkLimit": 25,
            "maxPagesPerAttempt": 3,
            "maxAttempts": 1,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
    )

    assert result == "failure"
    assert chunk_calls == ["alpha", "beta"]
    assert len(resume_snapshots) == 1
    assert resume_snapshots[0]["payload"]["users"] == [
        {"username": "alpha", "id": "1"}
    ]


def test_scrape_relationships_continues_when_resume_snapshot_store_fails(monkeypatch, caplog):
    processed_payloads = []
    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_resume_failure"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._delete_resume_snapshot", lambda path: None)

    def failing_store_resume_snapshot(path, payload):
        raise OSError("disk full")

    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._store_resume_snapshot",
        failing_store_resume_snapshot,
    )

    chunk_calls = []

    def fake_scrape(*args, **kwargs):
        target_username = kwargs["target_username"]
        chunk_calls.append(target_username)
        return {
            "outcome": "success",
            "users": [{"username": target_username, "id": str(len(chunk_calls))}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    with caplog.at_level(logging.ERROR, logger="python.runners.workflow.scrape_relationships"):
        result = runner._execute_scrape_relationships(
            "node-resume-snapshot-error",
            scrape_config("followers", ["alpha", "beta"], chunkLimit=25, maxPagesPerAttempt=3),
            _FakePage(available_kinds={"followers"}),
            "session_profile",
        )

    assert result == "success"
    assert chunk_calls == ["alpha", "beta"]
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["users"] == [
        {"username": "alpha", "id": "1"},
        {"username": "beta", "id": "2"},
    ]
    assert "Failed to store resume snapshot for workflow wf_123 node node-resume-snapshot-error" in caplog.text


def test_scrape_relationships_persist_resume_snapshot_if_needed_stores_snapshot(monkeypatch):
    stored_snapshots = []

    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._store_resume_snapshot",
        lambda path, payload: stored_snapshots.append({"path": path, "payload": payload}) or path,
    )

    _, executor = _build_executor(monkeypatch, node_id="node-persist-direct")
    executor.merged_users = [{"username": "alpha", "id": "1"}]

    executor._persist_resume_snapshot_if_needed()

    assert len(stored_snapshots) == 1
    assert stored_snapshots[0]["path"] == scrape_utils._resume_snapshot_path("wf_123", "node-persist-direct")
    assert stored_snapshots[0]["payload"]["users"] == executor.merged_users
    assert executor.resume_snapshot_path == stored_snapshots[0]["path"]


def test_scrape_relationships_store_resume_snapshot_logs_errors(monkeypatch, caplog):
    def raising_store_resume_snapshot(path, payload):
        raise OSError("disk full")

    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._store_resume_snapshot",
        raising_store_resume_snapshot,
    )

    _, executor = _build_executor(monkeypatch, node_id="node-store-resume-error")
    executor.artifact_storage_id = "storage_before_resume"
    executor.merged_users = [{"username": "alpha", "id": "1"}]

    with caplog.at_level(logging.ERROR, logger="python.runners.workflow.scrape_relationships"):
        executor._store_resume_snapshot()

    assert executor.artifact_storage_id == ""
    assert executor.resume_snapshot_path == ""
    assert "Failed to store resume snapshot for workflow wf_123 node node-store-resume-error" in caplog.text


def test_scrape_relationships_fails_on_unexpected_empty_result(monkeypatch):
    runner = _build_runner(monkeypatch)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [],
            "nextCursor": None,
            "hasMore": False,
            "total": 12,
        },
    )

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-empty-fail",
        {
            "kind": "followers",
            "targets": ["alpha"],
            "chunkLimit": 50,
            "maxPagesPerAttempt": 2,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
    )

    assert result == "failure"
    state = runner.node_states["node-empty-fail"]
    assert state["status"] == "failed"
    assert state["lastErrorCode"] == "unexpected_empty_result"
    assert state["failedTargets"][0]["errorCode"] == "unexpected_empty_result"


def test_scrape_relationships_caps_followers_per_target_and_reduces_request_limit(monkeypatch):
    processed_payloads = []
    requested_limits = []

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_cap_followers"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    def fake_scrape(*args, **kwargs):
        requested_limits.append(kwargs["chunk_limit"])
        return {
            "outcome": "success",
            "users": [
                {"username": "u1", "id": "1"},
                {"username": "u2", "id": "2"},
            ],
            "nextCursor": "cursor_after_cap",
            "hasMore": True,
            "total": 10,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-cap-followers",
        scrape_config(
            "followers",
            ["alpha"],
            chunkLimit=50,
            followersMaxToScrape=2,
        ),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "success"
    assert requested_limits == [2]
    assert processed_payloads[0]["users"] == [
        {"username": "u1", "id": "1"},
        {"username": "u2", "id": "2"},
    ]
    assert runner.profiles_client.increment_calls == [("session_profile", 2)]
    state = runner.node_states["node-cap-followers"]
    assert state["status"] == "completed"
    assert state["done"] is True
    assert state["scraped"] == 2
    assert state["completedTargets"] == 1


def test_scrape_relationships_trims_following_overage_when_cap_is_reached(monkeypatch):
    processed_payloads = []

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_cap_following"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [
                {"username": "u1", "id": "1"},
                {"username": "u2", "id": "2"},
                {"username": "u3", "id": "3"},
            ],
            "nextCursor": "cursor_after_cap",
            "hasMore": True,
            "total": 12,
        },
    )

    result = runner._execute_scrape_relationships(
        "node-cap-following",
        scrape_config(
            "following",
            ["alpha"],
            chunkLimit=50,
            followingMaxToScrape=2,
        ),
        _FakePage(available_kinds={"following"}),
        "session_profile",
    )

    assert result == "success"
    assert processed_payloads[0]["users"] == [
        {"username": "u1", "id": "1"},
        {"username": "u2", "id": "2"},
    ]
    assert runner.profiles_client.increment_calls == [("session_profile", 2)]


def test_scrape_relationships_resets_cap_per_target(monkeypatch):
    processed_payloads = []
    requested_limits = []

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_cap_multi"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    def fake_scrape(*args, **kwargs):
        requested_limits.append((kwargs["target_username"], kwargs["chunk_limit"]))
        return {
            "outcome": "success",
            "users": [{"username": kwargs["target_username"], "id": kwargs["target_username"]}],
            "nextCursor": "cursor_after_cap",
            "hasMore": True,
            "total": 4,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-cap-multi",
        scrape_config(
            "followers",
            ["alpha", "beta"],
            chunkLimit=50,
            followersMaxToScrape=1,
        ),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "success"
    assert requested_limits == [("alpha", 1), ("beta", 1)]
    assert processed_payloads[0]["users"] == [
        {"username": "alpha", "id": "alpha"},
        {"username": "beta", "id": "beta"},
    ]


def test_scrape_relationships_both_mode_uses_separate_caps(monkeypatch):
    processed_payloads = []
    requested_limits = []

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    def fake_scrape(*args, **kwargs):
        requested_limits.append((kwargs["kind"], kwargs["chunk_limit"]))
        if kwargs["kind"] == "followers":
            return {
                "outcome": "success",
                "users": [{"username": "follower-1", "id": "f1"}],
                "nextCursor": "followers_cursor",
                "hasMore": True,
                "total": 20,
            }
        return {
            "outcome": "success",
            "users": [
                {"username": "following-1", "id": "g1"},
                {"username": "following-2", "id": "g2"},
            ],
            "nextCursor": "following_cursor",
            "hasMore": True,
            "total": 20,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    upsert_calls = []

    def fake_post(path, payload):
        upsert_calls.append(payload)
        return {"_id": f"artifact_{payload['kind']}"}

    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", fake_post)

    result = runner._execute_scrape_relationships(
        "node-cap-both",
        scrape_config(
            "both",
            ["alpha"],
            chunkLimit=50,
            followersMaxToScrape=1,
            followingMaxToScrape=2,
        ),
        _FakePage(available_kinds={"followers", "following"}),
        "session_profile",
    )

    assert result == "success"
    assert requested_limits == [("followers", 1), ("following", 2)]
    assert [payload["kind"] for payload in processed_payloads] == ["followers", "following"]
    assert [len(payload["users"]) for payload in processed_payloads] == [1, 2]
    assert [payload["kind"] for payload in upsert_calls] == ["followers", "following"]


def test_scrape_relationships_zero_cap_keeps_unlimited_behavior(monkeypatch):
    requested_limits = []

    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_unlimited"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    def fake_scrape(*args, **kwargs):
        requested_limits.append(kwargs["chunk_limit"])
        return {
            "outcome": "success",
            "users": [{"username": "alpha", "id": "1"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    result = runner._execute_scrape_relationships(
        "node-cap-zero",
        scrape_config(
            "followers",
            ["alpha"],
            chunkLimit=50,
            followersMaxToScrape=0,
        ),
        _FakePage(available_kinds={"followers"}),
        "session_profile",
    )

    assert result == "success"
    assert requested_limits == [50]


def test_scrape_relationships_allows_zero_rows_when_total_is_zero(monkeypatch):
    processed_payloads = []
    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_zero"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        runner,
        "_scrape_relationship_chunk",
        lambda *args, **kwargs: {
            "outcome": "success",
            "users": [],
            "nextCursor": None,
            "hasMore": False,
            "total": 0,
        },
    )

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-zero-success",
        {
            "kind": "followers",
            "targets": ["alpha"],
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
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["users"] == []


def test_scrape_relationships_fails_when_relationship_link_missing(monkeypatch):
    runner = _build_runner(monkeypatch)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    was_called = {"scrape": False}

    def fake_scrape(*args, **kwargs):
        was_called["scrape"] = True
        return {
            "outcome": "success",
            "users": [{"username": "beta", "id": "2"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    page = _FakePage(available_kinds=set())
    result = runner._execute_scrape_relationships(
        "node-link-missing",
        {
            "kind": "followers",
            "targets": ["alpha"],
            "chunkLimit": 50,
            "maxPagesPerAttempt": 2,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
    )

    assert result == "failure"
    assert was_called["scrape"] is False
    state = runner.node_states["node-link-missing"]
    assert state["lastErrorCode"] == "relationship_link_not_found"


def test_scrape_relationships_fails_when_relationship_ui_does_not_open(monkeypatch):
    runner = _build_runner(monkeypatch)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    page = _FakePage(available_kinds={"followers"}, openable_kinds=set())
    result = runner._execute_scrape_relationships(
        "node-open-fail",
        {
            "kind": "followers",
            "targets": ["alpha"],
            "chunkLimit": 50,
            "maxPagesPerAttempt": 2,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
    )

    assert result == "failure"
    state = runner.node_states["node-open-fail"]
    assert state["lastErrorCode"] == "relationship_open_failed"


def test_scrape_relationships_retries_relationship_open_when_first_click_is_blocked(monkeypatch):
    class RetryRelationshipPage(_FakePage):
        def __init__(self):
            super().__init__(available_kinds={"followers"})
            self.evaluate_attempts = 0
            self.failed_clicks_remaining = 4

        def evaluate(self, script, arg=None):
            self.evaluations.append({"script": script, "arg": arg})
            selectors = arg.get("selectors") if isinstance(arg, dict) else None
            if selectors is None:
                raise AssertionError("unexpected evaluate call in test fake")
            self.evaluate_attempts += 1
            if self.evaluate_attempts == 1:
                return None
            return super().evaluate(script, arg)

        def click(self, selector, timeout=None):
            if self.failed_clicks_remaining > 0:
                self.clicks.append({"selector": selector, "timeout": timeout})
                self.failed_clicks_remaining -= 1
                raise Exception("subtree intercepts pointer events")
            return super().click(selector, timeout=timeout)

    processed_payloads = []
    runner = _build_runner(monkeypatch)
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_retry_open"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
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

    page = RetryRelationshipPage()
    result = runner._execute_scrape_relationships(
        "node-open-retry",
        scrape_config("followers", ["alpha"]),
        page,
        "session_profile",
    )

    assert result == "success"
    assert page.waits == [RELATIONSHIP_OPEN_RETRY_DELAYS_MS[0]]
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["users"] == [{"username": "alpha", "id": "1"}]


def test_scrape_relationships_resets_completed_state_before_rerun(monkeypatch):
    processed_payloads = []
    runner = _build_runner(
        monkeypatch,
        node_states={
            "node-rerun": {
                "activityId": "scrape_relationships",
                "kind": "followers",
                "targets": ["alpha"],
                "currentTargetIndex": 1,
                "status": "completed",
                "done": True,
                "artifactStorageId": "export_existing",
            }
        },
    )
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._load_users_from_storage",
        lambda storage_id: (_ for _ in ()).throw(AssertionError("stale artifact should not be loaded")),
    )
    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_rerun"},
    )
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
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

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-rerun",
        {
            "kind": "followers",
            "targets": ["alpha"],
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
    assert [entry["url"] for entry in page.visited] == [
        "https://www.instagram.com/alpha/",
    ]
    assert page.clicks[0]["selector"] == 'a[href="/alpha/followers/"]'
    assert len(processed_payloads) == 1
    assert processed_payloads[0]["users"] == [{"username": "alpha", "id": "1"}]


def test_scrape_relationships_caps_chunk_by_remaining_daily_limit(monkeypatch):
    runner = _build_runner(monkeypatch)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)
    _mock_datauploader(monkeypatch)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: {"_id": "artifact_limited"},
    )

    def fake_scrape(*args, **kwargs):
        assert kwargs["chunk_limit"] == 1
        return {
            "outcome": "success",
            "users": [{"username": "alpha", "id": "1"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-limited",
        {
            "kind": "followers",
            "targets": ["alpha"],
            "chunkLimit": 50,
            "maxPagesPerAttempt": 2,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
        {"daily_scraping_limit": 1, "daily_scraping_used": 0},
    )

    assert result == "success"
    assert runner.profiles_client.increment_calls == [("session_profile", 1)]
    assert runner._get_cached_profile("session_profile")["daily_scraping_used"] == 1


def test_scrape_relationships_fails_when_daily_limit_is_already_reached(monkeypatch):
    runner = _build_runner(monkeypatch)
    monkeypatch.setattr(runner, "_emit_node_state", lambda *args, **kwargs: None)

    was_called = {"scrape": False}

    def fake_scrape(*args, **kwargs):
        was_called["scrape"] = True
        return {
            "outcome": "success",
            "users": [{"username": "alpha", "id": "1"}],
            "nextCursor": None,
            "hasMore": False,
            "total": 1,
        }

    monkeypatch.setattr(runner, "_scrape_relationship_chunk", fake_scrape)

    page = _FakePage(available_kinds={"followers"})
    result = runner._execute_scrape_relationships(
        "node-limit-reached",
        {
            "kind": "followers",
            "targets": ["alpha"],
            "chunkLimit": 50,
            "maxPagesPerAttempt": 2,
            "maxAttempts": 2,
            "retryBackoffSeconds": "5,10",
            "openDelaySeconds": 0,
        },
        page,
        "session_profile",
        {"daily_scraping_limit": 1, "daily_scraping_used": 1},
    )

    assert result == "failure"
    assert was_called["scrape"] is False
    state = runner.node_states["node-limit-reached"]
    assert state["lastErrorCode"] == "daily_scraping_limit_reached"


def test_scrape_relationships_upsert_artifact_row_returns_last_error_after_retries(monkeypatch):
    upsert_attempts = []
    sleep_calls = []

    def always_fail_post(path, payload):
        upsert_attempts.append({"path": path, "payload": payload})
        raise RuntimeError("convex unavailable")

    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", always_fail_post)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships.time.sleep",
        lambda seconds: sleep_calls.append(seconds),
    )

    _, executor = _build_executor(monkeypatch, node_id="node-upsert-direct")
    artifact_row, last_error = executor._upsert_artifact_row(
        {
            "workflowId": "wf_123",
            "nodeId": "node-upsert-direct",
            "metadata": {"activityId": "scrape_relationships"},
        }
    )

    assert artifact_row is None
    assert last_error == "convex unavailable"
    assert len(upsert_attempts) == len(ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS) + 1
    assert sleep_calls == list(ARTIFACT_UPSERT_RETRY_DELAYS_SECONDS)


def test_scrape_relationships_complete_active_kind_fails_when_artifact_upsert_exhausts_retries(monkeypatch):
    processed_payloads = []
    update_calls = []

    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships._convex_post_json",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("convex unavailable")),
    )
    monkeypatch.setattr(
        "python.runners.workflow.scrape_relationships.time.sleep",
        lambda seconds: None,
    )

    runner, executor = _build_executor(monkeypatch, node_id="node-complete-fallback")
    original_update_node_state = runner._update_node_state

    def record_update(node_id, **patch):
        update_calls.append({"node_id": node_id, "patch": dict(patch)})
        return original_update_node_state(node_id, **patch)

    monkeypatch.setattr(runner, "_update_node_state", record_update)
    executor.merged_users = [{"username": "alpha", "id": "1"}]
    executor.total_scraped = 1
    executor.chunks_completed = 1
    executor.current_target_index = len(executor.targets)

    assert executor._complete_active_kind() == "failure"

    assert processed_payloads[0]["users"] == executor.merged_users
    assert update_calls[-1]["patch"]["status"] == "failed"
    assert update_calls[-1]["patch"].get("done") is not True
    assert update_calls[-1]["patch"]["artifactId"] is None
    assert update_calls[-1]["patch"]["artifactUpsertError"] is None
    assert update_calls[-1]["patch"]["artifactUpsertPayload"] is None
    assert update_calls[-1]["patch"]["lastErrorCode"] == "artifact_upsert_failed"
    assert runner.node_states["node-complete-fallback"]["lastErrorCode"] == "artifact_upsert_failed"


def test_scrape_relationships_complete_active_kind_marks_completed_and_upserts_history(monkeypatch):
    processed_payloads = []
    upsert_payloads = []
    update_calls = []

    def fake_post(path, payload):
        upsert_payloads.append({"path": path, "payload": payload})
        return {"_id": "artifact_complete_success"}

    _mock_datauploader(monkeypatch, payloads=processed_payloads)
    monkeypatch.setattr("python.runners.workflow.scrape_relationships._convex_post_json", fake_post)

    runner, executor = _build_executor(monkeypatch, node_id="node-complete-success")
    original_update_node_state = runner._update_node_state

    def record_update(node_id, **patch):
        update_calls.append({"node_id": node_id, "patch": dict(patch)})
        return original_update_node_state(node_id, **patch)

    monkeypatch.setattr(runner, "_update_node_state", record_update)
    executor.merged_users = [{"username": "alpha", "id": "1"}]
    executor.total_scraped = 1
    executor.chunks_completed = 1
    executor.current_target_index = len(executor.targets)

    assert executor._complete_active_kind() == "success"

    assert processed_payloads[0]["users"] == executor.merged_users
    assert upsert_payloads[0]["path"] == "/api/workflow-artifacts/upsert"
    assert upsert_payloads[0]["payload"]["imported"] is True
    assert upsert_payloads[0]["payload"]["metadata"]["processingMode"] == "direct_datauploader"
    assert update_calls[-1]["patch"]["status"] == "completed"
    assert update_calls[-1]["patch"]["done"] is True
    assert update_calls[-1]["patch"]["artifactStorageId"] is None
    assert update_calls[-1]["patch"]["artifactId"] == "artifact_complete_success"
    assert update_calls[-1]["patch"]["artifactUpsertError"] is None
    assert update_calls[-1]["patch"]["resumeSnapshotPath"] is None


def test_scrape_relationships_fail_target_marks_failed_and_tracks_target(monkeypatch):
    update_calls = []

    runner, executor = _build_executor(monkeypatch, node_id="node-fail-target")
    original_update_node_state = runner._update_node_state

    def record_update(node_id, **patch):
        update_calls.append({"node_id": node_id, "patch": dict(patch)})
        return original_update_node_state(node_id, **patch)

    monkeypatch.setattr(runner, "_update_node_state", record_update)
    executor.current_target_index = 1
    executor.cursor = "cursor_fail"
    executor.attempt = 1
    executor.total_scraped = 3
    executor.chunks_completed = 2
    executor.target_scraped = 1
    executor.artifact_storage_id = "storage_fail"
    executor.resume_snapshot_path = "resume_fail.json"
    executor.failed_targets = [{"targetUsername": "alpha", "errorCode": None, "errorMessage": None}]

    assert (
        executor._fail_target(
            "beta",
            "retryable_error",
            "temporary_failure",
            "still broken",
        )
        == "failure"
    )

    assert executor.failed_targets[-1] == {
        "targetUsername": "beta",
        "errorCode": "temporary_failure",
        "errorMessage": "still broken",
    }
    assert update_calls[-1]["patch"]["status"] == "failed"
    assert update_calls[-1]["patch"]["attempt"] == 2
    assert update_calls[-1]["patch"]["failedTargets"] == executor.failed_targets
    assert update_calls[-1]["patch"]["lastErrorCode"] == "temporary_failure"
    assert runner.node_states["node-fail-target"]["failedTargets"] == executor.failed_targets


def test_scrape_relationships_queue_profiles_sequentially_until_complete(monkeypatch):
    monkeypatch.setattr("python.runners.workflow.runtime.InstagramAccountsClient", _DummyClient)
    monkeypatch.setattr("python.runners.workflow.runtime.ProfilesClient", _DummyClient)
    monkeypatch.setattr("python.runners.workflow.runtime.DisplayManager", _DummyDisplayManager)

    runner = run_workflow.WorkflowRunner(
        workflow_id="wf_queue",
        nodes=[
            {
                "id": "scrape-node",
                "type": "activity",
                "data": {"activityId": "scrape_relationships"},
            }
        ],
        edges=[],
        accounts=[
            run_workflow.ThreadsAccount(username="alpha", password="", proxy=""),
            run_workflow.ThreadsAccount(username="beta", password="", proxy=""),
            run_workflow.ThreadsAccount(username="gamma", password="", proxy=""),
        ],
        options={"parallel_profiles": 3, "workflow_name": "Queue Test"},
    )
    runner._executor.shutdown(wait=False, cancel_futures=True)

    processed = []

    def fake_process(account):
        processed.append(account.username)
        if account.username == "beta":
            runner.node_states["scrape-node"] = {
                "activityId": "scrape_relationships",
                "status": "completed",
                "done": True,
            }
        return True

    monkeypatch.setattr(runner, "process_account", fake_process)

    exit_code = runner.run()

    assert runner._max_workers == 1
    assert processed == ["alpha", "beta"]
    assert exit_code == 0


def test_scrape_relationships_queue_fails_when_profiles_exhausted(monkeypatch):
    monkeypatch.setattr("python.runners.workflow.runtime.InstagramAccountsClient", _DummyClient)
    monkeypatch.setattr("python.runners.workflow.runtime.ProfilesClient", _DummyClient)
    monkeypatch.setattr("python.runners.workflow.runtime.DisplayManager", _DummyDisplayManager)

    runner = run_workflow.WorkflowRunner(
        workflow_id="wf_queue_fail",
        nodes=[
            {
                "id": "scrape-node",
                "type": "activity",
                "data": {"activityId": "scrape_relationships"},
            }
        ],
        edges=[],
        accounts=[
            run_workflow.ThreadsAccount(username="alpha", password="", proxy=""),
            run_workflow.ThreadsAccount(username="beta", password="", proxy=""),
        ],
        options={"parallel_profiles": 2, "workflow_name": "Queue Fail Test"},
    )
    runner._executor.shutdown(wait=False, cancel_futures=True)
    monkeypatch.setattr(runner, "process_account", lambda account: True)

    exit_code = runner.run()

    assert exit_code == 1
