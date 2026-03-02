"""
Instagram automation functions using Playwright/Camoufox
"""
import time
import random


def random_delay(min_seconds: float = 1.0, max_seconds: float = 3.0):
    """Add a random delay to appear human-like"""
    time.sleep(random.uniform(min_seconds, max_seconds))


def safe_mouse_move(page, target_x: int | float, target_y: int | float, margin_x: int = 15, margin_y: int = 15, **kwargs):
    """
    Safely move the mouse ensuring it does not hit the window boundaries, preventing the cursor from getting stuck.
    """
    try:
        viewport = page.viewport_size
        if viewport:
            vw = viewport.get("width", 1366)
            vh = viewport.get("height", 768)
        else:
            vw = 1366
            vh = 768
            
        safe_x = max(margin_x, min(int(target_x), vw - margin_x))
        safe_y = max(margin_y, min(int(target_y), vh - margin_y))
        
        page.mouse.move(safe_x, safe_y, **kwargs)
    except Exception as e:
        # Fallback
        page.mouse.move(int(target_x), int(target_y), **kwargs)
