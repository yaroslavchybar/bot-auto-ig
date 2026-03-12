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
        # Find the clickable Reels like wrapper closest to the viewport center.
        # Match by semantic XPath so the selector survives Instagram CSS churn.
        
        btn_handle = page.evaluate_handle("""
            (buttonXPath) => {
                const center = window.innerHeight / 2;
                const snapshot = document.evaluate(
                    buttonXPath,
                    document,
                    null,
                    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );
                const allButtons = [];
                for (let i = 0; i < snapshot.snapshotLength; i++) {
                    allButtons.push(snapshot.snapshotItem(i));
                }
                
                let bestBtn = null;
                let minDiff = Infinity;
                
                for (const btn of allButtons) {
                    const heartIcon = btn.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]');
                    if (!heartIcon) continue;

                    const rect = btn.getBoundingClientRect();
                    
                    // 1. STRICT VISIBILITY CHECK
                    // The button must be fully inside the viewport vertical bounds.
                    // This prevents selecting buttons from the previous/next reel that might be slightly peaking in.
                    if (rect.top < 0 || rect.bottom > window.innerHeight) continue;
                    if (rect.width === 0 || rect.height === 0) continue;
                    
                    // 2. CHECK PARENT OVERFLOW (User Request)
                    // We traverse up to see if it belongs to a container with overflow: visible
                    let container = null;
                    let curr = btn.parentElement;
                    let hasVisibleOverflowParent = false;
                    
                    for (let i = 0; i < 20; i++) {
                        if (!curr || curr.tagName === 'BODY') break;
                        const style = window.getComputedStyle(curr);
                        if (style.overflow === 'visible') {
                             // Check if this container is substantial
                            const cRect = curr.getBoundingClientRect();
                            if (cRect.height > 200) {
                                hasVisibleOverflowParent = true;
                                break;
                            }
                        }
                        curr = curr.parentElement;
                    }
                    
                    if (!hasVisibleOverflowParent) continue;

                    // 3. DISTANCE TO CENTER
                    const btnCenter = rect.top + rect.height / 2;
                    const diff = Math.abs(btnCenter - center);
                    
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestBtn = btn;
                    }
                }
                
                return bestBtn;
            }
        """, REELS_LIKE_BUTTON_XPATH)

        active_btn = btn_handle.as_element()
        
        if active_btn:
            heart_icon = active_btn.query_selector('svg[aria-label="Like"], svg[aria-label="Unlike"]')
            if not heart_icon:
                logger.debug("Skipped liking: Reels like icon not found inside button")
                return False

            heart_label = heart_icon.get_attribute('aria-label')
            if heart_label == 'Unlike':
                logger.debug("Skipped liking: Reel already liked")
                return False

            # Use mouse click to prevent Playwright from auto-scrolling
            box = active_btn.bounding_box()
            if box:
                # Double check Python-side that coordinates are safe
                vp = page.viewport_size
                safe_y_min = 0
                safe_y_max = vp['height'] if vp else 10000
                
                x = box['x'] + box['width'] / 2
                y = box['y'] + box['height'] / 2
                
                if y < safe_y_min or y > safe_y_max:
                    logger.debug(f"Skipped liking: Button y={y} is outside viewport")
                    return False

                if vp:
                    x = max(5.0, min(float(x), float(vp['width']) - 5.0))
                    y = max(5.0, min(float(y), float(vp['height']) - 5.0))

                safe_mouse_move(page, x, y, steps=random.randint(5, 10))
                time.sleep(random.uniform(0.05, 0.12))
                page.mouse.click(x, y, delay=random.randint(25, 65))
                logger.info("Liked reel")
                return True
    except Exception as e:
        logger.error(f"Error liking reel: {e}")
    
    return False
