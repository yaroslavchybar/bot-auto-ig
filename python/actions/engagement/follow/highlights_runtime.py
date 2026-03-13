import random
from typing import Callable, Optional

from python.actions.common import random_delay
from python.actions.engagement.follow.common import _find_close_button, _safe


def _find_story_nav(page, label: str):
    try:
        for svg in page.query_selector_all(f'svg[aria-label*="{label}" i]'):
            btn = svg.query_selector('xpath=ancestor-or-self::*[@role="button"][1]')
            if btn:
                return btn
    except Exception:
        return None
    return None


def watch_highlights(
    page,
    log: Callable[[str], None],
    highlights_to_watch: Optional[int] = None,
    max_wait: float = 4.0,
    should_stop: Callable[[], bool] | None = None,
):
    _safe(
        log,
        'хайлайты',
        lambda: _watch_highlights_impl(page, log, highlights_to_watch, max_wait, should_stop),
    )


def _watch_highlights_impl(page, log, highlights_to_watch, max_wait: float, should_stop) -> None:
    target_highlights = _target_highlights(highlights_to_watch, log)
    if target_highlights <= 0:
        return
    highlight_buttons = _visible_highlight_buttons(page, log)
    if not highlight_buttons:
        return
    if not _open_random_highlight(page, log, highlight_buttons, max_wait, should_stop):
        log('Не удалось открыть ни один хайлайт')
        return
    log('Хайлайт успешно открыт')
    random_delay(2.0, 4.0)
    _watch_opened_highlights(page, log, target_highlights, should_stop)
    _close_highlight(page, log)


def _target_highlights(highlights_to_watch: Optional[int], log) -> int:
    target_highlights = highlights_to_watch if highlights_to_watch is not None else random.randint(2, 4)
    if target_highlights <= 0:
        log('Пропускаю хайлайты (настроено 0).')
        return 0
    return target_highlights


def _visible_highlight_buttons(page, log):
    highlight_buttons = []
    for selector in (
        'xpath=//div[@role="button" and contains(@aria-label,"highlight")]',
        'xpath=//a[contains(@aria-label,"highlight")]',
        '[aria-label*="highlight"]',
        'a[href*="/stories/highlights/"]',
        'xpath=//a[contains(@href,"/highlights/")]',
    ):
        highlight_buttons.extend(page.query_selector_all(selector))
    if not highlight_buttons:
        log('Хайлайты не найдены')
        return []
    visible_buttons = [button for button in highlight_buttons if _is_visible(page, button)]
    if not visible_buttons:
        log('Видимых хайлайтов не найдено')
        return []
    random.shuffle(visible_buttons)
    return visible_buttons


def _is_visible(page, button) -> bool:
    try:
        return page.evaluate(
            """
            (element) => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return style.display !== 'none' &&
                       style.visibility !== 'hidden' &&
                       rect.width > 0 &&
                       rect.height > 0 &&
                       rect.top >= 0 &&
                       rect.top <= (window.innerHeight || document.documentElement.clientHeight);
            }
            """,
            button,
        )
    except Exception:
        return False


def _open_random_highlight(page, log, highlight_buttons, max_wait: float, should_stop) -> bool:
    log('Смотрю хайлайт...')
    for button in highlight_buttons:
        if should_stop and should_stop():
            log('Остановка по запросу пользователя.')
            return False
        if _open_highlight_with_retries(page, log, button, max_wait):
            return True
    return False


def _open_highlight_with_retries(page, log, button, max_wait: float) -> bool:
    max_attempts = 8
    for attempt in range(max_attempts):
        try:
            _scroll_highlight_into_view(page, button)
            _wait_for_highlight_button(page, button)
            random_delay(0.3, 0.8)
            if not _click_highlight(page, log, button):
                continue
            random_delay(1.5, max_wait)
            if _highlight_opened(page):
                return True
            log('Хайлайт не открылся, пробую ещё...')
            random_delay(0.6, 1.2)
        except Exception as exc:
            if attempt == max_attempts - 1:
                log(f'Пропускаю кнопку хайлайта: {exc}')
            random_delay(0.5, 1.0)
    return False


def _wait_for_highlight_button(page, button) -> None:
    page.wait_for_function(
        """
        (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const isVisible = style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0' &&
                            rect.width > 0 &&
                            rect.height > 0;
            const isInViewport = rect.top >= 0 &&
                               rect.left >= 0 &&
                               rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                               rect.right <= (window.innerWidth || document.documentElement.clientWidth);
            return isVisible && isInViewport;
        }
        """,
        arg=button,
        timeout=2000,
    )


def _scroll_highlight_into_view(page, button) -> None:
    try:
        page.evaluate(
            """
            (element) => element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
            """,
            button,
        )
    except Exception:
        pass


def _click_highlight(page, log, button) -> bool:
    _scroll_highlight_into_view(page, button)
    random_delay(0.2, 0.5)
    for click in (
        lambda: button.click(),
        lambda: button.click(force=True),
        lambda: page.evaluate('(element) => element.click()', button),
    ):
        try:
            click()
            return True
        except Exception:
            continue
    log('Не удалось кликнуть по хайлайту JS')
    return False


def _highlight_opened(page) -> bool:
    return bool(
        page.query_selector('[aria-label="Next"], svg[aria-label="Next"], [aria-label="Close"]')
        or page.query_selector('[role="dialog"] [aria-label="Close"]')
        or page.query_selector('video')
        or 'stories/highlights' in (page.url or '')
    )


def _watch_opened_highlights(page, log, target_highlights: int, should_stop) -> None:
    log('Смотрю хайлайты...')
    watched = 0
    while watched < target_highlights:
        if should_stop and should_stop():
            log('Остановка по запросу пользователя.')
            break
        random_delay(*_highlight_watch_delay_range())
        watched += 1
        if watched >= target_highlights:
            break
        if not _advance_highlight(page, log, watched + 1, target_highlights):
            break
    log(f'Просмотрено {watched} хайлайтов')


def _highlight_watch_delay_range() -> tuple[float, float]:
    start = random.uniform(3.0, 8.0)
    end = random.uniform(4.0, 9.0)
    return (start, end) if start <= end else (end, start)


def _advance_highlight(page, log, index: int, total: int) -> bool:
    next_btn = _find_story_nav(page, 'Next')
    if next_btn:
        try:
            next_btn.click()
            log(f'Переход к следующему хайлайту ({index}/{total})')
            random_delay(1.0, 2.0)
            return True
        except Exception as exc:
            log(f'Не удалось перейти к следующему хайлайту: {exc}')
    try:
        page.keyboard.press('ArrowRight')
        log(f'Переход стрелкой вправо ({index}/{total})')
        random_delay(1.0, 2.0)
        return True
    except Exception as exc:
        log(f"Кнопка 'Далее' не найдена и клавиша не сработала: {exc}")
        return False


def _close_highlight(page, log) -> None:
    close_btn = _find_close_button(page)
    if _click_close_button(page, log, close_btn):
        log('Жду восстановления страницы после хайлайта...')
        random_delay(3.0, 5.0)


def _click_close_button(page, log, close_btn) -> bool:
    if close_btn:
        try:
            close_btn.click()
            log('Хайлайт закрыт кнопкой')
            return True
        except Exception as exc:
            log(f'Не удалось закрыть хайлайт кнопкой: {exc}')
    try:
        page.keyboard.press('Escape')
        log('Хайлайт закрыт клавишей Escape')
        return True
    except Exception:
        log('Не удалось закрыть хайлайт')
        return False
