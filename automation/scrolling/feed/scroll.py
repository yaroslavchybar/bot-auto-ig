import random
import time
from automation.actions import random_delay
from automation.scrolling.utils import human_scroll, human_mouse_move
from .likes import perform_like
from .following import perform_follow
from .carousel import watch_carousel
from .stories import watch_stories


def _navigate_home(page):
    """Ensure we are on the Instagram home feed and clear modals."""
    if "instagram.com" not in page.url:
        page.goto("https://www.instagram.com/", timeout=30000)
        random_delay(3, 5)

        # Handle "Turn on Notifications" or similar modals if they appear
        try:
            not_now = page.query_selector('button:has-text("Not Now")')
            if not_now:
                not_now.click()
                random_delay(1, 2)
        except Exception:
            pass


def _queue_actions(page, post, actions_config):
    """Prepare action callables for the given post based on configured chances."""
    actions_to_perform = []

    if random.randint(0, 100) < actions_config.get("like_chance", 0):
        actions_to_perform.append(("like", lambda p=post: perform_like(page, p)))

    if random.randint(0, 100) < actions_config.get("follow_chance", 0):
        actions_to_perform.append(("follow", lambda p=post: perform_follow(page, p)))

    random.shuffle(actions_to_perform)
    return actions_to_perform


def _pick_visible_post(page, posts):
    """
    Pick a post that is currently in (or near) the viewport, preferring the one
    closest to the bottom to avoid jumping back to earlier posts.
    """
    try:
        viewport_h = page.evaluate("() => window.innerHeight") or 0
    except Exception:
        viewport_h = 0

    candidates = []
    for p in posts:
        try:
            box = p.bounding_box()
            if not box:
                continue
            center_y = box["y"] + (box["height"] / 2)
            # Keep posts that are on screen (with small tolerance below the fold)
            if 0 <= center_y <= viewport_h * 1.1:
                candidates.append((center_y, p))
        except Exception:
            continue

    if not candidates:
        return None

    # Prefer the lowest visible post to keep forward progress
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def scroll_feed(page, duration_minutes: int, actions_config: dict) -> dict:
    """
    Scroll through Instagram feed and perform random actions.

    Args:
        page: Playwright page object
        duration_minutes: How long to scroll
        actions_config: Dict with:
            - 'like_chance', 'follow_chance' (0-100)
            - optional 'carousel_watch_chance' (0-100) and 'carousel_max_slides'
            - optional 'watch_stories' (bool, default True) and 'stories_max'

    Returns:
        Dict with stats: {'likes': N, 'follows': N}
    """
    stats = {"likes": 0, "follows": 0}
    end_time = time.time() + (duration_minutes * 60)

    try:
        _navigate_home(page)
        if actions_config.get("watch_stories", True):
            try:
                watch_stories(page, max_stories=actions_config.get("stories_max", 3))
            except Exception as e:
                print(f"[!] Story watch skipped: {e}")
        print(f"[*] Starting {duration_minutes} minute scroll session on Instagram...")

        while time.time() < end_time:
            # Scroll down using human-like mouse actions
            human_scroll(page)
            random_delay(1.5, 4.0)

            posts = page.query_selector_all("article")
            if posts:
                post = _pick_visible_post(page, posts)
                if not post:
                    continue
                try:
                    post.scroll_into_view_if_needed()
                    human_mouse_move(page)  # simulate looking at the post
                    random_delay(0.5, 1.5)
                except Exception:
                    continue

                # Optionally step through carousel slides
                carousel_chance = actions_config.get("carousel_watch_chance", 0)
                if carousel_chance > 0:
                    has_carousel = bool(
                        post.query_selector('button[aria-label*="Next"]')
                        or post.query_selector('div[role="button"][aria-label*="Next"]')
                        or post.query_selector('button._afxw._al46._al47')
                        or post.query_selector('svg[aria-label="Next"]')
                        or post.query_selector('li[aria-label^="Go to slide"]')
                        or post.query_selector("div._acnb")
                        or post.query_selector("ul._acay li")
                    )

                    if has_carousel:
                        print("[*] Carousel indicators found on post")
                        if random.randint(0, 100) < carousel_chance:
                            max_slides = actions_config.get("carousel_max_slides", 3)
                            watch_carousel(page, post, max_slides=max_slides)
                        else:
                            print("[*] Skipping carousel watch due to chance config")

                actions_to_perform = _queue_actions(page, post, actions_config)

                for action_name, action_func in actions_to_perform:
                    try:
                        if action_func():
                            stats[action_name + "s"] += 1
                            random_delay(1, 3)
                    except Exception as e:
                        print(f"[!] Error executing {action_name} action: {e}")

            # Random longer pause occasionally
            if random.random() < 0.1:
                random_delay(8, 15)
                human_mouse_move(page)

        print(f"[✓] Scroll session complete: {stats}")
        return stats

    except Exception as e:
        print(f"[!] Error during scrolling: {e}")
        return stats


