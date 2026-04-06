import logging
import tempfile
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from playwright.sync_api import Error as PlaywrightError

from python.actions.browsing.feed_scrolling.runtime import _chance_hit as feed_chance_hit
from python.actions.browsing.feed_scrolling.runtime import _session_active as feed_session_active
from python.actions.browsing.reels_scrolling.runtime import _chance_hit as reels_chance_hit
from python.actions.browsing.reels_scrolling.runtime import _session_active as reels_session_active
from python.actions.browsing.reels_scrolling.runtime import scroll_reels
from python.actions.browsing.mouse import human_mouse_move
from python.actions.browsing.scrolling import _scroll_fallback, human_scroll
from python.actions.engagement.follow.common import _find_close_button
from python.actions.engagement.follow.highlights_runtime import _click_highlight
from python.actions.engagement.follow.highlights_runtime import _close_highlight
from python.actions.engagement.follow.highlights_runtime import _highlight_watch_delay_range
from python.actions.engagement.follow.highlights_runtime import _open_highlight_with_retries
from python.actions.engagement.follow.posts_runtime import _close_post_modal
from python.actions.engagement.follow.posts_runtime import _like_single_post
from python.actions.engagement.follow.search import _wait_for_profile_url
from python.actions.engagement.unfollow.runtime import _clear_search
from python.actions.engagement.follow.runtime import _ensure_instagram_open
from python.actions.engagement.unfollow.runtime import _ensure_instagram_open as ensure_unfollow_instagram_open
from python.actions.engagement.unfollow.runtime import _process_unfollow_targets
from python.actions.engagement.unfollow.runtime import _user_row_button
from python.actions.engagement.unfollow.runtime import _wait_before_next_target
from python.actions.messaging.runtime import run_messaging_flow
from python.browser.context import _wait_for_circuit_breaker
from python.browser.page_bootstrap import _wait_for_monitor_cooldown
from python.browser.profile_paths import _clean_cache2, ensure_profile_path
from python.browser.runtime import run_browser


def test_scroll_fallback_respects_zero_delta():
    page = MagicMock()

    _scroll_fallback(page, 0)

    page.evaluate.assert_called_once_with("window.scrollBy({top: 0, behavior: 'smooth'})")


def test_human_scroll_skips_fallback_when_stop_is_intentional(monkeypatch):
    page = MagicMock()

    monkeypatch.setattr('python.actions.browsing.scrolling._get_viewport_size', lambda _page: (1280, 900))
    monkeypatch.setattr('python.actions.browsing.scrolling.safe_mouse_move', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.browsing.scrolling.time.sleep', lambda *_args, **_kwargs: None)

    human_scroll(page, total_delta=300, should_stop=lambda: True)

    page.evaluate.assert_not_called()
    page.mouse.wheel.assert_not_called()


def test_human_scroll_skips_correction_when_stop_fires_mid_scroll(monkeypatch):
    page = MagicMock()
    stop_calls = iter([False, True])

    monkeypatch.setattr('python.actions.browsing.scrolling._get_viewport_size', lambda _page: (1280, 900))
    monkeypatch.setattr('python.actions.browsing.scrolling.safe_mouse_move', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.browsing.scrolling.time.sleep', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.browsing.scrolling.random.random', lambda: 0.0)
    monkeypatch.setattr('python.actions.browsing.scrolling.random.randint', lambda *_args, **_kwargs: 7)

    human_scroll(page, total_delta=300, should_stop=lambda: next(stop_calls))

    page.evaluate.assert_not_called()
    page.mouse.wheel.assert_not_called()


def test_human_mouse_move_logs_and_swallows_playwright_errors(monkeypatch, caplog):
    page = MagicMock()

    monkeypatch.setattr('python.actions.browsing.mouse._get_viewport_size', lambda _page: (1280, 900))
    monkeypatch.setattr('python.actions.browsing.mouse._pick_point', lambda _w, _h: (100, 100))
    monkeypatch.setattr(
        'python.actions.browsing.mouse.safe_mouse_move',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(PlaywrightError('Target closed')),
    )

    with caplog.at_level(logging.WARNING, logger='python.actions.browsing.mouse'):
        human_mouse_move(page, target_x=600, target_y=500)

    assert any('Skipping human_mouse_move due to Playwright error' in record.message for record in caplog.records)


def test_human_mouse_move_logs_and_reraises_unexpected_errors(monkeypatch, caplog):
    page = MagicMock()

    monkeypatch.setattr('python.actions.browsing.mouse._get_viewport_size', lambda _page: (1280, 900))
    monkeypatch.setattr('python.actions.browsing.mouse._pick_point', lambda _w, _h: (100, 100))
    monkeypatch.setattr(
        'python.actions.browsing.mouse.safe_mouse_move',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('boom')),
    )

    with caplog.at_level(logging.ERROR, logger='python.actions.browsing.mouse'):
        with pytest.raises(RuntimeError, match='boom'):
            human_mouse_move(page, target_x=600, target_y=500)

    assert any('Unexpected error in human_mouse_move' in record.message for record in caplog.records)


def test_like_single_post_returns_false_when_post_was_not_liked(monkeypatch):
    page = MagicMock()
    link = MagicMock()
    link.get_attribute.return_value = '/p/example/'
    log = MagicMock()

    monkeypatch.setattr('python.actions.engagement.follow.posts_runtime.random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.engagement.follow.posts_runtime._is_visible', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.engagement.follow.posts_runtime._click_like_button', lambda *_args, **_kwargs: False)

    assert _like_single_post(page, link, log, set()) is False


def test_highlight_delay_range_is_always_ordered():
    for _ in range(20):
        start, end = _highlight_watch_delay_range()
        assert start <= end


def test_open_highlight_with_retries_scrolls_before_wait(monkeypatch):
    page = MagicMock()
    button = MagicMock()
    log = MagicMock()
    events: list[str] = []

    monkeypatch.setattr('python.actions.engagement.follow.highlights_runtime.random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        'python.actions.engagement.follow.highlights_runtime._scroll_highlight_into_view',
        lambda *_args, **_kwargs: events.append('scroll'),
    )

    def _wait(_page, _button):
        events.append('wait')
        assert events[:2] == ['scroll', 'wait']

    monkeypatch.setattr('python.actions.engagement.follow.highlights_runtime._wait_for_highlight_button', _wait)
    monkeypatch.setattr(
        'python.actions.engagement.follow.highlights_runtime._click_highlight',
        lambda *_args, **_kwargs: events.append('click') or True,
    )
    monkeypatch.setattr('python.actions.engagement.follow.highlights_runtime._highlight_opened', lambda *_args, **_kwargs: True)

    assert _open_highlight_with_retries(page, log, button, 4.0) is True
    assert events == ['scroll', 'wait', 'click']


def test_click_highlight_scrolls_before_click(monkeypatch):
    page = MagicMock()
    button = MagicMock()
    log = MagicMock()
    events: list[str] = []

    monkeypatch.setattr('python.actions.engagement.follow.highlights_runtime.random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        'python.actions.engagement.follow.highlights_runtime._scroll_highlight_into_view',
        lambda *_args, **_kwargs: events.append('scroll'),
    )

    def _click(*_args, **_kwargs):
        events.append('click')

    button.click.side_effect = _click

    assert _click_highlight(page, log, button) is True
    assert events == ['scroll', 'click']


def _mock_locator(result=None):
    """Create a mock locator that returns 0/1 count and result as .first."""
    loc = MagicMock()
    loc.count.return_value = 1 if result is not None else 0
    loc.first = result
    return loc


def _make_close_button_page(close_svg, btn_from_svg=None, div_from_svg=None):
    """Build a mock page for _find_close_button tests using locator API.

    The close button selectors all return empty, then svg selector returns close_svg.
    close_svg.locator returns btn_from_svg for button ancestor, div_from_svg for div ancestor.
    """
    page = MagicMock()

    def page_locator(selector):
        if selector == 'svg[aria-label="Close"]':
            return _mock_locator(close_svg)
        # All other selectors (button close variants) return empty
        return _mock_locator(None)

    page.locator = MagicMock(side_effect=page_locator)

    def svg_locator(selector):
        if 'button' in selector:
            return _mock_locator(btn_from_svg)
        if 'div' in selector:
            return _mock_locator(div_from_svg)
        return _mock_locator(None)

    close_svg.locator = MagicMock(side_effect=svg_locator)
    return page


def test_find_close_button_resolves_clickable_ancestor_from_close_svg():
    close_svg = MagicMock(name='close_svg')
    close_div = MagicMock(name='close_div')
    page = _make_close_button_page(close_svg, btn_from_svg=None, div_from_svg=close_div)

    assert _find_close_button(page) is close_div


def test_close_highlight_clicks_resolved_close_ancestor(monkeypatch):
    close_svg = MagicMock(name='close_svg')
    close_btn = MagicMock(name='close_btn')
    log = MagicMock()
    page = _make_close_button_page(close_svg, btn_from_svg=close_btn)
    monkeypatch.setattr('python.actions.engagement.follow.highlights_runtime.random_delay', lambda *_args, **_kwargs: None)

    _close_highlight(page, log)

    close_btn.click.assert_called_once_with()
    close_svg.click.assert_not_called()
    page.keyboard.press.assert_not_called()
    log.assert_any_call('Highlight closed by button')


def test_close_post_modal_clicks_resolved_close_ancestor():
    close_svg = MagicMock(name='close_svg')
    close_btn = MagicMock(name='close_btn')
    log = MagicMock()
    page = _make_close_button_page(close_svg, btn_from_svg=close_btn)

    _close_post_modal(page, log)

    close_btn.click.assert_called_once_with()
    close_svg.click.assert_not_called()
    page.keyboard.press.assert_not_called()
    log.assert_any_call('Post closed by button')


def test_follow_runtime_reports_failed_initial_navigation():
    page = MagicMock()
    page.url = 'about:blank'
    page.goto.side_effect = RuntimeError('boom')
    messages: list[str] = []

    assert _ensure_instagram_open(page, messages.append) is False
    assert messages == ['Failed to open Instagram before starting follow.']


def test_wait_for_profile_url_lowercases_globs_for_uppercase_username():
    page = MagicMock()
    page.url = 'https://www.instagram.com/testuser/'
    seen_patterns: list[tuple[str, int]] = []

    def _never_match(pattern, timeout):
        seen_patterns.append((pattern, timeout))
        raise RuntimeError('no match')

    page.wait_for_url.side_effect = _never_match

    assert _wait_for_profile_url(page, 'TestUser') is True
    assert seen_patterns == [
        ('**/testuser/', 15000),
        ('**/testuser/*', 5000),
    ]


def test_feed_chance_hit_accepts_100_percent(monkeypatch):
    monkeypatch.setattr('python.actions.browsing.feed_scrolling.runtime.random.random', lambda: 0.999999)
    assert feed_chance_hit(100) is True


def test_reels_chance_hit_accepts_100_percent(monkeypatch):
    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime.random.random', lambda: 0.999999)
    assert reels_chance_hit(100) is True


def test_feed_session_active_prefers_hard_timeout_over_expected_duration(monkeypatch, caplog):
    monkeypatch.setattr('python.actions.browsing.feed_scrolling.runtime.time.time', lambda: 20.0)

    import logging
    with caplog.at_level(logging.DEBUG):
        active = feed_session_active({'end': 10.0, 'hard_timeout': 20.0}, should_stop=None)

    assert active is False
    assert 'HARD TIMEOUT REACHED' in caplog.text
    assert 'Expected duration reached' not in caplog.text


def test_reels_session_active_prefers_hard_timeout_over_expected_duration(monkeypatch, caplog):
    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime.time.time', lambda: 20.0)

    with caplog.at_level(logging.ERROR, logger='python.actions.browsing.reels_scrolling.runtime'):
        active = reels_session_active({'end': 10.0, 'hard_timeout': 20.0}, should_stop=None)

    assert active is False
    assert any('HARD TIMEOUT REACHED' in record.message for record in caplog.records)
    assert not any('Expected duration reached' in record.message for record in caplog.records)


def test_scroll_reels_skips_actions_when_stop_fires_during_watch(monkeypatch):
    page = MagicMock()
    page.url = 'https://www.instagram.com/reels/'
    attempted_actions: list[str] = []
    stop_calls = iter([False, True, False, False, True])

    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime._navigate_reels', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime._log_time_remaining', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime._save_session_progress', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime._reload_stalled_page', lambda *_args, **_kwargs: False)
    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime.random_delay', lambda *_args, **_kwargs: None)

    def _watch_until_stop(_page, _actions_config, should_stop):
        assert should_stop() is True
        return False

    monkeypatch.setattr('python.actions.browsing.reels_scrolling.runtime._watch_reel', _watch_until_stop)
    monkeypatch.setattr(
        'python.actions.browsing.reels_scrolling.runtime._queue_actions',
        lambda *_args, **_kwargs: [
            ('like', lambda: attempted_actions.append('like') or True),
            ('follow', lambda: attempted_actions.append('follow') or True),
        ],
    )

    stats = scroll_reels(
        page,
        duration_minutes=1,
        actions_config={},
        should_stop=lambda: next(stop_calls, False),
        profile_name='demo',
    )

    assert stats == {'likes': 0, 'follows': 0}
    assert attempted_actions == []


def test_unfollow_runtime_reports_failed_initial_navigation():
    page = MagicMock()
    page.url = 'https://example.com'
    page.goto.side_effect = RuntimeError('boom')
    messages: list[str] = []

    assert ensure_unfollow_instagram_open(page, messages.append) is False
    assert messages == ['Failed to open Instagram before unfollow: boom']


def test_unfollow_wait_normalizes_reversed_delay_range(monkeypatch):
    seen_randint: list[tuple[int, int]] = []
    seen_delay: list[tuple[int, int]] = []
    messages: list[str] = []

    monkeypatch.setattr(
        'python.actions.engagement.unfollow.runtime.random.randint',
        lambda low, high: seen_randint.append((low, high)) or low,
    )
    monkeypatch.setattr(
        'python.actions.engagement.unfollow.runtime.random_delay',
        lambda low, high: seen_delay.append((low, high)),
    )

    _wait_before_next_target((30, 10), messages.append)

    assert seen_randint == [(10, 30)]
    assert seen_delay == [(10, 10)]
    assert messages == ['Waiting 10s...']


def test_unfollow_clear_search_logs_and_falls_back_to_keyboard():
    page = MagicMock()
    search_input = MagicMock()
    messages: list[str] = []

    page.fill.side_effect = RuntimeError('fill failed')
    page.input_value.side_effect = ['target.user', '']
    page.locator.return_value.first = search_input

    assert _clear_search(page, messages.append, '@target.user') is True

    page.fill.assert_called_once_with('input[placeholder="Search"]', '')
    search_input.click.assert_called_once_with(timeout=3000)
    assert page.keyboard.press.call_args_list == [(('Control+A',),), (('Backspace',),)]
    assert any('fill failed' in message for message in messages)
    assert any("'target.user'" in message for message in messages)
    assert any('via fallback' in message for message in messages)


def test_unfollow_clear_search_returns_false_when_fallback_keeps_stale_value():
    page = MagicMock()
    search_input = MagicMock()
    messages: list[str] = []

    page.fill.side_effect = RuntimeError('fill failed')
    page.input_value.side_effect = ['target.user', 'target.user']
    page.locator.return_value.first = search_input

    assert _clear_search(page, messages.append, '@target.user') is False

    search_input.click.assert_called_once_with(timeout=3000)
    assert any('fill failed' in message for message in messages)
    assert any('did not clear the field' in message for message in messages)


def test_unfollow_process_targets_aborts_batch_when_search_reset_fails(monkeypatch):
    processed: list[str] = []
    waits: list[tuple[int, int]] = []
    messages: list[str] = []

    monkeypatch.setattr(
        'python.actions.engagement.unfollow.runtime._unfollow_single_target',
        lambda _page, username, _log, _on_success: processed.append(username),
    )
    monkeypatch.setattr(
        'python.actions.engagement.unfollow.runtime._clear_search',
        lambda _page, _log, username: username != 'alice',
    )
    monkeypatch.setattr(
        'python.actions.engagement.unfollow.runtime._wait_before_next_target',
        lambda delay_range, _log: waits.append(delay_range),
    )

    _process_unfollow_targets(
        current_page=MagicMock(),
        target_usernames=['alice', 'bob'],
        log=messages.append,
        should_stop=lambda: False,
        delay_range=(10, 20),
        on_success=None,
    )

    assert processed == ['alice']
    assert waits == []
    assert messages == ['Failed to clear search after alice. Aborting batch to avoid stale state.']


def test_unfollow_user_row_button_targets_exact_profile_href():
    page = MagicMock()
    profile_link_locator = MagicMock()
    profile_link = MagicMock()
    user_row = MagicMock()
    button_locator = MagicMock()
    filtered_buttons = MagicMock()

    profile_link_locator.first = profile_link
    filtered_buttons.first = 'exact-following-button'
    page.locator.return_value = profile_link_locator
    profile_link.locator.return_value = user_row
    user_row.locator.return_value = button_locator
    button_locator.filter.return_value = filtered_buttons

    result = _user_row_button(page, '@target.user')

    page.locator.assert_called_once_with(
        'div[role="dialog"] a[href$="/target.user/"], div[role="dialog"] a[href$="/target.user"]'
    )
    profile_link.locator.assert_called_once_with('xpath=ancestor::div[.//button][1]')
    user_row.locator.assert_called_once_with('button')
    button_locator.filter.assert_called_once_with(has_text='Following')
    assert result == 'exact-following-button'


def test_run_messaging_flow_returns_zero_when_message_texts_missing():
    page = MagicMock()
    log = MagicMock()

    processed = run_messaging_flow(
        page=page,
        targets=[{'user_name': 'demo'}],
        message_texts=[],
        log=log,
        should_stop=lambda: False,
        client=MagicMock(),
    )

    assert processed == 0
    log.assert_called_with('No message texts for sending.')


def test_run_messaging_flow_marks_direct_message_targets_as_scraping_when_configured(monkeypatch):
    page = MagicMock()
    page.keyboard = MagicMock()
    log = MagicMock()
    client = MagicMock()
    msg_box = MagicMock()
    send_button = MagicMock()
    mark_sent_calls = []

    monkeypatch.setattr('python.actions.messaging.runtime.ensure_instagram_open', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.navigate_to_profile', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.messaging.runtime.click_message_button', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.messaging.runtime.find_message_box', lambda *_args, **_kwargs: msg_box)
    monkeypatch.setattr('python.actions.messaging.runtime.find_send_button', lambda *_args, **_kwargs: send_button)
    monkeypatch.setattr('python.actions.messaging.runtime.random.choice', lambda texts: texts[0])
    monkeypatch.setattr(
        'python.actions.messaging.runtime.mark_sent',
        lambda _client, username, _log: mark_sent_calls.append(username),
    )

    processed = run_messaging_flow(
        page=page,
        targets=[{'id': 'acct-1', 'user_name': 'demo'}],
        message_texts=['Hi'],
        log=log,
        should_stop=lambda: False,
        client=client,
        behavior_config={'direct_message_success_status': 'scraping'},
    )

    assert processed == 1
    client.update_account_status.assert_called_once_with('acct-1', status='scraping')
    assert mark_sent_calls == ['demo']


def test_run_messaging_flow_does_not_mark_scraping_after_follow_fallback(monkeypatch):
    page = MagicMock()
    page.keyboard = MagicMock()
    log = MagicMock()
    client = MagicMock()
    msg_box = MagicMock()
    send_button = MagicMock()
    click_results = iter([False, True])
    mark_sent_calls = []

    monkeypatch.setattr('python.actions.messaging.runtime.ensure_instagram_open', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.navigate_to_profile', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        'python.actions.messaging.runtime.click_message_button',
        lambda *_args, **_kwargs: next(click_results),
    )
    monkeypatch.setattr('python.actions.messaging.runtime.click_follow_button', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.messaging.runtime.find_message_box', lambda *_args, **_kwargs: msg_box)
    monkeypatch.setattr('python.actions.messaging.runtime.find_send_button', lambda *_args, **_kwargs: send_button)
    monkeypatch.setattr('python.actions.messaging.runtime.random.choice', lambda texts: texts[0])
    monkeypatch.setattr(
        'python.actions.messaging.runtime.mark_sent',
        lambda _client, username, _log: mark_sent_calls.append(username),
    )

    processed = run_messaging_flow(
        page=page,
        targets=[{'id': 'acct-1', 'user_name': 'demo'}],
        message_texts=['Hi'],
        log=log,
        should_stop=lambda: False,
        client=client,
        behavior_config={'direct_message_success_status': 'scraping'},
    )

    assert processed == 1
    assert client.update_account_status.call_args_list == [(( 'acct-1',), {'status': 'subscribed'})]
    assert mark_sent_calls == ['demo']


def test_run_messaging_flow_default_behavior_does_not_mark_direct_message_targets(monkeypatch):
    page = MagicMock()
    page.keyboard = MagicMock()
    log = MagicMock()
    client = MagicMock()
    msg_box = MagicMock()
    send_button = MagicMock()
    mark_sent_calls = []

    monkeypatch.setattr('python.actions.messaging.runtime.ensure_instagram_open', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.navigate_to_profile', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.messaging.runtime.click_message_button', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.messaging.runtime.find_message_box', lambda *_args, **_kwargs: msg_box)
    monkeypatch.setattr('python.actions.messaging.runtime.find_send_button', lambda *_args, **_kwargs: send_button)
    monkeypatch.setattr('python.actions.messaging.runtime.random.choice', lambda texts: texts[0])
    monkeypatch.setattr(
        'python.actions.messaging.runtime.mark_sent',
        lambda _client, username, _log: mark_sent_calls.append(username),
    )

    processed = run_messaging_flow(
        page=page,
        targets=[{'id': 'acct-1', 'user_name': 'demo'}],
        message_texts=['Hi'],
        log=log,
        should_stop=lambda: False,
        client=client,
    )

    assert processed == 1
    client.update_account_status.assert_not_called()
    assert mark_sent_calls == ['demo']


def test_run_messaging_flow_does_not_mark_scraping_when_send_fails(monkeypatch):
    page = MagicMock()
    page.keyboard = MagicMock()
    log = MagicMock()
    client = MagicMock()

    monkeypatch.setattr('python.actions.messaging.runtime.ensure_instagram_open', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.random_delay', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.navigate_to_profile', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.messaging.runtime.click_message_button', lambda *_args, **_kwargs: True)
    monkeypatch.setattr('python.actions.messaging.runtime.find_message_box', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.actions.messaging.runtime.mark_sent', lambda *_args, **_kwargs: None)

    processed = run_messaging_flow(
        page=page,
        targets=[{'id': 'acct-1', 'user_name': 'demo'}],
        message_texts=['Hi'],
        log=log,
        should_stop=lambda: False,
        client=client,
        behavior_config={'direct_message_success_status': 'scraping'},
    )

    assert processed == 0
    client.update_account_status.assert_not_called()


def test_wait_for_circuit_breaker_clamps_negative_wait(monkeypatch):
    slept: list[float] = []

    class _Circuit:
        global_pause_until = 1.0

        @staticmethod
        def is_open():
            return True

    monkeypatch.setattr('python.browser.context.proxy_circuit', _Circuit())
    monkeypatch.setattr('python.browser.context.time.time', lambda: 2.0)
    monkeypatch.setattr('python.browser.context.time.sleep', slept.append)

    _wait_for_circuit_breaker()

    assert slept == [0.0]


def test_wait_for_monitor_cooldown_clamps_negative_wait(monkeypatch):
    slept: list[float] = []
    monitor = MagicMock()
    monitor.should_pause.return_value = True
    monitor.cooldown_until = 1.0

    monkeypatch.setattr('python.browser.page_bootstrap.time.time', lambda: 2.0)
    monkeypatch.setattr('python.browser.page_bootstrap.time.sleep', slept.append)

    _wait_for_monitor_cooldown(monitor)

    assert slept == [0.0]


def test_clean_cache2_does_not_mark_cleaned_when_fallback_cleanup_fails(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        profile_path = Path(tmpdir)
        cache2 = profile_path / 'cache2'
        entries = cache2 / 'entries'
        entries.mkdir(parents=True)
        original_rmtree = __import__('shutil').rmtree

        def _fail_rmtree(path, *args, **kwargs):
            path_str = str(path)
            if path_str == str(cache2) or path_str == str(entries):
                raise OSError(path_str)
            return original_rmtree(path, *args, **kwargs)

        monkeypatch.setattr('python.browser.profile_paths.shutil.rmtree', _fail_rmtree)

        _clean_cache2(str(profile_path))

        assert not (profile_path / '.cache2_last_cleaned').exists()


def test_ensure_profile_path_does_not_clean_cache_before_session(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        profile_path = root / 'data' / 'profiles' / 'alice'
        cache2 = profile_path / 'cache2'
        cache2.mkdir(parents=True)

        cleaned_paths: list[str] = []
        monkeypatch.setattr(
            'python.browser.profile_paths._clean_cache2',
            lambda path: cleaned_paths.append(str(path)),
        )

        resolved = ensure_profile_path('alice', base_dir=str(root))

        assert resolved == str(profile_path)
        assert cleaned_paths == []


def test_ensure_profile_path_rejects_directory_traversal():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        escaped = root / 'data' / 'escaped'

        with pytest.raises(ValueError, match='Invalid profile name'):
            ensure_profile_path('../escaped', base_dir=str(root))

        assert not escaped.exists()


def test_run_browser_automated_session_returns_and_context_closes_once(monkeypatch):
    events: list[str] = []
    context = MagicMock()
    page = MagicMock()

    @contextmanager
    def fake_browser_session(*_args, **_kwargs):
        try:
            yield context, page
        finally:
            events.append('session_closed')
            context.close()

    monkeypatch.setattr('python.browser.runtime._print_run_header', lambda *_args, **_kwargs: None)
    monkeypatch.setattr('python.browser.runtime._open_browser_session', fake_browser_session)
    monkeypatch.setattr(
        'python.browser.runtime._run_feed_session',
        lambda *_args, **_kwargs: events.append('feed_ran'),
    )

    run_browser(
        profile_name='alice',
        proxy_string='None',
        action='scroll',
        duration=1,
    )

    assert events == ['feed_ran', 'session_closed']
    context.close.assert_called_once_with()
