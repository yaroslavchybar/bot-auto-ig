import random
from typing import Callable, Iterable, Optional, Tuple

from python.actions.common import random_delay, safe_mouse_move
from python.browser.setup import create_browser_context


def unfollow_usernames(
    profile_name: str,
    proxy_string: str,
    usernames: Iterable[str],
    log: Callable[[str], None],
    should_stop: Optional[Callable[[], bool]] = None,
    delay_range: Tuple[int, int] = (10, 30),
    on_success: Optional[Callable[[str], None]] = None,
    page: Optional[object] = None,
    user_agent: Optional[str] = None,
):
    should_stop = should_stop or (lambda: False)
    delay_range = _normalize_delay_range(delay_range)
    targets = [username.strip() for username in usernames if username.strip()]
    if not targets:
        log('Нет юзернеймов для отписки.')
        return
    if page is not None:
        log('Использую существующую сессию для отписки...')
        _run_unfollow_logic(page, targets, log, should_stop, delay_range, on_success)
        return
    log(f'Запуск браузера для профиля: {profile_name}')
    with create_browser_context(
        profile_name=profile_name,
        proxy_string=proxy_string,
        user_agent=user_agent,
    ) as (_context, session_page):
        _run_unfollow_logic(session_page, targets, log, should_stop, delay_range, on_success)
    log('Сессия завершена.')


def _run_unfollow_logic(current_page, target_usernames, log, should_stop, delay_range, on_success) -> None:
    modal_open = False
    try:
        if not _ensure_instagram_open(current_page, log):
            return
        if not _open_own_profile(current_page, log):
            return
        random_delay(3, 5)
        modal_open = _open_following_modal(current_page, log)
        if not modal_open:
            return
        try:
            _process_unfollow_targets(current_page, target_usernames, log, should_stop, delay_range, on_success)
        finally:
            _close_following_modal(current_page, log)
    except Exception as exc:
        log(f'Критическая ошибка сессии: {exc}')


def _ensure_instagram_open(current_page, log) -> bool:
    try:
        if 'instagram.com' in (current_page.url or ''):
            return True
        current_page.goto('https://www.instagram.com', timeout=15000)
        return True
    except Exception as exc:
        log(f'Не удалось открыть Instagram перед началом отписки: {exc}')
        return False


def _open_own_profile(current_page, log) -> bool:
    log('Ищу ссылку на свой профиль...')
    if _click_profile_avatar(current_page, log):
        current_page.wait_for_load_state('domcontentloaded')
        return True
    try:
        current_page.locator('a[role="link"] >> text=Profile').click(force=True, timeout=5000)
        return True
    except Exception as exc:
        log(f'Не удалось перейти в профиль: {exc}')
        return False


def _click_profile_avatar(current_page, log) -> bool:
    try:
        profile_pic = current_page.locator('a[role="link"]').filter(has_text='Profile').locator('img').first
        profile_pic.wait_for(state='visible', timeout=10000)
        _move_to_avatar(current_page, profile_pic, log)
        log('Кликаю на аватар...')
        profile_pic.click(force=True)
        return True
    except Exception as exc:
        log(f'Не смог найти ссылку через аватар ({exc}). Пробую запасной вариант...')
        return False


def _move_to_avatar(current_page, profile_pic, log) -> None:
    box = profile_pic.bounding_box()
    if not box:
        return
    log('Двигаю курсор к аватару...')
    safe_mouse_move(current_page, box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    random_delay(0.5, 1.5)


def _open_following_modal(current_page, log) -> bool:
    log('Открываю список подписок...')
    try:
        current_page.click('a[href*="/following/"]', timeout=5000)
        random_delay(2, 4)
        modal = current_page.wait_for_selector('div[role="dialog"]', timeout=5000)
        if modal:
            return True
        log('Модальное окно не появилось.')
        return False
    except Exception:
        log("Не нашел кнопку 'Following'.")
        return False


def _process_unfollow_targets(current_page, target_usernames, log, should_stop, delay_range, on_success) -> None:
    for username in target_usernames:
        if should_stop():
            log('Остановка...')
            break
        _unfollow_single_target(current_page, username, log, on_success)
        if not _clear_search(current_page, log, username):
            log(f'Не удалось сбросить поиск после {username}. Прерываю batch, чтобы не продолжать с устаревшим состоянием.')
            break
        _wait_before_next_target(delay_range, log)


def _unfollow_single_target(current_page, username: str, log, on_success) -> None:
    log(f'Ищу {username}...')
    if not _search_username(current_page, username, log):
        return
    random_delay(2, 4)
    try:
        unfollow_btn = _user_row_button(current_page, username)
        if unfollow_btn.count() <= 0:
            log(f"Не нашел кнопку 'Following' для {username}. Возможно уже отписан.")
            return
        log(f'Нашел кнопку Following для {username}. Кликаю...')
        unfollow_btn.click()
        random_delay(1, 2)
        if _confirm_unfollow(current_page, username, log):
            if on_success:
                on_success(username)
            return
        log(f'Подтверждение не появилось или ошибка клика для {username}')
    except Exception as exc:
        log(f'Ошибка при обработке {username}: {exc}')


def _search_username(current_page, username: str, log) -> bool:
    try:
        current_page.fill('input[placeholder="Search"]', '')
        random_delay(0.5, 1.0)
        current_page.type('input[placeholder="Search"]', username, delay=100)
        return True
    except Exception:
        log('Не нашел поле поиска.')
        return False


def _user_row_button(current_page, username: str):
    normalized_username = username.strip().lstrip('@')
    user_row = current_page.locator(
        f'div[role="dialog"] a[href$="/{normalized_username}/"], div[role="dialog"] a[href$="/{normalized_username}"]'
    ).first.locator('xpath=ancestor::div[.//button][1]')
    return user_row.locator('button').filter(has_text='Following').first


def _confirm_unfollow(current_page, username: str, log) -> bool:
    try:
        confirm_btn = current_page.locator('button').filter(has_text='Unfollow').last
        confirm_btn.wait_for(state='visible', timeout=5000)
        log('Подтверждаю отписку...')
        confirm_btn.click()
        log(f'Отписался от {username}')
        return True
    except Exception:
        return False


def _clear_search(current_page, log, username: str) -> bool:
    previous_value = _search_input_value(current_page)
    try:
        current_page.fill('input[placeholder="Search"]', '')
    except Exception as exc:
        log(
            f"Не удалось очистить поиск после {username}: {exc}. "
            f'Текущее значение поиска: {previous_value!r}. Пробую запасную очистку.'
        )
        return _clear_search_with_keyboard(current_page, log, username, previous_value)

    current_value = _search_input_value(current_page)
    if current_value in ('', '<unavailable>'):
        return True

    log(
        f"Поле поиска после {username} осталось заполненным значением {current_value!r} "
        'после прямой очистки. Пробую запасную очистку.'
    )
    return _clear_search_with_keyboard(current_page, log, username, current_value)


def _clear_search_with_keyboard(current_page, log, username: str, previous_value: str) -> bool:
    try:
        search_input = current_page.locator('input[placeholder="Search"]').first
        search_input.click(timeout=3000)
        current_page.keyboard.press('Control+A')
        current_page.keyboard.press('Backspace')
    except Exception as exc:
        current_value = _search_input_value(current_page)
        log(
            f"Запасная очистка поиска после {username} не сработала: {exc}. "
            f'Текущее значение поиска: {current_value!r} (было {previous_value!r}).'
        )
        return False

    current_value = _search_input_value(current_page)
    if current_value in ('', '<unavailable>'):
        log(f'Очистил поиск запасным способом после {username}.')
        return True

    log(
        f"Запасная очистка поиска после {username} не очистила поле. "
        f'Текущее значение поиска: {current_value!r} (было {previous_value!r}).'
    )
    return False


def _search_input_value(current_page) -> str:
    try:
        return current_page.input_value('input[placeholder="Search"]', timeout=1000)
    except Exception:
        return '<unavailable>'


def _normalize_delay_range(delay_range: Tuple[int, int]) -> Tuple[int, int]:
    min_delay, max_delay = delay_range
    if max_delay < min_delay:
        min_delay, max_delay = max_delay, min_delay
    return min_delay, max_delay


def _wait_before_next_target(delay_range: Tuple[int, int], log) -> None:
    min_delay, max_delay = _normalize_delay_range(delay_range)
    wait_time = random.randint(min_delay, max_delay)
    log(f'Жду {wait_time}сек...')
    random_delay(wait_time, wait_time)


def _close_following_modal(current_page, log) -> None:
    log("Closing 'Following' modal...")
    try:
        close_btn = current_page.locator('button').filter(
            has=current_page.locator('svg[aria-label="Close"]')
        ).last
        if close_btn.count() > 0:
            close_btn.click()
            log('Closed modal.')
            return
        log('Close button not visible.')
    except Exception as exc:
        log(f'Failed to close modal: {exc}')
