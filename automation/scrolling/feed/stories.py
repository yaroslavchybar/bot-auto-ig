import random
from automation.actions import random_delay


def _click_center(page, element) -> bool:
    """Click the center of an element via mouse; returns True on success."""
    try:
        box = element.bounding_box()
        if not box:
            return False
        x = box["x"] + box["width"] / 2
        y = box["y"] + box["height"] / 2
        page.mouse.click(x, y)
        return True
    except Exception:
        try:
            element.click()
            return True
        except Exception:
            return False


def _extract_label(el):
    """Return the nearest aria-label text from element or its ancestors."""
    try:
        label = el.get_attribute("aria-label")
        if label:
            return label.lower()
        # climb to nearest ancestor with aria-label
        ancestor = el.query_selector('xpath=ancestor-or-self::*[@aria-label][1]')
        if ancestor and ancestor != el:
            label = ancestor.get_attribute("aria-label")
            if label:
                return label.lower()
    except Exception:
        pass
    return ""


def _looks_new_story(el) -> bool:
    """
    Heuristic to detect an unseen story bubble via aria-label text.
    Handles labels like:
      - "Story by username, not seen"
      - "Story by username, seen"
      - "New story by username"
    """
    label = _extract_label(el)
    if not label:
        return False
    if "not seen" in label:
        return True
    if "new" in label and "story" in label:
        return True
    if "seen" in label:
        return False
    return False


def _find_story_bubble(page):
    """
    Try to locate a story bubble in the top tray, preferring new/unseen ones.

    Returns:
        element handle or None
    """
    selectors = [
        'li._acaz [aria-label*="story" i]',
        '[aria-label*="story" i]',
        '[aria-label*="not seen" i]',
        'div[role="button"][aria-label]',
    ]

    candidates = []
    for sel in selectors:
        try:
            for el in page.query_selector_all(sel):
                try:
                    box = el.bounding_box()
                    if not box:
                        continue
                    # Only consider bubbles near the top of the feed
                    if box["y"] < 280:
                        candidates.append((box["y"], box["x"], _looks_new_story(el), el))
                except Exception:
                    continue
        except Exception:
            continue

    if not candidates:
        return None

    unseen = [c for c in candidates if c[2]]
    if not unseen:
        print("[*] No unseen stories found; skipping story watch")
        return None

    unseen.sort(key=lambda t: (t[0], t[1]))
    return unseen[0][3]


def _find_story_nav(page, label: str):
    """
    Find the story navigation button by aria-label on nested SVG.
    The visible arrow buttons place the aria-label on the inner <svg>.
    """
    try:
        for svg in page.query_selector_all(f'svg[aria-label*="{label}" i]'):
            # Climb to the nearest clickable ancestor
            btn = svg.query_selector('xpath=ancestor-or-self::*[@role="button"][1]')
            if btn:
                return btn
    except Exception:
        return None
    return None


def watch_stories(page, max_stories: int = 3, min_view_s: float = 2.0, max_view_s: float = 5.0) -> bool:
    """
    Open and step through a few available stories from the top tray.

    Returns:
        bool: True if at least one story was opened.
    """
    try:
        bubble = _find_story_bubble(page)
        if not bubble:
            print("[*] No story bubbles detected in tray")
            return False

        if not _click_center(page, bubble):
            print("[*] Story bubble click failed")
            return False

        opened = True
        stories_watched = 0
        random_delay(0.8, 1.5)

        while stories_watched < max_stories:
            random_delay(min_view_s, max_view_s)
            stories_watched += 1

            try:
                # Try next story using new SVG-based nav buttons
                next_btn = _find_story_nav(page, "Next")
                if next_btn:
                    next_btn.click()
                else:
                    page.keyboard.press("ArrowRight")
            except Exception:
                break

            random_delay(0.4, 0.9)

        try:
            page.keyboard.press("Escape")
        except Exception:
            pass

        print(f"[*] Watched {stories_watched} stories")
        return opened

    except Exception as e:
        print(f"[!] Error watching stories: {e}")
        return False

