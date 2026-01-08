import random
import time
from playwright.sync_api import Error as PlaywrightError
from python.internal_systems.error_handling.exceptions import ElementNotFoundError, BotException
from python.instagram_actions.browsing.utils import _smooth_wheel, ease_out_cubic, _get_viewport_size, _pick_point


def _find_like_button(post_element):
    """Find the like button SVG and its clickable parent."""
    like_svg = (
        post_element.query_selector('svg[aria-label="Like"]')
        or post_element.query_selector('div[role="button"] svg[aria-label="Like"]')
    )
    if not like_svg:
        return None, None
    clickable = like_svg.query_selector('xpath=ancestor-or-self::*[@role="button" or self::button][1]')
    return like_svg, clickable


def _micro_scroll_to_button(page, post_element, max_attempts: int = 3) -> bool:
    """
    Perform small smooth scrolls to bring the like button into view.
    Returns True if button became visible after scrolling.
    """
    for attempt in range(max_attempts):
        like_svg, clickable = _find_like_button(post_element)
        if clickable:
            return True
        
        # Already liked? No need to scroll
        if post_element.query_selector('svg[aria-label="Unlike"]'):
            return False
        
        # Smooth scroll down to reveal button area
        viewport_w, viewport_h = _get_viewport_size(page)
        if viewport_h <= 0:
            viewport_h = 900
        x, y = _pick_point(viewport_w, viewport_h)
        try:
            page.mouse.move(x, y)
            time.sleep(random.uniform(0.05, 0.12))
            
            # Longer, smoother scroll to reveal buttons
            scroll_amount = random.randint(
                max(90, int(viewport_h * 0.12)),
                max(120, int(viewport_h * 0.22)),
            )
            duration = random.uniform(0.25, 0.40) + min(1.2, scroll_amount / 500) * random.uniform(0.12, 0.22)
            _smooth_wheel(page, scroll_amount, duration_s=duration, easing=ease_out_cubic)
            time.sleep(random.uniform(0.1, 0.2))
        except Exception:
            break
    
    # Final check
    _, clickable = _find_like_button(post_element)
    return clickable is not None


def _is_in_viewport(page, element, margin: int = 6) -> bool:
    try:
        box = element.bounding_box() if element else None
        if not box:
            return False

        viewport_w, viewport_h = _get_viewport_size(page)
        if viewport_w <= 0:
            viewport_w = 1200
        if viewport_h <= 0:
            viewport_h = 900

        x0 = box["x"]
        y0 = box["y"]
        x1 = x0 + box["width"]
        y1 = y0 + box["height"]

        return (
            x0 >= -margin
            and y0 >= -margin
            and x1 <= viewport_w + margin
            and y1 <= viewport_h + margin
            and box["width"] > 0
            and box["height"] > 0
        )
    except Exception:
        return False


def _mouse_click_element_center(page, element) -> bool:
    try:
        box = element.bounding_box() if element else None
        if not box:
            return False

        x = box["x"] + (box["width"] / 2) + random.uniform(-2.0, 2.0)
        y = box["y"] + (box["height"] / 2) + random.uniform(-2.0, 2.0)

        page.mouse.move(x, y, steps=random.randint(5, 10))
        time.sleep(random.uniform(0.05, 0.12))
        page.mouse.click(x, y, delay=random.randint(25, 65))
        return True
    except Exception:
        return False


def perform_like(page, post_element) -> bool:
    """Like a feed post, skipping if already liked."""
    try:
        # Skip if already liked
        if post_element.query_selector('svg[aria-label="Unlike"]'):
            return False

        like_svg, clickable = _find_like_button(post_element)

        for _ in range(4):
            if clickable and _is_in_viewport(page, clickable):
                if _mouse_click_element_center(page, clickable):
                    print("Liked post")
                    return True
                return False

            if not _micro_scroll_to_button(page, post_element, max_attempts=1):
                return False

            like_svg, clickable = _find_like_button(post_element)
    except ElementNotFoundError:
        print(f"[!] Like button not found")
    except (PlaywrightError, BotException) as e:
        print(f"[!] Error liking post: {type(e).__name__} - {e}")
    
    return False
