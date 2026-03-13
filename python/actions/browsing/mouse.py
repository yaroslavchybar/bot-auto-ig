import math
import random
import time

from python.actions.browsing.scrolling import ease_in_out_cubic
from python.actions.browsing.viewport import _get_viewport_size, _pick_point
from python.actions.common import safe_mouse_move


def _bezier_point(t: float, p0: tuple, p1: tuple, p2: tuple, p3: tuple) -> tuple:
    u = 1 - t
    return (
        u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
        u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
    )


def human_mouse_move(page, target_x: int | None = None, target_y: int | None = None):
    try:
        viewport_w, viewport_h = _get_viewport_size(page)
        start_x, start_y = _pick_point(viewport_w, viewport_h)
        end_x, end_y = _target_point(viewport_w, viewport_h, target_x, target_y)
        distance = math.sqrt((end_x - start_x) ** 2 + (end_y - start_y) ** 2)
        if distance < 10:
            return
        control_points = _control_points(start_x, start_y, end_x, end_y, distance)
        steps = max(12, min(40, int(distance / 15)))
        _move_curve(page, viewport_w, viewport_h, start_x, start_y, end_x, end_y, control_points, steps)
        _final_correction(page, viewport_w, viewport_h, end_x, end_y)
    except Exception:
        pass


def _target_point(viewport_w: int, viewport_h: int, target_x, target_y) -> tuple[int, int]:
    if target_x is not None and target_y is not None:
        return int(target_x), int(target_y)
    if viewport_w > 0 and viewport_h > 0:
        return (
            random.randint(int(viewport_w * 0.15), int(viewport_w * 0.85)),
            random.randint(int(viewport_h * 0.18), int(viewport_h * 0.82)),
        )
    return random.randint(120, 680), random.randint(160, 580)


def _control_points(start_x: int, start_y: int, end_x: int, end_y: int, distance: float) -> tuple[tuple, tuple]:
    dx = end_x - start_x
    dy = end_y - start_y
    curve_intensity = random.uniform(0.1, 0.35) * distance
    curve_direction = random.choice([-1, 1])
    perp_x = -dy / distance * curve_intensity * curve_direction
    perp_y = dx / distance * curve_intensity * curve_direction
    cp1 = (
        start_x + dx * 0.25 + perp_x * 0.5 + random.uniform(-15, 15),
        start_y + dy * 0.25 + perp_y * 0.5 + random.uniform(-15, 15),
    )
    cp2 = (
        start_x + dx * 0.75 + perp_x * 0.5 + random.uniform(-15, 15),
        start_y + dy * 0.75 + perp_y * 0.5 + random.uniform(-15, 15),
    )
    return cp1, cp2


def _move_curve(page, viewport_w: int, viewport_h: int, start_x: int, start_y: int, end_x: int, end_y: int, control_points, steps: int) -> None:
    cp1, cp2 = control_points
    for index in range(steps + 1):
        t = index / steps
        eased_t = ease_in_out_cubic(t)
        point = _bezier_point(eased_t, (start_x, start_y), cp1, cp2, (end_x, end_y))
        clamped_x, clamped_y = _clamped_point(viewport_w, viewport_h, point)
        safe_mouse_move(page, clamped_x, clamped_y)
        time.sleep(_movement_delay(t))
        if random.random() < 0.03:
            time.sleep(random.uniform(0.02, 0.06))


def _clamped_point(viewport_w: int, viewport_h: int, point: tuple[float, float]) -> tuple[int, int]:
    width = max(viewport_w, 4)
    height = max(viewport_h, 4)
    jitter_x = point[0] + random.uniform(-1.5, 1.5)
    jitter_y = point[1] + random.uniform(-1.5, 1.5)
    return max(2, min(int(jitter_x), width - 2)), max(2, min(int(jitter_y), height - 2))


def _movement_delay(t: float) -> float:
    if t < 0.15 or t > 0.85:
        return random.uniform(0.012, 0.025)
    return random.uniform(0.004, 0.012)


def _final_correction(page, viewport_w: int, viewport_h: int, end_x: int, end_y: int) -> None:
    if random.random() >= 0.25:
        return
    time.sleep(random.uniform(0.04, 0.10))
    correction_x = end_x + random.randint(-6, 6)
    correction_y = end_y + random.randint(-6, 6)
    clamped_x, clamped_y = _clamped_point(max(viewport_w, 4), max(viewport_h, 4), (correction_x, correction_y))
    safe_mouse_move(page, clamped_x, clamped_y)
