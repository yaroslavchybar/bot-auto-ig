import random
from typing import Callable, Set

from python.actions.common import random_delay
from python.actions.engagement.follow.common import _normalize_range
from python.actions.engagement.follow.filter import get_posts_count
from python.actions.engagement.follow.highlights import watch_highlights
from python.actions.engagement.follow.posts import like_some_posts, scroll_posts


def pre_follow_interactions(
    page,
    log: Callable[[str], None],
    highlights_range=(2, 4),
    likes_percentage: int = 0,
    scroll_percentage: int = 0,
    should_stop: Callable[[], bool] | None = None,
):
    """Run lightweight interactions before follow."""
    highlights_to_watch = _planned_highlights(highlights_range)
    likes_to_put, scroll_count = _interaction_counts(page, log, likes_percentage, scroll_percentage)
    liked_posts: Set[str] = set()
    actions = _interaction_actions(page, log, highlights_to_watch, likes_to_put, scroll_count, liked_posts, should_stop)
    random.shuffle(actions)
    for action in actions:
        if should_stop and should_stop():
            log('Остановка по запросу пользователя.')
            break
        action()


def _planned_highlights(highlights_range) -> int:
    highlights_min, highlights_max = _normalize_range(highlights_range, (2, 4))
    return random.randint(highlights_min, highlights_max) if highlights_max > 0 else 0


def _interaction_counts(page, log, likes_percentage: int, scroll_percentage: int) -> tuple[int, int]:
    likes_to_put = 0
    scroll_count = random.randint(2, 5)
    if likes_percentage <= 0 and scroll_percentage <= 0:
        return likes_to_put, scroll_count
    _wait_for_posts_counter(page)
    total_posts = get_posts_count(page, log)
    if not total_posts:
        log('Не удалось определить число постов для процентного расчета. Использую случайные значения.')
        return likes_to_put, scroll_count
    effective_posts = min(total_posts, 10)
    log(f'Найдено постов: {total_posts}')
    if effective_posts < total_posts:
        log(f'Для расчётов использую максимум: {effective_posts}')
    return _count_from_percentages(log, effective_posts, likes_percentage, scroll_percentage, scroll_count)


def _wait_for_posts_counter(page) -> None:
    try:
        page.wait_for_selector(
            'span:has-text("posts"), div:has-text("posts"), a:has-text("posts"), '
            'span:has-text("публикац"), div:has-text("публикац"), a:has-text("публикац")',
            timeout=4000,
        )
    except Exception:
        pass


def _count_from_percentages(log, effective_posts: int, likes_percentage: int, scroll_percentage: int, default_scroll_count: int):
    likes_to_put = 0
    scroll_count = default_scroll_count
    if likes_percentage > 0:
        likes_to_put = int(round(effective_posts * (likes_percentage / 100.0)))
        log(f'Лайки по проценту ({likes_percentage}%): {likes_to_put}')
    if scroll_percentage > 0:
        posts_to_scroll = int(round(effective_posts * (scroll_percentage / 100.0)))
        scroll_count = max(1, int(posts_to_scroll / 5))
        log(f'Скролл по проценту ({scroll_percentage}% от {effective_posts} постов): {scroll_count} скроллов')
    return likes_to_put, scroll_count


def _interaction_actions(page, log, highlights_to_watch: int, likes_to_put: int, scroll_count: int, liked_posts: Set[str], should_stop):
    actions = []
    if highlights_to_watch > 0:
        actions.append(lambda: _run_highlights(page, log, highlights_to_watch, should_stop))
    else:
        log('Пропускаю хайлайты (настроено 0).')
    if likes_to_put > 0:
        actions.append(lambda: _run_scroll_with_likes(page, log, scroll_count, likes_to_put, liked_posts, should_stop))
    else:
        actions.append(lambda: _run_scroll(page, log, scroll_count, liked_posts, should_stop))
        log('Пропускаю лайки (настроено 0).')
    return actions


def _run_highlights(page, log, highlights_to_watch: int, should_stop) -> None:
    if should_stop and should_stop():
        return
    watch_highlights(page, log, highlights_to_watch=highlights_to_watch, should_stop=should_stop)


def _run_scroll(page, log, scroll_count: int, liked_posts: Set[str], should_stop) -> None:
    if should_stop and should_stop():
        return
    scroll_posts(page, log, scroll_count=scroll_count, liked_posts=liked_posts, should_stop=should_stop)
    random_delay(1.0, 2.0)


def _run_scroll_with_likes(page, log, scroll_count: int, likes_to_put: int, liked_posts: Set[str], should_stop) -> None:
    if should_stop and should_stop():
        return
    scroll_posts(
        page,
        log,
        scroll_count=scroll_count,
        like_between=True,
        like_probability=0.65,
        max_likes=likes_to_put,
        liked_posts=liked_posts,
        should_stop=should_stop,
    )
    random_delay(1.0, 2.0)
