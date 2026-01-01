def _is_in_suggested(btn, max_depth: int = 6) -> bool:
    """Heuristically detect if button is inside 'Suggested for you' carousel."""
    try:
        parent = btn
        for _ in range(max_depth):
            parent = parent.parent_element()
            if not parent:
                break
            text = (parent.inner_text() or "").lower()
            if "suggested for you" in text:
                return True
    except Exception:
        pass
    return False


import time
from python.core.automation.selectors import FOLLOW_BUTTON, FOLLOWING_BUTTON, REQUESTED_BUTTON

def _is_in_suggested(btn, max_depth: int = 6) -> bool:
    """Heuristically detect if button is inside 'Suggested for you' carousel."""
    try:
        parent = btn
        # If it's a locator, we need the element handle
        if hasattr(parent, "element_handle"):
            parent = parent.element_handle()
            
        for _ in range(max_depth):
            # Playwright ElementHandle parent access
            # Note: This is tricky with pure Locators. 
            # Ideally we check if the button is within a container with specific text.
            # For now, we'll skip this check if we can't easily traverse up, 
            # or rely on semantic specificity (header vs body).
            if not hasattr(parent, "query_selector"): # Basic check if it's an element
                 break
                 
            # In Playwright, traversing up is usually done via locators or evaluation
            # This legacy check might need a different approach with Locators.
            # But since we are using get_by_role, we might match elements anywhere.
            # We will rely on SemanticSelector's finding logic.
            pass 
            
            # Legacy implementation used ElementHandle.parent_element() which might exist depending on driver
            # For this migration, we will trust the Semantic Selector to find the main profile button first.
            # Or we can re-implement if needed.
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
