import random
from typing import Callable, Set

from python.automation.actions import random_delay
from python.automation.Follow.common import _safe
from python.automation.scrolling.utils import human_scroll, human_mouse_move


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
    """Scroll profile posts grid to load more content (optionally liking between scrolls)."""

    def _impl():
        log("📜 Просматриваю посты профиля...")
        planned_scrolls = scroll_count if scroll_count is not None else random.randint(2, 5)
        likes_used = 0
        seen = liked_posts if liked_posts is not None else set()
        for i in range(planned_scrolls):
            if should_stop and should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                return

            # Human-like mouse move before scrolling to simulate attention
            human_mouse_move(page)
            if should_stop and should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                return
            human_scroll(page, should_stop=should_stop)
            if should_stop and should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                return
            log(f"📜 Прокрутка {i + 1}/{planned_scrolls} (human-like)")
            random_delay(1.0, 2.5)  # Similar pacing to feed scrolling

            if like_between:
                if max_likes is None or likes_used < max_likes:
                    if random.random() < like_probability:
                        before = len(seen)
                        like_some_posts(page, log, max_posts=1, liked_posts=seen, should_stop=should_stop)
                        likes_used += max(0, len(seen) - before)

        # Scroll back up a bit to show some posts
        page.mouse.wheel(0, -800)
        log("📜 Возвращаюсь немного вверх")
        random_delay(0.5, 1.0)

        # Return to the top with human-like upward scrolling to avoid abrupt jumps.
        try:
            current_scroll = page.evaluate("() => window.scrollY") or 0
        except Exception:
            current_scroll = 0

        if current_scroll > 0:
            while current_scroll > 0:
                step = min(current_scroll, random.randint(400, 800))
                page.mouse.wheel(0, -step)
                random_delay(0.2, 0.6)
                try:
                    current_scroll = page.evaluate("() => window.scrollY") or 0
                except Exception:
                    break

        # Fallback to instant scroll if still not near the top.
        try:
            if page.evaluate("() => window.scrollY") > 10:
                page.evaluate("() => window.scrollTo({ top: 0, behavior: 'smooth' })")
                random_delay(0.5, 1.0)
        except Exception:
            try:
                page.evaluate("() => window.scrollTo(0, 0)")
            except Exception:
                pass

        log("⤴️ Вернулся в начало страницы")
        random_delay(0.5, 1.0)

    _safe(log, "пролистывание постов", _impl)


def like_some_posts(
    page,
    log: Callable[[str], None],
    max_posts: int = 1,
    liked_posts: Set[str] | None = None,
    should_stop: Callable[[], bool] | None = None,
):
    """Open random grid posts (up to max_posts) and like if not yet liked."""
    if max_posts <= 0:
        log("ℹ️ Пропускаю лайки (настроено 0).")
        return

    liked = liked_posts if liked_posts is not None else set()

    def _impl():
        # Try multiple selectors for finding post links (photos + reels), dedup by href
        post_selectors = [
            "a[href*='/reel/']",  # Reels (video)
            "a[href*='/p/']",  # Direct photo posts
            "article a",  # Article links
            "div[role='button'] a",  # Posts in grid
            "article div a",  # Alternative post links
            "[data-testid*='post'] a",  # Data test IDs
            "a:has(video)",  # any anchor containing a video tag
            "a[role='link']:has(svg[aria-label='Clip'])",  # clip/reel indicator
            "a[role='link']:has(svg[aria-label='Video'])",  # video indicator
        ]

        post_links = []
        seen_hrefs = set(liked)  # avoid dup + already liked
        for selector in post_selectors:
            links = page.query_selector_all(selector) or []
            added = 0
            for link in links:
                href = link.get_attribute("href") or ""
                if not href or href in seen_hrefs:
                    continue
                seen_hrefs.add(href)
                post_links.append(link)
                added += 1
            if added:
                log(f"📸 Найдено {added} постов с селектором: {selector}")

        if max_posts:
            post_links = post_links[: max_posts * 4]  # keep a small buffer, but include reels

        if not post_links:
            log("ℹ️ Посты не найдены для лайка")
            return

        # Shuffle posts to select random ones instead of sequential
        available_posts = [link for link in post_links if page.evaluate("""
            (element) => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return style.display !== 'none' &&
                       style.visibility !== 'hidden' &&
                       rect.width > 0 &&
                       rect.height > 0;
            }
        """, link)]

        if not available_posts:
            log("ℹ️ Нет видимых постов для лайка")
            return

        # Select random posts instead of sequential
        selected_posts = random.sample(available_posts, min(max_posts, len(available_posts)))
        log(f"🎲 Выбрано {len(selected_posts)} случайных постов из {len(available_posts)} видимых")

        count = 0
        for link in selected_posts:
            if should_stop and should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                return

            if count >= max_posts:
                break
            try:
                href = link.get_attribute("href") or ""
                if href and href in liked:
                    log("ℹ️ Пропускаю уже лайкнутый пост")
                    continue

                # Check if link is visible and clickable
                is_visible = page.evaluate("""
                    (element) => {
                        const rect = element.getBoundingClientRect();
                        const style = window.getComputedStyle(element);
                        return style.display !== 'none' &&
                               style.visibility !== 'hidden' &&
                               rect.width > 0 &&
                               rect.height > 0;
                    }
                """, link)

                if not is_visible:
                    continue

                log(f"❤️ Открываю пост {count + 1} для лайка...")
                link.click()
                random_delay(1.5, 2.5)

                # Try multiple selectors for like button to handle different layouts
                like_btn = (page.query_selector('svg[aria-label="Like"]') or
                           page.query_selector('button[aria-label="Like"]') or
                           page.query_selector('[role="button"][aria-label*="Like"]') or
                           page.query_selector('button[data-testid*="like"]') or
                           page.query_selector('[aria-label*="like" i]'))

                if like_btn:
                    # Check if like button is visible
                    like_visible = page.evaluate("""
                        (element) => {
                            const rect = element.getBoundingClientRect();
                            const style = window.getComputedStyle(element);
                            return style.display !== 'none' &&
                                   style.visibility !== 'hidden' &&
                                   rect.width > 0 &&
                                   rect.height > 0;
                        }
                    """, like_btn)

                    if like_visible:
                        like_btn.click()
                        log("👍 Лайк поставлен")
                        random_delay(0.5, 1.0)
                        if href:
                            liked.add(href)
                    else:
                        log("ℹ️ Кнопка лайка не видна")
                else:
                    log("ℹ️ Кнопка лайка не найдена")

                # Close modal - try close button first, then Escape as fallback
                close_btn = (page.query_selector('button[aria-label="Close"]') or
                           page.query_selector('svg[aria-label="Close"]') or
                           page.query_selector('[role="button"][aria-label*="Close"]') or
                           page.query_selector('button[aria-label*="close" i]') or
                           page.query_selector('div[role="button"] svg[aria-label="Close"]'))

                if close_btn:
                    try:
                        close_btn.click()
                        log("❌ Пост закрыт кнопкой")
                    except Exception as close_err:
                        log(f"ℹ️ Не удалось закрыть кнопкой: {close_err}")
                        try:
                            page.keyboard.press("Escape")
                            log("❌ Пост закрыт клавишей Escape")
                        except:
                            log("ℹ️ Не удалось закрыть пост")
                else:
                    # Fallback: try Escape key
                    try:
                        page.keyboard.press("Escape")
                        log("❌ Пост закрыт клавишей Escape")
                    except:
                        log("ℹ️ Не удалось закрыть пост")

                random_delay(1.0, 2.0)
                count += 1
            except Exception as err:
                log(f"ℹ️ Пропускаю пост: {err}")
                try:
                    page.keyboard.press("Escape")
                except:
                    pass
                random_delay(0.5, 1.0)

        log(f"✅ Обработано {count} постов")

    _safe(log, "лайки постов", _impl)

