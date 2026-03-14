from unittest.mock import ANY, MagicMock, call

import pytest

from python.actions.engagement.follow import highlights_runtime


HIGHLIGHT_SELECTORS = [
    'xpath=//div[@role="button" and contains(@aria-label,"highlight")]',
    'xpath=//a[contains(@aria-label,"highlight")]',
    '[aria-label*="highlight"]',
    'a[href*="/stories/highlights/"]',
    'xpath=//a[contains(@href,"/highlights/")]',
]

OPENED_SELECTOR = '[aria-label="Next"], svg[aria-label="Next"], [aria-label="Close"]'
OPENED_DIALOG_SELECTOR = '[role="dialog"] [aria-label="Close"]'


class UrlAwarePage:
    def __init__(self, selector_results, url_values, events):
        self._selector_results = list(selector_results)
        self._url_values = list(url_values)
        self._url_index = 0
        self._last_url = ''
        self.events = events
        self.keyboard = MagicMock()
        self.evaluate = MagicMock(side_effect=self._evaluate)
        self.query_selector = MagicMock(side_effect=self._query_selector)

    def _evaluate(self, script, _button):
        if 'scrollIntoView' in script:
            self.events.append('scroll')
            return None
        self.events.append('evaluate')
        return None

    def _query_selector(self, selector):
        self.events.append(f'select:{selector}')
        if self._selector_results:
            return self._selector_results.pop(0)
        return None

    @property
    def url(self):
        self.events.append('url')
        if self._url_index < len(self._url_values):
            self._last_url = self._url_values[self._url_index]
            self._url_index += 1
        return self._last_url


@pytest.fixture
def no_highlight_delays(monkeypatch):
    monkeypatch.setattr(highlights_runtime, 'random_delay', lambda *_args, **_kwargs: None)


@pytest.fixture
def messages():
    return []


def test_target_highlights_respects_explicit_count(messages):
    assert highlights_runtime._target_highlights(3, messages.append) == 3
    assert messages == []


def test_target_highlights_draws_random_count_when_missing(monkeypatch, messages):
    monkeypatch.setattr(highlights_runtime.random, 'randint', lambda _low, _high: 4)

    assert highlights_runtime._target_highlights(None, messages.append) == 4
    assert messages == []


def test_target_highlights_logs_skip_when_configured_zero(messages):
    assert highlights_runtime._target_highlights(0, messages.append) == 0
    assert messages == ['Skipping highlights (configured 0).']


def test_visible_highlight_buttons_returns_only_visible_matches(monkeypatch, messages):
    hidden_button = MagicMock(name='hidden_button')
    hidden_button.visible = False
    visible_button = MagicMock(name='visible_button')
    visible_button.visible = True
    second_visible_button = MagicMock(name='second_visible_button')
    second_visible_button.visible = True

    page = MagicMock()
    page.query_selector_all.side_effect = lambda selector: {
        HIGHLIGHT_SELECTORS[0]: [],
        HIGHLIGHT_SELECTORS[1]: [],
        HIGHLIGHT_SELECTORS[2]: [hidden_button, visible_button, second_visible_button],
    }.get(selector, [])
    page.evaluate.side_effect = lambda _script, button: button.visible
    monkeypatch.setattr(highlights_runtime.random, 'shuffle', lambda buttons: None)

    buttons = highlights_runtime._visible_highlight_buttons(page, messages.append)

    assert buttons == [visible_button, second_visible_button]
    assert messages == []
    queried_selectors = [call.args[0] for call in page.query_selector_all.call_args_list]
    assert queried_selectors[:3] == HIGHLIGHT_SELECTORS[:3]
    assert page.evaluate.call_args_list == [
        call(ANY, hidden_button),
        call(ANY, visible_button),
        call(ANY, second_visible_button),
    ]


def test_visible_highlight_buttons_logs_when_no_matches_found(messages):
    page = MagicMock()
    page.query_selector_all.return_value = []

    assert highlights_runtime._visible_highlight_buttons(page, messages.append) == []
    assert messages == ['No highlights found']
    assert [call.args[0] for call in page.query_selector_all.call_args_list] == HIGHLIGHT_SELECTORS
    page.evaluate.assert_not_called()


def test_visible_highlight_buttons_logs_when_all_matches_are_hidden(messages):
    hidden_button = MagicMock(name='hidden_button')
    hidden_button.visible = False
    page = MagicMock()
    page.query_selector_all.side_effect = lambda selector: [hidden_button] if selector == HIGHLIGHT_SELECTORS[0] else []
    page.evaluate.side_effect = lambda _script, button: button.visible

    assert highlights_runtime._visible_highlight_buttons(page, messages.append) == []
    assert messages == ['No visible highlights found']
    assert page.query_selector_all.call_args_list[0].args[0] == HIGHLIGHT_SELECTORS[0]
    page.evaluate.assert_called_once_with(ANY, hidden_button)


def test_open_random_highlight_stops_before_trying_any_button(monkeypatch, messages):
    attempted_buttons = []
    button = MagicMock(name='highlight_button')

    monkeypatch.setattr(
        highlights_runtime,
        '_open_highlight_with_retries',
        lambda _page, _log, current_button, _max_wait: attempted_buttons.append(current_button) or True,
    )

    opened = highlights_runtime._open_random_highlight(
        page=MagicMock(),
        log=messages.append,
        highlight_buttons=[button],
        max_wait=4.0,
        should_stop=lambda: True,
    )

    assert opened is False
    assert attempted_buttons == []
    assert messages == ['Watching highlight...', 'Stopping at user request.']


def test_open_highlight_with_retries_retries_until_url_reflects_opened_story(monkeypatch, no_highlight_delays, messages):
    events = []
    page = UrlAwarePage(
        selector_results=[None, None, None, None, None, None],
        url_values=[
            'https://www.instagram.com/demo/',
            'https://www.instagram.com/stories/highlights/123/',
        ],
        events=events,
    )
    button = MagicMock(name='highlight_button')
    button.click.side_effect = lambda *args, **kwargs: events.append('click')

    monkeypatch.setattr(
        highlights_runtime,
        '_wait_for_highlight_button',
        lambda _page, _button: events.append('wait'),
    )

    assert highlights_runtime._open_highlight_with_retries(page, messages.append, button, 4.0) is True
    assert messages == ['Highlight did not open, retrying...']
    assert [event for event in events if event == 'wait'] == ['wait', 'wait']
    assert len([event for event in events if event == 'scroll']) >= 2
    assert [event for event in events if event == 'click'] == ['click', 'click']
    assert [event for event in events if event.startswith('select:')] == [
        f'select:{OPENED_SELECTOR}',
        f'select:{OPENED_DIALOG_SELECTOR}',
        'select:video',
        f'select:{OPENED_SELECTOR}',
        f'select:{OPENED_DIALOG_SELECTOR}',
        'select:video',
    ]
    assert [event for event in events if event == 'url'] == ['url', 'url']
    assert button.click.call_args_list == [call(), call()]


def test_open_highlight_with_retries_logs_last_error_after_exhausting_attempts(monkeypatch, no_highlight_delays, messages):
    waits = []

    def fail_wait(_page, _button):
        waits.append('wait')
        raise RuntimeError('stale')

    monkeypatch.setattr(highlights_runtime, '_wait_for_highlight_button', fail_wait)

    assert highlights_runtime._open_highlight_with_retries(MagicMock(), messages.append, MagicMock(), 4.0) is False
    assert len(waits) == 8
    assert messages == ['Skipping highlight button: stale']


def test_advance_highlight_clicks_next_button_when_available(monkeypatch, no_highlight_delays, messages):
    events = []
    page = MagicMock()
    next_button = MagicMock()
    next_button.click.side_effect = lambda: events.append('click-next')

    monkeypatch.setattr(
        highlights_runtime,
        '_find_story_nav',
        lambda _page, _label: events.append('find-next') or next_button,
    )

    assert highlights_runtime._advance_highlight(page, messages.append, 2, 4) is True
    assert messages == ['Moving to next highlight (2/4)']
    assert events == ['find-next', 'click-next']
    page.keyboard.press.assert_not_called()


def test_advance_highlight_falls_back_to_arrow_right_when_next_button_missing(monkeypatch, no_highlight_delays, messages):
    page = MagicMock()
    pressed = []
    page.keyboard.press.side_effect = lambda key: pressed.append(key)
    monkeypatch.setattr(highlights_runtime, '_find_story_nav', lambda _page, _label: None)

    assert highlights_runtime._advance_highlight(page, messages.append, 3, 4) is True
    assert messages == ['Moving via right arrow (3/4)']
    assert pressed == ['ArrowRight']


def test_advance_highlight_logs_failures_when_button_and_keyboard_both_fail(monkeypatch, no_highlight_delays, messages):
    page = MagicMock()
    next_button = MagicMock()
    next_button.click.side_effect = RuntimeError('click failed')
    page.keyboard.press.side_effect = RuntimeError('press failed')
    monkeypatch.setattr(highlights_runtime, '_find_story_nav', lambda _page, _label: next_button)

    assert highlights_runtime._advance_highlight(page, messages.append, 2, 4) is False
    assert messages == [
        'Failed to move to next highlight: click failed',
        "'Next' button not found and key press failed: press failed",
    ]


def test_click_close_button_prefers_close_button(messages):
    page = MagicMock()
    close_button = MagicMock()

    assert highlights_runtime._click_close_button(page, messages.append, close_button) is True
    assert messages == ['Highlight closed by button']
    close_button.click.assert_called_once_with()
    page.keyboard.press.assert_not_called()


def test_click_close_button_falls_back_to_escape_after_button_failure(messages):
    events = []
    page = MagicMock()
    page.keyboard.press.side_effect = lambda key: events.append(f'press:{key}')
    close_button = MagicMock()

    def fail_close():
        events.append('close-click')
        raise RuntimeError('close blocked')

    close_button.click.side_effect = fail_close

    assert highlights_runtime._click_close_button(page, messages.append, close_button) is True
    assert messages == [
        'Failed to close highlight by button: close blocked',
        'Highlight closed by Escape key',
    ]
    assert events == ['close-click', 'press:Escape']


def test_click_close_button_logs_failure_when_no_close_action_works(messages):
    page = MagicMock()
    page.keyboard.press.side_effect = RuntimeError('escape blocked')

    assert highlights_runtime._click_close_button(page, messages.append, None) is False
    assert messages == ['Failed to close highlight']
