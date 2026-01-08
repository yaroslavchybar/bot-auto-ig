from typing import Callable, List

from python.instagram_actions.actions import random_delay


def ensure_instagram_open(page, log: Callable[[str], None]) -> None:
    try:
        if page.url == "about:blank":
            page.goto("https://www.instagram.com", timeout=15000)
    except Exception:
        pass

    random_delay(2, 4)


def open_notifications(page, log: Callable[[str], None]) -> bool:
    log("Перехожу в уведомления...")

    try:
        page.locator('svg[aria-label="Notifications"]').click()
        random_delay(3, 5)
        return True
    except Exception as e:
        log(f"Не нашел кнопку уведомлений: {e}")

    try:
        page.goto("https://www.instagram.com/accounts/activity/", timeout=15000)
        random_delay(2, 4)
        return True
    except Exception:
        return False


def open_follow_requests_list(page, log: Callable[[str], None]) -> bool:
    log("Ищу 'Follow request' и открываю список заявок...")

    try:
        el = page.locator('text=Follow request').first
        if el and el.is_visible():
            el.click()
            random_delay(2, 3)
            return True
    except Exception:
        pass

    try:
        el2 = page.locator('span:has-text("Follow request")').first
        if el2 and el2.is_visible():
            el2.click()
            random_delay(2, 3)
            return True
    except Exception:
        pass

    return False


def find_confirm_buttons(page) -> List[object]:
    return page.locator('div[role="button"]:has-text("Confirm")').all()


def close_notifications(page, log: Callable[[str], None]) -> None:
    log("Закрываю окно уведомлений...")

    try:
        close_btn = page.locator('div[aria-label="Close"][role="button"]').first
        if close_btn.is_visible():
            close_btn.click()
            return
    except Exception:
        pass

    log("Кнопка закрытия не найдена, кликаю уведомления для закрытия...")
    try:
        page.locator('svg[aria-label="Notifications"]').click()
        random_delay(1, 2)
    except Exception as e:
        log(f"Не удалось закрыть уведомления кликом: {e}")

