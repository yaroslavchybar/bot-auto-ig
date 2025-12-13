from typing import Callable, Tuple


def _safe(log: Callable[[str], None], action: str, func):
    """Run func with logging on exceptions; keep flows non-fatal."""
    try:
        func()
    except Exception as err:
        log(f"ℹ️ Пропускаю {action}: {err}")


def _normalize_range(range_values, default: Tuple[int, int]) -> Tuple[int, int]:
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

