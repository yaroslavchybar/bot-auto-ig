import logging

from python.actions.common import random_delay

from .controls import advance_story, close_stories
from .tray import find_story_bubble
from .utils import click_center


logger = logging.getLogger(__name__)


def _go_home(page, log=None) -> bool:
    log = log or (lambda s: None)
    try:
        if page.url == "about:blank":
            page.goto("https://www.instagram.com/", timeout=15000)
            random_delay(1.0, 2.0)
            return True
    except Exception:
        pass

    try:
        if page.url.rstrip("/") == "https://www.instagram.com":
            return True
    except Exception:
        pass

    try:
        log("Stories: opening Home")
        svg = page.locator('svg[aria-label="Home"]')
        if svg.count() > 0:
            first_svg = svg.first
            link_ancestor = first_svg.locator('xpath=ancestor-or-self::*[@role="link"][1]')
            btn_ancestor = first_svg.locator('xpath=ancestor-or-self::*[@role="button"][1]')
            target = link_ancestor.first if link_ancestor.count() > 0 else (
                btn_ancestor.first if btn_ancestor.count() > 0 else first_svg
            )
            target.click()
            random_delay(1.5, 3.0)
            return True
    except Exception:
        pass

    try:
        link = page.locator('a[role="link"][href="/"]')
        if link.count() > 0:
            link.first.click()
            random_delay(1.5, 3.0)
            return True
    except Exception:
        pass

    try:
        page.goto("https://www.instagram.com/", timeout=30000)
        random_delay(2.0, 4.0)
        return True
    except Exception:
        log("Stories: failed to open Home")
        return False


def watch_stories(page, max_stories: int = 3, min_view_s: float = 2.0, max_view_s: float = 5.0, log=None) -> bool:
    try:
        log = log or logger.info
        if max_view_s < min_view_s:
            min_view_s, max_view_s = max_view_s, min_view_s
        _go_home(page, log=log)
        bubble = find_story_bubble(page, log=log)
        if not bubble:
            log("Stories: no bubbles detected in tray")
            return False

        if not click_center(page, bubble):
            log("Stories: bubble click failed")
            return False

        stories_watched = 0
        random_delay(0.8, 1.5)

        advance_failures = 0
        while stories_watched < max_stories:
            random_delay(min_view_s, max_view_s)
            stories_watched += 1

            advanced = advance_story(page)
            if not advanced:
                advance_failures += 1
                if advance_failures >= 2:
                    break
            else:
                advance_failures = 0

            random_delay(0.4, 0.9)

        try:
            if not close_stories(page):
                page.keyboard.press("Escape")
        except Exception:
            pass

        log(f"Stories: watched {stories_watched}")
        return True

    except Exception as e:
        log(f"Stories: error {e}")
        return False

