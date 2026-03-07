"""
Instagram automation functions using Playwright/Camoufox
"""
import time
import random


def random_delay(min_seconds: float = 1.0, max_seconds: float = 3.0):
    """Add a random delay to appear human-like"""
    time.sleep(random.uniform(min_seconds, max_seconds))


def _viewport_bounds(page, default_width: int = 1280, default_height: int = 720) -> tuple[int, int]:
    viewport = getattr(page, 'viewport_size', None)
    if viewport:
        width = int(viewport.get('width') or default_width)
        height = int(viewport.get('height') or default_height)
        return width, height
    return default_width, default_height


def _pick_spawn_coordinate(size: int, preferred_margin: int = 200, edge_margin: int = 15) -> int:
    size = max(int(size), edge_margin)
    safe_max = max(edge_margin, size - edge_margin)
    effective_margin = min(max(edge_margin, preferred_margin), safe_max)
    low = effective_margin
    high = max(low, size - effective_margin)
    return random.randint(low, high)


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


def seed_mouse_cursor(page, preferred_margin: int = 200, edge_margin: int = 15) -> tuple[int, int] | None:
    """
    Seed the cursor to a randomized, viewport-safe starting point so the first
    visible interaction does not originate from the viewport edge.
    """
    try:
        width, height = _viewport_bounds(page)
        start_x = _pick_spawn_coordinate(width, preferred_margin=preferred_margin, edge_margin=edge_margin)
        start_y = _pick_spawn_coordinate(height, preferred_margin=preferred_margin, edge_margin=edge_margin)
        safe_mouse_move(page, start_x, start_y, margin_x=edge_margin, margin_y=edge_margin, steps=1)
        return start_x, start_y
    except Exception:
        return None
