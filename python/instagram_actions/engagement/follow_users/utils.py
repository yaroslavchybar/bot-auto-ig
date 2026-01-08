import random
import time
from typing import Callable, Iterable, List, Optional

from python.instagram_actions.actions import random_delay
from python.internal_systems.shared_utilities.selectors import SEARCH_BUTTON


def clean_usernames(usernames: Iterable[str]) -> List[str]:
    """Normalize username list (strip, remove @, drop empties)."""
    clean: List[str] = []
    for u in usernames:
        if not u:
            continue
        name = u.strip().lstrip("@")
        if name:
            clean.append(name)
    return clean


def call_on_success(
    on_success: Optional[Callable[[str], None]],
    username: str,
    log: Callable[[str], None],
):
    """Safe wrapper for on_success callbacks."""
    if not on_success:
        return
    try:
        on_success(username)
    except Exception as callback_err:
        log(f"Не удалось обновить статус @{username}: {callback_err}")


def _pick_visible(locator_candidates, timeout_ms: int = 3500):
    deadline = time.time() + (timeout_ms / 1000.0)
    while time.time() < deadline:
        for loc in locator_candidates:
            try:
                if not loc:
                    continue
                cand = loc.first
                if cand.count() > 0 and cand.is_visible(timeout=250):
                    return cand
            except Exception:
                continue
        time.sleep(0.15)
    return None


def _find_search_input(page):
    candidates = [
        page.locator('input[aria-label="Search input"]'),
        page.locator('input[placeholder="Search"]'),
        page.locator('input[aria-label*="Search" i]'),
        page.locator('input[type="text"]'),
    ]
    return _pick_visible(candidates, timeout_ms=4500)


def _find_user_result_link(page, dialog, username: str, log: Callable[[str], None]):
    """Find the search result link that matches the given username.
    
    Priority:
    1. First, look for a result where the displayed username text exactly matches
       (this is how a user would visually identify the correct profile)
    2. Fall back to href matching if no exact text match is found
    """
    username_lower = (username or "").strip().lstrip("@").lower()
    if not username_lower:
        return None

    # Wait a bit for results to fully load
    time.sleep(1.5)

    # Try to find links both in dialog and on the whole page
    links = []
    try:
        links = dialog.locator('a[role="link"]').all()
        log(f"Найдено {len(links)} ссылок в диалоге поиска")
    except Exception as e:
        log(f"Ошибка поиска ссылок в диалоге: {e}")

    # If no links in dialog, try the whole page
    if not links:
        try:
            links = page.locator('a[role="link"]').all()
            log(f"Найдено {len(links)} ссылок на странице")
        except Exception:
            links = []

    # Priority 1: Find by exact username text match in the displayed spans
    # The username is shown in a span element within the search result
    for link in links:
        try:
            # Look for spans that contain the username text
            spans = link.locator('span').all()
            for span in spans:
                try:
                    span_text = (span.inner_text() or "").strip().lstrip("@").lower()
                    # Check for exact match (the span should contain just the username)
                    if span_text == username_lower:
                        if link.is_visible(timeout=500):
                            log(f"Найден профиль по тексту span: {username}")
                            return link
                except Exception:
                    continue
        except Exception:
            continue

    # Priority 2: Check the first line of link text (username is typically first line)
    for link in links:
        try:
            txt = (link.inner_text() or "").strip().splitlines()
            head = (txt[0] if txt else "").strip().lstrip("@").lower()
            if head == username_lower:
                if link.is_visible(timeout=500):
                    log(f"Найден профиль по первой строке: {username}")
                    return link
        except Exception:
            continue

    # Priority 3: Fall back to matching by href attribute
    try:
        direct = dialog.locator(f'a[href="/{username_lower}/"]').first
        if direct.count() > 0 and direct.is_visible(timeout=500):
            log(f"Найден профиль по href в диалоге: {username}")
            return direct
    except Exception:
        pass

    # Try on page level
    try:
        direct = page.locator(f'a[href="/{username_lower}/"]').first
        if direct.count() > 0 and direct.is_visible(timeout=500):
            log(f"Найден профиль по href на странице: {username}")
            return direct
    except Exception:
        pass

    for link in links:
        try:
            href = (link.get_attribute("href") or "").strip().lower()
            if href == f"/{username_lower}/":
                if link.is_visible(timeout=500):
                    log(f"Найден профиль по href в списке: {username}")
                    return link
        except Exception:
            continue

    log(f"Профиль @{username} не найден в результатах поиска")
    return None


def open_profile_via_search_first(page, username: str, log: Callable[[str], None]) -> bool:
    username = (username or "").strip().lstrip("@")
    if not username:
        return False

    try:
        if page.url == "about:blank":
            page.goto("https://www.instagram.com/", timeout=15000)
            random_delay(1.0, 2.0)
    except Exception:
        pass

    try:
        search_btn = SEARCH_BUTTON.find(page)
        if not search_btn:
            return False

        try:
            search_btn.scroll_into_view_if_needed()
        except Exception:
            pass

        search_btn.click()
        random_delay(0.6, 1.2)

        search_input = _find_search_input(page)
        if not search_input:
            return False

        try:
            search_input.click()
        except Exception:
            pass

        try:
            search_input.fill("")
        except Exception:
            try:
                page.keyboard.press("Control+A")
                page.keyboard.press("Backspace")
            except Exception:
                pass

        random_delay(0.15, 0.35)

        try:
            search_input.type(username, delay=random.randint(80, 160))
        except Exception:
            page.keyboard.type(username, delay=random.randint(80, 160))

        random_delay(0.8, 1.6)

        dialog = None
        try:
            dialog = page.locator('div[role="dialog"]').filter(has=search_input).first
            if dialog.count() == 0:
                dialog = None
        except Exception:
            dialog = None

        if not dialog:
            try:
                dialog = page.locator('div[role="dialog"]').last
            except Exception:
                return False

        result = _find_user_result_link(page, dialog, username, log)
        if not result:
            return False

        result.click()

        try:
            page.wait_for_load_state("domcontentloaded", timeout=15000)
        except Exception:
            pass

        try:
            page.wait_for_url(f"**/{username}/", timeout=15000)
        except Exception:
            try:
                page.wait_for_url(f"**/{username}/*", timeout=5000)
            except Exception:
                pass

        try:
            return f"/{username.lower()}/" in (page.url or "").lower()
        except Exception:
            return False
    except Exception as e:
        log(f"Поиск не сработал для @{username}: {e}")
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
        return False
