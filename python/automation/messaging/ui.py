from typing import Callable

from python.automation.actions import random_delay
from python.core.automation.selectors import MESSAGE_BUTTON, NOT_NOW_BUTTON


def ensure_instagram_open(page) -> None:
    try:
        if page.url == "about:blank":
            page.goto("https://www.instagram.com", timeout=15000)
    except Exception:
        pass


def _is_left_sidebar_locator(locator) -> bool:
    try:
        handle = locator.element_handle()
        if not handle:
            return False
        box = handle.bounding_box()
        if not box:
            return False
        return float(box.get("x", 10_000)) < 400
    except Exception:
        return False


def _pick_left_sidebar_locator(candidates):
    for cand in candidates:
        try:
            if cand.is_visible(timeout=1000) and _is_left_sidebar_locator(cand):
                return cand
        except Exception:
            continue
    return None


def open_direct_inbox(page, log: Callable[[str], None]) -> None:
    log("Перехожу в Direct Inbox через кнопку Messages...")

    page.wait_for_load_state("networkidle", timeout=15000)

    messages_button = None

    try:
        sidebar = page.locator("nav").filter(has=page.locator('a[href="/direct/inbox/"]')).first
        if sidebar and sidebar.count() > 0:
            messages_button = sidebar.locator('a[href="/direct/inbox/"][role="link"]').first
            if not messages_button.is_visible(timeout=3000):
                messages_button = None
    except Exception:
        messages_button = None

    if not messages_button:
        try:
            sidebar = page.locator("nav").filter(has=page.locator('a[aria-label*="Direct messaging"]')).first
            if sidebar and sidebar.count() > 0:
                messages_button = sidebar.locator('a[aria-label*="Direct messaging"][role="link"]').first
                if not messages_button.is_visible(timeout=3000):
                    messages_button = None
        except Exception:
            messages_button = None

    if not messages_button:
        try:
            messages_button = (
                page.locator('a[href="/direct/inbox/"][role="link"]').filter(
                    has=page.locator('svg[aria-label="Messages"]')
                )
            ).first
            if not messages_button.is_visible(timeout=3000):
                messages_button = None
        except Exception:
            messages_button = None

    if not messages_button:
        messages_button = MESSAGE_BUTTON.find(page)

    if not messages_button:
        try:
            messages_button = page.locator('a[href="/direct/inbox/"]').first
            if not messages_button.is_visible(timeout=3000):
                messages_button = None
        except Exception:
            messages_button = None

    if not messages_button:
        try:
            messages_button = page.locator('a[aria-label*="Direct messaging"]').first
            if not messages_button.is_visible(timeout=3000):
                messages_button = None
        except Exception:
            messages_button = None

    if not messages_button:
        try:
            messages_button = page.locator('svg[aria-label="Messages"]').locator("xpath=ancestor::a").first
            if not messages_button.is_visible(timeout=3000):
                messages_button = None
        except Exception:
            messages_button = None

    if not messages_button:
        try:
            messages_button = page.locator('a[href*="direct"]').first
            if not messages_button.is_visible(timeout=3000):
                messages_button = None
        except Exception:
            messages_button = None

    if not messages_button:
        raise Exception("Не удалось найти кнопку Messages в сайдбаре")

    try:
        if not _is_left_sidebar_locator(messages_button):
            candidates = page.locator('a[href="/direct/inbox/"][role="link"]').all()
            picked = _pick_left_sidebar_locator(candidates)
            if picked:
                messages_button = picked
    except Exception:
        pass

    try:
        messages_button.scroll_into_view_if_needed()
    except Exception:
        pass

    messages_button.click()
    log("Кликнул на кнопку Messages в сайдбаре")

    page.wait_for_load_state("networkidle", timeout=10000)
    log("Переход в Direct Inbox завершен")


def dismiss_turn_on_notifications_popup(page) -> None:
    try:
        not_now_btn = NOT_NOW_BUTTON.find(page)
        if not_now_btn:
            not_now_btn.click()
            random_delay(1, 2)
    except Exception:
        pass


def open_new_message_search(page, log: Callable[[str], None]):
    search_input = page.locator('input[name="searchInput"]').first
    if not search_input.is_visible():
        search_input = page.locator('input[placeholder="Search"]').first

    if not search_input.is_visible():
        search_input = page.locator('label input[placeholder="Search"]').first

    if not search_input.is_visible():
        log("Поле поиска не найдено")
        return None

    search_input.click()
    log("Кликнул на поле поиска для начала нового сообщения")
    return search_input


def find_modal_search_input(page, log: Callable[[str], None]):
    selectors_to_try = [
        'input[name="queryBox"]',
        'input[placeholder="Search..."]',
        'input[placeholder*="Search"]',
        'input[aria-label*="Search"]',
        'input[type="text"]',
        'input[role="textbox"]',
    ]

    for selector in selectors_to_try:
        try:
            modal_search = page.locator(selector).first
            if modal_search.is_visible(timeout=2000):
                log(f"Найдено поле поиска в модале: {selector}")
                return modal_search
        except Exception:
            continue

    return None


def select_user_row(page, username: str, log: Callable[[str], None]) -> bool:
    user_row = page.locator(f'div[role="button"]:has-text("{username}")').first
    if user_row.is_visible(timeout=5000):
        user_row.click()
        log(f"Выбрал пользователя: {username}")
        return True

    log(f"Пользователь {username} не найден в поиске.")
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    return False


def find_message_box(page, log: Callable[[str], None]):
    msg_selectors = [
        'div[role="textbox"][contenteditable="true"]',
        'div[aria-label="Message"][contenteditable="true"]',
        'div[aria-placeholder="Message..."][contenteditable="true"]',
        '[data-lexical-editor="true"]',
    ]

    for selector in msg_selectors:
        try:
            msg_box = page.locator(selector).first
            if msg_box.is_visible(timeout=3000):
                log(f"Найдено поле ввода сообщения: {selector}")
                return msg_box
        except Exception:
            continue

    return None


def find_send_button(page):
    send_btn = page.locator('div[role="button"]:has-text("Send")').first
    if not send_btn.is_visible():
        send_btn = page.locator('button:has-text("Send")').first

    if send_btn.is_visible():
        return send_btn

    return None


def recover_to_inbox(page) -> None:
    try:
        page.goto("https://www.instagram.com/direct/inbox/", timeout=10000)
    except Exception:
        pass


def cleanup_return_home(page, log: Callable[[str], None]) -> None:
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
