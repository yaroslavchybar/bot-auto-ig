from python.instagram_actions.actions import random_delay

from .utils import click_center


def find_story_nav(page, label: str):
    try:
        for svg in page.query_selector_all(f'svg[aria-label*="{label}" i]'):
            btn = svg.query_selector('xpath=ancestor-or-self::*[@role="button"][1]')
            if btn:
                return btn
    except Exception:
        return None
    return None


def advance_story(page) -> bool:
    for _ in range(3):
        try:
            btn = find_story_nav(page, "Next")
            if btn:
                try:
                    btn.click()
                    return True
                except Exception:
                    random_delay(0.15, 0.35)
                    continue

            try:
                page.keyboard.press("ArrowRight")
                return True
            except Exception:
                random_delay(0.15, 0.35)
                continue
        except Exception:
            random_delay(0.15, 0.35)
            continue
    return False


def _find_story_close(page):
    svgs = []
    try:
        svgs.extend(page.query_selector_all('svg[aria-label="Close" i]'))
    except Exception:
        pass
    try:
        svgs.extend(page.query_selector_all(
            'xpath=//svg[.//title[translate(normalize-space(), "CLOSE", "close")="close"]]'
        ))
    except Exception:
        pass

    for svg in svgs:
        try:
            btn = svg.query_selector(
                'xpath=ancestor-or-self::*[@role="button" or self::button or self::a][1]'
            )
            if btn:
                return btn
            parent = svg.query_selector('xpath=ancestor-or-self::*[self::div or self::span][1]')
            if parent:
                return parent
            return svg
        except Exception:
            continue
    return None


def close_stories(page) -> bool:
    for _ in range(3):
        try:
            btn = _find_story_close(page)
            if btn and click_center(page, btn):
                return True
        except Exception:
            pass
        random_delay(0.2, 0.5)
    return False

