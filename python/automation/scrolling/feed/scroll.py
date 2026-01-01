import random
import time
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError
from python.core.resilience.exceptions import BotException, ElementNotFoundError, SelectorTimeoutError
from python.core.automation.selectors import HOME_BUTTON
from python.core.resilience.retry import jitter
from python.automation.scrolling.utils import human_scroll, scroll_to_element
from .likes import perform_like
from .following import perform_follow
from python.automation.stories import watch_stories
from python.core.persistence.state_persistence import save_state


def _navigate_home(page):
    """Ensure we are on the Instagram home feed and clear modals."""
    try:
        # Check if we are on the main feed URL
        if page.url.rstrip("/") == "https://www.instagram.com":
            return

        print("[*] Navigating to Home feed...")
        
        # Try to find and click the Home button in sidebar
        element = HOME_BUTTON.find(page)
        
        found_home = False
        if element:
            try:
                # If we found the SVG, click its parent link/button if possible
                clickable = element
                if element.evaluate("el => el.tagName.toLowerCase() === 'svg'"):
                    parent = element.query_selector("xpath=..") # div
                    if parent:
                        grandparent = parent.query_selector("xpath=..") # div
                        if grandparent:
                            greatgrandparent = grandparent.query_selector("xpath=..") # div
                            if greatgrandparent:
                                link_parent = greatgrandparent.query_selector("xpath=..") # a
                                if link_parent:
                                    clickable = link_parent

                clickable.click()
                found_home = True
            except (PlaywrightError, BotException) as e:
                print(f"[!] Home selector click failed: {type(e).__name__}")
        
        if not found_home:
             # Fallback to direct navigation
             page.goto("https://www.instagram.com/", timeout=jitter(30000))

        random_delay(jitter(3000)/1000, jitter(5000)/1000)

        # Handle "Turn on Notifications" or similar modals if they appear
        try:
            not_now = page.query_selector('button:has-text("Not Now")')
            if not_now:
                not_now.click()
                random_delay(1, 2)
        except (PlaywrightError, BotException) as e:
            pass
        except Exception:
            pass
            
    except (PlaywrightError, BotException) as e:
        print(f"[!] Navigation error: {type(e).__name__} - {e}")
        try:
            page.goto("https://www.instagram.com/", timeout=jitter(30000))
        except Exception:
            pass
    except Exception as e:
        print(f"[!] Unexpected navigation error: {type(e).__name__} - {e}")
        try:
            page.goto("https://www.instagram.com/", timeout=jitter(30000))
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
    Pick a post that has the highest percentage visible in the viewport,
    preferring posts that are more fully on screen.
    """
    try:
        viewport_h = page.evaluate("() => window.innerHeight") or 0
        viewport_w = page.evaluate("() => window.innerWidth") or 0
    except Exception as e:
        print(f"[!] Viewport check failed: {type(e).__name__}")
        viewport_h = 0
        viewport_w = 0

    candidates = []
    for p in posts:
        try:
            box = p.bounding_box()
            if not box:
                continue

            # Calculate visible area of the post
            post_top = box["y"]
            post_bottom = box["y"] + box["height"]
            post_left = box["x"]
            post_right = box["x"] + box["width"]

            # Calculate intersection with viewport
            visible_top = max(0, post_top)
            visible_bottom = min(viewport_h, post_bottom)
            visible_left = max(0, post_left)
            visible_right = min(viewport_w, post_right)

            # Calculate visible area
            visible_height = max(0, visible_bottom - visible_top)
            visible_width = max(0, visible_right - visible_left)
            visible_area = visible_height * visible_width

            # Calculate total post area
            total_area = box["height"] * box["width"]

            if total_area > 0:
                visibility_percentage = (visible_area / total_area) * 100

                # Only consider posts with significant visibility (>20% visible)
                if visibility_percentage > 20:
                    candidates.append((visibility_percentage, post_bottom, p))

        except (PlaywrightError, BotException) as e:
            continue
        except Exception:
            continue

    if not candidates:
        return None

    # Sort by visibility percentage (highest first), then by bottom position (lowest first)
    candidates.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return candidates[0][2]


def _get_next_post(page, posts, skip_count: int = 0):
    try:
        viewport_h = page.evaluate("() => window.innerHeight") or 0
    except Exception:
        viewport_h = 0

    if viewport_h <= 0:
        viewport_h = 900

    threshold_y = viewport_h * 0.52

    candidates = []
    for p in posts:
        try:
            box = p.bounding_box()
            if not box:
                continue
            center_y = box["y"] + (box["height"] / 2)
            if center_y > threshold_y:
                candidates.append((box["y"], p))
        except Exception:
            continue

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0])
    idx = min(max(0, int(skip_count)), len(candidates) - 1)
    return candidates[idx][1]


def scroll_feed(page, duration_minutes: int, actions_config: dict, should_stop=None, profile_name: str = "unknown") -> dict:
    """
    Scroll through Instagram feed and perform random actions.

    Args:
        page: Playwright page object
        duration_minutes: How long to scroll
        actions_config: Dict with:
            - 'like_chance', 'follow_chance' (0-100)
            - optional 'carousel_watch_chance' (0-100) and 'carousel_max_slides'
            - optional 'watch_stories' (bool, default True) and 'stories_max'
        should_stop: Optional callable that returns True if execution should stop
        profile_name: Name of the profile being automated (for state persistence)

    Returns:
        Dict with stats: {'likes': N, 'follows': N}
    """
    stats = {"likes": 0, "follows": 0}
    start_time = time.time()
    end_time = start_time + (duration_minutes * 60)

    try:
        _navigate_home(page)
        
        if should_stop and should_stop():
            return stats
            
        if actions_config.get("watch_stories", True):
            try:
                # We don't have deep control inside watch_stories easily without modifying it too, 
                # but let's at least check before starting it.
                if not (should_stop and should_stop()):
                    watch_stories(page, max_stories=actions_config.get("stories_max", 3))
            except (PlaywrightError, BotException) as e:
                print(f"[!] Story watch skipped: {type(e).__name__} - {e}")
            except Exception as e:
                print(f"[!] Story watch skipped (unexpected): {type(e).__name__} - {e}")
                
        print(f"[*] Starting {duration_minutes} minute scroll session on Instagram...")

        while time.time() < end_time:
            # Save state
            elapsed = time.time() - start_time
            total_duration = duration_minutes * 60
            progress = int((elapsed / total_duration) * 100) if total_duration > 0 else 0
            progress = min(progress, 99)
            save_state(profile_name, "scroll_feed", progress)

            if should_stop and should_stop():
                print("[!] Stop signal received. Ending feed session.")
                break

            posts = page.query_selector_all("article")
            if not posts:
                human_scroll(page, should_stop=should_stop)
                continue

            # Sometimes skip posts (scroll past 1-2)
            skip_count = 0
            skip_chance = actions_config.get("skip_post_chance", 30)
            if random.randint(0, 100) < skip_chance:
                skip_count = random.randint(1, actions_config.get("skip_post_max", 2))

            target_post = _get_next_post(page, posts, skip_count=skip_count)
            if not target_post:
                human_scroll(page, should_stop=should_stop)
                continue

            target_y_ratio = random.uniform(0.45, 0.55)
            if not scroll_to_element(
                page,
                target_post,
                target_y_ratio=target_y_ratio,
                ensure_full_visible=False,
                should_stop=should_stop,
            ):
                human_scroll(page, should_stop=should_stop)
                continue
            
            # View post for random time (like a real person looking at it)
            view_time = random.uniform(2.0, 5.0)
            time.sleep(view_time)
            
            if should_stop and should_stop():
                break

            # Decide to like based on chance
            like_chance = actions_config.get("like_chance", 0)
            if random.randint(0, 100) < like_chance:
                if perform_like(page, target_post):
                    stats["likes"] += 1
            
            # Decide to follow based on chance (less common)
            follow_chance = actions_config.get("follow_chance", 0)
            if random.randint(0, 100) < follow_chance:
                if perform_follow(page, target_post):
                    stats["follows"] += 1
            
            # Continue to next post (no extra delay)

        print(f"Scroll session complete: {stats}")
        return stats

    except (PlaywrightError, BotException) as e:
        print(f"[!] Error during scrolling: {type(e).__name__} - {e}")
        return stats
    except Exception as e:
        print(f"[!] Unexpected error during scrolling: {type(e).__name__} - {e}")
        return stats
