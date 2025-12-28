import random
import time
from python.automation.actions import random_delay
from python.automation.scrolling.utils import human_scroll, human_mouse_move
from .likes import perform_like
from .following import perform_follow
from .carousel import watch_carousel
from python.automation.stories import watch_stories


def _navigate_home(page):
    """Ensure we are on the Instagram home feed and clear modals."""
    try:
        # Check if we are on the main feed URL
        if page.url.rstrip("/") == "https://www.instagram.com":
            return

        print("[*] Navigating to Home feed...")
        
        # Try to find and click the Home button in sidebar
        home_selectors = [
            'svg[aria-label="Home"]',
            'a[href="/"] svg[aria-label="Home"]',
            'a[href="/"]'
        ]
        
        found_home = False
        for selector in home_selectors:
            try:
                element = page.query_selector(selector)
                if element and element.is_visible():
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
                    break
            except Exception:
                continue
                
        if not found_home:
             # Fallback to direct navigation
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
            
    except Exception as e:
        print(f"[!] Navigation error: {e}")
        page.goto("https://www.instagram.com/", timeout=30000)


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
    except Exception:
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

        except Exception:
            continue

    if not candidates:
        return None

    # Sort by visibility percentage (highest first), then by bottom position (lowest first)
    candidates.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return candidates[0][2]


def scroll_feed(page, duration_minutes: int, actions_config: dict, should_stop=None) -> dict:
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

    Returns:
        Dict with stats: {'likes': N, 'follows': N}
    """
    stats = {"likes": 0, "follows": 0}
    end_time = time.time() + (duration_minutes * 60)

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
            except Exception as e:
                print(f"[!] Story watch skipped: {e}")
                
        print(f"[*] Starting {duration_minutes} minute scroll session on Instagram...")

        while time.time() < end_time:
            if should_stop and should_stop():
                print("[!] Stop signal received. Ending feed session.")
                break

            # Scroll down using human-like mouse actions
            human_scroll(page)
            
            # Break up the delay to check for stop
            delay_target = random.uniform(1.5, 4.0)
            start_delay = time.time()
            while time.time() - start_delay < delay_target:
                if should_stop and should_stop():
                    break
                time.sleep(0.1)
                
            if should_stop and should_stop():
                break

            posts = page.query_selector_all("article")
            if posts:
                post = _pick_visible_post(page, posts)
                if not post:
                    continue
                try:
                    human_mouse_move(page)  # simulate looking at the post
                    random_delay(0.5, 1.5)
                except Exception:
                    continue
                
                if should_stop and should_stop():
                    break

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
                            if not (should_stop and should_stop()):
                                max_slides = actions_config.get("carousel_max_slides", 3)
                                watch_carousel(page, post, max_slides=max_slides)
                        else:
                            print("[*] Skipping carousel watch due to chance config")
                
                if should_stop and should_stop():
                    break

                actions_to_perform = _queue_actions(page, post, actions_config)

                for action_name, action_func in actions_to_perform:
                    if should_stop and should_stop():
                        break
                        
                    try:
                        if action_func():
                            stats[action_name + "s"] += 1
                            random_delay(1, 3)
                    except Exception as e:
                        print(f"[!] Error executing {action_name} action: {e}")

            # Random longer pause occasionally
            if random.random() < 0.1:
                long_pause = random.uniform(8, 15)
                start_pause = time.time()
                while time.time() - start_pause < long_pause:
                    if should_stop and should_stop():
                        break
                    time.sleep(0.5)
                    
                if should_stop and should_stop():
                    break
                    
                human_mouse_move(page)

        print(f"[✓] Scroll session complete: {stats}")
        return stats

    except Exception as e:
        print(f"[!] Error during scrolling: {e}")
        return stats


