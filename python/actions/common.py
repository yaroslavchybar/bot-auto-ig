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


def _effective_viewport_bounds(page, default_width: int = 1280, default_height: int = 720) -> tuple[int, int]:
    viewport_width, viewport_height = _viewport_bounds(
        page,
        default_width=default_width,
        default_height=default_height,
    )
    try:
        inner_width = int(page.evaluate("window.innerWidth") or viewport_width)
    except Exception:
        inner_width = viewport_width
    try:
        inner_height = int(page.evaluate("window.innerHeight") or viewport_height)
    except Exception:
        inner_height = viewport_height
    return min(viewport_width, inner_width), min(viewport_height, inner_height)


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
    safe_x = int(target_x)
    safe_y = int(target_y)
    try:
        vw, vh = _effective_viewport_bounds(page, default_width=1366, default_height=768)
        safe_x = max(margin_x, min(int(target_x), vw - margin_x))
        safe_y = max(margin_y, min(int(target_y), vh - margin_y))
    except Exception:
        pass

    try:
        page.mouse.move(safe_x, safe_y, **kwargs)
    except Exception:
        page.mouse.move(safe_x, safe_y, **kwargs)
    return safe_x, safe_y


def safe_mouse_click(
    page,
    target_x: int | float,
    target_y: int | float,
    margin_x: int = 15,
    margin_y: int = 15,
    click_delay_ms: int = 0,
    **kwargs,
):
    safe_x, safe_y = safe_mouse_move(
        page,
        target_x,
        target_y,
        margin_x=margin_x,
        margin_y=margin_y,
    )
    click_kwargs = dict(kwargs)
    if click_delay_ms > 0:
        click_kwargs["delay"] = int(click_delay_ms)
    page.mouse.click(safe_x, safe_y, **click_kwargs)
    return safe_x, safe_y


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
