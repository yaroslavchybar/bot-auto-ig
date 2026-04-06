"""Workflow-specific regression tests split from test_runner_regressions.py."""

import io
import json
import logging
from datetime import datetime, timezone
from enum import Enum
from types import SimpleNamespace
from uuid import UUID

import pytest

from python.runners.workflow.activity_dispatch import (
    _run_follow_activity,
    _run_loop,
    _run_python_script,
    _run_send_dm_activity,
    _run_unfollow_activity,
    execute_activity as execute_workflow_activity,
)
from python.runners.workflow.account_session import _handle_account_exception, _run_account_nodes, process_account
from python.runners.workflow.entrypoint import _start_node_inputs
from python.runners.workflow.bootstrap import fetch_profiles_for_lists as fetch_workflow_profiles_for_lists
from python.runners.workflow.io import emit_event as emit_workflow_event
from python.runners.workflow.runtime import WorkflowRunner
from python.runners.workflow.scrape_script import RELATIONSHIP_CHUNK_SCRIPT


def test_workflow_start_node_inputs_ignores_none_in_select_list_source_lists(monkeypatch):
    start_node = {'id': 'start', 'type': 'start', 'data': {'sourceLists': ['fallback-list']}}
    nodes = [
        start_node,
        {
            'id': 'node-1',
            'data': {
                'activityId': 'select_list',
                'config': {'sourceLists': [None, '  ', 'list-1', False, 'list-2']},
            },
        },
    ]

    _, _, list_ids = _start_node_inputs(nodes)

    assert list_ids == ['list-1', 'list-2']


def test_workflow_start_node_inputs_ignores_none_in_start_node_fallback(monkeypatch):
    start_node = {'id': 'start', 'type': 'start', 'data': {'sourceLists': [None, '  ', 'legacy-list', ' second-list ']}}
    nodes = [start_node]

    _, _, list_ids = _start_node_inputs(nodes)

    assert list_ids == ['legacy-list', 'second-list']


def test_workflow_follow_activity_passes_following_limit_separately(monkeypatch):
    captured = {}

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.follow_usernames', lambda **kwargs: captured.update(kwargs))
    monkeypatch.setattr('python.runners.workflow.activity_dispatch.log', lambda _message: None)
    monkeypatch.setattr('python.runners.workflow.activity_dispatch._resolve_profile_id', lambda *_args, **_kwargs: 'profile-1')

    runner = SimpleNamespace(
        running=True,
        accounts_client=SimpleNamespace(
            get_accounts_for_profile=lambda _profile_id: [
                {'id': 'acct-1', 'user_name': 'alice'},
                {'id': 'acct-2', 'user_name': 'bob'},
            ]
        ),
    )
    account = SimpleNamespace(username='session-user', proxy='proxy://example')
    cfg = {
        'follow_min_count': 1,
        'follow_max_count': 2,
        'follow_min_delay_seconds': 5,
        'follow_max_delay_seconds': 9,
        'highlights_min': 0,
        'highlights_max': 2,
        'likes_percentage': 15,
        'scroll_percentage': 25,
        'following_limit': 4321,
    }

    result = _run_follow_activity(runner, cfg, page=object(), account=account, profile_data=None)

    assert result == 'success'
    assert captured['following_limit'] == 4321
    assert captured['interactions_config'] == {
        'highlights_range': (0, 2),
        'likes_percentage': 15,
        'scroll_percentage': 25,
    }


def test_workflow_run_account_nodes_returns_false_for_unhandled_failure(monkeypatch):
    events = []
    states = []

    def _fake_next_node(_edge_index, node_id, handle):
        mapping = {
            ('start', ''): 'activity',
            ('activity', 'failure'): None,
        }
        return mapping.get((node_id, handle))

    monkeypatch.setattr('python.runners.workflow.account_session._find_start_node', lambda nodes: nodes[0])
    monkeypatch.setattr('python.runners.workflow.account_session._next_node', _fake_next_node)
    monkeypatch.setattr('python.runners.workflow.account_session.emit_event', lambda event_type, **data: events.append((event_type, data)))

    runner = SimpleNamespace(
        running=True,
        nodes=[{'id': 'start', 'type': 'start'}, {'id': 'activity', 'type': 'activity', 'data': {'activityId': 'follow_user', 'label': 'Follow'}}],
        edge_index={},
        node_index={'start': {'id': 'start', 'type': 'start'}, 'activity': {'id': 'activity', 'type': 'activity', 'data': {'activityId': 'follow_user', 'label': 'Follow'}}},
        _execute_activity=lambda *args, **kwargs: 'failure',
        _update_node_state=lambda node_id, **patch: states.append((node_id, patch)),
        _emit_node_state=lambda *args, **kwargs: None,
        _sanitize_node_states=lambda: {},
        workflow_id='wf-1',
    )

    assert _run_account_nodes(runner, SimpleNamespace(), {'profile_name': 'alice'}, None) is False
    assert events[0][0] == 'task_started'


def test_workflow_process_account_emits_failed_completion_when_nodes_fail(monkeypatch):
    events = []

    runner = SimpleNamespace(
        workflow_id='wf-2',
        running=True,
        profiles_client=SimpleNamespace(sync_profile_status=lambda *args, **kwargs: None),
        display_mgr=SimpleNamespace(release=lambda *args, **kwargs: None),
    )

    monkeypatch.setattr('python.runners.workflow.account_session.emit_event', lambda event_type, **data: events.append((event_type, data)))
    monkeypatch.setattr('python.runners.workflow.account_session.log', lambda _message: None)
    monkeypatch.setattr('python.runners.workflow.account_session._load_profile_data', lambda *args, **kwargs: None)
    monkeypatch.setattr('python.runners.workflow.account_session._hydrate_browser_identity', lambda *args, **kwargs: None)
    monkeypatch.setattr('python.runners.workflow.account_session._allocate_display', lambda *args, **kwargs: None)
    monkeypatch.setattr('python.runners.workflow.account_session._run_account_nodes', lambda *args, **kwargs: False)
    monkeypatch.setattr('python.runners.workflow.account_session._cleanup_browser_context', lambda *args, **kwargs: None)
    monkeypatch.setattr('python.runners.workflow.account_session._release_display', lambda *args, **kwargs: None)

    assert process_account(runner, SimpleNamespace(username='alice', proxy=None)) is False
    assert ('profile_completed', {'profile': 'alice', 'status': 'failed', 'workflow_id': 'wf-2'}) in events


def test_workflow_general_exception_emits_failed_completion(monkeypatch):
    events = []

    monkeypatch.setattr('python.runners.workflow.account_session.emit_event', lambda event_type, **data: events.append((event_type, data)))
    monkeypatch.setattr('python.runners.workflow.account_session.log', lambda _message: None)
    monkeypatch.setattr('python.runners.workflow.account_session._sync_profile_status', lambda *args, **kwargs: None)

    runner = SimpleNamespace(running=True, workflow_id='wf-3')

    assert _handle_account_exception(runner, 'alice', RuntimeError('boom')) is False
    assert events == [('profile_completed', {'profile': 'alice', 'status': 'failed', 'workflow_id': 'wf-3'})]


def test_workflow_unknown_activity_returns_failure_and_logs(monkeypatch):
    messages = []

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.log', messages.append)

    result = execute_workflow_activity(
        runner=SimpleNamespace(),
        node_id='node-1',
        activity_id='totally_unknown',
        cfg={},
        browser_state={'page': object(), 'profile_name': 'alice'},
        account=SimpleNamespace(username='alice', proxy=''),
        profile_data=None,
        loop_state={},
    )

    assert result == 'failure'
    assert messages == ['Unknown workflow activity: totally_unknown']


def test_workflow_python_script_is_disabled(monkeypatch):
    messages = []

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.log', messages.append)

    result = execute_workflow_activity(
        runner=SimpleNamespace(),
        node_id='node-1',
        activity_id='python_script',
        cfg={'code': 'log("hello")'},
        browser_state={'page': object(), 'profile_name': 'alice'},
        account=SimpleNamespace(username='alice', proxy=''),
        profile_data={'profile_id': 'profile-1'},
        loop_state={'node-1': 3},
    )

    assert result == 'failure'
    assert messages == [
        'python_script workflow activity is disabled for security reasons; remove this node from the workflow.'
    ]


def test_run_python_script_without_code_still_fails(monkeypatch):
    messages = []

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.log', messages.append)

    assert _run_python_script({}) == 'failure'
    assert messages == ['python_script workflow activity is disabled and no longer supported.']


def test_workflow_loop_state_advances_with_fresh_configs_when_node_id_missing(monkeypatch):
    loop_state = {}
    assert _run_loop(None, {'iterations': 2}, loop_state) == 'loop'
    assert _run_loop(None, {'iterations': 2}, loop_state) == 'done'


def test_workflow_loop_state_does_not_collide_for_distinct_missing_node_configs(monkeypatch):
    loop_state = {}

    assert _run_loop(None, {'iterations': 2, 'label': 'alpha'}, loop_state) == 'loop'
    assert _run_loop(None, {'iterations': 3, 'label': 'beta'}, loop_state) == 'loop'
    assert _run_loop(None, {'iterations': 2, 'label': 'alpha'}, loop_state) == 'done'
    assert _run_loop(None, {'iterations': 3, 'label': 'beta'}, loop_state) == 'loop'


def test_workflow_unfollow_activity_fails_when_status_sync_fails(monkeypatch):
    logs = []

    def _fake_unfollow_usernames(**kwargs):
        try:
            kwargs['on_success']('target')
        except Exception as exc:
            kwargs['log'](f'Error processing target: {exc}')

    runner = SimpleNamespace(
        accounts_client=SimpleNamespace(
            get_accounts_for_profile=lambda *_args, **_kwargs: [{'user_name': 'target', 'id': 'account-1'}],
            update_account_status=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('db down')),
        ),
        running=True,
    )

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.unfollow_usernames', _fake_unfollow_usernames)
    monkeypatch.setattr('python.runners.workflow.activity_dispatch.log', logs.append)
    monkeypatch.setattr('python.runners.workflow.activity_dispatch.apply_count_limit', lambda items, _range: list(items))

    result = _run_unfollow_activity(
        runner,
        {'unfollow_min_count': 1, 'unfollow_max_count': 1},
        object(),
        SimpleNamespace(username='alice', proxy=''),
        {'profile_id': 'profile-1'},
    )

    assert result == 'failure'
    assert logs == ['Failed to save unfollow status for @target: db down', 'Error processing target: db down']


def test_workflow_unfollow_activity_marks_targets_as_scraping(monkeypatch):
    status_updates = []

    def _fake_unfollow_usernames(**kwargs):
        kwargs['on_success']('target')

    runner = SimpleNamespace(
        accounts_client=SimpleNamespace(
            get_accounts_for_profile=lambda *_args, **_kwargs: [{'user_name': 'target', 'id': 'account-1'}],
            update_account_status=lambda account_id, status='subscribed', assigned_to='__NOT_SET__': status_updates.append(
                {'account_id': account_id, 'status': status, 'assigned_to': assigned_to}
            ),
        ),
        running=True,
    )

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.unfollow_usernames', _fake_unfollow_usernames)
    monkeypatch.setattr('python.runners.workflow.activity_dispatch.log', lambda _message: None)
    monkeypatch.setattr('python.runners.workflow.activity_dispatch.apply_count_limit', lambda items, _range: list(items))

    result = _run_unfollow_activity(
        runner,
        {'unfollow_min_count': 1, 'unfollow_max_count': 1},
        object(),
        SimpleNamespace(username='alice', proxy=''),
        {'profile_id': 'profile-1'},
    )

    assert result == 'success'
    assert status_updates == [
        {'account_id': 'account-1', 'status': 'scraping', 'assigned_to': '__NOT_SET__'}
    ]


def test_workflow_send_dm_activity_requests_scraping_status_for_direct_messages(monkeypatch):
    captured = {}

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.send_messages', lambda **kwargs: captured.update(kwargs))

    runner = SimpleNamespace(
        accounts_client=SimpleNamespace(
            get_accounts_to_message=lambda *_args, **_kwargs: [{'id': 'account-1', 'user_name': 'target'}],
        ),
        messaging_cooldown_enabled=False,
        messaging_cooldown_hours=0,
        running=True,
    )

    result = _run_send_dm_activity(
        runner,
        {'follow_if_no_message_button': True},
        object(),
        SimpleNamespace(username='alice', proxy=''),
        {'profile_id': 'profile-1'},
    )

    assert result == 'success'
    assert captured['behavior_config']['direct_message_success_status'] == 'scraping'


def test_workflow_fetch_profiles_ignores_redirect_responses(monkeypatch):
    class _Response:
        status_code = 302

        @staticmethod
        def json():
            raise AssertionError('redirect response should not be parsed as JSON')

    monkeypatch.setattr('requests.post', lambda *args, **kwargs: _Response())

    assert fetch_workflow_profiles_for_lists('https://convex.example', '', ['list-1']) == []


def test_workflow_fetch_profiles_logs_exception_before_empty_fallback(monkeypatch, caplog):
    def _raise_request_error(*args, **kwargs):
        raise RuntimeError('network down')

    monkeypatch.setattr('requests.post', _raise_request_error)

    with caplog.at_level(logging.ERROR):
        profiles = fetch_workflow_profiles_for_lists('https://convex.example', '', ['list-1'])

    assert profiles == []
    assert 'Failed to fetch workflow profiles for lists via /api/profiles/by-list-ids' in caplog.text
    assert 'network down' in caplog.text


def _parse_framed_workflow_event(stdout: io.StringIO) -> dict:
    raw_output = stdout.getvalue()

    assert raw_output.startswith('__EVENT__')
    assert raw_output.endswith('__EVENT__\n')

    payload = raw_output.removeprefix('__EVENT__').removesuffix('__EVENT__\n')
    return json.loads(payload)


def test_workflow_emit_event_preserves_type_and_timestamp(monkeypatch):
    stdout = io.StringIO()

    monkeypatch.setattr('python.runners.workflow.io.sys.stdout', stdout)
    monkeypatch.setattr('python.runners.workflow.io._now_iso', lambda: '2026-03-13T12:00:00+00:00')

    emit_workflow_event('task_started', type='override', ts='override', profile='alice')

    assert _parse_framed_workflow_event(stdout) == {
        'type': 'task_started',
        'ts': '2026-03-13T12:00:00+00:00',
        'profile': 'alice',
    }


def test_workflow_emit_event_keeps_old_sentinel_text_inside_payload(monkeypatch):
    stdout = io.StringIO()

    monkeypatch.setattr('python.runners.workflow.io.sys.stdout', stdout)
    monkeypatch.setattr('python.runners.workflow.io._now_iso', lambda: '2026-03-13T12:00:00+00:00')

    emit_workflow_event('task_progress', detail='checkpoint }__EVENT__ reached')

    assert _parse_framed_workflow_event(stdout) == {
        'type': 'task_progress',
        'ts': '2026-03-13T12:00:00+00:00',
        'detail': 'checkpoint }__EVENT__ reached',
    }


def test_workflow_emit_event_serializes_common_non_json_values(monkeypatch):
    class _Status(Enum):
        READY = 'ready'

    stdout = io.StringIO()

    monkeypatch.setattr('python.runners.workflow.io.sys.stdout', stdout)
    monkeypatch.setattr('python.runners.workflow.io._now_iso', lambda: '2026-03-13T12:00:00+00:00')

    emit_workflow_event(
        'task_progress',
        happened_at=datetime(2026, 3, 13, 12, 5, tzinfo=timezone.utc),
        error=RuntimeError('boom'),
        status=_Status.READY,
        payload=b'hello',
        job_id=UUID('12345678-1234-5678-1234-567812345678'),
    )

    assert _parse_framed_workflow_event(stdout) == {
        'type': 'task_progress',
        'ts': '2026-03-13T12:00:00+00:00',
        'happened_at': '2026-03-13T12:05:00+00:00',
        'error': 'boom',
        'status': 'ready',
        'payload': 'hello',
        'job_id': '12345678-1234-5678-1234-567812345678',
    }


def test_workflow_emit_event_falls_back_when_json_dump_still_fails(monkeypatch):
    stdout = io.StringIO()
    recursive = []
    recursive.append(recursive)

    monkeypatch.setattr('python.runners.workflow.io.sys.stdout', stdout)
    monkeypatch.setattr('python.runners.workflow.io._now_iso', lambda: '2026-03-13T12:00:00+00:00')

    emit_workflow_event('task_progress', detail=recursive)

    payload = _parse_framed_workflow_event(stdout)
    assert payload['type'] == 'task_progress'
    assert payload['ts'] == '2026-03-13T12:00:00+00:00'
    assert payload['serialization_error'] == 'ValueError: Circular reference detected'
    assert payload['raw_event'] == {
        'keys': ['detail', 'type', 'ts'],
        'value_types': {
            'detail': 'list',
            'type': 'str',
            'ts': 'str',
        },
        'has_nested_data': True,
    }


def test_workflow_runner_get_node_state_returns_copy():
    runner = WorkflowRunner('wf-1', [], [], [], {})
    try:
        runner._update_node_state('node-1', status='running')
        snapshot = runner._get_node_state('node-1')
        snapshot['status'] = 'failed'

        assert runner.node_states['node-1']['status'] == 'running'
    finally:
        runner._executor.shutdown(wait=True)


def test_relationship_chunk_script_accepts_numeric_next_cursor():
    assert 'const rawNextMaxId = payload?.next_max_id' in RELATIONSHIP_CHUNK_SCRIPT
    assert 'String(rawNextMaxId).trim() || null' in RELATIONSHIP_CHUNK_SCRIPT
