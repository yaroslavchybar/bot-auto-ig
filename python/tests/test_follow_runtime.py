from contextlib import contextmanager

import pytest

from python.actions.engagement.follow import runtime as follow_runtime


def test_follow_usernames_logs_and_returns_for_empty_cleaned_usernames(monkeypatch):
    logs = []

    monkeypatch.setattr(
        follow_runtime,
        'create_browser_context',
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError('browser session should not start')),
    )
    monkeypatch.setattr(
        follow_runtime,
        '_run_follow_logic',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('follow logic should not run')),
    )

    follow_runtime.follow_usernames(
        profile_name='demo',
        proxy_string='proxy://example',
        usernames=['', ' ', None, ' @ '],
        log=logs.append,
    )

    assert logs == ['No valid usernames for follow.']


def test_follow_usernames_uses_passed_page_and_cleans_usernames(monkeypatch):
    logs = []
    fake_page = object()
    seen = {}

    monkeypatch.setattr(
        follow_runtime,
        'create_browser_context',
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError('browser session should not start')),
    )

    def _capture_run(page, usernames, log, context):
        seen['page'] = page
        seen['usernames'] = usernames
        seen['log'] = log
        seen['context'] = context

    monkeypatch.setattr(follow_runtime, '_run_follow_logic', _capture_run)

    on_success = lambda username: username
    on_skip = lambda username: username
    should_stop = lambda: False

    follow_runtime.follow_usernames(
        profile_name='demo',
        proxy_string='proxy://example',
        usernames=[' @alice ', '', None, 'bob', '  @carol  '],
        log=logs.append,
        should_stop=should_stop,
        following_limit=321,
        on_success=on_success,
        on_skip=on_skip,
        interactions_config={
            'highlights_range': (1, 2),
            'likes_percentage': 15,
            'scroll_percentage': 25,
        },
        page=fake_page,
        delay_range=(9, 3),
    )

    assert logs == ['Using existing session for follow (3 users)']
    assert seen['page'] is fake_page
    assert seen['usernames'] == ['alice', 'bob', 'carol']
    seen['log']('marker')
    assert logs[-1] == 'marker'
    assert seen['context'] == {
        'should_stop': should_stop,
        'following_limit': 321,
        'on_success': on_success,
        'on_skip': on_skip,
        'highlights_range': (1, 2),
        'likes_percentage': 15,
        'scroll_percentage': 25,
        'delay_range': (3, 9),
    }


def test_follow_usernames_creates_browser_context_when_page_not_provided(monkeypatch):
    logs = []
    fake_page = object()
    seen = {}

    @contextmanager
    def _fake_browser_context(**kwargs):
        seen['browser_kwargs'] = kwargs
        yield object(), fake_page

    def _capture_run(page, usernames, log, context):
        seen['page'] = page
        seen['usernames'] = usernames
        seen['log'] = log
        seen['context'] = context

    monkeypatch.setattr(follow_runtime, 'create_browser_context', _fake_browser_context)
    monkeypatch.setattr(follow_runtime, '_run_follow_logic', _capture_run)

    follow_runtime.follow_usernames(
        profile_name='demo-profile',
        proxy_string='proxy://example',
        usernames=['alice', '@bob'],
        log=logs.append,
        user_agent='UA/1.0',
        delay_range=(5, 7),
    )

    assert seen['browser_kwargs'] == {
        'profile_name': 'demo-profile',
        'proxy_string': 'proxy://example',
        'user_agent': 'UA/1.0',
    }
    assert seen['page'] is fake_page
    assert seen['usernames'] == ['alice', 'bob']
    seen['log']('marker')
    assert logs[-1] == 'marker'
    assert seen['context']['delay_range'] == (5, 7)
    assert logs == [
        'Starting Camoufox for profile demo-profile',
        'Session completed.',
        'marker',
    ]


def test_follow_usernames_closes_session_and_logs_when_follow_logic_raises(monkeypatch):
    logs = []
    events = []
    fake_page = object()

    @contextmanager
    def _fake_browser_context(**_kwargs):
        events.append('entered')
        try:
            yield object(), fake_page
        finally:
            events.append('closed')

    def _raise_run(page, usernames, log, context):
        assert page is fake_page
        assert usernames == ['alice']
        raise RuntimeError('boom')

    monkeypatch.setattr(follow_runtime, 'create_browser_context', _fake_browser_context)
    monkeypatch.setattr(follow_runtime, '_run_follow_logic', _raise_run)

    with pytest.raises(RuntimeError, match='boom'):
        follow_runtime.follow_usernames(
            profile_name='demo-profile',
            proxy_string='proxy://example',
            usernames=['alice'],
            log=logs.append,
        )

    assert events == ['entered', 'closed']
    assert logs == [
        'Starting Camoufox for profile demo-profile',
        'Session completed.',
    ]


def test_run_follow_logic_short_circuits_when_should_stop_requests_stop(monkeypatch):
    logs = []
    processed = []
    delays = []

    monkeypatch.setattr(follow_runtime, '_ensure_instagram_open', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        follow_runtime,
        '_follow_single_username',
        lambda *_args, **_kwargs: processed.append('followed'),
    )
    monkeypatch.setattr(follow_runtime, 'random_delay', lambda low, high: delays.append((low, high)))

    follow_runtime._run_follow_logic(
        current_page=object(),
        usernames=['alice', 'bob'],
        log=logs.append,
        context=follow_runtime._follow_context(
            should_stop=lambda: True,
            following_limit=None,
            on_success=None,
            on_skip=None,
            interactions_config=None,
            delay_range=(2, 4),
        ),
    )

    assert logs == ['Stopping at user request.']
    assert processed == []
    assert delays == []


def test_run_follow_logic_uses_normalized_delay_range_between_targets(monkeypatch):
    logs = []
    steps = []

    monkeypatch.setattr(follow_runtime, '_ensure_instagram_open', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        follow_runtime,
        '_follow_single_username',
        lambda _page, username, _log, _context: steps.append(('follow', username)),
    )
    monkeypatch.setattr(
        follow_runtime,
        'random_delay',
        lambda low, high: steps.append(('delay', low, high)),
    )

    context = follow_runtime._follow_context(
        should_stop=lambda: False,
        following_limit=None,
        on_success=None,
        on_skip=None,
        interactions_config=None,
        delay_range=(8, 3),
    )

    follow_runtime._run_follow_logic(object(), ['alice', 'bob'], logs.append, context)

    assert context['delay_range'] == (3, 8)
    assert steps == [
        ('follow', 'alice'),
        ('delay', 3, 8),
        ('follow', 'bob'),
        ('delay', 3, 8),
    ]
    assert logs == []


def test_skip_if_following_limit_honors_limit_and_calls_on_skip(monkeypatch):
    logs = []
    skipped = []
    seen = {}

    def _capture_should_skip(current_page, username, following_limit, log):
        seen['args'] = (current_page, username, following_limit, log)
        return True

    monkeypatch.setattr(follow_runtime, 'should_skip_by_following', _capture_should_skip)

    current_page = object()
    context = follow_runtime._follow_context(
        should_stop=lambda: False,
        following_limit=4321,
        on_success=None,
        on_skip=skipped.append,
        interactions_config=None,
        delay_range=(1, 2),
    )

    assert follow_runtime._skip_if_following_limit(current_page, 'alice', logs.append, context) is True
    assert seen['args'] == (current_page, 'alice', 4321, logs.append)
    assert skipped == ['alice']
    assert logs == []


def test_skip_if_following_limit_logs_on_skip_callback_errors(monkeypatch):
    logs = []

    monkeypatch.setattr(follow_runtime, 'should_skip_by_following', lambda *_args, **_kwargs: True)

    def _broken_callback(_username):
        raise RuntimeError('skip failed')

    context = follow_runtime._follow_context(
        should_stop=lambda: False,
        following_limit=123,
        on_success=None,
        on_skip=_broken_callback,
        interactions_config=None,
        delay_range=(1, 2),
    )

    assert follow_runtime._skip_if_following_limit(object(), 'alice', logs.append, context) is True
    assert logs == ['Failed to update skip status for @alice: skip failed']


def test_complete_follow_action_calls_on_success_when_already_following(monkeypatch):
    logs = []
    successes = []

    monkeypatch.setattr(follow_runtime, 'find_follow_control', lambda *_args, **_kwargs: ('following', None))

    context = follow_runtime._follow_context(
        should_stop=lambda: False,
        following_limit=None,
        on_success=successes.append,
        on_skip=None,
        interactions_config=None,
        delay_range=(1, 2),
    )

    follow_runtime._complete_follow_action(object(), 'alice', logs.append, context)

    assert successes == ['alice']
    assert logs == ['Already following/requested for @alice (following).']


def test_complete_follow_action_logs_on_success_callback_errors(monkeypatch):
    logs = []

    monkeypatch.setattr(follow_runtime, 'find_follow_control', lambda *_args, **_kwargs: ('requested', None))

    def _broken_callback(_username):
        raise RuntimeError('status update failed')

    context = follow_runtime._follow_context(
        should_stop=lambda: False,
        following_limit=None,
        on_success=_broken_callback,
        on_skip=None,
        interactions_config=None,
        delay_range=(1, 2),
    )

    follow_runtime._complete_follow_action(object(), 'alice', logs.append, context)

    assert logs == [
        'Already following/requested for @alice (requested).',
        'Failed to update status for @alice: status update failed',
    ]
