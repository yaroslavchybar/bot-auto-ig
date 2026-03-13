from typing import Callable, Tuple


def _safe(log: Callable[[str], None], action: str, func):
    """Run func with logging on exceptions; keep flows non-fatal."""
    try:
        func()
    except Exception as err:
        log(f"Пропускаю {action}: {err}")


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
    close_btn = (
        page.query_selector('button[aria-label="Close"]')
        or page.query_selector('[role="button"][aria-label*="Close"]')
        or page.query_selector('button[aria-label*="close" i]')
    )
    if close_btn:
        return close_btn
    close_svg = page.query_selector('svg[aria-label="Close"]')
    if not close_svg:
        return None
    return (
        close_svg.query_selector('xpath=ancestor-or-self::*[self::button or @role="button"][1]')
        or close_svg.query_selector('xpath=ancestor-or-self::*[self::div][1]')
        or close_svg
    )

