from typing import Callable, Tuple


def _safe(log: Callable[[str], None], action: str, func):
    """Run func with logging on exceptions; keep flows non-fatal."""
    try:
        func()
    except Exception as err:
        log(f"Skipping {action}: {err}")


def _normalize_range(range_values, default: Tuple[int, int]) -> Tuple[int, int]:
    """Ensure we always have an ordered, non-negative (min, max) tuple."""
    return normalize_range(range_values, default)


def normalize_range(range_values, default: Tuple[int, int]) -> Tuple[int, int]:
    """Ensure we always have an ordered, non-negative (min, max) tuple."""
    try:
        low, high = range_values
        low = max(0, int(low))
        high = max(0, int(high))
        if low > high:
            low, high = high, low
        return low, high
    except Exception:
        return default


def _find_close_button(page):
    close_selectors = [
        'button[aria-label="Close"]',
        '[role="button"][aria-label*="Close"]',
        'button[aria-label*="close" i]',
    ]
    for sel in close_selectors:
        loc = page.locator(sel)
        if loc.count() > 0:
            return loc.first
    close_svg_loc = page.locator('svg[aria-label="Close"]')
    if close_svg_loc.count() == 0:
        return None
    close_svg = close_svg_loc.first
    btn_loc = close_svg.locator('xpath=ancestor-or-self::*[self::button or @role="button"][1]')
    if btn_loc.count() > 0:
        return btn_loc.first
    div_loc = close_svg.locator('xpath=ancestor-or-self::*[self::div][1]')
    if div_loc.count() > 0:
        return div_loc.first
    return close_svg

