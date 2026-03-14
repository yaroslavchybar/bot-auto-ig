import io
import json
import logging
from datetime import datetime, timezone
from enum import Enum
from types import SimpleNamespace
from uuid import UUID

import pytest

from python.actions.engagement.follow.common import normalize_range
from python.browser.proxy import parse_proxy_string
from python.core.utils import build_action_order
from python.core.selector_engine import _text_fallback
from python.runners.multi_account.account_session import (
    _handle_account_exception as _handle_multi_account_exception,
    _is_reopen_cooldown_active,
    _run_account_session,
    _sync_profile_idle,
)
from python.runners.multi_account.activity_dispatch import _scroll_duration
from python.runners.multi_account.config import _action_order
from python.runners.multi_account.entrypoint import _load_profiles
from python.runners.multi_account.runtime import InstagramAutomationRunner, run_automation_session
from python.runners.run_multiple_accounts import _fetch_profiles_for_lists
from python.runners.workflow.activity_dispatch import (
    _run_follow_activity,
    _run_loop,
    _run_python_script,
    _run_unfollow_activity,
    execute_activity as execute_workflow_activity,
)
from python.runners.workflow.account_session import _handle_account_exception, _run_account_nodes, process_account
from python.runners.workflow.entrypoint import _start_node_inputs
from python.runners.workflow.bootstrap import fetch_profiles_for_lists as fetch_workflow_profiles_for_lists
from python.runners.workflow.io import emit_event as emit_workflow_event
from python.runners.workflow.runtime import WorkflowRunner
from python.runners.workflow.scrape_script import RELATIONSHIP_CHUNK_SCRIPT


def test_parse_proxy_string_wraps_ipv6_host_with_port():
    assert parse_proxy_string('2001:db8::1:8080') == {'server': 'http://[2001:db8::1]:8080'}


def test_parse_proxy_string_splits_credentials_from_server_url():
    assert parse_proxy_string('user:pass@host:8080') == {
        'server': 'http://host:8080',
        'username': 'user',
        'password': 'pass',
    }


def test_parse_proxy_string_returns_none_for_invalid_auth_proxy_port(caplog):
    with caplog.at_level(logging.WARNING):
        parsed = parse_proxy_string('user:pass@host:abc')

    assert parsed is None
    assert "Error parsing proxy 'user:pass@host:abc'" in caplog.text


def test_parse_proxy_string_returns_none_for_invalid_auth_proxy_ipv6(caplog):
    with caplog.at_level(logging.WARNING):
        parsed = parse_proxy_string('user:pass@[::1')

    assert parsed is None
    assert "Error parsing proxy 'user:pass@[::1'" in caplog.text


def test_selector_text_fallback_handles_apostrophes_without_css_interpolation():
    selector = SimpleNamespace(text="O'Brien", role=None, element_name='message')

    class _Candidate:
        def count(self):
            return 1

        def nth(self, _index):
            return self

        def is_visible(self):
            return True

        def is_enabled(self):
            return True

    class _Filtered:
        def __init__(self, candidate):
            self._candidate = candidate

        def count(self):
            return 1

        def nth(self, _index):
            return self._candidate

    class _Root:
        def __init__(self, candidate):
            self.candidate = candidate
            self.seen_text = None

        def filter(self, *, has_text):
            self.seen_text = has_text
            return _Filtered(self.candidate)

    class _Page:
        def __init__(self, root):
            self.root = root

        def locator(self, query):
            assert query == (
                'button, a, input, textarea, select, label, '
                '[role="button"], [role="link"], [tabindex], [contenteditable="true"]'
            )
            return self.root

    candidate = _Candidate()
    root = _Root(candidate)
    page = _Page(root)

    assert _text_fallback(selector, page) is candidate
    assert root.seen_text == "O'Brien"


def test_reopen_cooldown_ignores_invalid_timestamp():
    runner = SimpleNamespace(
        config=SimpleNamespace(
            profile_reopen_cooldown_enabled=True,
            profile_reopen_cooldown_minutes=30,
        )
    )

    assert _is_reopen_cooldown_active(runner, {'last_opened_at': 'not-a-timestamp'}) is False


def test_scroll_duration_normalizes_reversed_ranges(monkeypatch):
    seen = []
    runner = SimpleNamespace(
        config=SimpleNamespace(
            enable_feed=True,
            feed_min_time_minutes=5,
            feed_max_time_minutes=1,
            enable_reels=False,
            reels_min_time_minutes=0,
            reels_max_time_minutes=0,
        )
    )

    monkeypatch.setattr('python.runners.multi_account.activity_dispatch.compat_module', lambda: SimpleNamespace(normalize_range=normalize_range))
    monkeypatch.setattr('python.runners.multi_account.activity_dispatch.random.randint', lambda low, high: seen.append((low, high)) or low)

    assert _scroll_duration(runner, 'feed') == 1
    assert seen == [(1, 5)]


def test_runner_parallel_profiles_uses_safe_int_parse(monkeypatch):
    class _Compat:
        @staticmethod
        def _parse_int(value, default):
            try:
                return int(value)
            except Exception:
                return default

        class InstagramAccountsClient:
            pass

        class ProfilesClient:
            pass

    monkeypatch.setattr('python.runners.multi_account.runtime.compat_module', lambda: _Compat)

    runner = InstagramAutomationRunner(SimpleNamespace(parallel_profiles='oops'), ['a', 'b'])
    try:
        assert runner._max_workers == 1
    finally:
        runner._executor.shutdown(wait=True)


def test_multi_account_session_emits_failed_end_event_when_cycles_raise(monkeypatch):
    events = []
    logs = []
    shutdowns = []

    class _Compat:
        @staticmethod
        def emit_event(event_type, **data):
            events.append((event_type, data))

        @staticmethod
        def log(message):
            logs.append(message)

    def _raise_cycles(_runner):
        raise RuntimeError('boom')

    monkeypatch.setattr('python.runners.multi_account.runtime.compat_module', lambda: _Compat)
    monkeypatch.setattr('python.runners.multi_account.runtime._run_cycles', _raise_cycles)
    monkeypatch.setattr(
        'python.runners.multi_account.runtime._shutdown_executor',
        lambda executor, *, wait: shutdowns.append((executor, wait)),
    )

    runner = SimpleNamespace(accounts=['alice'], running=True, _executor=object())

    try:
        run_automation_session(runner)
    except RuntimeError as exc:
        assert str(exc) == 'boom'
    else:
        raise AssertionError('run_automation_session should re-raise cycle errors')

    assert events == [
        ('session_started', {'total_accounts': 1}),
        ('session_ended', {'status': 'failed'}),
    ]
    assert logs == ['Automation stopped.']
    assert shutdowns == [(runner._executor, True)]


def test_multi_account_session_emits_failed_end_event_when_no_accounts(monkeypatch):
    events = []
    logs = []
    shutdowns = []

    class _Compat:
        @staticmethod
        def emit_event(event_type, **data):
            events.append((event_type, data))

        @staticmethod
        def log(message):
            logs.append(message)

    monkeypatch.setattr('python.runners.multi_account.runtime.compat_module', lambda: _Compat)
    monkeypatch.setattr(
        'python.runners.multi_account.runtime._shutdown_executor',
        lambda executor, *, wait: shutdowns.append((executor, wait)),
    )

    runner = SimpleNamespace(accounts=[], running=True, _executor=object())

    assert run_automation_session(runner) == 2
    assert events == [
        ('session_started', {'total_accounts': 0}),
        ('session_ended', {'status': 'failed'}),
    ]
    assert logs == ['No profiles to start.', 'Automation stopped.']
    assert shutdowns == [(runner._executor, True)]


def test_fetch_profiles_for_lists_ignores_redirect_responses(monkeypatch):
    class _Response:
        status_code = 302

        @staticmethod
        def json():
            raise AssertionError('redirect response should not be parsed as JSON')

    monkeypatch.setattr('python.runners.run_multiple_accounts.PROJECT_URL', 'https://convex.example')
    monkeypatch.setattr('python.runners.run_multiple_accounts.SECRET_KEY', '')
    monkeypatch.setattr('python.runners.run_multiple_accounts.requests.post', lambda *args, **kwargs: _Response())

    assert _fetch_profiles_for_lists(['list-1']) == []


def test_multi_account_load_profiles_tolerates_none_from_fetch():
    logs = []

    class _Compat:
        @staticmethod
        def log(message):
            logs.append(message)

        @staticmethod
        def _fetch_profiles_for_lists(_list_ids):
            return None

    assert _load_profiles(_Compat, ['list-1']) is None
    assert logs == [
        'DEBUG: fetched profiles count=0',
        'No profiles found in the selected list!',
    ]


def test_multi_account_action_order_filters_none_and_preserves_default_fallback():
    action_order = _action_order({'action_order': [None, '  ', ' Feed Scroll ']})

    assert action_order == ['Feed Scroll']

    default_order = build_action_order(
        SimpleNamespace(
            action_order=_action_order({'action_order': [None]}),
            enable_feed=True,
            enable_reels=False,
            watch_stories=False,
            enable_follow=False,
            enable_unfollow=False,
            enable_approve=False,
            enable_message=False,
        )
    )

    assert default_order == ['Feed Scroll']


def test_workflow_start_node_inputs_ignores_none_in_select_list_source_lists(monkeypatch):
    start_node = {'id': 'start', 'data': {'sourceLists': ['fallback-list']}}
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
    compat = SimpleNamespace(_find_start_node=lambda _nodes: start_node)

    _, _, list_ids = _start_node_inputs(compat, nodes)

    assert list_ids == ['list-1', 'list-2']


def test_workflow_start_node_inputs_ignores_none_in_start_node_fallback(monkeypatch):
    start_node = {'id': 'start', 'data': {'sourceLists': [None, '  ', 'legacy-list', ' second-list ']}}
    nodes = [start_node]
    compat = SimpleNamespace(_find_start_node=lambda _nodes: start_node)

    _, _, list_ids = _start_node_inputs(compat, nodes)

    assert list_ids == ['legacy-list', 'second-list']


def test_workflow_follow_activity_passes_following_limit_separately(monkeypatch):
    captured = {}

    class _Compat:
        @staticmethod
        def _parse_int(value, default):
            try:
                return int(value)
            except Exception:
                return default

        @staticmethod
        def normalize_range(values, _default):
            low, high = values
            return (min(low, high), max(low, high))

        @staticmethod
        def apply_count_limit(usernames, _count_range):
            return usernames

        @staticmethod
        def log(_message):
            return None

        @staticmethod
        def follow_usernames(**kwargs):
            captured.update(kwargs)

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.compat_module', lambda: _Compat)
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

    class _Compat:
        @staticmethod
        def _find_start_node(nodes):
            return nodes[0]

        @staticmethod
        def _next_node(_edge_index, node_id, handle):
            mapping = {
                ('start', ''): 'activity',
                ('activity', 'failure'): None,
            }
            return mapping.get((node_id, handle))

        @staticmethod
        def emit_event(event_type, **data):
            events.append((event_type, data))

    monkeypatch.setattr('python.runners.workflow.account_session.compat_module', lambda: _Compat)

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

    class _Compat:
        @staticmethod
        def emit_event(event_type, **data):
            events.append((event_type, data))

        @staticmethod
        def log(_message):
            return None

    runner = SimpleNamespace(
        workflow_id='wf-2',
        running=True,
        profiles_client=SimpleNamespace(sync_profile_status=lambda *args, **kwargs: None),
        display_mgr=SimpleNamespace(release=lambda *args, **kwargs: None),
    )

    monkeypatch.setattr('python.runners.workflow.account_session.compat_module', lambda: _Compat)
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

    class _Compat:
        @staticmethod
        def emit_event(event_type, **data):
            events.append((event_type, data))

        @staticmethod
        def log(_message):
            return None

    monkeypatch.setattr('python.runners.workflow.account_session.compat_module', lambda: _Compat)
    monkeypatch.setattr('python.runners.workflow.account_session._sync_profile_status', lambda *args, **kwargs: None)

    runner = SimpleNamespace(running=True, workflow_id='wf-3')

    assert _handle_account_exception(runner, 'alice', RuntimeError('boom')) is False
    assert events == [('profile_completed', {'profile': 'alice', 'status': 'failed', 'workflow_id': 'wf-3'})]


def test_multi_account_general_exception_emits_failed_completion(monkeypatch):
    events = []
    synced = []

    class _Compat:
        @staticmethod
        def emit_event(event_type, **data):
            events.append((event_type, data))

        @staticmethod
        def log(_message):
            return None

    monkeypatch.setattr('python.runners.multi_account.account_session.compat_module', lambda: _Compat)

    runner = SimpleNamespace(
        running=True,
        profiles_client=SimpleNamespace(sync_profile_status=lambda profile_name, status, running: synced.append((profile_name, status, running))),
    )

    assert _handle_multi_account_exception(runner, 'alice', RuntimeError('boom')) is False
    assert events == [('profile_completed', {'profile': 'alice', 'status': 'failed'})]
    assert synced == [('alice', 'idle', False)]


@pytest.mark.xfail(reason='Pre-existing: cooperative stop emits cancelled instead of success')
def test_multi_account_cooperative_stop_emits_success_before_idle_sync(monkeypatch):
    order = []

    class _BrowserContext:
        def __enter__(self):
            return object(), object()

        def __exit__(self, exc_type, exc, tb):
            return False

    class _Compat:
        @staticmethod
        def create_browser_context(*args, **kwargs):
            return _BrowserContext()

        @staticmethod
        def emit_event(event_type, **data):
            order.append((event_type, data))

        @staticmethod
        def log(_message):
            return None

    def _stop_runner(_runner, _page, _account, _profile_data, _message_targets):
        runner.running = False

    def _record_sync(_runner, profile_name):
        order.append(('sync_idle', profile_name))

    monkeypatch.setattr('python.runners.multi_account.account_session.compat_module', lambda: _Compat)
    monkeypatch.setattr('python.runners.multi_account.account_session._run_enabled_actions', _stop_runner)
    monkeypatch.setattr('python.runners.multi_account.account_session._sync_profile_idle', _record_sync)

    runner = SimpleNamespace(config=SimpleNamespace(headless=True), running=True)
    account = SimpleNamespace(username='alice', proxy=None)

    assert _run_account_session(runner, account, profile_data=None, message_targets=None) is True
    assert order == [
        ('profile_completed', {'profile': 'alice', 'status': 'success'}),
        ('sync_idle', 'alice'),
    ]


def test_multi_account_sync_profile_idle_retries_and_logs_once(caplog):
    attempts = []

    class _ProfilesClient:
        @staticmethod
        def sync_profile_status(profile_name, status, running):
            attempts.append((profile_name, status, running))
            if len(attempts) == 1:
                raise RuntimeError('temporary outage')

    runner = SimpleNamespace(profiles_client=_ProfilesClient())

    with caplog.at_level(logging.ERROR):
        _sync_profile_idle(runner, 'alice')

    assert attempts == [('alice', 'idle', False), ('alice', 'idle', False)]
    assert "retrying once" in caplog.text
    assert "temporary outage" in caplog.text
    assert "alice" in caplog.text


def test_multi_account_sync_profile_idle_logs_inconsistent_state_after_retry(caplog):
    attempts = []

    class _ProfilesClient:
        @staticmethod
        def sync_profile_status(profile_name, status, running):
            attempts.append((profile_name, status, running))
            raise RuntimeError('convex unavailable')

    runner = SimpleNamespace(profiles_client=_ProfilesClient())

    with caplog.at_level(logging.ERROR):
        _sync_profile_idle(runner, 'alice')

    assert attempts == [('alice', 'idle', False), ('alice', 'idle', False)]
    assert "retrying once" in caplog.text
    assert "profile state may remain inconsistent" in caplog.text
    assert "convex unavailable" in caplog.text


def test_workflow_unknown_activity_returns_failure_and_logs(monkeypatch):
    messages = []
    compat = SimpleNamespace(log=messages.append)

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.compat_module', lambda: compat)

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
    compat = SimpleNamespace(log=messages.append)

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.compat_module', lambda: compat)

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
    compat = SimpleNamespace(log=messages.append)

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.compat_module', lambda: compat)

    assert _run_python_script({}) == 'failure'
    assert messages == ['python_script workflow activity is disabled and no longer supported.']


def test_workflow_loop_state_advances_with_fresh_configs_when_node_id_missing(monkeypatch):
    monkeypatch.setattr(
        'python.runners.workflow.activity_dispatch.compat_module',
        lambda: SimpleNamespace(_parse_int=lambda value, default: int(value) if value is not None else default),
    )

    loop_state = {}
    assert _run_loop(None, {'iterations': 2}, loop_state) == 'loop'
    assert _run_loop(None, {'iterations': 2}, loop_state) == 'done'


def test_workflow_loop_state_does_not_collide_for_distinct_missing_node_configs(monkeypatch):
    monkeypatch.setattr(
        'python.runners.workflow.activity_dispatch.compat_module',
        lambda: SimpleNamespace(_parse_int=lambda value, default: int(value) if value is not None else default),
    )

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

    compat = SimpleNamespace(
        _parse_int=lambda value, default: int(value) if value is not None else default,
        normalize_range=lambda values, default: normalize_range(values, default),
        unfollow_usernames=_fake_unfollow_usernames,
        log=logs.append,
        apply_count_limit=lambda items, _range: list(items),
    )
    runner = SimpleNamespace(
        accounts_client=SimpleNamespace(
            get_accounts_for_profile=lambda *_args, **_kwargs: [{'user_name': 'target', 'id': 'account-1'}],
            update_account_status=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('db down')),
        ),
        running=True,
    )

    monkeypatch.setattr('python.runners.workflow.activity_dispatch.compat_module', lambda: compat)

    result = _run_unfollow_activity(
        runner,
        {'unfollow_min_count': 1, 'unfollow_max_count': 1},
        object(),
        SimpleNamespace(username='alice', proxy=''),
        {'profile_id': 'profile-1'},
    )

    assert result == 'failure'
    assert logs == ['Failed to save unfollow status for @target: db down', 'Error processing target: db down']


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
