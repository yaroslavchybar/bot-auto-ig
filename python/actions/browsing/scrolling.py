import logging
import random
import time
from typing import Callable

from python.actions.browsing.viewport import _get_viewport_size, _pick_point
from python.actions.common import safe_mouse_move

logger = logging.getLogger(__name__)


class _ScrollStopped(RuntimeError):
    """Raised when scrolling is intentionally interrupted."""


def ease_out_cubic(t: float) -> float:
    return 1 - pow(1 - t, 3)


def ease_in_out_cubic(t: float) -> float:
    if t < 0.5:
        return 4 * t * t * t
    return 1 - pow(-2 * t + 2, 3) / 2


def _smooth_wheel(
    page,
    total_delta: int,
    duration_s: float,
    easing: Callable[[float], float],
    should_stop: Callable[[], bool] | None = None,
) -> None:
    if total_delta == 0:
        return
    duration_s = max(0.15, float(duration_s))
    steps = max(6, min(34, int(abs(total_delta) / 55) + random.randint(3, 8)))
    moved = 0
    for index in range(1, steps + 1):
        if should_stop and should_stop():
            raise _ScrollStopped('scroll stopped')
        t = index / steps
        target = total_delta * easing(t)
        step = int(round(target - moved))
        if step:
            page.mouse.wheel(0, step)
            moved += step
        _sleep_for_wheel_step(duration_s, steps)
    remainder = total_delta - moved
    if remainder:
        page.mouse.wheel(0, remainder)


def _sleep_for_wheel_step(duration_s: float, steps: int) -> None:
    base_sleep = duration_s / steps
    time.sleep(max(0.01, base_sleep + random.uniform(-0.006, 0.012)))


def scroll_to_element(
    page,
    element,
    target_y_ratio: float = 0.5,
    ensure_full_visible: bool = True,
    should_stop: Callable[[], bool] | None = None,
) -> bool:
    try:
        viewport_w, viewport_h, box = _scroll_context(page, element)
        if not box:
            return False
        delta = _scroll_delta(box, viewport_h, target_y_ratio, ensure_full_visible)
        if abs(delta) <= 6:
            return True
        _prepare_scroll_cursor(page, viewport_w, viewport_h, should_stop)
        _perform_element_scroll(page, delta, viewport_h, should_stop)
        return True
    except _ScrollStopped:
        return False
    except Exception as exc:
        logger.error(f'Error in scroll_to_element: {exc}')
        return False


def _scroll_context(page, element):
    viewport_w, viewport_h = _get_viewport_size(page)
    box = element.bounding_box() if element else None
    return max(viewport_w, 1200), max(viewport_h, 900), box


def _scroll_delta(box, viewport_h: int, target_y_ratio: float, ensure_full_visible: bool) -> int:
    if not ensure_full_visible:
        target_y_ratio = min(0.75, max(0.25, float(target_y_ratio)))
        target_y = viewport_h * target_y_ratio
        current_center_y = box['y'] + (box['height'] / 2)
        return int(round(current_center_y - target_y))
    top_margin = 60
    bottom_margin = 50
    post_top = box['y']
    post_bottom = box['y'] + box['height']
    available_height = viewport_h - top_margin - bottom_margin
    if box['height'] > available_height:
        return int(round(post_bottom - (viewport_h - bottom_margin)))
    if post_top < top_margin:
        return int(round(post_top - top_margin))
    if post_bottom > viewport_h - bottom_margin:
        return int(round(post_bottom - (viewport_h - bottom_margin)))
    return 0


def _prepare_scroll_cursor(page, viewport_w: int, viewport_h: int, should_stop) -> None:
    x, y = _pick_point(viewport_w, viewport_h)
    safe_mouse_move(page, x, y)
    time.sleep(random.uniform(0.03, 0.10))
    if should_stop and should_stop():
        raise _ScrollStopped('scroll stopped')


def _perform_element_scroll(page, delta: int, viewport_h: int, should_stop) -> None:
    distance_factor = abs(delta) / max(1, viewport_h)
    duration_s = random.uniform(0.20, 0.35) + min(2.0, max(0.6, distance_factor)) * random.uniform(0.25, 0.55)
    _smooth_wheel(page, delta, duration_s=duration_s, easing=ease_out_cubic, should_stop=should_stop)


def human_scroll(page, total_delta: int | None = None, should_stop: Callable[[], bool] | None = None):
    try:
        viewport_w, viewport_h = _get_viewport_size(page)
        _position_scroll_cursor(page, viewport_w, viewport_h, should_stop)
        total = _scroll_total(total_delta, viewport_h)
        duration_s = random.uniform(0.18, 0.32) + min(2.2, abs(total) / 700) * random.uniform(0.22, 0.55)
        _smooth_wheel(page, int(total), duration_s=duration_s, easing=ease_in_out_cubic, should_stop=should_stop)
        _apply_scroll_correction(page, total)
    except _ScrollStopped:
        return
    except Exception as exc:
        logger.error(f'Error in human_scroll: {exc}')
        _scroll_fallback(page, total_delta)


def _position_scroll_cursor(page, viewport_w: int, viewport_h: int, should_stop) -> None:
    x, y = _pick_point(viewport_w, viewport_h)
    safe_mouse_move(page, x, y)
    time.sleep(random.uniform(0.05, 0.15))
    if should_stop and should_stop():
        raise _ScrollStopped('scroll stopped')


def _scroll_total(total_delta: int | None, viewport_h: int) -> int:
    viewport_h = viewport_h or 900
    default_min = max(240, int(viewport_h * 0.45))
    default_max = max(default_min + 60, int(viewport_h * 0.85))
    return total_delta if total_delta is not None else random.randint(default_min, default_max)


def _apply_scroll_correction(page, total: int) -> None:
    if random.random() >= 0.22:
        return
    correction = random.randint(-max(22, int(abs(total) * 0.06)), max(22, int(abs(total) * 0.06)))
    if not correction:
        return
    page.mouse.wheel(0, correction)
    time.sleep(random.uniform(0.05, 0.12))


def _scroll_fallback(page, total_delta: int | None) -> None:
    try:
        fallback_delta = 400 if total_delta is None else total_delta
        page.evaluate(f"window.scrollBy({{top: {fallback_delta}, behavior: 'smooth'}})")
        time.sleep(0.5)
    except Exception:
        pass
