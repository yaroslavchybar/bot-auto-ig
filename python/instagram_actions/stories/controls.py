from python.instagram_actions.actions import random_delay

from .utils import click_center


CAROUSEL_CONTROL_SIGNATURES = {
    'Next': "self::button[@aria-label='Next' and ../div[@role='presentation']]",
    'Go back': "self::button[@aria-label='Go back' and ../div[@role='presentation']]",
}

STORY_CONTROL_XPATHS = {
    'Next': (
        "(//*[local-name()='button' or @role='button']"
        "[.//*[@aria-label='Next'] or @aria-label='Next']"
        f"[not({CAROUSEL_CONTROL_SIGNATURES['Next']})])[last()]"
    ),
    'Previous': (
        "(//*[local-name()='button' or @role='button']"
        "[.//*[@aria-label='Previous'] or @aria-label='Previous'])[last()]"
    ),
    'Close': (
        "(//*[local-name()='button' or @role='button']"
        "[.//*[@aria-label='Close'] or @aria-label='Close'])[last()]"
    ),
}


def _story_control_xpath(label: str) -> str:
    xpath = STORY_CONTROL_XPATHS.get(label)
    if xpath:
        return xpath
    return (
        "(//*[local-name()='button' or @role='button']"
        f"[.//*[@aria-label='{label}'] or @aria-label='{label}'])[last()]"
    )


def find_story_nav(page, label: str):
    try:
        return page.query_selector(f'xpath={_story_control_xpath(label)}')
    except Exception:
        return None


def advance_story(page) -> bool:
    for _ in range(3):
        try:
            btn = find_story_nav(page, 'Next')
            if btn:
                try:
                    btn.click()
                    return True
                except Exception:
                    random_delay(0.15, 0.35)
                    continue

            try:
                page.keyboard.press('ArrowRight')
                return True
            except Exception:
                random_delay(0.15, 0.35)
                continue
        except Exception:
            random_delay(0.15, 0.35)
            continue
    return False


def _find_story_close(page):
    return find_story_nav(page, 'Close')


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
