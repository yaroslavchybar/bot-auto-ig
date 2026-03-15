import logging
from types import SimpleNamespace

import pytest

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
from python.runners.multi_account.profiles import _fetch_profiles_for_lists


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

    monkeypatch.setattr('python.runners.multi_account.activity_dispatch.random.randint', lambda low, high: seen.append((low, high)) or low)

    assert _scroll_duration(runner, 'feed') == 1
    assert seen == [(1, 5)]


def test_runner_parallel_profiles_uses_safe_int_parse(monkeypatch):
    class _FakeAccountsClient:
        pass

    class _FakeProfilesClient:
        pass

    monkeypatch.setattr('python.runners.multi_account.runtime.InstagramAccountsClient', _FakeAccountsClient)
    monkeypatch.setattr('python.runners.multi_account.runtime.ProfilesClient', _FakeProfilesClient)

    runner = InstagramAutomationRunner(SimpleNamespace(parallel_profiles='oops'), ['a', 'b'])
    try:
        assert runner._max_workers == 1
    finally:
        runner._executor.shutdown(wait=True)


def test_multi_account_session_emits_failed_end_event_when_cycles_raise(monkeypatch):
    events = []
    logs = []
    shutdowns = []

    def _raise_cycles(_runner):
        raise RuntimeError('boom')

    monkeypatch.setattr('python.runners.multi_account.runtime.emit_event', lambda event_type, **data: events.append((event_type, data)))
    monkeypatch.setattr('python.runners.multi_account.runtime.log', logs.append)
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

    monkeypatch.setattr('python.runners.multi_account.runtime.emit_event', lambda event_type, **data: events.append((event_type, data)))
    monkeypatch.setattr('python.runners.multi_account.runtime.log', logs.append)
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

    monkeypatch.setattr('python.runners.multi_account.profiles.PROJECT_URL', 'https://convex.example')
    monkeypatch.setattr('python.runners.multi_account.profiles.SECRET_KEY', '')
    monkeypatch.setattr('python.runners.multi_account.profiles.requests.post', lambda *args, **kwargs: _Response())

    assert _fetch_profiles_for_lists(['list-1']) == []


def test_multi_account_load_profiles_tolerates_none_from_fetch(monkeypatch):
    logs = []

    monkeypatch.setattr('python.runners.multi_account.entrypoint.log', logs.append)
    monkeypatch.setattr('python.runners.multi_account.entrypoint._fetch_profiles_for_lists', lambda _list_ids: None)


    assert _load_profiles(['list-1']) is None
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


def test_multi_account_general_exception_emits_failed_completion(monkeypatch):
    events = []
    synced = []

    monkeypatch.setattr('python.runners.multi_account.account_session.emit_event', lambda event_type, **data: events.append((event_type, data)))
    monkeypatch.setattr('python.runners.multi_account.account_session.log', lambda _message: None)

    runner = SimpleNamespace(
        running=True,
        profiles_client=SimpleNamespace(sync_profile_status=lambda profile_name, status, running: synced.append((profile_name, status, running)),),
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

    monkeypatch.setattr('python.runners.multi_account.account_session.create_browser_context', _BrowserContext)
    monkeypatch.setattr('python.runners.multi_account.account_session.emit_event', lambda event_type, **data: order.append((event_type, data)))
    monkeypatch.setattr('python.runners.multi_account.account_session.log', lambda _message: None)
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
