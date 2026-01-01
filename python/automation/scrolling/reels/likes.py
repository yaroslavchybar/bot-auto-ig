
import logging

logger = logging.getLogger(__name__)


def perform_like(page) -> bool:
    """Like the current active reel."""
    try:
        # Strict approach: Find the Like button that is visually closest to the center of the viewport.
        # AND ensure it is strictly within the viewport bounds.
        # AND ensure it is inside a container that has overflow: visible (as per user observation).
        
        btn_handle = page.evaluate_handle("""
            () => {
                const center = window.innerHeight / 2;
                // Find ALL Like buttons
                const allButtons = Array.from(document.querySelectorAll('svg[aria-label="Like"]'));
                
                let bestBtn = null;
                let minDiff = Infinity;
                
                for (const btn of allButtons) {
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
        """)

        active_btn = btn_handle.as_element()
        
        if active_btn:
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

                page.mouse.click(x, y)
                logger.info("Liked reel")
                return True
    except Exception as e:
        logger.error(f"Error liking reel: {e}")
    
    return False
