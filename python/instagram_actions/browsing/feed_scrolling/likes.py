import os
import random
import time
from playwright.sync_api import Error as PlaywrightError
from python.internal_systems.error_handling.exceptions import ElementNotFoundError, BotException
from python.instagram_actions.browsing.utils import _smooth_wheel, ease_out_cubic, _pick_point
from python.instagram_actions.actions import safe_mouse_move

_FEED_DEBUG_MOUSE = os.getenv("FEED_DEBUG_MOUSE", "1").strip().lower() in {"1", "true", "yes", "on"}
_CLICK_EDGE_MARGIN_X = 12.0
_CLICK_EDGE_MARGIN_TOP = 12.0
_CLICK_EDGE_MARGIN_BOTTOM = 28.0
_MIN_BOTTOM_GAP_FOR_CLICK = 36.0
_CLICK_SAFETY_ATTEMPTS = 3
_CLICK_SAFETY_MAX_STEP_RATIO = 0.45


def _debug_mouse(message: str) -> None:
    if _FEED_DEBUG_MOUSE:
        print(f"[feed-like-debug] {message}")


def _resolve_effective_viewport(page) -> tuple[float, float, float, float, float, float]:
    """
    Resolve a conservative viewport using BOTH JS inner size and Playwright viewport_size.
    We take the minimum positive values to avoid aiming into bottom/right non-client areas.
    Returns: (effective_w, effective_h, js_w, js_h, vp_w, vp_h)
    """
    js_w = 0.0
    js_h = 0.0
    vp_w = 0.0
    vp_h = 0.0

    try:
        js_w = float(page.evaluate("() => window.innerWidth") or 0)
        js_h = float(page.evaluate("() => window.innerHeight") or 0)
    except Exception:
        pass

    try:
        vp = getattr(page, "viewport_size", None) or {}
        vp_w = float(vp.get("width") or 0)
        vp_h = float(vp.get("height") or 0)
    except Exception:
        pass

    widths = [v for v in (js_w, vp_w) if v > 0]
    heights = [v for v in (js_h, vp_h) if v > 0]
    eff_w = float(min(widths)) if widths else 1200.0
    eff_h = float(min(heights)) if heights else 900.0

    return eff_w, eff_h, js_w, js_h, vp_w, vp_h


def _ensure_click_safety_zone(
    page,
    post_element,
    clickable,
    min_bottom_gap: float = _MIN_BOTTOM_GAP_FOR_CLICK,
    max_attempts: int = _CLICK_SAFETY_ATTEMPTS,
):
    """
    If the like button is too close to the bottom edge, nudge content up before clicking.
    """
    current = clickable
    for attempt in range(max_attempts):
        box = current.bounding_box() if current else None
        if not box:
            _debug_mouse("click-safety: missing clickable box")
            return None

        _, eff_h, js_w, js_h, vp_w, vp_h = _resolve_effective_viewport(page)
        bottom_gap = eff_h - (box["y"] + box["height"])
        if bottom_gap >= min_bottom_gap:
            _debug_mouse(
                f"click-safety: ready attempt={attempt + 1} bottom_gap={bottom_gap:.1f} "
                f"min_required={min_bottom_gap:.1f} effective_h={eff_h:.1f} js=({js_w:.1f}x{js_h:.1f}) "
                f"viewport_size=({vp_w:.1f}x{vp_h:.1f})"
            )
            return current

        needed = max(0.0, min_bottom_gap - bottom_gap)
        max_step = max(80, int(eff_h * _CLICK_SAFETY_MAX_STEP_RATIO))
        scroll_step = int(round(needed + random.uniform(10.0, 20.0)))
        scroll_step = max(22, min(scroll_step, max_step))
        _debug_mouse(
            f"click-safety: attempt={attempt + 1} bottom_gap={bottom_gap:.1f} "
            f"too_low needed={needed:.1f} -> micro-scroll {scroll_step}px"
        )
        try:
            prev_y = float(box["y"])
            _smooth_wheel(page, scroll_step, duration_s=random.uniform(0.18, 0.30), easing=ease_out_cubic)
            time.sleep(random.uniform(0.06, 0.14))
        except Exception as e:
            _debug_mouse(f"click-safety: scroll exception={type(e).__name__}: {e}")
            return current

        _, current = _find_like_button(post_element)
        new_box = current.bounding_box() if current else None
        if new_box:
            _, new_eff_h, _, _, _, _ = _resolve_effective_viewport(page)
            new_bottom_gap = new_eff_h - (new_box["y"] + new_box["height"])
            if new_bottom_gap < bottom_gap - 1.0:
                reverse_step = int(round(scroll_step * 1.2))
                _debug_mouse(
                    f"click-safety: direction mismatch detected (y {prev_y:.1f}->{new_box['y']:.1f}, "
                    f"gap {bottom_gap:.1f}->{new_bottom_gap:.1f}), reversing by {-reverse_step}px"
                )
                try:
                    _smooth_wheel(page, -reverse_step, duration_s=random.uniform(0.18, 0.30), easing=ease_out_cubic)
                    time.sleep(random.uniform(0.06, 0.14))
                    _, current = _find_like_button(post_element)
                except Exception as e:
                    _debug_mouse(f"click-safety: reverse exception={type(e).__name__}: {e}")
                    return current

    final_box = current.bounding_box() if current else None
    if final_box:
        _, final_eff_h, _, _, _, _ = _resolve_effective_viewport(page)
        final_gap = final_eff_h - (final_box["y"] + final_box["height"])
        _debug_mouse(
            f"click-safety: give-up bottom_gap={final_gap:.1f} min_required={min_bottom_gap:.1f}"
        )
    else:
        _debug_mouse("click-safety: give-up with missing clickable after retries")

    return current


def _find_like_button(post_element):
    """Find the like button SVG and its clickable parent."""
    like_svg = (
        post_element.query_selector('svg[aria-label="Like"]')
        or post_element.query_selector('div[role="button"] svg[aria-label="Like"]')
    )
    if not like_svg:
        return None, None
    clickable = like_svg.query_selector('xpath=ancestor-or-self::*[@role="button" or self::button][1]')
    return like_svg, clickable


def _micro_scroll_to_button(page, post_element, max_attempts: int = 3) -> bool:
    """
    Perform small smooth scrolls to bring the like button into view.
    Returns True if button became visible after scrolling.
    """
    for attempt in range(max_attempts):
        like_svg, clickable = _find_like_button(post_element)
        if clickable and _is_in_viewport(page, clickable):
            _debug_mouse(f"micro-scroll attempt={attempt + 1}: clickable already in viewport")
            return True
        
        # Already liked? No need to scroll
        if post_element.query_selector('svg[aria-label="Unlike"]'):
            return False
        
        # Smooth scroll to reveal button area (direction chosen by position if available)
        viewport_w, viewport_h, _, _, _, _ = _resolve_effective_viewport(page)
        x, y = _pick_point(int(viewport_w), int(viewport_h))
        try:
            _debug_mouse(
                f"micro-scroll attempt={attempt + 1}: viewport=({viewport_w}x{viewport_h}) "
                f"move_target=({x},{y})"
            )
            safe_mouse_move(page, x, y)
            time.sleep(random.uniform(0.05, 0.12))

            scroll_amount = random.randint(
                max(90, int(viewport_h * 0.12)),
                max(120, int(viewport_h * 0.22)),
            )
            reason = "default"
            if clickable:
                box = clickable.bounding_box()
                if box:
                    bottom_gap = viewport_h - (box["y"] + box["height"])
                    top_gap = box["y"]
                    if bottom_gap < 18:
                        needed = max(0.0, 18.0 - bottom_gap)
                        scroll_amount = int(round(needed + random.uniform(12.0, 24.0)))
                        scroll_amount = max(20, min(scroll_amount, max(70, int(viewport_h * 0.40))))
                        reason = f"below-bottom gap={bottom_gap:.1f}"
                    elif top_gap < 10:
                        needed = max(0.0, 10.0 - top_gap)
                        scroll_amount = -int(round(needed + random.uniform(10.0, 20.0)))
                        scroll_amount = min(-18, max(scroll_amount, -max(60, int(viewport_h * 0.30))))
                        reason = f"above-top gap={top_gap:.1f}"

            duration = random.uniform(0.25, 0.40) + min(1.2, scroll_amount / 500) * random.uniform(0.12, 0.22)
            _debug_mouse(
                f"micro-scroll attempt={attempt + 1}: scroll_amount={scroll_amount} "
                f"reason={reason} duration={duration:.3f}s"
            )
            _smooth_wheel(page, scroll_amount, duration_s=duration, easing=ease_out_cubic)
            time.sleep(random.uniform(0.1, 0.2))
        except Exception as e:
            _debug_mouse(f"micro-scroll attempt={attempt + 1}: exception={type(e).__name__}: {e}")
            break
    
    # Final check
    _, clickable = _find_like_button(post_element)
    final_ok = bool(clickable and _is_in_viewport(page, clickable))
    _debug_mouse(f"micro-scroll final: clickable_found={bool(clickable)} in_viewport={final_ok}")
    return final_ok


def _is_in_viewport(page, element, margin: int = 12) -> bool:
    try:
        box = element.bounding_box() if element else None
        if not box:
            _debug_mouse("in-viewport: missing bounding box")
            return False

        viewport_w, viewport_h, js_w, js_h, vp_w, vp_h = _resolve_effective_viewport(page)

        x0 = box["x"]
        y0 = box["y"]
        x1 = x0 + box["width"]
        y1 = y0 + box["height"]

        in_viewport = (
            x0 >= margin
            and y0 >= margin
            and x1 <= viewport_w - margin
            and y1 <= viewport_h - margin
            and box["width"] > 0
            and box["height"] > 0
        )
        bottom_gap = viewport_h - y1
        _debug_mouse(
            "in-viewport: "
            f"box=({x0:.1f},{y0:.1f},{box['width']:.1f},{box['height']:.1f}) "
            f"effective_viewport=({viewport_w:.1f}x{viewport_h:.1f}) "
            f"js=({js_w:.1f}x{js_h:.1f}) viewport_size=({vp_w:.1f}x{vp_h:.1f}) "
            f"margin={margin} "
            f"bottom_gap={bottom_gap:.1f} result={in_viewport}"
        )
        return in_viewport
    except Exception:
        _debug_mouse("in-viewport: exception while calculating bounds")
        return False


def _mouse_click_element_center(page, element) -> bool:
    try:
        box = element.bounding_box() if element else None
        if not box:
            _debug_mouse("mouse-click: missing bounding box")
            return False

        raw_x = box["x"] + (box["width"] / 2) + random.uniform(-2.0, 2.0)
        raw_y = box["y"] + (box["height"] / 2) + random.uniform(-2.0, 2.0)
        eff_w, eff_h, js_w, js_h, vp_w, vp_h = _resolve_effective_viewport(page)
        safe_x = max(_CLICK_EDGE_MARGIN_X, min(float(raw_x), eff_w - _CLICK_EDGE_MARGIN_X))
        safe_y = max(_CLICK_EDGE_MARGIN_TOP, min(float(raw_y), eff_h - _CLICK_EDGE_MARGIN_BOTTOM))
        bottom_gap_click = eff_h - float(safe_y)
        _debug_mouse(
            "mouse-click target: "
            f"box=({box['x']:.1f},{box['y']:.1f},{box['width']:.1f},{box['height']:.1f}) "
            f"raw=({raw_x:.1f},{raw_y:.1f}) safe=({safe_x:.1f},{safe_y:.1f}) "
            f"effective_viewport=({eff_w:.1f}x{eff_h:.1f}) "
            f"js=({js_w:.1f}x{js_h:.1f}) viewport_size=({vp_w:.1f}x{vp_h:.1f}) "
            f"bottom_gap={bottom_gap_click:.1f}"
        )

        safe_mouse_move(page, safe_x, safe_y, steps=random.randint(5, 10))
        _debug_mouse(f"mouse-move executed to safe=({safe_x:.1f},{safe_y:.1f})")
        time.sleep(random.uniform(0.05, 0.12))
        page.mouse.click(safe_x, safe_y, delay=random.randint(25, 65))
        _debug_mouse(f"mouse-click executed at safe=({safe_x:.1f},{safe_y:.1f})")
        return True
    except Exception as e:
        _debug_mouse(f"mouse-click exception={type(e).__name__}: {e}")
        return False


def perform_like(page, post_element) -> bool:
    """Like a feed post, skipping if already liked."""
    try:
        # Skip if already liked
        if post_element.query_selector('svg[aria-label="Unlike"]'):
            _debug_mouse("perform_like: already liked, skipping")
            return False

        like_svg, clickable = _find_like_button(post_element)
        _debug_mouse(f"perform_like: initial clickable_found={bool(clickable)}")

        for idx in range(4):
            _debug_mouse(f"perform_like: loop={idx + 1} clickable_found={bool(clickable)}")
            if clickable:
                clickable = _ensure_click_safety_zone(page, post_element, clickable)
            if clickable and _is_in_viewport(page, clickable):
                _debug_mouse(f"perform_like: loop={idx + 1} clickable is in viewport, clicking")
                if _mouse_click_element_center(page, clickable):
                    print("Liked post")
                    return True
                _debug_mouse(f"perform_like: loop={idx + 1} click attempt failed")
                return False

            if not _micro_scroll_to_button(page, post_element, max_attempts=1):
                _debug_mouse(f"perform_like: loop={idx + 1} micro-scroll did not recover clickable")
                return False

            like_svg, clickable = _find_like_button(post_element)
            _debug_mouse(f"perform_like: loop={idx + 1} after micro-scroll clickable_found={bool(clickable)}")
    except ElementNotFoundError:
        print(f"[!] Like button not found")
    except (PlaywrightError, BotException) as e:
        print(f"[!] Error liking post: {type(e).__name__} - {e}")
        _debug_mouse(f"perform_like exception={type(e).__name__}: {e}")
    
    return False
