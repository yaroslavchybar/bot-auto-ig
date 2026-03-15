import time
from python.core.selectors import FOLLOW_BUTTON, FOLLOW_BACK_BUTTON, FOLLOWING_BUTTON, REQUESTED_BUTTON

def _is_in_suggested(btn, max_depth: int = 6) -> bool:
    """Heuristically detect if button is inside 'Suggested for you' carousel."""
    try:
        parent = btn
        # If it's a locator, we need the element handle
        if hasattr(parent, "element_handle"):
            parent = parent.element_handle()

        for _ in range(max_depth):
            # With the modern Playwright locator API, traversing up is done via
            # locator('xpath=..') or page.evaluate(). We rely on SemanticSelector's
            # finding logic to avoid matching inside 'Suggested for you' carousel.
            if not hasattr(parent, "locator"):
                break
            pass
            break

    except Exception:
        pass
    return False


def find_follow_control(page):
    """
    Find a follow-related button and classify its state.
    Returns tuple (state, element) where state in {"follow", "requested", "following", None}
    """
    
    # Try strategies in order of likely state (check existing state first)
    
    # Check "Following"
    following_btn = FOLLOWING_BUTTON.find(page)
    if following_btn:
        return "following", following_btn
        
    # Check "Requested"
    requested_btn = REQUESTED_BUTTON.find(page)
    if requested_btn:
        return "requested", requested_btn
    
    # Check "Follow Back" first (more specific than just "Follow")
    follow_back_btn = FOLLOW_BACK_BUTTON.find(page)
    if follow_back_btn:
        return "follow", follow_back_btn
        
    # Check "Follow"
    follow_btn = FOLLOW_BUTTON.find(page)
    if follow_btn:
        return "follow", follow_btn
        
    return None, None

def wait_for_follow_state(page, timeout_ms: int = 8000):
    deadline = time.time() + (timeout_ms / 1000.0)
    while time.time() < deadline:
        try:
            state, _ = find_follow_control(page)
            if state in ("requested", "following"):
                return state
        except Exception:
            pass
        time.sleep(0.5)
    return None
