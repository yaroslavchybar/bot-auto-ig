import logging
import random
import time
from python.actions.common import safe_mouse_move

logger = logging.getLogger(__name__)

REELS_LIKE_BUTTON_XPATH = (
    "//div[@role='button' and "
    "descendant::*[local-name()='svg' and (@aria-label='Like' or @aria-label='Unlike')]]"
)


def perform_like(page) -> bool:
    """Like the current active reel."""
    try:
        active_btn = _active_like_button(page)
        if not active_btn:
            return False
        skip_reason = _like_skip_reason(active_btn)
        if skip_reason == 'missing_icon':
            return False
        if skip_reason == 'already_liked':
            logger.debug('Skipped liking: Reel already liked')
            return False
        coordinates = _button_coordinates(page, active_btn)
        if not coordinates:
            return False
        _click_like(page, *coordinates)
        logger.info('Liked reel')
        return True
    except Exception as exc:
        logger.error(f'Error liking reel: {exc}')
    return False


def _active_like_button(page):
    btn_handle = page.evaluate_handle(
        """
        (buttonXPath) => {
            const center = window.innerHeight / 2;
            const snapshot = document.evaluate(buttonXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            let bestBtn = null;
            let minDiff = Infinity;
            for (let i = 0; i < snapshot.snapshotLength; i++) {
                const btn = snapshot.snapshotItem(i);
                const heartIcon = btn.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]');
                if (!heartIcon) continue;
                const rect = btn.getBoundingClientRect();
                if (
                    rect.top < 0 ||
                    rect.bottom > window.innerHeight ||
                    rect.left < 0 ||
                    rect.right > window.innerWidth ||
                    rect.width === 0 ||
                    rect.height === 0
                ) continue;
                if (!(() => {
                    let curr = btn.parentElement;
                    for (let j = 0; j < 20; j++) {
                        if (!curr || curr.tagName === 'BODY') return false;
                        const style = window.getComputedStyle(curr);
                        const cRect = curr.getBoundingClientRect();
                        if (style.overflow === 'visible' && cRect.height > 200) return true;
                        curr = curr.parentElement;
                    }
                    return false;
                })()) continue;
                const diff = Math.abs((rect.top + rect.height / 2) - center);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestBtn = btn;
                }
            }
            return bestBtn;
        }
        """,
        REELS_LIKE_BUTTON_XPATH,
    )
    return btn_handle.as_element()


def _like_skip_reason(active_btn) -> str | None:
    heart_icon = active_btn.query_selector('svg[aria-label="Like"], svg[aria-label="Unlike"]')
    if not heart_icon:
        logger.debug('Skipped liking: Reels like icon not found inside button')
        return 'missing_icon'
    if heart_icon.get_attribute('aria-label') == 'Unlike':
        return 'already_liked'
    return None


def _button_coordinates(page, active_btn):
    box = active_btn.bounding_box()
    if not box:
        return None
    vp = page.viewport_size
    x = box['x'] + box['width'] / 2
    y = box['y'] + box['height'] / 2
    if y < 0 or y > (vp['height'] if vp else 10000):
        logger.debug(f'Skipped liking: Button y={y} is outside viewport')
        return None
    if not vp:
        return x, y
    return (
        max(5.0, min(float(x), float(vp['width']) - 5.0)),
        max(5.0, min(float(y), float(vp['height']) - 5.0)),
    )


def _click_like(page, x: float, y: float) -> None:
    safe_mouse_move(page, x, y, steps=random.randint(5, 10))
    time.sleep(random.uniform(0.05, 0.12))
    page.mouse.click(x, y, delay=random.randint(25, 65))
