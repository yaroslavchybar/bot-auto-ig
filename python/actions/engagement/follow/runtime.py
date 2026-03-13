from typing import Callable, Dict, Iterable, List, Optional, Tuple

from python.actions.common import random_delay
from python.actions.engagement.follow.controls import find_follow_control, wait_for_follow_state
from python.actions.engagement.follow.filter import should_skip_by_following
from python.actions.engagement.follow.interactions import pre_follow_interactions
from python.actions.engagement.follow.utils import call_on_success, clean_usernames, open_profile_via_search_first
from python.browser.setup import create_browser_context


def follow_usernames(
    profile_name: str,
    proxy_string: str,
    usernames: Iterable[str],
    log: Callable[[str], None],
    should_stop: Optional[Callable[[], bool]] = None,
    following_limit: Optional[int] = None,
    on_success: Optional[Callable[[str], None]] = None,
    on_skip: Optional[Callable[[str], None]] = None,
    interactions_config: Optional[Dict[str, Tuple[int, int]]] = None,
    page: Optional[object] = None,
    user_agent: Optional[str] = None,
    delay_range: Tuple[int, int] = (10, 20),
):
    should_stop = should_stop or (lambda: False)
    clean_usernames_list = clean_usernames(usernames)
    if not clean_usernames_list:
        log('Нет валидных юзернеймов для подписки.')
        return
    context = _follow_context(should_stop, following_limit, on_success, on_skip, interactions_config, delay_range)
    if page:
        log(f'Использую существующую сессию для подписки ({len(clean_usernames_list)} чел.)')
        _run_follow_logic(page, clean_usernames_list, log, context)
        return
    log(f'Стартую Camoufox для профиля {profile_name}')
    with create_browser_context(
        profile_name=profile_name,
        proxy_string=proxy_string,
        user_agent=user_agent,
    ) as (_context, session_page):
        _run_follow_logic(session_page, clean_usernames_list, log, context)
    log('Сессия завершена.')


def _follow_context(should_stop, following_limit, on_success, on_skip, interactions_config, delay_range: Tuple[int, int]) -> Dict:
    interactions = interactions_config or {}
    delay_min, delay_max = delay_range
    if delay_max < delay_min:
        delay_min, delay_max = delay_max, delay_min
    return {
        'should_stop': should_stop,
        'following_limit': following_limit,
        'on_success': on_success,
        'on_skip': on_skip,
        'highlights_range': interactions.get('highlights_range', (2, 4)),
        'likes_percentage': interactions.get('likes_percentage', 0),
        'scroll_percentage': interactions.get('scroll_percentage', 0),
        'delay_range': (delay_min, delay_max),
    }


def _run_follow_logic(current_page, usernames: List[str], log, context: Dict) -> None:
    if not _ensure_instagram_open(current_page, log):
        return
    for username in usernames:
        if context['should_stop']():
            log('Остановка по запросу пользователя.')
            break
        _follow_single_username(current_page, username, log, context)
        random_delay(*context['delay_range'])


def _ensure_instagram_open(current_page, log) -> bool:
    try:
        if current_page.url != 'about:blank':
            return True
        current_page.goto('https://www.instagram.com', timeout=15000)
        return True
    except Exception:
        log('Не удалось открыть Instagram перед началом подписки.')
        return False


def _follow_single_username(current_page, username: str, log, context: Dict) -> None:
    try:
        _open_profile(current_page, username, log)
        if _skip_if_following_limit(current_page, username, log, context):
            return
        _run_pre_follow_interactions(current_page, log, context)
        if context['should_stop']():
            log('Остановка по запросу пользователя.')
            return
        _complete_follow_action(current_page, username, log, context)
    except Exception as exc:
        log(f'Ошибка при обработке @{username}: {exc}')
        random_delay(2, 5)


def _open_profile(current_page, username: str, log) -> None:
    log(f'Открываю @{username}')
    opened = open_profile_via_search_first(current_page, username, log)
    if not opened:
        current_page.goto(
            f'https://www.instagram.com/{username}/',
            timeout=20000,
            wait_until='domcontentloaded',
        )
    random_delay(1, 2)


def _skip_if_following_limit(current_page, username: str, log, context: Dict) -> bool:
    if not should_skip_by_following(current_page, username, context['following_limit'], log):
        return False
    callback = context['on_skip']
    if not callback:
        return True
    try:
        callback(username)
    except Exception as callback_err:
        log(f'Не удалось обновить статус пропуска @{username}: {callback_err}')
    return True


def _run_pre_follow_interactions(current_page, log, context: Dict) -> None:
    pre_follow_interactions(
        current_page,
        log,
        highlights_range=context['highlights_range'],
        likes_percentage=context['likes_percentage'],
        scroll_percentage=context['scroll_percentage'],
        should_stop=context['should_stop'],
    )


def _complete_follow_action(current_page, username: str, log, context: Dict) -> None:
    state, button = find_follow_control(current_page)
    if state in ('requested', 'following'):
        log(f'Уже подписаны/запрошено для @{username} ({state}).')
        call_on_success(context['on_success'], username, log)
        return
    if not button:
        log(f'Не нашел кнопку Follow для @{username}')
        return
    log(f'Нажимаю Follow на @{username}...')
    button.click()
    random_delay(1, 2)
    state_after = wait_for_follow_state(current_page, timeout_ms=8000)
    if state_after in ('requested', 'following'):
        log(f'Успешная подписка на @{username}')
        call_on_success(context['on_success'], username, log)
        return
    log(f'Статус не изменился после клика для @{username} ({state_after})')
