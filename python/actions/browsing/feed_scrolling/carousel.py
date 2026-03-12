import random
from python.actions.common import random_delay
from python.actions.browsing.utils import human_mouse_move

CAROUSEL_NEXT_BUTTON_XPATH = "xpath=.//button[@aria-label='Next' and ../div[@role='presentation']]"
CAROUSEL_PREV_BUTTON_XPATH = "xpath=.//button[@aria-label='Go back' and ../div[@role='presentation']]"


def _find_carousel_nav(post_element, label: str):
    if label == 'Next':
        return post_element.query_selector(CAROUSEL_NEXT_BUTTON_XPATH)

    if label == 'Go back':
        return post_element.query_selector(CAROUSEL_PREV_BUTTON_XPATH)

    return None


def watch_carousel(page, post_element, max_slides: int = 3) -> bool:
    """
    Step through a few slides of a carousel post to mimic viewing behavior.

    Returns True if at least one "next" interaction occurred, False otherwise.
    """
    try:
        # Detect via dots or visible "next" control
        dots = (
            post_element.query_selector_all('li[aria-label^="Go to slide"]')
            or post_element.query_selector_all("div._acnb")
            or post_element.query_selector_all("ul._acay li")
            or []
        )

        next_probe = _find_carousel_nav(post_element, 'Next')

        total = len(dots)
        looks_like_carousel = total > 1 or next_probe is not None
        if not looks_like_carousel:
            print("[*] No carousel indicators found")
            return False

        if total <= 1:
            # no dot count but next control exists; assume at least 2 slides
            total = max(total, 2)

        print(f"[*] Carousel detected with {total} slides")

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

        print("[*] Finished stepping through carousel")
        return True

    except Exception as e:
        print(f"[!] Error watching carousel: {e}")
        return False


