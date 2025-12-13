import random
import time
from automation.actions import random_delay
from .likes import perform_like
from .following import perform_follow


def _click_next_reel(page) -> bool:
    """
    Click the visible arrow control to advance to the next reel instead of
    scrolling or sending keyboard events.
    """
    selectors = [
        'div[role="button"][aria-label*="Navigate to next Reel"]',
        'div[role="button"][aria-label*="Navigate to previous Reel"]',
        'button[aria-label*="Next"]',
        'div[role="button"][aria-label*="Next"]',
        'button[aria-label*="Down"]',
        'div[role="button"][aria-label*="Down"]',
        'button[aria-label*="Scroll down"]',
        'div[role="button"][aria-label*="Scroll down"]',
        'button:has(svg[aria-label="Chevron down"])',
        'div[role="button"]:has(svg[aria-label="Chevron down"])',
        'button:has(svg[aria-label="Down"])',
        'div[role="button"]:has(svg[aria-label="Down"])',
        'svg[aria-label="Down"]',
        'svg[aria-label="Next"]',
    ]

    for selector in selectors:
        try:
            candidate = page.query_selector(selector)
            if not candidate:
                continue

            # If we matched the icon directly, click its parent if possible
            clickable = candidate
            if candidate.evaluate("el => el.tagName.toLowerCase() === 'svg'"):
                parent = candidate.query_selector("xpath=..")
                if parent:
                    clickable = parent

            if not clickable.is_visible():
                continue

            box = clickable.bounding_box()
            if box:
                target_x = box["x"] + (box["width"] / 2)
                target_y = box["y"] + (box["height"] / 2)
                page.mouse.move(target_x, target_y, steps=random.randint(8, 18))
                random_delay(0.2, 0.6)
                page.mouse.click(target_x, target_y)
            else:
                clickable.click()

            return True
        except Exception:
            continue

    print("[!] Could not find a next-reel arrow button")
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

    if random.randint(0, 100) < actions_config.get("follow_chance", 0):
        actions_to_perform.append(("follow", lambda: perform_follow(page)))

    random.shuffle(actions_to_perform)
    return actions_to_perform


def scroll_reels(page, duration_minutes: int, actions_config: dict) -> dict:
    """
    Scroll through Instagram Reels and perform random actions.

    Args:
        page: Playwright page object
        duration_minutes: How long to scroll
        actions_config: Dict with 'like_chance', 'follow_chance' (0-100)

    Returns:
        Dict with stats: {'likes': N, 'follows': N}
    """
    stats = {"likes": 0, "follows": 0}
    end_time = time.time() + (duration_minutes * 60)

    try:
        _navigate_reels(page)
        print(f"[*] Starting {duration_minutes} minute REELS session...")

        while time.time() < end_time:
            watch_time = random.uniform(5.0, 25.0)  # simulate watching the reel
            time.sleep(watch_time)

            actions_to_perform = _queue_actions(page, actions_config)

            for action_name, action_func in actions_to_perform:
                try:
                    if action_func():
                        stats[action_name + "s"] += 1
                        random_delay(1, 2)
                except Exception as e:
                    print(f"[!] Error executing {action_name} action on reel: {e}")

            if not _click_next_reel(page):
                break
            random_delay(1.5, 3.0)

    except Exception as e:
        print(f"[!] Error during reels scrolling: {e}")

    print(f"[✓] Reels session complete: {stats}")
    return stats


