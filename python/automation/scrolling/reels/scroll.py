import random
import time
from python.automation.actions import random_delay
from .likes import perform_like


def _go_to_next_reel(page) -> bool:
    """
    Click the specific 'Navigate to next Reel' button to advance.
    """
    try:
        # User observation: The navigation buttons are in a separate toolbar div
        # <div aria-label="Reels navigation controls" role="toolbar">
        # We should look for the button INSIDE this specific toolbar to avoid finding hidden/other buttons.
        
        toolbar = page.query_selector('[aria-label="Reels navigation controls"][role="toolbar"]')
        if not toolbar:
            print("[!] Navigation toolbar not found.")
            return False

        next_btn = toolbar.query_selector('[aria-label="Navigate to next Reel"]')
        if next_btn:
            # Check visibility
            if next_btn.is_visible():
                box = next_btn.bounding_box()
                if box:
                    print(f"[*] Found 'Next Reel' arrow at ({box['x']}, {box['y']})")
                    
                    # Human-like interaction: Hover first -> Wait -> Click
                    # This helps trigger any 'onHover' pre-fetching logic Instagram might have
                    center_x = box['x'] + box['width'] / 2
                    center_y = box['y'] + box['height'] / 2
                    
                    page.mouse.move(center_x, center_y, steps=5)
                    random_delay(0.2, 0.5)
                    page.mouse.click(center_x, center_y)
                    print("[*] Clicked 'Next Reel' arrow")
                    return True
        
        print("[!] 'Navigate to next Reel' button not found in toolbar.")
        return False
    except Exception as e:
        print(f"[!] Error navigating to next reel: {e}")
        return False


def _navigate_reels(page):
    """Navigate to the Reels tab if not already there."""
    if "instagram.com/reels" in page.url:
        return

    print("[*] Navigating to Reels tab via UI...")
    try:
        reels_link = page.query_selector('a[href="/reels/"]')
        if reels_link:
            box = reels_link.bounding_box()
            if box:
                # Move directly to the center of the button with minimal steps
                target_x = box["x"] + (box["width"] / 2)
                target_y = box["y"] + (box["height"] / 2)
                page.mouse.move(target_x, target_y, steps=4)
                random_delay(0.2, 0.4)
                page.mouse.click(target_x, target_y)
                page.wait_for_url("**/reels/**", timeout=15000)
                random_delay(1, 2)
            else:
                print("[!] Reels link visible but no bounding box")
                page.goto("https://www.instagram.com/reels/", timeout=30000)
        else:
            print("[!] Reels link not found in sidebar")
            page.goto("https://www.instagram.com/reels/", timeout=30000)
    except Exception as nav_e:
        print(f"[!] Navigation error, fallback to URL: {nav_e}")
        page.goto("https://www.instagram.com/reels/", timeout=30000)
        random_delay(3, 5)


def _queue_actions(page, actions_config):
    """Prepare action callables for the current reel based on configured chances."""
    actions_to_perform = []

    if random.randint(0, 100) < actions_config.get("like_chance", 0):
        actions_to_perform.append(("like", lambda: perform_like(page)))

    random.shuffle(actions_to_perform)
    return actions_to_perform


def scroll_reels(page, duration_minutes: int, actions_config: dict, should_stop=None) -> dict:
    """
    Scroll through Instagram Reels and perform random actions.

    Args:
        page: Playwright page object
        duration_minutes: How long to scroll
        actions_config: Dict with 'like_chance', 'follow_chance' (0-100)
        should_stop: Optional callable that returns True if execution should stop

    Returns:
        Dict with stats: {'likes': N, 'follows': N}
    """
    stats = {"likes": 0, "follows": 0}
    end_time = time.time() + (duration_minutes * 60)

    try:
        _navigate_reels(page)
        print(f"[*] Starting {duration_minutes} minute REELS session...")

        while time.time() < end_time:
            if should_stop and should_stop():
                print("[!] Stop signal received. Ending reels session.")
                break

            # Simulate human behavior:
            # Use configured chance to "skip" boring content
            skip_chance = actions_config.get("reels_skip_chance", 30)
            
            skip_min = actions_config.get("reels_skip_min_time", 0.8)
            skip_max = actions_config.get("reels_skip_max_time", 2.0)
            normal_min = actions_config.get("reels_normal_min_time", 5.0)
            normal_max = actions_config.get("reels_normal_max_time", 20.0)

            if random.randint(0, 100) < skip_chance:
                watch_time = random.uniform(skip_min, skip_max)
                print(f"[*] Short watch (skip): {watch_time:.2f}s")
            else:
                watch_time = random.uniform(normal_min, normal_max)
                print(f"[*] Normal watch: {watch_time:.2f}s")
            
            # Check for stop signal during watch time (sleep in chunks)
            start_sleep = time.time()
            while time.time() - start_sleep < watch_time:
                if should_stop and should_stop():
                    break
                time.sleep(0.5)
                
            if should_stop and should_stop():
                print("[!] Stop signal received. Ending reels session.")
                break

            actions_to_perform = _queue_actions(page, actions_config)

            for action_name, action_func in actions_to_perform:
                if should_stop and should_stop():
                    break
                    
                try:
                    if action_func():
                        stats[action_name + "s"] += 1
                        random_delay(1, 2)
                except Exception as e:
                    print(f"[!] Error executing {action_name} action on reel: {e}")

            if should_stop and should_stop():
                print("[!] Stop signal received. Ending reels session.")
                break

            if not _go_to_next_reel(page):
                break
            random_delay(1.5, 3.0)

    except Exception as e:
        print(f"[!] Error during reels scrolling: {e}")

    print(f"Reels session complete: {stats}")
    return stats

