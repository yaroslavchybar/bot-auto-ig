import random
from typing import Callable, Set

from python.actions.browsing.utils import human_scroll
from python.actions.common import random_delay
from python.actions.engagement.follow.common import _safe


def scroll_posts(
    page,
    log: Callable[[str], None],
    scroll_count: int | None = None,
    like_between: bool = False,
    like_probability: float = 0.6,
    max_likes: int | None = None,
    liked_posts: Set[str] | None = None,
    should_stop: Callable[[], bool] | None = None,
):
    _safe(
        log,
        'пролистывание постов',
        lambda: _scroll_posts_impl(page, log, scroll_count, like_between, like_probability, max_likes, liked_posts, should_stop),
    )


def _scroll_posts_impl(page, log, scroll_count, like_between, like_probability, max_likes, liked_posts, should_stop) -> None:
    log('Просматриваю посты профиля...')
    planned_scrolls = scroll_count if scroll_count is not None else random.randint(2, 5)
    likes_used = 0
    seen = liked_posts if liked_posts is not None else set()
    for index in range(planned_scrolls):
        if _stop_requested(should_stop, log):
            return
        human_scroll(page, should_stop=should_stop)
        if _stop_requested(should_stop, log):
            return
        log(f'Прокрутка {index + 1}/{planned_scrolls} (human-like)')
        random_delay(1.0, 2.5)
        likes_used = _maybe_like_between_scrolls(page, log, like_between, like_probability, max_likes, likes_used, seen, should_stop)
    _return_to_page_top(page, log)


def _stop_requested(should_stop, log) -> bool:
    if should_stop and should_stop():
        log('Остановка по запросу пользователя.')
        return True
    return False


def _maybe_like_between_scrolls(page, log, like_between: bool, like_probability: float, max_likes, likes_used: int, seen: Set[str], should_stop) -> int:
    if not like_between or (max_likes is not None and likes_used >= max_likes):
        return likes_used
    if random.random() >= like_probability:
        return likes_used
    before = len(seen)
    like_some_posts(page, log, max_posts=1, liked_posts=seen, should_stop=should_stop)
    return likes_used + max(0, len(seen) - before)


def _return_to_page_top(page, log) -> None:
    page.mouse.wheel(0, -800)
    log('Возвращаюсь немного вверх')
    random_delay(0.5, 1.0)
    current_scroll = _scroll_position(page)
    while current_scroll > 0:
        step = min(current_scroll, random.randint(400, 800))
        page.mouse.wheel(0, -step)
        random_delay(0.2, 0.6)
        next_scroll = _scroll_position(page)
        if next_scroll == current_scroll:
            break
        current_scroll = next_scroll
    _smooth_scroll_top_fallback(page)
    log('Вернулся в начало страницы')
    random_delay(0.5, 1.0)


def _scroll_position(page) -> int:
    try:
        return page.evaluate('() => window.scrollY') or 0
    except Exception:
        return 0


def _smooth_scroll_top_fallback(page) -> None:
    try:
        if page.evaluate('() => window.scrollY') > 10:
            page.evaluate("() => window.scrollTo({ top: 0, behavior: 'smooth' })")
            random_delay(0.5, 1.0)
            return
    except Exception:
        pass
    try:
        page.evaluate('() => window.scrollTo(0, 0)')
    except Exception:
        pass


def like_some_posts(
    page,
    log: Callable[[str], None],
    max_posts: int = 1,
    liked_posts: Set[str] | None = None,
    should_stop: Callable[[], bool] | None = None,
):
    if max_posts <= 0:
        log('Пропускаю лайки (настроено 0).')
        return
    liked = liked_posts if liked_posts is not None else set()
    _safe(log, 'лайки постов', lambda: _like_some_posts_impl(page, log, max_posts, liked, should_stop))


def _like_some_posts_impl(page, log, max_posts: int, liked: Set[str], should_stop) -> None:
    post_links = _collect_post_links(page, log, max_posts, liked)
    if not post_links:
        log('Посты не найдены для лайка')
        return
    available_posts = [link for link in post_links if _is_visible(page, link)]
    if not available_posts:
        log('Нет видимых постов для лайка')
        return
    selected_posts = random.sample(available_posts, min(max_posts, len(available_posts)))
    log(f'Выбрано {len(selected_posts)} случайных постов из {len(available_posts)} видимых')
    processed = 0
    for link in selected_posts:
        if _stop_requested(should_stop, log):
            return
        if _like_single_post(page, link, log, liked):
            processed += 1
    log(f'Обработано {processed} постов')


def _collect_post_links(page, log, max_posts: int, liked: Set[str]):
    post_selectors = [
        "a[href*='/reel/']",
        "a[href*='/p/']",
        'article a',
        "div[role='button'] a",
        'article div a',
        "[data-testid*='post'] a",
        'a:has(video)',
        "a[role='link']:has(svg[aria-label='Clip'])",
        "a[role='link']:has(svg[aria-label='Video'])",
    ]
    post_links = []
    seen_hrefs = set(liked)
    for selector in post_selectors:
        added = _collect_selector_links(page, selector, seen_hrefs, post_links)
        if added:
            log(f'Найдено {added} постов с селектором: {selector}')
    return post_links[: max_posts * 4] if max_posts else post_links


def _collect_selector_links(page, selector: str, seen_hrefs: Set[str], post_links: list) -> int:
    links = page.query_selector_all(selector) or []
    added = 0
    for link in links:
        href = link.get_attribute('href') or ''
        if not href or href in seen_hrefs:
            continue
        seen_hrefs.add(href)
        post_links.append(link)
        added += 1
    return added


def _is_visible(page, element) -> bool:
    try:
        return page.evaluate(
            """
            (element) => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return style.display !== 'none' &&
                       style.visibility !== 'hidden' &&
                       rect.width > 0 &&
                       rect.height > 0;
            }
            """,
            element,
        )
    except Exception:
        return False


def _like_single_post(page, link, log, liked: Set[str]) -> bool:
    href = link.get_attribute('href') or ''
    if href and href in liked:
        log('Пропускаю уже лайкнутый пост')
        return False
    if not _is_visible(page, link):
        return False
    try:
        log('Открываю пост для лайка...')
        link.click()
        random_delay(1.5, 2.5)
        did_like = _click_like_button(page, log)
        if did_like and href:
            liked.add(href)
        _close_post_modal(page, log)
        random_delay(1.0, 2.0)
        return did_like
    except Exception as err:
        log(f'Пропускаю пост: {err}')
        try:
            page.keyboard.press('Escape')
        except Exception:
            pass
        random_delay(0.5, 1.0)
        return False


def _click_like_button(page, log) -> bool:
    like_btn = (
        page.query_selector('svg[aria-label="Like"]')
        or page.query_selector('button[aria-label="Like"]')
        or page.query_selector('[role="button"][aria-label*="Like"]')
        or page.query_selector('button[data-testid*="like"]')
        or page.query_selector('[aria-label*="like" i]')
    )
    if not like_btn:
        log('Кнопка лайка не найдена')
        return False
    if not _is_visible(page, like_btn):
        log('Кнопка лайка не видна')
        return False
    like_btn.click()
    log('Лайк поставлен')
    random_delay(0.5, 1.0)
    return True


def _close_post_modal(page, log) -> None:
    close_btn = (
        page.query_selector('button[aria-label="Close"]')
        or page.query_selector('svg[aria-label="Close"]')
        or page.query_selector('[role="button"][aria-label*="Close"]')
        or page.query_selector('button[aria-label*="close" i]')
        or page.query_selector('div[role="button"] svg[aria-label="Close"]')
    )
    if close_btn:
        try:
            close_btn.click()
            log('Пост закрыт кнопкой')
            return
        except Exception as close_err:
            log(f'Не удалось закрыть кнопкой: {close_err}')
    try:
        page.keyboard.press('Escape')
        log('Пост закрыт клавишей Escape')
    except Exception:
        log('Не удалось закрыть пост')
