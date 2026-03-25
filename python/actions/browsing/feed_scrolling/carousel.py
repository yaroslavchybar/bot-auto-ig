import logging
import random
from python.actions.common import random_delay
from python.actions.browsing.utils import human_mouse_move

logger = logging.getLogger(__name__)

CAROUSEL_NEXT_BUTTON_XPATH = "xpath=.//button[@aria-label='Next' and ../div[@role='presentation']]"
CAROUSEL_PREV_BUTTON_XPATH = "xpath=.//button[@aria-label='Go back' and ../div[@role='presentation']]"


def _find_carousel_nav(post_element, label: str):
    if label == 'Next':
        loc = post_element.locator(CAROUSEL_NEXT_BUTTON_XPATH)
        return loc.first if loc.count() > 0 else None

    if label == 'Go back':
        loc = post_element.locator(CAROUSEL_PREV_BUTTON_XPATH)
        return loc.first if loc.count() > 0 else None

    return None


def watch_carousel(page, post_element, max_slides: int = 3) -> bool:
    """
    Step through a few slides of a carousel post to mimic viewing behavior.

    Returns True if at least one "next" interaction occurred, False otherwise.
    """
    try:
        # Detect via dots or visible "next" control
        dots_loc = post_element.locator('li[aria-label^="Go to slide"]')
        if dots_loc.count() == 0:
            dots_loc = post_element.locator("div._acnb")
        if dots_loc.count() == 0:
            dots_loc = post_element.locator("ul._acay li")
        dots = [dots_loc.nth(i) for i in range(dots_loc.count())]

        next_probe = _find_carousel_nav(post_element, 'Next')

        total = len(dots)
        looks_like_carousel = total > 1 or next_probe is not None
        if not looks_like_carousel:
            logger.info("No carousel indicators found")
            return False

        if total <= 1:
            # no dot count but next control exists; assume at least 2 slides
            total = max(total, 2)

        logger.info("Carousel detected with %d slides", total)

        slides_to_view = max(1, min(max_slides, total)) - 1  # number of forward moves

        for _ in range(slides_to_view):
            next_btn = _find_carousel_nav(post_element, 'Next')

            if next_btn:
                next_btn.click()
            else:
                # Fallback: arrow key to move carousel
                page.keyboard.press("ArrowRight")

            human_mouse_move(page)
            random_delay(0.6, 1.2)

        logger.info("Finished stepping through carousel")
        return True

    except Exception as e:
        logger.error("Error watching carousel: %s", e)
        return False


