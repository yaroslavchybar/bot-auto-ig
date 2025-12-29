import random
from typing import Callable, Set

from python.automation.actions import random_delay
from python.automation.Follow.common import _safe, _normalize_range
from python.automation.Follow.filter import get_posts_count
from python.automation.Follow.highlights import watch_highlights
from python.automation.Follow.posts import like_some_posts, scroll_posts


def pre_follow_interactions(
    page,
    log: Callable[[str], None],
    highlights_range=(2, 4),
    likes_percentage: int = 0,
    scroll_percentage: int = 0,
    should_stop: Callable[[], bool] | None = None,
):
    """Run lightweight interactions before follow."""
    highlights_min, highlights_max = _normalize_range(highlights_range, (2, 4))

    highlights_to_watch = random.randint(highlights_min, highlights_max) if highlights_max > 0 else 0
    likes_to_put = 0
    
    # Calculate scroll count (default random if no percentage)
    scroll_count = random.randint(2, 5)

    # If percentages are enabled, try to get post count
    if likes_percentage > 0 or scroll_percentage > 0:
        try:
            page.wait_for_selector('span:has-text("posts"), div:has-text("posts"), a:has-text("posts"), span:has-text("публикац"), div:has-text("публикац"), a:has-text("публикац")', timeout=4000)
        except Exception:
            pass
        total_posts = get_posts_count(page, log)
        if total_posts:
            effective_posts = min(total_posts, 10)
            log(f"Найдено постов: {total_posts}")
            if effective_posts < total_posts:
                log(f"Для расчётов использую максимум: {effective_posts}")
            
            if likes_percentage > 0:
                likes_to_put = int(round(effective_posts * (likes_percentage / 100.0)))
                log(f"Лайки по проценту ({likes_percentage}%): {likes_to_put}")
                
            if scroll_percentage > 0:
                posts_to_scroll = int(round(effective_posts * (scroll_percentage / 100.0)))
                calculated_scrolls = max(1, int(posts_to_scroll / 5))
                scroll_count = calculated_scrolls
                log(f"Скролл по проценту ({scroll_percentage}% от {effective_posts} постов): {scroll_count} скроллов")
        else:
            log("Не удалось определить число постов для процентного расчета. Использую случайные значения.")

    liked_posts: Set[str] = set()

    def do_highlights():
        if should_stop and should_stop(): return
        watch_highlights(page, log, highlights_to_watch=highlights_to_watch, should_stop=should_stop)

    def do_scroll():
        if should_stop and should_stop(): return
        scroll_posts(page, log, scroll_count=scroll_count, liked_posts=liked_posts, should_stop=should_stop)
        random_delay(1.0, 2.0)  # give posts time to settle

    def do_scroll_and_likes():
        if should_stop and should_stop(): return
        # Combine scroll and likes in one flow to mimic organic browsing.
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

    actions = []

    if highlights_to_watch > 0:
        actions.append(do_highlights)
    else:
        log("Пропускаю хайлайты (настроено 0).")

    # Scroll action is always available to randomize with likes/highlights.
    if likes_to_put > 0:
        actions.append(do_scroll_and_likes)
    else:
        actions.append(do_scroll)
        log("Пропускаю лайки (настроено 0).")

    random.shuffle(actions)
    for action in actions:
        if should_stop and should_stop():
            log("Остановка по запросу пользователя.")
            break
        action()
