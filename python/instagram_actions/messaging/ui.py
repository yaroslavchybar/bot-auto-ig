import random
from typing import Callable

from python.instagram_actions.actions import random_delay
from python.internal_systems.error_handling.retry import retry_with_backoff
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

def ensure_instagram_open(page) -> None:
    try:
        if page.url == "about:blank":
            page.goto("https://www.instagram.com", timeout=15000)
    except Exception:
        pass


def navigate_to_profile(page, username: str, log: Callable[[str], None]) -> bool:
    """Navigate to a user's Instagram profile page."""
    url = f"https://www.instagram.com/{username}/"
    try:
        # Increased timeouts for very slow proxies
        page.goto(url, timeout=45000)
        page.wait_for_load_state("networkidle", timeout=30000)
        log(f"Перешёл на профиль: {username}")
        return True
    except Exception as e:
        log(f"Ошибка перехода на профиль {username}: {e}")
        return False


@retry_with_backoff(exceptions=(PlaywrightTimeoutError, Exception), max_retries=3, initial_delay=1.5)
def click_message_button(page, log: Callable[[str], None]) -> bool:
    """Find and click the Message button on a profile page header (not the sidebar Messages nav)."""
    # Use :text-is() for exact match — "Message" not "Messages"
    selectors = [
        'header div[role="button"]:text-is("Message")',
        'header button:text-is("Message")',
        'section div[role="button"]:text-is("Message")',
        'section button:text-is("Message")',
        'div[role="button"]:text-is("Message")',
        'button:text-is("Message")',
    ]
    for selector in selectors:
        try:
            btn = page.locator(selector).first
            if btn.is_visible(timeout=8000):
                btn.click()
                log("Нажал кнопку Message")
                random_delay(2, 4)
                return True
        except Exception:
            continue
    return False


def click_follow_button(page, log: Callable[[str], None]) -> bool:
    """Find and click the Follow button on a profile page."""
    selectors = [
        'button:has-text("Follow")',
        'div[role="button"]:has-text("Follow")',
    ]
    for selector in selectors:
        try:
            btn = page.locator(selector).first
            if btn.is_visible(timeout=3000):
                text = btn.inner_text().strip().lower()
                if text == "follow":
                    btn.click()
                    log("Нажал кнопку Follow")
                    random_delay(3, 5)
                    return True
        except Exception:
            continue
    return False


@retry_with_backoff(exceptions=(PlaywrightTimeoutError, Exception), max_retries=3, initial_delay=1.5)
def find_message_box(page, log: Callable[[str], None]):
    """Find the DM text input box."""
    msg_selectors = [
        'div[role="textbox"][contenteditable="true"]',
        'div[aria-label="Message"][contenteditable="true"]',
        'div[aria-placeholder="Message..."][contenteditable="true"]',
        '[data-lexical-editor="true"]',
    ]
    for selector in msg_selectors:
        try:
            msg_box = page.locator(selector).first
            if msg_box.is_visible(timeout=10000):
                log(f"Найдено поле ввода сообщения: {selector}")
                return msg_box
        except Exception:
            continue
    raise Exception("Message box not found after retries")


@retry_with_backoff(exceptions=(PlaywrightTimeoutError, Exception), max_retries=3, initial_delay=1.5)
def find_send_button(page):
    """Find the Send button in the DM conversation."""
    send_btn = page.locator('div[role="button"]:has-text("Send")').first
    if not send_btn.is_visible(timeout=5000):
        send_btn = page.locator('button:has-text("Send")').first
    if send_btn.is_visible(timeout=5000):
        return send_btn
    raise Exception("Send button not found after retries")


def cleanup_return_home(page, log: Callable[[str], None]) -> None:
    """Navigate back to Instagram home page."""
    try:
        log("Messages: возвращаюсь домой")
        try:
            svg = page.query_selector('svg[aria-label="Home"]')
            if svg:
                btn = svg.query_selector('xpath=ancestor-or-self::*[@role="link"][1]') or svg.query_selector(
                    'xpath=ancestor-or-self::*[@role="button"][1]'
                )
                (btn or svg).click()
            else:
                link = page.query_selector('a[role="link"][href="/"]')
                if link:
                    link.click()
                else:
                    page.goto("https://www.instagram.com/", timeout=20000)
        except Exception:
            page.goto("https://www.instagram.com/", timeout=20000)
        random_delay(1.0, 2.0)
        try:
            close_svg = page.query_selector('svg[aria-label="Close"]')
            if close_svg:
                close_btn = close_svg.query_selector(
                    'xpath=ancestor-or-self::*[self::button or @role="button"][1]'
                ) or close_svg.query_selector('xpath=ancestor-or-self::*[self::div][1]')
                (close_btn or close_svg).click()
                log("Messages: закрыл всплывающее окно")
            else:
                page.keyboard.press("Escape")
        except Exception:
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
        random_delay(0.6, 1.2)
    except Exception as e:
        log(f"Messages: ошибка очистки: {e}")
