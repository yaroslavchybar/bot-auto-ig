import random
from typing import Callable, Set

from automation.actions import random_delay
from automation.Follow.common import _safe, _normalize_range
from automation.Follow.highlights import watch_highlights
from automation.Follow.posts import like_some_posts, scroll_posts


def pre_follow_interactions(
    page,
    log: Callable[[str], None],
    highlights_range=(2, 4),
    likes_range=(1, 1),
    should_stop: Callable[[], bool] | None = None,
):
    """Run lightweight interactions before follow."""
    highlights_min, highlights_max = _normalize_range(highlights_range, (2, 4))
    likes_min, likes_max = _normalize_range(likes_range, (1, 1))

    highlights_to_watch = random.randint(highlights_min, highlights_max) if highlights_max > 0 else 0
    likes_to_put = random.randint(likes_min, likes_max) if likes_max > 0 else 0
    liked_posts: Set[str] = set()

    def do_highlights():
        if should_stop and should_stop(): return
        watch_highlights(page, log, highlights_to_watch=highlights_to_watch, should_stop=should_stop)

    def do_scroll():
        if should_stop and should_stop(): return
        scroll_posts(page, log, liked_posts=liked_posts, should_stop=should_stop)
        random_delay(1.0, 2.0)  # give posts time to settle

    def do_scroll_and_likes():
        if should_stop and should_stop(): return
        # Combine scroll and likes in one flow to mimic organic browsing.
        scroll_posts(
            page,
            log,
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
        log("ℹ️ Пропускаю хайлайты (настроено 0).")

    # Scroll action is always available to randomize with likes/highlights.
    if likes_to_put > 0:
        actions.append(do_scroll_and_likes)
    else:
        actions.append(do_scroll)
        log("ℹ️ Пропускаю лайки (настроено 0).")

    random.shuffle(actions)
    for action in actions:
        if should_stop and should_stop():
            log("⏹️ Остановка по запросу пользователя.")
            break
        action()

