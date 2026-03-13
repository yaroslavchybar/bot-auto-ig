import random
import time
from typing import Callable, Iterable, List, Optional

from python.actions.common import random_delay
from python.core.selectors import SEARCH_BUTTON


def clean_usernames(usernames: Iterable[str]) -> List[str]:
    clean: List[str] = []
    for username in usernames:
        if not username:
            continue
        name = username.strip().lstrip('@')
        if name:
            clean.append(name)
    return clean


def call_on_success(on_success: Optional[Callable[[str], None]], username: str, log: Callable[[str], None]):
    if not on_success:
        return
    try:
        on_success(username)
    except Exception as callback_err:
        log(f'Не удалось обновить статус @{username}: {callback_err}')


def _pick_visible(locator_candidates, timeout_ms: int = 3500):
    deadline = time.time() + (timeout_ms / 1000.0)
    while time.time() < deadline:
        candidate = _visible_locator(locator_candidates)
        if candidate:
            return candidate
        time.sleep(0.15)
    return None


def _visible_locator(locator_candidates):
    for locator in locator_candidates:
        try:
            if not locator:
                continue
            candidate = locator.first
            if candidate.count() > 0 and candidate.is_visible(timeout=250):
                return candidate
        except Exception:
            continue
    return None


def _find_search_input(page):
    return _pick_visible(
        [
            page.locator('input[aria-label="Search input"]'),
            page.locator('input[placeholder="Search"]'),
            page.locator('input[aria-label*="Search" i]'),
            page.locator('input[type="text"]'),
        ],
        timeout_ms=4500,
    )


def _find_user_result_link(page, dialog, username: str, log: Callable[[str], None]):
    username_lower = (username or '').strip().lstrip('@').lower()
    if not username_lower:
        return None
    time.sleep(1.5)
    links = _search_result_links(page, dialog, log)
    if not links:
        log(f'Профиль @{username} не найден в результатах поиска')
        return None
    for strategy in (_match_span_text, _match_link_headline, _match_dialog_href, _match_page_href, _match_list_href):
        result = strategy(page, dialog, links, username_lower, log)
        if result:
            return result
    log(f'Профиль @{username} не найден в результатах поиска')
    return None


def _search_result_links(page, dialog, log) -> List:
    links = _dialog_links(dialog, log)
    if links:
        return links
    try:
        links = page.locator('a[role="link"]').all()
        log(f'Найдено {len(links)} ссылок на странице')
        return links
    except Exception:
        return []


def _dialog_links(dialog, log) -> List:
    try:
        links = dialog.locator('a[role="link"]').all()
        log(f'Найдено {len(links)} ссылок в диалоге поиска')
        return links
    except Exception as exc:
        log(f'Ошибка поиска ссылок в диалоге: {exc}')
        return []


def _match_span_text(page, dialog, links, username_lower: str, log):
    for link in links:
        try:
            spans = link.locator('span').all()
        except Exception:
            continue
        for span in spans:
            try:
                span_text = (span.inner_text() or '').strip().lstrip('@').lower()
                if span_text == username_lower and link.is_visible(timeout=500):
                    log(f'Найден профиль по тексту span: {username_lower}')
                    return link
            except Exception:
                continue
    return None


def _match_link_headline(page, dialog, links, username_lower: str, log):
    for link in links:
        try:
            lines = (link.inner_text() or '').strip().splitlines()
            head = (lines[0] if lines else '').strip().lstrip('@').lower()
            if head == username_lower and link.is_visible(timeout=500):
                log(f'Найден профиль по первой строке: {username_lower}')
                return link
        except Exception:
            continue
    return None


def _match_dialog_href(page, dialog, links, username_lower: str, log):
    return _direct_href_match(dialog, username_lower, 'в диалоге', log)


def _match_page_href(page, dialog, links, username_lower: str, log):
    return _direct_href_match(page, username_lower, 'на странице', log)


def _direct_href_match(scope, username_lower: str, label: str, log):
    try:
        direct = scope.locator(f'a[href="/{username_lower}/"]').first
        if direct.count() > 0 and direct.is_visible(timeout=500):
            log(f'Найден профиль по href {label}: {username_lower}')
            return direct
    except Exception:
        return None
    return None


def _match_list_href(page, dialog, links, username_lower: str, log):
    for link in links:
        try:
            href = (link.get_attribute('href') or '').strip().lower()
            if href == f'/{username_lower}/' and link.is_visible(timeout=500):
                log(f'Найден профиль по href в списке: {username_lower}')
                return link
        except Exception:
            continue
    return None


def open_profile_via_search_first(page, username: str, log: Callable[[str], None]) -> bool:
    username = (username or '').strip().lstrip('@')
    if not username:
        return False
    _ensure_instagram_open(page)
    try:
        search_btn = SEARCH_BUTTON.find(page)
        if not search_btn:
            return False
        _prepare_search_button(search_btn)
        search_btn.click()
        random_delay(0.6, 1.2)
        search_input = _find_search_input(page)
        if not search_input:
            return False
        _clear_and_type_search(page, search_input, username)
        dialog = _search_dialog(page, search_input)
        if not dialog:
            return False
        result = _find_user_result_link(page, dialog, username, log)
        if not result:
            return False
        result.click()
        return _wait_for_profile_url(page, username)
    except Exception as exc:
        log(f'Поиск не сработал для @{username}: {exc}')
        try:
            page.keyboard.press('Escape')
        except Exception:
            pass
        return False


def _ensure_instagram_open(page) -> None:
    try:
        if page.url != 'about:blank':
            return
        page.goto('https://www.instagram.com/', timeout=15000)
        random_delay(1.0, 2.0)
    except Exception:
        pass


def _prepare_search_button(search_btn) -> None:
    try:
        search_btn.scroll_into_view_if_needed()
    except Exception:
        pass


def _clear_and_type_search(page, search_input, username: str) -> None:
    try:
        search_input.click()
    except Exception:
        pass
    try:
        search_input.fill('')
    except Exception:
        _clear_input_with_keyboard(page)
    random_delay(0.15, 0.35)
    try:
        search_input.type(username, delay=random.randint(80, 160))
    except Exception:
        page.keyboard.type(username, delay=random.randint(80, 160))
    random_delay(0.8, 1.6)


def _clear_input_with_keyboard(page) -> None:
    try:
        page.keyboard.press('Control+A')
        page.keyboard.press('Backspace')
    except Exception:
        pass


def _search_dialog(page, search_input):
    try:
        dialog = page.locator('div[role="dialog"]').filter(has=search_input).first
        if dialog.count() > 0:
            return dialog
    except Exception:
        pass
    try:
        return page.locator('div[role="dialog"]').last
    except Exception:
        return None


def _wait_for_profile_url(page, username: str) -> bool:
    try:
        page.wait_for_load_state('domcontentloaded', timeout=15000)
    except Exception:
        pass
    for pattern in (f'**/{username}/', f'**/{username}/*'):
        try:
            page.wait_for_url(pattern, timeout=15000 if pattern.endswith('/') else 5000)
            break
        except Exception:
            continue
    try:
        return f'/{username.lower()}/' in (page.url or '').lower()
    except Exception:
        return False
