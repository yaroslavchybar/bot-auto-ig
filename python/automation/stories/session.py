import logging

from python.automation.actions import random_delay

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
        svg = page.query_selector('svg[aria-label="Home"]')
        if svg:
            btn = svg.query_selector('xpath=ancestor-or-self::*[@role="link"][1]') or svg.query_selector(
                'xpath=ancestor-or-self::*[@role="button"][1]'
            )
            (btn or svg).click()
            random_delay(1.5, 3.0)
            return True
    except Exception:
        pass

    try:
        link = page.query_selector('a[role="link"][href="/"]')
        if link:
            link.click()
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

