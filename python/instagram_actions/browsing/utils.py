import time
import random
import math
import logging

from typing import Callable

logger = logging.getLogger(__name__)


def _get_viewport_size(page) -> tuple[int, int]:
    try:
        viewport = getattr(page, "viewport_size", None)
        if viewport and viewport.get("width") and viewport.get("height"):
            return int(viewport["width"]), int(viewport["height"])
    except Exception:
        pass

    try:
        viewport_h = page.evaluate("() => window.innerHeight") or 0
        viewport_w = page.evaluate("() => window.innerWidth") or 0
        return int(viewport_w), int(viewport_h)
    except Exception:
        return 0, 0


def ease_out_cubic(t: float) -> float:
    return 1 - pow(1 - t, 3)


def ease_in_out_cubic(t: float) -> float:
    if t < 0.5:
        return 4 * t * t * t
    return 1 - pow(-2 * t + 2, 3) / 2


def _pick_point(viewport_w: int, viewport_h: int) -> tuple[int, int]:
    if viewport_w > 0 and viewport_h > 0:
        x = random.randint(int(viewport_w * 0.18), int(viewport_w * 0.82))
        y = random.randint(int(viewport_h * 0.20), int(viewport_h * 0.80))
        return x, y
    return random.randint(200, 600), random.randint(200, 500)


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
    for i in range(1, steps + 1):
        if should_stop and should_stop():
            return

        t = i / steps
        target = total_delta * easing(t)
        step = int(round(target - moved))
        if step:
            page.mouse.wheel(0, step)
            moved += step

        base_sleep = duration_s / steps
        time.sleep(max(0.01, base_sleep + random.uniform(-0.006, 0.012)))

    remainder = total_delta - moved
    if remainder:
        page.mouse.wheel(0, remainder)


def scroll_to_element(
    page,
    element,
    target_y_ratio: float = 0.5,
    ensure_full_visible: bool = True,
    should_stop: Callable[[], bool] | None = None,
) -> bool:
    """
    Scroll to bring an element into view.
    
    Args:
        page: Playwright page
        element: Target element to scroll to
        target_y_ratio: Where to position element center (0.0=top, 1.0=bottom)
        ensure_full_visible: If True, scroll until entire element is visible (including bottom)
        should_stop: Optional stop callback
    
    Returns:
        True if scroll was performed successfully
    """
    try:
        viewport_w, viewport_h = _get_viewport_size(page)
        box = element.bounding_box() if element else None
        if not box:
            return False

        if viewport_h <= 0:
            viewport_h = 900
        if viewport_w <= 0:
            viewport_w = 1200

        post_top = box["y"]
        post_bottom = box["y"] + box["height"]
        post_height = box["height"]
        
        # Margin from viewport edges (for header/buttons visibility)
        top_margin = 60   # Space for post header
        bottom_margin = 50  # Space below action buttons
        
        if ensure_full_visible:
            # Check if post is taller than viewport (minus margins)
            available_height = viewport_h - top_margin - bottom_margin
            
            if post_height > available_height:
                # Post is too tall - position so bottom (buttons) are just visible
                # with some margin from viewport bottom
                target_bottom_y = viewport_h - bottom_margin
                delta = int(round(post_bottom - target_bottom_y))
            else:
                # Post fits in viewport - ensure entire post is visible
                # Position so post_top is at top_margin and post_bottom has room
                if post_top < top_margin:
                    # Post top is above viewport - scroll up
                    delta = int(round(post_top - top_margin))
                elif post_bottom > viewport_h - bottom_margin:
                    # Post bottom is below viewport - scroll down
                    delta = int(round(post_bottom - (viewport_h - bottom_margin)))
                else:
                    # Post is already fully visible
                    return True
        else:
            # Original center-based positioning
            target_y_ratio = min(0.75, max(0.25, float(target_y_ratio)))
            target_y = viewport_h * target_y_ratio
            current_center_y = box["y"] + (box["height"] / 2)
            delta = int(round(current_center_y - target_y))
        
        if abs(delta) <= 6:
            return True

        x, y = _pick_point(viewport_w, viewport_h)
        page.mouse.move(x, y)
        time.sleep(random.uniform(0.03, 0.10))
        if should_stop and should_stop():
            return False

        distance_factor = abs(delta) / max(1, viewport_h)
        duration_s = random.uniform(0.20, 0.35) + min(2.0, max(0.6, distance_factor)) * random.uniform(0.25, 0.55)
        _smooth_wheel(page, delta, duration_s=duration_s, easing=ease_out_cubic, should_stop=should_stop)
        return True
    except Exception as e:
        logger.error(f"Error in scroll_to_element: {e}")
        return False

def human_scroll(page, total_delta: int | None = None, should_stop: Callable[[], bool] | None = None):
    """
    Simplified human-like scroll using mouse wheel events only.
    """
    try:
        viewport_w, viewport_h = _get_viewport_size(page)
        x, y = _pick_point(viewport_w, viewport_h)
        page.mouse.move(x, y)
        time.sleep(random.uniform(0.05, 0.15))

        if should_stop and should_stop():
            return

        if viewport_h <= 0:
            viewport_h = 900

        default_min = max(240, int(viewport_h * 0.45))
        default_max = max(default_min + 60, int(viewport_h * 0.85))
        total = total_delta if total_delta is not None else random.randint(default_min, default_max)

        duration_s = random.uniform(0.18, 0.32) + min(2.2, abs(total) / 700) * random.uniform(0.22, 0.55)
        _smooth_wheel(page, int(total), duration_s=duration_s, easing=ease_in_out_cubic, should_stop=should_stop)

        # Occasional tiny correction scroll
        if random.random() < 0.22:
            correction = random.randint(-max(22, int(abs(total) * 0.06)), max(22, int(abs(total) * 0.06)))
            if correction:
                page.mouse.wheel(0, correction)
                time.sleep(random.uniform(0.05, 0.12))

    except Exception as e:
        logger.error(f"Error in human_scroll: {e}")
        # Fallback to a simple smooth scroll via JS
        try:
            page.evaluate(
                f"window.scrollBy({{top: {total_delta or 400}, behavior: 'smooth'}})"
            )
            time.sleep(0.5)
        except Exception:
            pass


def _bezier_point(t: float, p0: tuple, p1: tuple, p2: tuple, p3: tuple) -> tuple:
    """Calculate point on cubic Bézier curve at parameter t."""
    u = 1 - t
    return (
        u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
        u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
    )


def human_mouse_move(page, target_x: int | None = None, target_y: int | None = None):
    """
    Perform realistic mouse movement using Bézier curves with variable speed.
    Mimics natural human cursor movement with slight curves and speed variation.
    """
    try:
        viewport_w, viewport_h = _get_viewport_size(page)
        
        # Get current mouse position or pick a starting point
        start_x, start_y = _pick_point(viewport_w, viewport_h)
        
        # Determine end position
        if target_x is not None and target_y is not None:
            end_x, end_y = int(target_x), int(target_y)
        elif viewport_w > 0 and viewport_h > 0:
            end_x = random.randint(int(viewport_w * 0.15), int(viewport_w * 0.85))
            end_y = random.randint(int(viewport_h * 0.18), int(viewport_h * 0.82))
        else:
            end_x = random.randint(120, 680)
            end_y = random.randint(160, 580)
        
        distance = math.sqrt((end_x - start_x) ** 2 + (end_y - start_y) ** 2)
        if distance < 10:
            return  # Too close, skip movement
        
        # Generate control points for Bézier curve (creates natural arc)
        # Offset perpendicular to the line for curvature
        mid_x = (start_x + end_x) / 2
        mid_y = (start_y + end_y) / 2
        
        # Random curvature direction and intensity
        curve_intensity = random.uniform(0.1, 0.35) * distance
        curve_direction = random.choice([-1, 1])
        
        # Perpendicular offset
        dx = end_x - start_x
        dy = end_y - start_y
        perp_x = -dy / distance * curve_intensity * curve_direction
        perp_y = dx / distance * curve_intensity * curve_direction
        
        # Control points with some randomness
        cp1 = (
            start_x + dx * 0.25 + perp_x * 0.5 + random.uniform(-15, 15),
            start_y + dy * 0.25 + perp_y * 0.5 + random.uniform(-15, 15),
        )
        cp2 = (
            start_x + dx * 0.75 + perp_x * 0.5 + random.uniform(-15, 15),
            start_y + dy * 0.75 + perp_y * 0.5 + random.uniform(-15, 15),
        )
        
        # Number of steps based on distance (more steps = smoother)
        steps = max(12, min(40, int(distance / 15)))
        
        # Move along the Bézier curve with variable speed
        for i in range(steps + 1):
            # Use ease-in-out for natural acceleration/deceleration
            t = i / steps
            eased_t = ease_in_out_cubic(t)
            
            point = _bezier_point(eased_t, (start_x, start_y), cp1, cp2, (end_x, end_y))
            
            # Add tiny jitter (hand tremor simulation)
            jitter_x = point[0] + random.uniform(-1.5, 1.5)
            jitter_y = point[1] + random.uniform(-1.5, 1.5)
            
            page.mouse.move(int(jitter_x), int(jitter_y))
            
            # Variable delay - slower at start and end, faster in middle
            if t < 0.15 or t > 0.85:
                delay = random.uniform(0.012, 0.025)  # Slower at endpoints
            else:
                delay = random.uniform(0.004, 0.012)  # Faster in middle
            
            time.sleep(delay)
            
            # Occasional micro-pause (like human hesitation)
            if random.random() < 0.03:
                time.sleep(random.uniform(0.02, 0.06))
        
        # Occasional small correction at end (overshoot correction)
        if random.random() < 0.25:
            time.sleep(random.uniform(0.04, 0.10))
            correction_x = end_x + random.randint(-6, 6)
            correction_y = end_y + random.randint(-6, 6)
            page.mouse.move(correction_x, correction_y)

    except Exception:
        pass
