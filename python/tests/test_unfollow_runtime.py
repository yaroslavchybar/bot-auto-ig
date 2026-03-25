from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from python.actions.engagement.unfollow import runtime as unfollow_runtime


def test_unfollow_usernames_uses_existing_page_and_forwards_success_callbacks(monkeypatch):
    page = MagicMock()
    logs: list[str] = []
    succeeded: list[str] = []
    captured: dict[str, object] = {}
    should_stop = lambda: False

    def fake_run_unfollow_logic(current_page, target_usernames, log, received_should_stop, delay_range, on_success):
        captured['page'] = current_page
        captured['targets'] = list(target_usernames)
        captured['should_stop'] = received_should_stop
        captured['delay_range'] = delay_range
        for username in target_usernames:
            on_success(username)

    monkeypatch.setattr(unfollow_runtime, '_run_unfollow_logic', fake_run_unfollow_logic)

    unfollow_runtime.unfollow_usernames(
        profile_name='profile-1',
        proxy_string='proxy://1',
        usernames=['  alice  ', '', 'bob '],
        log=logs.append,
        should_stop=should_stop,
        delay_range=(30, 10),
        on_success=succeeded.append,
        page=page,
    )

    assert captured == {
        'page': page,
        'targets': ['alice', 'bob'],
        'should_stop': should_stop,
        'delay_range': (10, 30),
    }
    assert succeeded == ['alice', 'bob']
    assert logs == ['Using existing session for unfollow...']


def test_unfollow_usernames_stops_mid_run_and_logs_once(monkeypatch):
    page = MagicMock()
    logs: list[str] = []
    processed: list[str] = []
    events: list[object] = []
    stop_calls = iter([False, True])

    monkeypatch.setattr(unfollow_runtime, '_ensure_instagram_open', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, '_open_own_profile', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, '_open_following_modal', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, 'random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        unfollow_runtime,
        '_unfollow_single_target',
        lambda _page, username, _log, _on_success: processed.append(username),
    )
    monkeypatch.setattr(
        unfollow_runtime,
        '_clear_search',
        lambda _page, _log, username: events.append(('clear', username)) or True,
    )
    monkeypatch.setattr(
        unfollow_runtime,
        '_wait_before_next_target',
        lambda delay_range, _log: events.append(('wait', delay_range)),
    )
    monkeypatch.setattr(
        unfollow_runtime,
        '_close_following_modal',
        lambda _page, _log: events.append('closed'),
    )

    unfollow_runtime.unfollow_usernames(
        profile_name='profile-1',
        proxy_string='proxy://1',
        usernames=['alice', 'bob', 'carol'],
        log=logs.append,
        should_stop=lambda: next(stop_calls, False),
        delay_range=(2, 4),
        page=page,
    )

    assert processed == ['alice']
    assert events == [('clear', 'alice'), ('wait', (2, 4)), 'closed']
    assert logs == ['Using existing session for unfollow...', 'Stopping...']


def test_unfollow_usernames_managed_session_runs_cleanup_and_logs_session_finished_on_runtime_error(monkeypatch):
    page = MagicMock()
    logs: list[str] = []
    events: list[object] = []

    @contextmanager
    def fake_create_browser_context(**kwargs):
        events.append(('enter', kwargs))
        try:
            yield object(), page
        finally:
            events.append('cleanup')

    monkeypatch.setattr(unfollow_runtime, 'create_browser_context', fake_create_browser_context)
    monkeypatch.setattr(
        unfollow_runtime,
        '_ensure_instagram_open',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('boom')),
    )

    unfollow_runtime.unfollow_usernames(
        profile_name='profile-1',
        proxy_string='proxy://1',
        usernames=['alice'],
        log=logs.append,
    )

    assert events == [
        ('enter', {'profile_name': 'profile-1', 'proxy_string': 'proxy://1', 'user_agent': None}),
        'cleanup',
    ]
    assert logs == [
        'Starting browser for profile: profile-1',
        'Critical session error: boom',
        'Session completed.',
    ]


def test_run_unfollow_logic_closes_modal_when_processing_raises(monkeypatch):
    page = MagicMock()
    logs: list[str] = []
    events: list[str] = []

    monkeypatch.setattr(unfollow_runtime, '_ensure_instagram_open', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, '_open_own_profile', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, '_open_following_modal', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, 'random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        unfollow_runtime,
        '_process_unfollow_targets',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('boom')),
    )
    monkeypatch.setattr(
        unfollow_runtime,
        '_close_following_modal',
        lambda *_args, **_kwargs: events.append('closed'),
    )

    unfollow_runtime._run_unfollow_logic(
        page,
        ['alice'],
        logs.append,
        should_stop=lambda: False,
        delay_range=(1, 2),
        on_success=None,
    )

    assert events == ['closed']
    assert logs == ['Critical session error: boom']


def test_run_unfollow_logic_does_not_close_modal_when_it_never_opened(monkeypatch):
    page = MagicMock()
    logs: list[str] = []
    closed: list[str] = []

    monkeypatch.setattr(unfollow_runtime, '_ensure_instagram_open', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, '_open_own_profile', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(unfollow_runtime, '_open_following_modal', lambda *_args, **_kwargs: False)
    monkeypatch.setattr(unfollow_runtime, 'random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        unfollow_runtime,
        '_close_following_modal',
        lambda *_args, **_kwargs: closed.append('closed'),
    )

    unfollow_runtime._run_unfollow_logic(
        page,
        ['alice'],
        logs.append,
        should_stop=lambda: False,
        delay_range=(1, 2),
        on_success=None,
    )

    assert closed == []
    assert logs == []
