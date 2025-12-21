import random
from typing import Callable, Optional

from automation.actions import random_delay
from automation.Follow.common import _safe


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
    """Open random highlight if exists, watch multiple highlights by swiping, then close."""

    def _impl():
        target_highlights = highlights_to_watch if highlights_to_watch is not None else random.randint(2, 4)
        if target_highlights <= 0:
            log("ℹ️ Пропускаю хайлайты (настроено 0).")
            return

        # Try multiple selectors for highlight buttons (more inclusive)
        highlight_buttons = (
            page.query_selector_all('xpath=//div[@role="button" and contains(@aria-label,"highlight")]') or
            page.query_selector_all('xpath=//a[contains(@aria-label,"highlight")]') or
            page.query_selector_all('[aria-label*="highlight"]') or
            page.query_selector_all('a[href*="/stories/highlights/"]') or
            page.query_selector_all('xpath=//a[contains(@href,"/highlights/")]')
        )

        if not highlight_buttons:
            log("ℹ️ Хайлайты не найдены")
            return

        # Prefer only visible highlights to avoid clicking hidden/covered elements.
        def _is_visible(btn):
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
                    btn,
                )
            except Exception:
                return False

        highlight_buttons = [btn for btn in highlight_buttons if _is_visible(btn)]
        if not highlight_buttons:
            log("ℹ️ Видимых хайлайтов не найдено")
            return

        # Shuffle and try each highlight until one opens
        random.shuffle(highlight_buttons)

        def click_highlight(btn):
            """Try multiple click strategies to open a highlight."""
            try:
                page.evaluate(
                    """
                    (element) => element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
                    """,
                    btn,
                )
            except Exception:
                pass
            random_delay(0.2, 0.5)
            try:
                btn.click()
                return True
            except Exception:
                try:
                    btn.click(force=True)
                    return True
                except Exception:
                    try:
                        page.evaluate("(element) => element.click()", btn)
                        return True
                    except Exception as js_err:
                        log(f"ℹ️ Не удалось кликнуть по хайлайту JS: {js_err}")
                        return False

        log("👀 Смотрю хайлайт...")

        max_attempts = 8
        opened = False
        for btn in highlight_buttons:
            if should_stop and should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                return

            for attempt in range(max_attempts):
                try:
                    # Wait for element to be stable and clickable
                    page.wait_for_function("""
                        (element) => {
                            const rect = element.getBoundingClientRect();
                            const style = window.getComputedStyle(element);
                            const isVisible = style.display !== 'none' &&
                                            style.visibility !== 'hidden' &&
                                            style.opacity !== '0' &&
                                            rect.width > 0 &&
                                            rect.height > 0;

                            // Additional check: element should be within viewport
                            const isInViewport = rect.top >= 0 &&
                                               rect.left >= 0 &&
                                               rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                                               rect.right <= (window.innerWidth || document.documentElement.clientWidth);

                            return isVisible && isInViewport;
                        }
                    """, arg=btn, timeout=2000)

                    random_delay(0.3, 0.8)

                    if not click_highlight(btn):
                        continue

                    random_delay(1.5, max_wait)

                    story_view = (
                        page.query_selector('[aria-label="Next"], svg[aria-label="Next"], [aria-label="Close"]')
                        or page.query_selector('[role="dialog"] [aria-label="Close"]')
                        or page.query_selector('video')
                    )
                    if story_view or "stories/highlights" in (page.url or ""):
                        opened = True
                        break
                    else:
                        log("ℹ️ Хайлайт не открылся, пробую ещё...")
                        random_delay(0.6, 1.2)

                except Exception as wait_err:
                    if attempt == max_attempts - 1:
                        log(f"ℹ️ Пропускаю кнопку хайлайта: {wait_err}")
                    random_delay(0.5, 1.0)

            if opened:
                break

        if not opened:
            log("ℹ️ Не удалось открыть ни один хайлайт")
            return

        log("✅ Хайлайт успешно открыт")
        random_delay(2.0, 4.0)

        # Actually watch the highlight and navigate through multiple highlights
        log("📺 Смотрю хайлайты...")
        highlights_watched = 0
        max_highlights_to_watch = target_highlights  # Configurable count

        while highlights_watched < max_highlights_to_watch:
            if should_stop and should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                break

            watch_time = random.uniform(3.0, 8.0)
            random_delay(watch_time, watch_time + 1.0)
            highlights_watched += 1

            if highlights_watched < max_highlights_to_watch:
                next_btn = _find_story_nav(page, "Next")
                if next_btn:
                    try:
                        next_btn.click()
                        log(f"➡️ Переход к следующему хайлайту ({highlights_watched + 1}/{max_highlights_to_watch})")
                        random_delay(1.0, 2.0)
                    except Exception as nav_err:
                        log(f"ℹ️ Не удалось перейти к следующему хайлайту: {nav_err}")
                        try:
                            page.keyboard.press("ArrowRight")
                            log("➡️ Переход стрелкой вправо")
                            random_delay(1.0, 2.0)
                        except Exception as key_err:
                            log(f"ℹ️ Не удалось перейти стрелкой: {key_err}")
                            break
                else:
                    try:
                        page.keyboard.press("ArrowRight")
                        log(f"➡️ Переход стрелкой вправо ({highlights_watched + 1}/{max_highlights_to_watch})")
                        random_delay(1.0, 2.0)
                    except Exception as key_err:
                        log(f"ℹ️ Кнопка 'Далее' не найдена и клавиша не сработала: {key_err}")
                        break

        log(f"✅ Просмотрено {highlights_watched} хайлайтов")

        # Close the highlight story - try close button first, then Escape as fallback
        close_btn = (page.query_selector('button[aria-label="Close"]') or
                   page.query_selector('svg[aria-label="Close"]') or
                   page.query_selector('[role="button"][aria-label*="Close"]') or
                   page.query_selector('button[aria-label*="close" i]') or
                   page.query_selector('div svg[aria-label="Close"]'))

        if close_btn:
            try:
                close_btn.click()
                log("❌ Хайлайт закрыт кнопкой")
            except Exception as close_err:
                log(f"ℹ️ Не удалось закрыть хайлайт кнопкой: {close_err}")
                try:
                    page.keyboard.press("Escape")
                    log("❌ Хайлайт закрыт клавишей Escape")
                except:
                    log("ℹ️ Не удалось закрыть хайлайт")
        else:
            # Fallback: try Escape key
            try:
                page.keyboard.press("Escape")
                log("❌ Хайлайт закрыт клавишей Escape")
            except:
                log("ℹ️ Не удалось закрыть хайлайт")

        # Extra delay after closing highlight to ensure page fully returns to normal state
        log("ℹ️ Жду восстановления страницы после хайлайта...")
        random_delay(3.0, 5.0)

    _safe(log, "хайлайты", _impl)

