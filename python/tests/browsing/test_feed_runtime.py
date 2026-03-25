from unittest.mock import MagicMock

from python.actions.browsing.feed_scrolling import runtime
from python.actions.browsing.feed_scrolling.runtime import _get_next_post
from python.actions.browsing.feed_scrolling.runtime import _home_click_target
from python.actions.browsing.feed_scrolling.runtime import _reload_stalled_page
from python.actions.browsing.feed_scrolling.runtime import _watch_stories_if_enabled
from python.actions.browsing.feed_scrolling.runtime import scroll_feed


def test_home_click_target_falls_back_to_svg_when_ancestor_is_not_clickable():
    svg = _mock_svg_target()
    first = _mock_parent()
    second = _mock_parent()
    third = _mock_parent()
    fourth = _mock_parent(clickable=False)

    svg._locator_child = first
    first._locator_child = second
    second._locator_child = third
    third._locator_child = fourth

    assert _home_click_target(svg) is svg


def test_home_click_target_uses_clickable_ancestor_when_present():
    svg = _mock_svg_target()
    first = _mock_parent()
    second = _mock_parent()
    third = _mock_parent()
    fourth = _mock_parent(clickable=True)

    svg._locator_child = first
    first._locator_child = second
    second._locator_child = third
    third._locator_child = fourth

    assert _home_click_target(svg) is fourth


def test_get_next_post_selects_lowest_candidate_below_threshold():
    page = MagicMock()
    page.evaluate.return_value = 1000
    above_fold = _MockPost({'x': 0, 'y': 100, 'width': 100, 'height': 200})
    first_candidate = _MockPost({'x': 0, 'y': 520, 'width': 100, 'height': 100})
    second_candidate = _MockPost({'x': 0, 'y': 700, 'width': 100, 'height': 120})
    missing_box = _MockPost(None)

    selected = _get_next_post(page, [second_candidate, missing_box, above_fold, first_candidate])

    assert selected is first_candidate


def test_get_next_post_clamps_skip_count_and_tolerates_invalid_boxes():
    page = MagicMock()
    page.evaluate.side_effect = RuntimeError('no viewport')
    first_candidate = _MockPost({'x': 0, 'y': 480, 'width': 100, 'height': 120})
    second_candidate = _MockPost({'x': 0, 'y': 620, 'width': 100, 'height': 120})
    broken_post = _MockPost(error=RuntimeError('stale element'))

    selected = _get_next_post(page, [broken_post, first_candidate, second_candidate], skip_count=99)

    assert selected is second_candidate


def test_get_next_post_returns_none_when_no_posts_pass_threshold():
    page = MagicMock()
    page.evaluate.return_value = 900
    top_post = _MockPost({'x': 0, 'y': 120, 'width': 100, 'height': 120})

    assert _get_next_post(page, [top_post]) is None


def test_reload_stalled_page_returns_false_before_threshold(monkeypatch):
    page = MagicMock()
    delays = []
    clock = {'last_action': 25.0}

    monkeypatch.setattr(runtime.time, 'time', lambda: 204.9)
    monkeypatch.setattr(runtime, 'random_delay', lambda low, high: delays.append((low, high)))

    assert _reload_stalled_page(page, clock) is False
    page.reload.assert_not_called()
    assert clock['last_action'] == 25.0
    assert delays == []


def test_reload_stalled_page_reloads_and_updates_last_action(monkeypatch):
    page = MagicMock()
    delays = []
    times = iter([181.0, 190.0])
    clock = {'last_action': 0.0}

    monkeypatch.setattr(runtime.time, 'time', lambda: next(times))
    monkeypatch.setattr(runtime, 'random_delay', lambda low, high: delays.append((low, high)))

    assert _reload_stalled_page(page, clock) is True
    page.reload.assert_called_once_with(timeout=15000)
    assert clock['last_action'] == 190.0
    assert delays == [(3, 6)]


def test_reload_stalled_page_returns_true_when_reload_raises(monkeypatch, caplog):
    page = MagicMock()
    page.reload.side_effect = RuntimeError('network down')
    delays = []
    times = iter([181.0, 182.0])
    clock = {'last_action': 0.0}

    monkeypatch.setattr(runtime.time, 'time', lambda: next(times))
    monkeypatch.setattr(runtime, 'random_delay', lambda low, high: delays.append((low, high)))

    import logging
    with caplog.at_level(logging.DEBUG):
        assert _reload_stalled_page(page, clock) is True
    assert clock['last_action'] == 182.0
    assert delays == [(3, 6)]
    assert 'Failed to reload page: network down' in caplog.text


def test_watch_stories_if_enabled_skips_story_watch_when_stop_requested(monkeypatch):
    page = MagicMock()
    watch_calls = []

    monkeypatch.setattr(runtime, 'watch_stories', lambda *_args, **_kwargs: watch_calls.append('watched'))

    _watch_stories_if_enabled(page, {'watch_stories': True}, should_stop=lambda: True)

    assert watch_calls == []


def test_scroll_feed_returns_immediately_when_stop_requested_before_loop(monkeypatch):
    page = MagicMock()
    events = []

    monkeypatch.setattr(runtime, '_session_clock', lambda _minutes: _clock())
    monkeypatch.setattr(runtime, '_navigate_home', lambda _page: events.append('navigate'))
    monkeypatch.setattr(runtime, '_watch_stories_if_enabled', lambda *_args, **_kwargs: events.append('stories'))
    monkeypatch.setattr(runtime, '_process_feed_iteration', lambda *_args, **_kwargs: events.append('iterate'))
    monkeypatch.setattr(runtime.time, 'time', lambda: 1.0)

    stats = scroll_feed(page, 1, {'watch_stories': True}, should_stop=lambda: True, profile_name='alice')

    assert stats == {'likes': 0, 'follows': 0}
    assert events == ['navigate']


def test_scroll_feed_exits_cleanly_when_stop_fires_during_story_prewatch(monkeypatch):
    page = MagicMock()
    events = []
    should_stop = _StopSequence([False, True, True])

    monkeypatch.setattr(runtime, '_session_clock', lambda _minutes: _clock())
    monkeypatch.setattr(runtime, '_navigate_home', lambda _page: events.append('navigate'))
    monkeypatch.setattr(runtime, 'watch_stories', lambda *_args, **_kwargs: events.append('watch'))
    monkeypatch.setattr(runtime, '_process_feed_iteration', lambda *_args, **_kwargs: events.append('iterate'))
    monkeypatch.setattr(runtime.time, 'time', lambda: 1.0)

    stats = scroll_feed(page, 1, {'watch_stories': True}, should_stop=should_stop, profile_name='alice')

    assert stats == {'likes': 0, 'follows': 0}
    assert events == ['navigate']


def test_scroll_feed_skips_actions_when_stop_fires_mid_iteration(monkeypatch):
    page = MagicMock()
    page.evaluate.return_value = 900
    mock_post = _MockPost({'x': 0, 'y': 500, 'width': 100, 'height': 120})
    mock_articles_locator = MagicMock()
    mock_articles_locator.count.return_value = 1
    mock_articles_locator.nth.return_value = mock_post
    page.locator.return_value = mock_articles_locator
    should_stop = _StopSequence([False, False, True, True])
    focus_calls = []
    view_post = MagicMock()
    handle_carousel = MagicMock()
    handle_like = MagicMock()
    handle_follow = MagicMock()

    monkeypatch.setattr(runtime, '_session_clock', lambda _minutes: _clock())
    monkeypatch.setattr(runtime, '_navigate_home', lambda _page: None)
    monkeypatch.setattr(runtime, '_watch_stories_if_enabled', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runtime, '_report_time_remaining', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runtime, '_save_session_progress', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runtime, '_reload_stalled_page', lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        runtime,
        'scroll_to_element',
        lambda *_args, **_kwargs: focus_calls.append('focused') or True,
    )
    monkeypatch.setattr(runtime, '_view_post', view_post)
    monkeypatch.setattr(runtime, '_handle_carousel', handle_carousel)
    monkeypatch.setattr(runtime, '_handle_like', handle_like)
    monkeypatch.setattr(runtime, '_handle_follow', handle_follow)
    monkeypatch.setattr(runtime.time, 'time', lambda: 1.0)

    stats = scroll_feed(
        page,
        1,
        {
            'watch_stories': False,
            'skip_post_chance': 0,
            'like_chance': 100,
            'follow_chance': 100,
            'carousel_watch_chance': 100,
        },
        should_stop=should_stop,
        profile_name='alice',
    )

    assert stats == {'likes': 0, 'follows': 0}
    assert focus_calls == ['focused']
    view_post.assert_called_once_with(
        {
            'watch_stories': False,
            'skip_post_chance': 0,
            'like_chance': 100,
            'follow_chance': 100,
            'carousel_watch_chance': 100,
        }
    )
    handle_carousel.assert_not_called()
    handle_like.assert_not_called()
    handle_follow.assert_not_called()


def _mock_svg_target():
    return _MockElement(svg=True)


def _mock_parent(*, clickable: bool | None = None):
    return _MockElement(svg=False, clickable=clickable)


class _MockElement:
    def __init__(self, *, svg: bool, clickable: bool | None = None):
        self._svg = svg
        self._clickable = clickable
        self._locator_child = None

    def evaluate(self, script):
        if 'tagName.toLowerCase() === \'svg\'' in script:
            return self._svg
        if self._clickable is not None and 'const tag' in script and 'const role' in script:
            return self._clickable
        raise AssertionError(f'unexpected evaluate call: {script}')

    def locator(self, _selector):
        return _MockLocator(self._locator_child)


class _MockLocator:
    def __init__(self, child=None):
        self._child = child

    def count(self):
        return 1 if self._child is not None else 0

    @property
    def first(self):
        return self._child


class _MockPost:
    def __init__(self, box=None, error=None):
        self._box = box
        self._error = error

    def bounding_box(self):
        if self._error is not None:
            raise self._error
        return self._box


class _StopSequence:
    def __init__(self, values):
        self._values = iter(values)
        self._last = values[-1] if values else False

    def __call__(self):
        try:
            return next(self._values)
        except StopIteration:
            return self._last


def _clock():
    return {
        'start': 0.0,
        'end': 60.0,
        'hard_timeout': 120.0,
        'last_action': 0.0,
    }
